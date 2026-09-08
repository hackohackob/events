import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../logger";
import { sleep } from "../util";
import { OUTBOX_DIR, VERSION, isProvisioned, type GatewayConfig } from "../config";
import type { EventOption, GatewayCommand, OutboundItem, ReportRequest, ReportResponse } from "../types";

/**
 * The link to the events server.
 *
 * Strictly outbound, because a box sits behind a venue's router and nothing
 * dials in. Three loops:
 *
 *   report  every 60 s — health up, commands and the event list down
 *   stream  a long poll that returns the moment there is something to transmit
 *   outbox  retries whatever could not be uploaded while the link was down
 *
 * Nothing here throws at its caller. A gateway that crashes because the WiFi
 * dropped is a gateway that is not recording the race when the WiFi comes back,
 * so every failure is logged, counted, and retried.
 */

export interface UplinkState {
  connected: boolean;
  lastReportAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  serverEventId?: string;
  events: EventOption[];
  routes: { inbound: boolean; outbound: boolean };
  ttsEnabled: boolean;
  latestVersion?: string;
  queued: number;
}

export declare interface Uplink {
  on(event: "outbound", listener: (item: OutboundItem) => void): this;
  on(event: "command", listener: (command: GatewayCommand) => void): this;
  on(event: "state", listener: (state: UplinkState) => void): this;
  on(event: string, listener: (...args: never[]) => void): this;
}

export class Uplink extends EventEmitter {
  private state: UplinkState = {
    connected: false,
    events: [],
    routes: { inbound: true, outbound: true },
    ttsEnabled: false,
    queued: 0,
  };
  private running = false;
  private counters = { inbound: 0, outbound: 0 };

  /** Supplied by the daemon: the health block for the next report. */
  private snapshot: (() => Omit<ReportRequest, "id" | "name" | "version" | "counters">) | null = null;

  constructor(private config: GatewayConfig) {
    super();
    mkdirSync(OUTBOX_DIR, { recursive: true });
  }

  bindSnapshot(fn: () => Omit<ReportRequest, "id" | "name" | "version" | "counters">): void {
    this.snapshot = fn;
  }

  applyConfig(config: GatewayConfig): void {
    this.config = config;
  }

  current(): UplinkState {
    return { ...this.state };
  }

  countInbound(): void {
    this.counters.inbound++;
  }
  countOutbound(): void {
    this.counters.outbound++;
  }

  healthy(): boolean {
    return this.state.connected;
  }

  private set(patch: Partial<UplinkState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("state", this.current());
  }

  private get base(): string {
    return this.config.serverUrl.replace(/\/+$/, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "X-Gateway-Key": this.config.gatewayKey, ...extra };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.reportLoop();
    void this.streamLoop();
    void this.outboxLoop();
  }

  stop(): void {
    this.running = false;
  }

  // ── Report loop ────────────────────────────────────────────────────────────

  private async reportLoop(): Promise<void> {
    while (this.running) {
      await this.reportOnce();
      // A minute, as configured — the box is idle otherwise, and on a venue's
      // congested WiFi a chattier heartbeat buys nothing.
      await sleep(60_000);
    }
  }

  /** One heartbeat. Public so the console can force a check-in immediately. */
  async reportOnce(): Promise<ReportResponse | null> {
    if (!isProvisioned(this.config)) {
      this.set({ connected: false, lastError: "Not set up yet — no server or key." });
      return null;
    }
    const snapshot = this.snapshot?.();
    if (!snapshot) return null;

    const body: ReportRequest = {
      id: this.config.id,
      name: this.config.name,
      version: VERSION,
      ...snapshot,
      counters: { ...this.counters },
    };

    try {
      const res = await fetch(`${this.base}/radio-gateway/report`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        this.fail(await describe(res));
        return null;
      }
      const payload = (await res.json()) as ReportResponse;
      this.set({
        connected: true,
        lastReportAt: new Date().toISOString(),
        lastError: undefined,
        serverEventId: payload.eventId,
        events: payload.events ?? [],
        routes: payload.routes ?? { inbound: true, outbound: true },
        ttsEnabled: payload.ttsEnabled ?? false,
        latestVersion: payload.latestVersion,
      });
      for (const command of payload.commands ?? []) {
        log.info("server", `command from the dashboard: ${command.type}`, { by: command.issuedBy ?? "" });
        this.emit("command", command);
      }
      return payload;
    } catch (err) {
      this.fail((err as Error).message);
      return null;
    }
  }

