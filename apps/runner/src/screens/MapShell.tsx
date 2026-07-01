import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RunnerMap, type WeatherPoint } from "../map/RunnerMap";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { useLiveMedics } from "../hooks/useLiveMedics";
import { useTrackGeoJson } from "../hooks/useTrackGeoJson";
import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus";
import { LOW_ACCURACY_METERS } from "../hooks/useGeolocation";
import { fetchMyIncidents, fetchPois, type PoiLike } from "../api";
import { haversineMeters, cumulativeDistances, snapToRoute, pointAtKm } from "../lib/geo";
import { SafetyDock } from "../components/SafetyDock";
import { OfflineControlButton } from "../components/OfflineControlButton";
import { WeatherPanel } from "../components/WeatherPanel";
import { ProfileSheet } from "../components/ProfileSheet";
import { boundsForPathKm, type Bounds } from "../lib/offline-map";
import { fetchForecast, weatherOverlayUrl, HORIZON_HOURS, type Forecast } from "../lib/weather";
import type { ResolvedTrack } from "../hooks/useTrackGeoJson";
import type { IncidentRecordLike, PublicMedicState } from "../api/contracts-shim";

const HEADER_INSET = 70; // identity header height reserved at the top

/**
 * Measures the rendered height of a bottom-docked panel (the safety dock, the
 * weather scrubber) so other floating UI — namely the "my location" FAB — can
 * sit reliably above it instead of a hardcoded guess that drifts whenever the
 * panel's content changes height (e.g. an active alert adds a second button,
 * or a longer localized condition label wraps to two lines).
 */
