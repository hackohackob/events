import { EventEmitter } from "node:events";
import { buildCodecHeader, parseCodecHeader, type ZelloCodecHeader } from "./ogg-opus";
import { resolveAuthToken } from "./zello-token";

/**
 * Zello Channel API client — one long-lived connection on a bot account.
 *
 * Deliberately *not* one connection per app user: a second logon with the same
 * account kicks the first (close code 3003), and a single connection may join
 * exactly one channel. Everything the app sends therefore appears in Zello as
 * coming from the bot, so the sender's name is prefixed into the message text.
 *
 * Several behaviours here contradict the published API docs; each is marked at
 * the point it matters.
 */

export interface ZelloClientOptions {
  wsUrl: string;
  username: string;
  password: string;
  channel: string;
  issuer?: string;
  privateKey?: string;
  devToken?: string;
  /** Channels whose events are dropped (the account may sit in unrelated ones). */
  ignoredChannels?: string[];
}

export interface ZelloChannelStatus {
  channel: string;
  online: boolean;
  usersOnline?: number;
  textingSupported: boolean;
  imagesSupported: boolean;
  locationsSupported: boolean;
  error?: string;
}

export interface ZelloTextMessage {
  from: string;
  text: string;
  channel: string;
}

export interface ZelloLocationMessage {
  from: string;
  lat: number;
  lng: number;
  address?: string;
  accuracyM?: number;
}

export interface ZelloImageMessage {
  from: string;
  full: Buffer;
  thumbnail?: Buffer;
}

export interface ZelloVoiceMessage {
  from: string;
  packets: Buffer[];
  header: ZelloCodecHeader;
  durationMs: number;
}

type ConnectionState = "offline" | "connecting" | "online" | "error";

interface PendingImage {
  from: string;
  receivedAt: number;
  thumbnail?: Buffer;
  full?: Buffer;
  timer: NodeJS.Timeout;
}

interface ActiveStream {
  from: string;
  header: ZelloCodecHeader;
  packets: Buffer[];
  startedAt: number;
}

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
const KEEPALIVE_MS = 30_000;
const REPLY_TIMEOUT_MS = 15_000;
/** How long an announced image waits for its binary frames before giving up. */
const IMAGE_TIMEOUT_MS = 20_000;

export declare interface ZelloClient {
  on(event: "state", listener: (state: ConnectionState, detail?: string) => void): this;
  on(event: "channel", listener: (status: ZelloChannelStatus) => void): this;
  on(event: "text", listener: (msg: ZelloTextMessage) => void): this;
  on(event: "location", listener: (msg: ZelloLocationMessage) => void): this;
  on(event: "image", listener: (msg: ZelloImageMessage) => void): this;
  on(event: "voice", listener: (msg: ZelloVoiceMessage) => void): this;
  on(event: "log", listener: (level: "info" | "warn" | "error", message: string) => void): this;
  on(event: string, listener: (...args: never[]) => void): this;
}

