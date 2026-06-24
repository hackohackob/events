import { useMemo, useState } from "react";
import { useT } from "../i18n";
import {
  QUALITIES,
  boundsSpanKm,
  estimateMb,
  fmtMb,
  tileCountForBounds,
  type Bounds,
  type OfflineQuality,
} from "../lib/offline-map";

const ACCENT = "var(--live-gps)";

interface Props {
  open: boolean;
  bounds: Bounds | null;
  onClose: () => void;
  onConfirm: (quality: OfflineQuality) => void;
}

/**
 * Offline-map download sheet for the PWA — visual sibling of the native app's
 * OfflineDownloadModal: pick a quality, see the size/tile estimate, confirm.
 */
export function OfflineMapModal({ open, bounds, onClose, onConfirm }: Props) {
  const { t } = useT();
  const [selected, setSelected] = useState("balanced");

  const span = useMemo(() => (bounds ? boundsSpanKm(bounds) : null), [bounds]);
  const estimates = useMemo(() => {
    const out: Record<string, { tiles: number; mb: number }> = {};
    if (!bounds) return out;
    for (const q of QUALITIES) {
      const tiles = tileCountForBounds(bounds, q.minZoom, q.maxZoom);
      out[q.key] = { tiles, mb: estimateMb(tiles) };
    }
    return out;
  }, [bounds]);

  const chosen = QUALITIES.find((q) => q.key === selected) ?? QUALITIES[1];
  const chosenEst = estimates[chosen.key];

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
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              background: "rgba(46,155,255,0.14)",
              border: "1px solid rgba(46,155,255,0.3)",
              display: "grid",
              placeItems: "center",
              color: ACCENT,
            }}
          >
            <DownloadCloud />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="archivo" style={{ fontWeight: 800, fontSize: 17, color: "var(--text-primary)" }}>
              {t("offline.title")}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginTop: 1 }}>
              {t("offline.subtitle")}
            </div>
          </div>
          <button onClick={onClose} style={{ color: "var(--text-muted)", fontSize: 22, lineHeight: 1, padding: 4 }}>
            ✕
          </button>
        </div>

        {/* Area being cached */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 12,
            padding: 11,
          }}
        >
          <span style={{ fontSize: 15 }}>🗺️</span>
          <span style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
            {span
              ? t("offline.area", { w: span.widthKm.toFixed(1), h: span.heightKm.toFixed(1) })
              : t("offline.noArea")}
          </span>
        </div>

        {/* Quality options */}
        <div className="section-label" style={{ marginTop: 2 }}>{t("offline.quality")}</div>
        {QUALITIES.map((q) => {
          const est = estimates[q.key];
          const active = q.key === selected;
          return (
            <button
              key={q.key}
              onClick={() => setSelected(q.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderRadius: 14,
                textAlign: "left",
                border: `1px solid ${active ? "rgba(46,155,255,0.5)" : "rgba(148,163,184,0.14)"}`,
                background: active ? "rgba(46,155,255,0.08)" : "rgba(255,255,255,0.02)",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  flexShrink: 0,
                  border: `2px solid ${active ? ACCENT : "rgba(148,163,184,0.4)"}`,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {active && <span style={{ width: 10, height: 10, borderRadius: 5, background: ACCENT }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  className="archivo"
                  style={{ display: "block", fontWeight: 800, fontSize: 14, color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
                >
                  {t(`offline.q.${q.key}`)}
                </span>
                <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 1 }}>
                  {t(`offline.q.${q.key}.sub`)}
                </span>
              </span>
              <span style={{ textAlign: "right" }}>
                <span className="archivo" style={{ display: "block", fontWeight: 800, fontSize: 14, color: active ? ACCENT : "var(--text-secondary)" }}>
                  {est ? fmtMb(est.mb) : "—"}
                </span>
                <span style={{ display: "block", fontSize: 10, fontWeight: 600, color: "var(--text-label)", marginTop: 1 }}>
                  {est ? t("offline.tiles", { n: est.tiles.toLocaleString() }) : ""}
                </span>
              </span>
            </button>
          );
        })}

        {chosenEst && chosenEst.mb > 250 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,176,32,0.1)",
              borderRadius: 11,
              padding: "9px 11px",
              color: "var(--caution)",
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            ⚠️ {t("offline.large")}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "13px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.05)",
              color: "var(--text-secondary)",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => bounds && onConfirm(chosen)}
            disabled={!bounds}
            style={{
              flex: 1.4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              padding: "13px",
              borderRadius: 14,
              background: ACCENT,
              color: "#04121f",
              fontWeight: 800,
              fontSize: 14,
              opacity: bounds ? 1 : 0.5,
              boxShadow: "0 8px 22px rgba(46,155,255,0.35)",
            }}
          >
            <DownloadCloud size={16} color="#04121f" /> {t("offline.download")}
          </button>
        </div>
      </div>
    </div>
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
