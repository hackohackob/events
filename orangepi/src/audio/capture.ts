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

/**
 * How much audio to keep after the last sound, so a trailing consonant is not
 * clipped. Short enough that nobody perceives it as dead air.
 */
const TAIL_KEEP_MS = 180;

/**
 * Audio kept from before the squelch opened, so the first syllable — the one
 * that crossed the threshold — is not clipped off.
 */
const PREROLL_MS = 400;

/**
 * A tone found within this much of the start is treated as the radio's opening
 * beep rather than an end-of-transmission one: closing on it would discard the
 * call that is only just beginning.
 */
const OPENING_TONE_WINDOW_MS = 700;

/**
 * Corner frequency of the capture-path high-pass.
 *
 * A handset's speaker output carries a lot of energy below the voice band — DC
 * offset from the sound card's mic bias, mains hum, and the low-frequency
 * rumble that makes an overdriven radio sound boomy. Filtering it only at
 * encode time was too late: `frameLevel` measures RMS, so all that energy was
 * inflating the level the squelch thresholds are compared against, which is
 * why the thresholds behaved unpredictably as the radio's volume changed.
 * Filtering here means the level actually tracks speech.
 */
const HIGHPASS_HZ = 250;

/**
 * Goertzel: the energy at one frequency in one frame, normalised by the frame's
 * own RMS so the result is "how much of this frame is that tone", 0-1,
 * independent of how loud the transmission is.
 *
 * A whole DFT would be wasted here — only one frequency is ever of interest,
 * and this is a handful of multiply-adds per sample.
 */
