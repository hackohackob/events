import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { fetchMyIncidents } from "../api";
import type { IncidentRecordLike } from "../api/contracts-shim";

export function SosSent() {
  const navigate = useNavigate();
  const { t } = useT();
  const location = useLocation();
  const state = (location.state ?? {}) as { incidentId?: string; queued?: boolean };
  const [incident, setIncident] = useState<IncidentRecordLike | null>(null);

  // Poll my own incidents to surface the dispatch status + assigned medic.
  useEffect(() => {
    if (state.queued) return;
    let alive = true;
    const tick = () => {
      fetchMyIncidents()
        .then((list) => {
          if (!alive) return;
          const found = state.incidentId ? list.find((i) => i.id === state.incidentId) : list[0];
          if (found) setIncident(found);
        })
        .catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state.incidentId, state.queued]);

  const dispatched = (incident?.responders?.length ?? 0) > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "linear-gradient(180deg,#08231A 0%,#0A1118 42%)", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px 28px", overflowY: "auto" }}>
      <div style={{ position: "relative", width: 130, height: 130, display: "grid", placeItems: "center", marginBottom: 20 }}>
        <span style={{ position: "absolute", inset: 17, borderRadius: "50%", border: "2px solid #2BE3A0", animation: "ring 2.2s infinite" }} />
        <div style={{ width: 96, height: 96, borderRadius: "50%", background: "linear-gradient(135deg,#2BE3A0,#18B883)", display: "grid", placeItems: "center", fontSize: 46, color: "#fff", boxShadow: "0 0 46px rgba(43,227,160,0.5)" }}>✓</div>
      </div>
      <h1 className="archivo" style={{ fontWeight: 900, fontSize: 34, color: "#fff", margin: 0 }}>{t("sent.title")}</h1>
      <p style={{ color: "#A9F2D6", fontSize: 14, fontWeight: 700, textAlign: "center", margin: "8px 0 24px" }}>{t("sent.sub")}</p>

      <div style={{ width: "100%", maxWidth: 420, background: "#101826", borderRadius: 18, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--primary-bg)", display: "grid", placeItems: "center" }}>🛡️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--primary)" }}>
              {dispatched ? t("sent.dispatched", { eta: 6 }) : t("sent.pending")}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {dispatched ? t("sent.movingToYou") : t("map.noMedic")}
            </div>
          </div>
          {dispatched && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--primary)", animation: "pulseDot 2s infinite" }} />}
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 420, background: "rgba(255,176,32,0.10)", border: "1px solid rgba(255,176,32,0.4)", borderRadius: 14, padding: "12px 14px", marginTop: 14, color: "var(--caution)", fontSize: 12.5, fontWeight: 600 }}>
        {t("sent.stay")}
      </div>

      <div style={{ flex: 1 }} />
      <div style={{ width: "100%", maxWidth: 420, marginTop: 24 }}>
        <button className="btn-primary" onClick={() => navigate("/guided")}>{t("sent.guided")}</button>
        <button onClick={() => navigate("/map")} style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 16, border: "1px solid var(--border-mid)", color: "var(--text-secondary)", fontWeight: 700 }}>
          {t("sent.track")}
        </button>
      </div>
    </div>
  );
}
