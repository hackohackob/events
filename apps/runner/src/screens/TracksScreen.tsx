import { useState } from "react";
import { MapShell } from "./MapShell";
import { useT } from "../i18n";
import { ElevationChart } from "../components/ElevationChart";
import { TRACK_OPTIONS } from "../lib/types";
import { useApp } from "../state/AppContext";
import type { ResolvedTrack } from "../hooks/useTrackGeoJson";

export function TracksScreen() {
  return (
    <MapShell active="tracks" renderSheet={(ctx) => <TrackStudioSheet {...ctx} />} />
  );
}

function TrackStudioSheet({
  track,
  kmAlong,
  offsetMeters,
}: {
  track: ResolvedTrack | null;
  kmAlong: number | null;
  offsetMeters: number | null;
}) {
  const { t } = useT();
  const { profile } = useApp();
  const [expanded, setExpanded] = useState(false);

  const option = TRACK_OPTIONS.find((o) => o.key === profile?.selectedTrack) ?? TRACK_OPTIONS[1];
  const totalKm = option.distanceKm;
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
        height: expanded ? "82%" : "48%",
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
        <div style={{ width: 24, height: 5, borderRadius: 3, background: option.color }} />
        <span className="archivo" style={{ fontWeight: 800, fontSize: 16 }}>{option.key}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t(option.subKey)}</span>
      </div>

      <div style={{ display: "flex", gap: 24, margin: "16px 0 12px" }}>
        <Stat label={t("tracks.distanceFromStart")} value={`${completedKm.toFixed(1)} ${t("common.km")}`} />
        <Stat label={t("tracks.elevation")} value={`${Math.round(track?.meta.maxElevationMeters ?? 0)} ${t("common.m")}`} />
      </div>

      <ElevationChart totalKm={totalKm} ascent={ascent} descent={descent} runnerKm={kmAlong} height={expanded ? 104 : 90} />

      {expanded && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9, marginTop: 14 }}>
          <Tile label={t("tracks.distanceLeft")} value={`${distanceLeft.toFixed(1)} ${t("common.km")}`} />
          <Tile label={t("tracks.climbLeft")} value={`↑ ${Math.round(ascent)} ${t("common.m")}`} color="var(--urgent)" />
          <Tile label={t("tracks.descentLeft")} value={`↓ ${Math.round(descent)} ${t("common.m")}`} color="var(--live-gps)" />
          <Tile label={t("tracks.completed")} value={`${completedPct}%`} color="var(--primary)" />
          <Tile
            label={t("tracks.onTrack")}
            value={`${offsetMeters != null ? Math.round(offsetMeters) : 0} ${t("common.m")}`}
            color="var(--primary)"
          />
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
