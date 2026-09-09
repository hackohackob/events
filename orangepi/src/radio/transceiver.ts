import { EventEmitter } from "node:events";
import { log } from "../logger";
import { sleep } from "../util";
import type { GatewayConfig } from "../config";
import { AudioCapture, type Transmission } from "../audio/capture";
import { AudioPlayback } from "../audio/playback";
import { testTonePcm } from "../audio/codec";
import { SAMPLE_RATE, bytesToMs, msToBytes } from "../audio/format";
import { createPttBackend, type PttBackend } from "./ptt";
import type { AudioState } from "../types";

/**
 * The half-duplex radio itself: one channel, one thing at a time.
 *
 * Everything that wants to transmit goes through `enqueue`, and the queue is
 * drained one item at a time with the channel's etiquette applied around each:
 * wait for the channel to go quiet, key up, let the transmitter settle, play,
 * hold the tail, unkey. Doing this anywhere else would eventually key the radio
 * while it was receiving, which on a shared talkgroup means talking over a
 * medic mid-sentence.
 */

export interface TxJob {
  id: string;
  /** What to say — the caller has already turned it into the box's PCM. */
  pcm: Buffer;
  /** Shown in the console and reported back to the server. */
  label: string;
  party?: string;
  text?: string;
  /** Console tests should not be logged as event traffic. */
  local?: boolean;
}

export interface TxResult {
  job: TxJob;
  durationMs: number;
  ok: boolean;
  detail?: string;
}

export declare interface Transceiver {
  on(event: "transmission", listener: (tx: Transmission) => void): this;
  on(event: "transmitted", listener: (result: TxResult) => void): this;
  on(event: "tone", listener: (kind: "open" | "close") => void): this;
  on(event: "state", listener: () => void): this;
  on(event: string, listener: (...args: never[]) => void): this;
}

export class Transceiver extends EventEmitter {
  readonly capture: AudioCapture;
  readonly playback: AudioPlayback;

  private ptt: PttBackend;
  private queue: TxJob[] = [];
  private draining = false;
  private transmitting = false;
  private abort: AbortController | null = null;
  private pttError: string | undefined;
  /** Set while a live console PTT session holds the transmitter open. */
  private liveSession: { abort: AbortController; startedAt: number } | null = null;

  constructor(private config: GatewayConfig) {
    super();
    this.capture = new AudioCapture(config);
    this.playback = new AudioPlayback(config);
    this.ptt = createPttBackend(config);

    this.capture.on("transmission", (tx) => this.emit("transmission", tx));
    // Surfaced so the console can mark the beeps on its scope, which is how an
    // operator can see at a glance whether tone detection is actually firing.
    this.capture.on("tone", (kind: "open" | "close") => this.emit("tone", kind));
    this.capture.on("open", () => this.emit("state"));
    this.capture.on("close", () => this.emit("state"));
  }

  async start(): Promise<void> {
    await this.ptt.init();
    await this.playback.prepare();
    await this.capture.start();
    log.info("radio", "transceiver ready", { keying: this.config.ptt.backend });
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    await this.capture.stop();
    await this.ptt.release();
  }

  /** Re-read settings; a changed keying backend is re-initialised in place. */
  async applyConfig(config: GatewayConfig): Promise<void> {
    const keyingChanged =
      config.ptt.backend !== this.config.ptt.backend ||
      config.ptt.gpioPin !== this.config.ptt.gpioPin ||
      config.ptt.activeLow !== this.config.ptt.activeLow;
    this.config = config;
    this.capture.applyConfig(config);
    this.playback.applyConfig(config);
    if (keyingChanged) {
      await this.ptt.release().catch(() => undefined);
      this.ptt = createPttBackend(config);
      await this.ptt.init();
      this.pttError = undefined;
      log.info("radio", `keying method changed to ${config.ptt.backend}`);
    }
    this.emit("state");
  }

  // ── Transmit ───────────────────────────────────────────────────────────────

