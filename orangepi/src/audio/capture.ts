import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { log } from "../logger";
import { FAKE_HARDWARE, sleep } from "../util";
import type { GatewayConfig } from "../config";
import { resolveDevice } from "./devices";
import {
  applyGain,
  BYTES_PER_SAMPLE,
  CHANNELS,
  FRAME_BYTES,
  SAMPLE_RATE,
  bytesToMs,
  frameLevel,
  msToBytes,
} from "./format";

/**
 * The receive side: one long-lived `arecord` reading the radio's speaker
 * output, chopped into 20 ms frames, with a software squelch on top.
 *
 * Why a software squelch rather than the radio's own COR line: the cable into
 * an X1p's accessory port carries audio, and that is all we can count on. The
 * two-threshold design (open high, close low) plus a hang time is the standard
 * fix for the two failure modes a single threshold has — chattering on and off
 * mid-sentence, and latching open on hiss.
 *
 * A pre-roll buffer means the transmission we hand upstream starts *before* the
 * threshold was crossed, so the first syllable is not lost. That is the single
 * biggest difference between "usable" and "what did they say?".
 */

export interface Transmission {
  pcm: Buffer;
  durationMs: number;
  peakLevel: number;
  startedAt: string;
}

export declare interface AudioCapture {
  on(event: "pcm", listener: (frame: Buffer) => void): this;
  on(event: "level", listener: (level: number, receiving: boolean) => void): this;
  on(event: "transmission", listener: (tx: Transmission) => void): this;
  on(event: "open", listener: () => void): this;
  on(event: "close", listener: () => void): this;
  on(event: string, listener: (...args: never[]) => void): this;
}

export class AudioCapture extends EventEmitter {
  private child: ChildProcess | null = null;
  private stopping = false;
  private device = "";

  /** Frame assembly across stdin chunk boundaries. */
  private pending: Buffer = Buffer.alloc(0);

  /** Rolling pre-roll kept while the squelch is closed. */
  private preroll: Buffer[] = [];
  private prerollBytes = 0;

  private open = false;
  private chunks: Buffer[] = [];
  private capturedBytes = 0;
  private peak = 0;
  private quietMs = 0;
  private startedAt = "";

  /** Set while the box is transmitting; the radio cannot receive then anyway. */
  private muted = false;

  private smoothedLevel = 0;

  constructor(private config: GatewayConfig) {
    super();
  }

  get currentDevice(): string {
    return this.device;
  }

  get level(): number {
    return this.smoothedLevel;
  }

  get receiving(): boolean {
    return this.open;
  }

  applyConfig(config: GatewayConfig): void {
    const deviceChanged = config.audio.capture !== this.config.audio.capture;
    this.config = config;
    if (deviceChanged) {
      log.info("audio", "capture device changed — restarting the recorder");
      void this.restart();
    }
  }

