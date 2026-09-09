import { spawn } from "node:child_process";
import { log } from "../logger";
import { hasBinary } from "../util";
import { CHANNELS, SAMPLE_RATE } from "./format";

/**
 * ffmpeg wrappers: everything arriving from the server (m4a voice notes, mp3
 * speech) becomes the box's PCM format, and everything leaving becomes Ogg
 * Opus, which is what the platform's chat stores.
 *
 * `-c:a libopus` is forced on decode for the same reason the server does it:
 * ffmpeg's native Opus decoder mangles the SILK frames a handset produces.
 */

/**
 * The voice band a radio actually carries. Everything below ~300 Hz coming out
 * of a handset's speaker jack is rumble and DC offset rather than speech: it
 * makes the audio sound bass-heavy and muddy, and because the squelch measures
 * RMS it also inflates the level and holds the gate open on nothing. Rolling it
 * off is the single biggest intelligibility win on this path.
 *
 * The top end is trimmed at 3.4 kHz for the same reason a radio does it —
 * above that there is only hiss to spend bitrate on.
 */
const VOICE_BAND = "highpass=f=300,lowpass=f=3400";

let warned = false;

async function ensureFfmpeg(): Promise<boolean> {
  if (await hasBinary("ffmpeg")) return true;
  if (!warned) {
    warned = true;
    log.error("audio", "ffmpeg is missing — the box cannot convert audio. Run scripts/install.sh.");
  }
  return false;
}

function pipeThrough(args: string[], input?: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout?.on("data", (d: Buffer) => out.push(d));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      log.warn("audio", `ffmpeg failed: ${e.message}`);
      resolve(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        log.warn("audio", `ffmpeg exited ${code}: ${err.trim().split("\n").slice(-2).join(" ")}`);
        resolve(null);
        return;
      }
      resolve(Buffer.concat(out));
    });
    if (input && child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    }
  });
}

/**
 * Whether these bytes are an Ogg stream.
 *
 * This decides which decoder is forced, and getting it wrong is expensive:
 * ffmpeg does *not* fail when told to decode AAC with libopus. It logs
 * "corrupted stream", writes a fraction of a second of noise, and exits 0 — so
 * a two-second voice note becomes a 300 ms burst of static on the air with
 * nothing anywhere reporting an error. Sniff, do not assume.
 */
function isOgg(data: Buffer): boolean {
  return data.length >= 4 && data.subarray(0, 4).toString("latin1") === "OggS";
}

/**
 * Any container the server hands us → the box's raw PCM.
 *
 * Two inputs in practice: the app's voice notes, which are AAC in m4a, and the
 * server's speech, which is mp3. Ogg turns up when audio makes a round trip
 * through another bridge. `libopus` is forced only for Ogg, because ffmpeg's
 * native Opus decoder corrupts the SILK frames a handset produces — the same
 * reason the server forces it.
 */
export async function decodeToPcm(data: Buffer): Promise<Buffer | null> {
  if (!(await ensureFfmpeg())) return null;
  const decoder = isOgg(data) ? ["-c:a", "libopus"] : [];
  const pcm = await pipeThrough(
    [
      "-hide_banner", "-loglevel", "error",
      // Before -i, so it applies to the *decoder* rather than the output.
      ...decoder,
      "-i", "pipe:0",
      "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS),
      // Band-limit before levelling. Sending full-range audio into a radio's
      // microphone input is the same mistake as taking full-range audio out of
      // its speaker: the input is built for a telephone band, and everything
      // below it arrives as boom rather than as bass. Then normalise, because a
      // radio channel has no headroom to spare and a quiet talker is a lost one.
      "-af", `${VOICE_BAND},loudnorm=I=-16:TP=-1.5:LRA=11`,
      "pipe:1",
    ],
    data,
  );
  if (pcm && pcm.length > 0) return pcm;

  // Retry with no forced decoder at all. Reached when an Ogg turns out not to
  // be Opus, or when a file's extension lied about its contents.
  log.warn("audio", "the first decode produced nothing — retrying without a forced decoder");
  return pipeThrough(
    [
      "-hide_banner", "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS),
      "-af", `${VOICE_BAND},loudnorm=I=-16:TP=-1.5:LRA=11`,
      "pipe:1",
    ],
    data,
  );
}


/** The box's PCM → Ogg Opus, the format the platform's chat stores. */
export async function encodeToOpus(pcm: Buffer): Promise<Buffer | null> {
  if (!(await ensureFfmpeg())) return null;
  return pipeThrough(
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS),
      "-i", "pipe:0",
      // Band-limit first, then even out the level. dynaudnorm rather than
      // loudnorm here: it works in one pass on a short clip, where loudnorm's
      // single-pass mode needs the whole file's statistics to do its job.
      "-af", `${VOICE_BAND},dynaudnorm=f=200:g=5:p=0.7`,
      "-c:a", "libopus", "-b:a", "24k", "-application", "voip",
      "-f", "ogg", "pipe:1",
    ],
    pcm,
  );
}

/**
 * A short spoken-word test signal for the "test transmit" button: a rising
 * two-tone chirp rather than a flat tone, because a flat tone tells you the
 * card works but not whether the audio path is clipping.
 */
export function testTonePcm(): Buffer {
  // A distinctive pattern rather than a single beep: three rising notes, a gap,
  // then a long steady note. Long enough to judge whether the level and the
  // tone of the link are right, and deliberately clear of 1600 Hz so the box
  // never mistakes its own test for a radio's roger beep.
  const notes: Array<{ hz: number; ms: number }> = [
    { hz: 600, ms: 220 },
    { hz: 900, ms: 220 },
    { hz: 1200, ms: 220 },
    { hz: 0, ms: 260 },
    { hz: 900, ms: 1400 },
  ];

  const total = notes.reduce((sum, note) => sum + Math.round((note.ms / 1000) * SAMPLE_RATE), 0);
  const pcm = Buffer.alloc(total * 2);
  let at = 0;
  for (const note of notes) {
    const samples = Math.round((note.ms / 1000) * SAMPLE_RATE);
    for (let i = 0; i < samples; i++) {
      let value = 0;
      if (note.hz > 0) {
        // Fade each note in and out so the transmitter is never hit with a step
        // edge, which clicks and can trip a radio's own noise gate.
        const progress = i / samples;
        const envelope = Math.min(1, progress * 20, (1 - progress) * 20);
        value = Math.sin((2 * Math.PI * note.hz * i) / SAMPLE_RATE) * 0.5 * envelope;
      }
      pcm.writeInt16LE(Math.round(value * 22000), (at + i) * 2);
    }
    at += samples;
  }
  return pcm;
}

