import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { CloudIcon, RefreshIcon } from "../lib/icons";
import { Banner, Card, Toggle } from "./ui";

/**
 * Remote access, for when the box is at an event and whoever can fix it is not.
 *
 * The box opens a tunnel *out* to a reachable host, so nothing about the
 * venue's network has to change. The key is made on the box and never leaves
 * it; its public half is shown here to be read out or sent on, and until
 * somebody installs that on the far host nothing can connect. That is the
 * point — a box that shipped able to connect would be a box anyone could.
 */
export function RemoteCard() {
  const [state, setState] = useState<{
    enabled: boolean;
    connected: boolean;
    publicKey: string | null;
    detail: string;
    instructions: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    api.remote().then(setState).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    try {
      setState(await api.setRemote({ enabled }));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  return (
    <Card
      title="Remote access"
      collapsible
      badge={state.enabled ? (state.connected ? "connected" : "connecting") : undefined}
    >
      <Toggle
        label="Let this box be reached from outside"
        hint="Opens a tunnel out to the events server. Nothing can connect until the key below has been installed there by hand."
        on={state.enabled}
        disabled={busy}
        onChange={(v) => void toggle(v)}
      />

      {state.enabled && (
        <>
          <Banner tone={state.connected ? "ok" : "warn"}>{state.detail}</Banner>

          {state.publicKey && (
            <>
              <label
                style={{
                  display: "block",
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "var(--text-faint)",
                  margin: "14px 0 7px",
                }}
              >
                This box's public key
              </label>
              <textarea
                readOnly
                value={state.publicKey}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: "100%",
                  minHeight: 96,
                  padding: 12,
                  borderRadius: 16,
                  background: "var(--bg-1)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 11,
                  lineHeight: 1.5,
                  wordBreak: "break-all",
                  resize: "vertical",
                }}
              />
              <button
                className="btn block"
                style={{ marginTop: 8 }}
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(state.publicKey ?? "")
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    })
                    .catch(() => undefined);
                }}
              >
                {copied ? "Copied" : "Copy the key"}
              </button>
              <p className="hint" style={{ marginTop: 8 }}>
                Send this to whoever is helping. Once they have added it on the server, this box
                becomes reachable and the line above turns green. It is safe to share — it is the
                public half; the private half stays on the box.
              </p>
            </>
          )}

          {state.instructions && (
            <p className="hint" style={{ marginTop: 10, fontFamily: "ui-monospace, monospace" }}>
              {state.instructions}
            </p>
          )}
        </>
      )}

      <button className="btn block ghost" style={{ marginTop: 12 }} onClick={refresh}>
        <RefreshIcon size={14} /> Check again
      </button>
      <p className="hint" style={{ marginTop: 8 }}>
        <CloudIcon size={12} /> Turn this off once you are done. It is a door into the box, and it
        should not be left open at an event.
      </p>
    </Card>
  );
}
