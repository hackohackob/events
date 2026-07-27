import { readFileSync } from "node:fs";
import { Injectable, Logger } from "@nestjs/common";
import type { PttChannelKind, PttEventRoutes, PttProviderSettings, PttRoute } from "@events/contracts";
import { PTT_CHANNEL_KINDS } from "@events/contracts";
import { DbService } from "../infra/db.service";

/**
 * Persistence for the PTT integration: one row per provider holding its
 * connection settings, and one row per (event, provider) holding the two
 * forwarding switches.
 *
 * Secrets live in the `config` JSON alongside everything else. They are never
 * returned by the API — reads go through `redact()`, which reports only *which*
 * secret keys are set — but they are not encrypted at rest, so the database is
 * the trust boundary. Deployments that would rather not store them at all can
 * supply them through the environment instead (see `envDefaults`), in which
 * case the DB row only carries the non-secret fields.
 */
@Injectable()
export class PttSettingsService {
  private readonly logger = new Logger(PttSettingsService.name);
  /**
   * Created on first use rather than in `onModuleInit`: the bridge's own init
   * hook reads settings, and Nest gives no ordering guarantee between the two.
   * Every public method awaits this, so the schema is always in place.
   */
  private schema: Promise<void> | null = null;

  constructor(private readonly db: DbService) {}

  private ready(): Promise<void> {
    this.schema ??= this.createSchema().catch((err: Error) => {
      // Let the next call retry instead of poisoning the service for good.
      this.schema = null;
      this.logger.error(`PTT schema setup failed: ${err.message}`);
      throw err;
    });
    return this.schema;
  }

