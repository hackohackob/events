import { useEffect, useState } from "react";
import { useGateway } from "./lib/useGateway";
import { CloudIcon, ListIcon, RadioIcon, SettingsIcon, TerminalIcon, WifiIcon } from "./lib/icons";
import { LiveTab } from "./components/LiveTab";
import { LogsTab } from "./components/LogsTab";
import { SetupTab } from "./components/SetupTab";
import { TrafficTab } from "./components/TrafficTab";

type Tab = "live" | "traffic" | "logs" | "setup";

const TABS: Array<{ id: Tab; label: string; icon: typeof RadioIcon }> = [
  { id: "live", label: "Live", icon: RadioIcon },
  { id: "traffic", label: "Traffic", icon: ListIcon },
  { id: "logs", label: "Logs", icon: TerminalIcon },
  { id: "setup", label: "Setup", icon: SettingsIcon },
];

/**
 * The console shell: a status header that is always true, four tabs, and a
 * connection to the box that reconnects without saying anything about it.
 *
 * The header is the part that earns its space. Three pills — server, WiFi,
 * radio — are the whole health of the bridge, and they are the first thing
 * somebody looks at when a coordinator says "is the radio working?".
 */
export default function App() {
  const [tab, setTab] = useState<Tab>("live");
  const { status, logs, connected, subscribeLevels, subscribeTones, refresh, recordingBump } =
    useGateway();
  // Mirrored from the box so the scope can draw the thresholds and know whether
  // to show beep markers at all.
  const [squelch, setSquelch] = useState({ openLevel: 0.06, closeLevel: 0.035 });
  const [beepsEnabled, setBeepsEnabled] = useState(true);

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((config: { squelch: { openLevel: number; closeLevel: number }; rogerBeep?: { enabled: boolean } }) => {
        setSquelch(config.squelch);
        setBeepsEnabled(config.rogerBeep?.enabled ?? false);
      })
      .catch(() => undefined);
  }, []);

  const errorCount = logs.filter((entry) => entry.level === "error").length;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-row">
          <div className={`brandmark${status?.radio.receiving || status?.radio.transmitting ? " is-live" : ""}`}>
            <RadioIcon size={20} />
          </div>
          <div className="topbar-title">
            <h1>{status?.name ?? "Radio gateway"}</h1>
            <p>
              {status?.event.name
                ? status.event.name
                : status?.provisioned
                  ? "No event assigned"
                  : "Not set up yet"}
            </p>
          </div>
        </div>

        <div className="pills">
          <span className={`pill ${!connected ? "bad" : status?.server.connected ? "ok" : "warn"}`}>
            <i className="dot" />
            <CloudIcon size={12} />
            {!connected ? "Console offline" : status?.server.connected ? "Server" : "No server"}
          </span>

          <span className={`pill ${status?.network.mode === "client" ? "ok" : "warn"}`}>
            <i className="dot" />
            <WifiIcon size={12} />
            {status?.network.mode === "ap"
              ? "Access point"
              : status?.network.ssid
                ? status.network.ssid
                : "No WiFi"}
          </span>

          <span
            className={`pill ${
              status?.radio.pttError ? "bad" : status?.radio.pttBackend === "none" ? "warn" : "ok"
            }`}
          >
            <i className="dot" />
            <RadioIcon size={12} />
            {status?.radio.pttError
              ? "Keying fault"
              : status?.radio.pttBackend === "none"
                ? "Receive only"
                : `Keying: ${status?.radio.pttBackend ?? "—"}`}
          </span>

          {status && status.server.queued > 0 && (
            <span className="pill warn">
              <i className="dot" />
              {status.server.queued} queued
            </span>
          )}
        </div>
      </header>

      <main className="scroll">
        {!status ? (
          <div className="empty">
            <RadioIcon size={30} />
            <div>Connecting to the gateway…</div>
          </div>
        ) : tab === "live" ? (
          <LiveTab
            status={status}
            subscribeLevels={subscribeLevels}
            subscribeTones={subscribeTones}
            squelch={squelch}
            beepsEnabled={beepsEnabled}
            onNavigate={setTab}
          />
        ) : tab === "traffic" ? (
          <TrafficTab bump={recordingBump} />
        ) : tab === "logs" ? (
          <LogsTab logs={logs} />
        ) : (
          <SetupTab
            status={status}
            onChanged={() => {
              void refresh();
              // The scope draws the squelch thresholds, so it needs to hear
              // about a change made on this screen.
              void fetch("/api/config")
                .then((r) => r.json())
                .then(
                  (config: {
                    squelch: { openLevel: number; closeLevel: number };
                    rogerBeep?: { enabled: boolean };
                  }) => {
                    setSquelch(config.squelch);
                    setBeepsEnabled(config.rogerBeep?.enabled ?? false);
                  },
                )
                .catch(() => undefined);
            }}
          />
        )}
      </main>

      <nav className="tabbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
            <Icon size={19} />
            {label}
            {id === "logs" && errorCount > 0 && <span className="badge">{errorCount > 9 ? "9+" : errorCount}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
