import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { PRIMARY_CATEGORIES, EXTRA_CATEGORIES, type IncidentCategoryDef } from "../lib/types";
import type { IncidentCategory } from "../api/contracts-shim";

export function ReportSheet() {
  const navigate = useNavigate();
  const { startDraft } = useApp();
  const { t } = useT();
  const [showMore, setShowMore] = useState(false);

  function pick(category: IncidentCategory) {
    startDraft(category); // snapshots the last good GPS fix immediately
    navigate("/confirm");
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,12,18,0.55)", display: "flex", flexDirection: "column", justifyContent: "flex-end", zIndex: 50 }}>
      <div
        style={{
          background: "var(--bg-surface)",
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          padding: "12px 16px 24px",
          animation: "sheetUp 0.3s ease",
          maxHeight: "92%",
          overflowY: "auto",
        }}
      >
        <div style={{ width: 42, height: 5, borderRadius: 3, background: "var(--border-strong)", margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--critical)", animation: "pulseDot 2s infinite" }} />
          <h2 className="archivo" style={{ fontWeight: 900, fontSize: 22, margin: 0 }}>{t("report.title")}</h2>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "6px 0 16px" }}>{t("report.subtitle")}</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
          {PRIMARY_CATEGORIES.map((c) => (
            <CategoryCard key={c.category} def={c} onClick={() => pick(c.category)} />
          ))}
        </div>

        <button
          onClick={() => setShowMore((s) => !s)}
          style={{ width: "100%", marginTop: 14, padding: 12, borderRadius: 13, border: "1px solid var(--border-mid)", color: "var(--text-secondary)", fontWeight: 700, fontSize: 13 }}
        >
          {t("report.more")} {showMore ? "▴" : "▾"}
        </button>

        {showMore && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 12 }}>
            {EXTRA_CATEGORIES.map((c) => (
              <button
                key={c.category}
                onClick={() => pick(c.category)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", borderRadius: 13, background: "var(--bg-card)", border: "1px solid var(--border-subtle)", textAlign: "left" }}
              >
                <span style={{ width: 32, height: 32, borderRadius: 9, background: c.color, display: "grid", placeItems: "center", fontSize: 15 }}>{c.glyph}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t(c.labelKey)}</span>
              </button>
            ))}
          </div>
        )}

        <button onClick={() => navigate("/map")} style={{ width: "100%", marginTop: 16, padding: 12, color: "var(--text-muted)", fontWeight: 700, fontSize: 14 }}>
          {t("report.cancel")}
        </button>
      </div>
    </div>
  );
}

function CategoryCard({ def, onClick }: { def: IncidentCategoryDef; onClick: () => void }) {
  const { t } = useT();
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 11,
        minHeight: 122,
        padding: "15px 13px",
        borderRadius: 18,
        background: "var(--critical-bg)",
        border: `1px solid ${def.color}`,
        textAlign: "left",
      }}
    >
      <span style={{ width: 44, height: 44, borderRadius: 13, background: def.color, display: "grid", placeItems: "center", fontSize: 22, boxShadow: `0 6px 16px ${def.color}66` }}>
        {def.glyph}
      </span>
      <span className="archivo" style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>{t(def.labelKey)}</span>
    </button>
  );
}
