import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";

/**
 * Media conversion for the PTT bridges.
 *
 * Two seams need ffmpeg, and both degrade gracefully without it:
 *   • App voice notes are AAC/m4a; PTT networks want Opus frames.
 *   • Inbound PTT voice is Opus-in-Ogg, which iOS cannot play — so it is
 *     re-wrapped as m4a for the field app.
 *
 * When ffmpeg is missing the bridge still works: inbound voice is delivered as
 * the raw .ogg (fine on web/Android), and outbound voice falls back to relaying
 * the speech-to-text transcript as a text message.
 */

const UPLOADS_DIR = join(process.cwd(), "uploads", "event-chat");

/** Opus profile Zello accepts: 16 kHz mono, one 60 ms frame per packet. */
export const PTT_OPUS_PROFILE = { sampleRate: 16000, framesPerPacket: 1, frameSizeMs: 60 };

@Injectable()
export class PttMediaService {
  private readonly logger = new Logger(PttMediaService.name);
  private ffmpegChecked = false;
  private ffmpegAvailable = false;
  private libopusProbe: Promise<boolean> | null = null;

  /** Probed once; the answer cannot change without a restart. */
  async hasFfmpeg(): Promise<boolean> {
    if (this.ffmpegChecked) return this.ffmpegAvailable;
    this.ffmpegChecked = true;
    this.ffmpegAvailable = await run("ffmpeg", ["-version"])
      .then(() => true)
      .catch(() => false);
    if (!this.ffmpegAvailable) {
      this.logger.warn("ffmpeg not found — PTT voice will fall back to transcripts");
    }
    return this.ffmpegAvailable;
  }

  /**
   * Whether this ffmpeg can *decode* with libopus. Without it the only other
   * option is ffmpeg's native Opus decoder, which corrupts handset SILK streams
   * — so we serve the untouched .ogg instead. Delivering audible garbage is a
   * worse failure than delivering a container iOS won't open.
   */
  private hasLibopusDecoder(): Promise<boolean> {
    this.libopusProbe ??= run("ffmpeg", ["-hide_banner", "-decoders"])
      .then((out) => /^\s*\S+\s+libopus\b/m.test(out))
      .catch(() => false)
      .then((ok) => {
        if (!ok) {
          this.logger.warn(
            "ffmpeg has no libopus decoder — inbound PTT voice will be served as .ogg " +
              "(playable on web/Android, not iOS). Install an ffmpeg built with libopus.",
          );
        }
        return ok;
      });
    return this.libopusProbe;
  }

  async ensureUploadsDir(): Promise<void> {
    if (!existsSync(UPLOADS_DIR)) await mkdir(UPLOADS_DIR, { recursive: true });
  }

  /** Persist bytes under /uploads/event-chat and return the server-relative URL. */
  async storeUpload(data: Buffer, extension: string, prefix = "ptt"): Promise<string> {
    await this.ensureUploadsDir();
    const filename = `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
    await writeFile(join(UPLOADS_DIR, filename), data);
    return `/uploads/event-chat/${filename}`;
  }

  /** Absolute path for a URL previously returned by `storeUpload`. */
  absolutePath(url: string): string {
    return join(process.cwd(), url.replace(/^\//, ""));
  }

  /**
   * Re-wrap an Ogg Opus buffer as m4a so every client can play it (iOS cannot
   * play Ogg Opus). Returns null when ffmpeg is unavailable — callers then serve
   * the .ogg as-is, which is what browsers want anyway.
   *
   * `-c:a libopus` on the **input** is load-bearing, not a preference. ffmpeg's
   * built-in `opus` decoder mis-decodes the SILK-wideband streams PTT handsets
   * produce (TOC config 7, 2x60 ms frames): measured against libopus on real
   * traffic it returns a completely different signal — 0.0 dB SNR, ~5.6x the
   * RMS, slammed into full scale — which is heard as loud crackling over the
   * voice. libopus decodes the same file to a peak of 7509/32768 with no
   * clipping at all. Forcing it takes the round trip from 16.6 dB to 39.4 dB.
   */
  async oggToM4a(ogg: Buffer): Promise<Buffer | null> {
    if (!(await this.hasFfmpeg())) return null;
    if (!(await this.hasLibopusDecoder())) return null;
    return this.transcode(
      ogg,
      "ogg",
      "m4a",
      ["-c:a", "aac", "-b:a", "64k", "-ar", "16000", "-ac", "1", "-movflags", "+faststart"],
      ["-c:a", "libopus"],
    ).catch((err) => {
      this.logger.warn(`ogg → m4a failed: ${(err as Error).message}`);
      return null;
    });
  }

  /**
   * Encode any audio file into an Ogg Opus stream matching `PTT_OPUS_PROFILE`,
   * ready to be demuxed into packets. Returns null without ffmpeg.
   */
  async fileToOggOpus(path: string): Promise<Buffer | null> {
    if (!(await this.hasFfmpeg())) return null;
    const output = join(UPLOADS_DIR, `tx-${randomUUID()}.ogg`);
    try {
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", path,
        "-c:a", "libopus",
        "-b:a", "24k",
        "-vbr", "off",
        "-application", "voip",
        "-ar", String(PTT_OPUS_PROFILE.sampleRate),
        "-ac", "1",
        "-frame_duration", String(PTT_OPUS_PROFILE.frameSizeMs),
        "-f", "ogg",
        output,
      ]);
      return await readFile(output);
    } catch (err) {
      this.logger.warn(`voice → opus failed: ${(err as Error).message}`);
      return null;
    } finally {
      await unlink(output).catch(() => undefined);
    }
  }

  /**
   * Downscale a JPEG for use as a PTT thumbnail. Falls back to the original
   * bytes, which Zello accepts — it just costs bandwidth.
   */
  async jpegThumbnail(full: Buffer): Promise<Buffer> {
    if (!(await this.hasFfmpeg())) return full;
    return this.transcode(full, "jpg", "jpg", [
      "-vf", "scale='min(320,iw)':-2",
      "-q:v", "6",
    ]).catch(() => full);
  }

  /** Convert an arbitrary image (PNG, HEIC …) to JPEG for networks that only take JPEG. */
  async toJpeg(data: Buffer, sourceExt: string): Promise<Buffer | null> {
    if (sourceExt.toLowerCase().replace(/^\./, "").startsWith("jp")) return data;
    if (!(await this.hasFfmpeg())) return null;
    return this.transcode(data, sourceExt.replace(/^\./, ""), "jpg", ["-q:v", "4"]).catch(() => null);
  }

  /** `inputArgs` land before `-i` — that is the only place a decoder can be chosen. */
  private async transcode(
    input: Buffer,
    inExt: string,
    outExt: string,
    args: string[],
    inputArgs: string[] = [],
  ): Promise<Buffer> {
    await this.ensureUploadsDir();
    const id = randomUUID();
    const inPath = join(UPLOADS_DIR, `tmp-${id}.${inExt}`);
    const outPath = join(UPLOADS_DIR, `tmp-${id}.out.${outExt}`);
    try {
      await writeFile(inPath, input);
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        ...inputArgs,
        "-i", inPath,
        ...args,
        outPath,
      ]);
      return await readFile(outPath);
    } finally {
      await Promise.all([unlink(inPath).catch(() => undefined), unlink(outPath).catch(() => undefined)]);
    }
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split("\n").slice(-3).join(" ") || `exit ${code}`));
    });
  });
}