  private fail(detail: string): void {
    const wasConnected = this.state.connected;
    this.set({ connected: false, lastError: detail, lastErrorAt: new Date().toISOString() });
    if (wasConnected) log.warn("server", `lost the server: ${detail}`);
    else log.debug("server", `still cannot reach the server: ${detail}`);
  }

  // ── Outbound stream ────────────────────────────────────────────────────────

  /**
   * A long poll the server answers the instant something needs transmitting.
   * Chosen over a websocket because event WiFi is very often a captive-portal
   * router that mangles protocol upgrades but has never broken a plain GET.
   */
  private async streamLoop(): Promise<void> {
    while (this.running) {
      if (!isProvisioned(this.config)) {
        await sleep(5_000);
        continue;
      }
      try {
        const res = await fetch(
          `${this.base}/radio-gateway/stream?id=${encodeURIComponent(this.config.id)}`,
          { headers: this.headers(), signal: AbortSignal.timeout(35_000) },
        );
        if (!res.ok) {
          // 401 means the key is wrong or the bridge is off; hammering it helps
          // nobody, so back off further than a transport error would.
          await sleep(res.status === 401 ? 30_000 : 5_000);
          continue;
        }
        const payload = (await res.json()) as { items: OutboundItem[] };
        for (const item of payload.items ?? []) this.emit("outbound", item);
      } catch {
        // Includes the normal case of the poll timing out with nothing to do.
        await sleep(2_000);
      }
    }
  }

  // ── Uploads ────────────────────────────────────────────────────────────────

  /**
   * Send a received transmission up. On failure the audio is written to the
   * outbox and retried — a race does not stop because the WiFi did, and the
   * chat log should read the same either way, just later.
   */
  async uploadTransmission(input: {
    audio: Buffer;
    durationMs: number;
    peakLevel: number;
    from: string;
    recordingId: string;
  }): Promise<boolean> {
    const ok = await this.postVoice(input);
    if (ok) {
      this.counters.inbound++;
      return true;
    }
    this.queueForRetry(input);
    return false;
  }

  private async postVoice(input: {
    audio: Buffer;
    durationMs: number;
    peakLevel: number;
    from: string;
  }): Promise<boolean> {
    if (!isProvisioned(this.config)) return false;
    try {
      const form = new FormData();
      form.append("id", this.config.id);
      form.append("durationMs", String(Math.round(input.durationMs)));
      form.append("peakLevel", String(input.peakLevel));
      form.append("from", input.from);
      form.append("audio", new Blob([new Uint8Array(input.audio)], { type: "audio/ogg" }), "transmission.ogg");

      const res = await fetch(`${this.base}/radio-gateway/voice`, {
        method: "POST",
        headers: this.headers(),
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        log.warn("server", `the server rejected a transmission: ${await describe(res)}`);
        return false;
      }
      const payload = (await res.json()) as { accepted: boolean };
      if (!payload.accepted) {
        log.warn("server", "the server took the transmission but no event is bound to this box");
      }
      return true;
    } catch (err) {
      log.warn("server", `could not upload a transmission: ${(err as Error).message}`);
      return false;
    }
  }

  /** Tell the server something queued for the air actually went out. */
  async confirmTransmitted(durationMs: number, party?: string, text?: string): Promise<void> {
    this.counters.outbound++;
    if (!isProvisioned(this.config)) return;
    try {
      await fetch(`${this.base}/radio-gateway/transmitted`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: this.config.id, durationMs: Math.round(durationMs), party, text }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Purely a log entry on the server side; not worth a retry queue.
    }
  }

  /** Tell the server which event this box was pointed at in its own setup. */
  async selectEvent(eventId: string | null): Promise<boolean> {
    if (!isProvisioned(this.config)) return false;
    try {
      const res = await fetch(`${this.base}/radio-gateway/select-event`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: this.config.id, eventId }),
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok;
    } catch (err) {
      log.warn("server", `could not set the event: ${(err as Error).message}`);
      return false;
    }
  }

