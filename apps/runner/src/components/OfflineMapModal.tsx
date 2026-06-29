import { useEffect, useMemo, useState } from "react";
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
 * Offline-map download sheet. Shows the area + estimated size and lets the runner
 * pick a resolution — Fast (overview), Balanced (recommended) or Detailed (full
 * zoom). The estimate follows the chosen resolution so there are no surprises.
 */
export function OfflineMapModal({ open, bounds, onClose, onConfirm }: Props) {
  const { t } = useT();
  // Default to "Balanced" — good detail without a huge download.
  const [qualityKey, setQualityKey] = useState("balanced");
  const quality = QUALITIES.find((q) => q.key === qualityKey) ?? QUALITIES[1];

  // Reset to the recommended resolution each time the sheet is reopened.
  useEffect(() => {
    if (open) setQualityKey("balanced");
  }, [open]);

  const span = useMemo(() => (bounds ? boundsSpanKm(bounds) : null), [bounds]);
  const sizeMb = useMemo(
    () => (bounds ? estimateMb(tileCountForBounds(bounds, quality.minZoom, quality.maxZoom)) : null),
    [bounds, quality],
  );

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
            background: "rgba(46,155,255,0.14)",
            border: "1px solid rgba(46,155,255,0.3)",
            display: "grid",
            placeItems: "center",
            color: ACCENT,
          }}
        >
          <DownloadCloud size={26} />
        </div>

        <div>
          <div className="archivo" style={{ fontWeight: 800, fontSize: 19, color: "var(--text-primary)" }}>
            {t("offline.title")}
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

        {/* Resolution picker — Fast / Balanced / Detailed. */}
        <div style={{ textAlign: "left" }}>
          <div className="section-label" style={{ marginBottom: 8 }}>
            {t("offline.quality")}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {QUALITIES.map((q) => {
              const selected = q.key === qualityKey;
              return (
                <button
                  key={q.key}
                  onClick={() => setQualityKey(q.key)}
                  style={{
                    flex: 1,
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 14,
                    background: selected ? "rgba(46,155,255,0.14)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${selected ? ACCENT : "rgba(148,163,184,0.18)"}`,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <div
                    className="archivo"
                    style={{ fontWeight: 800, fontSize: 13.5, color: selected ? ACCENT : "var(--text-primary)" }}
                  >
                    {t(`offline.q.${q.key}`)}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.3 }}>
                    {t(`offline.q.${q.key}.sub`)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => bounds && onConfirm(quality)}
          disabled={!bounds}
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
            opacity: bounds ? 1 : 0.5,
            boxShadow: "0 8px 22px rgba(46,155,255,0.35)",
          }}
        >
          <DownloadCloud size={18} color="#04121f" /> {t("offline.download")}
        </button>
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

function DownloadCloud({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 17a5 5 0 0 1-.916-9.916 5.002 5.002 0 0 1 9.832 0A5 5 0 0 1 16 17" />
      <path d="M12 12v9" />
      <path d="m8 17 4 4 4-4" />
    </svg>
  );
}
