import { log } from "../logger";
import { FAKE_HARDWARE, run } from "../util";

/**
 * The sound card's own mixer.
 *
 * This matters more than it looks. A USB audio card usually has a path that
 * feeds its microphone input straight back to its output — sidetone, or
 * "monitoring". On a headset that is a feature. Wired to a radio it is a
 * feedback loop: everything the radio receives is played back into the radio's
 * microphone, which with VOX on means the radio keys up and never stops.
 *
 * Different cards default differently, so swapping one card for another can
 * turn a working box into a transmitter that will not shut up — with nothing in
 * the software having changed.
 */

export interface MixerControl {
  name: string;
  /** Has a playback volume. */
  hasPlaybackVolume: boolean;
  /** Has a playback on/off switch. */
  hasPlaybackSwitch: boolean;
  hasCaptureVolume: boolean;
  hasCaptureSwitch: boolean;
  /** 0-100, or null when the control has no volume of that kind. */
  playbackPercent: number | null;
  capturePercent: number | null;
  /** null when the control has no switch of that kind. */
  playbackOn: boolean | null;
  captureOn: boolean | null;
  /**
   * True when this control routes input back to the output — the thing that
   * makes a radio key itself.
   */
  isMonitorPath: boolean;
}

/**
 * Controls whose *playback* side feeds an input back out. A control that can
 * both capture and play is monitoring by definition: the same signal is being
 * taken in and sent out. The name check catches cards that expose the two
 * halves separately.
 */
function looksLikeMonitor(name: string, hasPlayback: boolean, hasCapture: boolean): boolean {
  if (hasPlayback && hasCapture) return true;
  return /mic|line|aux|input|monitor|sidetone|loopback|capture/i.test(name) && hasPlayback;
}

/** Everything the card exposes, parsed from `amixer`. */
export async function listControls(card: number): Promise<MixerControl[]> {
  if (FAKE_HARDWARE) return [];
  const res = await run("amixer", ["-c", String(card)], { timeoutMs: 8000 });
  if (res.code !== 0) return [];

  const controls: MixerControl[] = [];
  let current: MixerControl | null = null;

  for (const raw of res.stdout.split("\n")) {
    const header = /^Simple mixer control '(.+)',(\d+)/.exec(raw);
    if (header) {
      if (current) controls.push(current);
      current = {
        name: header[1]!,
        hasPlaybackVolume: false,
        hasPlaybackSwitch: false,
        hasCaptureVolume: false,
        hasCaptureSwitch: false,
        playbackPercent: null,
        capturePercent: null,
        playbackOn: null,
        captureOn: null,
        isMonitorPath: false,
      };
      continue;
    }
    if (!current) continue;

    const caps = /^\s*Capabilities:\s*(.+)$/.exec(raw);
    if (caps) {
      const list = caps[1]!;
      current.hasPlaybackVolume = /pvolume/.test(list);
      current.hasPlaybackSwitch = /pswitch/.test(list);
      current.hasCaptureVolume = /cvolume/.test(list);
      current.hasCaptureSwitch = /cswitch/.test(list);
      continue;
    }

    // e.g. "  Mono: Playback 12 [9%] [2.24dB] [off] Capture 12 [75%] [17.85dB] [on]"
    const playback = /Playback\s+\d+\s+\[(\d+)%\](?:\s+\[[-\d.]+dB\])?(?:\s+\[(on|off)\])?/.exec(raw);
    if (playback) {
      current.playbackPercent = Number(playback[1]);
      if (playback[2]) current.playbackOn = playback[2] === "on";
    }
    const capture = /Capture\s+\d+\s+\[(\d+)%\](?:\s+\[[-\d.]+dB\])?(?:\s+\[(on|off)\])?/.exec(raw);
    if (capture) {
      current.capturePercent = Number(capture[1]);
      if (capture[2]) current.captureOn = capture[2] === "on";
    }
    // A switch-only control prints just "[on]" / "[off]".
    const bare = /^\s*\w+:\s*(?:Playback\s+)?\[(on|off)\]\s*$/.exec(raw);
    if (bare && current.playbackOn === null) current.playbackOn = bare[1] === "on";
  }
  if (current) controls.push(current);

  for (const control of controls) {
    control.isMonitorPath = looksLikeMonitor(
      control.name,
      control.hasPlaybackVolume || control.hasPlaybackSwitch,
      control.hasCaptureVolume || control.hasCaptureSwitch,
    );
  }
  return controls;
}

