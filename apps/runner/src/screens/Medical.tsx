import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { BLOOD_TYPES, type MedicalInfo } from "../lib/types";
import { loadMedical, saveMedical } from "../lib/storage";

const EMPTY: MedicalInfo = {
  bloodType: "",
  allergies: "",
  medications: "",
  conditions: "",
  emergencyName: "",
  emergencyPhone: "",
};

export function Medical() {
  const navigate = useNavigate();
  const { t } = useT();
  const [info, setInfo] = useState<MedicalInfo>(() => loadMedical() ?? EMPTY);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof MedicalInfo, v: string) => {
    setInfo((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  function save() {
    saveMedical(info);
    setSaved(true);
    setTimeout(() => navigate(-1), 600);
  }

  return (
    <div className="screen" style={{ padding: "44px 18px 28px", maxWidth: 460, margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 14 }}>
        {t("medical.back")}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: "var(--critical-bg)", display: "grid", placeItems: "center", fontSize: 22 }}>🩺</div>
        <h1 className="archivo" style={{ fontWeight: 800, fontSize: 23, margin: 0 }}>{t("medical.title")}</h1>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "8px 0 18px", lineHeight: 1.4 }}>{t("medical.subtitle")}</p>

      {/* Blood type chips */}
      <div className="section-label" style={{ marginBottom: 8 }}>{t("medical.bloodType")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {BLOOD_TYPES.filter((b) => b).map((b) => {
          const sel = info.bloodType === b;
          return (
            <button
              key={b}
              onClick={() => set("bloodType", sel ? "" : b)}
              style={{
                minWidth: 54,
                padding: "9px 0",
                borderRadius: 11,
                fontWeight: 800,
                fontSize: 14,
                background: sel ? "var(--critical-bg)" : "var(--bg-input)",
                border: `1px solid ${sel ? "var(--critical)" : "var(--border-mid)"}`,
                color: sel ? "var(--critical)" : "var(--text-primary)",
              }}
            >
              {b}
            </button>
          );
        })}
      </div>

      <Field label={t("medical.allergies")} ph={t("medical.allergiesPh")} value={info.allergies} onChange={(v) => set("allergies", v)} />
      <Field label={t("medical.medications")} ph={t("medical.medicationsPh")} value={info.medications} onChange={(v) => set("medications", v)} />
      <Field label={t("medical.conditions")} ph={t("medical.conditionsPh")} value={info.conditions} onChange={(v) => set("conditions", v)} />
      <Field label={t("medical.emergencyName")} ph="" value={info.emergencyName} onChange={(v) => set("emergencyName", v)} />
      <Field label={t("medical.emergencyPhone")} ph="" value={info.emergencyPhone} onChange={(v) => set("emergencyPhone", v)} type="tel" />

      <button className="btn-primary" style={{ marginTop: 18 }} onClick={save}>
        {saved ? t("medical.saved") : t("medical.save")}
      </button>
    </div>
  );
}

function Field({
  label,
  ph,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  ph: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="section-label" style={{ marginBottom: 6 }}>{label}</div>
      <input
        type={type}
        value={value}
        placeholder={ph}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 48,
          padding: "0 14px",
          borderRadius: 13,
          background: "var(--bg-input)",
          border: "1px solid var(--border-mid)",
          color: "var(--text-primary)",
          fontSize: 15,
          outline: "none",
        }}
      />
    </div>
  );
}
