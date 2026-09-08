import { run, FAKE_HARDWARE } from "../util";

/**
 * ALSA card discovery for the setup screen. The USB sound card is almost always
 * card 1 (card 0 being the SoC's own HDMI/analog out), but "almost always" is
 * not something to wire a race's radio link to, so the operator picks from a
 * list and the choice is stored.
 */
export interface AudioDevice {
  /** What ALSA is told, e.g. "plughw:1,0". `plughw` so it resamples for us. */
  id: string;
  label: string;
  card: number;
  device: number;
  /** True for the entry auto-detect would have picked. */
  recommended: boolean;
}

const LINE = /^card (\d+): ([^\[]+)\[([^\]]*)\], device (\d+): (.*?)\s*\[/;

async function list(binary: "arecord" | "aplay"): Promise<AudioDevice[]> {
  if (FAKE_HARDWARE) {
    return [
      { id: "plughw:0,0", label: "Mock USB Audio Device", card: 0, device: 0, recommended: true },
      { id: "plughw:1,0", label: "Mock onboard codec", card: 1, device: 0, recommended: false },
    ];
  }
  const res = await run(binary, ["-l"], { timeoutMs: 5000 });
  if (res.code !== 0) return [];

  const devices: AudioDevice[] = [];
  for (const raw of res.stdout.split("\n")) {
    const match = LINE.exec(raw.trim());
    if (!match) continue;
    const [, card, shortName, longName, device] = match;
    const name = (longName || shortName || "").trim();
    devices.push({
      id: `plughw:${card},${device}`,
      label: name || `Card ${card}, device ${device}`,
      card: Number(card),
      device: Number(device),
      recommended: false,
    });
  }

  // A USB dongle is what the radio is plugged into; the SoC's own codec never
  // is. Prefer anything that looks like USB, then the highest card number,
  // which is the last device plugged in.
  const usb = devices.find((d) => /usb|c-media|cmedia|audio device/i.test(d.label));
  const pick = usb ?? devices[devices.length - 1];
  if (pick) pick.recommended = true;
  return devices;
}

export function captureDevices(): Promise<AudioDevice[]> {
  return list("arecord");
}

export function playbackDevices(): Promise<AudioDevice[]> {
  return list("aplay");
}

/** Resolve a configured device string, falling back to auto-detection. */
export async function resolveDevice(configured: string, kind: "capture" | "playback"): Promise<string> {
  if (configured.trim()) return configured.trim();
  const devices = kind === "capture" ? await captureDevices() : await playbackDevices();
  return devices.find((d) => d.recommended)?.id ?? devices[0]?.id ?? "default";
}
