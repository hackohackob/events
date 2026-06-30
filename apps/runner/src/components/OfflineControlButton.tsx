import { useEffect, useRef, useState } from "react";
import { OfflineMapModal } from "./OfflineMapModal";
import {
  downloadPack,
  getPackMeta,
  removePack,
  type Bounds,
  type OfflineQuality,
} from "../lib/offline-map";

type Phase = "idle" | "downloading" | "ready" | "error";

/**
 * Square control-stack button (sibling of the satellite/recenter/compass
 * buttons) that downloads the current event area for offline use. Shows a live
 * % ring while caching and a green check when a pack is saved; tapping a saved
 * pack removes it, tapping mid-download cancels.
 */
export function OfflineControlButton({ getBounds }: { getBounds: () => Bounds | null }) {
  const [phase, setPhase] = useState<Phase>(() => (getPackMeta() ? "ready" : "idle"));
  const [pct, setPct] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A saved pack persists in localStorage, so the button must always come back
  // green once the map is downloaded — even after a remount or the PWA resuming
  // from the background. Re-sync idle→ready whenever a pack exists.
  useEffect(() => {
    const sync = () => {
      if (getPackMeta()) setPhase((prev) => (prev === "idle" ? "ready" : prev));
    };
    sync();
    window.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const press = () => {
    if (phase === "downloading") {
      abortRef.current?.abort();
      setPhase("idle");
      setPct(0);
      return;
    }
    if (phase === "ready") {
      void removePack();
      setPhase("idle");
      setPct(0);
      return;
    }
    setModalOpen(true);
  };

  const start = async (quality: OfflineQuality) => {
    setModalOpen(false);
    const bounds = getBounds();
    if (!bounds) {
      setPhase("error");
      setTimeout(() => setPhase(getPackMeta() ? "ready" : "idle"), 2500);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("downloading");
    setPct(0);
    try {
      await downloadPack({
        bounds,
        minZoom: quality.minZoom,
        maxZoom: quality.maxZoom,
        signal: ctrl.signal,
        onProgress: (p) => setPct(p.total ? Math.round((p.done / p.total) * 100) : 0),
      });
      setPhase("ready");
      setPct(100);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setPhase("error");
      setTimeout(() => setPhase(getPackMeta() ? "ready" : "idle"), 2500);
    }
  };

  const accent =
    phase === "ready" ? "var(--primary)" : phase === "error" ? "var(--critical)" : "var(--live-gps)";

  return (
    <>
      <button
        onClick={press}
        title="Offline map"
        style={{
          position: "relative",
          width: 40,
          height: 40,
          borderRadius: 13,
          background: "var(--bg-overlay)",
          border: `1px solid ${phase === "idle" ? "rgba(255,255,255,0.10)" : accent}`,
          color: accent,
          display: "grid",
          placeItems: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.30)",
        }}
      >
        {phase === "downloading" ? (
          <ProgressRing pct={pct} color="var(--live-gps)" />
        ) : (
          <>
            <DownloadCloud color={accent} />
            {phase === "ready" && (
              <span
                style={{
                  position: "absolute",
                  right: -4,
                  bottom: -4,
                  width: 15,
                  height: 15,
                  borderRadius: 8,
                  background: "var(--primary)",
                  color: "#04121f",
                  fontSize: 9,
                  fontWeight: 900,
                  display: "grid",
                  placeItems: "center",
                  border: "1.5px solid var(--bg-base)",
                }}
              >
                ✓
              </span>
            )}
          </>
        )}
      </button>

      <OfflineMapModal open={modalOpen} bounds={getBounds()} onClose={() => setModalOpen(false)} onConfirm={start} />
    </>
  );
}

function ProgressRing({ pct, color }: { pct: number; color: string }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <span style={{ position: "relative", width: 32, height: 32, display: "grid", placeItems: "center" }}>
      <svg width="32" height="32" viewBox="0 0 32 32" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: "stroke-dashoffset 0.2s" }}
        />
      </svg>
      <span style={{ fontSize: 9, fontWeight: 800, color }}>{pct}</span>
    </span>
  );
}

function DownloadCloud({ size = 19, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 17a5 5 0 0 1-.916-9.916 5.002 5.002 0 0 1 9.832 0A5 5 0 0 1 16 17" />
      <path d="M12 12v9" />
      <path d="m8 17 4 4 4-4" />
    </svg>
  );
}