  /** Suppress the squelch while transmitting, and drop anything half-captured. */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (muted && this.open) this.abort();
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.device = await resolveDevice(this.config.audio.capture, "capture");
    this.spawnRecorder();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.child?.kill("SIGTERM");
    this.child = null;
  }

  async restart(): Promise<void> {
    await this.stop();
    await sleep(200);
    await this.start();
  }

  private spawnRecorder(): void {
    if (this.stopping) return;

    // On a laptop there is no sound card and no radio; feed the pipeline
    // silence so every layer above can be exercised without hardware.
    const [cmd, args] = FAKE_HARDWARE
      ? ["sh", ["-c", `while :; do dd if=/dev/zero bs=${FRAME_BYTES} count=1 2>/dev/null; sleep 0.02; done`]]
      : [
          "arecord",
          [
            "-D", this.device,
            "-f", "S16_LE",
            "-r", String(SAMPLE_RATE),
            "-c", String(CHANNELS),
            "-t", "raw",
            "-q",
          ],
        ];

    log.info("audio", `listening to the radio on ${this.device}`, { device: this.device });
    const child = spawn(cmd as string, args as string[], { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => this.ingest(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) log.warn("audio", `recorder: ${text}`);
    });
    child.on("error", (err) => {
      log.error("audio", `could not start the recorder: ${err.message}`);
    });
    child.on("close", (code) => {
      if (this.stopping) return;
      // ALSA drops the device when the USB card is unplugged and replugged;
      // reconnecting on a timer is what keeps a knocked cable from ending the
      // event's radio link.
      log.warn("audio", `recorder exited (${code ?? "signal"}) — retrying in 2s`);
      setTimeout(() => void this.restart(), 2000);
    });
  }

  private ingest(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    while (this.pending.length >= FRAME_BYTES) {
      const frame = this.pending.subarray(0, FRAME_BYTES);
      this.pending = this.pending.subarray(FRAME_BYTES);
      this.handleFrame(applyGain(frame, this.config.audio.inputGain));
    }
  }

  private handleFrame(frame: Buffer): void {
    // Raw frames are published for the console's live monitor. Emitted before
    // the squelch so a listener hears the channel exactly as the radio does,
    // hiss and all — a squelched monitor hides the very problems people open it
    // to diagnose.
    if (this.listenerCount("pcm") > 0) this.emit("pcm", frame);

    const level = frameLevel(frame);
    // Attack fast, decay slow — a meter that tracks every 20 ms frame is
    // unreadable, and one that decays fast looks broken during speech.
    this.smoothedLevel = level > this.smoothedLevel
      ? level
      : this.smoothedLevel * 0.85 + level * 0.15;
    this.emit("level", this.smoothedLevel, this.open);

    if (this.muted) return;
    const { openLevel, closeLevel, hangMs, maxDurationMs } = this.config.squelch;

    if (!this.open) {
      this.keepPreroll(frame);
      if (level < openLevel) return;
      this.open = true;
      this.startedAt = new Date().toISOString();
      this.chunks = [...this.preroll];
      this.capturedBytes = this.prerollBytes;
      this.peak = level;
      this.quietMs = 0;
      this.preroll = [];
      this.prerollBytes = 0;
      log.debug("radio", "squelch opened", { level: level.toFixed(3) });
      this.emit("open");
      return;
    }

    this.chunks.push(frame);
    this.capturedBytes += frame.length;
    if (level > this.peak) this.peak = level;
    this.quietMs = level < closeLevel ? this.quietMs + bytesToMs(frame.length) : 0;

    if (this.quietMs >= hangMs) {
      this.finish();
    } else if (bytesToMs(this.capturedBytes) >= maxDurationMs) {
      log.warn("radio", "transmission hit the length limit — closing it off");
      this.finish();
    }
  }

  private keepPreroll(frame: Buffer): void {
    const budget = msToBytes(Math.max(200, this.config.squelch.hangMs / 2));
    this.preroll.push(frame);
    this.prerollBytes += frame.length;
    while (this.prerollBytes > budget && this.preroll.length > 1) {
      this.prerollBytes -= this.preroll.shift()!.length;
    }
  }

  private finish(): void {
    const pcm = Buffer.concat(this.chunks);
    const hang = msToBytes(this.config.squelch.hangMs);
    // Trim the trailing silence the hang time deliberately captured.
    const trimmed = pcm.length > hang ? pcm.subarray(0, pcm.length - hang) : pcm;
    const durationMs = bytesToMs(trimmed.length);
    const peak = this.peak;
    const startedAt = this.startedAt;
    this.reset();
    this.emit("close");

    if (durationMs < this.config.squelch.minDurationMs) {
      log.debug("radio", `ignored a ${Math.round(durationMs)} ms blip`, { peak: peak.toFixed(3) });
      return;
    }
    log.info("radio", `received ${(durationMs / 1000).toFixed(1)}s from the radio`, {
      peak: peak.toFixed(2),
    });
    this.emit("transmission", {
      pcm: trimmed,
      durationMs,
      peakLevel: peak,
      startedAt,
    } satisfies Transmission);
  }

  private abort(): void {
    this.reset();
    this.emit("close");
  }

  private reset(): void {
    this.open = false;
    this.chunks = [];
    this.capturedBytes = 0;
    this.peak = 0;
    this.quietMs = 0;
    this.preroll = [];
    this.prerollBytes = 0;
  }
}

export { BYTES_PER_SAMPLE };
