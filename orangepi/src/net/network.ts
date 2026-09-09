import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname } from "node:path";
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

/**
 * AP-mode plumbing. 10.42.0.1 is kept from NetworkManager's shared-mode
 * convention so any note, label or bookmark that already says it stays true.
 */
const AP_ADDRESS = "10.42.0.1";
const HOSTAPD_CONF = "/etc/em-gateway/hostapd.conf";
const DNSMASQ_CONF = "/etc/em-gateway/dnsmasq.conf";

export class NetworkManager extends EventEmitter {
  private state: NetworkState = { mode: "boot", online: false };
  private apTimer: NodeJS.Timeout | null = null;
  /**
   * Set while recovering from a failed access point. `returnToClient` falls
   * back to bringing the AP up, and `startAp` now recovers via
   * `returnToClient` — on a board whose AP mode always fails those two would
   * call each other forever. This breaks the cycle.
   */
  private recoveringRadio = false;
  /** The AP daemons, alive only while the access point is up. */
  private hostapd: ChildProcess | null = null;
  private dnsmasq: ChildProcess | null = null;
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
      .filter(([name, type]) => type === "802-11-wireless" && Boolean(name))
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
    if (!connected || !hasIp || !connection || connection === "--") return null;

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
   * Bring up the setup access point, with hostapd rather than NetworkManager.
   *
   * NM's `device wifi hotspot` drives AP mode through wpa_supplicant, and the
   * Orange Pi Zero 3's UWE5622 will not do AP that way — it times out and then
   * asserts its firmware. hostapd works on the same chip, but only if the
   * interface is taken *down* before its type is changed: changing the type on
   * a live interface is what returns `Failed to set interface to mode 3`. That
   * ordering is the whole trick, and it is why this is done by hand:
   *
   *   nmcli hands the interface over → link down → type __ap → link up
   *   → static address → hostapd → dnsmasq for DHCP and the captive portal
   *
   * `minutes` of 0 keeps the AP up indefinitely, which is right at first boot
   * (there is nothing to go back to) and wrong afterwards.
   */
  async startAp(minutes = 0): Promise<{ ok: boolean; detail: string }> {
    const { ssid, password } = this.config.ap;
    if (FAKE_HARDWARE) {
      this.set({ mode: "ap", ssid, online: false, apUntil: minutes ? inMinutes(minutes) : undefined });
      return { ok: true, detail: `Access point ${ssid} is up.` };
    }
    if (password.length < 8) {
      const detail = "The access point password must be at least 8 characters.";
      log.error("wifi", detail);
      return { ok: false, detail };
    }

    log.info("wifi", `starting the setup access point "${ssid}"`);
    await this.writeApConfigs();

    // Take the radio away from NetworkManager and put it into AP mode. Every
    // step here is ordered deliberately; see the note above.
    await run("nmcli", ["device", "set", this.iface, "managed", "no"], { timeoutMs: 10_000 });
    await sleep(1500);
    await run("ip", ["link", "set", this.iface, "down"], { timeoutMs: 8000 });
    await sleep(1200);

    const mode = await run("iw", ["dev", this.iface, "set", "type", "__ap"], { timeoutMs: 10_000 });
    if (mode.code !== 0) {
      const detail = mode.stderr.trim() || "the WiFi chip refused to enter access-point mode";
      log.error("wifi", `could not switch the radio to AP mode: ${detail}`);
      this.set({ lastError: detail });
      await this.recoverRadio(detail);
      return { ok: false, detail };
    }

    await run("ip", ["link", "set", this.iface, "up"], { timeoutMs: 8000 });
    await sleep(1000);
    await run("ip", ["addr", "flush", "dev", this.iface], { timeoutMs: 8000 });
    await run("ip", ["addr", "add", `${AP_ADDRESS}/24`, "dev", this.iface], { timeoutMs: 8000 });

    this.hostapd = spawn("hostapd", [HOSTAPD_CONF], { stdio: ["ignore", "pipe", "pipe"] });
    const enabled = await this.waitForApEnabled(this.hostapd);
    if (!enabled) {
      const detail = "hostapd did not bring the access point up";
      log.error("wifi", detail);
      this.set({ lastError: detail });
      await this.recoverRadio(detail);
      return { ok: false, detail };
    }

    // DHCP for the phone, plus the wildcard DNS that makes the console open by
    // itself instead of the operator having to be told an address.
    this.dnsmasq = spawn("dnsmasq", ["-k", "-C", DNSMASQ_CONF], { stdio: ["ignore", "ignore", "pipe"] });
    this.dnsmasq.stderr?.on("data", (d: Buffer) => {
      const text = d.toString().trim();
      if (text) log.warn("wifi", `dnsmasq: ${text}`);
    });

    this.armApTimer(minutes);
    this.set({
      mode: "ap",
      ssid,
      signal: undefined,
      online: false,
      lastError: undefined,
      apUntil: minutes ? inMinutes(minutes) : undefined,
    });
    log.info("wifi", `access point "${ssid}" is up — console at http://${AP_ADDRESS}`, {
      minutes: minutes || "until told otherwise",
    });
    return { ok: true, detail: `Access point ${ssid} is up at ${AP_ADDRESS}.` };
  }

