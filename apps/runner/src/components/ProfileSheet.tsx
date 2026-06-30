import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { MedicalQuestions } from "./MedicalQuestions";
import { loadMedical, saveMedical, clearSession } from "../lib/storage";
import { refreshSession, syncParticipantProfile } from "../lib/session";
import { hasMedicalInfo, type MedicalInfo } from "../lib/types";

const EMPTY_MEDICAL: MedicalInfo = {
  bloodType: "",
  allergies: "",
  medications: "",
  conditions: "",
  emergencyName: "",
  emergencyPhone: "",
};

/**
 * Edit-your-details sheet, opened by tapping the identity chip on the map. Lets
 * the runner fix their name / bib / phone / medical info — or leave the event
 * entirely. Replaces the old standalone "Medical info" map button.
 */
export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { profile, saveProfile, eventId } = useApp();

  const [name, setName] = useState(profile?.runnerName ?? "");
  const [bib, setBib] = useState(profile?.bibNumber ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [medical, setMedical] = useState<MedicalInfo>(() => loadMedical() ?? EMPTY_MEDICAL);
  const [showMedical, setShowMedical] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);

  // Re-seed from the latest profile each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setName(profile?.runnerName ?? "");
    setBib(profile?.bibNumber ?? "");
    setPhone(profile?.phone ?? "");
    setMedical(loadMedical() ?? EMPTY_MEDICAL);
    setShowMedical(false);
    setConfirmExit(false);
  }, [open, profile]);

  if (!open) return null;

  const save = () => {
    const p = {
      runnerName: name.trim() || null,
      bibNumber: bib.trim() || null,
      phone: phone.trim() || null,
      selectedTrackId: profile?.selectedTrackId ?? null,
      selectedTrackLabel: profile?.selectedTrackLabel ?? null,
      selectedTrackColor: profile?.selectedTrackColor ?? null,
      eventId,
    };
    saveProfile(p);
    if (hasMedicalInfo(medical)) saveMedical(medical);
    void refreshSession(p).catch(() => undefined);
    void syncParticipantProfile(p, hasMedicalInfo(medical) ? medical : null);
    onClose();
  };

  const exitEvent = () => {
    clearSession();
    window.location.href = "/";
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(2,8,18,0.72)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "end center",
        padding: 12,
        paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
        animation: "dockIn 0.28s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--bg-surface)",
          borderRadius: 24,
          border: "1px solid rgba(148,163,184,0.18)",
          boxShadow: "0 -10px 60px rgba(0,0,0,0.6)",
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="section-label">{t("profile.title")}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            ✕
          </button>
        </div>

        <Field icon="👤" placeholder={t("onboarding.name")} value={name} onChange={setName} />
        <Field icon="🏷️" placeholder={t("onboarding.bib")} value={bib} onChange={setBib} />
        <Field icon="📞" placeholder={t("onboarding.phone")} value={phone} onChange={setPhone} type="tel" />

        {/* Medical info — collapsed by default. */}
        <button
          onClick={() => setShowMedical((s) => !s)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 13,
            background: "var(--bg-input)",
            border: "1px solid var(--border-mid)",
            color: "var(--text-primary)",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 16 }}>🩺</span>
          <span style={{ flex: 1, textAlign: "left" }}>
            {t("medical.button")}
            {hasMedicalInfo(medical) ? <span style={{ color: "var(--primary)" }}> · ✓</span> : null}
          </span>
          <span style={{ color: "var(--text-muted)" }}>{showMedical ? "▴" : "▾"}</span>
        </button>
        {showMedical && <MedicalQuestions value={medical} onChange={setMedical} />}

        <button className="btn-primary" style={{ marginTop: 4 }} onClick={save}>
          {t("profile.save")}
        </button>

        {/* Leave the event — two-step to avoid accidental taps. */}
        {confirmExit ? (
          <button
            onClick={exitEvent}
            style={{
              width: "100%",
              padding: 13,
              borderRadius: 16,
              background: "var(--critical-bg)",
              border: "1px solid var(--critical)",
              color: "var(--critical)",
              fontFamily: "Sofia Sans",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            {t("profile.exitConfirm")}
          </button>
        ) : (
          <button
            onClick={() => setConfirmExit(true)}
            style={{ width: "100%", padding: 10, color: "var(--critical)", fontWeight: 700, fontSize: 13.5 }}
          >
            {t("profile.exit")}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  icon,
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  icon: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 48,
        padding: "0 14px",
        borderRadius: 13,
        background: "var(--bg-input)",
        border: "1px solid var(--border-mid)",
      }}
    >
      <span style={{ fontSize: 16, opacity: 0.7 }}>{icon}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 15 }}
      />
    </div>
  );
}