export class ZelloClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: ZelloReply) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly pendingImages: PendingImage[] = [];
  private readonly streams = new Map<number, ActiveStream>();
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = true;

  private state: ConnectionState = "offline";
  private channelStatus: ZelloChannelStatus | null = null;

  constructor(private options: ZelloClientOptions) {
    super();
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get channel(): ZelloChannelStatus | null {
    return this.channelStatus;
  }

  /** True once the channel has announced itself online and will accept sends. */
  get ready(): boolean {
    return this.state === "online" && this.channelStatus?.online === true;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.setState("offline");
    this.channelStatus = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, "shutting down");
    } catch {
      // already closing
    }
  }

  /** Swap credentials/channel and reconnect if anything material changed. */
  reconfigure(options: ZelloClientOptions): void {
    const changed = JSON.stringify(this.options) !== JSON.stringify(options);
    this.options = options;
    if (changed && !this.stopped) {
      this.log("info", "configuration changed — reconnecting");
      this.reconnectAttempt = 0;
      this.reopen();
    }
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  async sendText(text: string): Promise<void> {
    this.assertReady("text");
    if (this.channelStatus && !this.channelStatus.textingSupported) {
      throw new Error("channel does not support text");
    }
    // 30 KB is the documented cap; leave headroom for the multi-byte tail.
    const payload = text.length > 29_000 ? `${text.slice(0, 29_000)}…` : text;
    await this.command({ command: "send_text_message", channel: this.options.channel, text: payload });
  }

  async sendLocation(input: { lat: number; lng: number; address?: string; accuracyM?: number }): Promise<void> {
    this.assertReady("location");
    if (this.channelStatus && !this.channelStatus.locationsSupported) {
      throw new Error("channel does not support locations");
    }
    await this.command({
      command: "send_location",
      channel: this.options.channel,
      latitude: input.lat,
      longitude: input.lng,
      accuracy: input.accuracyM ?? 10,
      ...(input.address ? { formatted_address: input.address } : {}),
    });
  }

  async sendImage(full: Buffer, thumbnail?: Buffer): Promise<void> {
    this.assertReady("image");
    if (this.channelStatus && !this.channelStatus.imagesSupported) {
      throw new Error("channel does not support images");
    }
    const thumb = thumbnail ?? full;
    const reply = await this.command({
      command: "send_image",
      channel: this.options.channel,
      source: "library",
      type: "jpeg",
      content_length: full.length,
      thumbnail_content_length: thumb.length,
    });
    const imageId = Number(reply.image_id ?? reply.message_id ?? 0);
    // image_type 2 = thumbnail, 1 = full; the thumbnail goes first so clients
    // have something to render while the full frame arrives.
    this.sendBinary(imageFrame(imageId, 2, thumb));
    this.sendBinary(imageFrame(imageId, 1, full));
  }

  /**
   * Transmit voice. Packets are paced in real time — Zello drops a stream that
   * arrives faster than it plays.
   */
  async sendVoice(packets: Buffer[], header: ZelloCodecHeader): Promise<void> {
    this.assertReady("voice");
    if (packets.length === 0) return;
    const packetDuration = header.framesPerPacket * header.frameSizeMs;
    const reply = await this.command({
      command: "start_stream",
      channel: this.options.channel,
      type: "audio",
      codec: "opus",
      codec_header: buildCodecHeader(header),
      packet_duration: packetDuration,
    });
    const streamId = Number(reply.stream_id ?? 0);
    if (!streamId) throw new Error("start_stream returned no stream_id");

    try {
      const startedAt = Date.now();
      for (let i = 0; i < packets.length; i++) {
        const due = startedAt + i * packetDuration;
        const wait = due - Date.now();
        if (wait > 0) await sleep(wait);
        if (!this.ready) throw new Error("connection lost mid-stream");
        this.sendBinary(audioFrame(streamId, i + 1, packets[i]!));
      }
    } finally {
      try {
        await this.command({ command: "stop_stream", stream_id: streamId });
      } catch {
        // the stream ends on its own when the socket drops
      }
    }
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  private open(): void {
    if (this.socket || this.stopped) return;
    const token = resolveAuthToken(this.options);
    if (!token) {
      this.setState("error", "no auth token: set a developer token, or an issuer + private key");
      return;
    }
    if (!this.options.username || !this.options.password) {
      // Anonymous logon is documented as supported for Friends & Family
      // channels but is rejected in practice with `invalid username`.
      this.setState("error", "username and password are required");
      return;
    }

    this.setState("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.wsUrl);
    } catch (err) {
      this.setState("error", `socket open failed: ${(err as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      void this.logon(token);
    });
    socket.addEventListener("message", (event) => {
      this.handleFrame(event.data);
    });
    socket.addEventListener("error", () => {
      // The close handler carries the useful detail; this only fires first.
      this.log("warn", "socket error");
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      this.failPending(new Error("connection closed"));
      this.channelStatus = null;
      // 3003 = another client logged on with the same account. Reconnecting
      // immediately just starts a fight — two clients kick each other in a
      // loop — so back off hard and name the usual causes, which are far more
      // often a second *server* (a local test tool, a staging deploy) than the
      // phone app people assume.
      const kicked = event.code === 3003;
      if (kicked) this.reconnectAttempt = Math.max(this.reconnectAttempt, 3);
      if (!this.stopped) {
        this.setState(
          "offline",
          kicked
            ? `kicked: another client is signed in as "${this.options.username}". ` +
              "Only one connection per Zello account is allowed — check for a second server, " +
              "a local test tool, or the phone app, and give this bridge its own account."
            : `disconnected (${event.code})`,
        );
        this.scheduleReconnect();
      }
    });
  }

  private reopen(): void {
    const socket = this.socket;
    this.socket = null;
    this.clearTimers();
    try {
      socket?.close(1000, "reconnecting");
    } catch {
      // ignore
    }
    this.open();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private async logon(token: string): Promise<void> {
    try {
      // `channels` is documented as an array but only one is accepted —
      // more than one fails logon with `channels limit exceeded`.
      await this.command({
        command: "logon",
        auth_token: token,
        username: this.options.username,
        password: this.options.password,
        channels: [this.options.channel],
      });
      this.reconnectAttempt = 0;
      this.setState("online", "logged on, waiting for the channel");
      this.startKeepalive();
    } catch (err) {
      // `invalid username` = no such account; `no permission` = bad password.
      this.setState("error", `logon failed: ${(err as Error).message}`);
      this.socket?.close(1000, "logon failed");
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      this.command({ command: "keepalive" }).catch(() => {
        this.log("warn", "keepalive not acknowledged");
      });
    }, KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
  }

  private clearTimers(): void {
    this.stopKeepalive();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const pending of this.pendingImages.splice(0)) clearTimeout(pending.timer);
    this.streams.clear();
  }

  // ── Frame handling ─────────────────────────────────────────────────────────

  private handleFrame(data: unknown): void {
    if (typeof data === "string") {
      this.handleJson(data);
      return;
    }
    const buffer =
      data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.isBuffer(data)
          ? data
          : ArrayBuffer.isView(data as ArrayBufferView)
            ? Buffer.from((data as ArrayBufferView).buffer as ArrayBuffer)
            : null;
    if (buffer) this.handleBinary(buffer);
  }

  private handleJson(raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.log("warn", "unparseable frame");
      return;
    }

    // Replies carry a `seq` and no `command`; events carry a `command` and no
    // `seq` — which is why every outgoing command's seq has to be tracked.
    if (typeof parsed.seq === "number" && parsed.command === undefined) {
      const waiter = this.pending.get(parsed.seq);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(parsed.seq);
      if (parsed.success === true) waiter.resolve(parsed as ZelloReply);
      else waiter.reject(new Error(String(parsed.error ?? "command failed")));
      return;
    }

    switch (parsed.command) {
      case "on_channel_status":
        this.handleChannelStatus(parsed);
        break;
      case "on_text_message":
        this.handleTextMessage(parsed);
        break;
      case "on_location":
        this.handleLocation(parsed);
        break;
      case "on_image":
        this.handleImageAnnouncement(parsed);
        break;
      case "on_stream_start":
        this.handleStreamStart(parsed);
        break;
      case "on_stream_stop":
        this.handleStreamStop(parsed);
        break;
      case "on_error":
        this.log("error", `zello error: ${String(parsed.error)}`);
        break;
      default:
        break;
    }
  }

  private isIgnored(channel: unknown): boolean {
    if (typeof channel !== "string") return false;
    return (this.options.ignoredChannels ?? []).some((c) => c.trim() && c.trim() === channel);
  }

  private handleChannelStatus(frame: Record<string, unknown>): void {
    const channel = String(frame.channel ?? "");
    if (this.isIgnored(channel)) return;
    const status: ZelloChannelStatus = {
      channel,
      online: frame.status === "online",
      usersOnline: typeof frame.users_online === "number" ? frame.users_online : undefined,
      textingSupported: frame.texting_supported !== false,
      imagesSupported: frame.images_supported !== false,
      locationsSupported: frame.locations_supported !== false,
      // `channel_closed` means "does not exist, or unreachable by this account"
      // — a non-existent name returns byte-identical output.
      error: typeof frame.error === "string" ? frame.error : undefined,
    };
    const wasOnline = this.channelStatus?.online === true;
    this.channelStatus = status;
    if (status.online) {
      // `online` is re-announced periodically. Only a real transition should
      // trigger "on connect, do X" logic, or it fires repeatedly.
      if (!wasOnline) this.setState("online", `channel ${channel} online`);
    } else {
      this.setState("error", status.error ? `channel ${channel}: ${status.error}` : `channel ${channel} offline`);
    }
    this.emit("channel", status);
  }

  private handleTextMessage(frame: Record<string, unknown>): void {
    if (this.isIgnored(frame.channel)) return;
    const text = String(frame.text ?? "").trim();
    if (!text) return;
    this.emit("text", {
      from: String(frame.from ?? "unknown"),
      text,
      channel: String(frame.channel ?? this.options.channel),
    } satisfies ZelloTextMessage);
  }

  private handleLocation(frame: Record<string, unknown>): void {
    if (this.isIgnored(frame.channel)) return;
    const lat = Number(frame.latitude);
    const lng = Number(frame.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // The docs' example calls the address `rgl` while the table says
    // `formatted_address`; phone-app locations often send neither.
    const address = (frame.formatted_address ?? frame.rgl) as string | undefined;
    const accuracy = Number(frame.accuracy);
    this.emit("location", {
      from: String(frame.from ?? "unknown"),
      lat,
      lng,
      address: typeof address === "string" && address.trim() ? address.trim() : undefined,
      accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : undefined,
    } satisfies ZelloLocationMessage);
  }

  /**
   * `on_image` announces an image; its two binary frames follow immediately.
   * They cannot be matched by id — the announcement carries a 64-char hex
   * `message_id` while the binary header carries `message_id: 0` — so frames
   * are attributed to the oldest unfulfilled announcement, in arrival order.
   */
  private handleImageAnnouncement(frame: Record<string, unknown>): void {
    if (this.isIgnored(frame.channel)) return;
    const entry: PendingImage = {
      from: String(frame.from ?? "unknown"),
      receivedAt: Date.now(),
      timer: setTimeout(() => undefined, 0),
    };
    entry.timer = setTimeout(() => this.finalizeImage(entry, true), IMAGE_TIMEOUT_MS);
    this.pendingImages.push(entry);
  }

  private handleImageData(imageType: number, payload: Buffer): void {
    const entry = this.pendingImages[0];
    if (!entry) {
      this.log("warn", "image data with no pending announcement — dropped");
      return;
    }
    if (imageType === 2) entry.thumbnail = payload;
    else entry.full = payload;
    if (entry.full) this.finalizeImage(entry, false);
  }

  private finalizeImage(entry: PendingImage, timedOut: boolean): void {
    const index = this.pendingImages.indexOf(entry);
    if (index === -1) return;
    this.pendingImages.splice(index, 1);
    clearTimeout(entry.timer);
    const full = entry.full ?? entry.thumbnail;
    if (!full) {
      if (timedOut) this.log("warn", `image from ${entry.from} never delivered its data`);
      return;
    }
    this.emit("image", { from: entry.from, full, thumbnail: entry.thumbnail } satisfies ZelloImageMessage);
  }

  private handleStreamStart(frame: Record<string, unknown>): void {
    if (this.isIgnored(frame.channel)) return;
    const streamId = Number(frame.stream_id);
    if (!Number.isFinite(streamId)) return;
    this.streams.set(streamId, {
      from: String(frame.from ?? "unknown"),
      header: parseCodecHeader(String(frame.codec_header ?? "")),
      packets: [],
      startedAt: Date.now(),
    });
  }

  private handleStreamStop(frame: Record<string, unknown>): void {
    const streamId = Number(frame.stream_id);
    const stream = this.streams.get(streamId);
    if (!stream) return;
    this.streams.delete(streamId);
    if (stream.packets.length === 0) return;
    const packetMs = stream.header.framesPerPacket * stream.header.frameSizeMs;
    this.emit("voice", {
      from: stream.from,
      packets: stream.packets,
      header: stream.header,
      durationMs: stream.packets.length * packetMs,
    } satisfies ZelloVoiceMessage);
  }

  /** `{ type(8), stream_id|message_id(32BE), packet_id|image_type(32BE), payload }`. */
  private handleBinary(buffer: Buffer): void {
    if (buffer.length < 9) return;
    const type = buffer.readUInt8(0);
    const id = buffer.readUInt32BE(1);
    const second = buffer.readUInt32BE(5);
    const payload = buffer.subarray(9);

    if (type === 0x01) {
      const stream = this.streams.get(id);
      if (!stream) return;
      stream.packets.push(Buffer.from(payload));
      return;
    }
    if (type === 0x02) {
      this.handleImageData(second, Buffer.from(payload));
    }
  }

  // ── Plumbing ───────────────────────────────────────────────────────────────

  private command(payload: Record<string, unknown>): Promise<ZelloReply> {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return Promise.reject(new Error("not connected"));
    const seq = ++this.seq;
    const frame = { ...payload, seq };
    return new Promise<ZelloReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`no reply to ${String(payload.command)}`));
      }, REPLY_TIMEOUT_MS);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify(frame));
        this.log("info", `→ ${redact(frame)}`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(err as Error);
      }
    });
  }

  private sendBinary(frame: Buffer): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) throw new Error("not connected");
    socket.send(frame);
  }

  private failPending(error: Error): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private assertReady(kind: string): void {
    if (!this.ready) throw new Error(`zello not ready — cannot send ${kind}`);
  }

  private setState(state: ConnectionState, detail?: string): void {
    // Emitting only on real transitions keeps one-shot listeners honest.
    if (this.state === state && !detail) return;
    this.state = state;
    this.emit("state", state, detail);
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.emit("log", level, message);
  }
}

interface ZelloReply extends Record<string, unknown> {
  seq: number;
  success: boolean;
}

function audioFrame(streamId: number, packetId: number, opus: Buffer): Buffer {
  const header = Buffer.alloc(9);
  header.writeUInt8(0x01, 0);
  header.writeUInt32BE(streamId, 1);
  header.writeUInt32BE(packetId, 5);
  return Buffer.concat([header, opus]);
}

function imageFrame(imageId: number, imageType: 1 | 2, jpeg: Buffer): Buffer {
  const header = Buffer.alloc(9);
  header.writeUInt8(0x02, 0);
  header.writeUInt32BE(imageId, 1);
  header.writeUInt32BE(imageType, 5);
  return Buffer.concat([header, jpeg]);
}

/** The logon frame carries the account password in plaintext — never log it raw. */
function redact(frame: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...frame };
  for (const key of ["password", "auth_token", "refresh_token"]) {
    if (copy[key] !== undefined) copy[key] = "«redacted»";
  }
  return JSON.stringify(copy).slice(0, 400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