function toneRatio(frame: Buffer, frequencyHz: number): number {
  const samples = Math.floor(frame.length / 2);
  if (samples === 0) return 0;

  const k = 2 * Math.cos((2 * Math.PI * frequencyHz) / SAMPLE_RATE);
  let s1 = 0;
  let s2 = 0;
  let energy = 0;
  for (let i = 0; i < samples; i++) {
    const x = frame.readInt16LE(i * 2);
    const s0 = x + k * s1 - s2;
    s2 = s1;
    s1 = s0;
    energy += x * x;
  }
  const rms = Math.sqrt(energy / samples);
  // Silence has no meaningful ratio; anything this quiet is not a beep.
  if (rms < 50) return 0;
  const magnitude = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / samples;
  return magnitude / rms;
}

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

  /** One-pole high-pass state, carried across frames. */
  private hpPrevIn = 0;
  private hpPrevOut = 0;

  /** Consecutive frames currently matching the end-of-transmission tone. */
  private toneFrames = 0;
  /** How many chunks were captured when the current tone run began. */
  private toneRunStart = 0;

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
      this.handleFrame(this.highPass(applyGain(frame, this.config.audio.inputGain)));
    }
  }

  /**
   * A one-pole high-pass, cheap enough to run on every sample on this board.
   * `y[n] = a * (y[n-1] + x[n] - x[n-1])`, the standard RC form.
   */
  private highPass(frame: Buffer): Buffer {
    const dt = 1 / SAMPLE_RATE;
    const rc = 1 / (2 * Math.PI * HIGHPASS_HZ);
    const a = rc / (rc + dt);
    const out: Buffer = Buffer.allocUnsafe(frame.length - (frame.length % 2));

    for (let i = 0; i < out.length; i += 2) {
      const x = frame.readInt16LE(i);
      const y = a * (this.hpPrevOut + x - this.hpPrevIn);
      this.hpPrevIn = x;
      this.hpPrevOut = y;
      const rounded = Math.round(y);
      out.writeInt16LE(rounded > 32767 ? 32767 : rounded < -32768 ? -32768 : rounded, i);
    }
    return out;
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

    // The radio's end-of-transmission tone is the authoritative "they let go of
    // the button" signal. Silence is not: a speaker pausing for breath looks
    // identical to the end of a call, which is what chops one transmission into
    // several. When the tone arrives, close on it and cut it off the recording.
    const beep = this.config.rogerBeep;
    if (beep?.enabled) {
      const ratio = toneRatio(frame, beep.frequencyHz);
      if (ratio >= beep.minRatio && level >= closeLevel) {
        if (this.toneFrames === 0) this.toneRunStart = this.chunks.length - 1;
        this.toneFrames++;
        if (this.toneFrames >= beep.minFrames) {
          // Drop the tone itself, and the frame before it where it faded in.
          const beforeTone = bytesToMs(this.capturedBytes) - bytesToMs(this.toneFrames * frame.length);
          this.chunks.length = Math.max(0, this.toneRunStart - 1);
          this.capturedBytes = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
          this.toneFrames = 0;

          // A tone at the very start of a transmission is the radio opening,
          // not closing. Closing on it would throw away the call that is about
          // to happen, so cut the beep and keep listening.
          if (beforeTone < OPENING_TONE_WINDOW_MS) {
            log.debug("radio", "opening tone — trimmed, still listening");
            this.quietMs = 0;
            return;
          }
          log.debug("radio", "end-of-transmission tone detected", { ratio: ratio.toFixed(2) });
          this.finish({ closedByTone: true });
          return;
        }
      } else {
        this.toneFrames = 0;
      }
    }

    // Silence is the fallback, and is given a longer leash when the tone is
    // doing the real work.
    const silenceLimit = beep?.enabled ? Math.max(hangMs, beep.fallbackHangMs) : hangMs;
    if (this.quietMs >= silenceLimit) {
      this.finish();
    } else if (bytesToMs(this.capturedBytes) >= maxDurationMs) {
      log.warn("radio", "transmission hit the length limit — closing it off");
      this.finish();
    }
  }

  private keepPreroll(frame: Buffer): void {
    // A fixed budget, not a fraction of the hang time. Deriving it from hangMs
    // meant raising the hang time to sit through pauses also pushed a second of
    // silence onto the front of every recording — 2.4 s of hang produced a
    // 1.2 s lead-in. All this needs to do is catch the syllable that crossed
    // the threshold.
    const budget = msToBytes(PREROLL_MS);
    this.preroll.push(frame);
    this.prerollBytes += frame.length;
    while (this.prerollBytes > budget && this.preroll.length > 1) {
      this.prerollBytes -= this.preroll.shift()!.length;
    }
  }

  private finish(opts: { closedByTone?: boolean } = {}): void {
    const pcm = Buffer.concat(this.chunks);
    // A tone-closed transmission has already had its dead air removed with the
    // beep; trimming again would eat the final word.
    const trimmed = opts.closedByTone ? pcm : this.trimTrailingSilence(pcm);
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
      ended: opts.closedByTone ? "roger beep" : "silence",
    });
    this.emit("transmission", {
      pcm: trimmed,
      durationMs,
      peakLevel: peak,
      startedAt,
    } satisfies Transmission);
  }

  /**
   * Cut the dead air off the end of a transmission.
   *
   * The hang time deliberately keeps recording through pauses so a breath does
   * not split one call into two, which means every clip ends with roughly
   * `hangMs` of nothing. Subtracting `hangMs` blindly is not enough: the gate
   * only closes once the level has been *below* `closeLevel` for that long, so
   * quiet-but-not-silent tails — squelch hiss, a radio's own noise floor — sail
   * through and are still there at the end.
   *
   * So find where audio actually stopped and cut there, keeping a short tail so
   * the last word is not clipped.
   */
  private trimTrailingSilence(pcm: Buffer): Buffer {
    const tail = msToBytes(TAIL_KEEP_MS);
    const { closeLevel } = this.config.squelch;

    for (let end = pcm.length - FRAME_BYTES; end >= 0; end -= FRAME_BYTES) {
      if (frameLevel(pcm.subarray(end, end + FRAME_BYTES)) >= closeLevel) {
        const cut = Math.min(pcm.length, end + FRAME_BYTES + tail);
        return pcm.subarray(0, cut);
      }
    }
    // Nothing anywhere reached the closing threshold — the caller's duration
    // check will drop it as a blip.
    return pcm.subarray(0, Math.min(pcm.length, tail));
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
    this.toneFrames = 0;
    this.toneRunStart = 0;
    this.preroll = [];
    this.prerollBytes = 0;
  }
}

export { BYTES_PER_SAMPLE };
