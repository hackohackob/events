import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { useT } from "../i18n";
import { ALL_CATEGORIES } from "../lib/types";
import { RunnerMap } from "../map/RunnerMap";

export function Confirm() {
  const navigate = useNavigate();
  const { draft, setDraftPhotos, profile } = useApp();
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  if (!draft) {
    navigate("/map", { replace: true });
    return null;
  }

  const def = ALL_CATEGORIES.find((c) => c.category === draft.category)!;
  const photos = draft.photos;

  function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && photos.length < 3) setDraftPhotos([...photos, file]);
    e.target.value = "";
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
        <button onClick={() => navigate("/report")} style={{ color: "var(--text-muted)", textDecoration: "underline", fontSize: 13 }}>
          {t("confirm.edit")}
        </button>
      </div>

      {/* GPS thumbnail */}
      <div style={{ position: "relative", height: 112, borderRadius: 16, overflow: "hidden", border: "1px solid var(--border-subtle)", marginTop: 16, background: "#0E1A28" }}>
        {draft.fix ? (
          <RunnerMap coords={null} routeColor="#2BE3A0" medics={[]} pois={[]} fix={draft.fix} interactive={false} />
        ) : null}
        {draft.fix && (
          <div style={{ position: "absolute", left: 8, bottom: 8, padding: "4px 9px", borderRadius: 999, background: "var(--bg-overlay)", fontSize: 11, fontWeight: 700 }}>
            ± {Math.round(draft.fix.accuracy)} {t("common.m")} · {profile?.selectedTrack ?? ""}
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 700, color: draft.fix ? "var(--primary)" : "var(--text-muted)" }}>
        {draft.fix ? t("confirm.gpsLock") : t("confirm.gpsAcquiring")}
      </div>

      {/* Photos */}
      <div style={{ display: "flex", justifyContent: "space-between", margin: "20px 0 10px" }}>
        <span className="section-label">{t("confirm.addPhoto")}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{t("confirm.helpsMedics")}</span>
      </div>
      <div style={{ display: "flex", gap: 9 }}>
        {photos.map((p, i) => (
          <div key={i} style={{ position: "relative", width: 60, height: 60, borderRadius: 13, overflow: "hidden", border: "1px solid var(--border-mid)" }}>
            <img src={URL.createObjectURL(p)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button
              onClick={() => setDraftPhotos(photos.filter((_, j) => j !== i))}
              style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11 }}
            >
              ✕
            </button>
          </div>
        ))}
        {photos.length < 3 && (
          <>
            <PhotoButton dashed label={t("confirm.camera")} glyph="📷" onClick={() => cameraRef.current?.click()} />
            <PhotoButton label={t("confirm.library")} glyph="🖼️" onClick={() => libraryRef.current?.click()} />
          </>
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={addPhoto} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={addPhoto} />

      <div style={{ flex: 1 }} />

      <button className="btn-critical" style={{ marginTop: 24 }} onClick={() => setConfirming(true)}>
        📍 {t("confirm.send")}
      </button>
      <p style={{ fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.4, marginTop: 10 }}>{t("confirm.legal")}</p>

      {confirming && (
        <ConfirmDialog onCancel={() => setConfirming(false)} onConfirm={() => navigate("/sending")} />
      )}
    </div>
  );
}

function PhotoButton({ label, glyph, dashed, onClick }: { label: string; glyph: string; dashed?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 60,
        height: 60,
        borderRadius: 13,
        border: `1px ${dashed ? "dashed" : "solid"} ${dashed ? "var(--border-strong)" : "var(--border-mid)"}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        fontSize: 16,
        color: "var(--text-secondary)",
      }}
    >
      {glyph}
      <span style={{ fontSize: 9, fontWeight: 700 }}>{label}</span>
    </button>
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