  enqueue(job: TxJob): number {
    this.queue.push(job);
    log.info("radio", `queued for transmission: ${job.label}`, { queued: this.queue.length });
    this.emit("state");
    void this.drain();
    return this.queue.length;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get isTransmitting(): boolean {
    return this.transmitting;
  }

  /** Cut the current transmission short and drop anything waiting. */
  cancelAll(): void {
    this.queue = [];
    this.abort?.abort();
    this.liveSession?.abort.abort();
    this.emit("state");
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!;
        this.emit("state");
        const result = await this.transmit(job);
        this.emit("transmitted", result);
      }
    } finally {
      this.draining = false;
      this.emit("state");
    }
  }

  /**
   * One keyed transmission, start to finish.
   *
   * The order matters and is the part that is easy to get subtly wrong:
   * mute the receiver first (so the box does not record its own audio as an
   * incoming call), key, wait `leadMs` for the transmitter and any repeater to
   * come up, play, wait `tailMs` so the last word is not cut off by the drop,
   * then unkey and unmute.
   */
  private async transmit(job: TxJob): Promise<TxResult> {
    const started = Date.now();
    await this.waitForClearChannel();

    const abort = new AbortController();
    this.abort = abort;
    this.transmitting = true;
    this.capture.setMuted(true);
    this.emit("state");

    const timeout = setTimeout(() => {
      log.warn("radio", "transmission hit the safety timeout — unkeying");
      abort.abort();
    }, this.config.ptt.maxTxMs);

    try {
      await this.ptt.key();
      this.pttError = undefined;

      // VOX has nothing to key it during the lead-in, so the lead is a tone
      // rather than silence: it opens the radio's VOX gate before the first
      // word instead of the first word being what opens it.
      //
      // The tone and the message are played as ONE buffer, deliberately.
      // Playing them as two calls spawned two `aplay` processes, and the gap
      // between the first exiting and the second opening the sound card was
      // long enough for VOX to drop again — which took the first word or two
      // with it, however loud or long the tone was made. Continuous audio from
      // the tone straight into the speech is what actually fixes it.
      const vox = this.config.ptt.backend === "vox";
      const payload = vox
        ? Buffer.concat([
            voxWakeTone(
              this.config.ptt.leadMs,
              this.config.ptt.voxToneHz,
              this.config.ptt.voxToneLevel,
            ),
            job.pcm,
          ])
        : job.pcm;
      // A wired key is already down; only VOX needs the lead-in to be audible.
      if (!vox) await sleep(this.config.ptt.leadMs);

      await this.playback.play(payload, abort.signal);
      await sleep(this.config.ptt.tailMs);

      // The wake tone is not part of the message, so it is not counted.
      const durationMs = bytesToMs(job.pcm.length);
      log.info("radio", `transmitted ${(durationMs / 1000).toFixed(1)}s — ${job.label}`);
      return { job, durationMs, ok: !abort.signal.aborted };
    } catch (err) {
      this.pttError = (err as Error).message;
      log.error("radio", `could not transmit: ${this.pttError}`);
      return { job, durationMs: Date.now() - started, ok: false, detail: this.pttError };
    } finally {
      clearTimeout(timeout);
      await this.ptt.unkey().catch((err: Error) => {
        // A stuck transmitter is the worst failure on a shared channel, so this
        // is the one thing worth shouting about.
        this.pttError = err.message;
        log.error("radio", `FAILED TO UNKEY: ${err.message}`);
      });
      this.transmitting = false;
      this.abort = null;
      // The radio's own squelch tail would otherwise be recorded as an
      // incoming transmission the instant we stop. The deaf window covers the
      // key-down tone that follows a beat later, past the point where the
      // receiver has already been unmuted.
      this.capture.deafFor(400 + Math.max(0, this.config.rogerBeep?.holdOffMs ?? 0));
      setTimeout(() => this.capture.setMuted(false), 400);
      this.emit("state");
    }
  }

  /**
   * Hold off while someone else is talking. Gives up after the configured wait
   * and transmits anyway — a channel that is busy for ten seconds straight is
   * more likely a stuck squelch than a long call, and the message still matters.
   */
  private async waitForClearChannel(): Promise<void> {
    // Deliberately `carryingSpeech` and not `receiving`. The gate opens for the
    // radio's own talk-permit and roger tones, which arrive on the receive path
    // every time the box keys up; waiting for those would have the box politely
    // deferring to itself before every transmission.
    const deadline = Date.now() + this.config.ptt.waitForClearMs;
    if (!this.capture.carryingSpeech) return;
    log.debug("radio", "somebody is talking — waiting for the channel to clear");
    while (this.capture.carryingSpeech && Date.now() < deadline) {
      await sleep(120);
    }
    if (this.capture.carryingSpeech) {
      log.warn("radio", "channel still busy after the wait — transmitting anyway");
    }
  }

  // ── Live console PTT ───────────────────────────────────────────────────────

  /**
   * Hold the transmitter open for the console's push-to-talk button, feeding it
   * audio as the phone streams it in. Separate from the queue because it is
   * interactive: the operator is holding a button and expects the radio to be
   * keyed *now*, not after the queue drains.
   */
  async openLiveSession(): Promise<{ ok: boolean; detail?: string }> {
    if (this.liveSession) return { ok: true };
    if (this.transmitting) return { ok: false, detail: "The radio is already transmitting." };
    const abort = new AbortController();
    this.liveSession = { abort, startedAt: Date.now() };
    this.transmitting = true;
    this.capture.setMuted(true);
    this.emit("state");
    try {
      await this.ptt.key();
      await sleep(this.config.ptt.leadMs);
      log.info("radio", "console push-to-talk: keyed");
      return { ok: true };
    } catch (err) {
      await this.closeLiveSession();
      return { ok: false, detail: (err as Error).message };
    }
  }

  async pushLive(pcm: Buffer): Promise<void> {
    const session = this.liveSession;
    if (!session) return;
    if (Date.now() - session.startedAt > this.config.ptt.maxTxMs) {
      log.warn("radio", "console push-to-talk hit the safety timeout");
      await this.closeLiveSession();
      return;
    }
    await this.playback.play(pcm, session.abort.signal);
  }

  async closeLiveSession(): Promise<number> {
    const session = this.liveSession;
    if (!session) return 0;
    this.liveSession = null;
    await sleep(this.config.ptt.tailMs);
    await this.ptt.unkey().catch((err: Error) => log.error("radio", `FAILED TO UNKEY: ${err.message}`));
    this.transmitting = false;
    this.capture.deafFor(400 + Math.max(0, this.config.rogerBeep?.holdOffMs ?? 0));
    setTimeout(() => this.capture.setMuted(false), 400);
    this.emit("state");
    const durationMs = Date.now() - session.startedAt;
    log.info("radio", `console push-to-talk: unkeyed after ${(durationMs / 1000).toFixed(1)}s`);
    return durationMs;
  }

  get liveActive(): boolean {
    return this.liveSession !== null;
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────

  /** Key the line, read it back where possible, and say what happened. */
  verifyKeying(): Promise<{ ok: boolean; detail: string }> {
    return this.ptt.verify();
  }

  /**
   * Play just the VOX wake tone, with nothing behind it.
   *
   * Tuning the tone against a real radio means changing a number, listening,
   * and changing it again; sending a whole spoken message each time makes that
   * loop slow and clogs the channel. This sends the tone alone.
   */
  transmitWakeToneOnly(): void {
    this.enqueue({
      id: `waketone-${Date.now()}`,
      // The lead-in is prepended by `transmit` for VOX, so the job itself only
      // needs a moment of silence to hang the tone on.
      pcm: Buffer.alloc(msToBytes(150)),
      label: "wake tone only",
      local: true,
    });
  }

  /** Put a test chirp on the air so the cabling can be confirmed by ear. */
  transmitTestTone(): void {
    this.enqueue({
      id: `test-${Date.now()}`,
      pcm: testTonePcm(),
      label: "test tone",
      local: true,
    });
  }

  state(): AudioState {
    return {
      captureDevice: this.capture.currentDevice,
      playbackDevice: this.playback.currentDevice,
      rxLevel: Number(this.capture.level.toFixed(3)),
      txLevel: Number(this.playback.level.toFixed(3)),
      receiving: this.capture.receiving,
      transmitting: this.transmitting,
      pttBackend: this.config.ptt.backend,
      pttError: this.pttError,
    };
  }
}

