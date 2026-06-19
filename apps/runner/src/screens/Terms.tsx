import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";

export function Terms() {
  const navigate = useNavigate();
  const { t } = useT();
  return (
    <div className="screen" style={{ padding: "44px 18px 28px", maxWidth: 460, margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 14 }}>
        {t("terms.back")}
      </button>
      <h1 className="archivo" style={{ fontWeight: 800, fontSize: 24, margin: "16px 0 14px" }}>
        {t("terms.title")}
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>{t("terms.body")}</p>
    </div>
  );
}
