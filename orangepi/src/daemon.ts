import { EventEmitter } from "node:events";
import { log } from "./logger";
import { run, sleep } from "./util";
import {
  VERSION,
  isProvisioned,
  loadConfig,
  patchConfig,
  type DeepPartial,
  type GatewayConfig,
} from "./config";
import { decodeToPcm, encodeToOpus } from "./audio/codec";
import { bytesToMs } from "./audio/format";
import { readHealth } from "./health";
import { NetworkManager } from "./net/network";
import { Transceiver } from "./radio/transceiver";
import { RecordingStore } from "./store/recordings";
import { Uplink } from "./server/uplink";
import type { GatewayCommand, HealthState, OutboundItem, Recording, ReportRequest } from "./types";
import { applyUpdate } from "./updater";

/**
 * The gateway itself — the object that owns every moving part and the wiring
 * between them. Kept in one place because the interesting behaviour of this box
 * is not in any single component but in how they are joined:
 *
 *   radio ──► squelch ──► Opus ──► SD card ──► server ──► team chat
 *   team chat ──► server ──► download / speech ──► queue ──► PTT ──► radio
 *
 * Everything the console shows is read off this object, so the phone screen and
 * the server's dashboard can never disagree about what the box is doing.
 */
export class GatewayDaemon extends EventEmitter {
  config: GatewayConfig;
  readonly network: NetworkManager;
  readonly radio: Transceiver;
  readonly recordings: RecordingStore;
  readonly uplink: Uplink;

  /** Last thing that happened, for the console's status line. */
  private activity = "Starting up";

  constructor() {
    super();
    this.config = loadConfig();
    this.network = new NetworkManager(this.config);
    this.radio = new Transceiver(this.config);
    this.recordings = new RecordingStore(this.config);
    this.uplink = new Uplink(this.config);
  }

  async start(): Promise<void> {
    log.info("system", `Extreme Medics radio gateway ${VERSION} starting`, { id: this.config.id });

    this.uplink.bindSnapshot(() => this.reportSnapshot());
    this.wireRadio();
    this.wireUplink();

    await this.radio.start();
    await this.network.boot();
    this.uplink.start();
    this.network.startWatchdog(() => this.uplink.healthy());

    if (!isProvisioned(this.config)) {
      log.warn("system", "not set up yet — connect to the access point and open http://10.42.0.1");
    }
    this.setActivity("Ready");
  }

