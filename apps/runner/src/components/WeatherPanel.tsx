import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { fmtHour, tempColor, weatherGlyph, type Forecast } from "../lib/weather";

const ACCENT = "var(--live-gps)";

/**
 * Bottom weather scrubber. Drag (or play) across the next 12 hours; the headline
 * readout and the along-route temperature points follow the scrubbed hour. The
 * on-map precipitation field is live Tomorrow.io tiles (current conditions), so
 * the badge reads LIVE at "now" and FORECAST as you scrub ahead. Themed and
 * non-selectable so the scrub gesture never highlights text.
 */
export function WeatherPanel({
  forecast,
  scrubIndex,
  onScrub,
  playing,
  onTogglePlay,
  onClose,
}: {
  forecast: Forecast | null;
  scrubIndex: number;
  onScrub: (i: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
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
  const glyph = cur ? weatherGlyph(cur.code, cur.cloudPct, cur.isDay) : { icon: "⏳", label: "" };
  const relative = scrubIndex === 0 ? t("weather.now") : `+${scrubIndex}h`;
  // Precipitation tiles are "now"; scrubbing ahead drives only the forecast read.
  const radarLive = scrubIndex === 0;

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
        background: "var(--bg-overlay)",
        backdropFilter: "blur(18px) saturate(1.2)",
        WebkitBackdropFilter: "blur(18px) saturate(1.2)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        animation: "dockIn 0.35s ease",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="section-label" style={{ color: ACCENT, fontSize: 10 }}>
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
            background: radarLive ? "rgba(46,155,255,0.16)" : "var(--bg-card)",
            color: radarLive ? ACCENT : "var(--text-muted)",
            border: `1px solid ${radarLive ? "rgba(46,155,255,0.4)" : "var(--border-subtle)"}`,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: radarLive ? ACCENT : "var(--text-muted)",
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

      {/* Readout: condition on the left, prominent time on the right */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 2px 10px" }}>
        <span style={{ fontSize: 38, lineHeight: 1 }}>{glyph.icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="archivo"
              style={{ fontWeight: 800, fontSize: 30, lineHeight: 1, color: cur ? tempColor(cur.tempC) : "var(--text-primary)" }}
            >
              {cur ? `${Math.round(cur.tempC)}°` : "—"}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{glyph.label}</span>
          </div>
        </div>
        {/* Prominent time */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="archivo" style={{ fontWeight: 800, fontSize: 24, lineHeight: 1, color: "var(--text-primary)" }}>
            {cur ? fmtHour(cur.time) : "—"}
          </div>
          <div
            style={{
              display: "inline-block",
              marginTop: 4,
              padding: "1px 8px",
              borderRadius: 999,
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: "0.04em",
              color: ACCENT,
              background: "rgba(46,155,255,0.14)",
            }}
          >
            {relative}
          </div>
        </div>
      </div>

      {/* Current detail line (precip field is shown on the map itself) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)" }}>
          {t("weather.precip")}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {cur ? `☁ ${Math.round(cur.cloudPct)}% · 💧 ${cur.precipMm.toFixed(1)}mm` : t("weather.loading")}
        </span>
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
  background: "var(--bg-card)",
  border: "1px solid var(--border-subtle)",
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
    return <div style={{ width: "100%", height: H, borderRadius: 12, background: "var(--bg-input)" }} />;
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
      style={{
        borderRadius: 12,
        background: "var(--bg-input)",
        border: "1px solid var(--border-subtle)",
        display: "block",
        touchAction: "none",
      }}
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
      <line x1={sx} y1={2} x2={sx} y2={H - padBottom + 4} stroke="var(--text-primary)" strokeWidth="1.4" />
      <circle cx={sx} cy={yOf(hours[scrubIndex].tempC)} r="5.5" fill="var(--bg-surface)" stroke={tempColor(hours[scrubIndex].tempC)} strokeWidth="2.5" />
    </svg>
  );
}
