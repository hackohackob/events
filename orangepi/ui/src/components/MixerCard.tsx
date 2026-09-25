import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { AlertIcon, RefreshIcon } from "../lib/icons";
import { Banner, Card } from "./ui";

/**
 * The sound card's own mixer, exposed because swapping a card changes
 * everything about how it behaves — and the difference between a working box
 * and a radio that transmits forever can be one switch on this screen.
 */
export function MixerCard() {
  const [controls, setControls] = useState<
    Array<{
      name: string;
      hasPlaybackVolume: boolean;
      hasPlaybackSwitch: boolean;
      hasCaptureVolume: boolean;
      hasCaptureSwitch: boolean;
      playbackPercent: number | null;
      capturePercent: number | null;
      playbackOn: boolean | null;
      captureOn: boolean | null;
      isMonitorPath: boolean;
    }>
  >([]);
  const [card, setCard] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    api
      .mixer()
      .then((m) => {
        setControls(m.controls);
        setCard(m.card);
      })
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);

  const apply = async (body: Parameters<typeof api.setMixer>[0]): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.setMixer(body);
      setNotice({ ok: result.ok, text: result.detail });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const monitors = controls.filter((c) => c.isMonitorPath);
  const live = monitors.filter((c) => c.playbackOn === true || (c.playbackPercent ?? 0) > 0);

  return (
    <Card
      title="Sound card controls"
      collapsible
      badge={card !== null ? `card ${card}` : undefined}
    >
      {notice && <Banner tone={notice.ok ? "ok" : "bad"}>{notice.text}</Banner>}

      {live.length > 0 && (
        <Banner tone="bad" title="This card is feeding its input back to its output">
          {live.map((c) => c.name).join(", ")} — whatever the radio receives is being played back
          into the radio's own microphone. With VOX on, that keys it and never lets go.
        </Banner>
      )}

      <button
        className="btn danger block"
        disabled={busy}
        onClick={() =>
          void api.muteMonitors().then((r) => {
            setNotice({ ok: r.ok, text: r.detail });
            refresh();
          })
        }
      >
        {busy ? <RefreshIcon size={15} className="spin" /> : <AlertIcon size={15} />}
        Silence everything that loops input back out
      </button>

      <p className="hint" style={{ marginTop: 10, marginBottom: 4 }}>
        Controls marked <strong style={{ color: "var(--red)" }}>monitor</strong> route the
        microphone input back to the output. On a headset that is a feature; wired to a radio it is
        a feedback loop.
      </p>

      <div style={{ margin: "14px -16px 0" }}>
        {controls.length === 0 ? (
          <p className="hint" style={{ padding: "0 16px" }}>
            This card exposes no mixer controls.
          </p>
        ) : (
          controls.map((c) => (
            <div className="row" key={c.name} style={{ display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <strong style={{ fontSize: 14, flex: 1 }}>{c.name}</strong>
                {c.isMonitorPath && <span className="tag bad">monitor</span>}
              </div>

              {c.hasPlaybackSwitch && (
                <label style={rowStyle}>
                  <span style={labelStyle}>Playback</span>
                  <button
                    className={`toggle${c.playbackOn ? " on" : ""}`}
                    disabled={busy}
                    onClick={() => void apply({ name: c.name, side: "playback", on: !c.playbackOn })}
                  />
                </label>
              )}
              {c.hasPlaybackVolume && (
                <label style={rowStyle}>
                  <span style={labelStyle}>Play level</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={c.playbackPercent ?? 0}
                    disabled={busy}
                    onChange={(e) =>
                      void apply({ name: c.name, side: "playback", volume: Number(e.target.value) })
                    }
                    style={{ flex: 1 }}
                  />
                  <span style={valueStyle}>{c.playbackPercent ?? 0}%</span>
                </label>
              )}
              {c.hasCaptureSwitch && (
                <label style={rowStyle}>
                  <span style={labelStyle}>Capture</span>
                  <button
                    className={`toggle${c.captureOn ? " on" : ""}`}
                    disabled={busy}
                    onClick={() => void apply({ name: c.name, side: "capture", on: !c.captureOn })}
                  />
                </label>
              )}
              {c.hasCaptureVolume && (
                <label style={rowStyle}>
                  <span style={labelStyle}>Cap level</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={c.capturePercent ?? 0}
                    disabled={busy}
                    onChange={(e) =>
                      void apply({ name: c.name, side: "capture", volume: Number(e.target.value) })
                    }
                    style={{ flex: 1 }}
                  />
                  <span style={valueStyle}>{c.capturePercent ?? 0}%</span>
                </label>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

const rowStyle = { display: "flex", alignItems: "center", gap: 10, padding: "4px 0" } as const;
const labelStyle = {
  width: 74,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--text-ghost)",
} as const;
const valueStyle = {
  width: 38,
  textAlign: "right",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-ghost)",
} as const;
