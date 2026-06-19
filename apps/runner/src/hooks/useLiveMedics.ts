import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicMedicState } from "../api/contracts-shim";
import { fetchPublicMedics } from "../api";
import { getToken } from "../lib/storage";

const WS_URL = (import.meta.env.VITE_WS_URL as string) || "/realtime";

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
export function useLiveMedics(eventId: string) {
  const [medics, setMedics] = useState<PublicMedicState[]>([]);
  const socketRef = useRef<Socket | null>(null);

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

  return medics;
}
