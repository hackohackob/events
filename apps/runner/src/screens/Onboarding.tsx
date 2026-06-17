import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { TRACK_OPTIONS, type TrackKey } from "../lib/types";
import { prefillFromUrl } from "../lib/storage";
import { ensureSession, refreshSession } from "../lib/session";
import { ThemeLangControls } from "../components/ThemeLangControls";

export function Onboarding() {
  const { profile, saveProfile } = useApp();
  const { t } = useT();
  const navigate = useNavigate();
  const prefill = prefillFromUrl();

  const [name, setName] = useState(profile?.runnerName ?? prefill.runnerName ?? "");
  const [bib, setBib] = useState(profile?.bibNumber ?? prefill.bibNumber ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? prefill.phone ?? "");
  const [track, setTrack] = useState<TrackKey | null>(profile?.selectedTrack ?? null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const canEnter = Boolean(track) && agreed && !busy;

  async function enter() {
    if (!track) return;
    setBusy(true);
    const p = { runnerName: name || null, bibNumber: bib || null, phone: phone || null, selectedTrack: track };
    try {
      await refreshSession(p);
    } catch {
      /* offline: proceed with cached/absent token; reports will queue */
    }
    saveProfile(p);
    navigate("/map");
  }

  async function skip() {
    try {
      await ensureSession({ runnerName: name || null, bibNumber: bib || null, phone: phone || null });
    } catch {
      /* ignore — emergency path must not block */
    }
    navigate("/report/full");
  }

  return (
    <div className="screen" style={{ padding: "20px 18px 28px", maxWidth: 460, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ThemeLangControls />
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 15,
            background: "linear-gradient(135deg,var(--primary),var(--primary-dark))",
            display: "grid",
            placeItems: "center",
            fontSize: 26,
          }}
        >
          ✚
        </div>
      </div>
      <div
        className="section-label"
        style={{ color: "var(--primary)", letterSpacing: "0.18em", marginTop: 14 }}
      >
        {t("brand")}
      </div>
      <h1 className="archivo" style={{ fontWeight: 800, fontSize: 25, margin: "6px 0 4px" }}>
        {t("onboarding.title")}
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>{t("onboarding.subtitle")}</p>

      {/* Runner details */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 10px" }}>
        <span className="section-label">{t("onboarding.runnerDetails")}</span>
        <Pill text={t("onboarding.optional")} />
      </div>
      <Field icon="👤" placeholder={t("onboarding.name")} value={name} onChange={setName} />
      <Field icon="🏷️" placeholder={t("onboarding.bib")} value={bib} onChange={setBib} />
      <Field icon="📞" placeholder={t("onboarding.phone")} value={phone} onChange={setPhone} type="tel" />

      {/* Track selection */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 10px" }}>
        <span className="section-label">{t("onboarding.selectTrack")}</span>
        <Pill text={t("onboarding.required")} critical />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
        {TRACK_OPTIONS.map((o) => {
          const selected = track === o.key;
          return (
            <button
              key={o.key}
              onClick={() => setTrack(o.key)}
              style={{
                position: "relative",
                textAlign: "left",
                padding: "12px 13px",
                borderRadius: 15,
                background: selected ? "var(--primary-bg)" : "var(--bg-input)",
                border: `1px solid ${selected ? "var(--primary)" : "var(--border-mid)"}`,
                boxShadow: selected ? "0 0 0 4px rgba(43,227,160,0.10)" : "none",
              }}
            >
              {selected && (
                <span
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "var(--primary)",
                    color: "#05140E",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  ✓
                </span>
              )}
              <div style={{ width: 24, height: 5, borderRadius: 3, background: o.color }} />
              <div className="archivo" style={{ fontWeight: 900, fontSize: 21, marginTop: 10 }}>
                {o.key}
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-muted)" }}>
                {t(o.subKey)}
              </div>
            </button>
          );
        })}
      </div>

      {/* GDPR */}
      <label
        style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "20px 0", cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ width: 20, height: 20, marginTop: 1, accentColor: "var(--primary)" }}
        />
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4 }}>
          {t("onboarding.gdpr")}
        </span>
      </label>

      <button className="btn-primary" disabled={!canEnter} onClick={enter}>
        {t("onboarding.enter")}
      </button>
      <button
        onClick={skip}
        style={{ marginTop: 14, fontFamily: "Manrope", fontWeight: 700, fontSize: 13.5, color: "#FF6B73" }}
      >
        {t("onboarding.skip")}
      </button>
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
        height: 52,
        padding: "0 14px",
        borderRadius: 13,
        background: "var(--bg-input)",
        border: "1px solid var(--border-mid)",
        marginBottom: 9,
      }}
    >
      <span style={{ fontSize: 16, opacity: 0.7 }}>{icon}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text-primary)",
          fontSize: 15,
        }}
      />
    </div>
  );
}
