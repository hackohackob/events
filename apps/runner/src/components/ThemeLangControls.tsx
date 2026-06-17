import { useTheme } from "../theme";
import { useT } from "../i18n";

/** Small theme + language toggles, used on the onboarding header. */
export function ThemeLangControls() {
  const { resolved, toggle } = useTheme();
  const { lang, setLang } = useT();

  const chip: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid var(--border-mid)",
    background: "var(--bg-input)",
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-secondary)",
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button style={chip} onClick={() => setLang(lang === "bg" ? "en" : "bg")}>
        {lang === "bg" ? "БГ" : "EN"}
      </button>
      <button style={chip} onClick={toggle} aria-label="Toggle theme">
        {resolved === "light" ? "☀️" : "🌙"}
      </button>
    </div>
  );
}
