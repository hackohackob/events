import { useEffect, useRef, useState } from "react";
import { api, formatBytes, formatUptime, type Status } from "../lib/api";
import type { Levels } from "../lib/useGateway";
import { HeadphonesIcon, RadioIcon, ZapIcon } from "../lib/icons";
import { Banner, Card } from "./ui";
import { Meters } from "./Meters";
import { PttButton } from "./PttButton";
import { Scope } from "./Scope";

/**
 * The screen the box is left on: what the channel is doing right now, and the
 * three things anybody ever needs in a hurry — talk, listen, test.
 */
export function LiveTab({
  status,
  subscribeLevels,
  squelch,
  onNavigate,
}: {
  status: Status;
  subscribeLevels: (fn: (l: Levels) => void) => () => void;
  squelch: { openLevel: number; closeLevel: number };
  onNavigate: (tab: "setup") => void;
}) {
  const [monitoring, setMonitoring] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const { receiving, transmitting } = status.radio;
  const state = transmitting ? "tx" : receiving ? "rx" : "idle";

  useEffect(() => {
    if (!monitoring) {
      audio.current?.pause();
      audio.current = null;
      return;
    }
    // A fresh element each time: an endless stream cannot be seeked, and
    // re-using a stalled one is the reliable way to get silence.
    const element = new Audio(`/api/monitor.wav?t=${Date.now()}`);
    element.autoplay = true;
    audio.current = element;
    void element.play().catch(() => {
      setNotice({ tone: "bad", text: "The browser blocked audio. Tap Listen again." });
      setMonitoring(false);
    });
    return () => {
      element.pause();
      element.src = "";
    };
  }, [monitoring]);

  const act = async (label: string, run: () => Promise<{ ok: boolean; detail?: string }>) => {
    setNotice({ tone: "info", text: `${label}…` });
    try {
      const result = await run();
      setNotice({ tone: result.ok ? "ok" : "bad", text: result.detail ?? (result.ok ? "Done." : "Failed.") });
    } catch (err) {
      setNotice({ tone: "bad", text: (err as Error).message });
    }
  };

  const canTransmit = status.radio.pttBackend !== "none";

  return (
    <>
      {!status.provisioned && (
        <Banner tone="warn" title="This box is not set up yet">
          It needs the server address and the gateway key before it can bridge anything.{" "}
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => onNavigate("setup")}>
            Open setup
          </button>
        </Banner>
      )}

      {status.radio.pttError && (
        <Banner tone="bad" title="The transmitter could not be keyed">
          {status.radio.pttError}
        </Banner>
      )}

      {status.server.queued > 0 && (
        <Banner tone="warn" title={`${status.server.queued} transmission${status.server.queued === 1 ? "" : "s"} waiting`}>
          The server was unreachable when these came in. They are safe on the card and will be sent when the link
          returns.
          <button
            className="btn sm ghost"
            style={{ marginTop: 8 }}
            onClick={() => void act("Sending", async () => {
              const result = await api.retryQueue();
              return { ok: result.ok, detail: `Sent ${result.sent}.` };
            })}
          >
            Try now
          </button>
        </Banner>
      )}

      <div className={`channel ${state}`}>
        <div className="channel-state">
          <strong>
            {transmitting ? "Transmitting" : receiving ? "Receiving" : "Channel clear"}
          </strong>
        </div>
        <div className="channel-sub">
          {status.activity}
          {status.queueLength > 0 && ` · ${status.queueLength} waiting to go out`}
        </div>

        <Scope subscribe={subscribeLevels} openLevel={squelch.openLevel} closeLevel={squelch.closeLevel} />
        <Meters subscribe={subscribeLevels} />

        <div className="ptt-zone">
          <PttButton disabled={!canTransmit} keyed={status.liveKeyed} />
          <button
            className={`icon-btn${monitoring ? " on" : ""}`}
            onClick={() => setMonitoring((on) => !on)}
            aria-pressed={monitoring}
          >
            <HeadphonesIcon size={22} />
            <span>{monitoring ? "Stop" : "Listen"}</span>
          </button>
        </div>

        {!canTransmit && (
          <p style={{ fontSize: 12, color: "var(--text-ghost)", marginTop: 10 }}>
            Keying is switched off, so this box can only receive. Choose how the radio is keyed in Setup.
          </p>
        )}
      </div>

      {notice && (
        <Banner tone={notice.tone === "info" ? "info" : notice.tone}>{notice.text}</Banner>
      )}

      <Card title="Check the wiring">
        <div className="btn-row">
          <button className="btn" onClick={() => void act("Sending a test tone", api.testTone)}>
            <ZapIcon size={16} /> Test transmit
          </button>
          <button className="btn" onClick={() => void act("Checking the PTT line", api.verifyPtt)}>
            <RadioIcon size={16} /> Check keying
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-ghost)", marginTop: 11, lineHeight: 1.5 }}>
          <strong style={{ color: "var(--text-faint)" }}>Test transmit</strong> keys the radio and sends a short
          chirp — listen for it on a second handset.{" "}
          <strong style={{ color: "var(--text-faint)" }}>Check keying</strong> pulses the PTT line and reads it back
          where the hardware allows, which is how you tell a wrong pin from a wrong cable.
        </p>
      </Card>

      <div className="stats">
        <div className="stat">
          <b>{status.storage.recordings}</b>
          <span>Recordings</span>
        </div>
        <div className="stat">
          <b>{formatUptime(status.health.uptimeS)}</b>
          <span>Uptime</span>
        </div>
        <div className="stat">
          <b>{status.health.cpuTempC ? `${Math.round(status.health.cpuTempC)}°` : "—"}</b>
          <span>CPU temp</span>
        </div>
        <div className="stat">
          <b>{formatBytes(status.storage.bytes)}</b>
          <span>Audio kept</span>
        </div>
      </div>
    </>
  );
}