  async stop(): Promise<void> {
    this.uplink.stop();
    await this.radio.stop();
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  private wireRadio(): void {
    // Received: encode once, keep a copy on the card, then try to upload. The
    // local copy is written first on purpose — an upload can fail, an SD card
    // write essentially cannot, and the console must be able to play back what
    // was heard even with the server unreachable.
    this.radio.on("transmission", (tx) => {
      void (async () => {
        this.setActivity("Received a transmission");
        const opus = await encodeToOpus(tx.pcm);
        if (!opus) {
          log.error("audio", "could not encode the transmission — it is lost");
          return;
        }
        const row = await this.recordings.add(
          {
            direction: "rx",
            at: tx.startedAt,
            durationMs: Math.round(tx.durationMs),
            peakLevel: Number(tx.peakLevel.toFixed(3)),
            party: "Radio",
            uploaded: false,
          },
          opus,
        );
        this.emit("recording", row);

        if (!this.uplink.current().routes.inbound) {
          log.info("server", "the event has radio traffic switched off — kept locally only");
          return;
        }
        const ok = await this.uplink.uploadTransmission({
          audio: opus,
          durationMs: tx.durationMs,
          peakLevel: tx.peakLevel,
          from: this.config.name,
          recordingId: row.id,
        });
        this.recordings.markUploaded(row.id, ok);
        this.emit("recording", { ...row, uploaded: ok });
      })();
    });

    // Transmitted: same treatment in the other direction, so the console's log
    // shows both sides of a conversation rather than half of one.
    this.radio.on("transmitted", (result) => {
      void (async () => {
        if (result.job.local) {
          this.setActivity(result.ok ? "Test tone sent" : "Test tone failed");
          return;
        }
        const opus = await encodeToOpus(result.job.pcm);
        if (opus) {
          const row = await this.recordings.add(
            {
              direction: "tx",
              at: new Date().toISOString(),
              durationMs: Math.round(result.durationMs),
              peakLevel: 0,
              party: result.job.party,
              text: result.job.text,
            },
            opus,
          );
          this.emit("recording", row);
        }
        if (result.ok) {
          await this.uplink.confirmTransmitted(result.durationMs, result.job.party, result.job.text);
        }
        this.setActivity(result.ok ? "Transmitted" : `Transmit failed: ${result.detail ?? "unknown"}`);
      })();
    });

    this.radio.on("state", () => this.emit("state"));
    this.radio.on("tone", (kind: "open" | "close") => this.emit("tone", kind));
  }

  private wireUplink(): void {
    this.uplink.on("outbound", (item) => void this.handleOutbound(item));
    this.uplink.on("command", (command) => void this.handleCommand(command));
    this.uplink.on("uploaded", (id: string) => {
      this.recordings.markUploaded(id, true);
      this.emit("state");
    });
    this.uplink.on("state", () => this.emit("state"));
    this.network.on("change", () => this.emit("state"));
  }

  /** Something the app wants put on the air. */
  private async handleOutbound(item: OutboundItem): Promise<void> {
    if (!this.uplink.current().routes.outbound) {
      log.info("server", "the event has outgoing radio switched off — dropped");
      return;
    }

    if (item.kind === "voice") {
      if (!item.audioUrl) return;
      this.setActivity(`Fetching a voice message from ${item.author}`);
      const data = await this.uplink.download(item.audioUrl);
      if (!data) return;
      const pcm = await decodeToPcm(data);
      if (!pcm) {
        log.error("audio", "could not decode the voice message — nothing was transmitted");
        return;
      }
      this.radio.enqueue({
        id: item.id,
        pcm,
        label: `voice from ${item.author}`,
        party: item.author,
        text: item.text,
      });
      return;
    }

    // Text only goes on the air when the operator turned speech on, and the
    // server already filters on that — this is the second belt.
    if (!this.config.ttsEnabled && !this.uplink.current().ttsEnabled) return;
    const text = item.text?.trim();
    if (!text) return;

    this.setActivity("Speaking a message over the radio");
    const spoken = await this.uplink.speak(`${item.author} says: ${text}`);
    if (!spoken) {
      log.warn("server", "speech is unavailable — the message did not go on the air");
      return;
    }
    const pcm = await decodeToPcm(spoken);
    if (!pcm) return;
    this.radio.enqueue({
      id: item.id,
      pcm,
      label: `spoken message from ${item.author}`,
      party: item.author,
      text,
    });
  }

  /** Instructions from the dashboard, picked up on the heartbeat. */
  private async handleCommand(command: GatewayCommand): Promise<void> {
    switch (command.type) {
      case "enter_ap": {
        // The uplink dies the moment the AP comes up, so say so first and give
        // the report a moment to land.
        const minutes = this.config.ap.onDemandMinutes || 30;
        log.warn("wifi", `the dashboard asked for the setup access point — coming up for ${minutes} min`);
        this.setActivity("Opening the setup access point");
        await sleep(1500);
        await this.network.startAp(minutes);
        break;
      }
      case "leave_ap":
        await this.network.returnToClient();
        break;
      case "set_event": {
        const eventId = command.arg?.trim() || null;
        this.config = patchConfig({ eventId });
        this.applyConfig();
        log.info("server", eventId ? `bound to event ${eventId}` : "unbound from any event");
        break;
      }
      case "test_tx":
        this.radio.transmitTestTone();
        break;
      case "restart":
        log.warn("system", "restarting the service on the dashboard's request");
        await this.stop();
        process.exit(0);
        break;
      case "reboot":
        log.warn("system", "rebooting the box on the dashboard's request");
        await run("systemctl", ["reboot"], { timeoutMs: 10_000 });
        break;
      case "update":
        await this.update();
        break;
    }
  }

  // ── Actions the console drives ─────────────────────────────────────────────

  /** Persist a settings change and push it into every running component. */
  updateConfig(patch: DeepPartial<GatewayConfig>): GatewayConfig {
    this.config = patchConfig(patch);
    this.applyConfig();
    log.info("console", "settings updated");
    return this.config;
  }

  private applyConfig(): void {
    this.network.applyConfig(this.config);
    this.recordings.applyConfig(this.config);
    this.uplink.applyConfig(this.config);
    void this.radio.applyConfig(this.config);
    this.emit("state");
  }

  async selectEvent(eventId: string | null): Promise<boolean> {
    this.config = patchConfig({ eventId });
    this.applyConfig();
    const ok = await this.uplink.selectEvent(eventId);
    // The server is the authority on the binding, so a failure here has to be
    // visible rather than leaving the two quietly disagreeing.
    if (!ok) log.warn("server", "the event was set locally but the server has not confirmed it yet");
    return ok;
  }

  async update(): Promise<{ ok: boolean; detail: string }> {
    this.setActivity("Installing an update");
    const result = await applyUpdate(this.config, this.uplink.current().latestVersion);
    this.setActivity(result.ok ? "Update installed — restarting" : `Update failed: ${result.detail}`);
    return result;
  }

  setActivity(text: string): void {
    this.activity = text;
    this.emit("state");
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  private reportSnapshot(): Omit<ReportRequest, "id" | "name" | "version" | "counters"> {
    const net = this.network.current();
    return {
      netMode: net.mode,
      ssid: net.ssid,
      signal: net.signal,
      localIp: net.ip,
      audio: this.radio.state(),
      // Deliberately synchronous: the heartbeat must not wait on `df`. The
      // figures are refreshed on the console's own polling instead.
      health: this.lastHealth,
    };
  }

  private lastHealth: HealthState = { uptimeS: 0, queued: 0 };

  /** Called on a timer by the daemon entry point. */
  async refreshHealth(): Promise<void> {
    this.lastHealth = await readHealth(await this.uplink.refreshQueueCount());
  }

  /** Everything the console renders, in one object. */
  status() {
    const net = this.network.current();
    const uplink = this.uplink.current();
    const stats = this.recordings.stats();
    return {
      id: this.config.id,
      name: this.config.name,
      version: VERSION,
      provisioned: isProvisioned(this.config),
      activity: this.activity,
      network: net,
      radio: this.radio.state(),
      queueLength: this.radio.queueLength,
      liveKeyed: this.radio.liveActive,
      server: {
        connected: uplink.connected,
        url: this.config.serverUrl,
        lastReportAt: uplink.lastReportAt,
        lastError: uplink.lastError,
        routes: uplink.routes,
        ttsEnabled: uplink.ttsEnabled || this.config.ttsEnabled,
        queued: uplink.queued,
        latestVersion: uplink.latestVersion,
        updateAvailable: Boolean(uplink.latestVersion && uplink.latestVersion !== VERSION),
      },
      event: {
        id: this.config.eventId,
        name: uplink.events.find((e) => e.id === this.config.eventId)?.name,
        options: uplink.events,
      },
      health: this.lastHealth,
      storage: {
        recordings: stats.count,
        bytes: stats.bytes,
        maxMb: this.config.storage.maxMb,
      },
    };
  }
}

export type GatewayStatus = ReturnType<GatewayDaemon["status"]>;
export type { Recording };
export { bytesToMs };
