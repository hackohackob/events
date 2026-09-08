import { log } from "./logger";
import { VERSION } from "./config";
import { GatewayDaemon } from "./daemon";
import { createConsoleServer } from "./http/server";

/**
 * Entry point.
 *
 * Port 80 by default so the address a phone has to be told is just the box's
 * IP — no port to read out over a radio. Binding it needs either root or the
 * capability the installer grants; falling back to 8080 rather than dying keeps
 * a misconfigured box diagnosable instead of silent.
 */
const PORT = Number(process.env.GATEWAY_HTTP_PORT ?? 80);
const FALLBACK_PORT = 8080;

async function main(): Promise<void> {
  const daemon = new GatewayDaemon();
  await daemon.refreshHealth();
  await daemon.start();

  const health = setInterval(() => void daemon.refreshHealth(), 30_000);
  health.unref?.();

  const app = createConsoleServer(daemon);
  const listen = (port: number): void => {
    const server = app.listen(port, "0.0.0.0", () => {
      log.info("system", `console listening on port ${port}`, { version: VERSION });
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if ((err.code === "EACCES" || err.code === "EADDRINUSE") && port !== FALLBACK_PORT) {
        log.warn("system", `could not bind port ${port} (${err.code}) — falling back to ${FALLBACK_PORT}`);
        listen(FALLBACK_PORT);
        return;
      }
      log.error("system", `the console could not start: ${err.message}`);
      process.exit(1);
    });
    // A long-poll and an SSE stream both outlive the default 5 s header timeout.
    server.headersTimeout = 120_000;
    server.requestTimeout = 0;
  };
  listen(PORT);

  const shutdown = (signal: string): void => {
    log.warn("system", `${signal} — shutting down`);
    void daemon.stop().finally(() => process.exit(0));
    // Never hang on a stuck ALSA process; systemd would kill us anyway.
    setTimeout(() => process.exit(0), 4000).unref?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // A crash that takes the radio link down mid-race must leave a trail, and
  // systemd's restart is a better answer than a half-dead process.
  process.on("uncaughtException", (err) => {
    log.error("system", `unhandled error: ${err.stack ?? err.message}`);
  });
  process.on("unhandledRejection", (reason) => {
    log.error("system", `unhandled rejection: ${String(reason)}`);
  });
}

void main();
