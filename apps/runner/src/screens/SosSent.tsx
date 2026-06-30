import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { sendIncidentMessage, uploadIncidentPhoto, uploadIncidentVoice } from "../api";
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
  const [noteSending, setNoteSending] = useState(false);
  const voice = useVoiceRecorder();

  // Confirmation toast — shown when a note / photo / voice note has been sent to
  // the team, then fades out on its own after a few seconds.
  const [toast, setToast] = useState<string | null>(null);
  const [toastShown, setToastShown] = useState(false);
  const toastTimers = useRef<number[]>([]);

  function showToast(text: string) {
    toastTimers.current.forEach((id) => clearTimeout(id));
    toastTimers.current = [];
    setToast(text);
    requestAnimationFrame(() => setToastShown(true));
    toastTimers.current.push(
      window.setTimeout(() => setToastShown(false), 5000),
      window.setTimeout(() => setToast(null), 5400),
    );
  }

  useEffect(() => () => toastTimers.current.forEach((id) => clearTimeout(id)), []);

  // Send an after-the-fact note to the incident chat (event log). Explicit —
  // the runner taps Send, so they get a clear confirmation it went through.
  async function sendNote() {
    const trimmed = note.trim();
    if (!incidentId || !trimmed || noteSending) return;
    setNoteSending(true);
    try {
      await sendIncidentMessage(incidentId, trimmed);
      setNote("");
      showToast(t("sent.noteSent"));
    } catch {
      showToast(t("sent.sendFailed"));
    } finally {
      setNoteSending(false);
    }
  }

  function addPhoto(file: File) {
    setPhotos((p) => [...p, file]);
    if (!incidentId) return;
    // postToChat: also drop the photo into the incident chat (event log), not
    // just the gallery, so the team sees it appear in the timeline.
    uploadIncidentPhoto(incidentId, file, { postToChat: true })
      .then(() => showToast(t("sent.photoSent")))
      .catch(() => showToast(t("sent.sendFailed")));
  }

  async function toggleVoice() {
    if (voice.recording) {
      const res = await voice.stop();
      if (res) {
        setVoiceBlob(res.blob);
        if (incidentId) {
          uploadIncidentVoice(incidentId, res.blob, res.durationMs)
            .then(() => showToast(t("sent.voiceSent")))
            .catch(() => showToast(t("sent.sendFailed")));
        }
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

      {/* Optional add-ons once the alert is out — note / photo / voice. Each is
          dispatched to the response team and confirmed with a toast. */}
      {incidentId && (
        <div style={{ width: "100%", maxWidth: 420, marginTop: 18 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>{t("sent.addDetails")}</div>
          <AttachmentEditor
            note={note}
            onNoteChange={setNote}
            notePlaceholder={t("sent.notePlaceholder")}
            onSendNote={sendNote}
            sendNoteLabel={t("sent.sendNote")}
            noteSending={noteSending}
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

      {/* Sent-confirmation toast — fades out after ~5s. */}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(24px + env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            maxWidth: "calc(100% - 32px)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 18px",
            borderRadius: 14,
            background: "rgba(24,184,131,0.95)",
            color: "#04140E",
            fontWeight: 800,
            fontSize: 13.5,
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
            opacity: toastShown ? 1 : 0,
            transition: "opacity 0.4s ease",
            zIndex: 90,
            pointerEvents: "none",
          }}
        >
          <span style={{ fontSize: 16 }}>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
