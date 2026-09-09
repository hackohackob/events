import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LogEntry, type Recording, type Status } from "./api";

export interface Levels {
  rx: number;
  tx: number;
  receiving: boolean;
  transmitting: boolean;
}

/** A beep the box recognised, for the scope to mark. */
export interface ToneEvent {
  kind: "open" | "close";
  at: number;
}

/**
 * The console's connection to the box: one EventSource carrying status changes,
 * log lines and level samples.
 *
 * Levels are kept out of React state on purpose. They arrive eight times a
 * second, and re-rendering the whole console at 8 Hz on a phone is exactly the
 * kind of thing that makes a page feel cheap. Instead they are pushed into a ref
 * and read by the two components that animate — the scope draws from a
 * requestAnimationFrame loop, and the meters subscribe directly.
 */
export function useGateway() {
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [recordingBump, setRecordingBump] = useState(0);

  const levels = useRef<Levels>({ rx: 0, tx: 0, receiving: false, transmitting: false });
  const levelListeners = useRef(new Set<(l: Levels) => void>());
  const toneListeners = useRef(new Set<(t: ToneEvent) => void>());

  const subscribeLevels = useCallback((fn: (l: Levels) => void) => {
    levelListeners.current.add(fn);
    return () => {
      levelListeners.current.delete(fn);
    };
  }, []);

  const subscribeTones = useCallback((fn: (t: ToneEvent) => void) => {
    toneListeners.current.add(fn);
    return () => {
      toneListeners.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (): void => {
      source = new EventSource("/api/stream");

      source.addEventListener("open", () => setConnected(true));

      source.addEventListener("status", (event) => {
        setStatus(JSON.parse((event as MessageEvent<string>).data) as Status);
        setConnected(true);
      });

      source.addEventListener("level", (event) => {
        const next = JSON.parse((event as MessageEvent<string>).data) as Levels;
        levels.current = next;
        for (const listener of levelListeners.current) listener(next);
      });

      source.addEventListener("log", (event) => {
        const entry = JSON.parse((event as MessageEvent<string>).data) as LogEntry;
        setLogs((prev) => {
          if (prev.length && prev[prev.length - 1]!.seq >= entry.seq) return prev;
          const next = [...prev, entry];
          // The console is a viewer, not an archive — the box keeps the file.
          return next.length > 1500 ? next.slice(-1200) : next;
        });
      });

      source.addEventListener("recording", () => setRecordingBump((n) => n + 1));

      source.addEventListener("tone", (event) => {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { kind: "open" | "close" };
        // Stamped on arrival rather than trusting the box's clock: the scope
        // positions everything on the browser's own timeline.
        const tone: ToneEvent = { kind: payload.kind, at: performance.now() };
        for (const listener of toneListeners.current) listener(tone);
      });

      source.addEventListener("error", () => {
        setConnected(false);
        source?.close();
        if (closed) return;
        // The box restarts itself for updates and settings changes; reconnecting
        // quietly is what makes that invisible from the phone.
        retry = setTimeout(connect, 2000);
      });
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);

  const refresh = useCallback(async () => {
    setStatus(await api.status());
  }, []);

  return {
    status,
    logs,
    connected,
    levels,
    subscribeLevels,
    subscribeTones,
    refresh,
    recordingBump,
    setLogs,
  };
}

/** Recordings list, refreshed whenever the box says there is a new one. */
export function useRecordings(bump: number, direction?: "rx" | "tx") {
  const [rows, setRows] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .recordings(direction)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [direction]);

  useEffect(reload, [reload, bump]);
  return { rows, loading, reload };
}
