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
      // A radio channel has no headroom to spare; normalising to a consistent
      // level is the difference between a quiet caller being unintelligible and
      // being heard.
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
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
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
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
export function testTonePcm(durationMs = 1800): Buffer {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const progress = i / samples;
    // Fade in and out so the transmitter is never hit with a step edge.
    const envelope = Math.min(1, progress * 12, (1 - progress) * 12);
    const value =
      Math.sin(2 * Math.PI * 700 * t) * 0.45 + Math.sin(2 * Math.PI * 1100 * t) * 0.25;
    pcm.writeInt16LE(Math.round(value * envelope * 22000), i * 2);
  }
  return pcm;
}
