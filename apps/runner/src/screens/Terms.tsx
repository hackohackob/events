import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { getTermsDoc, type TermsSection } from "./terms-content";

/** Render a string with **bold** spans into React nodes. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function Terms() {
  const navigate = useNavigate();
  const { t, lang } = useT();
  const doc = getTermsDoc(lang);

  return (
    <div className="screen" style={{ padding: "44px 18px 40px", maxWidth: 560, margin: "0 auto" }}>
      <button onClick={() => navigate(-1)} style={{ color: "var(--primary)", fontWeight: 700, fontSize: 14 }}>
        {t("terms.back")}
      </button>

      <h1 className="archivo" style={{ fontWeight: 800, fontSize: 24, margin: "16px 0 4px" }}>
        {doc.title}
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: 12.5, margin: "0 0 18px" }}>{doc.lastUpdated}</p>

      <p style={lead}>{renderInline(doc.intro)}</p>

      <Banner>{renderInline(doc.banner)}</Banner>

      {doc.sections.map((section) => (
        <Section key={section.title} section={section} />
      ))}

      <p style={{ ...para, color: "var(--text-muted)", fontSize: 12.5, marginTop: 22 }}>
        {renderInline(doc.closing)}
      </p>
    </div>
  );
}

const lead: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 14,
  lineHeight: 1.65,
  margin: "0 0 6px",
};
const para: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 13.5,
  lineHeight: 1.65,
  margin: "0 0 10px",
};
const ul: React.CSSProperties = { margin: "0 0 10px", paddingLeft: 18 };
const li: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 13.5,
  lineHeight: 1.6,
  marginBottom: 4,
};

function Section({ section }: { section: TermsSection }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2 className="archivo" style={{ fontWeight: 800, fontSize: 16, margin: "0 0 8px" }}>
        {section.title}
      </h2>
      {section.paragraphs.map((p, i) => (
        <p key={i} style={para}>
          {renderInline(p)}
        </p>
      ))}
      {section.bullets && (
        <ul style={ul}>
          {section.bullets.map((b, i) => (
            <li key={i} style={li}>
              {renderInline(b)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: 4,
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(245, 158, 11, 0.12)",
        border: "1px solid rgba(245, 158, 11, 0.4)",
        color: "var(--text-primary)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}
