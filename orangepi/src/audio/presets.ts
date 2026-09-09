import { applyGain } from "./format";

/**
 * Processing presets for the outgoing audio, so they can be compared by ear on
 * a real radio instead of argued about from a spectrum plot.
 *
 * Every judgement that matters here — is it bassy, does VOX hold, is it
 * intelligible at the far end — is a judgement about a particular radio, a
 * particular VOX sensitivity and a particular pair of ears. Measuring told us
 * the source is bass-heavy and that a startup ramp was eating the first word;
 * it cannot tell us which of several reasonable filters sounds best coming out
 * of a handset in someone's hand.
 */

export type NormaliseMode = "rms" | "peak" | "none";

export interface AudioPreset {
  id: string;
  label: string;
  /** What this one is trying to be better at, in one line. */
  detail: string;
  /** ffmpeg -af chain, or null for none at all. */
  filter: string | null;
  normalise: NormaliseMode;
  /** Target for the chosen normalisation, 0-1. */
  target: number;
}

const BAND_GENTLE = "highpass=f=250,lowpass=f=3400";
const BAND_FIRM = "highpass=f=300:poles=2,highpass=f=300:poles=2,lowpass=f=3400";
const PRESENCE = "equalizer=f=2000:t=h:width=1400:g=6";
/**
 * Squashes the gap between the quiet and loud parts of speech. This is the one
 * most likely to keep VOX held open through a whole message, because VOX
 * responds to the moment-to-moment level and speech spends much of its time
 * far below its own peaks.
 */
const COMPRESS = "acompressor=threshold=0.08:ratio=4:attack=5:release=120:makeup=2";

export const PRESETS: AudioPreset[] = [
  {
    id: "raw",
    label: "1 · Untouched",
    detail: "No filtering at all, levelled only. The baseline everything else is judged against.",
    filter: null,
    normalise: "rms",
    target: 0.16,
  },
  {
    id: "gentle",
    label: "2 · Gentle band",
    detail: "One high-pass at 250 Hz. Takes the rumble off and nothing else.",
    filter: BAND_GENTLE,
    normalise: "rms",
    target: 0.16,
  },
  {
    id: "firm",
    label: "3 · Firm band",
    detail: "24 dB/octave from 300 Hz, no presence lift. Should sound thinner, not brighter.",
    filter: BAND_FIRM,
    normalise: "rms",
    target: 0.16,
  },
  {
    id: "presence",
    label: "4 · Band + presence",
    detail: "Firm band with 2 kHz lifted — what the box does today.",
    filter: `${BAND_FIRM},${PRESENCE}`,
    normalise: "rms",
    target: 0.16,
  },
  {
    id: "compressed",
    label: "5 · Band + presence + compression",
    detail: "As 4, but the loud and quiet parts evened out. Most likely to hold VOX open throughout.",
    filter: `${BAND_FIRM},${PRESENCE},${COMPRESS}`,
    normalise: "rms",
    target: 0.18,
  },
  {
    id: "loud",
    label: "6 · The same, louder",
    detail: "Preset 5 driven harder. Try when VOX drops mid-message; back off if it distorts.",
    filter: `${BAND_FIRM},${PRESENCE},${COMPRESS}`,
    normalise: "rms",
    target: 0.24,
  },
];

export function findPreset(id: string): AudioPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/**
 * Level a clip with one fixed gain, computed from the whole thing.
 *
 * By **average** energy, not peak. Peak normalisation was tried and made things
 * worse in a way that took a while to see: speech has a large gap between its
 * peaks and its average, so pinning the peak leaves the average far too low —
 * and VOX listens to the average, so it dropped out mid-message. Silent
 * stretches are excluded from the measurement, or a message with long pauses
 * would be driven into distortion to compensate for its own silence.
 */
export function normalise(pcm: Buffer, mode: NormaliseMode, target: number): Buffer {
  if (mode === "none") return pcm;

  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return pcm;

  let gain: number;
  if (mode === "peak") {
    let peak = 0;
    for (let i = 0; i < samples; i++) {
      const value = Math.abs(pcm.readInt16LE(i * 2));
      if (value > peak) peak = value;
    }
    if (peak === 0) return pcm;
    gain = (target * 32767) / peak;
  } else {
    const FLOOR = 0.02 * 32767;
    let energy = 0;
    let counted = 0;
    for (let i = 0; i < samples; i++) {
      const value = pcm.readInt16LE(i * 2);
      if (Math.abs(value) < FLOOR) continue;
      energy += value * value;
      counted++;
    }
    if (counted === 0) return pcm;
    const rms = Math.sqrt(energy / counted);
    gain = (target * 32767) / rms;
  }

  gain = Math.min(20, Math.max(0.1, gain));
  const scaled = applyGain(pcm, gain);

  // applyGain clamps, which on a heavily boosted clip means square-topped
  // peaks. Pull the whole thing down if that would have happened, rather than
  // transmitting something crunchy.
  let peakAfter = 0;
  for (let i = 0; i < samples; i++) {
    const value = Math.abs(scaled.readInt16LE(i * 2));
    if (value > peakAfter) peakAfter = value;
  }
  const CEILING = 0.92 * 32767;
  return peakAfter > CEILING ? applyGain(scaled, CEILING / peakAfter) : scaled;
}
