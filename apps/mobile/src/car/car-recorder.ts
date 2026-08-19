/**
 * Imperative voice-message recorder for the Android Auto screen.
 *
 * The phone's chat screen records through `useAudioRecorder`, which only exists
 * inside a mounted component. The car app has no React tree at all — and on a
 * headless start (Android Auto connected while the app was swiped away) there
 * isn't even a surface — so the car needs a recorder it can drive from plain
 * module code.
 *
 * expo-audio's own hook does exactly this internally: build platform options,
 * then `new AudioModule.AudioRecorder(options)`. That path is reproduced here
 * rather than deep-copying the hook, and every step is guarded: if the private
 * module shape ever changes under an SDK bump, recording reports itself as
 * unavailable and the rest of the car app is unaffected.
 *
 * Audio routing is deliberately untouched — this records through the phone's
 * normal input (a paired helmet headset when there is one), exactly like the
 * chat screen does.
 */
import { Platform } from "react-native";
import { RecordingPresets, requestRecordingPermissionsAsync, type RecordingOptions } from "expo-audio";
import { uploadEventVoice } from "../chat/event-chat-api";
import { debugLog } from "../debug/debug-log";

/** Minimal shape we rely on — see expo-audio's `AudioRecorder`. */
interface ImperativeRecorder {
  isRecording: boolean;
  uri: string | null;
  prepareToRecordAsync: (options?: unknown) => Promise<unknown>;
  record: () => void;
  stop: () => Promise<void>;
  release?: () => void;
}

interface AudioModuleShape {
  AudioRecorder: new (options: Record<string, unknown>) => ImperativeRecorder;
}

/** Mirrors expo-audio's internal `createRecordingOptions`. */
function platformOptions(options: RecordingOptions): Record<string, unknown> {
  const common = {
    extension: options.extension,
    sampleRate: options.sampleRate,
    numberOfChannels: options.numberOfChannels,
    bitRate: options.bitRate,
    isMeteringEnabled: false,
  };
  return Platform.OS === "ios"
    ? { ...common, ...options.ios }
    : { ...common, ...(options.android as Record<string, unknown> | undefined) };
}

function loadAudioModule(): AudioModuleShape | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-audio/build/AudioModule") as { default?: AudioModuleShape } | AudioModuleShape;
    const resolved = (mod as { default?: AudioModuleShape }).default ?? (mod as AudioModuleShape);
    return typeof resolved?.AudioRecorder === "function" ? resolved : null;
  } catch (err) {
    debugLog("app", "warn", "car recorder unavailable", String(err));
    return null;
  }
}

let recorder: ImperativeRecorder | null = null;
let startedAt = 0;

/** True when this build can record a voice message without a React tree. */
export function carRecordingSupported(): boolean {
  return loadAudioModule() !== null;
}

/** Begins recording. Resolves to false when it could not start (no permission,
 *  module missing, or a recording already running). */
export async function startCarRecording(): Promise<boolean> {
  if (recorder) return false;
  const audioModule = loadAudioModule();
  if (!audioModule) return false;

  try {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      debugLog("app", "warn", "car voice message denied — no microphone permission");
      return false;
    }
    const instance = new audioModule.AudioRecorder(platformOptions(RecordingPresets.HIGH_QUALITY));
    await instance.prepareToRecordAsync();
    instance.record();
    recorder = instance;
    startedAt = Date.now();
    return true;
  } catch (err) {
    debugLog("app", "error", "car voice message failed to start", String(err));
    recorder = null;
    return false;
  }
}

/** How long the in-progress recording has been running, ms (0 when idle). */
export function carRecordingElapsedMs(): number {
  return recorder ? Date.now() - startedAt : 0;
}

/**
 * Stops the recording. With `send`, uploads it to the event chat exactly like
 * the phone's chat screen does. Returns a short outcome string for the car's
 * banner, or null when there was nothing to stop.
 */
export async function stopCarRecording(send: boolean): Promise<string | null> {
  const instance = recorder;
  if (!instance) return null;
  recorder = null;
  const durationMs = Date.now() - startedAt;

  try {
    await instance.stop();
  } catch (err) {
    debugLog("app", "warn", "car voice message stop failed", String(err));
  }

  const uri = instance.uri;
  try {
    instance.release?.();
  } catch {
    // Releasing a shared object twice is harmless; failing to is not fatal.
  }

  if (!send) return "Voice message discarded";
  // Anything shorter is a mis-tap, not a message.
  if (!uri || durationMs < 700) return "Too short — nothing sent";

  try {
    await uploadEventVoice(uri, durationMs);
    return "Voice message sent";
  } catch (err) {
    debugLog("api", "error", "car voice message upload failed", String(err));
    return "Could not send — check signal";
  }
}
