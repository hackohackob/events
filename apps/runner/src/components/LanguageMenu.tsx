import { useEffect, useRef, useState } from "react";
import { LANGUAGES, useT, type Lang } from "../i18n";

/** Language button that opens a flag list. bg/en are selectable; roadmap
 *  languages render disabled with a "soon" hint. */
export function LanguageMenu() {
  const { lang, setLang, t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderRadius: 12,
          border: "1px solid var(--border-mid)",
          background: "var(--bg-input)",
          fontSize: 13,
          fontWeight: 700,
          color: "var(--text-secondary)",
        }}
      >
        <span style={{ fontSize: 15 }}>{current.flag}</span>
        {current.code.toUpperCase()}
        <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 100,
            minWidth: 190,
            padding: 6,
            borderRadius: 14,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
          }}
        >
          <div className="section-label" style={{ padding: "6px 10px 4px" }}>
            {t("language.title")}
          </div>
          {LANGUAGES.map((l) => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                disabled={!l.ready}
                onClick={() => {
                  if (!l.ready) return;
                  setLang(l.code as Lang);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "10px 10px",
                  borderRadius: 10,
                  textAlign: "left",
                  background: active ? "var(--primary-bg)" : "transparent",
                  color: l.ready ? "var(--text-primary)" : "var(--text-muted)",
                  opacity: l.ready ? 1 : 0.55,
                  cursor: l.ready ? "pointer" : "default",
                  fontSize: 14,
                  fontWeight: active ? 800 : 600,
                }}
              >
                <span style={{ fontSize: 18 }}>{l.flag}</span>
                <span style={{ flex: 1 }}>{l.label}</span>
                {active && <span style={{ color: "var(--primary)" }}>✓</span>}
                {!l.ready && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                    {t("language.soon")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
