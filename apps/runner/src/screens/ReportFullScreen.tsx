import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { PRIMARY_CATEGORIES } from "../lib/types";
import type { IncidentCategory } from "../api/contracts-shim";

/** Direction B — full-screen stacked variant (bigger targets for shaking hands). */
export function ReportFullScreen() {
  const navigate = useNavigate();
  const { startDraft } = useApp();
  const { t } = useT();

  function pick(category: IncidentCategory) {
    startDraft(category);
    navigate("/confirm");
  }

  const textColor: Record<string, string> = {
    severe_injury: "#FFFFFF",
    chest_pain: "#3A1500",
    collapse: "#FFFFFF",
    minor_injury: "#3A2600",
  };
  const bg: Record<string, string> = {
    severe_injury: "#E63946",
    chest_pain: "#FF8A3D",
    collapse: "#BA1C28",
    minor_injury: "#FFB020",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "linear-gradient(180deg,#1A0E12,#0C0809)", display: "flex", flexDirection: "column", padding: "44px 16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--critical)", animation: "pulseDot 2s infinite" }} />
          <span className="archivo" style={{ fontWeight: 900, fontSize: 18, color: "#fff", letterSpacing: "0.02em" }}>{t("map.report")}</span>
        </div>
        <button onClick={() => navigate("/map")} style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 18 }}>✕</button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
        {PRIMARY_CATEGORIES.map((c) => (
          <button
            key={c.category}
            onClick={() => pick(c.category)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 15,
              padding: 18,
              borderRadius: 20,
              background: bg[c.category],
              color: textColor[c.category],
              textAlign: "left",
              boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
            }}
          >
            <span style={{ width: 50, height: 50, borderRadius: 15, background: "rgba(255,255,255,0.22)", display: "grid", placeItems: "center", fontSize: 24 }}>{c.glyph}</span>
            <div style={{ flex: 1 }}>
              <div className="archivo" style={{ fontWeight: 800, fontSize: 18 }}>{t(c.labelKey)}</div>
              <div style={{ fontSize: 12, opacity: 0.78 }}>{c.subKey ? t(c.subKey) : ""}</div>
            </div>
            <span style={{ fontSize: 20 }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
