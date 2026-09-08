import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  RadioGatewayCommand,
  RadioGatewayCommandType,
  RadioGatewayEventOption,
  RadioGatewayReportRequest,
  RadioGatewayStatus,
  RadioGatewayTransmission,
  UpdateRadioGatewayRequest,
} from "@events/contracts";
import { DbService } from "../../../infra/db.service";
import { EventsService } from "../../../events/events.service";

/**
 * The fleet of radio gateway appliances (see `orangepi/` in this repo).
 *
 * Every box is behind a venue's NAT, so the link is strictly box-initiated:
 *
 *   POST /radio-gateway/report   once a minute — health in, work out
 *   GET  /radio-gateway/stream   held open ~25 s — the low-latency path for
 *                                outbound voice, since a minute of heartbeat
 *                                latency would make the bridge useless
 *   POST /radio-gateway/voice    a finished over-the-air transmission
 *
 * Long-polling rather than a socket is deliberate: event WiFi is frequently a
 * captive-portal router that mangles upgrade requests, and a plain GET that
 * times out and is retried is the one thing that always survives it.
 *
 * Registration is intentionally thin, as asked: a single shared key (the radio
 * provider's `apiKey` setting) plus a device id the box derives from its
 * machine-id. There is no per-device enrolment step — a box that knows the key
 * appears in the dashboard the first time it reports.
 */

/** How long a box may be silent before the dashboard calls it offline. */
const OFFLINE_AFTER_MS = 150_000;
/** Cap on the per-gateway outbound backlog; voice older than this is stale. */
const MAX_QUEUE = 20;
const MAX_TRANSMISSIONS = 500;

export interface QueuedOutbound {
  id: string;
  at: string;
  kind: "voice" | "text";
  author: string;
  /** Server-relative URL the box downloads; already Opus/Ogg for voice. */
  audioUrl?: string;
  text?: string;
}

interface GatewayRecord {
  id: string;
  name: string;
  eventId: string | null;
  ttsEnabled: boolean;
  version: string;
  lastSeenAt: string | null;
  report: RadioGatewayReportRequest | null;
  commands: RadioGatewayCommand[];
  outbox: QueuedOutbound[];
  counters: { inbound: number; outbound: number };
  /** Resolvers of long-polls currently parked on this gateway. */
  waiters: Array<(items: QueuedOutbound[]) => void>;
}

@Injectable()
export class RadioGatewayService {
  private readonly logger = new Logger(RadioGatewayService.name);
  private readonly gateways = new Map<string, GatewayRecord>();
  private readonly transmissions: RadioGatewayTransmission[] = [];
  private schema: Promise<void> | null = null;
  private loaded: Promise<void> | null = null;

  /** Set by the provider so a gateway coming online can refresh its status. */
  private onChange: (() => void) | null = null;

  constructor(
    private readonly db: DbService,
    private readonly events: EventsService,
  ) {}

