import { useT } from "../i18n";
import { formatDistance } from "../lib/geo";

export interface DockNearest {
  distanceMeters: number;
  bearingDeg: number;
}
export interface DockActive {
  navigating: boolean;
  assigned: boolean;
  etaMin: number | null;
}

/**
 * The bottom "safety dock" — a single frosted-glass panel that unifies the
 * nearest-medic radar, the report action, and (when an alert is live) the
 * view-your-signal status. Idle → report is primary; active → the live alert is
 * primary and reporting another is secondary.
 */
export function SafetyDock({
  nearest,
  active,
  onReport,
  onViewAlert,
}: {
  nearest: DockNearest | null;
  active: DockActive | null;
  onReport: () => void;
  onViewAlert: () => void;
}) {
  const { t } = useT();

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 74,
        borderRadius: 26,
        padding: 10,
        background: "linear-gradient(180deg, rgba(14,22,34,0.55), rgba(8,12,18,0.84))",
        backdropFilter: "blur(18px) saturate(1.25)",
        WebkitBackdropFilter: "blur(18px) saturate(1.25)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        animation: "dockIn 0.35s ease",
      }}
    >
      <MedicRadar nearest={nearest} />
      {active ? (
        <>
          <ViewAlertButton active={active} onClick={onViewAlert} />
          <button
            onClick={onReport}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "11px",
              borderRadius: 14,
              background: "transparent",
              border: "1px solid var(--border-strong)",
              color: "var(--text-secondary)",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            ＋ {t("dock.reportAnother")}
          </button>
        </>
      ) : (
        <ReportButton onClick={onReport} />
      )}
    </div>
  );
}

function MedicRadar({ nearest }: { nearest: DockNearest | null }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 8px 12px" }}>
      {/* Directional radar badge */}
      <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "2px solid var(--primary)",
            animation: "dockRing 2.4s ease-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "radial-gradient(circle at 50% 40%, rgba(43,227,160,0.25), rgba(43,227,160,0.06))",
            border: "1px solid rgba(43,227,160,0.55)",
            display: "grid",
            placeItems: "center",
            fontSize: 18,
          }}
        >
          {nearest ? (
            <span
              style={{
                display: "inline-block",
                color: "var(--primary)",
                fontSize: 20,
                fontWeight: 900,
                transform: `rotate(${nearest.bearingDeg}deg)`,
                transition: "transform 0.5s ease",
              }}
            >
              ↑
            </span>
          ) : (
            "🛡️"
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="section-label" style={{ color: "#3DBE8E", fontSize: 10 }}>
          {t("dock.nearestMedic")}
        </div>
        {nearest ? (
          <div className="archivo" style={{ fontWeight: 800, fontSize: 18, color: "var(--text-primary)" }}>
            {formatDistance(nearest.distanceMeters)}{" "}
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>{t("dock.ahead")}</span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--primary)", animation: "breathe 1.6s infinite" }} />
            {t("dock.locating")}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportButton({ onClick }: { onClick: () => void }) {
  const { t } = useT();
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: 64,
        borderRadius: 20,
        border: "none",
        background: "linear-gradient(135deg,#FF5964,#E63946)",
        boxShadow: "0 14px 34px rgba(230,57,70,0.5)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 16px",
        animation: "fabPulse 2.6s infinite",
      }}
    >
      {/* animated light sweep */}
      <span
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: "35%",
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)",
          animation: "sheen 3.6s ease-in-out infinite",
        }}
      />
      {/* icon chip with pulse ring */}
      <span style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
        <span style={{ position: "absolute", inset: -2, borderRadius: 12, border: "2px solid rgba(255,255,255,0.5)", animation: "dockRing 2.2s ease-out infinite" }} />
        <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: "rgba(255,255,255,0.22)", display: "grid", placeItems: "center", fontSize: 20, color: "#fff" }}>✚</span>
      </span>
      <span style={{ position: "relative", flex: 1, textAlign: "left" }}>
        <span className="archivo" style={{ display: "block", fontWeight: 900, fontSize: 19, letterSpacing: "0.03em", color: "#fff", lineHeight: 1.05 }}>
          {t("map.report")}
        </span>
      </span>
      <span style={{ position: "relative", fontSize: 22, color: "rgba(255,255,255,0.85)" }}>→</span>
    </button>
  );
}

function ViewAlertButton({ active, onClick }: { active: DockActive; onClick: () => void }) {
  const { t } = useT();
  const status =
    active.navigating && active.etaMin != null
      ? t("sent.dispatched", { eta: active.etaMin })
      : active.assigned
        ? t("sent.assigned")
        : t("sent.pending");

  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        borderRadius: 18,
        border: "1px solid rgba(43,227,160,0.55)",
        background: "linear-gradient(135deg, rgba(43,227,160,0.22), rgba(24,184,131,0.14))",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        boxShadow: "0 10px 26px rgba(43,227,160,0.22)",
      }}
    >
      {/* live emblem */}
      <span style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid var(--primary)", animation: "dockRing 2.2s ease-out infinite" }} />
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "linear-gradient(135deg,var(--primary),var(--primary-dark))", display: "grid", placeItems: "center", fontSize: 18, color: "#05140E" }}>✓</span>
      </span>
      <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--primary)", animation: "breathe 1.4s infinite" }} />
          <span className="section-label" style={{ color: "var(--primary)", fontSize: 10 }}>{t("dock.sosActive")}</span>
        </span>
        <span className="archivo" style={{ display: "block", fontWeight: 800, fontSize: 15, color: "var(--text-primary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {status}
        </span>
        <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{t("dock.tapView")}</span>
      </span>
      <span style={{ fontSize: 22, color: "var(--primary)" }}>›</span>
    </button>
  );
}
