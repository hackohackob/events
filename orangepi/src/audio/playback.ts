import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { log } from "../logger";
import { FAKE_HARDWARE } from "../util";
import type { GatewayConfig } from "../config";
import { resolveDevice } from "./devices";
import { applyGain, CHANNELS, FRAME_BYTES, SAMPLE_RATE, bytesToMs, frameLevel } from "./format";

/**
 * The transmit side: push PCM into the radio's mic input through `aplay`.
 *
 * A player is spawned per transmission rather than kept open, because a
 * long-lived `aplay` on an idle stream is what makes some USB codecs emit a
 * carrier hum straight into a keyed transmitter. Opening it only while keyed
 * also means the sound card is free for the console's own test tones.
 */
export class AudioPlayback extends EventEmitter {
  private device = "";
  private playing = false;
  private currentLevel = 0;

  constructor(private config: GatewayConfig) {
    super();
  }

  get level(): number {
    return this.currentLevel;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentDevice(): string {
    return this.device;
  }

  async prepare(): Promise<void> {
    this.device = await resolveDevice(this.config.audio.playback, "playback");
    log.info("audio", `radio microphone input is ${this.device}`, { device: this.device });
  }

  applyConfig(config: GatewayConfig): void {
    const changed = config.audio.playback !== this.config.audio.playback;
    this.config = config;
    if (changed) void this.prepare();
  }

  /**
   * Play a PCM buffer, resolving when the last sample has left the card.
   * `abort` lets the caller cut a transmission short — the transmit timeout and
   * the console's stop button both use it.
   */
  play(pcm: Buffer, abort?: AbortSignal): Promise<void> {
    if (!pcm.length) return Promise.resolve();
    const scaled = applyGain(pcm, this.config.audio.outputGain);

    return new Promise((resolve) => {
      const [cmd, args] = FAKE_HARDWARE
        ? ["cat", []]
        : [
            "aplay",
            ["-D", this.device, "-f", "S16_LE", "-r", String(SAMPLE_RATE), "-c", String(CHANNELS), "-t", "raw", "-q"],
          ];

      const child = spawn(cmd as string, args as string[], { stdio: ["pipe", "ignore", "pipe"] });
      this.playing = true;
      let index = 0;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.playing = false;
        this.currentLevel = 0;
        clearInterval(meter);
        abort?.removeEventListener("abort", onAbort);
        this.emit("level", 0);
        resolve();
      };

      // The meter walks the buffer at wall-clock speed, which is what aplay is
      // doing with it — close enough for a level display and free of any need
      // to read back from ALSA.
      const startedAt = Date.now();
      const meter = setInterval(() => {
        const at = Math.floor((Date.now() - startedAt) / 1000 * SAMPLE_RATE) * 2;
        const frame = scaled.subarray(at, at + FRAME_BYTES);
        this.currentLevel = frame.length ? frameLevel(frame) : 0;
        this.emit("level", this.currentLevel);
      }, 60);

      const onAbort = (): void => {
        child.kill("SIGKILL");
        finish();
      };
      abort?.addEventListener("abort", onAbort, { once: true });

      child.stderr?.on("data", (d: Buffer) => {
        const text = d.toString().trim();
        if (text) log.warn("audio", `player: ${text}`);
      });
      child.on("error", (err) => {
        log.error("audio", `could not play to the radio: ${err.message}`);
        finish();
      });
      child.on("close", finish);

      // Write in chunks so a large file does not sit in one giant pipe buffer,
      // which is what makes an abort take seconds to actually stop the audio.
      const pump = (): void => {
        while (index < scaled.length) {
          const slice = scaled.subarray(index, index + FRAME_BYTES * 25);
          index += slice.length;
          if (!child.stdin!.write(slice)) {
            child.stdin!.once("drain", pump);
            return;
          }
        }
        child.stdin!.end();
      };
      child.stdin!.on("error", () => finish());
      pump();

      log.debug("audio", `playing ${(bytesToMs(scaled.length) / 1000).toFixed(1)}s to the radio`);
    });
  }
}
