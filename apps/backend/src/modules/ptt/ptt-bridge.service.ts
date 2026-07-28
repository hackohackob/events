import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type {
  EventMessage,
  PttChannelKind,
  PttOverview,
  PttProviderInfo,
  PttProviderStatus,
  UpdatePttProviderRequest,
} from "@events/contracts";
import { PTT_CHANNEL_KINDS } from "@events/contracts";
import { EventChatService } from "../event-chat/event-chat.service";
import { EventsService } from "../events/events.service";
import { PttBusService } from "../infra/ptt-bus.service";
import { RedisService } from "../infra/redis.service";
import { TranscriptionService } from "../incidents/transcription.service";
import { PttMediaService } from "./ptt-media.service";
import { PttSettingsService } from "./ptt-settings.service";
import { RadioProvider } from "./providers/radio/radio.provider";
import type { InboundPttMessage, PttProvider } from "./providers/ptt-provider";
import { ZelloProvider } from "./providers/zello/zello.provider";

/**
 * The PTT hub.
 *
 * Holds one long-lived connection per external network for the whole server and
 * fans traffic between those networks and every **active** event's team chat:
 *
 *   channel → app   for each active event whose `inbound` switch is on
 *   app → channel   for each provider whose `outbound` switch is on for that event
 *
 * Loop prevention is structural rather than heuristic: inbound messages are
 * written with an `origin`, and `EventChatService` only ever hands *originless*
 * (app-authored) messages to the outbound bus. Cross-bridge relay (radio →
 * Zello via the app) is deliberately not done — it would need loop detection
 * the current tagging cannot provide.
 */
@Injectable()
export class PttBridgeService implements OnModuleInit {
  private readonly logger = new Logger(PttBridgeService.name);
  private readonly providers = new Map<PttChannelKind, PttProvider>();
  private readonly counters = new Map<PttChannelKind, { inbound: number; outbound: number; lastInboundAt?: string; lastOutboundAt?: string }>();
  /** Rolling activity log surfaced in the dashboard for troubleshooting. */
  private readonly activity: Array<{ at: string; kind: PttChannelKind | "bridge"; level: string; message: string }> = [];

  constructor(
    private readonly settings: PttSettingsService,
    private readonly events: EventsService,
    private readonly chat: EventChatService,
    private readonly media: PttMediaService,
    private readonly transcription: TranscriptionService,
    private readonly bus: PttBusService,
    private readonly redis: RedisService,
    zello: ZelloProvider,
    radio: RadioProvider,
  ) {
    for (const provider of [zello, radio] as PttProvider[]) {
      this.providers.set(provider.kind, provider);
      this.counters.set(provider.kind, { inbound: 0, outbound: 0 });
      provider.bind({
        onMessage: (message) => void this.handleInbound(provider.kind, message),
        onStatus: () => void this.broadcastStatus(),
        onLog: (level, message) => this.note(provider.kind, level, message),
      });
    }
  }

  async onModuleInit(): Promise<void> {
    this.bus.onOutbound((message) => void this.handleOutbound(message));
    await this.reload();
  }

  // ── Settings surface ───────────────────────────────────────────────────────

  async overview(): Promise<PttOverview> {
    const providers: PttProviderInfo[] = [];
    const settings = [];
    for (const kind of PTT_CHANNEL_KINDS) {
      const provider = this.providers.get(kind);
      if (!provider) continue;
      providers.push({
        kind,
        label: provider.label,
        description: provider.description,
        available: provider.available,
        capabilities: provider.capabilities,
        fields: provider.fields,
      });
      const raw = await this.settings.raw(kind);
      settings.push(this.settings.redact(kind, raw, this.secretKeys(provider)));
    }
    return { providers, settings, statuses: await this.statuses() };
  }

  async statuses(): Promise<PttProviderStatus[]> {
    const out: PttProviderStatus[] = [];
    for (const kind of PTT_CHANNEL_KINDS) {
      const provider = this.providers.get(kind);
      if (!provider) continue;
      const raw = await this.settings.raw(kind);
      const runtime = provider.status();
      const counters = this.counters.get(kind)!;
      out.push({
        kind,
        enabled: raw.enabled,
        configured: provider.isConfigured(raw.config),
        state: runtime.state,
        detail: runtime.detail,
        channel: runtime.channel,
        usersOnline: runtime.usersOnline,
        connectedAt: runtime.connectedAt,
        lastInboundAt: counters.lastInboundAt,
        lastOutboundAt: counters.lastOutboundAt,
        inboundCount: counters.inbound,
        outboundCount: counters.outbound,
      });
    }
    return out;
  }