function useDockedPanelHeight(active: boolean) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!active) {
      setHeight(0);
      return;
    }
    const el = wrapRef.current?.firstElementChild as HTMLElement | null | undefined;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setHeight(entries[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  return [wrapRef, height] as const;
}

interface ShellCtx {
  track: ResolvedTrack | null;
  kmAlong: number | null;
  offsetMeters: number | null;
  /** GPS-reported altitude (m), or null when the device omits it. */
  gpsAltitude: number | null;
  medics: PublicMedicState[];
  pois: PoiLike[];
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
  const { eventId, profile, fix, gpsDenied, queued } = useApp();
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
  const [profileOpen, setProfileOpen] = useState(false);

  // ── Weather overlay state ──
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [dockWrapRef, dockHeight] = useDockedPanelHeight(active === "map" && !weatherOpen);
  const [wxWrapRef, wxHeight] = useDockedPanelHeight(active === "map" && weatherOpen);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [wxIndex, setWxIndex] = useState(0);
  const [wxPlaying, setWxPlaying] = useState(false);

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

  const refreshPois = useCallback(() => {
    fetchPois(eventId)
      .then(setPois)
      .catch(() => undefined);
  }, [eventId]);

  useEffect(() => {
    // Drop the previous event's POIs immediately so the map can't render a
    // stale event's markers while the new event's POIs are loading.
    setPois([]);
    refreshPois();
  }, [eventId, refreshPois]);

  // Likely means the phone was locked/backgrounded — re-fetch in case POIs
  // changed (or the previous fetch raced a still-in-flight event switch).
  useRefetchOnFocus(refreshPois);

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

  const showAccuracyWarning = gpsDenied || (fix != null && fix.accuracy > LOW_ACCURACY_METERS);

  // ── Offline pack: cache the track corridor + a 5 km buffer. Deliberately
  //    excludes medic/POI positions so the download stays tight around where the
  //    runner actually goes (a medic parked 30 km away shouldn't balloon it). ──
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const getOfflineBounds = useCallback((): Bounds | null => {
    const points: Array<{ lat: number; lng: number }> = [];
    if (track) for (const [lng, lat] of track.coords) points.push({ lat, lng });
    // No track yet → fall back to a 5 km area around the runner.
    if (points.length === 0 && fixRef.current)
      points.push({ lat: fixRef.current.lat, lng: fixRef.current.lng });
    return boundsForPathKm(points, 5);
  }, [track]);

  // ── Weather: a few sample points down the route for spatial temperatures. ──
  // Depends on `track` only (NOT `fix`) so live GPS updates can't change its
  // identity and silently refetch + reset the scrubber back to "Now". Sample
  // start/mid/end, then drop any that sit within ~3 km of one already kept — on a
  // loop or out-and-back the start/finish/middle coincide and the temp markers
  // would otherwise stack on top of each other.
  const wxSamplePoints = useMemo(() => {
    const raw: Array<{ lat: number; lng: number }> = [];
    if (track && track.coords.length > 1) {
      const n = track.coords.length;
      for (const f of [0, 0.5, 1]) {
        const [lng, lat] = track.coords[Math.min(n - 1, Math.round(f * (n - 1)))];
        raw.push({ lat, lng });
      }
    } else if (fixRef.current) {
      raw.push({ lat: fixRef.current.lat, lng: fixRef.current.lng });
    }
    const kept: Array<{ lat: number; lng: number }> = [];
    for (const p of raw) if (!kept.some((q) => haversineMeters(q, p) < 3000)) kept.push(p);
    return kept;
  }, [track]);

  // Fetch the forecast (temps + scrub timeline) when the weather layer opens.
  // The on-map precipitation field is served as fixed Tomorrow.io raster tiles
  // (cached + rate-limited by our backend), so there's no radar index to fetch.
  useEffect(() => {
    if (!weatherOpen) return;
    let alive = true;
    setWxIndex(0);
    if (wxSamplePoints.length) void fetchForecast(wxSamplePoints).then((f) => alive && setForecast(f));
    return () => {
      alive = false;
    };
  }, [weatherOpen, wxSamplePoints]);

  // On-map weather = Open-Meteo cloud cover (under) + precipitation (over),
  // rendered server-side as PNG overlays. Two image overlays whose image is
  // swapped (updateImage) to the scrubbed hour. The PNGs carry their own alpha.
  // Independent of `forecast` (the temperature readout) so the rain map still
  // shows if that separate call is slow/limited — it only needs the hour index.
  const weatherLayers = useMemo(() => {
    if (!weatherOpen) return [];
    const cur = Math.min(HORIZON_HOURS, Math.max(0, wxIndex));
    return [
      { id: "wx-cloud", url: weatherOverlayUrl("cloud_cover", cur), opacity: 1 },
      { id: "wx-precip", url: weatherOverlayUrl("precipitation", cur), opacity: 1 },
    ];
  }, [weatherOpen, wxIndex]);

  // Warm every forecast-hour overlay (both fields) in the background on open, so
  // scrubbing swaps to an already-cached image with no wait.
  useEffect(() => {
    if (!weatherOpen) return;
    let cancelled = false;
    const urls: string[] = [];
    for (let h = 0; h <= HORIZON_HOURS; h += 1) {
      urls.push(weatherOverlayUrl("precipitation", h), weatherOverlayUrl("cloud_cover", h));
    }
    let i = 0;
    const worker = async () => {
      while (i < urls.length && !cancelled) {
        try {
          await fetch(urls[i++]);
        } catch {
          /* ignore */
        }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [weatherOpen]);

  // Auto-play the 12h scrub.
  useEffect(() => {
    if (!weatherOpen || !wxPlaying || !forecast) return;
    const id = setInterval(() => setWxIndex((i) => (i + 1) % forecast.times.length), 850);
    return () => clearInterval(id);
  }, [weatherOpen, wxPlaying, forecast]);

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
              code: h.code,
              isDay: h.isDay,
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

  // Bottom occlusion fed to the map (and the "my location" FAB) so both frame
  // above whatever's actually rendered at the bottom — measured live off the
  // dock/weather panel rather than a fixed guess, since their height varies
  // (an active alert adds a second button; longer localized text wraps).
  // 74 is the dock/weather panel's own fixed bottom offset (see SafetyDock.tsx
  // / WeatherPanel.tsx); fall back to a reasonable guess before the first
  // ResizeObserver measurement lands.
  const bottomInset =
    active === "tracks"
      ? sheetInset
      : weatherOpen
        ? (wxHeight || 226) + 74
        : active === "map"
          ? (dockHeight || 190) + 74
          : 0;

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
        // Hide the mobile medics in the weather and track-preview views (they
        // clutter the radar / the elevation framing); POIs only hide in weather.
        medics={weatherOpen || active === "tracks" ? [] : medics}
        pois={weatherOpen ? [] : pois}
        fix={fix}
        satellite={satellite}
        scrubPoint={scrubPoint}
        fitSignal={fitSignal}
        weatherLayers={weatherLayers}
        weatherMode={weatherOpen}
        weatherPoints={weatherPoints}
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
        {/* Tap the initials to edit name / bib / phone / medical, or leave the event. */}
        <button
          onClick={() => setProfileOpen(true)}
          aria-label={t("profile.title")}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "linear-gradient(135deg,var(--primary),var(--primary-dark))",
            display: "grid",
            placeItems: "center",
            fontFamily: "Sofia Sans",
            fontWeight: 800,
            fontSize: 14,
            color: "#05140E",
            flexShrink: 0,
          }}
        >
          {(profile?.runnerName ?? "R").slice(0, 2).toUpperCase()}
        </button>
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
        <ControlButton icon={<CompassIcon />} onClick={() => setCompass((n) => n + 1)} title="North up" />
      </div>

      {/* "My location" FAB — bottom-right like Google Maps, floating just above
          whatever's occupying the bottom of the screen (track sheet / weather
          scrubber / safety dock + tab bar), reusing the same inset the map
          itself is framed against. Bigger than the other controls — it's the
          one button used constantly mid-run. */}
      <button
        onClick={() => setRecenter((n) => n + 1)}
        title="Recenter"
        aria-label="Recenter"
        style={{
          position: "absolute",
          right: 12,
          bottom: `calc(${bottomInset + 20}px + env(safe-area-inset-bottom))`,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: "var(--bg-overlay)",
          border: "1px solid var(--primary)",
          color: "var(--primary)",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
          zIndex: 7,
        }}
      >
        <LocateIcon size={26} />
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
        <div ref={wxWrapRef}>
          <WeatherPanel
            forecast={forecast}
            scrubIndex={wxIndex}
            onScrub={(i) => {
              setWxPlaying(false);
              setWxIndex(i);
            }}
            playing={wxPlaying}
            onTogglePlay={() => setWxPlaying((p) => !p)}
            onClose={toggleWeather}
          />
        </div>
      )}

      {children}
      {active === "tracks" &&
        renderSheet?.({
          track,
          kmAlong: progress.kmAlong,
          offsetMeters: progress.offsetMeters,
          gpsAltitude: fix?.altitude ?? null,
          medics,
          pois,
          onScrub,
          onSheetInset: setSheetInset,
        })}

      {/* Bottom safety dock (medic radar + report / live-alert) — hidden while
          the weather scrubber is up so they don't stack. */}
      {active === "map" && !weatherOpen && (
        <div ref={dockWrapRef}>
          <SafetyDock
            nearest={nearest}
            // A report can be confirmed by the server (activeIncident) or still
            // sitting in the offline queue (no id yet, e.g. reported with no
            // signal) — either way the runner reported something and should be
            // able to get back to it instead of only seeing "report new".
            hasActiveAlert={!!activeIncident || queued > 0}
            onReport={() => navigate("/report")}
            onViewAlert={() =>
              activeIncident
                ? navigate("/sent", { state: { incidentId: activeIncident.id } })
                : navigate("/sent", { state: { queued: true } })
            }
          />
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
        <Tab
          label={t("tab.map")}
          glyph="🗺️"
          active={active === "map" && !weatherOpen}
          onClick={() => (active === "map" ? setWeatherOpen(false) : navigate("/map"))}
        />
        <Tab label={t("tab.tracks")} glyph="📈" active={active === "tracks"} onClick={() => navigate("/tracks")} />
        <Tab label={t("tab.weather")} glyph="🌦️" active={weatherOpen} onClick={goWeather} />
      </div>

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}

function cssVar(v: string): string {
  const name = v.replace(/var\((--[^)]+)\)/, "$1");
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#2BE3A0";
}

function ControlButton({
  glyph,
  icon,
  active,
  onClick,
  title,
}: {
  glyph?: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
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
        display: "grid",
        placeItems: "center",
        boxShadow: "0 4px 12px rgba(0,0,0,0.30)",
      }}
    >
      {icon ?? glyph}
    </button>
  );
}

/** "Recenter on me" — a crisp crosshair/locator (GPS-style reticle + centre dot). */
function LocateIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

/** "North up" — a compass needle (north half filled) inside a ring. */
function CompassIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 4.5 14.6 12H9.4z" fill="#E63946" stroke="#E63946" />
      <path d="M12 19.5 9.4 12h5.2z" fill="currentColor" opacity="0.55" />
    </svg>
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
