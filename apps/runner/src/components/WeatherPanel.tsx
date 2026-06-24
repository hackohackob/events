import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { fmtHour, tempColor, weatherGlyph, type Forecast } from "../lib/weather";

/**
 * Bottom weather scrubber. Drag (or play) across the next 12 hours; the headline
 * readout, the on-map radar frame and the along-route temperature points all
 * follow the scrubbed hour.
 */
export function WeatherPanel({
  forecast,
  scrubIndex,
  onScrub,
  playing,
  onTogglePlay,
  radarLive,
  onClose,
}: {
  forecast: Forecast | null;
  scrubIndex: number;
  onScrub: (i: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  radarLive: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(160, e[0].contentRect.width)));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const hours = forecast?.primary.hours ?? [];
  const cur = hours[scrubIndex];
  const glyph = cur ? weatherGlyph(cur.code, cur.cloudPct) : { icon: "⏳", label: "" };

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 74,
        zIndex: 6,
        borderRadius: 24,
        padding: "12px 14px 14px",
        background: "linear-gradient(180deg, rgba(14,22,34,0.72), rgba(8,12,18,0.92))",
        backdropFilter: "blur(18px) saturate(1.25)",
        WebkitBackdropFilter: "blur(18px) saturate(1.25)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        animation: "dockIn 0.35s ease",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="section-label" style={{ color: "var(--live-gps)", fontSize: 10 }}>
          {t("weather.title")}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: "0.06em",
            background: radarLive ? "rgba(46,155,255,0.16)" : "rgba(255,255,255,0.06)",
            color: radarLive ? "var(--live-gps)" : "var(--text-muted)",
            border: `1px solid ${radarLive ? "rgba(46,155,255,0.4)" : "rgba(255,255,255,0.08)"}`,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: radarLive ? "var(--live-gps)" : "var(--text-muted)",
              animation: radarLive ? "breathe 1.4s infinite" : "none",
            }}
          />
          {radarLive ? t("weather.liveRadar") : t("weather.forecast")}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onTogglePlay} title="Play" style={iconBtn}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button onClick={onClose} title="Close" style={iconBtn}>
          ✕
        </button>
      </div>

      {/* Readout */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 2px 10px" }}>
        <span style={{ fontSize: 38, lineHeight: 1 }}>{glyph.icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="archivo" style={{ fontWeight: 800, fontSize: 30, color: cur ? tempColor(cur.tempC) : "var(--text-primary)" }}>
              {cur ? `${Math.round(cur.tempC)}°` : "—"}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{glyph.label}</span>
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", marginTop: 1 }}>
            {cur
              ? `${scrubIndex === 0 ? t("weather.now") : fmtHour(cur.time)} · ☁ ${Math.round(cur.cloudPct)}% · 💧 ${cur.precipMm.toFixed(1)}mm (${Math.round(cur.precipProb)}%)`
              : t("weather.loading")}
          </div>
        </div>
      </div>

      {/* Timeline chart */}
      <div ref={wrapRef} style={{ width: "100%" }}>
        <TimelineChart width={w} hours={hours} scrubIndex={scrubIndex} onScrub={onScrub} />
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 9,
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "var(--text-secondary)",
  fontSize: 12,
  fontWeight: 800,
  display: "grid",
  placeItems: "center",
};

function TimelineChart({
  width,
  hours,
  scrubIndex,
  onScrub,
}: {
  width: number;
  hours: Forecast["primary"]["hours"];
  scrubIndex: number;
  onScrub: (i: number) => void;
}) {
  const H = 84;
  const padX = 10;
  const padTop = 8;
  const padBottom = 22;
  const innerW = Math.max(1, width - padX * 2);

  if (hours.length < 2) {
    return <div style={{ width: "100%", height: H, borderRadius: 12, background: "rgba(14,26,40,0.6)" }} />;
  }

  const n = hours.length;
  const xOf = (i: number) => padX + (i / (n - 1)) * innerW;
  const temps = hours.map((h) => h.tempC);
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps, minT + 1);
  const yOf = (tC: number) => padTop + (1 - (tC - minT) / (maxT - minT)) * (H - padTop - padBottom);
  const maxPrecip = Math.max(1, ...hours.map((h) => h.precipMm));

  const line = hours.map((h, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(h.tempC).toFixed(1)}`).join(" ");

  const handlePointer = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerW, clientX - rect.left - padX));
    const i = Math.round((x / innerW) * (n - 1));
    onScrub(Math.max(0, Math.min(n - 1, i)));
  };

  const sx = xOf(scrubIndex);

  return (
    <svg
      width={width}
      height={H}
      style={{ borderRadius: 12, background: "rgba(14,26,40,0.6)", border: "1px solid rgba(255,255,255,0.06)", display: "block", touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        handlePointer(e.clientX, e.currentTarget);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) handlePointer(e.clientX, e.currentTarget);
      }}
    >
      <defs>
        <linearGradient id="wxTemp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB020" stopOpacity="0.35" />
          <stop offset="1" stopColor="#FFB020" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Precipitation bars */}
      {hours.map((h, i) => {
        const bh = (h.precipMm / maxPrecip) * (H - padTop - padBottom) * 0.85;
        if (h.precipMm < 0.05) return null;
        const bw = Math.max(3, innerW / n - 4);
        return (
          <rect
            key={i}
            x={xOf(i) - bw / 2}
            y={H - padBottom - bh}
            width={bw}
            height={bh}
            rx={2}
            fill="var(--live-gps)"
            opacity={0.25 + 0.5 * (h.precipProb / 100)}
          />
        );
      })}

      {/* Temperature area + line */}
      <path d={`${line} L ${xOf(n - 1)} ${H - padBottom} L ${xOf(0)} ${H - padBottom} Z`} fill="url(#wxTemp)" />
      <path d={line} fill="none" stroke="#FFB020" strokeWidth="2.2" />
      {hours.map((h, i) => (
        <circle key={i} cx={xOf(i)} cy={yOf(h.tempC)} r={i === scrubIndex ? 3.5 : 2} fill={tempColor(h.tempC)} />
      ))}

      {/* Hour ticks (every 3h) */}
      {hours.map((_, i) =>
        i % 3 === 0 ? (
          <text key={i} x={xOf(i)} y={H - 7} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--text-muted)">
            {i === 0 ? "now" : `+${i}h`}
          </text>
        ) : null,
      )}

      {/* Scrubber */}
      <line x1={sx} y1={2} x2={sx} y2={H - padBottom + 4} stroke="#F2F6FB" strokeWidth="1.4" />
      <circle cx={sx} cy={yOf(hours[scrubIndex].tempC)} r="5.5" fill="#fff" stroke={tempColor(hours[scrubIndex].tempC)} strokeWidth="2.5" />
    </svg>
  );
}
