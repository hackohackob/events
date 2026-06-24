import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { fetchMyIncidents, updateIncidentDetails, uploadIncidentPhoto, uploadIncidentVoice } from "../api";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { AttachmentEditor } from "../components/AttachmentEditor";
import { COMMAND_PHONE } from "../lib/config";

export function SosSent() {
  const navigate = useNavigate();
  const { t } = useT();
  const location = useLocation();
  const state = (location.state ?? {}) as { incidentId?: string; queued?: boolean };
  const incidentId = state.incidentId;

  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const voice = useVoiceRecorder();
  // The description already on the incident (medical summary + the report's
  // original note) — kept so an after-the-fact note is appended, not overwritten.
  const baseDesc = useRef<string>("");

  useEffect(() => {
    if (!incidentId) return;
    fetchMyIncidents()
      .then((list) => {
        const inc = list.find((i) => i.id === incidentId);
        if (inc?.description) baseDesc.current = inc.description;
      })
      .catch(() => undefined);
  }, [incidentId]);

  // Persist the after-the-fact note (debounced), appended to the base. Only when
  // there's actually a note — never PATCH an empty value (that would wipe the
  // medical summary already on the incident, e.g. before the base has loaded).
  useEffect(() => {
    const trimmed = note.trim();
    if (!incidentId || !trimmed) return;
    const id = setTimeout(() => {
      const description = [baseDesc.current, trimmed].filter(Boolean).join("\n");
      void updateIncidentDetails(incidentId, { description }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(id);
  }, [note, incidentId]);

  function addPhoto(file: File) {
    setPhotos((p) => [...p, file]);
    if (incidentId) void uploadIncidentPhoto(incidentId, file).catch(() => undefined);
  }

  async function toggleVoice() {
    if (voice.recording) {
      const res = await voice.stop();
      if (res) {
        setVoiceBlob(res.blob);
        if (incidentId) void uploadIncidentVoice(incidentId, res.blob, res.durationMs).catch(() => undefined);
      }
    } else {
      await voice.start().catch(() => undefined);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "linear-gradient(180deg,#08231A 0%,#0A1118 42%)", display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px 28px", overflowY: "auto" }}>
      <div style={{ position: "relative", width: 130, height: 130, display: "grid", placeItems: "center", marginBottom: 20 }}>
        <span style={{ position: "absolute", inset: 17, borderRadius: "50%", border: "2px solid #2BE3A0", animation: "ring 2.2s infinite" }} />
        <div style={{ width: 96, height: 96, borderRadius: "50%", background: "linear-gradient(135deg,#2BE3A0,#18B883)", display: "grid", placeItems: "center", fontSize: 46, color: "#fff", boxShadow: "0 0 46px rgba(43,227,160,0.5)" }}>✓</div>
      </div>
      <h1 className="archivo" style={{ fontWeight: 900, fontSize: 34, color: "#fff", margin: 0 }}>{t("sent.title")}</h1>
      <p style={{ color: "#A9F2D6", fontSize: 14, fontWeight: 700, textAlign: "center", margin: "8px 0 24px" }}>{t("sent.sub")}</p>

      <div style={{ width: "100%", maxWidth: 420, background: "rgba(255,176,32,0.10)", border: "1px solid rgba(255,176,32,0.4)", borderRadius: 14, padding: "12px 14px", color: "var(--caution)", fontSize: 12.5, fontWeight: 600 }}>
        {t("sent.stay")}
      </div>

      {/* Optional add-ons once the alert is out — note / photo / voice. */}
      {incidentId && (
        <div style={{ width: "100%", maxWidth: 420, marginTop: 18 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>{t("sent.addDetails")}</div>
          <AttachmentEditor
            note={note}
            onNoteChange={setNote}
            notePlaceholder={t("sent.notePlaceholder")}
            photos={photos}
            onAddPhoto={addPhoto}
            voice={voiceBlob}
            voiceSupported={voice.supported}
            recording={voice.recording}
            onToggleRecord={toggleVoice}
          />
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
          {t("sent.backToMap")}
        </button>
      </div>
    </div>
  );
}
