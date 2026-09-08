import { useEffect, useMemo, useRef, useState } from "react";
import type { LogEntry } from "../lib/api";
import { TerminalIcon } from "../lib/icons";
import { Empty } from "./ui";

const SCOPES = ["system", "wifi", "audio", "radio", "server", "console", "update"] as const;

/**
 * The live log.
 *
 * Not a debug dump: it is the narrative of what the box is doing, filtered by
 * the part of the box it came from, and it is very often the only thing that
 * explains why a cable is not working. Auto-scroll follows the tail until the
 * reader scrolls up, at which point it stops fighting them — the usual mistake
 * in a log view, and the one that makes it useless for actually reading.
 */
export function LogsTab({ logs }: { logs: LogEntry[] }) {
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [showDebug, setShowDebug] = useState(false);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      logs.filter(
        (entry) =>
          (showDebug || entry.level !== "debug") && (scopes.size === 0 || scopes.has(entry.scope)),
      ),
    [logs, scopes, showDebug],
  );

  useEffect(() => {
    if (!follow) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [filtered, follow]);

  const toggleScope = (scope: string): void => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  return (
    <>
      <div className="chips" style={{ paddingTop: 4 }}>
        <button className={`chip${scopes.size === 0 ? " on" : ""}`} onClick={() => setScopes(new Set())}>
          Everything
        </button>
        {SCOPES.map((scope) => (
          <button
            key={scope}
            className={`chip${scopes.has(scope) ? " on" : ""}`}
            onClick={() => toggleScope(scope)}
          >
            {scope}
          </button>
        ))}
        <button className={`chip${showDebug ? " on" : ""}`} onClick={() => setShowDebug((v) => !v)}>
          Detail
        </button>
      </div>

      <section className="card enter" style={{ marginBottom: 8 }}>
        <div
          ref={listRef}
          className="log-list"
          style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}
          onScroll={(event) => {
            const el = event.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
          }}
        >
          {filtered.length === 0 ? (
            <Empty icon={<TerminalIcon size={28} />}>Nothing logged for this filter yet.</Empty>
          ) : (
            filtered.map((entry) => (
              <div className={`log-line ${entry.level}`} key={entry.seq}>
                <time>{new Date(entry.at).toLocaleTimeString([], { hour12: false })}</time>
                <span className="scope-tag">{entry.scope}</span>
                <span className="msg">
                  {entry.message}
                  {entry.data &&
                    Object.entries(entry.data).map(([key, value]) => (
                      <span key={key} style={{ color: "var(--text-ghost)" }}>
                        {" "}
                        {key}={String(value)}
                      </span>
                    ))}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {!follow && (
        <button
          className="btn block sm"
          onClick={() => {
            setFollow(true);
            const list = listRef.current;
            if (list) list.scrollTop = list.scrollHeight;
          }}
        >
          Jump to the latest
        </button>
      )}
    </>
  );
}
