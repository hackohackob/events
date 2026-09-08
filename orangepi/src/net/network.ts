import { EventEmitter } from "node:events";
import { networkInterfaces } from "node:os";
import { log } from "../logger";
import { FAKE_HARDWARE, run, sleep } from "../util";
import { patchConfig, type GatewayConfig } from "../config";
import type { NetMode } from "../types";

/**
 * Networking, through NetworkManager.
 *
 * The Orange Pi Zero 3's AIC8800 will not reliably run an access point and a
 * client at the same time, so the box does one or the other and the dashboard
 * can call the access point back:
 *
 *   boot ──► AP ("EM-Radio-XXXX")  ── operator picks a WiFi ──► client
 *                ▲                                                │
 *                └──────── "enter_ap" command, or no uplink ──────┘
 *
 * Because entering AP mode *drops the uplink*, the AP is always on a timer:
 * after `ap.onDemandMinutes` the box rejoins the venue WiFi on its own. A box
 * left in AP mode by someone who walked away would otherwise be off the air for
 * the rest of the race.
 *
 * `nmcli` rather than hostapd/wpa_supplicant directly: Armbian ships
 * NetworkManager, its shared mode brings its own DHCP and NAT, and one tool
 * covering both modes is one tool to get wrong.
 */

export interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
  known: boolean;
  active: boolean;
}

export interface NetworkState {
  mode: NetMode;
  ssid?: string;
  signal?: number;
  ip?: string;
  /** When in AP mode on a timer, when it will hand back to the venue WiFi. */
  apUntil?: string;
  /** Last connection attempt's failure, shown in the console. */
  lastError?: string;
  online: boolean;
}

const AP_CONNECTION = "em-gateway-ap";

export class NetworkManager extends EventEmitter {
  private state: NetworkState = { mode: "boot", online: false };
  private apTimer: NodeJS.Timeout | null = null;
  private iface = process.env.GATEWAY_WIFI_IFACE?.trim() || "wlan0";

  constructor(private config: GatewayConfig) {
    super();
  }

  applyConfig(config: GatewayConfig): void {
    this.config = config;
  }

  current(): NetworkState {
    return { ...this.state, ip: this.localIp() };
  }

  private set(patch: Partial<NetworkState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("change", this.current());
  }

