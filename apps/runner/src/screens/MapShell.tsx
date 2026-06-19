import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RunnerMap } from "../map/RunnerMap";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { useLiveMedics } from "../hooks/useLiveMedics";
import { useTrackGeoJson } from "../hooks/useTrackGeoJson";
import { LOW_ACCURACY_METERS } from "../hooks/useGeolocation";
import { fetchMyIncidents, fetchPois, type PoiLike } from "../api";
import { haversineMeters, cumulativeDistances, snapToRoute, pointAtKm, bearingDeg } from "../lib/geo";
import { SafetyDock } from "../components/SafetyDock";
import { loadMedical } from "../lib/storage";
import { hasMedicalInfo } from "../lib/types";
import type { ResolvedTrack } from "../hooks/useTrackGeoJson";
import type { IncidentRecordLike, PublicMedicState } from "../api/contracts-shim";

interface ShellCtx {
  track: ResolvedTrack | null;
  kmAlong: number | null;
  offsetMeters: number | null;
  medics: PublicMedicState[];
  onScrub: (km: number | null) => void;
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
  const track = useTrackGeoJson(eventId, profile?.selectedTrackId ?? null);
  const [pois, setPois] = useState<PoiLike[]>([]);
  const [recenter, setRecenter] = useState(0);
  const [compass, setCompass] = useState(0);
  const [satellite, setSatellite] = useState(false);
  const [activeIncident, setActiveIncident] = useState<IncidentRecordLike | null>(null);
  const [scrubPoint, setScrubPoint] = useState<[number, number] | null>(null);
  const [fitSignal, setFitSignal] = useState<number | undefined>(undefined);

  // When Track Studio opens, frame the whole course.
  useEffect(() => {
    if (active === "tracks" && track) setFitSignal((s) => (s ?? 0) + 1);
  }, [active, track]);

  useEffect(() => {
    fetchPois(eventId)
      .then(setPois)
      .catch(() => undefined);
  }, [eventId]);

  // Surface the runner's active (unresolved) incident so they can return to it.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchMyIncidents()
        .then((list) => {
          if (!alive) return;
          const open = list.find((i) => i.status !== "resolved" && i.status !== "closed");
          setActiveIncident(open ?? null);
        })
        .catch(() => undefined);
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [eventId]);

  const routeColor = profile?.selectedTrackColor || track?.meta.color || "var(--primary)";

  const nearest = useMemo(() => {
    if (!fix || medics.length === 0) return null;
    let best: { distanceMeters: number; bearingDeg: number } | null = null;
    for (const m of medics) {
      const d = haversineMeters(fix, { lng: m.lng, lat: m.lat });
      if (!best || d < best.distanceMeters) {
        best = { distanceMeters: d, bearingDeg: bearingDeg(fix, { lng: m.lng, lat: m.lat }) };
      }
    }
    return best;
  }, [fix, medics]);

  const activeDock = useMemo(() => {
    if (!activeIncident) return null;
    const navigating = Boolean(activeIncident.assignedMedicNavigating);
    const assigned = (activeIncident.responders?.length ?? 0) > 0;
    let etaMin: number | null = null;
    if (navigating && activeIncident.assignedMedicEtaIso) {
      const m = Math.round((new Date(activeIncident.assignedMedicEtaIso).getTime() - Date.now()) / 60000);
      etaMin = Number.isFinite(m) ? Math.max(1, m) : null;
    }
    return { navigating, assigned, etaMin };
  }, [activeIncident]);

  const progress = useMemo(() => {
    if (!fix || !track) return { kmAlong: null as number | null, offsetMeters: null as number | null };
    const cum = cumulativeDistances(track.coords);
    const snap = snapToRoute(fix, track.coords, cum);
    return { kmAlong: snap.kmAlong, offsetMeters: snap.offsetMeters };
  }, [fix, track]);

  const hasMedical = hasMedicalInfo(loadMedical());
  const showAccuracyWarning = gpsDenied || (fix != null && fix.accuracy > LOW_ACCURACY_METERS);

  // Scrubbing the elevation chart → show that point on the route.
  const onScrub = (km: number | null) => {
    if (km == null || !track) {
      setScrubPoint(null);
      return;
    }
    const cum = cumulativeDistances(track.coords);
    setScrubPoint(pointAtKm(track.coords, cum, km));
  };

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <RunnerMap
        coords={track?.coords ?? null}
        routeColor={routeColor.startsWith("var") ? cssVar(routeColor) : routeColor}
        medics={medics}
        pois={pois}
        fix={fix}
        satellite={satellite}
        scrubPoint={scrubPoint}
        fitSignal={fitSignal}
        youLabel={
          progress.kmAlong != null
            ? `${t("map.you")} · ${t("common.km").toUpperCase()} ${progress.kmAlong.toFixed(1)}`
            : t("map.you")
        }
        recenterSignal={recenter}
        compassSignal={compass}
      />

      {/* Identity header — raised, name + bib only (no distance chooser) */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 12,
          right: 64,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
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
          <div className="archivo" style={{ fontWeight: 800, fontSize: 15, color: "var(--text-primary)" }}>
            {profile?.runnerName || "Runner"}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
            {profile?.bibNumber ? `BIB ${profile.bibNumber}` : profile?.selectedTrackLabel}
          </div>
        </div>
      </div>

      {/* Floating controls */}
      <div style={{ position: "absolute", top: 14, right: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <ControlButton glyph="🛰️" active={satellite} onClick={() => setSatellite((s) => !s)} title="Satellite" />
        <ControlButton glyph="◎" active onClick={() => setRecenter((n) => n + 1)} title="Recenter" />
        <ControlButton glyph="🧭" onClick={() => setCompass((n) => n + 1)} title="North up" />
      </div>

      {/* Medical info button — green ring once filled, amber prompt when empty */}
      <button
        onClick={() => navigate("/medical")}
        style={{
          position: "absolute",
          top: 158,
          right: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderRadius: 13,
          background: "var(--bg-overlay)",
          border: `1px solid ${hasMedical ? "var(--primary)" : "var(--caution)"}`,
          color: hasMedical ? "var(--primary)" : "var(--caution)",
          fontWeight: 800,
          fontSize: 11,
          boxShadow: "0 4px 12px rgba(0,0,0,0.30)",
        }}
      >
        🩺 {hasMedical ? "✓" : "+"}
      </button>

      {showAccuracyWarning && (
        <div
          style={{
            position: "absolute",
            top: 72,
            left: 12,
            right: 64, // leave the right column free for the control buttons
            padding: "8px 12px",
            borderRadius: 12,
            background: "var(--caution)",
            color: "#3A2600",
            fontSize: 12,
            fontWeight: 800,
            textAlign: "left",
            boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
          }}
        >
          {t("map.lowGps")}
        </div>
      )}

      {children}
      {active === "tracks" &&
        renderSheet?.({ track, kmAlong: progress.kmAlong, offsetMeters: progress.offsetMeters, medics, onScrub })}

      {/* Bottom safety dock (medic radar + report / live-alert) */}
      {active === "map" && (
        <SafetyDock
          nearest={nearest}
          active={activeDock}
          onReport={() => navigate("/report")}
          onViewAlert={() => activeIncident && navigate("/sent", { state: { incidentId: activeIncident.id } })}
        />
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

function ControlButton({ glyph, active, onClick, title }: { glyph: string; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
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
