import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { SessionPayload, UserRole } from "@events/contracts";
import { Server, Socket } from "socket.io";

@WebSocketGateway({
  cors: { origin: "*" },
  namespace: "/realtime",
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    // Decode session token when provided (mobile sends it in handshake)
    const rawToken = client.handshake.auth.token as string | undefined;
    let session: SessionPayload | null = null;
    if (rawToken) {
      try {
        session = JSON.parse(Buffer.from(rawToken, "base64").toString("utf8")) as SessionPayload;
      } catch {
        // ignore malformed tokens — fall back to explicit fields
      }
    }

    const eventId = session?.eventId ?? (client.handshake.auth.eventId as string | undefined);
    const role = session?.role ?? (client.handshake.auth.role as UserRole | undefined);

    if (!eventId || !role) {
      client.disconnect(true);
      return;
    }

    // Store parsed session on socket so other gateways can access it
    client.data.session = session ?? { eventId, role, userId: "anonymous" };

    client.join(`event:${eventId}:map`);
    client.join(`event:${eventId}:ops`);
    if (role === "paramedic" || role === "coordinator" || role === "medic") {
      client.join(`event:${eventId}:incidents`);
    }
  }

  @SubscribeMessage("join_room")
  joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; channel: "map" | "incidents" | "ops" },
  ) {
    client.join(`event:${data.eventId}:${data.channel}`);
    return { ok: true };
  }
}
