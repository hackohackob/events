import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { createIncident, uploadIncidentPhoto, uploadIncidentVoice } from "../api";
import { loadMedical } from "../lib/storage";
import { medicalSummary } from "../lib/types";
import { buildSosSmsHref } from "../lib/config";
import { enqueueIncident } from "../lib/offline-queue";
import type { CreateIncidentRequest } from "../api/contracts-shim";

type StepState = "pending" | "active" | "done";

export function Sending() {
  const navigate = useNavigate();
  const { draft, profile, clearDraft, refreshQueued } = useApp();
  const { t } = useT();
  const [steps, setSteps] = useState<StepState[]>(["active", "pending", "pending"]);
  const [queued, setQueued] = useState(false);
  const [smsHref, setSmsHref] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!draft) {
      navigate("/map", { replace: true });
      return;
    }

    // Prepend the medical/ICE summary so medics see it on the alert.
    const med = medicalSummary(loadMedical());
    const description = [med && `🩺 ${med}`, draft.description].filter(Boolean).join("\n") || undefined;

    const payload: CreateIncidentRequest = {
      eventId: "",
      lat: draft.fix?.lat ?? 0,
      lng: draft.fix?.lng ?? 0,
      // Omit `type` — the backend derives a readable label from the category.
      description,
      category: draft.category,
      accuracy: draft.fix?.accuracy,
      runnerName: profile?.runnerName ?? undefined,
      bibNumber: profile?.bibNumber ?? undefined,
      timestamp: draft.fix?.timestamp ?? new Date().toISOString(),
    };

    const photos = draft.photos;
    const voiceBlob = draft.voice;

    (async () => {
      setSteps(["done", "active", "pending"]);
      try {
        const incident = await createIncident(payload);
        for (const p of photos) {
          try {
            await uploadIncidentPhoto(incident.id, p);
          } catch {
            /* photo upload is best-effort */
          }
        }
        if (voiceBlob) {
          try {
            await uploadIncidentVoice(incident.id, voiceBlob);
          } catch {
            /* voice upload is best-effort */
          }
        }
        setSteps(["done", "done", "active"]);
        setTimeout(() => {
          setSteps(["done", "done", "done"]);
          clearDraft();
          navigate("/sent", { replace: true, state: { incidentId: incident.id } });
        }, 700);
      } catch {
        // Offline or server unreachable — queue for background sync AND offer an
        // SMS fallback (works on cell signal without data). Don't auto-navigate
        // so the runner can choose to text.
        await enqueueIncident(payload);
        refreshQueued();
        setQueued(true);
        setSmsHref(
          buildSosSmsHref({
            category: draft.category,
            name: profile?.runnerName ?? undefined,
            bib: profile?.bibNumber ?? undefined,
            lat: draft.fix?.lat,
            lng: draft.fix?.lng,
            medical: med || undefined,
          }),
        );
        setSteps(["done", "done", "pending"]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const labels = [t("sending.gps"), t("sending.command"), t("sending.medic")];

  return (
    <div style={{ position: "fixed", inset: 0, background: "radial-gradient(#13212E,#0A1118)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28 }}>
      <div style={{ position: "relative", width: 120, height: 120, display: "grid", placeItems: "center", marginBottom: 28 }}>
        {[0, 1].map((i) => (
          <span key={i} style={{ position: "absolute", inset: 21, borderRadius: "50%", border: "2px solid #2E9BFF", animation: `ring 2.2s ${i * 1.1}s infinite` }} />
        ))}
        <div style={{ width: 78, height: 78, borderRadius: "50%", background: "#2E9BFF", display: "grid", placeItems: "center", fontSize: 32, boxShadow: "0 0 40px rgba(46,155,255,0.6)" }}>📍</div>
      </div>
      <h1 className="archivo" style={{ fontWeight: 900, fontSize: 24, color: "#fff", margin: 0 }}>{t("sending.title")}</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 13, textAlign: "center", margin: "8px 0 24px" }}>{t("sending.body")}</p>

      <div style={{ width: "100%", maxWidth: 340, display: "flex", flexDirection: "column", gap: 12 }}>
        {labels.map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, opacity: steps[i] === "pending" ? 0.45 : 1 }}>
            <span style={{ width: 26, height: 26, display: "grid", placeItems: "center" }}>
              {steps[i] === "done" ? (
                <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--primary)", color: "#05140E", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900 }}>✓</span>
              ) : steps[i] === "active" ? (
                <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #2E9BFF", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
              ) : (
                <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2px dashed var(--border-strong)" }} />
              )}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{label}</span>
          </div>
        ))}
      </div>

      {queued && (
        <div style={{ width: "100%", maxWidth: 340, marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ color: "var(--caution)", fontWeight: 700, fontSize: 13, textAlign: "center" }}>{t("sending.queued")}</div>
          {smsHref && (
            <a href={smsHref} style={{ textDecoration: "none" }}>
              <button className="btn-critical" style={{ width: "100%" }}>💬 {t("sending.smsFallback")}</button>
            </a>
          )}
          <button
            onClick={() => {
              clearDraft();
              navigate("/sent", { replace: true, state: { queued: true } });
            }}
            style={{ width: "100%", padding: 14, borderRadius: 16, border: "1px solid var(--border-mid)", color: "var(--text-secondary)", fontWeight: 700 }}
          >
            {t("sending.continue")}
          </button>
        </div>
      )}
    </div>
  );
}
