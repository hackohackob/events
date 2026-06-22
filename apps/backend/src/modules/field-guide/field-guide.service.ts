import { randomUUID } from "crypto";
import { join } from "path";
import { promises as fs } from "fs";
import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { SEED_FIELD_GUIDE } from "./field-guide.seed";

export interface FieldGuideCase {
  id: string;
  /** Condition name, e.g. "Heat stroke". */
  title: string;
  /** Grouping bucket: cardiac | neuro | metabolic | environmental | trauma | airway | allergy | other */
  category: string;
  /** Search terms — symptoms, synonyms, slang. */
  keywords: string[];
  /** One-liner shown in list results. */
  summary: string;
  /** Recognition: what the paramedic sees/asks. */
  signs: string[];
  /** Numbered "do this now" steps — short reminders, not a textbook. */
  actions: string[];
  /** Escalation triggers / what makes this critical. */
  redFlags: string[];
  updatedAt: string;
}

export type FieldGuideCaseInput = Omit<FieldGuideCase, "id" | "updatedAt">;

/**
 * JSON-file-backed reference of emergency cases for medics in the field.
 * Deliberately not a DB table: the whole list lives in data/field-guide.json so
 * it can be versioned, hand-edited, and carried between deployments.
 */
@Injectable()
export class FieldGuideService implements OnModuleInit {
  private readonly logger = new Logger(FieldGuideService.name);
  private readonly filePath = join(process.cwd(), "data", "field-guide.json");
  private cases: FieldGuideCase[] = [];

  async onModuleInit() {
    let existing: FieldGuideCase[] = [];
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as FieldGuideCase[];
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      // missing or corrupt → start from the seed only
    }

    // Merge in any seed cases not already present (matched by normalized title).
    // The list is JSON-file-backed and may already exist in production, so a
    // plain "use the file if present" would never surface newly-added reference
    // content. Hand-edited cases are preserved; only genuinely new ones append.
    const haveTitles = new Set(existing.map((c) => c.title.trim().toLowerCase()));
    const additions = SEED_FIELD_GUIDE.filter(
      (entry) => !haveTitles.has(entry.title.trim().toLowerCase()),
    ).map((entry) => ({
      ...entry,
      id: randomUUID(),
      updatedAt: new Date().toISOString(),
    }));

    this.cases = [...existing, ...additions];
    if (existing.length === 0 || additions.length > 0) {
      await this.persist();
      this.logger.log(
        existing.length === 0
          ? `Seeded field guide with ${this.cases.length} cases`
          : `Merged ${additions.length} new field-guide case(s); ${this.cases.length} total`,
      );
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.cases, null, 2), "utf8");
  }

  list(): FieldGuideCase[] {
    return this.cases;
  }

  async create(input: FieldGuideCaseInput): Promise<FieldGuideCase> {
    const entry: FieldGuideCase = {
      ...normalizeInput(input),
      id: randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    this.cases = [...this.cases, entry];
    await this.persist();
    return entry;
  }

  async update(id: string, input: Partial<FieldGuideCaseInput>): Promise<FieldGuideCase> {
    const existing = this.cases.find((c) => c.id === id);
    if (!existing) throw new NotFoundException("Field guide case not found");
    const updated: FieldGuideCase = {
      ...existing,
      ...normalizeInput({ ...existing, ...input }),
      id,
      updatedAt: new Date().toISOString(),
    };
    this.cases = this.cases.map((c) => (c.id === id ? updated : c));
    await this.persist();
    return updated;
  }

  async remove(id: string): Promise<{ id: string }> {
    if (!this.cases.some((c) => c.id === id)) throw new NotFoundException("Field guide case not found");
    this.cases = this.cases.filter((c) => c.id !== id);
    await this.persist();
    return { id };
  }
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeInput(input: FieldGuideCaseInput): FieldGuideCaseInput {
  return {
    title: String(input.title ?? "").trim() || "Untitled case",
    category: String(input.category ?? "other").trim() || "other",
    keywords: cleanList(input.keywords),
    summary: String(input.summary ?? "").trim(),
    signs: cleanList(input.signs),
    actions: cleanList(input.actions),
    redFlags: cleanList(input.redFlags),
  };
}
