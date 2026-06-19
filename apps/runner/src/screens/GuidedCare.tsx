import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { fetchMyIncidents } from "../api";
import { COMMAND_PHONE } from "../lib/config";
import { TRIAGE, TRIAGE_START, type OptionTone } from "../lib/triage";
import { CprMode } from "../components/CprMode";

export function GuidedCare() {
  const navigate = useNavigate();
  const { t, lang } = useT();
  const [nodeId, setNodeId] = useState(TRIAGE_START);
  const [showCpr, setShowCpr] = useState(false);
  const [eta, setEta] = useState<{ navigating: boolean; assigned: boolean; etaMin: number | null }>({
    navigating: false,
    assigned: false,
    etaMin: null,
  });

  // Real medic status for the header (no hardcoded ETA).
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchMyIncidents()
        .then((list) => {
          if (!alive) return;
          const inc = list.find((i) => i.status !== "resolved" && i.status !== "closed") ?? list[0];
          if (!inc) return;
          const navigating = Boolean(inc.assignedMedicNavigating);
          const assigned = (inc.responders?.length ?? 0) > 0;
          let etaMin: number | null = null;
          if (navigating && inc.assignedMedicEtaIso) {
            const m = Math.round((new Date(inc.assignedMedicEtaIso).getTime() - Date.now()) / 60000);
            etaMin = Number.isFinite(m) ? Math.max(1, m) : null;
          }
          setEta({ navigating, assigned, etaMin });
        })
        .catch(() => undefined);
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const node = TRIAGE[nodeId] ?? TRIAGE[TRIAGE_START];
  const tr = (ls: { bg: string; en: string }) => ls[lang];

  const etaLabel =
    eta.navigating && eta.etaMin != null
      ? t("guided.enRoute", { eta: eta.etaMin })
      : eta.assigned
        ? t("guided.assigned")
        : t("guided.awaiting");

  const accent =
    node.tone === "critical" ? "var(--critical)" : node.tone === "good" ? "var(--primary)" : "var(--border-strong)";

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-base)", display: "flex", flexDirection: "column", padding: "44px 18px 20px" }}>
      {/* Header: live medic status + close */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: "rgba(43,227,160,0.12)", border: "1px solid rgba(43,227,160,0.35)", fontSize: 11, fontWeight: 800, color: "var(--primary)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", animation: "pulseDot 2s infinite" }} />
          {etaLabel}
        </span>
        <button onClick={() => navigate("/map")} style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("guided.title")}</button>
      </div>

      {/* Call Race Command — always available */}
      <a href={`tel:${COMMAND_PHONE}`} style={{ textDecoration: "none" }}>
        <button className="btn-critical" style={{ width: "100%", marginTop: 14, minHeight: 50 }}>
          📞 {t("guided.call")}
        </button>
      </a>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
        {t("guided.callBanner")}
      </div>

      {/* Triage card */}
      <div
        style={{
          marginTop: 18,
          padding: "22px 18px",
          borderRadius: 18,
          background: node.tone === "critical" ? "var(--critical-bg)" : node.tone === "good" ? "var(--primary-bg)" : "var(--bg-card)",
          border: `1.5px solid ${accent}`,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 52, lineHeight: 1 }}>{node.visual}</div>
        <h2 className="archivo" style={{ fontWeight: 800, fontSize: 21, margin: "14px 0 0", lineHeight: 1.25 }}>
          {tr(node.title)}
        </h2>
        {node.body && (
          <p style={{ color: "var(--text-secondary)", fontSize: 14.5, lineHeight: 1.5, margin: "12px 0 0" }}>{tr(node.body)}</p>
        )}
      </div>

      {/* CPR launcher on the CPR node */}
      {nodeId === "cpr" && (
        <button
          onClick={() => setShowCpr(true)}
          style={{ width: "100%", marginTop: 16, padding: 18, borderRadius: 16, background: "linear-gradient(135deg,#FF5964,#E63946)", color: "#fff", fontFamily: "Archivo", fontWeight: 900, fontSize: 17, boxShadow: "0 12px 28px rgba(230,57,70,0.4)" }}
        >
          ❤️ {t("cpr.start")}
        </button>
      )}

      {/* Big answer buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
        {node.options.map((opt, i) => (
          <button key={i} onClick={() => setNodeId(opt.next)} style={bigBtnStyle(opt.tone)}>
            {tr(opt.label)}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {showCpr && <CprMode onClose={() => setShowCpr(false)} />}

      {nodeId !== TRIAGE_START && (
        <button
          onClick={() => setNodeId(TRIAGE_START)}
          style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid var(--border-mid)", color: "var(--text-secondary)", fontWeight: 700, fontSize: 14 }}
        >
          {t("guided.restart")}
        </button>
      )}
    </div>
  );
}

function bigBtnStyle(tone?: OptionTone): React.CSSProperties {
  const base: React.CSSProperties = {
    width: "100%",
    padding: "18px 16px",
    borderRadius: 16,
    fontFamily: "Archivo",
    fontWeight: 800,
    fontSize: 17,
    textAlign: "center",
    border: "1.5px solid var(--border-mid)",
    background: "var(--bg-card)",
    color: "var(--text-primary)",
  };
  if (tone === "yes" || tone === "no") {
    const c = tone === "yes" ? "var(--primary)" : "var(--critical)";
    return { ...base, border: `1.5px solid ${c}`, color: c, background: tone === "yes" ? "var(--primary-bg)" : "var(--critical-bg)" };
  }
  if (tone === "critical") return { ...base, border: "1.5px solid var(--critical)", color: "var(--critical)", background: "var(--critical-bg)" };
  return base;
}
