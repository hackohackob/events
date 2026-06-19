import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

const BPM = 110;
const BEAT_MS = 60_000 / BPM;
const COMPRESSIONS = 30;
const BREATHS_MS = 7000;

type Phase = "idle" | "compressions" | "breaths";

/**
 * Full-screen CPR coach: a metronome at 110 bpm with audio + haptic beats, a
 * pulsing PUSH target, 30 compressions then a 2-breath pause, repeating. An
 * optional screen strobe helps rescuers/medics spot the location.
 */
export function CprMode({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(0);
  const [cycle, setCycle] = useState(1);
  const [strobe, setStrobe] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const circleRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(0);

  const beep = (freq: number, dur = 0.08, vol = 0.6) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now);
    o.stop(now + dur + 0.02);
  };

  const pulse = () => {
    circleRef.current?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.86)" }, { transform: "scale(1)" }],
      { duration: 260, easing: "ease-out" },
    );
  };

  const clearTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const startCompressions = () => {
    setPhase("compressions");
    countRef.current = 0;
    setCount(0);
    clearTimer();
    // Side effects live in the interval body (not the state updater) so they fire
    // exactly once per beat — React StrictMode double-invokes updaters.
    timerRef.current = window.setInterval(() => {
      countRef.current += 1;
      beep(880);
      navigator.vibrate?.(35);
      pulse();
      setCount(countRef.current);
      if (countRef.current >= COMPRESSIONS) {
        clearTimer();
        startBreaths();
      }
    }, BEAT_MS);
  };

  const startBreaths = () => {
    setPhase("breaths");
    beep(440, 0.25, 0.5);
    navigator.vibrate?.([120, 80, 120]);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setCycle((n) => n + 1);
      startCompressions();
    }, BREATHS_MS);
  };

  const start = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctxRef.current = new AC();
    }
    void ctxRef.current?.resume();
    setCycle(1);
    startCompressions();
  };

  useEffect(() => () => clearTimer(), []);

  const active = phase !== "idle";
  const isBreaths = phase === "breaths";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: isBreaths ? "linear-gradient(180deg,#0A1B2E,#0A1118)" : "linear-gradient(180deg,#1A0E12,#0A1118)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "44px 20px 24px",
      }}
    >
      {strobe && active && (
        <div style={{ position: "absolute", inset: 0, background: "#fff", animation: "livePulse 0.5s steps(1) infinite", pointerEvents: "none", opacity: 0.0 }} />
      )}
      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="archivo" style={{ fontWeight: 900, fontSize: 16, color: "#fff" }}>{t("cpr.title")}</span>
        <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 18 }}>✕</button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <div
          ref={circleRef}
          style={{
            width: 240,
            height: 240,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: isBreaths
              ? "radial-gradient(circle at 50% 40%, rgba(46,155,255,0.35), rgba(46,155,255,0.08))"
              : "radial-gradient(circle at 50% 40%, rgba(230,57,70,0.5), rgba(230,57,70,0.12))",
            border: `3px solid ${isBreaths ? "#2E9BFF" : "#E63946"}`,
            boxShadow: isBreaths ? "0 0 60px rgba(46,155,255,0.4)" : "0 0 60px rgba(230,57,70,0.45)",
          }}
        >
          {!active ? (
            <span className="archivo" style={{ fontWeight: 900, fontSize: 26, color: "#fff" }}>CPR</span>
          ) : isBreaths ? (
            <div style={{ textAlign: "center" }}>
              <div className="archivo" style={{ fontWeight: 900, fontSize: 26, color: "#fff" }}>{t("cpr.breaths")}</div>
            </div>
          ) : (
            <div style={{ textAlign: "center" }}>
              <div className="archivo" style={{ fontWeight: 900, fontSize: 72, color: "#fff", lineHeight: 1 }}>{count}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{t("cpr.push")}</div>
            </div>
          )}
        </div>

        {active && (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.85)" }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{isBreaths ? t("cpr.breathsHint") : `${BPM} bpm · ${t("cpr.cycle", { n: cycle })}`}</div>
          </div>
        )}
        {!active && (
          <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 14, textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>{t("cpr.tagline")}</p>
        )}
      </div>

      {!active ? (
        <button className="btn-primary" onClick={start} style={{ background: "linear-gradient(135deg,#FF5964,#E63946)", color: "#fff", boxShadow: "0 12px 28px rgba(230,57,70,0.4)" }}>
          ▶ {t("cpr.start")}
        </button>
      ) : (
        <div style={{ width: "100%", display: "flex", gap: 10 }}>
          <button
            onClick={() => setStrobe((s) => !s)}
            style={{ flex: 1, padding: 16, borderRadius: 16, border: `1px solid ${strobe ? "var(--caution)" : "var(--border-mid)"}`, color: strobe ? "var(--caution)" : "var(--text-secondary)", fontWeight: 700, background: "transparent" }}
          >
            ⚡ {t("cpr.strobe")}
          </button>
          <button
            onClick={() => {
              clearTimer();
              setPhase("idle");
              setCount(0);
            }}
            style={{ flex: 1, padding: 16, borderRadius: 16, border: "1px solid var(--border-mid)", color: "#fff", fontWeight: 800, background: "rgba(255,255,255,0.08)" }}
          >
            ⏹ {t("cpr.stop")}
          </button>
        </div>
      )}
    </div>
  );
}
