import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { LanguageMenu } from "../components/LanguageMenu";
import { hasEventQuery, prefillFromUrl, loadMedical, saveMedical } from "../lib/storage";
import { ensureSession, refreshSession } from "../lib/session";
import { BLOOD_TYPES, hasMedicalInfo, type MedicalInfo } from "../lib/types";
import type { TrackChoice } from "../lib/types";

const EMPTY_MEDICAL: MedicalInfo = {
  bloodType: "",
  allergies: "",
  medications: "",
  conditions: "",
  emergencyName: "",
  emergencyPhone: "",
};

export function Onboarding() {
  const { profile, saveProfile, eventInfo, eventStatus, validateEvent } = useApp();
  const { t } = useT();
  const navigate = useNavigate();
  const prefill = prefillFromUrl();
  // Local dev convenience: prefill random test identity so you don't retype it.
  const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const dev = import.meta.env.DEV;
  const devName = dev ? `Test${rand(1, 100)}` : "";
  const devBib = dev ? String(rand(1000, 9999)) : "";
  const devPhone = dev ? String(rand(10000, 99999)) : "";

  // Two-step flow: the landing (event + terms + Register/SOS) and the
  // registration details (identity, track, optional medical).
  const [step, setStep] = useState<"landing" | "register">("landing");

  const [name, setName] = useState(profile?.runnerName ?? prefill.runnerName ?? devName);
  const [bib, setBib] = useState(profile?.bibNumber ?? prefill.bibNumber ?? devBib);
  const [phone, setPhone] = useState(profile?.phone ?? prefill.phone ?? devPhone);
  const [track, setTrack] = useState<TrackChoice | null>(
    profile?.selectedTrackId
      ? { id: profile.selectedTrackId, label: profile.selectedTrackLabel ?? "", color: profile.selectedTrackColor ?? "var(--primary)" }
      : null,
  );
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eventCode, setEventCode] = useState("");
  const [codeError, setCodeError] = useState(false);

  // Optional medical info, collapsed by default.
  const [medical, setMedical] = useState<MedicalInfo>(() => loadMedical() ?? EMPTY_MEDICAL);
  const [showMedical, setShowMedical] = useState(false);
  const setMed = (k: keyof MedicalInfo, v: string) => setMedical((m) => ({ ...m, [k]: v }));

  // Drop a stale selection if it isn't among this event's tracks.
  useEffect(() => {
    if (track && eventInfo && !eventInfo.tracks.some((x) => x.id === track.id)) setTrack(null);
  }, [eventInfo, track]);

  // Show the manual event-code field until an event is resolved (no QR query,
  // or a still-unresolved/invalid code).
  const needsEventInput = eventStatus !== "valid" && (!hasEventQuery() || eventStatus === "invalid");

  // Both landing actions need a valid event and agreement to the terms.
  const canProceed = agreed && eventStatus === "valid" && !busy;
  const canEnter = Boolean(track) && !busy;

  async function onEventBlur() {
    if (!eventCode.trim()) return;
    const ok = await validateEvent(eventCode);
    setCodeError(!ok);
  }

  async function enter() {
    if (!track) return;
    setBusy(true);
    const p = {
      runnerName: name || null,
      bibNumber: bib || null,
      phone: phone || null,
      selectedTrackId: track.id,
      selectedTrackLabel: track.label,
      selectedTrackColor: track.color,
    };
    try {
      await refreshSession(p);
    } catch {
      /* offline: proceed; reports will queue */
    }
    if (hasMedicalInfo(medical)) saveMedical(medical);
    saveProfile(p);
    navigate("/map");
  }

  async function sos() {
    setBusy(true);
    try {
      await ensureSession({ runnerName: name || null, bibNumber: bib || null, phone: phone || null });
    } catch {
      /* emergency path must not block */
    }
    navigate("/report/full");
  }

  return (
    <div className="screen" style={{ padding: "18px 18px 28px", maxWidth: 460, margin: "0 auto" }}>
      {/* Top row: logo + language (theme toggle removed). */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {step === "register" ? (
          <button
            onClick={() => setStep("landing")}
            aria-label="Back"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: "1px solid var(--border-mid)",
              background: "var(--bg-input)",
              color: "var(--text-primary)",
              fontSize: 18,
            }}
          >
            ←
          </button>
        ) : (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              background: "linear-gradient(135deg,var(--primary),var(--primary-dark))",
              display: "grid",
              placeItems: "center",
              fontSize: 24,
              color: "#05140E",
            }}
          >
            ✚
          </div>
        )}
        <div style={{ flex: 1 }} />
        <LanguageMenu />
      </div>

      {/* Event */}
      <div className="section-label" style={{ marginTop: 22 }}>
        {t("onboarding.event")}
      </div>
      {/* Title appears only once a code resolves; before that just the input. */}
      {eventStatus === "valid" ? (
        <div className="archivo" style={{ fontWeight: 800, fontSize: 24, marginTop: 4, lineHeight: 1.15 }}>
          {eventInfo!.title}
        </div>
      ) : eventStatus === "loading" ? (
        <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 14 }}>{t("onboarding.loadingEvent")}</div>
      ) : null}

      {step === "landing" && needsEventInput && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 48,
              padding: "0 14px",
              borderRadius: 13,
              background: "var(--bg-input)",
              border: `1px solid ${codeError ? "var(--critical)" : "var(--border-mid)"}`,
              marginTop: 10,
            }}
          >
            <span style={{ opacity: 0.7 }}>🎟️</span>
            <input
              value={eventCode}
              placeholder={t("onboarding.eventCode")}
              onChange={(e) => {
                setEventCode(e.target.value);
                setCodeError(false);
              }}
              onBlur={onEventBlur}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 15 }}
            />
          </div>
          {codeError && (
            <div style={{ color: "var(--critical)", fontSize: 12, fontWeight: 600, marginTop: 6 }}>
              {t("onboarding.eventNotFound")}
            </div>
          )}
        </>
      )}

      {step === "landing" ? (
        <>
          {/* GDPR with Terms link — gates both actions below. */}
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "26px 0 18px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 1, accentColor: "var(--primary)" }}
            />
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>
              {t("onboarding.gdprPrefix")}
              <a
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/terms");
                }}
                style={{ color: "var(--primary)", textDecoration: "underline", cursor: "pointer" }}
              >
                {t("onboarding.terms")}
              </a>
              {t("onboarding.gdprSuffix")}
            </span>
          </label>

          <button className="btn-primary" disabled={!canProceed} onClick={() => setStep("register")}>
            {t("onboarding.register")}
          </button>

          {/* Immediate SOS — prominent but visually distinct (outlined red). */}
          <button
            onClick={sos}
            disabled={!canProceed}
            style={{
              width: "100%",
              marginTop: 12,
              padding: 15,
              borderRadius: 16,
              background: "var(--critical-bg)",
              border: "1px solid var(--critical)",
              color: "var(--critical)",
              fontFamily: "Archivo",
              fontWeight: 800,
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: canProceed ? 1 : 0.45,
              pointerEvents: canProceed ? "auto" : "none",
            }}
          >
            🆘 {t("onboarding.immediateSos")}
          </button>
        </>
      ) : (
        <>
          {/* Runner details */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "20px 0 10px" }}>
            <span className="section-label">{t("onboarding.runnerDetails")}</span>
            <Pill text={t("onboarding.optional")} />
          </div>
          <Field icon="👤" placeholder={t("onboarding.name")} value={name} onChange={setName} />
          <Field icon="🏷️" placeholder={t("onboarding.bib")} value={bib} onChange={setBib} />
          <Field icon="📞" placeholder={t("onboarding.phone")} value={phone} onChange={setPhone} type="tel" />

          {/* Track selection — required to enter the course map. */}
          {(eventInfo?.tracks.length ?? 0) > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "18px 0 8px" }}>
                <span className="section-label">{t("onboarding.selectTrack")}</span>
                <Pill text={t("onboarding.required")} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(eventInfo?.tracks ?? []).map((tr) => {
                  const selected = track?.id === tr.id;
                  return (
                    <button
                      key={tr.id}
                      onClick={() => setTrack(tr)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "9px 13px",
                        borderRadius: 11,
                        background: selected ? "var(--primary-bg)" : "var(--bg-input)",
                        border: `1px solid ${selected ? "var(--primary)" : "var(--border-mid)"}`,
                        fontWeight: 700,
                        fontSize: 14,
                        color: "var(--text-primary)",
                      }}
                    >
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: tr.color }} />
                      {tr.label}
                      {selected && <span style={{ color: "var(--primary)", fontSize: 12 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Optional medical info — collapsed by default. */}
          <button
            onClick={() => setShowMedical((s) => !s)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 18,
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
            <Pill text={t("onboarding.optional")} />
            <span style={{ color: "var(--text-muted)" }}>{showMedical ? "▴" : "▾"}</span>
          </button>

          {showMedical && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {BLOOD_TYPES.filter((b) => b).map((b) => {
                  const selected = medical.bloodType === b;
                  return (
                    <button
                      key={b}
                      onClick={() => setMed("bloodType", selected ? "" : b)}
                      style={{
                        padding: "7px 12px",
                        borderRadius: 10,
                        background: selected ? "var(--primary-bg)" : "var(--bg-input)",
                        border: `1px solid ${selected ? "var(--primary)" : "var(--border-mid)"}`,
                        color: "var(--text-primary)",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {b}
                    </button>
                  );
                })}
              </div>
              <Field icon="⚠️" placeholder={t("medical.allergiesPh")} value={medical.allergies} onChange={(v) => setMed("allergies", v)} />
              <Field icon="💊" placeholder={t("medical.medicationsPh")} value={medical.medications} onChange={(v) => setMed("medications", v)} />
              <Field icon="🩹" placeholder={t("medical.conditionsPh")} value={medical.conditions} onChange={(v) => setMed("conditions", v)} />
              <Field icon="🧑" placeholder={t("medical.emergencyName")} value={medical.emergencyName} onChange={(v) => setMed("emergencyName", v)} />
              <Field icon="📞" placeholder={t("medical.emergencyPhone")} value={medical.emergencyPhone} onChange={(v) => setMed("emergencyPhone", v)} type="tel" />
            </div>
          )}

          <button className="btn-primary" style={{ marginTop: 20 }} disabled={!canEnter} onClick={enter}>
            {t("onboarding.enter")}
          </button>
        </>
      )}
    </div>
  );
}

function Pill({ text, critical }: { text: string; critical?: boolean }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: "4px 9px",
        borderRadius: 999,
        color: critical ? "var(--critical)" : "var(--text-muted)",
        background: critical ? "var(--critical-bg)" : "#172230",
        border: `1px solid ${critical ? "transparent" : "#253445"}`,
      }}
    >
      {text}
    </span>
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
        marginBottom: 8,
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
