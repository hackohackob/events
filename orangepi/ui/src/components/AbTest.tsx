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
  const [presets, setPresets] = useState<Array<{ id: string; label: string; detail: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [sent, setSent] = useState<string[]>([]);

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
      if (result.ok) refresh();
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
        <div style={{ margin: "18px -16px 0" }}>
          {presets.map((preset) => (
            <div className="row" key={preset.id}>
              <div className="row-main">
                {/* Wrapping, not truncating: these names are the thing being
                    chosen between, so "Band + presence + compr…" is useless. */}
                <strong style={{ whiteSpace: "normal" }}>{preset.label}</strong>
                <span style={{ whiteSpace: "normal" }}>{preset.detail}</span>
              </div>
              <button
                className={`btn sm${sent.includes(preset.id) ? "" : " primary"}`}
                disabled={busy !== null}
                onClick={() => void send(preset.id)}
                style={{ flexShrink: 0 }}
              >
                {busy === preset.id ? (
                  <RefreshIcon size={13} className="spin" />
                ) : (
                  <ZapIcon size={13} />
                )}
                {sent.includes(preset.id) ? "Again" : "Send"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
