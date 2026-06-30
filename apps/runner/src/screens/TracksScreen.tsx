import { useEffect, useMemo, useRef, useState } from "react";
import { MapShell } from "./MapShell";
import { useT } from "../i18n";
import { ElevationChart, type ElevSample } from "../components/ElevationChart";
import { useApp } from "../state/AppContext";
import { cumulativeDistances, snapToRoute, elevationStats } from "../lib/geo";
import type { ResolvedTrack } from "../hooks/useTrackGeoJson";
import type { PublicMedicState } from "../api/contracts-shim";

const TAB_BAR = 64;
/** Resting sheet heights as a fraction of the viewport. PEEK is deliberately
 *  smaller than half so the track stays visible above it. */
const PEEK = 0.4;
const FULL = 0.86;

export function TracksScreen() {
  return <MapShell active="tracks" renderSheet={(ctx) => <TrackStudioSheet {...ctx} />} />;
}

function TrackStudioSheet({
  track,
  kmAlong,
  offsetMeters,
  gpsAltitude,
  medics,
  onScrub,
  onSheetInset,
}: {
  track: ResolvedTrack | null;
  kmAlong: number | null;
  offsetMeters: number | null;
  gpsAltitude: number | null;
  medics: PublicMedicState[];
  onScrub: (km: number | null) => void;
  onSheetInset: (px: number) => void;
}) {
  const { t } = useT();
  const { profile } = useApp();

  // Draggable sheet: `frac` is the live height fraction; PEEK/FULL are snaps.
  const [frac, setFrac] = useState(PEEK);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startFrac: number; moved: number; frac: number } | null>(null);
  const expanded = frac > (PEEK + FULL) / 2;

  // Report the occluded height so the map frames the track above the sheet.
  const reportInset = (f: number) => onSheetInset(f * window.innerHeight + TAB_BAR);
  useEffect(() => {
    reportInset(frac);
    // Only on mount / when the snapped height settles (see drag handlers).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapTo = (f: number) => {
    setFrac(f);
    reportInset(f);
  };

  const onHandleDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startFrac: frac, moved: 0, frac };
    setDragging(true);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = d.startY - e.clientY; // drag up = grow
    d.moved = Math.max(d.moved, Math.abs(dy));
    d.frac = Math.min(0.92, Math.max(0.26, d.startFrac + dy / window.innerHeight));
    setFrac(d.frac);
  };
  const onHandleUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d) return;
    // Tap → toggle; drag → snap to the nearer rest point. Use the ref's live
    // fraction so the decision is right even on a fast flick (state may lag).
    if (d.moved < 6) snapTo(expanded ? PEEK : FULL);
    else snapTo(d.frac > (PEEK + FULL) / 2 ? FULL : PEEK);
  };

  const label = profile?.selectedTrackLabel ?? "—";
  const color = profile?.selectedTrackColor ?? "var(--primary)";

  const cum = useMemo(() => (track ? cumulativeDistances(track.coords) : []), [track]);
  const totalKm = cum.length ? cum[cum.length - 1] / 1000 : 0;

  // Real elevation samples (downsampled) from the per-point elevations.
  const samples = useMemo<ElevSample[]>(() => {
    if (!track) return [];
    const n = track.coords.length;
    const step = Math.max(1, Math.floor(n / 240));
    const out: ElevSample[] = [];
    for (let i = 0; i < n; i += step) {
      const ele = track.elevations[i];
      if (ele == null) continue;
      out.push({ km: cum[i] / 1000, ele });
    }
    return out;
  }, [track, cum]);

  // Medics that are on the track (within 200 m), mapped to km-along.
  const medicsKm = useMemo(() => {
    if (!track) return [];
    return medics
      .map((m) => {
        const snap = snapToRoute({ lng: m.lng, lat: m.lat }, track.coords, cum);
        return snap.offsetMeters <= 200 ? snap.kmAlong : null;
      })
      .filter((x): x is number => x != null);
  }, [medics, track, cum]);

  // Elevation computed from the raw GPX heights (the precomputed meta can be
  // wrong/zero). Current height = GPS altitude if the device gives it, else the
  // track's elevation at the runner's snapped position.
  const elev = useMemo(
    () => elevationStats(track?.elevations ?? [], cum, kmAlong),
    [track, cum, kmAlong],
  );
  const currentEle = gpsAltitude ?? elev.currentEle;
  const completedKm = kmAlong ?? 0;
  const distanceLeft = Math.max(0, totalKm - completedKm);
  const completedPct = totalKm > 0 ? Math.round((completedKm / totalKm) * 100) : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: TAB_BAR,
        height: `${(frac * 100).toFixed(2)}%`,
        background: "var(--bg-surface)",
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        boxShadow: "0 -30px 60px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        transition: dragging ? "none" : "height 0.28s cubic-bezier(0.22,1,0.36,1)",
        zIndex: 5,
      }}
    >
      {/* Drag zone — handle + title row. Drag to resize, tap to toggle. */}
      <div
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        style={{ padding: "12px 16px 8px", touchAction: "none", cursor: "grab", flexShrink: 0 }}
      >
        <div
          style={{
            width: 42,
            height: 5,
            borderRadius: 3,
            background: dragging ? "var(--primary)" : "var(--border-strong)",
            margin: "0 auto 12px",
            transition: "background 0.15s",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="archivo" style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.10em" }}>
            {t("tracks.studio")}
          </span>
          <span style={{ color: "var(--primary)", fontWeight: 700, fontSize: 11.5 }}>
            {expanded ? "▾" : "▴"} {t("tracks.pullUp")}
          </span>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 18px" }}>

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", marginTop: 12 }}>
        <div style={{ width: 24, height: 5, borderRadius: 3, background: color }} />
        <span className="archivo" style={{ fontWeight: 800, fontSize: 16 }}>{label}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          {totalKm.toFixed(1)} {t("common.km")}
        </span>
      </div>

      <div style={{ display: "flex", gap: 24, margin: "16px 0 12px" }}>
        <Stat label={t("tracks.distanceFromStart")} value={`${completedKm.toFixed(1)} ${t("common.km")}`} />
        <Stat
          label={t("tracks.elevation")}
          value={currentEle != null ? `${Math.round(currentEle)} ${t("common.m")}` : "—"}
        />
      </div>

      {/* Full-bleed elevation profile (cancels the sheet's side padding) */}
      <div style={{ margin: "0 -16px" }}>
        <div style={{ padding: "0 16px" }}>
          <ElevationChart
            samples={samples}
            totalKm={totalKm}
            runnerKm={kmAlong}
            medicsKm={medicsKm}
            height={expanded ? 150 : 120}
            onScrub={onScrub}
          />
        </div>
      </div>

      {expanded && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, marginTop: 14 }}>
          <Tile label={t("tracks.distanceLeft")} value={`${distanceLeft.toFixed(1)} ${t("common.km")}`} />
          <Tile label={t("tracks.climbLeft")} value={`↑ ${Math.round(elev.remainingAscent)} ${t("common.m")}`} color="var(--urgent)" />
          <Tile label={t("tracks.descentLeft")} value={`↓ ${Math.round(elev.remainingDescent)} ${t("common.m")}`} color="var(--live-gps)" />
          <Tile label={t("tracks.completed")} value={`${completedPct}%`} color="var(--primary)" />
          <Tile label={t("tracks.offRoute")} value={`${offsetMeters != null ? Math.round(offsetMeters) : 0} ${t("common.m")}`} color="var(--caution)" />
          <Tile label={t("tracks.totalClimb")} value={`${Math.round(elev.totalAscent)} ${t("common.m")}`} />
        </div>
      )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#3DBE8E" }}>{label}</div>
      <div className="archivo" style={{ fontWeight: 800, fontSize: 20 }}>{value}</div>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 13, padding: "10px 11px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-label)" }}>{label}</div>
      <div className="archivo" style={{ fontWeight: 800, fontSize: 17, color: color ?? "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
