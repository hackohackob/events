import { useApp } from "../state/AppContext";
import { useT } from "../i18n";

export function OfflineBanner() {
  const { online, queued } = useApp();
  const { t } = useT();
  if (online && queued === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        padding: "8px 14px",
        textAlign: "center",
        fontFamily: "Manrope",
        fontWeight: 700,
        fontSize: 12,
        color: "#3A2600",
        background: "var(--caution)",
      }}
    >
      {online ? t("sending.queued") : t("offline.banner")}
    </div>
  );
}
