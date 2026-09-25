import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../logger";
import { FAKE_HARDWARE, run } from "../util";
import { STATE_DIR, type GatewayConfig } from "../config";

/**
 * Remote access, for when the box is somewhere the operator is and nobody else
 * can be.
 *
 * The box is behind a venue's NAT with no inbound anything, so it opens a
 * reverse SSH tunnel *out* to a host that is reachable — the same server it
 * already talks to — and whoever needs to get in connects to that host on the
 * agreed port. Nothing about the venue's network has to change.
 *
 * The key is generated on the box and never leaves it. Its public half is
 * written to the log, in a block that is meant to be read off a phone screen
 * and sent to whoever is helping; until somebody puts that public key on the
 * far host, the tunnel cannot connect and nothing is exposed. That ordering is
 * deliberate: a box that shipped with a working key would be a box anybody
 * holding a release could log into.
 */
const SSH_DIR = join(STATE_DIR, "ssh");
const KEY_PATH = join(SSH_DIR, "id_ed25519");

export interface RemoteState {
  enabled: boolean;
  connected: boolean;
  publicKey: string | null;
  detail: string;
  /** How the far side reaches this box once the key is installed. */
  instructions: string | null;
}

export class RemoteAccess {
  private child: ChildProcess | null = null;
  private running = false;
  private connected = false;
  private detail = "Off";

  constructor(private config: GatewayConfig) {}

  applyConfig(config: GatewayConfig): void {
    const before = this.config.remoteAccess;
    this.config = config;
    const after = config.remoteAccess;
    const changed =
      before.enabled !== after.enabled ||
      before.host !== after.host ||
      before.user !== after.user ||
      before.port !== after.port;
    if (!changed) return;
    void (after.enabled ? this.start() : this.stop());
  }

  /** The box's own public key, generating the pair on first use. */
  async publicKey(): Promise<string | null> {
    if (FAKE_HARDWARE) return "ssh-ed25519 AAAA…development-key em-gateway";
    try {
      if (!existsSync(KEY_PATH)) {
        mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });
        const res = await run(
          "ssh-keygen",
          ["-t", "ed25519", "-N", "", "-C", `em-gateway-${this.config.id}`, "-f", KEY_PATH],
          { timeoutMs: 30_000 },
        );
        if (res.code !== 0) {
          log.error("system", `could not create an access key: ${res.stderr.trim()}`);
          return null;
        }
        log.warn("system", "created a new remote-access key for this box");
      }
      return readFileSync(`${KEY_PATH}.pub`, "utf8").trim();
    } catch (err) {
      log.error("system", `could not read the access key: ${(err as Error).message}`);
      return null;
    }
  }

  async start(): Promise<RemoteState> {
    const settings = this.config.remoteAccess;
    if (!settings.enabled) return this.state();

    const key = await this.publicKey();
    if (!key) {
      this.detail = "No access key could be created.";
      return this.state();
    }

    // Printed as its own block because the way this key gets where it needs to
    // be is somebody reading it off a phone and sending it on.
    log.warn("system", "───── remote access public key ─────");
    log.warn("system", key);
    log.warn("system", `───── add it to ${settings.user}@${settings.host}, then this box can be reached on port ${settings.port} ─────`);

    this.running = true;
    this.spawn();
    return this.state();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.connected = false;
    this.detail = "Off";
    this.child?.kill("SIGTERM");
    this.child = null;
    log.info("system", "remote access stopped");
  }

  private spawn(): void {
    if (!this.running || FAKE_HARDWARE) return;
    const { host, user, port } = this.config.remoteAccess;

    // ExitOnForwardFailure so a port already taken fails loudly instead of
    // leaving a tunnel that goes nowhere; the keepalives are what make a
    // dropped venue link reconnect rather than hang forever.
    const args = [
      "-N",
      "-T",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "IdentitiesOnly=yes",
      "-i", KEY_PATH,
      "-R", `${port}:localhost:22`,
      `${user}@${host}`,
    ];

    log.info("system", `opening remote access to ${user}@${host}, port ${port}`);
    const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;

    let sawError = false;
    const onOutput = (buffer: Buffer): void => {
      const text = buffer.toString().trim();
      if (!text) return;
      sawError = true;
      log.warn("system", `remote access: ${text}`);
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);

    // ssh -N prints nothing on success, so silence after a few seconds is the
    // only evidence the tunnel is up.
    const settle = setTimeout(() => {
      if (this.child === child && !sawError) {
        this.connected = true;
        this.detail = `Connected — reachable on ${host} port ${port}`;
        log.warn("system", this.detail);
      }
    }, 5000);
    settle.unref?.();

    child.on("close", (code) => {
      clearTimeout(settle);
      this.connected = false;
      if (!this.running) return;
      this.detail = `Disconnected (${code ?? "signal"}) — retrying`;
      log.warn("system", `remote access dropped (${code ?? "signal"}) — retrying in 15s`);
      const retry = setTimeout(() => this.spawn(), 15_000);
      retry.unref?.();
    });
  }

  state(): RemoteState {
    const { enabled, host, user, port } = this.config.remoteAccess;
    return {
      enabled,
      connected: this.connected,
      publicKey: null,
      detail: this.detail,
      instructions: enabled ? `ssh -p ${port} root@${host}  (from anywhere, once the key is installed on ${user}@${host})` : null,
    };
  }

  async fullState(): Promise<RemoteState> {
    const base = this.state();
    return { ...base, publicKey: base.enabled ? await this.publicKey() : null };
  }
}
