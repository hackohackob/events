import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Request, type Response } from "express";
import { log, type LogEntry } from "../logger";
import { run } from "../util";
import { CONFIG_PATH, RECORDINGS_DIR, VERSION } from "../config";
import { captureDevices, playbackDevices } from "../audio/devices";
import { SAMPLE_RATE } from "../audio/format";
import type { GatewayDaemon } from "../daemon";

/**
 * The console: the web app served on the box's own access point, and the API
 * behind it.
 *
 * Everything a person needs to do to this box is here rather than over SSH,
 * because the realistic support call is somebody standing next to a radio in a
 * field with a phone and no laptop. Access control is the AP's WPA2 password —
 * the network is the credential, and the radio only reaches a few metres.
 *
 * The API is deliberately chatty over one SSE stream instead of polling: the
 * level meters need to update several times a second, and a phone browser
 * polling that fast over a hotspot is a battery and latency problem.
 */
export function createConsoleServer(daemon: GatewayDaemon): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // ── Captive portal ─────────────────────────────────────────────────────────
  // The probes phones and laptops fire the moment they join a WiFi network. A
  // redirect here is what makes the console open by itself instead of the
  // operator having to be told an IP address.
  const PORTAL_PROBES = [
    "/generate_204",
    "/gen_204",
    "/hotspot-detect.html",
    "/library/test/success.html",
    "/ncsi.txt",
    "/connecttest.txt",
    "/canonical.html",
    "/success.txt",
  ];
  app.get(PORTAL_PROBES, (_req, res) => {
    res.redirect(302, "/");
  });

  // ── State ──────────────────────────────────────────────────────────────────

  app.get("/api/status", (_req, res) => {
    res.json(daemon.status());
  });

  /**
   * One event stream carrying three kinds of message: `status` on every state
   * change, `level` several times a second for the meters, and `log` for the
   * live log view.
   */
  app.get("/api/stream", (req: Request, res: Response) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // The console is behind nginx on no box today, but a stalled buffer here
      // is invisible and maddening, so say it anyway.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("status", daemon.status());
    for (const entry of log.recent(200)) send("log", entry);

    const onStatus = (): void => send("status", daemon.status());
    const onLog = (entry: LogEntry): void => send("log", entry);
    const onRecording = (row: unknown): void => send("recording", row);

    daemon.on("state", onStatus);
    daemon.on("recording", onRecording);
    log.on("entry", onLog);

    // The meters are sampled here rather than emitted from the audio path:
    // 8 Hz is plenty for a human eye and a hundredth of the traffic.
    const meters = setInterval(() => {
      const state = daemon.radio.state();
      send("level", {
        rx: state.rxLevel,
        tx: state.txLevel,
        receiving: state.receiving,
        transmitting: state.transmitting,
      });
    }, 125);

    // Proxies and phone browsers drop an idle stream; a comment line is enough.
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);

    req.on("close", () => {
      clearInterval(meters);
      clearInterval(ping);
      daemon.off("state", onStatus);
      daemon.off("recording", onRecording);
      log.off("entry", onLog);
    });
  });

  app.get("/api/logs", (req, res) => {
    const after = Number(req.query.after ?? 0) || 0;
    const limit = Math.min(2000, Number(req.query.limit ?? 500) || 500);
    res.json(log.recent(limit, after));
  });

  // ── Setup ──────────────────────────────────────────────────────────────────

  app.post("/api/setup", (req, res) => {
    const { serverUrl, gatewayKey, name } = req.body as {
      serverUrl?: string;
      gatewayKey?: string;
      name?: string;
    };
    const patch: Record<string, string> = {};
    if (serverUrl?.trim()) patch.serverUrl = serverUrl.trim().replace(/\/+$/, "");
    if (gatewayKey?.trim()) patch.gatewayKey = gatewayKey.trim();
    if (name?.trim()) patch.name = name.trim();
    daemon.updateConfig(patch);
    // Check in straight away so the operator sees success or failure now,
    // rather than up to a minute later.
    void daemon.uplink.reportOnce();
    res.json({ ok: true, status: daemon.status() });
  });

  app.get("/api/config", (_req, res) => {
    // The gateway key is write-only from the console's point of view: it is
    // shown as set or not, never echoed back to a browser.
    const { gatewayKey, ...rest } = daemon.config;
    res.json({ ...rest, gatewayKeySet: Boolean(gatewayKey) });
  });

  app.put("/api/config", (req, res) => {
    const next = daemon.updateConfig(req.body as Record<string, never>);
    const { gatewayKey, ...rest } = next;
    res.json({ ...rest, gatewayKeySet: Boolean(gatewayKey) });
  });

  // ── WiFi ───────────────────────────────────────────────────────────────────

  /**
   * The network list, plus whether it is live. In access-point mode the radio
   * cannot scan, so this serves the last list taken before the AP came up — the
   * console says so rather than presenting stale results as current.
   */
  app.get("/api/wifi/scan", (_req, res) => {
    void daemon.network
      .scan()
      .then((networks) => res.json({ networks, ...daemon.network.scanAge() }))
      .catch((err: Error) => res.status(500).json({ error: err.message }));
  });

  app.post("/api/wifi/connect", (req, res) => {
    const { ssid, password } = req.body as { ssid?: string; password?: string };
    if (!ssid) {
      res.status(400).json({ ok: false, detail: "Pick a network first." });
      return;
    }
    // The response is written before the radio switches, because the phone is
    // about to lose this connection — the AP is going down to join the venue
    // WiFi. The console tells the operator that will happen.
    void daemon.network.connect(ssid, password).then((result) => {
      log.info("console", `WiFi setup: ${result.detail}`);
    });
    res.json({ ok: true, detail: `Joining ${ssid}. This access point will disappear.` });
  });

  app.post("/api/wifi/forget", (req, res) => {
    const { ssid } = req.body as { ssid?: string };
    if (!ssid) {
      res.status(400).json({ ok: false });
      return;
    }
    void daemon.network.forget(ssid).then(() => res.json({ ok: true }));
  });

  app.post("/api/wifi/ap", (req, res) => {
    const minutes = Number((req.body as { minutes?: number }).minutes ?? 0) || 0;
    void daemon.network.startAp(minutes).then((result) => res.json(result));
  });

  app.post("/api/wifi/client", (_req, res) => {
    res.json({ ok: true, detail: "Rejoining the saved WiFi. This access point will disappear." });
    void daemon.network.returnToClient();
  });

  // ── Event binding ──────────────────────────────────────────────────────────

  app.post("/api/event", (req, res) => {
    const { eventId } = req.body as { eventId?: string | null };
    void daemon.selectEvent(eventId?.trim() || null).then((confirmed) =>
      res.json({ ok: true, confirmed, status: daemon.status() }),
    );
  });

  app.post("/api/check-in", (_req, res) => {
    void daemon.uplink.reportOnce().then((payload) => res.json({ ok: Boolean(payload), status: daemon.status() }));
  });

  app.post("/api/retry-queue", (_req, res) => {
    void daemon.uplink.flushOutbox().then((sent) => res.json({ ok: true, sent }));
  });

  // ── Audio hardware ─────────────────────────────────────────────────────────

  app.get("/api/audio/devices", (_req, res) => {
    void Promise.all([captureDevices(), playbackDevices()]).then(([capture, playback]) =>
      res.json({ capture, playback }),
    );
  });

  app.post("/api/radio/test-tone", (_req, res) => {
    daemon.radio.transmitTestTone();
    res.json({ ok: true, detail: "A test tone is on its way to the radio." });
  });

  app.post("/api/radio/verify-ptt", (_req, res) => {
    void daemon.radio.verifyKeying().then((result) => res.json(result));
  });

  app.post("/api/radio/cancel", (_req, res) => {
    daemon.radio.cancelAll();
    res.json({ ok: true });
  });

  // ── Console push-to-talk ───────────────────────────────────────────────────
  // The phone sends raw 16 kHz mono PCM rather than a compressed stream: a
  // WebM/Opus stream cut into chunks cannot be decoded chunk by chunk, and
  // waiting for the whole clip before keying would defeat the point.

  app.post("/api/radio/ptt/start", (_req, res) => {
    void daemon.radio.openLiveSession().then((result) => res.json(result));
  });

  app.post(
    "/api/radio/ptt/audio",
    express.raw({ type: "application/octet-stream", limit: "4mb" }),
    (req, res) => {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.json({ ok: true });
        return;
      }
      void daemon.radio.pushLive(body).then(() => res.json({ ok: true }));
    },
  );

  app.post("/api/radio/ptt/stop", (_req, res) => {
    void daemon.radio.closeLiveSession().then((durationMs) => {
      if (durationMs > 400) void daemon.uplink.confirmTransmitted(durationMs, "Console", "Live push-to-talk");
      res.json({ ok: true, durationMs });
    });
  });

  /**
   * Live monitor: an endless WAV the phone plays with a plain `<audio>` tag.
   * The header claims a huge length, which every browser treats as "stream
   * until the connection closes" — the simplest thing that gives an operator
   * the channel in their ear with no player library at all.
   */
  app.get("/api/monitor.wav", (req, res) => {
    res.set({ "Content-Type": "audio/wav", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(endlessWavHeader());
    const onLevel = (): void => undefined;
    const onData = (chunk: Buffer): void => {
      if (!res.write(chunk)) return;
    };
    // Tap the recorder's own stream by listening to the capture's frames.
    daemon.radio.capture.on("pcm", onData);
    daemon.radio.capture.on("level", onLevel);
    log.info("console", "someone is listening to the channel live");
    req.on("close", () => {
      daemon.radio.capture.off("pcm", onData);
      daemon.radio.capture.off("level", onLevel);
    });
  });

  // ── Recordings ─────────────────────────────────────────────────────────────

  app.get("/api/recordings", (req, res) => {
    const direction = req.query.direction === "rx" || req.query.direction === "tx" ? req.query.direction : undefined;
    res.json(daemon.recordings.list(Number(req.query.limit ?? 200) || 200, direction));
  });

  app.get("/api/recordings/:id/audio", (req, res) => {
    const row = daemon.recordings.find(req.params.id);
    if (!row) {
      res.status(404).end();
      return;
    }
    const path = join(RECORDINGS_DIR, row.file);
    if (!existsSync(path)) {
      res.status(410).json({ error: "The audio has been pruned." });
      return;
    }
    res.set("Content-Type", "audio/ogg");
    createReadStream(path).pipe(res);
  });

  app.delete("/api/recordings", (_req, res) => {
    daemon.recordings.clear();
    res.json({ ok: true });
  });

  // ── Maintenance ────────────────────────────────────────────────────────────

  app.post("/api/update", (_req, res) => {
    void daemon.update().then((result) => res.json(result));
  });

  app.post("/api/restart", (_req, res) => {
    res.json({ ok: true, detail: "Restarting the service." });
    setTimeout(() => process.exit(0), 400);
  });

  app.post("/api/reboot", (_req, res) => {
    res.json({ ok: true, detail: "Rebooting. The console will come back in about a minute." });
    setTimeout(() => void run("systemctl", ["reboot"], { timeoutMs: 10_000 }), 600);
  });

  app.get("/api/diagnostics", (_req, res) => {
    void (async () => {
      const [alsa, nm, ff] = await Promise.all([
        run("arecord", ["-l"], { timeoutMs: 5000 }),
        run("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE", "device", "status"], { timeoutMs: 5000 }),
        run("ffmpeg", ["-version"], { timeoutMs: 5000 }),
      ]);
      res.json({
        version: VERSION,
        configPath: CONFIG_PATH,
        alsa: alsa.stdout.trim() || alsa.stderr.trim(),
        network: nm.stdout.trim() || nm.stderr.trim(),
        ffmpeg: ff.stdout.split("\n")[0] ?? "not installed",
      });
    })();
  });

  // ── The console app ────────────────────────────────────────────────────────

  const uiDir = join(__dirname, "..", "..", "public");
  if (existsSync(uiDir)) {
    app.use(express.static(uiDir, { maxAge: "1h", index: false }));
    // Client-side routing: anything that is not an API call is the app.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(uiDir, "index.html")));
  } else {
    app.get("/", (_req, res) =>
      res
        .status(200)
        .send("<h1>Radio gateway</h1><p>The console has not been built. Run <code>npm run build</code>.</p>"),
    );
  }

  return app;
}

/**
 * A WAV header for a stream of unknown length. The sizes are the largest a
 * 32-bit field holds, which is the convention players interpret as "keep going".
 */
function endlessWavHeader(): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(0xffffffff, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(0xffffffff, 40);
  return header;
}
