import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RunnerMap } from "../map/RunnerMap";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { useLiveMedics } from "../hooks/useLiveMedics";
import { useTrackGeoJson } from "../hooks/useTrackGeoJson";
import { fetchPois, type PoiLike } from "../api";
import { haversineMeters, formatDistance, cumulativeDistances, snapToRoute } from "../lib/geo";
import { TRACK_OPTIONS } from "../lib/types";
import type { ResolvedTrack } from "../hooks/useTrackGeoJson";

interface ShellCtx {
  track: ResolvedTrack | null;
  kmAlong: number | null;
  offsetMeters: number | null;
}

export function MapShell({
  active,
  children,
  renderSheet,
}: {
  active: "map" | "tracks";
  children?: React.ReactNode;
  renderSheet?: (ctx: ShellCtx) => React.ReactNode;
}) {
  const { eventId, profile, fix, gpsDenied } = useApp();
  const { t } = useT();
  const navigate = useNavigate();
  const medics = useLiveMedics(eventId);
  const track = useTrackGeoJson(eventId, profile?.selectedTrack ?? null);
  const [pois, setPois] = useState<PoiLike[]>([]);
  const [recenter, setRecenter] = useState(0);

  useEffect(() => {
    fetchPois(eventId)
      .then(setPois)
      .catch(() => undefined);
  }, [eventId]);

  const option = TRACK_OPTIONS.find((o) => o.key === profile?.selectedTrack) ?? TRACK_OPTIONS[1];
  const routeColor = track?.meta.color || option.color;

  const nearest = useMemo(() => {
    if (!fix || medics.length === 0) return null;
    let best = Infinity;
    for (const m of medics) {
      const d = haversineMeters(fix, { lng: m.lng, lat: m.lat });
      if (d < best) best = d;
    }
    return best;
  }, [fix, medics]);

  const progress = useMemo(() => {
    if (!fix || !track) return { kmAlong: null as number | null, offsetMeters: null as number | null };
    const cum = cumulativeDistances(track.coords);
    const snap = snapToRoute(fix, track.coords, cum);
    return { kmAlong: snap.kmAlong, offsetMeters: snap.offsetMeters };
  }, [fix, track]);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <RunnerMap
        coords={track?.coords ?? null}
        routeColor={routeColor.startsWith("var") ? cssVar(routeColor) : routeColor}
        medics={medics}
        pois={pois}
        fix={fix}
        youLabel={progress.kmAlong != null ? `${t("map.you")} · ${t("common.km").toUpperCase()} ${progress.kmAlong.toFixed(1)}` : t("map.you")}
        recenterSignal={recenter}
      />

      {/* Identity header */}
      <div
        style={{
          position: "absolute",
          top: 42,
          left: 12,
          right: 64,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 16,
          background: "var(--bg-overlay)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "linear-gradient(135deg,var(--primary),var(--primary-dark))",
            display: "grid",
            placeItems: "center",
            fontFamily: "Archivo",
            fontWeight: 800,
            fontSize: 14,
            color: "#05140E",
          }}
        >
          {(profile?.runnerName ?? "R").slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="archivo" style={{ fontWeight: 800, fontSize: 14, color: "var(--text-primary)" }}>
            {profile?.runnerName || "Runner"}
          </div>
          {profile?.bibNumber && (
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-muted)" }}>
              BIB {profile.bibNumber}
            </div>
          )}
        </div>
        <button
          onClick={() => navigate("/onboarding")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "7px 9px",
            borderRadius: 11,
            border: "1px solid var(--primary)",
            background: "rgba(43,227,160,0.12)",
            color: "var(--primary)",
            fontWeight: 800,
            fontSize: 12,
          }}
        >
          {option.key} ▾
        </button>
      </div>

      {/* Floating controls */}
      <div style={{ position: "absolute", top: 42, right: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <ControlButton glyph="▦" />
        <ControlButton glyph="◎" active onClick={() => setRecenter((n) => n + 1)} />
        <ControlButton glyph="🧭" />
      </div>

      {gpsDenied && (
        <div
          style={{
            position: "absolute",
            top: 110,
            left: 12,
            right: 12,
            padding: "8px 12px",
            borderRadius: 12,
            background: "rgba(255,176,32,0.18)",
            color: "var(--caution)",
            fontSize: 12,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          {t("map.lowGps")}
        </div>
      )}

      {children}
      {active === "tracks" && renderSheet?.({ track, kmAlong: progress.kmAlong, offsetMeters: progress.offsetMeters })}

      {/* Nearest medic pill + FAB (only on map tab) */}
      {active === "map" && (
        <div style={{ position: "absolute", left: 16, right: 16, bottom: 118, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div
            style={{
              padding: "7px 14px",
              borderRadius: 999,
              background: "var(--bg-overlay)",
              border: "1px solid rgba(43,227,160,0.40)",
              color: "#A9F2D6",
              fontWeight: 700,
              fontSize: 11.5,
            }}
          >
            🛡️ {nearest != null ? t("map.nearestMedic", { dist: formatDistance(nearest) }) : t("map.noMedic")}
          </div>
          <button className="btn-critical" style={{ minHeight: 58, animation: "fabPulse 2.4s infinite" }} onClick={() => navigate("/report")}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                background: "rgba(255,255,255,0.22)",
                display: "grid",
                placeItems: "center",
              }}
            >
              ✚
            </span>
            {t("map.report")}
          </button>
        </div>
      )}

      {/* Bottom tab bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 64,
          paddingBottom: "env(safe-area-inset-bottom)",
          background: "var(--bg-base)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
        }}
      >
        <Tab label={t("tab.map")} glyph="🗺️" active={active === "map"} onClick={() => navigate("/map")} />
        <Tab label={t("tab.tracks")} glyph="📈" active={active === "tracks"} onClick={() => navigate("/tracks")} />
      </div>
    </div>
  );
}

function cssVar(v: string): string {
  const name = v.replace(/var\((--[^)]+)\)/, "$1");
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#2BE3A0";
}

function ControlButton({ glyph, active, onClick }: { glyph: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: 13,
        background: "var(--bg-overlay)",
        border: `1px solid ${active ? "var(--primary)" : "rgba(255,255,255,0.10)"}`,
        color: active ? "var(--primary)" : "var(--text-secondary)",
        fontSize: 18,
        boxShadow: "0 4px 12px rgba(0,0,0,0.30)",
      }}
    >
      {glyph}
    </button>
  );
}

function Tab({ label, glyph, active, onClick }: { label: string; glyph: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        color: active ? "var(--primary)" : "var(--text-label)",
        fontWeight: active ? 800 : 700,
        fontSize: 11,
      }}
    >
      <span style={{ fontSize: 18 }}>{glyph}</span>
      {label}
    </button>
  );
}
