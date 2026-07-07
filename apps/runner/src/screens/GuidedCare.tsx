import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { useApp } from "../state/AppContext";
import { TRIAGE, TRIAGE_START, type OptionTone } from "../lib/triage";
import { CprMode } from "../components/CprMode";
import { fetchMyIncidents } from "../api";
import { logFirstAid, setFirstAidIncident } from "../lib/first-aid-log";

export function GuidedCare() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang } = useT();
  const { eventInfo } = useApp();
  const commandPhone = eventInfo?.commandPhone;
  const [nodeId, setNodeId] = useState(TRIAGE_START);
  const [showCpr, setShowCpr] = useState(false);

  // Attach this guided session to the incident it followed from (router state),
  // falling back to the runner's newest open incident on a direct open. Guided
  // care keeps working with no incident at all — logging just no-ops.
  const stateIncidentId = (location.state as { incidentId?: string } | null)?.incidentId;
  useEffect(() => {
    if (stateIncidentId) {
      setFirstAidIncident(stateIncidentId);
    } else {
      fetchMyIncidents()
        .then((incidents) => {
          const open = incidents
            .filter((i) => i.status !== "resolved" && i.status !== "closed")
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          setFirstAidIncident(open?.id ?? null);
        })
        .catch(() => setFirstAidIncident(null));
    }
    return () => setFirstAidIncident(null);
  }, [stateIncidentId]);

  const node = TRIAGE[nodeId] ?? TRIAGE[TRIAGE_START];
  // The triage copy is authored in bg/en; for any other UI language fall back
  // to English rather than showing nothing.
  const tr = (ls: { bg: string; en: string; [k: string]: string | undefined }) => ls[lang] ?? ls.en;

  const accent =
    node.tone === "critical" ? "var(--critical)" : node.tone === "good" ? "var(--primary)" : "var(--border-strong)";

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-base)", display: "flex", flexDirection: "column", padding: "44px 18px 20px" }}>
      {/* Header: screen title + close */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="archivo" style={{ fontWeight: 900, fontSize: 18 }}>{t("guided.title")}</span>
        <button onClick={() => navigate("/map")} style={{ width: 38, height: 38, borderRadius: 12, background: "var(--bg-input)", border: "1px solid var(--border-mid)", color: "var(--text-secondary)", fontSize: 18 }}>✕</button>
      </div>

      {/* Call Race Command — hidden when the event has no command phone set */}
      {commandPhone && (
        <>
          <a href={`tel:${commandPhone}`} style={{ textDecoration: "none" }}>
            <button className="btn-critical" style={{ width: "100%", marginTop: 14, minHeight: 50 }}>
              📞 {t("guided.call")}
            </button>
          </a>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
            {t("guided.callBanner")}
          </div>
        </>
      )}

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
          style={{ width: "100%", marginTop: 16, padding: 18, borderRadius: 16, background: "linear-gradient(135deg,#FF5964,#E63946)", color: "#fff", fontFamily: "Sofia Sans", fontWeight: 900, fontSize: 17, boxShadow: "0 12px 28px rgba(230,57,70,0.4)" }}
        >
          ❤️ {t("cpr.start")}
        </button>
      )}

      {/* Big answer buttons */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
        {node.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => {
              // English copy is the canonical log line (medics/dashboard read it).
              logFirstAid({
                kind: "first_aid",
                text: `First aid: ${node.title.en} → ${opt.label.en}`,
                meta: { nodeId, nextId: opt.next, question: node.title.en, answer: opt.label.en, lang },
              });
              setNodeId(opt.next);
            }}
            style={bigBtnStyle(opt.tone)}
          >
            {tr(opt.label)}
          </button>
        ))}
      </div>

      {showCpr && <CprMode onClose={() => setShowCpr(false)} />}

      {nodeId !== TRIAGE_START && (
        <button
          onClick={() => {
            logFirstAid({
              kind: "first_aid",
              text: "First aid: guidance restarted from the beginning",
              meta: { nodeId, restart: true },
            });
            setNodeId(TRIAGE_START);
          }}
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
    fontFamily: "Sofia Sans",
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
