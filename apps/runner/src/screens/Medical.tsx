import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import type { MedicalInfo } from "../lib/types";
import { loadMedical, saveMedical } from "../lib/storage";
import { MedicalQuestions } from "../components/MedicalQuestions";

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
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "8px 0 20px", lineHeight: 1.4 }}>{t("medical.subtitle")}</p>

      <MedicalQuestions value={info} onChange={(next) => { setInfo(next); setSaved(false); }} />

      <button className="btn-primary" style={{ marginTop: 22 }} onClick={save}>
        {saved ? t("medical.saved") : t("medical.save")}
      </button>
    </div>
  );
}
