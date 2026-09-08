import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync, closeSync, writeSync, writeFileSync, readFileSync } from "node:fs";
import { log } from "../logger";
import { FAKE_HARDWARE, hasBinary, sleep } from "../util";
import type { GatewayConfig } from "../config";
import type { PttBackendName } from "../types";

/**
 * Keying the transmitter.
 *
 * Four backends, because the right one depends on a cable nobody can inspect
 * from software:
 *
 *   vox    — no control line at all. The radio's own VOX hears the audio and
 *            keys itself. Needs no wiring, clips the first syllable, and cannot
 *            tell the channel is busy. The safe default.
 *   gpio   — a pin on the board pulls the radio's PTT through an opto-isolator.
 *            The only backend that can be *verified*: sysfs reads the pin back,
 *            so the console can say "the line went low" rather than "we tried".
 *   cm108  — the GPIO pin CM108/CM119 USB audio chips expose, driven over
 *            hidraw. The classic ham-radio interface; no extra board needed if
 *            the dongle has the right chip.
 *   none   — receive only. Useful for a monitoring box, and the honest state
 *            when a keying attempt has already failed.
 *
 * Every backend reports failures rather than throwing: a bridge that stops
 * receiving because it could not transmit is worse than one that keeps logging.
 */

export interface PttBackend {
  readonly name: PttBackendName;
  init(): Promise<void>;
  key(): Promise<void>;
  unkey(): Promise<void>;
  release(): Promise<void>;
  /** Reads the line back where the hardware allows it. */
  verify(): Promise<{ ok: boolean; detail: string }>;
}

// ── vox / none ───────────────────────────────────────────────────────────────

class NoopBackend implements PttBackend {
  constructor(readonly name: PttBackendName, private readonly detail: string) {}
  init(): Promise<void> {
    return Promise.resolve();
  }
  key(): Promise<void> {
    return Promise.resolve();
  }
  unkey(): Promise<void> {
    return Promise.resolve();
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
  verify(): Promise<{ ok: boolean; detail: string }> {
    return Promise.resolve({ ok: this.name === "vox", detail: this.detail });
  }
}

// ── sysfs / libgpiod ─────────────────────────────────────────────────────────

/**
 * A board GPIO pin. Tries the sysfs interface first because it is the only one
 * that can be read back, and falls back to libgpiod's `gpioset` held open for
 * the duration of a transmission on kernels built without CONFIG_GPIO_SYSFS.
 */
class GpioBackend implements PttBackend {
  readonly name = "gpio" as const;
  private mode: "sysfs" | "gpiod" | "unavailable" = "unavailable";
  private valuePath = "";
  private held: ChildProcess | null = null;
  private lastError = "";

  constructor(private readonly pin: number, private readonly activeLow: boolean) {}

  private get onValue(): "0" | "1" {
    return this.activeLow ? "0" : "1";
  }
  private get offValue(): "0" | "1" {
    return this.activeLow ? "1" : "0";
  }

  async init(): Promise<void> {
    if (FAKE_HARDWARE) {
      this.mode = "sysfs";
      this.valuePath = "";
      return;
    }

    const base = `/sys/class/gpio/gpio${this.pin}`;
    try {
      if (!existsSync(base)) {
        writeFileSync("/sys/class/gpio/export", String(this.pin));
        // The kernel creates the attributes asynchronously.
        await sleep(150);
      }
      if (existsSync(base)) {
        writeFileSync(`${base}/direction`, "out");
        this.valuePath = `${base}/value`;
        writeFileSync(this.valuePath, this.offValue);
        this.mode = "sysfs";
        log.info("radio", `PTT on GPIO ${this.pin} via sysfs (${this.activeLow ? "active low" : "active high"})`);
        return;
      }
    } catch (err) {
      this.lastError = (err as Error).message;
    }

    if (await hasBinary("gpioset")) {
      this.mode = "gpiod";
      log.info("radio", `PTT on GPIO line ${this.pin} via libgpiod`);
      return;
    }

    this.mode = "unavailable";
    log.error(
      "radio",
      `cannot drive GPIO ${this.pin}: ${this.lastError || "no sysfs and no gpioset"}. ` +
        "Run the service as root, or install gpiod.",
    );
  }

  async key(): Promise<void> {
    if (FAKE_HARDWARE) return;
    if (this.mode === "sysfs") {
      writeFileSync(this.valuePath, this.onValue);
      return;
    }
    if (this.mode === "gpiod") {
      // `--mode=wait` holds the line for as long as the process lives, which is
      // the only way to keep a libgpiod line asserted between two calls.
      this.held = spawn("gpioset", ["--mode=wait", "gpiochip0", `${this.pin}=${this.onValue}`], {
        stdio: "ignore",
      });
      return;
    }
    throw new Error(this.lastError || "GPIO is not available");
  }