  private async createSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS ptt_provider_settings (
        kind TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT false,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS ptt_event_routes (
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        inbound BOOLEAN NOT NULL DEFAULT true,
        outbound BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (event_id, kind)
      )
    `);
  }

  // ── Provider settings ──────────────────────────────────────────────────────

  /** Full settings including secrets — for the bridge only, never for the API. */
  async raw(kind: PttChannelKind): Promise<{ enabled: boolean; config: Record<string, string>; updatedAt: string }> {
    await this.ready();
    const { rows } = await this.db.query<{ enabled: boolean; config: Record<string, string>; updated_at: string }>(
      `SELECT enabled, config, updated_at FROM ptt_provider_settings WHERE kind = $1`,
      [kind],
    );
    const row = rows[0];
    const defaults = envDefaults(kind);
    if (!row) {
      return {
        // An env-configured provider comes up connected on a fresh database.
        enabled: Object.keys(defaults).length > 0 && process.env[`${kind.toUpperCase()}_ENABLED`] !== "false",
        config: defaults,
        updatedAt: new Date(0).toISOString(),
      };
    }
    return {
      enabled: row.enabled,
      // Stored values win; the environment fills the gaps.
      config: { ...defaults, ...(row.config ?? {}) },
      updatedAt: toIso(row.updated_at),
    };
  }

  async rawAll(): Promise<Map<PttChannelKind, { enabled: boolean; config: Record<string, string> }>> {
    const entries = await Promise.all(
      PTT_CHANNEL_KINDS.map(async (kind) => [kind, await this.raw(kind)] as const),
    );
    return new Map(entries);
  }

  async update(
    kind: PttChannelKind,
    patch: { enabled?: boolean; config?: Record<string, string>; clearSecrets?: string[] },
    secretKeys: string[],
  ): Promise<void> {
    await this.ready();
    const current = await this.raw(kind);
    const next = { ...current.config };

    for (const [key, value] of Object.entries(patch.config ?? {})) {
      // A blank secret means "leave it alone" — the form never receives the
      // stored value, so it cannot echo it back.
      if (secretKeys.includes(key) && value === "") continue;
      next[key] = value;
    }
    for (const key of patch.clearSecrets ?? []) delete next[key];

    await this.db.query(
      `INSERT INTO ptt_provider_settings (kind, enabled, config, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (kind) DO UPDATE SET enabled = $2, config = $3::jsonb, updated_at = now()`,
      [kind, patch.enabled ?? current.enabled, JSON.stringify(next)],
    );
  }

  /** API-safe view: secret values replaced by the list of keys that are set. */
  redact(kind: PttChannelKind, raw: { enabled: boolean; config: Record<string, string>; updatedAt: string }, secretKeys: string[]): PttProviderSettings {
    const config: Record<string, string> = {};
    const secretsSet: string[] = [];
    for (const [key, value] of Object.entries(raw.config)) {
      if (secretKeys.includes(key)) {
        if (value?.trim()) secretsSet.push(key);
      } else {
        config[key] = value;
      }
    }
    return { kind, enabled: raw.enabled, config, secretsSet, updatedAt: raw.updatedAt };
  }

  // ── Per-event routes ───────────────────────────────────────────────────────

  /**
   * Routes for one event, with defaults filled in. A missing row means "not
   * configured yet", which defaults to **both directions on** — the point of
   * the integration is that traffic flows without per-event setup.
   */
  async routes(eventId: string): Promise<PttEventRoutes> {
    await this.ready();
    const { rows } = await this.db.query<{ kind: string; inbound: boolean; outbound: boolean }>(
      `SELECT kind, inbound, outbound FROM ptt_event_routes WHERE event_id = $1`,
      [eventId],
    );
    const stored = new Map(rows.map((r) => [r.kind, r]));
    return {
      eventId,
      routes: PTT_CHANNEL_KINDS.map<PttRoute>((kind) => {
        const row = stored.get(kind);
        return { kind, inbound: row?.inbound ?? true, outbound: row?.outbound ?? true };
      }),
    };
  }

  async setRoute(eventId: string, kind: PttChannelKind, patch: { inbound?: boolean; outbound?: boolean }): Promise<PttEventRoutes> {
    await this.ready();
    const current = (await this.routes(eventId)).routes.find((r) => r.kind === kind)!;
    await this.db.query(
      `INSERT INTO ptt_event_routes (event_id, kind, inbound, outbound, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (event_id, kind) DO UPDATE SET inbound = $3, outbound = $4, updated_at = now()`,
      [eventId, kind, patch.inbound ?? current.inbound, patch.outbound ?? current.outbound],
    );
    return this.routes(eventId);
  }

  /** Routes for many events in one query — the inbound fan-out path. */
  async routesFor(eventIds: string[]): Promise<Map<string, PttRoute[]>> {
    await this.ready();
    const result = new Map<string, PttRoute[]>();
    if (eventIds.length === 0) return result;
    const { rows } = await this.db.query<{ event_id: string; kind: string; inbound: boolean; outbound: boolean }>(
      `SELECT event_id, kind, inbound, outbound FROM ptt_event_routes WHERE event_id = ANY($1::text[])`,
      [eventIds],
    );
    for (const eventId of eventIds) {
      const stored = new Map(rows.filter((r) => r.event_id === eventId).map((r) => [r.kind, r]));
      result.set(
        eventId,
        PTT_CHANNEL_KINDS.map<PttRoute>((kind) => {
          const row = stored.get(kind);
          return { kind, inbound: row?.inbound ?? true, outbound: row?.outbound ?? true };
        }),
      );
    }
    return result;
  }
}

/**
 * Connection settings supplied through the environment. Handy for the Zello bot
 * credentials, which an operator may prefer to keep out of the database — and
 * it means a fresh deployment connects without anyone opening the dashboard.
 */
function envDefaults(kind: PttChannelKind): Record<string, string> {
  if (kind !== "zello") return {};
  const config: Record<string, string> = {};
  const put = (key: string, value?: string) => {
    if (value?.trim()) config[key] = value.trim();
  };
  put("wsUrl", process.env.ZELLO_WS_URL);
  // ZELLO_CHANNELS is the operator's list of reachable channels; only one can
  // be joined per connection, so the first is the default selection.
  put("channels", process.env.ZELLO_CHANNELS);
  put("channel", process.env.ZELLO_CHANNEL ?? process.env.ZELLO_CHANNELS?.split(",")[0]);
  put("username", process.env.ZELLO_USERNAME);
  put("password", process.env.ZELLO_PASSWORD);
  put("issuer", process.env.ZELLO_ISSUER);
  put("devToken", process.env.ZELLO_DEV_TOKEN);
  put("ignoredChannels", process.env.ZELLO_IGNORED_CHANNELS);

  const inlineKey = process.env.ZELLO_PRIVATE_KEY;
  const keyPath = process.env.ZELLO_PRIVATE_KEY_PATH;
  if (inlineKey?.trim()) {
    config.privateKey = inlineKey;
  } else if (keyPath?.trim()) {
    try {
      config.privateKey = readFileSync(keyPath.trim(), "utf8");
    } catch {
      // Left unset — the provider reports "not configured" rather than crashing.
    }
  }
  return config;
}

function toIso(value: string | Date): string {
  return typeof value === "string" ? value : new Date(value).toISOString();
}
