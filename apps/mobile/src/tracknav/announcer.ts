/**
 * Voice + haptic announcement engine for track-following navigation.
 *
 * English announcements via on-device TTS (expo-speech, offline-capable).
 * Two speed-aware tiers per maneuver — an early heads-up ("In 400 meters,
 * turn left") and a "now" cue ("Turn left" + haptic) — each spoken at most
 * once, with a minimum gap between utterances so instructions never overlap.
 * Urgent cues cut off whatever is currently being spoken.
 */
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import type { TrackInstruction } from "./turn-detection";
import type { ManeuverKind } from "../navigation/types";

/** Minimal instruction shape the announcer needs — satisfied both by track
 *  instructions and by GraphHopper route instructions (regular navigation). */
export interface SpokenInstruction {
  maneuver: ManeuverKind;
  text: string;
}

const LANGUAGE = "en-US";
const MIN_GAP_MS = 4_000;
// Tier thresholds scale with speed but stay within these bounds (metres).
const EARLY_SECONDS = 30;
const EARLY_MIN_M = 150;
const EARLY_MAX_M = 600;
const NEAR_SECONDS = 8;
const NEAR_MIN_M = 40;
const NEAR_MAX_M = 120;
const ARRIVE_WITHIN_M = 20;
// Walking pace fallback while speed is still unknown.
const DEFAULT_SPEED_MPS = 1.4;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** "In 400 meters" — spoken distances round to something a human can use. */
function spokenDistance(meters: number): string {
  if (meters >= 950) return `${(Math.round(meters / 100) / 10).toFixed(1)} kilometers`;
  return `${Math.max(50, Math.round(meters / 50) * 50)} meters`;
}

export interface Announcer {
  /** Session opener: "<verb> <label>, 12.4 kilometers." (verb defaults to "Following"). */
  start(label: string, totalMeters: number, verb?: string): void;
  /** Per-fix tick — decides whether an early / now / arrive cue is due. */
  onProgress(input: {
    toManeuverMeters: number;
    instructionIndex: number;
    instructions: SpokenInstruction[];
    remainingMeters: number;
    speedMps: number | null;
    atMs: number;
  }): void;
  offTrack(distanceBackMeters: number): void;
  backOnTrack(): void;
  loopSkipped(jumpMeters: number): void;
  /** The matcher switched legs (out-and-back direction correction). */
  directionCorrected(): void;
  /** A fresh route was computed mid-navigation: forget one-shot cues + announce. */
  rerouted(): void;
  paused(): void;
  resumed(): void;
  /** After a loop-skip jump: forget cues behind the new position, re-arm ahead. */
  rearmAfterJump(newAlong: number, instructions: TrackInstruction[]): void;
  setMuted(muted: boolean): void;
  /** Stop speaking and drop all one-shot state (session over). */
  reset(): void;
}

export function createAnnouncer(): Announcer {
  let muted = false;
  let lastSpokeAt = 0;
  /** One-shot flags: "<instructionIndex>:early" / "<instructionIndex>:near". */
  let announced = new Set<string>();
  let announcedArrive = false;
  let announcedOffTrack = false;

  const speak = (text: string, opts?: { urgent?: boolean; atMs?: number }) => {
    if (muted) return;
    const now = opts?.atMs ?? Date.now();
    if (!opts?.urgent && now - lastSpokeAt < MIN_GAP_MS) return;
    if (opts?.urgent) Speech.stop();
    lastSpokeAt = now;
    Speech.speak(text, { language: LANGUAGE });
  };

  return {
    start(label, totalMeters, verb = "Following") {
      announced = new Set();
      announcedArrive = false;
      announcedOffTrack = false;
      speak(`${verb} ${label}, ${spokenDistance(totalMeters)}.`, { urgent: true });
    },

    onProgress({ toManeuverMeters, instructionIndex, instructions, remainingMeters, speedMps, atMs }) {
      const instruction = instructions[instructionIndex];
      if (!instruction) return;

      if (instruction.maneuver === "arrive") {
        if (!announcedArrive && remainingMeters <= ARRIVE_WITHIN_M) {
          announcedArrive = true;
          speak(instruction.text, { urgent: true, atMs });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        return;
      }

      const speed = speedMps && speedMps > 0.5 ? speedMps : DEFAULT_SPEED_MPS;
      const earlyM = clamp(speed * EARLY_SECONDS, EARLY_MIN_M, EARLY_MAX_M);
      const nearM = clamp(speed * NEAR_SECONDS, NEAR_MIN_M, NEAR_MAX_M);
      const nearKey = `${instructionIndex}:near`;
      const earlyKey = `${instructionIndex}:early`;

      if (toManeuverMeters <= nearM && !announced.has(nearKey)) {
        announced.add(nearKey);
        announced.add(earlyKey); // an early cue after the "now" cue would be nonsense
        speak(instruction.text, { urgent: true, atMs });
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } else if (toManeuverMeters <= earlyM && toManeuverMeters > nearM && !announced.has(earlyKey)) {
        announced.add(earlyKey);
        speak(`In ${spokenDistance(toManeuverMeters)}, ${instruction.text.toLowerCase()}.`, { atMs });
      }
    },

    offTrack(distanceBackMeters) {
      if (announcedOffTrack) return;
      announcedOffTrack = true;
      speak(`Off track. The route is ${spokenDistance(distanceBackMeters)} away.`, { urgent: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },

    backOnTrack() {
      if (!announcedOffTrack) return;
      announcedOffTrack = false;
      speak("Back on track.", { urgent: true });
    },

    loopSkipped(jumpMeters) {
      announcedOffTrack = false;
      speak(`Loop skipped. Continuing ${spokenDistance(jumpMeters)} ahead.`, { urgent: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },

    directionCorrected() {
      announcedOffTrack = false;
      speak("Direction updated. Following the track from here.", { urgent: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },

    rerouted() {
      // Instruction indexes refer to the new route now — drop stale one-shots.
      announced = new Set();
      announcedArrive = false;
      announcedOffTrack = false;
      speak("Route recalculated.", { urgent: true });
    },

    paused() {
      speak("Guidance paused.", { urgent: true });
    },

    resumed() {
      speak("Guidance resumed.", { urgent: true });
    },

    rearmAfterJump(newAlong, instructions) {
      const next = new Set<string>();
      instructions.forEach((inst, i) => {
        if (inst.alongMeters <= newAlong) {
          next.add(`${i}:early`);
          next.add(`${i}:near`);
        }
      });
      announced = next;
    },

    setMuted(value) {
      muted = value;
      if (value) Speech.stop();
    },

    reset() {
      Speech.stop();
      announced = new Set();
      announcedArrive = false;
      announcedOffTrack = false;
      lastSpokeAt = 0;
    },
  };
}
