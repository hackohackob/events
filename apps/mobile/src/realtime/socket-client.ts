import { io, Socket } from "socket.io-client";
import { useSessionStore } from "../security/session-store";
import { resolveLocalhostUrl } from "../ui/runtime-host";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const session = useSessionStore.getState();
  const wsBase = resolveLocalhostUrl(process.env.EXPO_PUBLIC_WS_URL ?? "https://events-api.hackohackob.com/realtime");

  socket = io(wsBase, {
    transports: ["websocket"],
    auth: {
      // Pass the raw token so the server can decode userId + name for medics
      token: session.token,
      eventId: session.eventId ?? "event-demo",
      role: session.role,
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  return socket;
}

export function resetSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
