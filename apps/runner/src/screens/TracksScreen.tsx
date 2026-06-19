import { useMemo, useState } from "react";
import { MapShell } from "./MapShell";
import { useT } from "../i18n";
import { ElevationChart, type ElevSample } from "../components/ElevationChart";
import { useApp } from "../state/AppContext";
import { cumulativeDistances, snapToRoute } from "../lib/geo";
import type { ResolvedTrack } from "../hooks/useTrackGeoJson";
import type { PublicMedicState } from "../api/contracts-shim";

export function TracksScreen() {
  return <MapShell active="tracks" renderSheet={(ctx) => <TrackStudioSheet {...ctx} />} />;
}

function TrackStudioSheet({
  track,
  kmAlong,
  offsetMeters,
  medics,
  onScrub,
}: {
  track: ResolvedTrack | null;
  kmAlong: number | null;
  offsetMeters: number | null;
  medics: PublicMedicState[];
  onScrub: (km: number | null) => void;
}) {
  const { t } = useT();
  const { profile } = useApp();
  const [expanded, setExpanded] = useState(false);

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

  const ascent = track?.meta.totalAscentMeters ?? 0;
  const descent = track?.meta.totalDescentMeters ?? 0;
  const completedKm = kmAlong ?? 0;
  const distanceLeft = Math.max(0, totalKm - completedKm);
  const completedPct = totalKm > 0 ? Math.round((completedKm / totalKm) * 100) : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 64,
        height: expanded ? "82%" : "50%",
        background: "var(--bg-surface)",
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        boxShadow: "0 -30px 60px rgba(0,0,0,0.5)",
        padding: "12px 16px 18px",
        transition: "height 0.28s ease",
        overflowY: "auto",
        zIndex: 5,
      }}
    >
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{ width: 42, height: 5, borderRadius: 3, background: "var(--border-strong)", margin: "0 auto 14px" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="archivo" style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.10em" }}>
          {t("tracks.studio")}
        </span>
        <button onClick={() => setExpanded((e) => !e)} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 11.5 }}>
          {t("tracks.pullUp")}
        </button>
      </div>

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", marginTop: 12 }}>
        <div style={{ width: 24, height: 5, borderRadius: 3, background: color }} />
        <span className="archivo" style={{ fontWeight: 800, fontSize: 16 }}>{label}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          {totalKm.toFixed(1)} {t("common.km")}
        </span>
      </div>

      <div style={{ display: "flex", gap: 24, margin: "16px 0 12px" }}>
        <Stat label={t("tracks.distanceFromStart")} value={`${completedKm.toFixed(1)} ${t("common.km")}`} />
        <Stat label={t("tracks.elevation")} value={`${Math.round(track?.meta.maxElevationMeters ?? 0)} ${t("common.m")}`} />
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
          <Tile label={t("tracks.climbLeft")} value={`↑ ${Math.round(ascent)} ${t("common.m")}`} color="var(--urgent)" />
          <Tile label={t("tracks.descentLeft")} value={`↓ ${Math.round(descent)} ${t("common.m")}`} color="var(--live-gps)" />
          <Tile label={t("tracks.completed")} value={`${completedPct}%`} color="var(--primary)" />
          <Tile label={t("tracks.onTrack")} value={`${offsetMeters != null ? Math.round(offsetMeters) : 0} ${t("common.m")}`} color="var(--primary)" />
          <Tile label={t("tracks.totalClimb")} value={`${Math.round(ascent)} ${t("common.m")}`} />
        </div>
      )}
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
