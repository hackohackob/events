import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { EventActiveHours, PublicMedicState } from "../api/contracts-shim";
import { fetchPublicMedics } from "../api";
import { isWithinActiveHours } from "../lib/active-hours";
import { getToken } from "../lib/storage";

const WS_URL = (import.meta.env.VITE_WS_URL as string) || "/realtime";

/** Hide medics whose last position is older than this — a stale dot is worse
 *  than none (the runner shouldn't head toward a medic who left long ago). */
const STALE_AFTER_MS = 40 * 60_000;

interface MedicMsg {
  medicId: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
}

/**
 * Live medic positions for the runner map. Seeds from the trimmed HTTP snapshot,
 * then keeps current via the realtime `medic_location` broadcasts on the map room.
 */
export function useLiveMedics(eventId: string, activeHours?: EventActiveHours) {
  const [medics, setMedics] = useState<PublicMedicState[]>([]);
  // Re-evaluates the staleness filter even without new data, so a medic that
  // goes quiet disappears on its own.
  const [staleTick, setStaleTick] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const id = setInterval(() => setStaleTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      fetchPublicMedics(eventId)
        .then((snap) => alive && setMedics(snap))
        .catch(() => undefined);
    refresh();
    // Poll as a fallback so positions refresh even if a WS update is missed.
    const poll = setInterval(refresh, 12_000);

    const socket = io(WS_URL, {
      transports: ["websocket"],
      auth: { token: getToken() ?? undefined, eventId, role: "runner" },
    });
    socketRef.current = socket;

    // The redis→socket bridge emits each message under its `type` as the event
    // name, with the payload as the body — so listen for `medic_location`.
    socket.on("medic_location", (p: MedicMsg) => {
      if (!p?.medicId) return;
      setMedics((prev) => {
        const next = prev.filter((m) => m.medicId !== p.medicId);
        next.push({
          medicId: p.medicId,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          status: p.status as PublicMedicState["status"],
          recordedAt: new Date().toISOString(),
        });
        return next;
      });
    });

    return () => {
      alive = false;
      clearInterval(poll);
      socket.disconnect();
    };
  }, [eventId]);

  // Drop stale medics (position older than STALE_AFTER_MS). Outside the
  // event's active hours hide all of them — the server already stops sending;
  // this also clears existing dots on the next minute tick.
  return useMemo(() => {
    const cutoff = Date.now() - STALE_AFTER_MS;
    void staleTick; // re-run on the minute tick
    if (!isWithinActiveHours(activeHours)) return [];
    return medics.filter((m) => {
      const t = Date.parse(m.recordedAt);
      return !Number.isFinite(t) || t >= cutoff;
    });
  }, [medics, staleTick, activeHours]);
}
