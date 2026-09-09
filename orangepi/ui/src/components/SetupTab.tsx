import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AudioDevice,
  type GatewayConfig,
  type Status,
  type WifiNetwork,
} from "../lib/api";
import {
  CalendarIcon,
  CheckIcon,
  CloudIcon,
  LockIcon,
  RadioIcon,
  RefreshIcon,
  SettingsIcon,
  WifiIcon,
  ZapIcon,
} from "../lib/icons";
import { Banner, Card, Field, SignalBars, Slider, Toggle } from "./ui";

/**
 * Setup, ordered the way a box is actually commissioned: name it, put it on the
 * venue's WiFi, point it at the server, pick the event, then tune the audio and
 * the keying against the live meters on the Live tab.
 *
 * Every setting saves on change rather than behind a Save button. Somebody
 * adjusting a squelch threshold wants to watch the scope react, not commit and
 * check — and a half-filled form abandoned when a phone locks should not leave
 * the box in a state nobody chose.
 */
export function SetupTab({ status, onChanged }: { status: Status; onChanged: () => void }) {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);

  const load = useCallback(() => {
    api.config().then(setConfig).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const patch = useCallback(
    async (change: Record<string, unknown>) => {
      const next = await api.saveConfig(change);
      setConfig(next);
      onChanged();
    },
    [onChanged],
  );

  if (!config) {
    return <Card>Loading the settings…</Card>;
  }

  return (
    <>
      {notice && <Banner tone={notice.tone === "info" ? "info" : notice.tone}>{notice.text}</Banner>}

      <ServerCard status={status} config={config} onSaved={onChanged} setNotice={setNotice} />
      <EventCard status={status} onChanged={onChanged} />
      <WifiCard status={status} setNotice={setNotice} />
      <AudioCard config={config} patch={patch} />
      <SquelchCard config={config} patch={patch} />
      <BeepCard config={config} patch={patch} />
      <KeyingCard config={config} patch={patch} setNotice={setNotice} />
      <AccessPointCard config={config} status={status} patch={patch} setNotice={setNotice} />
      <StorageCard config={config} patch={patch} />
      <MaintenanceCard status={status} setNotice={setNotice} />
    </>
  );
}

type Notice = (n: { tone: "ok" | "bad" | "info"; text: string } | null) => void;

// ── Server ───────────────────────────────────────────────────────────────────

function ServerCard({
  status,
  config,
  onSaved,
  setNotice,
}: {
  status: Status;
  config: GatewayConfig;
  onSaved: () => void;
  setNotice: Notice;
}) {
  const [name, setName] = useState(config.name);
  const [url, setUrl] = useState(config.serverUrl);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = name !== config.name || url !== config.serverUrl || key.length > 0;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.setup({ name, serverUrl: url, gatewayKey: key || undefined });
      setKey("");
      onSaved();
      setNotice({ tone: "ok", text: "Saved. Checking in with the server…" });
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Server"
      action={
        <span className={`tag ${status.server.connected ? "ok" : "bad"}`}>
          {status.server.connected ? "Connected" : "Offline"}
        </span>
      }
    >
      <Field label="What this box is called" hint="Shown in the dashboard and on every message it relays.">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Finish line" />
      </Field>

      <Field label="Server address" hint="The events API, ending in /api.">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://events-api.example.com/api" />
      </Field>

      <Field
        label="Gateway key"
        hint={
          config.gatewayKeySet
            ? "A key is stored. Type a new one to replace it — it is never shown again."
            : "Copy it from Settings → Digital radio in the dashboard."
        }
      >
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={config.gatewayKeySet ? "••••••••••••" : "Paste the key"}
          autoComplete="off"
        />
      </Field>

      {/* Only a real rejection is worth a red banner. Before the box is set up
          the "error" is just that there is nothing to connect to yet, which the
          empty fields above already say. */}
      {status.provisioned && status.server.lastError && !status.server.connected && (
        <Banner tone="bad" title="The server said no">
          {status.server.lastError}
        </Banner>
      )}

      <button className="btn primary block" disabled={!dirty || saving} onClick={() => void save()}>
        {saving ? <RefreshIcon size={16} className="spin" /> : <CloudIcon size={16} />}
        {saving ? "Saving" : "Save and check in"}
      </button>
    </Card>
  );
}

// ── Event ────────────────────────────────────────────────────────────────────

