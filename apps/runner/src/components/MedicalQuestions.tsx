import { useState } from "react";
import { useT } from "../i18n";
import { BLOOD_TYPES, type MedicalInfo } from "../lib/types";

/**
 * Clean question-first medical form. Each item is a simple Yes/No question; only
 * when the runner taps "Yes" does a free-text field appear. Blood type is a
 * dropdown and comes last. Shared by the standalone Medical screen and the
 * onboarding medical section so both stay in sync.
 */
export function MedicalQuestions({
  value,
  onChange,
}: {
  value: MedicalInfo;
  onChange: (next: MedicalInfo) => void;
}) {
  const { t } = useT();
  const set = (k: keyof MedicalInfo, v: string) => onChange({ ...value, [k]: v });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Question
        question={t("medical.qAllergies")}
        placeholder={t("medical.allergiesPh")}
        text={value.allergies}
        none={!!value.noAllergies}
        onChange={({ text, none }) => onChange({ ...value, allergies: text, noAllergies: none })}
      />
      <Question
        question={t("medical.qConditions")}
        placeholder={t("medical.conditionsPh")}
        text={value.conditions}
        none={!!value.noConditions}
        onChange={({ text, none }) => onChange({ ...value, conditions: text, noConditions: none })}
      />
      <Question
        question={t("medical.qMedications")}
        placeholder={t("medical.medicationsPh")}
        text={value.medications}
        none={!!value.noMedications}
        onChange={({ text, none }) => onChange({ ...value, medications: text, noMedications: none })}
      />

      {/* Blood type — dropdown, last. */}
      <div style={{ ...cardStyle, gap: 12 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>
          {t("medical.bloodType")}
        </span>
        <select
          value={value.bloodType}
          onChange={(e) => set("bloodType", e.target.value)}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            height: 40,
            minWidth: 110,
            padding: "0 30px 0 14px",
            borderRadius: 12,
            background:
              "var(--bg-input) url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' stroke='%2394a3b8' stroke-width='2' fill='none' stroke-linecap='round'/></svg>\") no-repeat right 12px center",
            border: "1px solid var(--border-mid)",
            color: value.bloodType ? "var(--text-primary)" : "var(--text-muted)",
            fontSize: 15,
            fontWeight: 700,
            outline: "none",
          }}
        >
          <option value="">{t("medical.bloodUnknown")}</option>
          {BLOOD_TYPES.filter((b) => b).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "14px 16px",
  borderRadius: 16,
  background: "var(--bg-input)",
  border: "1px solid var(--border-mid)",
};

type Answer = "yes" | "no" | null;

function Question({
  question,
  placeholder,
  text,
  none,
  onChange,
}: {
  question: string;
  placeholder: string;
  text: string;
  none: boolean;
  onChange: (next: { text: string; none: boolean }) => void;
}) {
  const { t } = useT();
  // Nothing is preselected: the answer is null until the runner taps Yes/No.
  // A filled field implies Yes; an explicit "No" sets the `none` flag.
  const [answer, setAnswer] = useState<Answer>(text.trim() ? "yes" : none ? "no" : null);
  const showInput = answer === "yes";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={cardStyle}>
        <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.3 }}>
          {question}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {/* "No" is the reassuring answer (green); "Yes" flags something for the
              medics to note (red). */}
          <Toggle label={t("common.no")} active={answer === "no"} tone="good" onClick={() => { setAnswer("no"); onChange({ text: "", none: true }); }} />
          <Toggle label={t("common.yes")} active={answer === "yes"} tone="bad" onClick={() => { setAnswer("yes"); onChange({ text, none: false }); }} />
        </div>
      </div>
      {showInput && (
        <input
          autoFocus={text.trim() === ""}
          value={text}
          placeholder={placeholder}
          onChange={(e) => onChange({ text: e.target.value, none: false })}
          style={{
            height: 48,
            // Indented so the free-text answer reads as a child of the question.
            marginLeft: 14,
            padding: "0 14px",
            borderRadius: 13,
            background: "var(--bg-input)",
            border: "1px solid var(--border-mid)",
            color: "var(--text-primary)",
            fontSize: 15,
            outline: "none",
          }}
        />
      )}
    </div>
  );
}

function Toggle({ label, active, tone, onClick }: { label: string; active: boolean; tone: "good" | "bad"; onClick: () => void }) {
  const color = tone === "good" ? "var(--primary)" : "var(--critical)";
  return (
    <button
      onClick={onClick}
      style={{
        minWidth: 52,
        padding: "8px 0",
        borderRadius: 10,
        fontWeight: 800,
        fontSize: 13,
        background: active ? (tone === "good" ? "var(--primary-bg)" : "var(--critical-bg)") : "transparent",
        border: `1px solid ${active ? color : "var(--border-mid)"}`,
        color: active ? color : "var(--text-muted)",
      }}
    >
      {label}
    </button>
  );
}