  localIp(): string | undefined {
    for (const [name, addresses] of Object.entries(networkInterfaces())) {
      if (name === "lo") continue;
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal) return address.address;
      }
    }
    return undefined;
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  /**
   * Decide what the box should be doing on power-up: setup mode when it has
   * never been configured or has no WiFi to join, otherwise straight onto the
   * venue network, falling back to the AP if that does not come up.
   */
  async boot(): Promise<void> {
    if (FAKE_HARDWARE) {
      this.set({ mode: "client", ssid: "Development", signal: 88, online: true });
      return;
    }
    const saved = await this.savedNetworks();
    if (saved.length === 0) {
      log.info("wifi", "no WiFi saved yet — starting the setup access point");
      await this.startAp();
      return;
    }
    log.info("wifi", `trying the ${saved.length} saved network${saved.length === 1 ? "" : "s"}`);
    const joined = await this.waitForClient(45_000);
    if (!joined) {
      log.warn("wifi", "could not join a saved network — falling back to the setup access point");
      await this.startAp();
    }
  }

  // ── Client mode ────────────────────────────────────────────────────────────

  async scan(): Promise<WifiNetwork[]> {
    if (FAKE_HARDWARE) {
      return [
        { ssid: "Event-WiFi", signal: 82, security: "WPA2", known: true, active: true },
        { ssid: "Race HQ 5G", signal: 61, security: "WPA2", known: false, active: false },
        { ssid: "Open Guest", signal: 44, security: "", known: false, active: false },
      ];
    }
    // A rescan while in AP mode kills the AP on some drivers, so the cached
    // list is used there — it is populated at boot, before the AP comes up.
    const rescan = this.state.mode === "ap" ? "no" : "yes";
    const res = await run(
      "nmcli",
      ["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", rescan],
      { timeoutMs: 20_000 },
    );
    const known = new Set(await this.savedNetworks());
    const seen = new Map<string, WifiNetwork>();
    for (const line of res.stdout.split("\n")) {
      // Fields can contain escaped colons; nmcli escapes them as "\:".
      const parts = line.split(/(?<!\\):/).map((p) => p.replace(/\\:/g, ":"));
      const [inUse, ssid, signal, security] = parts;
      if (!ssid) continue;
      const existing = seen.get(ssid);
      const entry: WifiNetwork = {
        ssid,
        signal: Number(signal) || 0,
        security: security ?? "",
        known: known.has(ssid),
        active: inUse?.trim() === "*",
      };
      // The same SSID appears once per band and per AP; keep the strongest.
      if (!existing || entry.signal > existing.signal) seen.set(ssid, entry);
    }
    return [...seen.values()].sort((a, b) => b.signal - a.signal);
  }

  async savedNetworks(): Promise<string[]> {
    const res = await run("nmcli", ["-t", "-f", "NAME,TYPE", "connection", "show"], { timeoutMs: 8000 });
    return res.stdout
      .split("\n")
      .map((line) => line.split(":"))
      .filter(([name, type]) => type === "802-11-wireless" && name && name !== AP_CONNECTION)
      .map(([name]) => name!);
  }

  /**
   * Join a network. Returns a human-readable failure rather than throwing —
   * this comes straight back to a phone screen held by someone standing in a
   * field, so "wrong password" has to be legible.
   */
  async connect(ssid: string, password?: string): Promise<{ ok: boolean; detail: string }> {
    if (FAKE_HARDWARE) {
      this.set({ mode: "client", ssid, signal: 75, online: true, lastError: undefined });
      return { ok: true, detail: `Joined ${ssid}.` };
    }
    log.info("wifi", `joining ${ssid}`);
    await this.stopAp({ silent: true });
    // The radio needs a moment after the AP goes down before it will associate.
    await sleep(1200);

    const args = ["device", "wifi", "connect", ssid, "ifname", this.iface];
    if (password) args.push("password", password);
    const res = await run("nmcli", args, { timeoutMs: 60_000 });

    if (res.code === 0) {
      const joined = await this.waitForClient(25_000);
      if (joined) {
        log.info("wifi", `joined ${ssid}`, { ip: this.localIp() ?? "" });
        return { ok: true, detail: `Joined ${ssid}.` };
      }
    }

    const detail = explainNmcli(res.stderr || res.stdout, ssid);
    log.error("wifi", `could not join ${ssid}: ${detail}`);
    this.set({ lastError: detail });
    // Never strand the box: if the join failed, the setup AP comes back so the
    // operator can try again.
    await this.startAp();
    return { ok: false, detail };
  }

  async forget(ssid: string): Promise<void> {
    if (FAKE_HARDWARE) return;
    await run("nmcli", ["connection", "delete", ssid], { timeoutMs: 10_000 });
    log.info("wifi", `forgot ${ssid}`);
  }

  /** Poll until NetworkManager reports an associated, addressed interface. */
  private async waitForClient(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.readClientStatus();
      if (status) {
        this.set({ mode: "client", ssid: status.ssid, signal: status.signal, online: true, lastError: undefined });
        return true;
      }
      await sleep(1500);
    }
    return false;
  }

  private async readClientStatus(): Promise<{ ssid: string; signal: number } | null> {
    const res = await run(
      "nmcli",
      ["-t", "-f", "GENERAL.CONNECTION,GENERAL.STATE,IP4.ADDRESS", "device", "show", this.iface],
      { timeoutMs: 8000 },
    );
    if (res.code !== 0) return null;
    const connection = /GENERAL\.CONNECTION:(.*)/.exec(res.stdout)?.[1]?.trim();
    const connected = /GENERAL\.STATE:\s*100/.test(res.stdout);
    const hasIp = /IP4\.ADDRESS\[1\]:\s*\d/.test(res.stdout);
    if (!connected || !hasIp || !connection || connection === "--" || connection === AP_CONNECTION) return null;

    const wifi = await run("nmcli", ["-t", "-f", "IN-USE,SSID,SIGNAL", "device", "wifi", "list", "--rescan", "no"], {
      timeoutMs: 8000,
    });
    const active = wifi.stdout
      .split("\n")
      .map((l) => l.split(":"))
      .find(([inUse]) => inUse?.trim() === "*");
    return { ssid: active?.[1] || connection, signal: Number(active?.[2]) || 0 };
  }

  // ── Access point mode ──────────────────────────────────────────────────────

  /**
   * Bring up the setup access point. `minutes` of 0 keeps it up indefinitely,
   * which is right at first boot (nothing to go back to) and wrong afterwards.
   */
  async startAp(minutes = 0): Promise<{ ok: boolean; detail: string }> {
    const { ssid, password } = this.config.ap;
    if (FAKE_HARDWARE) {
      this.set({ mode: "ap", ssid, online: false, apUntil: minutes ? inMinutes(minutes) : undefined });
      return { ok: true, detail: `Access point ${ssid} is up.` };
    }

    log.info("wifi", `starting the setup access point "${ssid}"`);
    // Recreate rather than reuse: the SSID or password may have been changed in
    // the console since the profile was made.
    await run("nmcli", ["connection", "delete", AP_CONNECTION], { timeoutMs: 10_000 });
    const create = await run(
      "nmcli",
      [
        "device", "wifi", "hotspot",
        "ifname", this.iface,
        "con-name", AP_CONNECTION,
        "ssid", ssid,
        "password", password,
      ],
      { timeoutMs: 30_000 },
    );

    if (create.code !== 0) {
      const detail = create.stderr.trim() || "NetworkManager refused to start the access point";
      log.error("wifi", `could not start the access point: ${detail}`);
      this.set({ lastError: detail });
      return { ok: false, detail };
    }

    // Band and visibility are set after creation because `wifi hotspot` does
    // not take them; 2.4 GHz because a phone in a field finds it further away.
    await run("nmcli", ["connection", "modify", AP_CONNECTION, "802-11-wireless.band", "bg"], { timeoutMs: 8000 });

    this.armApTimer(minutes);
    this.set({
      mode: "ap",
      ssid,
      signal: undefined,
      online: false,
      apUntil: minutes ? inMinutes(minutes) : undefined,
    });
    log.info("wifi", `access point "${ssid}" is up — console at http://10.42.0.1`, {
      minutes: minutes || "until told otherwise",
    });
    return { ok: true, detail: `Access point ${ssid} is up at 10.42.0.1.` };
  }

  async stopAp(opts: { silent?: boolean } = {}): Promise<void> {
    if (this.apTimer) {
      clearTimeout(this.apTimer);
      this.apTimer = null;
    }
    if (FAKE_HARDWARE) return;
    await run("nmcli", ["connection", "down", AP_CONNECTION], { timeoutMs: 15_000 });
    if (!opts.silent) log.info("wifi", "access point stopped");
  }

  /** Leave AP mode and rejoin whatever WiFi is saved. */
  async returnToClient(): Promise<boolean> {
    await this.stopAp();
    if (FAKE_HARDWARE) {
      this.set({ mode: "client", ssid: "Development", online: true });
      return true;
    }
    await sleep(1000);
    const saved = await this.savedNetworks();
    if (saved.length === 0) {
      log.warn("wifi", "asked to leave the access point, but no WiFi is saved — staying up");
      await this.startAp();
      return false;
    }
    // `connection up` on the saved profile rather than a fresh scan-and-join:
    // faster, and it works on a hidden SSID.
    for (const name of saved) {
      await run("nmcli", ["connection", "up", name], { timeoutMs: 45_000 });
      if (await this.waitForClient(20_000)) return true;
    }
    log.warn("wifi", "could not rejoin any saved network — bringing the access point back");
    await this.startAp();
    return false;
  }

  private armApTimer(minutes: number): void {
    if (this.apTimer) clearTimeout(this.apTimer);
    if (!minutes) return;
    log.info("wifi", `the access point will hand back to the venue WiFi in ${minutes} min`);
    this.apTimer = setTimeout(() => {
      log.info("wifi", "access point window is over — rejoining the venue WiFi");
      void this.returnToClient();
    }, minutes * 60_000);
    this.apTimer.unref?.();
  }

  /**
   * Watchdog. A venue's WiFi going away must not leave the box silently
   * unreachable: after a spell with no uplink it puts the AP back so somebody
   * can walk up with a phone and see what happened.
   */
  startWatchdog(isUplinkHealthy: () => boolean): void {
    if (FAKE_HARDWARE) return;
    let unhealthySince: number | null = null;
    const timer = setInterval(() => {
      void (async () => {
        if (this.state.mode === "ap") return;
        const status = await this.readClientStatus();
        if (status) this.set({ ssid: status.ssid, signal: status.signal, mode: "client" });

        const healthy = Boolean(status) && isUplinkHealthy();
        if (healthy) {
          unhealthySince = null;
          return;
        }
        unhealthySince ??= Date.now();
        if (Date.now() - unhealthySince > 10 * 60_000) {
          log.warn("wifi", "ten minutes with no server and no WiFi — reopening the setup access point");
          unhealthySince = null;
          await this.startAp(this.config.ap.onDemandMinutes || 30);
        }
      })();
    }, 60_000);
    timer.unref?.();
  }

  /** Persist the SSID/password the console set for the AP. */
  saveApSettings(ssid: string, password: string): GatewayConfig {
    const next = patchConfig({ ap: { ssid, password } });
    this.config = next;
    return next;
  }
}

function inMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Turn nmcli's output into something worth putting on a phone screen. */
function explainNmcli(output: string, ssid: string): string {
  const text = output.toLowerCase();
  if (text.includes("secrets were required") || text.includes("no secrets")) {
    return "Wrong password.";
  }
  if (text.includes("no network with ssid") || text.includes("not found")) {
    return `${ssid} is not in range.`;
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "The network did not respond in time. Move closer and try again.";
  }
  if (text.includes("device is strictly unmanaged") || text.includes("unmanaged")) {
    return "NetworkManager is not managing the WiFi adapter on this box.";
  }
  return output.trim().split("\n").slice(-1)[0] || "The connection failed.";
}
