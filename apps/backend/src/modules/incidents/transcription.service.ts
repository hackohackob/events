import { Injectable, Logger } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * Speech-to-text for voice notes (incident chat + event chat).
 *
 * The whole voice pipeline — storage, the `transcript` column, the socket
 * broadcast and both clients' display — is already wired; this fills in the
 * transcription seam. It is best-effort: any failure returns `null` and the
 * voice note is still delivered (just without a transcript).
 *
 * Providers (ported from the cs simulator's Bulgarian-tuned STT):
 *   • Soniox `stt-async` (primary) — excellent on Bulgarian, file-based async API.
 *   • OpenAI `gpt-4o-transcribe` (fallback) — single-call, also strong on BG.
 * Selected by whichever key is present; override with TRANSCRIPTION_PROVIDER.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  private get sonioxKey(): string {
    return process.env.SONIOX_API_KEY?.trim() ?? "";
  }
  private get openaiKey(): string {
    return process.env.OPENAI_API_KEY?.trim() ?? "";
  }

  /** Ordered list of providers to try, honouring an explicit override. */
  private providers(): Array<"soniox" | "openai"> {
    const override = process.env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
    if (override === "soniox") return this.sonioxKey ? ["soniox"] : [];
    if (override === "openai") return this.openaiKey ? ["openai"] : [];
    const list: Array<"soniox" | "openai"> = [];
    if (this.sonioxKey) list.push("soniox");
    if (this.openaiKey) list.push("openai");
    return list;
  }

  get enabled(): boolean {
    return this.providers().length > 0;
  }

  /**
   * Transcribe an audio file. Returns the transcript, or `null` when no provider
   * is configured or every configured provider fails. Never throws.
   */
  async transcribe(audioPath: string, mimetype?: string): Promise<string | null> {
    const providers = this.providers();
    if (providers.length === 0) return null;

    for (const provider of providers) {
      try {
        const text =
          provider === "soniox"
            ? await this.transcribeSoniox(audioPath, mimetype)
            : await this.transcribeOpenAI(audioPath, mimetype);
        if (text && text.trim()) return text.trim();
      } catch (err) {
        this.logger.warn(`STT provider "${provider}" failed: ${String(err)} — trying next`);
      }
    }
    return null;
  }

  // ── Soniox async file transcription ────────────────────────────────────────
  private async transcribeSoniox(audioPath: string, mimetype?: string): Promise<string | null> {
    const key = this.sonioxKey;
    const base = "https://api.soniox.com";
    const auth = { Authorization: `Bearer ${key}` };

    const buf = await readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: mimetype || "audio/mpeg" }), basename(audioPath));

    const upRes = await fetch(`${base}/v1/files`, { method: "POST", headers: auth, body: form });
    if (!upRes.ok) throw new Error(`upload ${upRes.status}`);
    const fileId = ((await upRes.json()) as { id?: string }).id;
    if (!fileId) throw new Error("no file id");

    try {
      const createRes = await fetch(`${base}/v1/transcriptions`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        // Bulgarian-first (matches the cs STT). stt-async-preview maps to the
        // current async model server-side.
        body: JSON.stringify({ file_id: fileId, model: "stt-async-preview", language_hints: ["bg"] }),
      });
      if (!createRes.ok) throw new Error(`create ${createRes.status}`);
      const tid = ((await createRes.json()) as { id?: string }).id;
      if (!tid) throw new Error("no transcription id");

      try {
        // Short voice notes finish in ~1-2s; poll up to ~30s then give up.
        for (let i = 0; i < 30; i += 1) {
          const stRes = await fetch(`${base}/v1/transcriptions/${tid}`, { headers: auth });
          const st = (await stRes.json()) as { status?: string; error_message?: string };
          if (st.status === "completed") break;
          if (st.status === "error") throw new Error(st.error_message || "transcription error");
          await delay(1000);
        }
        const trRes = await fetch(`${base}/v1/transcriptions/${tid}/transcript`, { headers: auth });
        if (!trRes.ok) throw new Error(`transcript ${trRes.status}`);
        return ((await trRes.json()) as { text?: string }).text ?? null;
      } finally {
        // Best-effort cleanup so we don't accumulate jobs/files on Soniox.
        void fetch(`${base}/v1/transcriptions/${tid}`, { method: "DELETE", headers: auth }).catch(() => undefined);
      }
    } finally {
      void fetch(`${base}/v1/files/${fileId}`, { method: "DELETE", headers: auth }).catch(() => undefined);
    }
  }

  // ── OpenAI gpt-4o-transcribe (single call) ─────────────────────────────────
  private async transcribeOpenAI(audioPath: string, mimetype?: string): Promise<string | null> {
    const buf = await readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: mimetype || "audio/mpeg" }), basename(audioPath));
    form.append("model", "gpt-4o-transcribe");
    form.append("language", "bg");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.openaiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    return ((await res.json()) as { text?: string }).text ?? null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
