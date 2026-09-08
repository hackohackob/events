import { useMemo, useRef, useState } from "react";
import { api, formatDuration, formatWhen, type Recording } from "../lib/api";
import { useRecordings } from "../lib/useGateway";
import { DownIcon, ListIcon, PauseIcon, PlayIcon, TrashIcon, UpIcon } from "../lib/icons";
import { Empty } from "./ui";

/**
 * Everything that went over the air, newest first, playable without a network.
 *
 * The list is the box's own record rather than the server's: it is written
 * before the upload is attempted, so it is complete even when the venue's WiFi
 * was not — which is exactly the situation somebody is trying to reconstruct
 * when they open this screen.
 */
export function TrafficTab({ bump }: { bump: number }) {
  const [filter, setFilter] = useState<"all" | "rx" | "tx">("all");
  const { rows, loading, reload } = useRecordings(bump, filter === "all" ? undefined : filter);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const toggle = (row: Recording): void => {
    if (playing === row.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const element = new Audio(`/api/recordings/${row.id}/audio`);
    audio.current = element;
    element.onended = () => setPlaying(null);
    element.onerror = () => setPlaying(null);
    void element.play().then(() => setPlaying(row.id)).catch(() => setPlaying(null));
  };

  const counts = useMemo(
    () => ({
      rx: rows.filter((r) => r.direction === "rx").length,
      tx: rows.filter((r) => r.direction === "tx").length,
    }),
    [rows],
  );

  return (
    <>
      <div className="chips" style={{ paddingTop: 4 }}>
        {(
          [
            ["all", "Everything"],
            ["rx", "From the radio"],
            ["tx", "To the radio"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`chip${filter === key ? " on" : ""}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <button
          className="chip"
          onClick={() => {
            if (confirm("Delete every recording on this box? The server keeps its own copies.")) {
              void api.clearRecordings().then(reload);
            }
          }}
        >
          <TrashIcon size={12} /> Clear
        </button>
      </div>

      <section className="card enter">
        {loading && rows.length === 0 ? (
          <Empty icon={<ListIcon size={30} />}>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty icon={<ListIcon size={30} />}>
            Nothing has been heard or sent yet.
            <br />
            Transmissions appear here the moment the squelch opens.
          </Empty>
        ) : (
          rows.map((row) => (
            <div className="row" key={row.id}>
              <button
                className={`play${playing === row.id ? " playing" : ""}`}
                onClick={() => toggle(row)}
                aria-label={playing === row.id ? "Pause" : "Play"}
              >
                {playing === row.id ? <PauseIcon size={15} /> : <PlayIcon size={14} />}
              </button>

              <div className="row-main">
                <strong style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  {row.direction === "rx" ? (
                    <DownIcon size={13} style={{ color: "var(--green)", flexShrink: 0 }} />
                  ) : (
                    <UpIcon size={13} style={{ color: "var(--amber)", flexShrink: 0 }} />
                  )}
                  {row.party ?? (row.direction === "rx" ? "Radio" : "App")}
                  <span style={{ color: "var(--text-ghost)", fontWeight: 400, fontSize: 12 }}>
                    {formatDuration(row.durationMs)}
                  </span>
                </strong>
                <span>
                  {formatWhen(row.at)}
                  {row.text ? ` · ${row.text}` : ""}
                </span>
                <Sparkline row={row} />
              </div>

              {row.direction === "rx" && (
                <span className={`tag ${row.uploaded ? "ok" : "warn"}`}>
                  {row.uploaded ? "Sent" : "Queued"}
                </span>
              )}
            </div>
          ))
        )}
      </section>

      {rows.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--text-ghost)", textAlign: "center", padding: "4px 0 8px" }}>
          {counts.rx} in · {counts.tx} out · kept on this box until the storage limit is reached
        </p>
      )}
    </>
  );
}

/**
 * A level sketch for the row. Not the real waveform — decoding Opus on a phone
 * to draw a thumbnail is not worth the battery — but seeded from the recording's
 * id and peak so it is stable per row, distinguishable at a glance, and honest
 * about how loud the transmission was.
 */
function Sparkline({ row }: { row: Recording }) {
  const bars = useMemo(() => {
    const count = 34;
    let seed = 0;
    for (const char of row.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    const peak = Math.max(0.15, Math.min(1, row.peakLevel / 0.5));
    return Array.from({ length: count }, (_, i) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = ((seed >>> 16) % 1000) / 1000;
      // A speech-shaped envelope: quiet at the edges, busy in the middle.
      const envelope = Math.sin((i / (count - 1)) * Math.PI) * 0.6 + 0.4;
      return Math.max(0.1, noise * envelope * peak);
    });
  }, [row.id, row.peakLevel]);

  return (
    <div className={`sparkline ${row.direction}`} aria-hidden>
      {bars.map((height, i) => (
        <i key={i} style={{ height: `${Math.round(height * 100)}%` }} />
      ))}
    </div>
  );
}