/** The raw `amixer` text, for the log and the diagnostics screen. */
export async function dump(card: number): Promise<string> {
  const res = await run("amixer", ["-c", String(card)], { timeoutMs: 8000 });
  return res.stdout.trim() || res.stderr.trim();
}

export async function setPlaybackVolume(card: number, name: string, percent: number): Promise<boolean> {
  const res = await run("amixer", ["-c", String(card), "-q", "sset", name, `${Math.round(percent)}%`], {
    timeoutMs: 8000,
  });
  return res.code === 0;
}

export async function setCaptureVolume(card: number, name: string, percent: number): Promise<boolean> {
  const res = await run(
    "amixer",
    ["-c", String(card), "-q", "sset", name, `${Math.round(percent)}%`, "cap"],
    { timeoutMs: 8000 },
  );
  return res.code === 0;
}

export async function setSwitch(
  card: number,
  name: string,
  on: boolean,
  side: "playback" | "capture",
): Promise<boolean> {
  const args = ["-c", String(card), "-q", "sset", name];
  args.push(side === "capture" ? (on ? "cap" : "nocap") : on ? "unmute" : "mute");
  const res = await run("amixer", args, { timeoutMs: 8000 });
  return res.code === 0;
}

/**
 * Silence every path that feeds an input back to the output.
 *
 * Run whenever the capture device is opened, because the card that is plugged
 * in today is not necessarily the card that was configured yesterday. Reports
 * what it changed, so the log says why a radio stopped keying itself.
 */
export async function muteMonitorPaths(card: number): Promise<string[]> {
  if (FAKE_HARDWARE) return [];
  const controls = await listControls(card);
  const silenced: string[] = [];

  for (const control of controls) {
    if (!control.isMonitorPath) continue;
    // Leave the capture side alone — that is the radio's audio coming in, which
    // is the whole point of the box.
    if (control.hasPlaybackSwitch && control.playbackOn !== false) {
      if (await setSwitch(card, control.name, false, "playback")) silenced.push(`${control.name} (muted)`);
    } else if (control.hasPlaybackVolume && (control.playbackPercent ?? 0) > 0) {
      if (await setPlaybackVolume(card, control.name, 0)) silenced.push(`${control.name} (to 0%)`);
    }
  }

  if (silenced.length > 0) {
    log.warn(
      "audio",
      `silenced ${silenced.length} monitor path(s) on card ${card} — these feed the radio's own audio back into it, which keys VOX forever`,
      { controls: silenced.join(", ") },
    );
  }
  return silenced;
}

/** Log everything the card exposes, so a swap is diagnosable from the log alone. */
export async function logMixerState(card: number, label: string): Promise<void> {
  const controls = await listControls(card);
  if (controls.length === 0) {
    log.warn("audio", `card ${card} (${label}) exposes no mixer controls`);
    return;
  }
  log.info("audio", `card ${card} (${label}) mixer, ${controls.length} control(s):`);
  for (const c of controls) {
    const bits: string[] = [];
    if (c.playbackPercent !== null) bits.push(`play ${c.playbackPercent}%`);
    if (c.playbackOn !== null) bits.push(c.playbackOn ? "play ON" : "play off");
    if (c.capturePercent !== null) bits.push(`cap ${c.capturePercent}%`);
    if (c.captureOn !== null) bits.push(c.captureOn ? "cap ON" : "cap off");
    log.info("audio", `  ${c.name}: ${bits.join(", ") || "no levels"}${c.isMonitorPath ? "   <== MONITOR PATH" : ""}`);
  }
}

/** Card number out of an ALSA device string like "plughw:1,0". */
export function cardOf(device: string): number {
  const match = /(?:plug)?hw:(\d+)/.exec(device);
  return match ? Number(match[1]) : 0;
}
