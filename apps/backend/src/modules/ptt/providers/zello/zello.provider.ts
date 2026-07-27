import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Injectable } from "@nestjs/common";
import type { PttCapabilities, PttChannelKind, PttConfigField } from "@events/contracts";
import { PttMediaService, PTT_OPUS_PROFILE } from "../../ptt-media.service";
import {
  nowIso,
  type OutboundPttMessage,
  type PttProvider,
  type PttProviderEvents,
  type PttProviderRuntimeStatus,
} from "../ptt-provider";
import { packOpusToOgg, unpackOggOpus } from "./ogg-opus";
import { ZelloClient } from "./zello-client";

/**
 * Zello Channel API provider.
 *
 * Holds exactly one connection on a bot account for the whole server — Zello
 * kicks the older session when an account logs on twice, so a per-user or
 * per-event connection is not an option. Consequently every outgoing message
 * carries the app-side author's name in its text; Zello has no concept of
 * app identity on a shared connection.
 */
@Injectable()
export class ZelloProvider implements PttProvider {
  readonly kind: PttChannelKind = "zello";
  readonly label = "Zello";
  readonly description =
    "Bridges the team chat to a Zello channel over the Channel API. One bot account holds the connection for the whole server.";
  readonly available = true;
  readonly capabilities: PttCapabilities = { text: true, voice: true, image: true, location: true };
  readonly fields: PttConfigField[] = [
    {
      key: "wsUrl",
      label: "WebSocket URL",
      type: "text",
      required: true,
      placeholder: "wss://zello.io/ws",
      hint: "Consumer Zello is wss://zello.io/ws. Zello Work uses your own subdomain.",
    },
    {
      key: "channels",
      label: "Known channels",
      type: "list",
      required: false,
      placeholder: "Test integration channel",
      hint: "Channels this bot account can reach. Zello has no API to list them, so add the names yourself — exact case and spacing.",
    },
    {
      key: "channel",
      label: "Listening on",
      type: "text",
      required: true,
      optionsFrom: "channels",
      placeholder: "Test integration channel",
      hint: "Only one channel can be joined per connection. Switching reconnects the bridge.",
    },
    { key: "username", label: "Bot username", type: "text", required: true, placeholder: "academyfirstaid.bot" },
    {
      key: "password",
      label: "Bot password",
      type: "secret",
      required: true,
      hint: "Anonymous logon is rejected — the bot account needs a password.",
    },
    {
      key: "issuer",
      label: "Issuer",
      type: "text",
      required: false,
      hint: "From the Zello developer console. With a private key it mints a fresh token on every connect.",
    },
    {
      key: "privateKey",
      label: "Private key (PEM)",
      type: "multiline",
      required: false,
      hint: "RSA private key matching the issuer. Paste the whole -----BEGIN PRIVATE KEY----- block.",
    },
    {
      key: "devToken",
      label: "Developer token",
      type: "secret",
      required: false,
      hint: "Optional ready-made JWT. Used instead of the private key while it is unexpired.",
    },
    {
      key: "ignoredChannels",
      label: "Ignored channels",
      type: "text",
      required: false,
      hint: "Comma-separated. Traffic on these channels is dropped instead of bridged.",
    },
  ];

  private client: ZelloClient | null = null;
  private events: PttProviderEvents | null = null;
  private connectedAt: string | undefined;
  private detail: string | undefined;
  private enabled = false;

  constructor(private readonly media: PttMediaService) {}

  bind(events: PttProviderEvents): void {
    this.events = events;
  }

  isConfigured(config: Record<string, string>): boolean {
    const hasCredentials = Boolean(config.wsUrl?.trim() && config.channel?.trim() && config.username?.trim() && config.password?.trim());
    const hasToken = Boolean(config.devToken?.trim() || (config.issuer?.trim() && config.privateKey?.trim()));
    return hasCredentials && hasToken;
  }

  async apply(enabled: boolean, config: Record<string, string>): Promise<void> {
    this.enabled = enabled;
    if (!enabled || !this.isConfigured(config)) {
      await this.shutdown();
      this.detail = enabled ? "waiting for connection settings" : undefined;
      this.events?.onStatus();
      return;
    }

    const options = {
      wsUrl: config.wsUrl!.trim(),
      username: config.username!.trim(),
      password: config.password!,
      channel: config.channel!.trim(),
      issuer: config.issuer?.trim(),
      privateKey: config.privateKey,
      devToken: config.devToken?.trim(),
      ignoredChannels: (config.ignoredChannels ?? "").split(",").map((c) => c.trim()).filter(Boolean),
    };

    if (this.client) {
      this.client.reconfigure(options);
      return;
    }

    const client = new ZelloClient(options);
    this.client = client;
    this.wire(client);
    client.start();
  }

