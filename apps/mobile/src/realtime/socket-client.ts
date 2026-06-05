import { io, Socket } from "socket.io-client";
import { useSessionStore } from "../security/session-store";
import { resolveLocalhostUrl } from "../ui/runtime-host";
import { debugLog } from "../debug/debug-log";

let socket: Socket | null = null;
// The session token the live socket was authenticated with. If the user
// re-joins a different event/identity, the token changes and we must reconnect —
// otherwise the server keeps using the OLD token's eventId (the server derives
// eventId from the token), so medic locations get stored under the wrong event.
let socketToken: string | null = null;

export function getSocket(): Socket {
  const session = useSessionStore.getState();
  if (socket) {
    if (socketToken === (session.token ?? null)) return socket;
    // Session changed — tear down the stale socket and reconnect fresh.
    debugLog("socket", "info", "session changed — reconnecting socket");
    socket.disconnect();
    socket = null;
  }
  socketToken = session.token ?? null;
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

  socket.on("connect", () => debugLog("socket", "info", "socket connected", { id: socket?.id }));
  socket.on("disconnect", (reason) => debugLog("socket", "warn", "socket disconnected", reason));
  socket.on("connect_error", (err) => debugLog("socket", "error", "socket connect error", err.message));

  return socket;
}

export function resetSocket(): void {
  socketToken = null;
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
