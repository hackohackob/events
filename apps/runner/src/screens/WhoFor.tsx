import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { useApp } from "../state/AppContext";

/**
 * Step 1 of the incident flow — "Who is it for?". The runner picks Me or Someone
 * else; choosing someone else reveals an optional BIB field so medics can pull
 * the patient up. The choice is carried forward to the category step via router
 * state and ends up on the incident's notes.
 *
 * The "Immediate SOS" button on the onboarding landing screen reaches this
 * same route without ever saving a local profile — there's no registered
 * identity yet, so "is this for you or someone else" doesn't make sense (we
 * don't reliably know who's reporting). In that case, skip the choice
 * entirely and just take an optional BIB + the reporter's own phone.
 */
export function WhoFor() {
  const navigate = useNavigate();
  const { t } = useT();
  const { profile } = useApp();
  const [forSelf, setForSelf] = useState<boolean | null>(null);
  const [bib, setBib] = useState("");
  const [phone, setPhone] = useState("");

  const unregistered = !profile;

  const choose = (self: boolean) => {
    setForSelf(self);
    if (self) {
      // For yourself there's nothing else to ask — go straight to "what".
      next(true, null);
    }
  };

  const next = (self: boolean, patientBib: string | null, reporterPhone: string | null = null) =>
    navigate("/report/what", { state: { forSelf: self, patientBib, reporterPhone } });

  if (unregistered) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "linear-gradient(180deg,#1A0E12,#0C0809)",
          display: "flex",
          flexDirection: "column",
          padding: "44px 16px 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--critical)", animation: "pulseDot 2s infinite" }} />
            <span className="archivo" style={{ fontWeight: 900, fontSize: 18, color: "#fff", letterSpacing: "0.02em" }}>
              {t("map.report")}
            </span>
          </div>
          <button onClick={() => navigate("/onboarding")} style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 18 }}>
            ✕
          </button>
        </div>

        <h1 className="archivo" style={{ fontWeight: 900, fontSize: 26, color: "#fff", margin: "26px 0 6px" }}>
          {t("who.immediateTitle")}
        </h1>
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, margin: "0 0 24px" }}>{t("who.immediateSubtitle")}</p>

        <div className="section-label" style={{ color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>
          {t("who.bibLabel")}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 54,
            padding: "0 16px",
            borderRadius: 16,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          <span style={{ opacity: 0.7 }}>🏷️</span>
          <input
            value={bib}
            inputMode="numeric"
            placeholder={t("who.bibPlaceholder")}
            onChange={(e) => setBib(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 16, fontWeight: 700 }}
          />
        </div>

        <div className="section-label" style={{ color: "rgba(255,255,255,0.55)", margin: "18px 0 8px" }}>
          {t("who.phoneLabel")}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: 54,
            padding: "0 16px",
            borderRadius: 16,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          <span style={{ opacity: 0.7 }}>📞</span>
          <input
            value={phone}
            inputMode="tel"
            placeholder={t("who.phonePlaceholder")}
            onChange={(e) => setPhone(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 16, fontWeight: 700 }}
          />
        </div>

        <div style={{ flex: 1 }} />

        <button
          className="btn-critical"
          onClick={() => next(false, bib.trim() || null, phone.trim() || null)}
        >
          {t("who.continue")} →
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "linear-gradient(180deg,#1A0E12,#0C0809)",
        display: "flex",
        flexDirection: "column",
        padding: "44px 16px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--critical)", animation: "pulseDot 2s infinite" }} />
          <span className="archivo" style={{ fontWeight: 900, fontSize: 18, color: "#fff", letterSpacing: "0.02em" }}>
            {t("map.report")}
          </span>
        </div>
        <button onClick={() => navigate("/map")} style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 18 }}>
          ✕
        </button>
      </div>

      <h1 className="archivo" style={{ fontWeight: 900, fontSize: 26, color: "#fff", margin: "26px 0 6px" }}>
        {t("who.title")}
      </h1>
      <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, margin: "0 0 24px" }}>{t("who.subtitle")}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Choice
          glyph="🙋"
          label={t("who.me")}
          sub={t("who.meSub")}
          selected={forSelf === true}
          onClick={() => choose(true)}
        />
        <Choice
          glyph="🤝"
          label={t("who.else")}
          sub={t("who.elseSub")}
          selected={forSelf === false}
          onClick={() => setForSelf(false)}
        />
      </div>

      {forSelf === false && (
        <div style={{ marginTop: 22 }}>
          <div className="section-label" style={{ color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>
            {t("who.bibLabel")}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 54,
              padding: "0 16px",
              borderRadius: 16,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            <span style={{ opacity: 0.7 }}>🏷️</span>
            <input
              value={bib}
              inputMode="numeric"
              placeholder={t("who.bibPlaceholder")}
              onChange={(e) => setBib(e.target.value)}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 16, fontWeight: 700 }}
            />
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {forSelf === false && (
        <button
          className="btn-critical"
          onClick={() => next(false, bib.trim() || null)}
          style={{ marginTop: 16 }}
        >
          {t("who.continue")} →
        </button>
      )}
    </div>
  );
}

function Choice({
  glyph,
  label,
  sub,
  selected,
  onClick,
}: {
  glyph: string;
  label: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "18px 18px",
        borderRadius: 20,
        background: selected ? "rgba(230,57,70,0.16)" : "rgba(255,255,255,0.05)",
        border: `1.5px solid ${selected ? "var(--critical)" : "rgba(255,255,255,0.12)"}`,
        textAlign: "left",
      }}
    >
      <span style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,255,255,0.1)", display: "grid", placeItems: "center", fontSize: 26 }}>
        {glyph}
      </span>
      <div style={{ flex: 1 }}>
        <div className="archivo" style={{ fontWeight: 800, fontSize: 18, color: "#fff" }}>{label}</div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{ fontSize: 20, color: selected ? "var(--critical)" : "rgba(255,255,255,0.4)" }}>
        {selected ? "●" : "○"}
      </span>
    </button>
  );
}
