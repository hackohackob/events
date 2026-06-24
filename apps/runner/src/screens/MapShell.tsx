import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RunnerMap, type WeatherPoint } from "../map/RunnerMap";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { useLiveMedics } from "../hooks/useLiveMedics";
import { useTrackGeoJson } from "../hooks/useTrackGeoJson";
import { LOW_ACCURACY_METERS } from "../hooks/useGeolocation";
import { fetchMyIncidents, fetchPois, type PoiLike } from "../api";
import { haversineMeters, cumulativeDistances, snapToRoute, pointAtKm } from "../lib/geo";
import { SafetyDock } from "../components/SafetyDock";
import { OfflineControlButton } from "../components/OfflineControlButton";
import { WeatherPanel } from "../components/WeatherPanel";
import { boundsForPoints, type Bounds } from "../lib/offline-map";
import {
  fetchForecast,
  fetchRadar,
  radarFrameAt,
  type Forecast,
  type RadarData,
} from "../lib/weather";
import { loadMedical } from "../lib/storage";
import { hasMedicalInfo } from "../lib/types";
import type { ResolvedTrack } from "../hooks/useTrackGeoJson";
import type { IncidentRecordLike, PublicMedicState } from "../api/contracts-shim";

const HEADER_INSET = 70; // identity header height reserved at the top

interface ShellCtx {
  track: ResolvedTrack | null;
  kmAlong: number | null;
  offsetMeters: number | null;
  medics: PublicMedicState[];
  onScrub: (km: number | null) => void;
  onSheetInset: (px: number) => void;
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
  const [sheetInset, setSheetInset] = useState(0);

  // ── Weather overlay state ──
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [wxIndex, setWxIndex] = useState(0);
  const [wxPlaying, setWxPlaying] = useState(false);
  const [showRain, setShowRain] = useState(true);
  const [showClouds, setShowClouds] = useState(false);

  // Open the weather layer when arriving from the Weather tab on another screen.
  useEffect(() => {
    if (active === "map" && sessionStorage.getItem("pe_open_weather")) {
      sessionStorage.removeItem("pe_open_weather");
      setWeatherOpen(true);
    }
  }, [active]);

