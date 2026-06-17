import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { fetchGuidance, fetchMyIncidents } from "../api";
import type { AbcStep, IncidentCategory } from "../api/contracts-shim";

const STATIC: Record<AbcStep, string> = {
  A: "Tilt the head back gently & lift the chin. Check the mouth is clear.",
  B: "Look, listen, feel for breathing. If none, prepare to give rescue breaths.",
  C: "Press firmly on centre of chest — hard and fast, 100–120 bpm. Don't stop.",
};
const ORDER: AbcStep[] = ["A", "B", "C"];

// Minimal typing for the optional Web Speech API.
type SpeechRec = { start(): void; stop(): void; onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; continuous: boolean; interimResults: boolean; lang: string };

export function GuidedCare() {
  const navigate = useNavigate();
  const { t, lang } = useT();
  const [step, setStep] = useState<AbcStep>("A");
  const [instruction, setInstruction] = useState(STATIC.A);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [category, setCategory] = useState<IncidentCategory | undefined>();
  const recRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    fetchMyIncidents()
      .then((list) => list[0]?.category && setCategory(list[0].category as IncidentCategory))
      .catch(() => undefined);
  }, []);

  function applyTranscript(text: string) {
    setTranscript(text);
    fetchGuidance({ transcript: text, category })
      .then((g) => {
        setStep(g.currentStep);
        setInstruction(g.instruction);
      })
      .catch(() => undefined);
  }

  function toggleListen() {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec });
    const Ctor = SR.SpeechRecognition || SR.webkitSpeechRecognition;
    if (!Ctor) {
      // No speech API — advance through steps manually.
      nextStep();
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = lang === "bg" ? "bg-BG" : "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = e.results[e.results.length - 1][0].transcript;
      applyTranscript(text);
      setListening(false);
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  function nextStep() {
    const idx = ORDER.indexOf(step);
    const next = ORDER[Math.min(ORDER.length - 1, idx + 1)];
    setStep(next);
    setInstruction(STATIC[next]);
  }

  const stepNum = ORDER.indexOf(step) + 1;

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-base)", display: "flex", flexDirection: "column", padding: "44px 18px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: "rgba(43,227,160,0.12)", border: "1px solid rgba(43,227,160,0.35)", fontSize: 11, fontWeight: 800, color: "var(--primary)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--primary)", animation: "pulseDot 2s infinite" }} />
          {t("guided.enRoute", { eta: 6 })}
        </span>
        <button onClick={() => navigate("/map")} style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("guided.title")}</button>
      </div>

      {/* Voice orb */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 24 }}>
        <button onClick={toggleListen} style={{ position: "relative", width: 90, height: 90, display: "grid", placeItems: "center" }}>
          {listening && [0, 1].map((i) => (
            <span key={i} style={{ position: "absolute", inset: 12, borderRadius: "50%", border: "2px solid #2BE3A0", animation: `ring 2.2s ${i * 1.1}s infinite` }} />
          ))}
          <span style={{ width: 66, height: 66, borderRadius: "50%", background: "linear-gradient(135deg,#2BE3A0,#18B883)", display: "grid", placeItems: "center", fontSize: 28, color: "#05140E" }}>🎤</span>
        </button>
        <div style={{ display: "flex", gap: 4, marginTop: 12, height: 22, alignItems: "center" }}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span key={i} style={{ width: 4, height: 18, borderRadius: 2, background: "#2BE3A0", transformOrigin: "center", animation: listening ? `wave 0.8s ${i * 0.1}s infinite` : "none", opacity: listening ? 1 : 0.3 }} />
          ))}
        </div>
        <p style={{ fontStyle: "italic", color: "var(--text-secondary)", fontSize: 13, marginTop: 12, textAlign: "center", minHeight: 18 }}>
          {transcript ? `"${transcript}"` : t(listening ? "guided.listen" : "guided.tapToSpeak")}
        </p>
      </div>

      {/* ABC progress */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
        <span className="section-label">{t("guided.abc", { n: stepNum })}</span>
        <div style={{ display: "flex", gap: 5 }}>
          {ORDER.map((s) => (
            <span key={s} style={{ width: 18, height: 4, borderRadius: 2, background: ORDER.indexOf(s) <= ORDER.indexOf(step) ? "var(--primary)" : "var(--border-strong)" }} />
          ))}
        </div>
      </div>

      {/* Current step card */}
      <div style={{ background: "rgba(43,227,160,0.07)", border: "1.5px solid rgba(43,227,160,0.40)", borderRadius: 16, padding: 16, marginTop: 12, display: "flex", gap: 14 }}>
        <div style={{ width: 62, height: 62, borderRadius: 13, background: "#0A1118", display: "grid", placeItems: "center", fontSize: 30 }}>
          {step === "A" ? "🫁" : step === "B" ? "💨" : "❤️"}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, background: "var(--primary)", color: "#05140E", display: "grid", placeItems: "center", fontFamily: "Archivo", fontWeight: 900, fontSize: 14 }}>{step}</span>
            <span className="archivo" style={{ fontWeight: 800, fontSize: 15 }}>{t(`guided.${step}`)}</span>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: 12.5, lineHeight: 1.4, marginTop: 8 }}>{instruction}</p>
        </div>
      </div>

      <div style={{ flex: 1 }} />
      <button className="btn-primary" onClick={nextStep}>
        {t("guided.next", { name: t(`guided.${ORDER[Math.min(2, stepNum)]}`) })}
      </button>
    </div>
  );
}
