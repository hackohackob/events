import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { RadioIcon, RefreshIcon, ZapIcon } from "../lib/icons";
import { Banner, Card, Field } from "./ui";

/**
 * Side-by-side comparison of the outgoing audio processing.
 *
 * One clip is stored on the box and sent repeatedly through different filter
 * chains, so the same words can be judged against each other on the far radio.
 * Comparing two different recordings settles nothing — half of what you would
 * be hearing is the difference between what was said.
 */
export function AbTest() {
  const [presets, setPresets] = useState<
    Array<{ id: string; label: string; detail: string; active: boolean }>
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  // Bumped whenever a new sample is stored, to defeat the browser's cache on
  // an endpoint whose contents change behind the same URL.
  const [sampleVersion, setSampleVersion] = useState(0);

  const refresh = useCallback(() => {
    api
      .abInfo()
      .then((info) => {
        setPresets(info.presets);
        setLoaded(info.loaded);
      })
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);

  const load = async (): Promise<void> => {
    setBusy("load");
    try {
      const result = await api.abLoadSample(url.trim());
      setNotice({ ok: result.ok, text: result.detail });
      if (result.ok) {
        refresh();
        setSampleVersion((v) => v + 1);
      }
    } finally {
      setBusy(null);
    }
  };

  const use = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      const result = await api.abUse(id);
      setNotice({ ok: result.ok, text: result.detail });
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const send = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      const result = await api.abSend(id);
      setNotice({ ok: result.ok, text: result.detail });
      if (result.ok) setSent((prev) => [...prev.filter((p) => p !== id), id]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Compare the outgoing sound">
      <p className="hint" style={{ marginBottom: 14 }}>
        Sends one clip over the air several times, processed differently each time. Listen on the
        second handset and note which number sounds best — clearest, least boomy, and not cutting
        out part-way through. Nothing here changes the box's settings; it only lets you hear the
        options.
      </p>

      {notice && <Banner tone={notice.ok ? "ok" : "bad"}>{notice.text}</Banner>}

      <Field
        label="Sample to use"
        hint="Paste the address of a voice message from the server — a real one off the radio or from Zello is far more useful than a clean recording."
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="/uploads/event-chat/ptt-voice-….ogg"
        />
      </Field>
      <button className="btn block" disabled={!url.trim() || busy !== null} onClick={() => void load()}>
        {busy === "load" ? <RefreshIcon size={15} className="spin" /> : <RadioIcon size={15} />}
        {loaded ? "Replace the sample" : "Load the sample"}
      </button>

      {!loaded ? (
        <p className="hint" style={{ marginTop: 12 }}>
          No sample loaded yet.
        </p>
      ) : (
        <>
          {/* Hearing the source matters: half of judging "is it bassy" is
              knowing how bassy it was before the box touched it. */}
          <div style={{ marginTop: 14 }}>
            <label
              style={{
                display: "block",
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--text-faint)",
                marginBottom: 7,
              }}
            >
              The sample, unprocessed
            </label>
            <audio
              key={sampleVersion}
              controls
              preload="metadata"
              src={`/api/radio/ab/sample?v=${sampleVersion}`}
              style={{ width: "100%", height: 36 }}
            />
            <p className="hint" style={{ marginTop: 6 }}>
              This is what arrived, before any processing — the thing every preset below is trying
              to improve on.
            </p>
          </div>
        </>
      )}

      {loaded && (
        <div style={{ margin: "18px -16px 0" }}>
          {presets.map((preset) => (
            <div className="row" key={preset.id}>
              <div className="row-main">
                {/* Wrapping, not truncating: these names are the thing being
                    chosen between, so "Band + presence + compr…" is useless. */}
                <strong style={{ whiteSpace: "normal" }}>{preset.label}</strong>
                <span style={{ whiteSpace: "normal" }}>{preset.detail}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                <button
                  className={`btn sm${sent.includes(preset.id) ? "" : " primary"}`}
                  disabled={busy !== null}
                  onClick={() => void send(preset.id)}
                >
                  {busy === preset.id ? (
                    <RefreshIcon size={13} className="spin" />
                  ) : (
                    <ZapIcon size={13} />
                  )}
                  {sent.includes(preset.id) ? "Again" : "Send"}
                </button>
                <button
                  className="btn sm ghost"
                  disabled={busy !== null || preset.active}
                  onClick={() => void use(preset.id)}
                  style={preset.active ? { color: "var(--green)", opacity: 1 } : undefined}
                >
                  {preset.active ? "In use" : "Use this"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
