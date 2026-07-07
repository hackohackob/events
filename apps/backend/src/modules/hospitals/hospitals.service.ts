import { readFile } from "fs/promises";
import { join } from "path";
import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Hospital, HospitalCapability, HospitalHoursRule } from "@events/contracts";
import { DbService } from "../infra/db.service";
import { UpsertHospitalDto } from "./dto/upsert-hospital.dto";

interface HospitalRow {
  id: string;
  name: string;
  name_bg: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  phones: unknown;
  emergency_24h: boolean;
  hours: unknown;
  hours_text: string | null;
  capabilities: unknown;
  notes: string | null;
  source: string;
  osm_id: string | null;
  updated_at: string;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function rowToHospital(r: HospitalRow): Hospital {
  return {
    id: r.id,
    name: r.name,
    nameBg: r.name_bg ?? undefined,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    lat: r.lat,
    lng: r.lng,
    phones: asStringArray(r.phones),
    emergency24h: r.emergency_24h,
    hours: Array.isArray(r.hours) ? (r.hours as HospitalHoursRule[]) : undefined,
    hoursText: r.hours_text ?? undefined,
    capabilities: asStringArray(r.capabilities) as HospitalCapability[],
    notes: r.notes ?? undefined,
    source: r.source === "osm" ? "osm" : "manual",
    osmId: r.osm_id ?? undefined,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/** Seed-file shape — the output of scripts/import-hospitals-osm.mjs. */
interface SeedHospital {
  name: string;
  nameBg?: string;
  address?: string;
  city?: string;
  lat: number;
  lng: number;
  phones?: string[];
  emergency24h?: boolean;
  hoursText?: string;
  capabilities?: string[];
  osmId: string;
}

/**
 * Global (not event-scoped) directory of hospitals / medical facilities.
 * Seeded once from OpenStreetMap; equipment capabilities (MRI/CT/…) are
 * curated by coordinators in the dashboard.
 */
@Injectable()
export class HospitalsService implements OnModuleInit {
  private readonly logger = new Logger(HospitalsService.name);

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS hospitals (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT NOT NULL,
        name_bg      TEXT,
        address      TEXT,
        city         TEXT,
        lat          DOUBLE PRECISION NOT NULL,
        lng          DOUBLE PRECISION NOT NULL,
        phones       JSONB NOT NULL DEFAULT '[]',
        emergency_24h BOOLEAN NOT NULL DEFAULT false,
        hours        JSONB,
        hours_text   TEXT,
        capabilities JSONB NOT NULL DEFAULT '[]',
        notes        TEXT,
        source       TEXT NOT NULL DEFAULT 'manual',
        osm_id       TEXT UNIQUE,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.seedIfEmpty();
  }

  /** One-time bulk import of the committed OSM seed when the table is empty. */
  private async seedIfEmpty(): Promise<void> {
    const { rows } = await this.db.query<{ count: string }>(`SELECT count(*) AS count FROM hospitals`);
    if (Number(rows[0]?.count ?? 0) > 0) return;

    let seed: SeedHospital[];
    try {
      // Same data/ convention as events.json — survives the tsc build (no
      // asset copying) and works in the deployed container.
      const raw = await readFile(join(process.cwd(), "data", "hospitals.bg.json"), "utf8");
      seed = JSON.parse(raw) as SeedHospital[];
    } catch (err) {
      this.logger.warn(`Hospitals seed not loaded: ${String(err)}`);
      return;
    }

    let inserted = 0;
    for (const h of seed) {
      if (!h.name || !Number.isFinite(h.lat) || !Number.isFinite(h.lng)) continue;
      await this.db
        .query(
          `INSERT INTO hospitals (name, name_bg, address, city, lat, lng, phones, emergency_24h, hours_text, capabilities, source, osm_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'osm', $11)
           ON CONFLICT (osm_id) DO NOTHING`,
          [
            h.name,
            h.nameBg ?? null,
            h.address ?? null,
            h.city ?? null,
            h.lat,
            h.lng,
            JSON.stringify(h.phones ?? []),
            h.emergency24h ?? false,
            h.hoursText ?? null,
            JSON.stringify(h.capabilities ?? []),
            h.osmId,
          ],
        )
        .then(() => inserted++)
        .catch((err) => this.logger.warn(`Hospital seed row skipped (${h.name}): ${String(err)}`));
    }
    this.logger.log(`Seeded ${inserted} hospitals from OSM data`);
  }

  async list(search?: string, capability?: string): Promise<Hospital[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(name ILIKE $${params.length} OR name_bg ILIKE $${params.length} OR city ILIKE $${params.length})`);
    }
    if (capability?.trim()) {
      params.push(JSON.stringify(capability.trim()));
      conditions.push(`capabilities @> $${params.length}::jsonb`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.db.query<HospitalRow>(
      `SELECT * FROM hospitals ${where} ORDER BY name`,
      params,
    );
    return rows.map(rowToHospital);
  }

  async create(input: UpsertHospitalDto): Promise<Hospital> {
    const { rows } = await this.db.query<HospitalRow>(
      `INSERT INTO hospitals (name, name_bg, address, city, lat, lng, phones, emergency_24h, hours, hours_text, capabilities, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual')
       RETURNING *`,
      [
        input.name,
        input.nameBg ?? null,
        input.address ?? null,
        input.city ?? null,
        input.lat,
        input.lng,
        JSON.stringify(input.phones ?? []),
        input.emergency24h ?? false,
        input.hours ? JSON.stringify(input.hours) : null,
        input.hoursText ?? null,
        JSON.stringify(input.capabilities ?? []),
        input.notes ?? null,
      ],
    );
    return rowToHospital(rows[0]!);
  }

  async update(id: string, input: UpsertHospitalDto): Promise<Hospital> {
    const { rows } = await this.db.query<HospitalRow>(
      `UPDATE hospitals
       SET name = $1, name_bg = $2, address = $3, city = $4, lat = $5, lng = $6,
           phones = $7, emergency_24h = $8, hours = $9, hours_text = $10,
           capabilities = $11, notes = $12, updated_at = now()
       WHERE id = $13
       RETURNING *`,
      [
        input.name,
        input.nameBg ?? null,
        input.address ?? null,
        input.city ?? null,
        input.lat,
        input.lng,
        JSON.stringify(input.phones ?? []),
        input.emergency24h ?? false,
        input.hours ? JSON.stringify(input.hours) : null,
        input.hoursText ?? null,
        JSON.stringify(input.capabilities ?? []),
        input.notes ?? null,
        id,
      ],
    );
    if (!rows[0]) throw new NotFoundException(`Hospital ${id} not found`);
    return rowToHospital(rows[0]);
  }

  async remove(id: string): Promise<void> {
    const { rowCount } = await this.db.query(`DELETE FROM hospitals WHERE id = $1`, [id]);
    if (!rowCount) throw new NotFoundException(`Hospital ${id} not found`);
  }
}