/**
 * A low, mostly sub-speech tone used only to trip a radio's VOX before the real
 * audio starts. Quiet enough not to be annoying, long enough to beat the VOX
 * attack time.
 */
function voxWakeTone(durationMs: number, hz: number, level: number): Buffer {
  const samples = Math.max(1, Math.round((Math.max(200, durationMs) / 1000) * SAMPLE_RATE));
  const pcm = Buffer.alloc(samples * 2);

  // 480 Hz: enough energy for a VOX detector without being piercing to sit
  // beside. A box that is unpleasant to be near gets turned down or unplugged.
  const HZ = hz > 0 ? hz : 480;
  const LEVEL = Math.min(1, Math.max(0, level));
  const ATTACK_MS = 40;
  const RELEASE_MS = 50;

  const attack = (ATTACK_MS / 1000) * SAMPLE_RATE;
  const release = (RELEASE_MS / 1000) * SAMPLE_RATE;

  for (let i = 0; i < samples; i++) {
    // Held at one steady level rather than peaking and decaying.
    //
    // The decaying version was an attempt to be easier on the ear: hit hard to
    // trigger VOX, then fall back to a murmur to hold it. It did not hold it.
    // At a low VOX sensitivity the quiet tail sat under the threshold, so the
    // gate opened on the onset, relaxed through the tail, and had to be
    // re-triggered by the speech itself — taking the first word with it. The
    // level that keeps VOX open is the level it has to stay at.
    let amplitude = LEVEL;
    if (i < attack) amplitude *= i / attack;
    const remaining = samples - i;
    // Fade out at the very end so the handover to speech does not click.
    if (remaining < release) amplitude *= remaining / release;

    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * HZ * i) / SAMPLE_RATE) * amplitude * 32767), i * 2);
  }
  return pcm;
}



export { msToBytes };
