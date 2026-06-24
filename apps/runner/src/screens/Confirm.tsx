import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { ALL_CATEGORIES } from "../lib/types";
import { RunnerMap } from "../map/RunnerMap";
import { useVoiceRecorder } from "../hooks/useVoiceRecorder";
import { AttachmentEditor } from "../components/AttachmentEditor";

export function Confirm() {
  const navigate = useNavigate();
  const { draft, patchDraft, profile } = useApp();
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const voice = useVoiceRecorder();
  // Stable clamp centre: the originally captured fix, set once (not updated as
  // the pin is dragged) so the 500 m limit is measured from the real GPS point.
  const [pinOrigin, setPinOrigin] = useState<[number, number] | null>(
    draft?.fix ? [draft.fix.lng, draft.fix.lat] : null,
  );
  useEffect(() => {
    if (!pinOrigin && draft?.fix) setPinOrigin([draft.fix.lng, draft.fix.lat]);
  }, [draft?.fix, pinOrigin]);

  if (!draft) {
    navigate("/map", { replace: true });
    return null;
  }

  const def = ALL_CATEGORIES.find((c) => c.category === draft.category)!;
  const photos = draft.photos;

  async function toggleVoice() {
    if (voice.recording) {
      const res = await voice.stop();
      if (res) patchDraft({ voice: res.blob });
    } else {
      await voice.start().catch(() => undefined);
    }
  }

  return (
    <div className="screen" style={{ padding: "44px 16px 28px", maxWidth: 460, margin: "0 auto" }}>
      {/* You selected */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 11, background: def.color, display: "grid", placeItems: "center", fontSize: 20 }}>{def.glyph}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)" }}>{t("confirm.youSelected")}</div>
          <div className="archivo" style={{ fontWeight: 800, fontSize: 16 }}>{t(def.labelKey)}</div>
        </div>
        <button
          onClick={() => navigate("/report/what", { state: { forSelf: draft.forSelf, patientBib: draft.patientBib } })}
          style={{ color: "var(--text-muted)", textDecoration: "underline", fontSize: 13 }}
        >
          {t("confirm.edit")}
        </button>
      </div>

      {/* GPS thumbnail — static preview of the captured location (no accidental
          drag). Adjusting happens in a dedicated full-screen step below. */}
      <div style={{ position: "relative", height: 190, borderRadius: 16, overflow: "hidden", border: "1px solid var(--border-subtle)", marginTop: 16, background: "#0E1A28" }}>
        {draft.fix ? (
          <RunnerMap
            coords={null}
            routeColor="#2BE3A0"
            medics={[]}
            pois={[]}
            fix={null}
            editablePin={[draft.fix.lng, draft.fix.lat]}
            pinDraggable={false}
          />
        ) : null}
        {draft.fix && (
          <div style={{ position: "absolute", left: 8, bottom: 8, padding: "4px 9px", borderRadius: 999, background: "var(--bg-overlay)", fontSize: 11, fontWeight: 700 }}>
            ± {Math.round(draft.fix.accuracy)} {t("common.m")} · {profile?.selectedTrackLabel ?? ""}
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: draft.fix ? "var(--primary)" : "var(--text-muted)" }}>
        {draft.fix ? t("confirm.gpsLock") : t("confirm.gpsAcquiring")}
        {draft.fix && (
          <>
            {" ("}
            <button
              onClick={() => setAdjusting(true)}
              style={{ background: "transparent", border: "none", padding: 0, color: "var(--text-secondary)", textDecoration: "underline", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
            >
              {t("confirm.fixLocation")}
            </button>
            {")"}
          </>
        )}
      </div>

      {/* Add details — note / photo / voice */}
      <div style={{ display: "flex", justifyContent: "space-between", margin: "20px 0 10px" }}>
        <span className="section-label">{t("sent.addDetails")}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{t("confirm.helpsMedics")}</span>
      </div>
      <AttachmentEditor
        note={draft.description}
        onNoteChange={(v) => patchDraft({ description: v })}
        notePlaceholder={t("confirm.description")}
        photos={photos}
        onAddPhoto={(f) => photos.length < 3 && patchDraft({ photos: [...photos, f] })}
        onRemovePhoto={(i) => patchDraft({ photos: photos.filter((_, j) => j !== i) })}
        voice={draft.voice}
        voiceSupported={voice.supported}
        recording={voice.recording}
        onToggleRecord={toggleVoice}
        onRemoveVoice={() => patchDraft({ voice: null })}
        maxPhotos={3}
      />

      <div style={{ flex: 1 }} />

      <button className="btn-critical" style={{ marginTop: 24 }} onClick={() => setConfirming(true)}>
        📍 {t("confirm.send")}
      </button>
      <p style={{ fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.4, marginTop: 10 }}>{t("confirm.legal")}</p>

      {confirming && (
        <ConfirmDialog onCancel={() => setConfirming(false)} onConfirm={() => navigate("/sending")} />
      )}

      {adjusting && draft.fix && pinOrigin && (
        <AdjustLocation
          start={[draft.fix.lng, draft.fix.lat]}
          origin={pinOrigin}
          maxMeters={Math.round(draft.fix.accuracy) + 300}
          onMove={([lng, lat]) => draft.fix && patchDraft({ fix: { ...draft.fix, lng, lat } })}
          onDone={() => setAdjusting(false)}
        />
      )}
    </div>
  );
}