  bind(onChange: () => void): void {
    this.onChange = onChange;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private ready(): Promise<void> {
    this.loaded ??= this.init().catch((err: Error) => {
      // Let the next call retry rather than poisoning the service.
      this.loaded = null;
      this.logger.error(`radio gateway store setup failed: ${err.message}`);
      throw err;
    });
    return this.loaded;
  }

  private async init(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS radio_gateways (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event_id TEXT,
        tts_enabled BOOLEAN NOT NULL DEFAULT false,
        version TEXT,
        last_seen_at TIMESTAMPTZ,
        counters JSONB NOT NULL DEFAULT '{"inbound":0,"outbound":0}'::jsonb
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS radio_gateway_transmissions (
        id TEXT PRIMARY KEY,
        gateway_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        duration_ms INTEGER NOT NULL DEFAULT 0,
        audio_url TEXT,
        transcript TEXT,
        party TEXT,
        peak_level REAL
      )
    `);
    await this.db.query(
      `CREATE INDEX IF NOT EXISTS idx_rgw_tx_gateway ON radio_gateway_transmissions (gateway_id, at DESC)`,
    );

    const rows = await this.db.query<{
      id: string;
      name: string;
      event_id: string | null;
      tts_enabled: boolean;
      version: string | null;
      last_seen_at: Date | null;
      counters: { inbound: number; outbound: number };
    }>(`SELECT * FROM radio_gateways`);
    for (const row of rows.rows) {
      this.gateways.set(row.id, {
        id: row.id,
        name: row.name,
        eventId: row.event_id,
        ttsEnabled: row.tts_enabled,
        version: row.version ?? "unknown",
        lastSeenAt: row.last_seen_at?.toISOString() ?? null,
        report: null,
        commands: [],
        outbox: [],
        counters: row.counters ?? { inbound: 0, outbound: 0 },
        waiters: [],
      });
    }

    const tx = await this.db.query<{
      id: string;
      gateway_id: string;
      direction: "rx" | "tx";
      at: Date;
      duration_ms: number;
      audio_url: string | null;
      transcript: string | null;
      party: string | null;
      peak_level: number | null;
    }>(`SELECT * FROM radio_gateway_transmissions ORDER BY at DESC LIMIT $1`, [MAX_TRANSMISSIONS]);
    for (const row of tx.rows.reverse()) {
      this.transmissions.push({
        id: row.id,
        gatewayId: row.gateway_id,
        direction: row.direction,
        at: row.at.toISOString(),
        durationMs: row.duration_ms,
        audioUrl: row.audio_url ?? undefined,
        transcript: row.transcript ?? undefined,
        party: row.party ?? undefined,
        peakLevel: row.peak_level ?? undefined,
      });
    }
  }

  private async persist(record: GatewayRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO radio_gateways (id, name, event_id, tts_enabled, version, last_seen_at, counters)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         event_id = EXCLUDED.event_id,
         tts_enabled = EXCLUDED.tts_enabled,
         version = EXCLUDED.version,
         last_seen_at = EXCLUDED.last_seen_at,
         counters = EXCLUDED.counters`,
      [
        record.id,
        record.name,
        record.eventId,
        record.ttsEnabled,
        record.version,
        record.lastSeenAt,
        JSON.stringify(record.counters),
      ],
    );
  }

  // ── Device-facing ──────────────────────────────────────────────────────────

  /**
   * A heartbeat. Stores what the box reported and hands back everything it
   * needs to act on: its binding, the pickable events, the routing switches and
   * any queued commands. Commands are handed over exactly once — a box that
   * crashes mid-command simply misses it, which is the right failure for
   * "reboot" and "go back to AP".
   */
  async report(input: RadioGatewayReportRequest): Promise<{
    record: GatewayRecord;
    events: RadioGatewayEventOption[];
    commands: RadioGatewayCommand[];
  }> {
    await this.ready();
    const record = this.upsert(input.id, input.name);
    record.name = input.name || record.name;
    record.version = input.version;
    record.report = input;
    record.lastSeenAt = new Date().toISOString();
    record.counters = input.counters ?? record.counters;

    const commands = record.commands;
    record.commands = [];

    await this.persist(record);
    this.onChange?.();
    return { record, events: this.eventOptions(), commands };
  }

  /**
   * Long-poll for outbound traffic. Resolves the instant something is queued,
   * or with an empty list when the window closes so the box can poll again.
   */
  async waitForOutbound(gatewayId: string, timeoutMs: number): Promise<QueuedOutbound[]> {
    await this.ready();
    const record = this.gateways.get(gatewayId);
    if (!record) return [];
    if (record.outbox.length > 0) return record.outbox.splice(0, record.outbox.length);

    return new Promise((resolve) => {
      const waiter = (items: QueuedOutbound[]): void => {
        clearTimeout(timer);
        resolve(items);
      };
      const timer = setTimeout(() => {
        record.waiters = record.waiters.filter((w) => w !== waiter);
        resolve([]);
      }, timeoutMs);
      // Node keeps the process alive for pending timers; this one is pure idle.
      timer.unref?.();
      record.waiters.push(waiter);
    });
  }

  /** The event a box is bound to, or null when it has not been set up yet. */
  boundEvent(gatewayId: string): string | null {
    return this.gateways.get(gatewayId)?.eventId ?? null;
  }

  /** Called when the box's own setup screen picks an event. */
  async selectEvent(gatewayId: string, eventId: string | null): Promise<void> {
    await this.ready();
    const record = this.gateways.get(gatewayId);
    if (!record) return;
    record.eventId = eventId && this.events.findById(eventId) ? eventId : null;
    await this.persist(record);
    this.onChange?.();
  }

  async recordTransmission(entry: Omit<RadioGatewayTransmission, "id">): Promise<RadioGatewayTransmission> {
    await this.ready();
    const row: RadioGatewayTransmission = { id: randomUUID(), ...entry };
    this.transmissions.push(row);
    if (this.transmissions.length > MAX_TRANSMISSIONS) {
      this.transmissions.splice(0, this.transmissions.length - MAX_TRANSMISSIONS);
    }
    const record = this.gateways.get(entry.gatewayId);
    if (record) {
      if (entry.direction === "rx") record.counters.inbound++;
      else record.counters.outbound++;
      await this.persist(record);
    }
    await this.db.query(
      `INSERT INTO radio_gateway_transmissions
         (id, gateway_id, direction, at, duration_ms, audio_url, transcript, party, peak_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.id,
        row.gatewayId,
        row.direction,
        row.at,
        row.durationMs,
        row.audioUrl ?? null,
        row.transcript ?? null,
        row.party ?? null,
        row.peakLevel ?? null,
      ],
    );
    this.onChange?.();
    return row;
  }

  // ── Dashboard-facing ───────────────────────────────────────────────────────

  async list(): Promise<RadioGatewayStatus[]> {
    await this.ready();
    return [...this.gateways.values()]
      .map((record) => this.toStatus(record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async update(id: string, patch: UpdateRadioGatewayRequest): Promise<RadioGatewayStatus | null> {
    await this.ready();
    const record = this.gateways.get(id);
    if (!record) return null;
    if (patch.name !== undefined) record.name = patch.name.trim() || record.name;
    if (patch.ttsEnabled !== undefined) record.ttsEnabled = patch.ttsEnabled;
    if (patch.eventId !== undefined) {
      record.eventId = patch.eventId && this.events.findById(patch.eventId) ? patch.eventId : null;
      // Tell the box straight away rather than making it wait for a heartbeat.
      this.enqueueCommand(record, "set_event", record.eventId ?? "");
    }
    await this.persist(record);
    this.onChange?.();
    return this.toStatus(record);
  }

  /**
   * Queue a command for the box to pick up on its next heartbeat. This is the
   * "bring the AP back" path: the box has already left AP mode and joined the
   * venue WiFi, so the only way to reach it is to wait for it to ask.
   */
  async command(id: string, type: RadioGatewayCommandType, arg?: string, issuedBy?: string): Promise<RadioGatewayCommand | null> {
    await this.ready();
    const record = this.gateways.get(id);
    if (!record) return null;
    return this.enqueueCommand(record, type, arg, issuedBy);
  }

  async transmissionsFor(gatewayId?: string, limit = 100): Promise<RadioGatewayTransmission[]> {
    await this.ready();
    return this.transmissions
      .filter((t) => !gatewayId || t.gatewayId === gatewayId)
      .slice(-limit)
      .reverse();
  }

  /** Gateways bound to this event that are currently reachable. */
  onlineForEvent(eventId: string): RadioGatewayStatus[] {
    return [...this.gateways.values()]
      .filter((r) => r.eventId === eventId && this.isOnline(r))
      .map((r) => this.toStatus(r));
  }

  /** Queue one outbound item on every online box bound to the event. */
  deliver(eventId: string, item: Omit<QueuedOutbound, "id" | "at">): number {
    let delivered = 0;
    for (const record of this.gateways.values()) {
      if (record.eventId !== eventId || !this.isOnline(record)) continue;
      // Speech synthesis is opt-in per box: with it off, text simply does not
      // go on the air rather than being queued for a box that will drop it.
      if (item.kind === "text" && !record.ttsEnabled) continue;
      const queued: QueuedOutbound = { id: randomUUID(), at: new Date().toISOString(), ...item };
      const waiter = record.waiters.shift();
      if (waiter) {
        waiter([queued]);
      } else {
        record.outbox.push(queued);
        // Drop the oldest rather than the newest: on a half-duplex channel a
        // backlog of stale voice is worse than losing the start of it.
        if (record.outbox.length > MAX_QUEUE) record.outbox.shift();
      }
      delivered++;
    }
    return delivered;
  }

  /** True when at least one box anywhere is reporting in. */
  anyOnline(): boolean {
    return [...this.gateways.values()].some((r) => this.isOnline(r));
  }

  count(): { total: number; online: number } {
    const all = [...this.gateways.values()];
    return { total: all.length, online: all.filter((r) => this.isOnline(r)).length };
  }

  eventOptions(): RadioGatewayEventOption[] {
    return this.events
      .list()
      .filter((e) => e.status === "active" || e.status === "draft")
      .map((e) => ({
        id: e.id,
        name: e.title,
        status: e.status,
        // `dates` is the event's day list; the first is the one an operator
        // recognises when picking a box's event on site.
        startsAt: e.dates?.[0],
      }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private enqueueCommand(
    record: GatewayRecord,
    type: RadioGatewayCommandType,
    arg?: string,
    issuedBy?: string,
  ): RadioGatewayCommand {
    const command: RadioGatewayCommand = {
      id: randomUUID(),
      type,
      arg,
      issuedAt: new Date().toISOString(),
      issuedBy,
    };
    // One pending command of each type is enough — clicking "reboot" twice
    // should not reboot twice.
    record.commands = record.commands.filter((c) => c.type !== type);
    record.commands.push(command);
    this.logger.log(`queued "${type}" for gateway ${record.name} (${record.id})`);
    this.onChange?.();
    return command;
  }

  private upsert(id: string, name: string): GatewayRecord {
    const existing = this.gateways.get(id);
    if (existing) return existing;
    const record: GatewayRecord = {
      id,
      name: name || `Gateway ${id.slice(0, 6)}`,
      eventId: null,
      ttsEnabled: false,
      version: "unknown",
      lastSeenAt: null,
      report: null,
      commands: [],
      outbox: [],
      counters: { inbound: 0, outbound: 0 },
      waiters: [],
    };
    this.gateways.set(id, record);
    this.logger.log(`new radio gateway registered: ${record.name} (${id})`);
    return record;
  }

  private isOnline(record: GatewayRecord): boolean {
    if (!record.lastSeenAt) return false;
    return Date.now() - Date.parse(record.lastSeenAt) < OFFLINE_AFTER_MS;
  }

  private toStatus(record: GatewayRecord): RadioGatewayStatus {
    const report = record.report;
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      eventId: record.eventId ?? undefined,
      eventName: record.eventId ? (this.events.findById(record.eventId)?.title ?? undefined) : undefined,
      online: this.isOnline(record),
      lastSeenAt: record.lastSeenAt ?? undefined,
      netMode: report?.netMode ?? "offline",
      ssid: report?.ssid,
      signal: report?.signal,
      localIp: report?.localIp,
      audio: report?.audio ?? {
        rxLevel: 0,
        txLevel: 0,
        receiving: false,
        transmitting: false,
        pttBackend: "none",
      },
      health: report?.health ?? { uptimeS: 0, queued: 0 },
      counters: record.counters,
      pending: record.commands,
      ttsEnabled: record.ttsEnabled,
    };
  }
}
