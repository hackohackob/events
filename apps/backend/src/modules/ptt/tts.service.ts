import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";

const CACHE_DIR = join(process.cwd(), "uploads", "tts");

/**
 * Text-to-speech for the radio bridge: chat lines a gateway is asked to speak
 * over the air are rendered here rather than on the appliance, so the boxes
 * carry no API keys and a phrase said at ten venues is synthesised once.
 *
 * Same key as the rest of the platform (`OPENAI_API_KEY` from the host `.env`).
 * Failure is not fatal anywhere: the caller falls back to not transmitting,
 * which is exactly what happens when speech is switched off.
 *
 * The cache is keyed on voice + text, and files are written under
 * `uploads/tts/` where they are served like any other media.
 */
@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private readonly inflight = new Map<string, Promise<string | null>>();

  private get apiKey(): string | undefined {
    return process.env.OPENAI_API_KEY?.trim() || undefined;
  }

  private get voice(): string {
    return process.env.TTS_VOICE?.trim() || "alloy";
  }

  available(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Returns a server-relative URL for spoken `text`, or null when speech is
   * unavailable. Concurrent requests for the same phrase share one render.
   */
  async synthesize(text: string): Promise<string | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (!this.apiKey) {
      this.logger.warn("no OPENAI_API_KEY — cannot speak text over the radio");
      return null;
    }

    const hash = createHash("sha1").update(`${this.voice}:${trimmed}`).digest("hex").slice(0, 20);
    const filename = `tts-${hash}.mp3`;
    const url = `/uploads/tts/${filename}`;
    if (existsSync(join(CACHE_DIR, filename))) return url;

    const existing = this.inflight.get(hash);
    if (existing) return existing;

    const job = this.render(trimmed, filename, url).finally(() => this.inflight.delete(hash));
    this.inflight.set(hash, job);
    return job;
  }

  private async render(text: string, filename: string, url: string): Promise<string | null> {
    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.TTS_MODEL?.trim() || "gpt-4o-mini-tts",
          voice: this.voice,
          input: text,
          // A radio channel is narrowband and noisy; the appliance resamples to
          // 16 kHz anyway, so anything richer than mp3 is wasted bytes over a
          // venue's WiFi.
          response_format: "mp3",
          // Speaking a touch slower survives the codec and the squelch tail.
          speed: 0.95,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`TTS failed: ${res.status} ${await res.text().catch(() => "")}`);
        return null;
      }
      if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(join(CACHE_DIR, filename), Buffer.from(await res.arrayBuffer()));
      return url;
    } catch (err) {
      this.logger.warn(`TTS error: ${(err as Error).message}`);
      return null;
    }
  }
}
