import { useRef, useState } from "react";
import { useT } from "../i18n";

interface Props {
  note: string;
  onNoteChange: (v: string) => void;
  notePlaceholder: string;
  /** Omit both to hide the photo action entirely (e.g. the initial report —
   *  photos can only be added once the incident exists, from the sent screen). */
  photos?: File[];
  onAddPhoto?: (file: File) => void;
  onRemovePhoto?: (index: number) => void;
  voice: Blob | null;
  voiceSupported: boolean;
  recording: boolean;
  onToggleRecord: () => void;
  onRemoveVoice?: () => void;
  maxPhotos?: number;
  /** When provided, the note shows an explicit Send button (used after the SOS
   *  is sent, where each note is dispatched to the team on its own). */
  onSendNote?: () => void;
  sendNoteLabel?: string;
  noteSending?: boolean;
}

/**
 * Add-details editor shared by the report-confirm screen (before send) and the
 * SOS-sent screen (after send). Three actions — Note / Photo / Voice — each
 * reveal their input only when tapped: the note opens a textarea, the photo
 * action opens a Camera/Gallery chooser, and voice toggles recording. Whatever
 * is attached is then shown back: the note as text, photos as thumbnails, the
 * voice note as a chip.
 */
export function AttachmentEditor({
  note,
  onNoteChange,
  notePlaceholder,
  photos,
  onAddPhoto,
  onRemovePhoto,
  voice,
  voiceSupported,
  recording,
  onToggleRecord,
  onRemoveVoice,
  maxPhotos = 3,
  onSendNote,
  sendNoteLabel,
  noteSending,
}: Props) {
  const { t } = useT();
  const [noteOpen, setNoteOpen] = useState(false);
  const [photoChooser, setPhotoChooser] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const showNote = noteOpen || note.trim() !== "";
  const photoEnabled = !!onAddPhoto;
  const canAddPhoto = photoEnabled && (photos?.length ?? 0) < maxPhotos;

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setPhotoChooser(false);
    if (file && canAddPhoto) onAddPhoto?.(file);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        <ActionButton
          glyph="📝"
          label={t("sent.addNote")}
          active={showNote}
          onClick={() => setNoteOpen((o) => !o)}
        />
        {photoEnabled && (
          <ActionButton
            glyph="📷"
            label={t("sent.addPhoto")}
            active={photoChooser}
            disabled={!canAddPhoto}
            onClick={() => setPhotoChooser((o) => !o)}
          />
        )}
        {voiceSupported && (
          <ActionButton
            glyph={recording ? "⏹" : "🎙️"}
            label={recording ? t("confirm.recording") : t("sent.addVoice")}
            active={recording}
            onClick={onToggleRecord}
          />
        )}
      </div>

      {/* Camera / gallery chooser (only while picking) */}
      {photoChooser && canAddPhoto && (
        <div style={{ display: "flex", gap: 10 }}>
          <ChooserButton glyph="📸" label={t("confirm.camera")} onClick={() => cameraRef.current?.click()} />
          <ChooserButton glyph="🖼️" label={t("confirm.library")} onClick={() => libraryRef.current?.click()} />
        </div>
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={pick} />

      {/* Note input */}
      {showNote && (
        <>
          <textarea
            value={note}
            autoFocus={noteOpen && note.trim() === ""}
            placeholder={notePlaceholder}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 13,
              background: "var(--bg-input)",
              border: "1px solid var(--border-mid)",
              color: "var(--text-primary)",
              fontSize: 14,
              fontFamily: "Manrope",
              resize: "none",
              outline: "none",
            }}
          />
          {onSendNote && (
            <button
              onClick={onSendNote}
              disabled={note.trim() === "" || noteSending}
              className="btn-primary"
              style={{ alignSelf: "flex-end", width: "auto", padding: "10px 18px", opacity: note.trim() === "" || noteSending ? 0.45 : 1 }}
            >
              {noteSending ? "…" : `✓ ${sendNoteLabel ?? "Send"}`}
            </button>
          )}
        </>
      )}

      {/* Voice chip */}
      {voice && !recording && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 13,
            background: "var(--primary-bg)",
            border: "1px solid var(--primary)",
          }}
        >
          <span style={{ fontSize: 18 }}>🎙️</span>
          <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: "var(--primary)" }}>{t("confirm.voiceReady")}</span>
          {onRemoveVoice && (
            <button onClick={onRemoveVoice} style={{ color: "var(--text-muted)", textDecoration: "underline", fontSize: 12 }}>
              {t("confirm.voiceDelete")}
            </button>
          )}
        </div>
      )}

      {/* Photo thumbnails */}
      {photos && photos.length > 0 && (
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative", width: 64, height: 64, borderRadius: 13, overflow: "hidden", border: "1px solid var(--border-mid)" }}>
              <img src={URL.createObjectURL(p)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              {onRemovePhoto && (
                <button
                  onClick={() => onRemovePhoto(i)}
                  style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({ glyph, label, active, disabled, onClick }: { glyph: string; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        padding: "12px 6px",
        borderRadius: 14,
        background: active ? "var(--primary-bg)" : "var(--bg-card)",
        border: `1px solid ${active ? "var(--primary)" : "var(--border-mid)"}`,
        color: active ? "var(--primary)" : "var(--text-secondary)",
        fontWeight: 700,
        fontSize: 11.5,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: 20 }}>{glyph}</span>
      <span style={{ textAlign: "center", lineHeight: 1.2 }}>{label}</span>
    </button>
  );
}

function ChooserButton({ glyph, label, onClick }: { glyph: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "11px",
        borderRadius: 12,
        background: "var(--bg-input)",
        border: "1px dashed var(--border-strong)",
        color: "var(--text-secondary)",
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      <span style={{ fontSize: 16 }}>{glyph}</span>
      {label}
    </button>
  );
}