function EventCard({ status, onChanged }: { status: Status; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const options = status.event.options;

  const choose = async (eventId: string): Promise<void> => {
    setBusy(true);
    await api.selectEvent(eventId || null).catch(() => undefined);
    onChanged();
    setBusy(false);
  };

  return (
    <Card title="Event" action={<CalendarIcon size={15} style={{ color: "var(--text-ghost)" }} />}>
      {!status.server.connected ? (
        <Banner tone="warn">
          The event list comes from the server. Connect this box first and the events will appear here.
        </Banner>
      ) : options.length === 0 ? (
        <Banner tone="info">No events are open on the server right now.</Banner>
      ) : (
        <Field
          label="This handset belongs to"
          hint="Everything heard on the radio goes into this event's team chat, and only this event's messages come back out."
        >
          <select
            value={status.event.id ?? ""}
            disabled={busy}
            onChange={(e) => void choose(e.target.value)}
          >
            <option value="">Not assigned</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.status !== "active" ? ` (${option.status})` : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

      {status.event.id && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <span className={`tag ${status.server.routes.inbound ? "ok" : ""}`}>
            Radio → app {status.server.routes.inbound ? "on" : "off"}
          </span>
          <span className={`tag ${status.server.routes.outbound ? "ok" : ""}`}>
            App → radio {status.server.routes.outbound ? "on" : "off"}
          </span>
          <span className={`tag ${status.server.ttsEnabled ? "ok" : ""}`}>
            Speak text {status.server.ttsEnabled ? "on" : "off"}
          </span>
        </div>
      )}
      {status.event.id && (
        <p className="hint" style={{ marginTop: 10 }}>
          These three switches are set in the dashboard, not here — they belong to the event, not to the box.
        </p>
      )}
    </Card>
  );
}

// ── WiFi ─────────────────────────────────────────────────────────────────────

function WifiCard({ status, setNotice }: { status: Status; setNotice: Notice }) {
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  // The radio cannot scan while it is beaconing as an access point, so the list
  // shown there was taken earlier. Say so rather than passing it off as live.
  const [scanInfo, setScanInfo] = useState<{ cachedAt: string | null; live: boolean }>({
    cachedAt: null,
    live: true,
  });
  const [scanning, setScanning] = useState(false);
  const [chosen, setChosen] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState("");
  const [rescanning, setRescanning] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const scan = useCallback(() => {
    setScanning(true);
    api
      .scanWifi()
      .then((result) => {
        setNetworks(result.networks);
        setScanInfo({ cachedAt: result.cachedAt, live: result.live });
      })
      .catch(() => setNetworks([]))
      .finally(() => setScanning(false));
  }, []);

  /**
   * A real scan while the access point is up means giving the radio back for a
   * moment, so this network goes away and returns. The page cannot be told when
   * that has happened — it is disconnected at the time — so it polls until a
   * list newer than the one on screen appears.
   */
  const rescan = useCallback(async () => {
    const before = scanInfo.cachedAt;
    setRescanning(true);
    try {
      const result = await api.rescanWifi();
      if (result.immediate) {
        scan();
        return;
      }
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          const fresh = await api.scanWifi();
          if (fresh.cachedAt && fresh.cachedAt !== before) {
            setNetworks(fresh.networks);
            setScanInfo({ cachedAt: fresh.cachedAt, live: fresh.live });
            return;
          }
        } catch {
          // Expected while the access point is down and the phone is off it.
        }
      }
    } finally {
      setRescanning(false);
    }
  }, [scan, scanInfo.cachedAt]);

  /** Prefill the passphrase NetworkManager already has for a saved network. */
  const choose = useCallback((network: WifiNetwork) => {
    setChosen(network);
    setPassword("");
    setPrefilled(false);
    if (!network.known) return;
    void api
      .savedPassword(network.ssid)
      .then(({ password: saved }) => {
        if (saved) {
          setPassword(saved);
          setPrefilled(true);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(scan, [scan]);

  const join = async (): Promise<void> => {
    if (!chosen) return;
    const result = await api.joinWifi(chosen.ssid, password || undefined);
    setNotice({ tone: result.ok ? "info" : "bad", text: result.detail });
    setChosen(null);
    setPassword("");
  };

  return (
    <Card
      title="WiFi"
      action={
        <button
          className="btn sm ghost"
          onClick={() => void rescan()}
          disabled={scanning || rescanning}
        >
          <RefreshIcon size={13} className={scanning || rescanning ? "spin" : undefined} />
          {rescanning ? "Scanning…" : "Scan"}
        </button>
      }
    >
      <div className="stats" style={{ marginBottom: 14 }}>
        <div className="stat">
          <b style={{ fontSize: 14 }}>{status.network.mode === "ap" ? "Access point" : status.network.ssid ?? "—"}</b>
          <span>{status.network.mode === "ap" ? "Setup mode" : "Joined"}</span>
        </div>
        <div className="stat">
          <b style={{ fontSize: 14 }}>{status.network.ip ?? "—"}</b>
          <span>Address</span>
        </div>
      </div>

      {rescanning && (
        <Banner tone="warn" title="Scanning — this network is about to disappear">
          The radio cannot beacon and scan at the same time, so the access point goes down for about
          twenty seconds. Your phone should rejoin it by itself; this page will pick up the new list
          when it does.
        </Banner>
      )}

      {!scanInfo.live && networks && networks.length > 0 && (
        <Banner tone="info">
          The radio cannot scan while it is running this access point, so this is the list from{" "}
          {scanInfo.cachedAt ? relativeAge(scanInfo.cachedAt) : "the last scan"}. A network that has
          appeared since will not be here.
        </Banner>
      )}

      {status.network.mode === "ap" && (
        <Banner tone="info" title="You are on the box's own network">
          Choosing a WiFi below will close this access point and this page will stop responding. That is expected —
          the box is joining the venue's network. Bring it back from the dashboard, or it returns by itself if it
          cannot get online.
        </Banner>
      )}

      {chosen ? (
        <>
          <Field
            label={`Password for ${chosen.ssid}`}
            hint={prefilled ? "Filled in from the password this box already has saved." : undefined}
          >
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              placeholder={chosen.security ? "Network password" : "This network is open"}
            />
          </Field>
          <div className="btn-row">
            <button className="btn ghost" onClick={() => setChosen(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void join()}>
              <WifiIcon size={15} /> Join
            </button>
          </div>
        </>
      ) : (
        <div style={{ margin: "0 -16px" }}>
          {networks === null ? (
            <p style={{ padding: "12px 16px", color: "var(--text-ghost)", fontSize: 13 }}>Scanning…</p>
          ) : networks.length === 0 ? (
            <p style={{ padding: "12px 16px", color: "var(--text-ghost)", fontSize: 13 }}>
              {scanInfo.live
                ? "No networks found. Move the box closer to the router and scan again."
                : "This box has not scanned yet, so there is nothing to list while its own network is up. Join a WiFi once and the list will be remembered for next time."}
            </p>
          ) : (
            networks.map((network) => (
              <button
                className="row"
                key={network.ssid}
                onClick={() => choose(network)}
              >
                <div className="row-icon">
                  <SignalBars signal={network.signal} />
                </div>
                <div className="row-main">
                  <strong>{network.ssid}</strong>
                  <span>
                    {network.security || "Open"}
                    {network.known ? " · saved" : ""}
                    {network.active ? " · connected" : ""}
                  </span>
                </div>
                {network.security && <LockIcon size={14} style={{ color: "var(--text-ghost)" }} />}
                {network.active && <CheckIcon size={16} style={{ color: "var(--green)" }} />}
              </button>
            ))
          )}
        </div>
      )}
    </Card>
  );
}

// ── Audio ────────────────────────────────────────────────────────────────────

function AudioCard({
  config,
  patch,
}: {
  config: GatewayConfig;
  patch: (change: Record<string, unknown>) => Promise<void>;
}) {
  const [devices, setDevices] = useState<{ capture: AudioDevice[]; playback: AudioDevice[] } | null>(null);

  useEffect(() => {
    api.audioDevices().then(setDevices).catch(() => undefined);
  }, []);

  return (
    <Card title="Sound card">
      <Field
        label="From the radio (capture)"
        hint="The USB sound card's microphone input, wired to the handset's speaker output."
      >
        <select
          value={config.audio.capture}
          onChange={(e) => void patch({ audio: { ...config.audio, capture: e.target.value } })}
        >
          <option value="">Detect automatically</option>
          {devices?.capture.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
              {device.recommended ? " — recommended" : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="To the radio (playback)" hint="Wired to the handset's microphone input.">
        <select
          value={config.audio.playback}
          onChange={(e) => void patch({ audio: { ...config.audio, playback: e.target.value } })}
        >
          <option value="">Detect automatically</option>
          {devices?.playback.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
              {device.recommended ? " — recommended" : ""}
            </option>
          ))}
        </select>
      </Field>

      <Slider
        label="Input gain"
        value={config.audio.inputGain}
        min={0.2}
        max={4}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        hint="Raise until speech reaches about two thirds of the IN meter. If the meter goes red, it is too high."
        onChange={(inputGain) => void patch({ audio: { ...config.audio, inputGain } })}
      />

      <Slider
        label="Output gain"
        value={config.audio.outputGain}
        min={0.2}
        max={4}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        hint="Too high overdrives the handset's microphone input and everything sounds distorted on the air."
        onChange={(outputGain) => void patch({ audio: { ...config.audio, outputGain } })}
      />
    </Card>
  );
}

// ── Squelch ──────────────────────────────────────────────────────────────────

function SquelchCard({
  config,
  patch,
}: {
  config: GatewayConfig;
  patch: (change: Record<string, unknown>) => Promise<void>;
}) {
  const set = (change: Partial<GatewayConfig["squelch"]>): void => {
    void patch({ squelch: { ...config.squelch, ...change } });
  };

  return (
    <Card title="Squelch">
      <p className="hint" style={{ marginTop: -4, marginBottom: 14 }}>
        When the box decides somebody is talking. Watch the scope on the Live tab while you set these — the dashed
        green line is the opening threshold, and speech should cross it while hiss does not.
      </p>

      <Slider
        label="Opens at"
        value={config.squelch.openLevel}
        min={0.01}
        max={0.3}
        step={0.005}
        format={(v) => v.toFixed(3)}
        onChange={(openLevel) => set({ openLevel })}
      />
      <Slider
        label="Closes below"
        value={config.squelch.closeLevel}
        min={0.005}
        max={0.25}
        step={0.005}
        format={(v) => v.toFixed(3)}
        hint="Lower than the opening level on purpose: one threshold for both makes the squelch chatter mid-sentence."
        onChange={(closeLevel) => set({ closeLevel })}
      />
      <Slider
        label="Hangs on for"
        value={config.squelch.hangMs}
        min={200}
        max={3000}
        step={50}
        format={(v) => `${(v / 1000).toFixed(2)} s`}
        hint="Silence to wait through before ending a transmission, so a pause for breath does not split it in two."
        onChange={(hangMs) => set({ hangMs })}
      />
      <Slider
        label="Ignores anything under"
        value={config.squelch.minDurationMs}
        min={100}
        max={2000}
        step={50}
        format={(v) => `${(v / 1000).toFixed(2)} s`}
        hint="Squelch crashes and accidental key-ups are shorter than this and never reach the chat."
        onChange={(minDurationMs) => set({ minDurationMs })}
      />
    </Card>
  );
}

// ── End-of-transmission tone ─────────────────────────────────────────────────

function BeepCard({
  config,
  patch,
}: {
  config: GatewayConfig;
  patch: (change: Record<string, unknown>) => Promise<void>;
}) {
  const beep = config.rogerBeep;
  const set = (change: Partial<GatewayConfig["rogerBeep"]>): void => {
    void patch({ rogerBeep: { ...beep, ...change } });
  };

  return (
    <Card title="End-of-transmission tone">
      <p className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
        Most radios play a short tone when the other side lets go of the button. It is a far better
        end-of-message signal than silence, which cannot tell the end of a call from someone pausing
        for breath — that is what splits one transmission into several.
      </p>

      <Toggle
        label="Listen for the tone"
        hint="When it is heard, the recording ends there and the tone is cut off. Silence is only the fallback."
        on={beep.enabled}
        onChange={(enabled) => set({ enabled })}
      />

      {beep.enabled && (
        <>
          <Slider
            label="Tone frequency"
            value={beep.frequencyHz}
            min={400}
            max={3000}
            step={10}
            format={(v) => `${v} Hz`}
            hint="1600 Hz on a Hytera X1p. If your radio uses a different tone, the Traffic tab is the place to check whether transmissions are ending where they should."
            onChange={(frequencyHz) => set({ frequencyHz })}
          />
          <Slider
            label="How pure the tone must be"
            value={beep.minRatio}
            min={0.2}
            max={0.9}
            step={0.05}
            format={(v) => v.toFixed(2)}
            hint="How much of a moment's sound must sit at that one frequency. Measured on a real handset: 0.70 during the beep, never above 0.16 during speech — so 0.45 sits comfortably between them. Lower it if beeps are missed, raise it if speech is being cut short."
            onChange={(minRatio) => set({ minRatio })}
          />
          <Slider
            label="Ignore the channel after a beep for"
            value={beep.holdOffMs}
            min={0}
            max={5000}
            step={250}
            format={(v) => (v === 0 ? "off" : `${(v / 1000).toFixed(2)} s`)}
            hint="Radios often send a second tone a second or two after the roger beep. Without this, that beep opens the gate again and lands as an empty transmission behind every real one."
            onChange={(holdOffMs) => set({ holdOffMs })}
          />
          <Slider
            label="Give up and close after"
            value={beep.fallbackHangMs}
            min={1000}
            max={15000}
            step={500}
            format={(v) => `${(v / 1000).toFixed(1)} s`}
            hint="Silence long enough to end a transmission when no tone arrives. It can be generous, because the tone is doing the real work."
            onChange={(fallbackHangMs) => set({ fallbackHangMs })}
          />
        </>
      )}
    </Card>
  );
}

// ── Keying ───────────────────────────────────────────────────────────────────

const BACKENDS = [
  {
    id: "vox" as const,
    title: "VOX",
    detail: "The radio keys itself when it hears audio. No extra wiring, but it clips the first syllable.",
  },
  {
    id: "gpio" as const,
    title: "GPIO pin",
    detail: "A pin on the board pulls the radio's PTT. The only method the box can check for itself.",
  },
  {
    id: "cm108" as const,
    title: "Sound card GPIO",
    detail: "The PTT pin on a CM108/CM119 USB dongle, driven over HID.",
  },
  {
    id: "none" as const,
    title: "Receive only",
    detail: "Never transmit. Use for a listening post.",
  },
];

function KeyingCard({
  config,
  patch,
  setNotice,
}: {
  config: GatewayConfig;
  patch: (change: Record<string, unknown>) => Promise<void>;
  setNotice: Notice;
}) {
  const [checking, setChecking] = useState(false);
  const [testPhrase, setTestPhrase] = useState(config.testPhrase);
  const set = (change: Partial<GatewayConfig["ptt"]>): void => {
    void patch({ ptt: { ...config.ptt, ...change } });
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const result = await api.verifyPtt();
      setNotice({ tone: result.ok ? "ok" : "bad", text: result.detail });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card title="Keying the radio" action={<RadioIcon size={15} style={{ color: "var(--text-ghost)" }} />}>
      <div style={{ margin: "0 -16px 8px" }}>
        {BACKENDS.map((backend) => (
          <button
            className="row"
            key={backend.id}
            onClick={() => set({ backend: backend.id })}
            style={config.ptt.backend === backend.id ? { background: "rgba(59,130,246,0.06)" } : undefined}
          >
            <div
              className="row-icon"
              style={
                config.ptt.backend === backend.id
                  ? { background: "rgba(59,130,246,0.16)", color: "#93c5fd" }
                  : undefined
              }
            >
              {config.ptt.backend === backend.id ? <CheckIcon size={16} /> : <RadioIcon size={15} />}
            </div>
            <div className="row-main">
              <strong>{backend.title}</strong>
              <span style={{ whiteSpace: "normal" }}>{backend.detail}</span>
            </div>
          </button>
        ))}
      </div>

      {config.ptt.backend === "gpio" && (
        <>
          <Field
            label="GPIO number"
            hint="The kernel's number for the pin, not the header position. WIRING.md in the gateway folder has the mapping for the Zero 3."
          >
            <input
              type="number"
              value={config.ptt.gpioPin}
              onChange={(e) => set({ gpioPin: Number(e.target.value) || 0 })}
            />
          </Field>
          <Toggle
            label="Pulling the pin low keys the radio"
            hint="True for almost every opto-isolator and transistor interface. Turn this off only if keying is inverted."
            on={config.ptt.activeLow}
            onChange={(activeLow) => set({ activeLow })}
          />
        </>
      )}

      <Slider
        label={config.ptt.backend === "vox" ? "Wake tone length" : "Wait after keying"}
        value={config.ptt.leadMs}
        min={0}
        max={3000}
        step={50}
        format={(v) => `${v} ms`}
        hint={
          config.ptt.backend === "vox"
            ? "How long the tone plays before the message, to open the radio's VOX. Too short and the first word or two is lost while the gate is still opening."
            : "Gives the transmitter — and any repeater — time to come up before the first word."
        }
        onChange={(leadMs) => set({ leadMs })}
      />

      {config.ptt.backend === "vox" && (
        <>
          <Slider
            label="Wake tone pitch"
            value={config.ptt.voxToneHz}
            min={200}
            max={2000}
            step={20}
            format={(v) => `${v} Hz`}
            hint="Higher carries better into some VOX circuits but is more piercing to sit next to. 480 Hz suits most radios."
            onChange={(voxToneHz) => set({ voxToneHz })}
          />
          <Slider
            label="Wake tone level"
            value={config.ptt.voxToneLevel}
            min={0.05}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            hint="Must be loud enough to HOLD the gate open, not merely to trigger it — a tone that trails off below the VOX threshold lets the gate relax, and the speech has to reopen it, which costs the first word. Raise this before raising the length."
            onChange={(voxToneLevel) => set({ voxToneLevel })}
          />
          <button
            className="btn block"
            style={{ marginBottom: 14 }}
            onClick={() =>
              void api.wakeTone().then((r) => setNotice({ tone: "info", text: r.detail }))
            }
          >
            <ZapIcon size={15} /> Send the wake tone on its own
          </button>
          <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
            Tuning VOX means change, listen, change again. This sends just the tone, so the loop is
            quick and the channel stays clear of whole test messages.
          </p>
        </>
      )}
      <Slider
        label="Hold before unkeying"
        value={config.ptt.tailMs}
        min={0}
        max={1500}
        step={50}
        format={(v) => `${v} ms`}
        hint="Stops the last word being cut off by the transmitter dropping."
        onChange={(tailMs) => set({ tailMs })}
      />
      <Field
        label="What the test says"
        hint="Spoken over the air by the Test transmit button, through the server's speech synthesis. Words rather than a beep, because the question is whether the far end can understand you. Falls back to a tone when the server is unreachable."
      >
        <input
          value={testPhrase}
          onChange={(e) => setTestPhrase(e.target.value)}
          onBlur={() => testPhrase !== config.testPhrase && void patch({ testPhrase })}
          placeholder="Radio check from the command centre."
        />
      </Field>

      <Slider
        label="Never transmit longer than"
        value={config.ptt.maxTxMs}
        min={10000}
        max={300000}
        step={5000}
        format={(v) => `${Math.round(v / 1000)} s`}
        hint="A safety limit. A transmitter stuck open blocks the whole talkgroup."
        onChange={(maxTxMs) => set({ maxTxMs })}
      />

      <button className="btn block" onClick={() => void check()} disabled={checking}>
        {checking ? <RefreshIcon size={16} className="spin" /> : <CheckIcon size={16} />}
        Check the keying line
      </button>
    </Card>
  );
}

// ── Access point ─────────────────────────────────────────────────────────────

function AccessPointCard({
  config,
  status,
  patch,
  setNotice,
}: {
  config: GatewayConfig;
  status: Status;
  patch: (change: Record<string, unknown>) => Promise<void>;
  setNotice: Notice;
}) {
  const [ssid, setSsid] = useState(config.ap.ssid);
  const [password, setPassword] = useState(config.ap.password);

  return (
    <Card title="Setup access point" action={<WifiIcon size={15} style={{ color: "var(--text-ghost)" }} />}>
      <p className="hint" style={{ marginTop: -4, marginBottom: 14 }}>
        The network this page is served on. The board can only do one thing at a time with its radio, so the access
        point is down whenever the box is on the venue's WiFi — bring it back from the dashboard, or it returns by
        itself if the box loses the network for ten minutes.
      </p>

      <Field label="Network name">
        <input
          value={ssid}
          onChange={(e) => setSsid(e.target.value)}
          onBlur={() => ssid !== config.ap.ssid && void patch({ ap: { ...config.ap, ssid } })}
        />
      </Field>
      <Field label="Password" hint="At least 8 characters. Everyone who can join can see the logs and key the radio.">
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() =>
            password !== config.ap.password &&
            password.length >= 8 &&
            void patch({ ap: { ...config.ap, password } })
          }
        />
      </Field>

      <Slider
        label="Stays up for"
        value={config.ap.onDemandMinutes}
        min={5}
        max={120}
        step={5}
        format={(v) => `${v} min`}
        hint="When the dashboard calls the access point back, this is how long it waits before rejoining the venue WiFi on its own."
        onChange={(onDemandMinutes) => void patch({ ap: { ...config.ap, onDemandMinutes } })}
      />

      {status.network.mode === "ap" ? (
        <button
          className="btn block"
          onClick={() =>
            void api.leaveAp().then((r) => setNotice({ tone: "info", text: r.detail }))
          }
        >
          Rejoin the venue WiFi now
        </button>
      ) : (
        <button
          className="btn block"
          onClick={() =>
            void api
              .startAp(config.ap.onDemandMinutes)
              .then((r) => setNotice({ tone: r.ok ? "info" : "bad", text: r.detail }))
          }
        >
          Start the access point
        </button>
      )}
    </Card>
  );
}

// ── Storage ──────────────────────────────────────────────────────────────────

function StorageCard({
  config,
  patch,
}: {
  config: GatewayConfig;
  patch: (change: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <Card title="Recordings kept on this box">
      <Slider
        label="Disk limit"
        value={config.storage.maxMb}
        min={256}
        max={16384}
        step={256}
        format={(v) => `${(v / 1024).toFixed(1)} GB`}
        onChange={(maxMb) => void patch({ storage: { ...config.storage, maxMb } })}
      />
      <Slider
        label="Keep for"
        value={config.storage.maxDays}
        min={1}
        max={90}
        step={1}
        format={(v) => `${v} days`}
        hint="Whichever limit is reached first prunes the oldest recordings. The server keeps its own copies regardless."
        onChange={(maxDays) => void patch({ storage: { ...config.storage, maxDays } })}
      />
    </Card>
  );
}

// ── Maintenance ──────────────────────────────────────────────────────────────

function MaintenanceCard({ status, setNotice }: { status: Status; setNotice: Notice }) {
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, run: () => Promise<{ ok: boolean; detail: string }>): Promise<void> => {
    setBusy(id);
    try {
      const result = await run();
      setNotice({ tone: result.ok ? "ok" : "bad", text: result.detail });
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Maintenance" action={<SettingsIcon size={15} style={{ color: "var(--text-ghost)" }} />}>
      {status.server.updateAvailable && (
        <Banner tone="ok" title={`Version ${status.server.latestVersion} is available`}>
          This box is on {status.version}.
        </Banner>
      )}

      <div className="btn-row">
        <button
          className={`btn${status.server.updateAvailable ? " primary" : ""}`}
          disabled={busy !== null || !status.server.connected}
          onClick={() => void act("update", api.update)}
        >
          {busy === "update" ? <RefreshIcon size={15} className="spin" /> : <CloudIcon size={15} />}
          {status.server.updateAvailable ? "Install the update" : "Check for updates"}
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => void act("checkin", async () => {
          const result = await api.checkIn();
          return { ok: result.ok, detail: result.ok ? "Checked in with the server." : "The server did not answer." };
        })}>
          <RefreshIcon size={15} /> Check in now
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => void act("restart", api.restart)}>
          Restart the service
        </button>
        <button
          className="btn danger"
          disabled={busy !== null}
          onClick={() => {
            if (confirm("Reboot the box? The radio link is down for about a minute.")) {
              void act("reboot", api.reboot);
            }
          }}
        >
          Reboot
        </button>
      </div>

      <div className="stats" style={{ marginTop: 14 }}>
        <div className="stat">
          <b style={{ fontSize: 13 }}>{status.version}</b>
          <span>Version</span>
        </div>
        <div className="stat">
          <b style={{ fontSize: 13 }}>{status.id.slice(0, 8)}</b>
          <span>Box ID</span>
        </div>
        <div className="stat">
          <b style={{ fontSize: 13 }}>{status.health.diskFreeMb ? `${Math.round(status.health.diskFreeMb / 1024)} GB` : "—"}</b>
          <span>Free space</span>
        </div>
      </div>
    </Card>
  );
}

/** "4 minutes ago" for the cached-scan note. */
function relativeAge(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 90) return "a moment ago";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}