  recentActivity(): Array<{ at: string; kind: string; level: string; message: string }> {
    return [...this.activity].reverse();
  }

  async updateProvider(kind: PttChannelKind, patch: UpdatePttProviderRequest): Promise<PttOverview> {
    const provider = this.providers.get(kind);
    if (!provider) throw new Error(`unknown PTT channel ${kind}`);
    await this.settings.update(kind, patch, this.secretKeys(provider));
    await this.reload(kind);
    return this.overview();
  }

  /** Re-apply stored settings to one provider, or to all of them. */
  async reload(only?: PttChannelKind): Promise<void> {
    for (const kind of PTT_CHANNEL_KINDS) {
      if (only && only !== kind) continue;
      const provider = this.providers.get(kind);
      if (!provider) continue;
      const raw = await this.settings.raw(kind);
      const enabled = raw.enabled && provider.available;
      try {
        await provider.apply(enabled, raw.config);
      } catch (err) {
        this.note(kind, "error", `could not apply settings: ${(err as Error).message}`);
      }
    }
    await this.broadcastStatus();
  }

  /** Send a probe message so an operator can confirm the wiring end to end. */
  async sendTest(kind: PttChannelKind, text: string): Promise<void> {
    const provider = this.providers.get(kind);
    if (!provider) throw new Error(`unknown PTT channel ${kind}`);
    await provider.send({ kind: "text", author: "Command centre", text });
    this.countOutbound(kind);
    this.note(kind, "info", `test message sent: ${text}`);
  }

  // ── Inbound: external network → every active event ─────────────────────────

  private async handleInbound(kind: PttChannelKind, message: InboundPttMessage): Promise<void> {
    const eventIds = await this.eventsAccepting(kind, "inbound");
    if (eventIds.length === 0) {
      this.note(kind, "info", `dropped ${message.kind} from ${message.from} — no active event is listening`);
      return;
    }

    try {
      // Media is stored once and the URL shared by every event's copy.
      const payload = await this.toChatPayload(message);
      for (const eventId of eventIds) {
        await this.chat.addFromBridge(eventId, kind, message.from, payload);
      }
      this.countInbound(kind);
      this.note(kind, "info", `${message.kind} from ${message.from} → ${eventIds.length} event(s)`);
    } catch (err) {
      this.note(kind, "error", `inbound ${message.kind} failed: ${(err as Error).message}`);
    }
  }

  private async toChatPayload(message: InboundPttMessage): Promise<InboundChatPayload> {
    switch (message.kind) {
      case "text":
        return { kind: "text", text: message.text };

      // Photos and locations also get a plain-text line. It is what any client
      // that cannot render the attachment falls back to, and it keeps the
      // message readable in the log instead of showing up as an empty bubble.
      case "location":
        return {
          kind: "location",
          text: message.address ?? `${message.lat.toFixed(5)}, ${message.lng.toFixed(5)}`,
          location: {
            lat: message.lat,
            lng: message.lng,
            address: message.address,
            accuracyM: message.accuracyM,
          },
        };

      case "image": {
        const imageUrl = await this.media.storeUpload(message.full, message.extension, "ptt-photo");
        const thumbnailUrl = message.thumbnail
          ? await this.media.storeUpload(message.thumbnail, message.extension, "ptt-thumb")
          : undefined;
        return { kind: "image", imageUrl, thumbnailUrl };
      }

      case "voice": {
        const audioUrl = await this.media.storeUpload(message.audio, message.extension, "ptt-voice");
        // Transcribing radio traffic is the difference between a wall of voice
        // notes and a readable log, so it is worth the round trip.
        const transcript = await this.transcription
          .transcribe(this.media.absolutePath(audioUrl), message.extension === "m4a" ? "audio/m4a" : "audio/ogg")
          .catch(() => null);
        return {
          kind: "voice",
          audioUrl,
          audioDurationMs: message.durationMs,
          transcript: transcript ?? undefined,
        };
      }
    }
  }

  // ── Outbound: app chat → external networks ─────────────────────────────────