  /** Wait for hostapd to say AP-ENABLED, rather than guessing with a sleep. */
  private waitForApEnabled(child: ChildProcess): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), 20_000);

      const onData = (buffer: Buffer): void => {
        const text = buffer.toString();
        if (text.includes("AP-ENABLED")) done(true);
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) log.debug("wifi", `hostapd: ${trimmed}`);
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (err) => {
        log.error("wifi", `hostapd failed to start: ${err.message}`);
        done(false);
      });
      child.on("close", (code) => {
        log.warn("wifi", `hostapd exited (${code ?? "signal"})`);
        done(false);
      });
    });
  }

  /** Render hostapd and dnsmasq configs from the box's current settings. */
  private async writeApConfigs(): Promise<void> {
    const { ssid, password } = this.config.ap;
    await mkdir(dirname(HOSTAPD_CONF), { recursive: true });
    await writeFile(
      HOSTAPD_CONF,
      [
        `interface=${this.iface}`,
        "driver=nl80211",
        `ssid=${ssid}`,
        // 2.4 GHz: a phone in a field finds it from further away, and it is the
        // band every handset supports.
        "hw_mode=g",
        "channel=6",
        `country_code=${this.config.ap.countryCode || "BG"}`,
        "auth_algs=1",
        "wpa=2",
        `wpa_passphrase=${password}`,
        "wpa_key_mgmt=WPA-PSK",
        "rsn_pairwise=CCMP",
        "ignore_broadcast_ssid=0",
      ].join("\n") + "\n",
      { mode: 0o600 },
    );

    await writeFile(
      DNSMASQ_CONF,
      [
        `interface=${this.iface}`,
        "bind-interfaces",
        `listen-address=${AP_ADDRESS}`,
        `dhcp-range=10.42.0.10,10.42.0.100,255.255.255.0,12h`,
        `dhcp-option=option:router,${AP_ADDRESS}`,
        `dhcp-option=option:dns-server,${AP_ADDRESS}`,
        // Every name resolves to the box, which is what makes a phone pop the
        // console open the moment it joins. There is no upstream resolver in
        // access-point mode anyway.
        `address=/#/${AP_ADDRESS}`,
        "no-resolv",
        "no-hosts",
        "log-facility=-",
      ].join("\n") + "\n",
      { mode: 0o600 },
    );
  }

  /** Stop the AP daemons, ignoring any that were not running. */
  private stopApDaemons(): void {
    for (const child of [this.dnsmasq, this.hostapd]) {
      try {
        child?.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    this.dnsmasq = null;
    this.hostapd = null;
  }

  /**
   * Bring the radio back after a failed access-point attempt.
   *
   * Tries the cheap fix first — put the interface back to station mode, hand it
   * to NetworkManager and rejoin — and reboots only if the interface itself has
   * vanished, which is what a firmware assert looks like from up here. A reboot
   * costs about forty seconds; a box with no radio costs the rest of the event.
   */
  private async recoverRadio(reason: string): Promise<void> {
    if (this.recoveringRadio) return;
    this.recoveringRadio = true;
    try {
      await this.doRecoverRadio(reason);
    } finally {
      this.recoveringRadio = false;
    }
  }

  private async doRecoverRadio(reason: string): Promise<void> {
    log.warn("wifi", "recovering the radio after the failed access point");
    this.stopApDaemons();
    await run("ip", ["addr", "flush", "dev", this.iface], { timeoutMs: 8000 });
    await run("ip", ["link", "set", this.iface, "down"], { timeoutMs: 8000 });
    await sleep(800);
    await run("iw", ["dev", this.iface, "set", "type", "managed"], { timeoutMs: 10_000 });
    await run("ip", ["link", "set", this.iface, "up"], { timeoutMs: 8000 });
    await sleep(800);
    await run("nmcli", ["device", "set", this.iface, "managed", "yes"], { timeoutMs: 10_000 });
    await sleep(2000);

    const present = await run("iw", ["dev"], { timeoutMs: 8000 });
    const interfaceGone = !present.stdout.includes(this.iface);

    if (!interfaceGone && (await this.returnToClient())) {
      log.info("wifi", "radio recovered without a reboot");
      return;
    }
    if (interfaceGone) {
      log.error(
        "wifi",
        `the WiFi interface disappeared after the access-point attempt (${reason}) — rebooting to recover it`,
      );
      await run("systemctl", ["reboot"], { timeoutMs: 10_000 });
      return;
    }
    log.error("wifi", "could not rejoin any network after the failed access point");
  }

  async stopAp(opts: { silent?: boolean } = {}): Promise<void> {
    if (this.apTimer) {
      clearTimeout(this.apTimer);
      this.apTimer = null;
    }
    if (FAKE_HARDWARE) return;

    this.stopApDaemons();
    await sleep(800);
    // Put the radio back to station mode — again with the interface down,
    // which is the only ordering this chip accepts — and hand it to
    // NetworkManager so the client-mode code can drive it as usual.
    await run("ip", ["addr", "flush", "dev", this.iface], { timeoutMs: 8000 });
    await run("ip", ["link", "set", this.iface, "down"], { timeoutMs: 8000 });
    await sleep(800);
    await run("iw", ["dev", this.iface, "set", "type", "managed"], { timeoutMs: 10_000 });
    await run("ip", ["link", "set", this.iface, "up"], { timeoutMs: 8000 });
    await sleep(800);
    await run("nmcli", ["device", "set", this.iface, "managed", "yes"], { timeoutMs: 10_000 });
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
      if (!this.recoveringRadio) await this.startAp();
      return false;
    }
    // `connection up` on the saved profile rather than a fresh scan-and-join:
    // faster, and it works on a hidden SSID.
    for (const name of saved) {
      await run("nmcli", ["connection", "up", name], { timeoutMs: 45_000 });
      if (await this.waitForClient(20_000)) return true;
    }
    log.warn("wifi", "could not rejoin any saved network — bringing the access point back");
    if (!this.recoveringRadio) await this.startAp();
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
