import { Injectable, Logger } from "@nestjs/common";

/**
 * Speech-to-text for incident voice notes.
 *
 * This is the integration seam, deliberately decoupled from the upload path:
 * the voice-note pipeline (storage, the `transcript` column, the socket
 * broadcast, and both clients' display) is fully wired, so the moment this
 * returns a non-empty string the transcript shows up in the incident chat.
 *
 * No provider is configured by default → it returns `null` (no transcript).
 * To enable a real model, implement `transcribe` here — e.g. shell out to a
 * local whisper.cpp binary, or POST the file to a cloud STT — keyed off an env
 * var so deployments opt in. Keep it best-effort: a failure must never block
 * the voice note from being delivered.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  /** Whether a real provider is wired up. */
  get enabled(): boolean {
    return Boolean(process.env.TRANSCRIPTION_PROVIDER);
  }

  /**
   * Transcribe an audio file. Returns the transcript, or `null` when no
   * provider is configured or transcription fails (callers treat null as
   * "no transcript" and proceed).
   */
  async transcribe(audioPath: string, mimetype?: string): Promise<string | null> {
    if (!this.enabled) return null;
    try {
      // Plug a real STT provider here, e.g.:
      //   if (process.env.TRANSCRIPTION_PROVIDER === "whisper") return await runWhisper(audioPath);
      // Left unimplemented on purpose so production never silently calls out.
      this.logger.warn(
        `TRANSCRIPTION_PROVIDER="${process.env.TRANSCRIPTION_PROVIDER}" is set but no implementation is wired; skipping (${mimetype ?? "audio"}).`,
      );
      return null;
    } catch (err) {
      this.logger.error(`Transcription failed for ${audioPath}: ${String(err)}`);
      return null;
    }
  }
}