  async shutdown(): Promise<void> {
    this.client?.stop();
    this.client?.removeAllListeners();
    this.client = null;
    this.connectedAt = undefined;
    return Promise.resolve();
  }

  status(): PttProviderRuntimeStatus {
    if (!this.enabled) return { state: "disabled", detail: this.detail };
    if (!this.client) return { state: "offline", detail: this.detail ?? "not configured" };
    const channel = this.client.channel;
    return {
      state: this.client.ready ? "online" : this.client.connectionState,
      detail: this.detail,
      channel: channel?.channel,
      usersOnline: channel?.usersOnline,
      connectedAt: this.connectedAt,
    };
  }

  async send(message: OutboundPttMessage): Promise<void> {
    const client = this.client;
    if (!client?.ready) throw new Error("Zello is not connected");

    switch (message.kind) {
      case "text":
        await client.sendText(`${message.author}: ${message.text}`);
        return;

      case "location":
        // Send the point, then a line of text so the sender is identifiable —
        // locations arrive attributed to the bot account like everything else.
        await client.sendLocation(message);
        await client
          .sendText(`${message.author} shared a location${message.address ? `: ${message.address}` : ""}`)
          .catch(() => undefined);
        return;

      case "image": {
        const raw = await readFile(message.imagePath);
        const jpeg = await this.media.toJpeg(raw, extname(message.imagePath));
        if (!jpeg) throw new Error("image could not be converted to JPEG (ffmpeg unavailable)");
        const thumbnail = await this.media.jpegThumbnail(jpeg);
        await client.sendImage(jpeg, thumbnail);
        await client
          .sendText(`${message.author} sent a photo${message.caption ? `: ${message.caption}` : ""}`)
          .catch(() => undefined);
        return;
      }

      case "voice": {
        const ogg = await this.media.fileToOggOpus(message.audioPath);
        if (!ogg) {
          // No encoder available: the transcript is still worth relaying, and
          // is often more useful over a busy channel than the audio anyway.
          const fallback = message.transcript?.trim();
          if (!fallback) throw new Error("voice relay needs ffmpeg or a transcript");
          await client.sendText(`${message.author} (voice): ${fallback}`);
          return;
        }
        const { packets } = unpackOggOpus(ogg);
        if (packets.length === 0) throw new Error("voice encoded to zero packets");
        await client.sendVoice(packets, PTT_OPUS_PROFILE);
        if (message.transcript?.trim()) {
          await client.sendText(`${message.author} (voice): ${message.transcript.trim()}`).catch(() => undefined);
        }
        return;
      }
    }
  }

  private wire(client: ZelloClient): void {
    client.on("state", (state, detail) => {
      this.detail = detail;
      if (state === "online" && !this.connectedAt) this.connectedAt = nowIso();
      if (state !== "online") this.connectedAt = undefined;
      this.events?.onStatus();
    });
    client.on("channel", () => this.events?.onStatus());
    client.on("log", (level, message) => this.events?.onLog(level, message));

    client.on("text", (msg) => {
      this.events?.onMessage({ kind: "text", from: msg.from, text: msg.text });
    });

    client.on("location", (msg) => {
      this.events?.onMessage({
        kind: "location",
        from: msg.from,
        lat: msg.lat,
        lng: msg.lng,
        address: msg.address,
        accuracyM: msg.accuracyM,
      });
    });

    client.on("image", (msg) => {
      this.events?.onMessage({
        kind: "image",
        from: msg.from,
        full: msg.full,
        thumbnail: msg.thumbnail,
        extension: "jpg",
      });
    });

    client.on("voice", (msg) => {
      void this.deliverVoice(msg.from, msg.packets, msg.header, msg.durationMs);
    });
  }

  /**
   * Zello streams bare Opus packets. They are wrapped into Ogg Opus (no decode,
   * so the audio is bit-exact) and then re-wrapped as m4a where possible, since
   * iOS cannot play Ogg.
   */
  private async deliverVoice(
    from: string,
    packets: Buffer[],
    header: { sampleRate: number; framesPerPacket: number; frameSizeMs: number },
    durationMs: number,
  ): Promise<void> {
    try {
      const ogg = packOpusToOgg(packets, header);
      const m4a = await this.media.oggToM4a(ogg);
      this.events?.onMessage({
        kind: "voice",
        from,
        audio: m4a ?? ogg,
        extension: m4a ? "m4a" : "ogg",
        durationMs,
      });
    } catch (err) {
      this.events?.onLog("error", `voice delivery failed: ${(err as Error).message}`);
    }
  }
}
