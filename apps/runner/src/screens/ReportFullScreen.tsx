import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { PRIMARY_CATEGORIES, EXTRA_CATEGORIES } from "../lib/types";
import type { IncidentCategory } from "../api/contracts-shim";

/** Step 2 — "What is happening?". Four major categories as big, colour-coded
 *  cards for instant recognition, with an "Others" expander revealing the long
 *  tail. The subject (me / someone else + BIB) carries in from step 1. */
export function ReportFullScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { startDraft } = useApp();
  const { t } = useT();
  const [showOthers, setShowOthers] = useState(false);
  const subject = (location.state ?? { forSelf: true, patientBib: null, reporterPhone: null }) as {
    forSelf: boolean;
    patientBib: string | null;
    reporterPhone?: string | null;
  };

  function pick(category: IncidentCategory) {
    startDraft(category, subject);
    navigate("/confirm");
  }

  // Vivid, distinct fills for the four majors so they're recognisable at a glance.
  const major: Record<string, { bg: string; fg: string; chip: string }> = {
    severe_injury: { bg: "linear-gradient(150deg,#FF5A67,#E63946)", fg: "#FFFFFF", chip: "rgba(255,255,255,0.22)" },
    chest_pain: { bg: "linear-gradient(150deg,#FFA24D,#F47C2C)", fg: "#3A1500", chip: "rgba(58,21,0,0.16)" },
    collapse: { bg: "linear-gradient(150deg,#D4232F,#A5121C)", fg: "#FFFFFF", chip: "rgba(255,255,255,0.20)" },
    minor_injury: { bg: "linear-gradient(150deg,#FFC53D,#F4A91B)", fg: "#3A2600", chip: "rgba(58,38,0,0.16)" },
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "linear-gradient(180deg,#1A0E12,#0C0809)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "44px 16px 0" }}>
        <button onClick={() => navigate("/report")} style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", fontSize: 14, fontWeight: 700, background: "none", border: "none" }}>
          <span style={{ fontSize: 18 }}>←</span>
          <span className="archivo" style={{ fontWeight: 900, fontSize: 18, letterSpacing: "0.02em" }}>{t("who.what")}</span>
        </button>
        <button onClick={() => navigate("/map")} style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 18, border: "none" }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px calc(20px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column" }}>
        <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, margin: "0 0 16px" }}>{t("report.subtitle")}</p>

        {/* Major categories — 2×2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {PRIMARY_CATEGORIES.map((c) => {
            const m = major[c.category];
            return (
              <button
                key={c.category}
                onClick={() => pick(c.category)}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  minHeight: 156,
                  padding: 16,
                  borderRadius: 22,
                  border: "none",
                  background: m.bg,
                  color: m.fg,
                  textAlign: "left",
                  boxShadow: "0 10px 26px rgba(0,0,0,0.4)",
                }}
              >
                <span style={{ width: 50, height: 50, borderRadius: 15, background: m.chip, display: "grid", placeItems: "center", fontSize: 26 }}>{c.glyph}</span>
                <span style={{ flex: 1 }} />
                <div className="archivo" style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.15 }}>{t(c.labelKey)}</div>
                {c.subKey && <div style={{ fontSize: 11.5, opacity: 0.8, lineHeight: 1.25 }}>{t(c.subKey)}</div>}
              </button>
            );
          })}
        </div>

        {/* Others toggle */}
        <button
          onClick={() => setShowOthers((s) => !s)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 14,
            padding: "15px 16px",
            borderRadius: 18,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#fff",
          }}
        >
          <span style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.08)", display: "grid", placeItems: "center", fontSize: 18 }}>⋯</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div className="archivo" style={{ fontWeight: 800, fontSize: 15 }}>{t("report.more")}</div>
            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>{t("report.moreSub")}</div>
          </div>
          <span style={{ fontSize: 16, color: "rgba(255,255,255,0.7)", transition: "transform 0.2s", transform: showOthers ? "rotate(180deg)" : "none" }}>▾</span>
        </button>

        {/* Extra categories */}
        {showOthers && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12, animation: "sheetUp 0.25s ease" }}>
            {EXTRA_CATEGORIES.map((c) => (
              <button
                key={c.category}
                onClick={() => pick(c.category)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "13px 12px",
                  borderRadius: 16,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff",
                  textAlign: "left",
                }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 10, background: c.color, display: "grid", placeItems: "center", fontSize: 17, flexShrink: 0 }}>{c.glyph}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>{t(c.labelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
