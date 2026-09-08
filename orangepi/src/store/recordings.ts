import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../logger";
import { RECORDINGS_DIR, STATE_DIR, type GatewayConfig } from "../config";
import type { Recording } from "../types";

/**
 * Every transmission the box has heard or sent, kept on the SD card so the
 * console can play them back with no server and no internet — which is the
 * state the box is in exactly when someone most wants to know what was said.
 *
 * The index is a single JSON file rewritten on change rather than a database:
 * a few thousand rows, one writer, and a corrupt index that can be deleted
 * without losing the audio beats any dependency worth adding here.
 */
const INDEX_PATH = join(STATE_DIR, "recordings.json");

export class RecordingStore {
  private index: Recording[] = [];

  constructor(private config: GatewayConfig) {
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    this.load();
  }

  applyConfig(config: GatewayConfig): void {
    this.config = config;
    void this.prune();
  }

  private load(): void {
    if (!existsSync(INDEX_PATH)) return;
    try {
      this.index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as Recording[];
    } catch {
      log.warn("system", "the recordings index was unreadable — starting a fresh one");
      this.index = [];
    }
  }

  private save(): void {
    try {
      writeFileSync(INDEX_PATH, JSON.stringify(this.index));
    } catch (err) {
      log.warn("system", `could not write the recordings index: ${(err as Error).message}`);
    }
  }

  /** Store Ogg Opus bytes and return the row the console will list. */
  async add(entry: Omit<Recording, "id" | "file">, audio: Buffer): Promise<Recording> {
    const id = randomUUID();
    const file = `${entry.at.replace(/[:.]/g, "-")}-${entry.direction}-${id.slice(0, 8)}.ogg`;
    writeFileSync(join(RECORDINGS_DIR, file), audio);
    const row: Recording = { id, file, ...entry };
    this.index.push(row);
    this.save();
    await this.prune();
    return row;
  }

  markUploaded(id: string, uploaded: boolean): void {
    const row = this.index.find((r) => r.id === id);
    if (!row) return;
    row.uploaded = uploaded;
    this.save();
  }

  /** Newest first — the order the console wants. */
  list(limit = 200, direction?: "rx" | "tx"): Recording[] {
    return this.index
      .filter((r) => !direction || r.direction === direction)
      .slice(-limit)
      .reverse();
  }

  find(id: string): Recording | undefined {
    return this.index.find((r) => r.id === id);
  }

  pathOf(row: Recording): string {
    return join(RECORDINGS_DIR, row.file);
  }

  stats(): { count: number; bytes: number; oldest?: string } {
    let bytes = 0;
    for (const row of this.index) {
      try {
        bytes += statSync(this.pathOf(row)).size;
      } catch {
        // Counted as zero; prune will drop the row on its next pass.
      }
    }
    return { count: this.index.length, bytes, oldest: this.index[0]?.at };
  }

  /**
   * Oldest-first eviction against both limits. Runs after every write, which is
   * frequent enough that it never has much to do and cheap enough not to matter.
   */
  private async prune(): Promise<void> {
    const { maxMb, maxDays } = this.config.storage;
    const cutoff = Date.now() - maxDays * 86_400_000;
    let removed = 0;

    const survivors: Recording[] = [];
    for (const row of this.index) {
      if (Date.parse(row.at) < cutoff) {
        this.remove(row);
        removed++;
      } else {
        survivors.push(row);
      }
    }
    this.index = survivors;

    let total = this.stats().bytes;
    const budget = maxMb * 1024 * 1024;
    while (total > budget && this.index.length > 1) {
      const oldest = this.index.shift()!;
      try {
        total -= statSync(this.pathOf(oldest)).size;
      } catch {
        // already gone
      }
      this.remove(oldest);
      removed++;
    }

    if (removed > 0) {
      log.info("system", `pruned ${removed} old recording${removed === 1 ? "" : "s"}`);
      this.save();
    }
    await this.sweepOrphans();
  }

  private remove(row: Recording): void {
    try {
      unlinkSync(this.pathOf(row));
    } catch {
      // Already gone, which is the desired end state anyway.
    }
  }

  /** Delete audio files the index no longer knows about (crash mid-write). */
  private async sweepOrphans(): Promise<void> {
    try {
      const known = new Set(this.index.map((r) => r.file));
      for (const file of await readdir(RECORDINGS_DIR)) {
        if (file.endsWith(".ogg") && !known.has(file)) {
          unlinkSync(join(RECORDINGS_DIR, file));
        }
      }
    } catch {
      // Best effort.
    }
  }

  /** Console "clear recordings". */
  clear(): void {
    for (const row of this.index) this.remove(row);
    this.index = [];
    this.save();
    log.warn("console", "all recordings were cleared from the console");
  }
}