/**
 * Full-screen step for fine-tuning the incident pin. The pin starts at the
 * current location and can be dragged anywhere within (GPS accuracy + 300 m) of
 * the originally captured GPS point — the dashed circle shows the allowed area.
 */
function AdjustLocation({
  start,
  origin,
  maxMeters,
  onMove,
  onDone,
}: {
  start: [number, number];
  origin: [number, number];
  maxMeters: number;
  onMove: (lngLat: [number, number]) => void;
  onDone: () => void;
}) {
  const { t } = useT();
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-base)", zIndex: 80, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <RunnerMap
          coords={null}
          routeColor="#2BE3A0"
          medics={[]}
          pois={[]}
          fix={null}
          editablePin={start}
          pinClampCenter={origin}
          pinMaxMeters={maxMeters}
          onPinMove={onMove}
        />
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            right: 16,
            padding: "10px 14px",
            borderRadius: 14,
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-mid)",
            backdropFilter: "blur(8px)",
            textAlign: "center",
          }}
        >
          <div className="archivo" style={{ fontWeight: 800, fontSize: 15 }}>{t("confirm.fixLocation")}</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            {t("confirm.fixHint", { meters: maxMeters })}
          </div>
        </div>
      </div>
      <div style={{ padding: "12px 16px calc(16px + env(safe-area-inset-bottom))", background: "var(--bg-surface)", borderTop: "1px solid var(--border-subtle)" }}>
        <button className="btn-primary" onClick={onDone}>{t("confirm.fixDone")}</button>
      </div>
    </div>
  );
}

function ConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useT();
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,8,13,0.72)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 24, zIndex: 60 }}>
      <div style={{ background: "#141C28", borderRadius: 24, border: "1px solid rgba(255,255,255,0.10)", padding: 22, maxWidth: 360, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--critical-bg)", display: "grid", placeItems: "center", fontSize: 28, margin: "0 auto 14px" }}>⚠️</div>
        <h3 className="archivo" style={{ fontWeight: 800, fontSize: 20, margin: "0 0 8px", color: "#fff" }}>{t("confirm.dialog.title")}</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 18px" }}>{t("confirm.dialog.body")}</p>
        <button className="btn-critical" onClick={onConfirm}>{t("confirm.dialog.yes")}</button>
        <button onClick={onCancel} style={{ marginTop: 10, width: "100%", padding: 12, borderRadius: 14, border: "1px solid var(--border-mid)", color: "var(--text-secondary)", fontWeight: 700 }}>
          {t("confirm.dialog.cancel")}
        </button>
      </div>
    </div>
  );
}