  // When Track Studio opens, frame the whole course into the area left visible
  // above the sheet. Wait until the sheet has reported its height (sheetInset>0)
  // so the fit pads for it; fit once per track (not on every drag).
  const fittedTrackRef = useRef<string | null>(null);
  useEffect(() => {
    if (active !== "tracks") {
      fittedTrackRef.current = null;
      return;
    }
    const trackKey = profile?.selectedTrackId ?? null;
    if (track && trackKey && sheetInset > 0 && fittedTrackRef.current !== trackKey) {
      fittedTrackRef.current = trackKey;
      setFitSignal((s) => (s ?? 0) + 1);
    }
  }, [active, track, sheetInset, profile?.selectedTrackId]);

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
    let best: { distanceMeters: number } | null = null;
    for (const m of medics) {
      const d = haversineMeters(fix, { lng: m.lng, lat: m.lat });
      if (!best || d < best.distanceMeters) best = { distanceMeters: d };
    }
    return best;
  }, [fix, medics]);

  const progress = useMemo(() => {
    if (!fix || !track) return { kmAlong: null as number | null, offsetMeters: null as number | null };
    const cum = cumulativeDistances(track.coords);
    const snap = snapToRoute(fix, track.coords, cum);
    return { kmAlong: snap.kmAlong, offsetMeters: snap.offsetMeters };
  }, [fix, track]);

  const hasMedical = hasMedicalInfo(loadMedical());
  const showAccuracyWarning = gpsDenied || (fix != null && fix.accuracy > LOW_ACCURACY_METERS);

  // ── Offline pack: cache the whole event area (track + medics + POIs + you). ──
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const getOfflineBounds = useCallback((): Bounds | null => {
    const points: Array<{ lat: number; lng: number }> = [];
    if (track) for (const [lng, lat] of track.coords) points.push({ lat, lng });
    for (const m of medics) points.push({ lat: m.lat, lng: m.lng });
    for (const p of pois) points.push({ lat: p.lat, lng: p.lng });
    if (fixRef.current) points.push({ lat: fixRef.current.lat, lng: fixRef.current.lng });
    return boundsForPoints(points);
  }, [track, medics, pois]);

  // ── Weather: a few sample points down the route for spatial temperatures. ──
  // Depends on `track` only (NOT `fix`) so live GPS updates can't change its
  // identity and silently refetch + reset the scrubber back to "Now".
  const wxSamplePoints = useMemo(() => {
    if (track && track.coords.length > 1) {
      const n = track.coords.length;
      return [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const [lng, lat] = track.coords[Math.min(n - 1, Math.round(f * (n - 1)))];
        return { lat, lng };
      });
    }
    const f = fixRef.current;
    return f ? [{ lat: f.lat, lng: f.lng }] : [];
  }, [track]);

  // Fetch radar + forecast when the weather layer opens (refresh on track change).
  useEffect(() => {
    if (!weatherOpen) return;
    let alive = true;
    setWxIndex(0);
    void fetchRadar().then((r) => alive && setRadar(r));
    if (wxSamplePoints.length) void fetchForecast(wxSamplePoints).then((f) => alive && setForecast(f));
    return () => {
      alive = false;
    };
  }, [weatherOpen, wxSamplePoints]);

  // Auto-play the 12h scrub.
  useEffect(() => {
    if (!weatherOpen || !wxPlaying || !forecast) return;
    const id = setInterval(() => setWxIndex((i) => (i + 1) % forecast.times.length), 850);
    return () => clearInterval(id);
  }, [weatherOpen, wxPlaying, forecast]);

  const scrubTime = forecast?.times[wxIndex];
  // Real radar only counts toward the live moment AND when the Rain layer is on.
  const radarFrame = weatherOpen && showRain && scrubTime != null ? radarFrameAt(radar, scrubTime) : null;
  const weatherPoints = useMemo<WeatherPoint[] | null>(() => {
    if (!weatherOpen || !forecast) return null;
    return forecast.points
      .map((p, i): WeatherPoint | null => {
        const h = p.hours[wxIndex];
        return h
          ? {
              lng: p.lng,
              lat: p.lat,
              tempC: h.tempC,
              precipMm: h.precipMm,
              precipProb: h.precipProb,
              cloudPct: h.cloudPct,
              primary: i === 0,
            }
          : null;
      })
      .filter((x): x is WeatherPoint => x != null);
  }, [weatherOpen, forecast, wxIndex]);

  const toggleWeather = () => {
    setWeatherOpen((open) => {
      if (open) setWxPlaying(false);
      return !open;
    });
  };

  // Weather tab tapped from another screen → open weather once on the map.
  const goWeather = () => {
    if (active === "map") toggleWeather();
    else {
      sessionStorage.setItem("pe_open_weather", "1");
      navigate("/map");
    }
  };

  // Bottom occlusion fed to the map so centring/fit frame the visible area.
  const bottomInset =
    active === "tracks" ? sheetInset : weatherOpen ? 250 : active === "map" ? 190 : 0;

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
        // Declutter the weather view — hide medics & POIs so the radar/temps read.
        medics={weatherOpen ? [] : medics}
        pois={weatherOpen ? [] : pois}
        fix={fix}
        satellite={satellite}
        scrubPoint={scrubPoint}
        fitSignal={fitSignal}
        radarTemplate={radarFrame?.template ?? null}
        weatherPoints={weatherPoints}
        showRain={weatherOpen && showRain}
        showClouds={weatherOpen && showClouds}
        bottomInset={bottomInset}
        topInset={HEADER_INSET}
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
        <OfflineControlButton getBounds={getOfflineBounds} />
        <ControlButton glyph="◎" active onClick={() => setRecenter((n) => n + 1)} title="Recenter" />
        <ControlButton glyph="🧭" onClick={() => setCompass((n) => n + 1)} title="North up" />
      </div>

      {/* Medical info button — green ring once filled, amber prompt when empty */}
      <button
        onClick={() => navigate("/medical")}
        style={{
          position: "absolute",
          top: 210,
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

      {/* Weather radar + 12h scrubber */}
      {active === "map" && weatherOpen && (
        <WeatherPanel
          forecast={forecast}
          scrubIndex={wxIndex}
          onScrub={(i) => {
            setWxPlaying(false);
            setWxIndex(i);
          }}
          playing={wxPlaying}
          onTogglePlay={() => setWxPlaying((p) => !p)}
          radarLive={radarFrame != null}
          showRain={showRain}
          showClouds={showClouds}
          onToggleRain={() => setShowRain((v) => !v)}
          onToggleClouds={() => setShowClouds((v) => !v)}
          onClose={toggleWeather}
        />
      )}

      {children}
      {active === "tracks" &&
        renderSheet?.({
          track,
          kmAlong: progress.kmAlong,
          offsetMeters: progress.offsetMeters,
          medics,
          onScrub,
          onSheetInset: setSheetInset,
        })}

      {/* Bottom safety dock (medic radar + report / live-alert) — hidden while
          the weather scrubber is up so they don't stack. */}
      {active === "map" && !weatherOpen && (
        <SafetyDock
          nearest={nearest}
          hasActiveAlert={!!activeIncident}
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
        <Tab
          label={t("tab.map")}
          glyph="🗺️"
          active={active === "map" && !weatherOpen}
          onClick={() => (active === "map" ? setWeatherOpen(false) : navigate("/map"))}
        />
        <Tab label={t("tab.tracks")} glyph="📈" active={active === "tracks"} onClick={() => navigate("/tracks")} />
        <Tab label={t("tab.weather")} glyph="🌦️" active={weatherOpen} onClick={goWeather} />
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