  /** Ask the server to speak a line, and fetch the audio it renders. */
  async speak(text: string): Promise<Buffer | null> {
    if (!isProvisioned(this.config)) return null;
    try {
      const res = await fetch(`${this.base}/radio-gateway/speak`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { audioUrl: string | null };
      return payload.audioUrl ? this.download(payload.audioUrl) : null;
    } catch (err) {
      log.warn("server", `speech failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Fetch a media URL the server handed over (voice notes, speech). */
  async download(url: string): Promise<Buffer | null> {
    const absolute = url.startsWith("http")
      ? url
      : // Media lives at the server root, not under the /api prefix.
        `${this.base.replace(/\/api$/, "")}${url}`;
    try {
      const res = await fetch(absolute, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) {
        log.warn("server", `could not download ${absolute}: ${res.status}`);
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      log.warn("server", `could not download audio: ${(err as Error).message}`);
      return null;
    }
  }

  // ── Store and forward ──────────────────────────────────────────────────────

  private queueForRetry(input: {
    audio: Buffer;
    durationMs: number;
    peakLevel: number;
    from: string;
    recordingId: string;
  }): void {
    try {
      mkdirSync(OUTBOX_DIR, { recursive: true });
      const stem = join(OUTBOX_DIR, `${Date.now()}-${input.recordingId.slice(0, 8)}`);
      writeFileSync(`${stem}.ogg`, input.audio);
      writeFileSync(
        `${stem}.json`,
        JSON.stringify({
          durationMs: input.durationMs,
          peakLevel: input.peakLevel,
          from: input.from,
          recordingId: input.recordingId,
        }),
      );
      log.info("server", "the link is down — the transmission is queued and will be sent when it returns");
      void this.refreshQueueCount();
    } catch (err) {
      log.error("server", `could not queue a transmission: ${(err as Error).message}`);
    }
  }

  private async outboxLoop(): Promise<void> {
    while (this.running) {
      await sleep(20_000);
      if (!this.state.connected) continue;
      await this.flushOutbox();
    }
  }

  /** Public so the console's "retry now" button can call it. */
  async flushOutbox(): Promise<number> {
    let sent = 0;
    try {
      const files = (await readdir(OUTBOX_DIR)).filter((f) => f.endsWith(".json")).sort();
      for (const file of files) {
        const stem = join(OUTBOX_DIR, file.replace(/\.json$/, ""));
        if (!existsSync(`${stem}.ogg`)) {
          unlinkSync(`${stem}.json`);
          continue;
        }
        const meta = JSON.parse(readFileSync(`${stem}.json`, "utf8")) as {
          durationMs: number;
          peakLevel: number;
          from: string;
          recordingId: string;
        };
        const ok = await this.postVoice({ audio: readFileSync(`${stem}.ogg`), ...meta });
        if (!ok) break; // The link is down again; the rest keeps for later.
        unlinkSync(`${stem}.ogg`);
        unlinkSync(`${stem}.json`);
        this.emit("uploaded", meta.recordingId);
        this.counters.inbound++;
        sent++;
      }
      if (sent > 0) log.info("server", `sent ${sent} queued transmission${sent === 1 ? "" : "s"}`);
    } catch (err) {
      log.warn("server", `could not flush the queue: ${(err as Error).message}`);
    }
    await this.refreshQueueCount();
    return sent;
  }

  async refreshQueueCount(): Promise<number> {
    try {
      const queued = (await readdir(OUTBOX_DIR)).filter((f) => f.endsWith(".json")).length;
      if (queued !== this.state.queued) this.set({ queued });
      return queued;
    } catch {
      return 0;
    }
  }
}

async function describe(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  if (res.status === 401) return "the gateway key was rejected (or the radio bridge is switched off)";
  return `${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`;
}