  private async handleOutbound(message: EventMessage): Promise<void> {
    // Belt and braces: EventChatService already filters these out.
    if (message.origin && message.origin !== "app") return;
    // Only live events go on the air. Chatter in a draft event being set up, or
    // in one already closed down, has no business on a shared channel.
    if (this.events.findById(message.eventId)?.status !== "active") return;

    const routes = (await this.settings.routes(message.eventId)).routes;
    for (const route of routes) {
      if (!route.outbound) continue;
      const provider = this.providers.get(route.kind);
      if (!provider?.available) continue;
      const raw = await this.settings.raw(route.kind);
      if (!raw.enabled) continue;

      const outbound = this.toProviderMessage(message, route.kind);
      if (!outbound) continue;
      try {
        await provider.send(outbound);
        this.countOutbound(route.kind);
      } catch (err) {
        // A bridge failure must never break chat — the message is already
        // stored and delivered in-app.
        this.note(route.kind, "warn", `outbound ${message.kind} failed: ${(err as Error).message}`);
      }
    }
  }

  private toProviderMessage(message: EventMessage, kind: PttChannelKind): OutboundForProvider | null {
    const provider = this.providers.get(kind);
    if (!provider) return null;
    const author = message.authorName || "Team";

    switch (message.kind) {
      case "text":
        if (!provider.capabilities.text || !message.text?.trim()) return null;
        return { kind: "text", author, text: message.text.trim() };

      case "location": {
        if (!provider.capabilities.location || !message.location) return null;
        return {
          kind: "location",
          author,
          lat: message.location.lat,
          lng: message.location.lng,
          address: message.location.address,
          accuracyM: message.location.accuracyM,
        };
      }

      case "image":
        if (!message.imageUrl) return null;
        // A network without image support still gets told a photo was posted.
        if (!provider.capabilities.image) {
          return provider.capabilities.text
            ? { kind: "text", author, text: `sent a photo${message.text ? `: ${message.text}` : ""}` }
            : null;
        }
        return {
          kind: "image",
          author,
          imagePath: this.media.absolutePath(message.imageUrl),
          caption: message.text,
        };

      case "voice":
        if (!message.audioUrl) return null;
        if (!provider.capabilities.voice) {
          return provider.capabilities.text && message.transcript
            ? { kind: "text", author, text: `(voice) ${message.transcript}` }
            : null;
        }
        return {
          kind: "voice",
          author,
          audioPath: this.media.absolutePath(message.audioUrl),
          transcript: message.transcript,
        };

      default:
        return null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Active events with the given direction switched on for this channel. */
  private async eventsAccepting(kind: PttChannelKind, direction: "inbound" | "outbound"): Promise<string[]> {
    const activeIds = this.events.list().filter((e) => e.status === "active").map((e) => e.id);
    if (activeIds.length === 0) return [];
    const routes = await this.settings.routesFor(activeIds);
    return activeIds.filter((id) => {
      const route = routes.get(id)?.find((r) => r.kind === kind);
      return route ? route[direction] : true;
    });
  }

  private secretKeys(provider: PttProvider): string[] {
    return provider.fields.filter((f) => f.type === "secret").map((f) => f.key);
  }

  private countInbound(kind: PttChannelKind): void {
    const counters = this.counters.get(kind)!;
    counters.inbound++;
    counters.lastInboundAt = new Date().toISOString();
  }

  private countOutbound(kind: PttChannelKind): void {
    const counters = this.counters.get(kind)!;
    counters.outbound++;
    counters.lastOutboundAt = new Date().toISOString();
  }

  private note(kind: PttChannelKind | "bridge", level: string, message: string): void {
    this.activity.push({ at: new Date().toISOString(), kind, level, message });
    if (this.activity.length > 200) this.activity.splice(0, this.activity.length - 200);
    if (level === "error") this.logger.error(`[${kind}] ${message}`);
    else if (level === "warn") this.logger.warn(`[${kind}] ${message}`);
    else this.logger.log(`[${kind}] ${message}`);
  }

  /** Push status to every active event's ops room so both UIs stay live. */
  private async broadcastStatus(): Promise<void> {
    const statuses = await this.statuses().catch(() => []);
    for (const event of this.events.list()) {
      if (event.status !== "active") continue;
      await this.redis.publish(`event:${event.id}:ops`, { type: "ptt.status", payload: statuses });
    }
  }
}

type InboundChatPayload = Parameters<EventChatService["addFromBridge"]>[3];
type OutboundForProvider = Parameters<PttProvider["send"]>[0];
