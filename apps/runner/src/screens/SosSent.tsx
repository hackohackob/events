import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { fetchMyIncidents, updateIncidentDetails, uploadIncidentPhoto } from "../api";
import type { IncidentRecordLike } from "../api/contracts-shim";
import { COMMAND_PHONE } from "../lib/config";

export function SosSent() {
  const navigate = useNavigate();
  const { t } = useT();
  const location = useLocation();
  const state = (location.state ?? {}) as { incidentId?: string; queued?: boolean };
  const [incident, setIncident] = useState<IncidentRecordLike | null>(null);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const photoRef = useRef<HTMLInputElement>(null);
  const incidentId = state.incidentId;

  async function saveNote() {
    if (!incidentId || !note.trim()) return;
    try {
      await updateIncidentDetails(incidentId, { description: note.trim() });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !incidentId) return;
    try {
      await uploadIncidentPhoto(incidentId, file);
      setPhotoCount((c) => c + 1);
    } catch {
      /* ignore */
    }
  }

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

  const assigned = (incident?.responders?.length ?? 0) > 0;
  const navigating = Boolean(incident?.assignedMedicNavigating);
  const etaMin = (() => {
    if (!navigating || !incident?.assignedMedicEtaIso) return null;
    const mins = Math.round((new Date(incident.assignedMedicEtaIso).getTime() - Date.now()) / 60000);
    return Number.isFinite(mins) ? Math.max(1, mins) : null;
  })();

  // Status line: navigating with an ETA → show it; only assigned → "Medic is
  // assigned"; nobody yet → awaiting assignment.
  const statusText =
    navigating && etaMin != null
      ? t("sent.dispatched", { eta: etaMin })
      : assigned
        ? t("sent.assigned")
        : t("sent.pending");
  // No "preparing to head out" line — a medic may respond without navigating.
  const subText = navigating ? t("sent.movingToYou") : assigned ? "" : t("map.noMedic");

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
            <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--primary)" }}>{statusText}</div>
            {subText && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{subText}</div>}
          </div>
          {navigating && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--primary)", animation: "pulseDot 2s infinite" }} />}
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 420, background: "rgba(255,176,32,0.10)", border: "1px solid rgba(255,176,32,0.4)", borderRadius: 14, padding: "12px 14px", marginTop: 14, color: "var(--caution)", fontSize: 12.5, fontWeight: 600 }}>
        {t("sent.stay")}
      </div>

      {/* Add details after the alert is out (description + photos) */}
      {incidentId && (
        <div style={{ width: "100%", maxWidth: 420, marginTop: 18 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>{t("sent.addDetails")}</div>
          <textarea
            value={note}
            placeholder={t("sent.notePlaceholder")}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 13,
              background: "var(--bg-card)",
              border: "1px solid var(--border-mid)",
              color: "var(--text-primary)",
              fontSize: 14,
              fontFamily: "Manrope",
              resize: "none",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              onClick={saveNote}
              disabled={!note.trim()}
              style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid var(--border-mid)", background: "var(--bg-card)", color: "var(--text-secondary)", fontWeight: 700, fontSize: 13, opacity: note.trim() ? 1 : 0.5 }}
            >
              {noteSaved ? t("sent.noteSaved") : t("sent.saveNote")}
            </button>
            <button
              onClick={() => photoRef.current?.click()}
              style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px dashed var(--border-strong)", color: "var(--text-secondary)", fontWeight: 700, fontSize: 13 }}
            >
              📷 {t("sent.addPhoto")}{photoCount > 0 ? ` (${photoCount})` : ""}
            </button>
          </div>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={addPhoto} />
        </div>
      )}

      <div style={{ flex: 1 }} />
      <div style={{ width: "100%", maxWidth: 420, marginTop: 24 }}>
        <a href={`tel:${COMMAND_PHONE}`} style={{ textDecoration: "none" }}>
          <button className="btn-critical" style={{ width: "100%", marginBottom: 12 }}>
            📞 {t("sent.call")}
          </button>
        </a>
        <button className="btn-primary" onClick={() => navigate("/guided")}>{t("sent.guided")}</button>
        <button onClick={() => navigate("/map")} style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 16, border: "1px solid var(--border-mid)", color: "var(--text-secondary)", fontWeight: 700 }}>
          {t("sent.track")}
        </button>
      </div>
    </div>
  );
}
