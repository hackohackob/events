import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n";
import {
  QUALITIES,
  boundsSpanKm,
  estimateMb,
  fmtMb,
  qualityRank,
  tileCountForBounds,
  type Bounds,
  type OfflineQuality,
} from "../lib/offline-map";

const ACCENT = "var(--live-gps)";
const SAVED = "#34d399";

interface Props {
  open: boolean;
  bounds: Bounds | null;
  /** Resolution already on disk, or null when nothing is saved. */
  savedQualityKey: string | null;
  onClose: () => void;
  onConfirm: (quality: OfflineQuality) => void;
  /** Delete the saved pack. */
  onRemove: () => void;
}

/**
 * Offline-map download sheet. Shows the area + estimated size and lets the runner
 * pick a resolution — Fast (overview), Balanced (recommended) or Detailed (full
 * zoom). The estimate follows the chosen resolution so there are no surprises.
 *
 * Mirrors the native app's sheet (apps/mobile/src/map/OfflineDownloadModal.tsx):
 * once a pack is saved, its row goes green and everything below it greys out as
 * "already covered", so the only thing left to choose is an upgrade — and
 * removing the pack is a deliberate button, never a stray tap on the map
 * control.
 */
export function OfflineMapModal({ open, bounds, savedQualityKey, onClose, onConfirm, onRemove }: Props) {
  const { t } = useT();
  const savedRank = qualityRank(savedQualityKey);
  // Only higher resolutions are worth downloading — the saved one and anything
  // below it is already covered by what's on disk.
  const upgrades = useMemo(() => QUALITIES.filter((_, i) => i > savedRank), [savedRank]);
  const [qualityKey, setQualityKey] = useState(() => upgrades[0]?.key ?? "balanced");

  // Re-seat the selection each time the sheet opens: the saved quality may have
  // changed since last time, and a covered row must never stay selected.
  useEffect(() => {
    if (!open) return;
    const preferred = upgrades.find((q) => q.key === "balanced") ?? upgrades[0];
    setQualityKey(preferred?.key ?? "");
  }, [open, upgrades]);

  const quality = QUALITIES.find((q) => q.key === qualityKey) ?? null;

  const span = useMemo(() => (bounds ? boundsSpanKm(bounds) : null), [bounds]);
  const estimates = useMemo(() => {
    const out: Record<string, number> = {};
    if (!bounds) return out;
    for (const q of QUALITIES) out[q.key] = estimateMb(tileCountForBounds(bounds, q.minZoom, q.maxZoom));
    return out;
  }, [bounds]);

  const sizeMb = quality ? estimates[quality.key] : undefined;
  const nothingLeft = upgrades.length === 0;

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(2,8,18,0.72)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "end center",
        padding: 14,
        paddingBottom: "calc(14px + env(safe-area-inset-bottom))",
        animation: "dockIn 0.28s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--bg-surface)",
          borderRadius: 24,
          border: "1px solid rgba(148,163,184,0.18)",
          boxShadow: "0 -10px 60px rgba(0,0,0,0.6)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            margin: "0 auto",
            background: savedQualityKey ? "rgba(52,211,153,0.14)" : "rgba(46,155,255,0.14)",
            border: `1px solid ${savedQualityKey ? "rgba(52,211,153,0.3)" : "rgba(46,155,255,0.3)"}`,
            display: "grid",
            placeItems: "center",
            color: savedQualityKey ? SAVED : ACCENT,
          }}
        >
          <DownloadCloud size={26} />
        </div>

        <div>
          <div className="archivo" style={{ fontWeight: 800, fontSize: 19, color: "var(--text-primary)" }}>
            {t(savedQualityKey ? "offline.titleSaved" : "offline.title")}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
            {t("offline.subtitle")}
          </div>
        </div>

        {/* One compact line: the area + estimated size. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 18,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 14,
            padding: "12px 14px",
          }}
        >
          <Stat
            label={t("offline.areaLabel")}
            value={span ? `${span.widthKm.toFixed(0)} × ${span.heightKm.toFixed(0)} ${t("common.km")}` : "—"}
          />
          <div style={{ width: 1, background: "rgba(148,163,184,0.18)" }} />
          <Stat label={t("offline.sizeLabel")} value={sizeMb != null ? fmtMb(sizeMb) : "—"} accent />
        </div>

        {/* Resolution picker — Fast / Balanced / Detailed. What is already on
            disk is green and unselectable; anything below it is implied by that
            pack, so it greys out too. */}
        <div style={{ textAlign: "left" }}>
          <div className="section-label" style={{ marginBottom: 8 }}>
            {t("offline.quality")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {QUALITIES.map((q, i) => {
              const isSaved = q.key === savedQualityKey;
              const superseded = i < savedRank;
              const covered = isSaved || superseded;
              const selected = !covered && q.key === qualityKey;
              const mb = estimates[q.key];
              const labelColor = isSaved
                ? SAVED
                : superseded
                  ? "var(--text-muted)"
                  : selected
                    ? ACCENT
                    : "var(--text-primary)";
              return (
                <button
                  key={q.key}
                  onClick={() => !covered && setQualityKey(q.key)}
                  disabled={covered}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 14,
                    opacity: superseded ? 0.55 : 1,
                    background: isSaved
                      ? "rgba(52,211,153,0.12)"
                      : selected
                        ? "rgba(46,155,255,0.14)"
                        : "rgba(255,255,255,0.04)",
                    border: `1px solid ${
                      isSaved ? "rgba(52,211,153,0.45)" : selected ? ACCENT : "rgba(148,163,184,0.18)"
                    }`,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <div
                    className="archivo"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontWeight: 800,
                      fontSize: 13.5,
                      color: labelColor,
                    }}
                  >
                    {covered && <Check size={12} color={isSaved ? SAVED : "var(--text-muted)"} />}
                    {t(`offline.q.${q.key}`)}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: covered ? "var(--text-label)" : selected ? ACCENT : "var(--text-muted)",
                      marginTop: 3,
                    }}
                  >
                    {covered ? t(isSaved ? "offline.saved" : "offline.covered") : mb != null ? fmtMb(mb) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {nothingLeft ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textAlign: "left",
              background: "rgba(52,211,153,0.1)",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 12,
              fontWeight: 700,
              color: "#6ee7b7",
            }}
          >
            <Check size={14} color="#6ee7b7" /> {t("offline.allSaved")}
          </div>
        ) : sizeMb != null && sizeMb > 250 ? (
          <div
            style={{
              textAlign: "left",
              background: "rgba(245,158,11,0.1)",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 12,
              fontWeight: 700,
              color: "#fcd34d",
            }}
          >
            {t("offline.large")}
          </div>
        ) : null}

        <button
          onClick={() => bounds && quality && onConfirm(quality)}
          disabled={!bounds || !quality}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "14px",
            borderRadius: 16,
            background: ACCENT,
            color: "#04121f",
            fontWeight: 800,
            fontSize: 15,
            opacity: bounds && quality ? 1 : 0.5,
            boxShadow: "0 8px 22px rgba(46,155,255,0.35)",
          }}
        >
          <DownloadCloud size={18} color="#04121f" />{" "}
          {t(savedQualityKey ? "offline.upgrade" : "offline.download")}
        </button>
        {savedQualityKey ? (
          <button
            onClick={onRemove}
            style={{
              padding: "12px",
              borderRadius: 16,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#fca5a5",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {t("offline.remove")}
          </button>
        ) : null}
        <button onClick={onClose} style={{ color: "var(--text-muted)", fontWeight: 700, fontSize: 14, padding: 4 }}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 84 }}>
      <div className="archivo" style={{ fontWeight: 800, fontSize: 17, color: accent ? ACCENT : "var(--text-primary)" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-label)", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function Check({ size = 14, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function DownloadCloud({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 17a5 5 0 0 1-.916-9.916 5.002 5.002 0 0 1 9.832 0A5 5 0 0 1 16 17" />
      <path d="M12 12v9" />
      <path d="m8 17 4 4 4-4" />
    </svg>
  );
}