  async unkey(): Promise<void> {
    if (FAKE_HARDWARE) return;
    if (this.mode === "sysfs") {
      writeFileSync(this.valuePath, this.offValue);
      return;
    }
    this.held?.kill("SIGTERM");
    this.held = null;
  }

  async release(): Promise<void> {
    await this.unkey().catch(() => undefined);
    if (this.mode === "sysfs" && !FAKE_HARDWARE) {
      try {
        writeFileSync("/sys/class/gpio/unexport", String(this.pin));
      } catch {
        // Unexport failing on shutdown is harmless.
      }
    }
  }

  /**
   * Key the line, read it back, unkey, read again. This is what lets the
   * console say whether the pin actually moved — the one thing that cannot be
   * confirmed by looking at the radio, since a wrong pin looks exactly like a
   * wrong cable.
   */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    if (FAKE_HARDWARE) return { ok: true, detail: "Simulated GPIO (development mode)." };
    if (this.mode === "unavailable") {
      return { ok: false, detail: this.lastError || "GPIO is not accessible — is the service running as root?" };
    }
    if (this.mode === "gpiod") {
      return {
        ok: true,
        detail: "Driven through libgpiod, which cannot read the pin back. Confirm on the radio itself.",
      };
    }
    try {
      await this.key();
      await sleep(120);
      const keyed = readFileSync(this.valuePath, "utf8").trim();
      await this.unkey();
      await sleep(120);
      const idle = readFileSync(this.valuePath, "utf8").trim();
      const ok = keyed === this.onValue && idle === this.offValue;
      return {
        ok,
        detail: ok
          ? `Pin ${this.pin} went to ${this.onValue} when keyed and back to ${this.offValue}. The line is moving.`
          : `Pin ${this.pin} read ${keyed} when keyed and ${idle} when idle — expected ${this.onValue}/${this.offValue}.`,
      };
    } catch (err) {
      return { ok: false, detail: `Could not read the pin back: ${(err as Error).message}` };
    }
  }
}

// ── CM108 / CM119 hidraw ─────────────────────────────────────────────────────

/**
 * The GPIO pin on C-Media USB audio chips, driven with the 5-byte HID report
 * every ham-radio interface uses: bit 2 of byte 3 is GPIO3.
 */
class Cm108Backend implements PttBackend {
  readonly name = "cm108" as const;
  private path = "";
  private fd: number | null = null;

  async init(): Promise<void> {
    if (FAKE_HARDWARE) return;
    for (let i = 0; i < 8; i++) {
      const candidate = `/dev/hidraw${i}`;
      if (!existsSync(candidate)) continue;
      try {
        this.fd = openSync(candidate, "r+");
        this.path = candidate;
        log.info("radio", `PTT through the sound card's HID GPIO on ${candidate}`);
        return;
      } catch {
        // Not ours, or no permission — keep looking.
      }
    }
    log.error("radio", "no writable /dev/hidraw* found — the dongle may not be a CM108/CM119.");
  }

  private write(on: boolean): void {
    if (FAKE_HARDWARE || this.fd === null) return;
    const report = Buffer.from([0x00, 0x00, on ? 0x04 : 0x00, 0x04, 0x00]);
    writeSync(this.fd, report, 0, report.length);
  }

  key(): Promise<void> {
    this.write(true);
    return Promise.resolve();
  }
  unkey(): Promise<void> {
    this.write(false);
    return Promise.resolve();
  }
  release(): Promise<void> {
    this.write(false);
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    return Promise.resolve();
  }
  verify(): Promise<{ ok: boolean; detail: string }> {
    if (FAKE_HARDWARE) return Promise.resolve({ ok: true, detail: "Simulated HID GPIO (development mode)." });
    return Promise.resolve(
      this.fd !== null
        ? { ok: true, detail: `Writing to ${this.path}. HID GPIO cannot be read back — confirm on the radio.` }
        : { ok: false, detail: "No writable hidraw device. Check the udev rule from scripts/install.sh." },
    );
  }
}

export function createPttBackend(config: GatewayConfig): PttBackend {
  switch (config.ptt.backend) {
    case "gpio":
      return new GpioBackend(config.ptt.gpioPin, config.ptt.activeLow);
    case "cm108":
      return new Cm108Backend();
    case "vox":
      return new NoopBackend(
        "vox",
        "The radio keys itself from the audio. Nothing to verify here — listen for the transmission.",
      );
    default:
      return new NoopBackend("none", "Keying is switched off: this box can receive but will not transmit.");
  }
}
