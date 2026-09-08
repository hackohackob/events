/**
 * One PCM format everywhere inside the box: 16 kHz, mono, signed 16-bit LE.
 *
 * It is what a radio channel actually carries (3 kHz of audio), what the
 * platform's Opus profile uses, and what the speech-to-text on the server
 * wants — so nothing is resampled between the microphone jack and the chat log.
 */
export const SAMPLE_RATE = 16_000;
export const CHANNELS = 1;
export const BYTES_PER_SAMPLE = 2;

/** 20 ms — the granularity of every level meter and squelch decision. */
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
export const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE;

export function bytesToMs(bytes: number): number {
  return (bytes / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000;
}

export function msToBytes(ms: number): number {
  const bytes = Math.round((ms / 1000) * SAMPLE_RATE) * BYTES_PER_SAMPLE;
  return bytes - (bytes % BYTES_PER_SAMPLE);
}

/** RMS of one frame, normalised to 0–1. */
export function frameLevel(frame: Buffer): number {
  let sum = 0;
  const samples = Math.floor(frame.length / BYTES_PER_SAMPLE);
  if (samples === 0) return 0;
  for (let i = 0; i < samples; i++) {
    const s = frame.readInt16LE(i * BYTES_PER_SAMPLE);
    sum += s * s;
  }
  return Math.min(1, Math.sqrt(sum / samples) / 32768);
}

/** Scale a PCM buffer in place-ish, clipping rather than wrapping. */
export function applyGain(pcm: Buffer, gain: number): Buffer {
  if (gain === 1) return pcm;
  const out: Buffer = Buffer.allocUnsafe(pcm.length - (pcm.length % BYTES_PER_SAMPLE));
  for (let i = 0; i < out.length; i += BYTES_PER_SAMPLE) {
    const scaled = Math.round(pcm.readInt16LE(i) * gain);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, scaled)), i);
  }
  return out;
}
