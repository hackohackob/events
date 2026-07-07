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
    // Outside an event's active hours medic locations are published to this
    // coordinator-only room instead of the shared :map room.
    if (role === "coordinator") {
      client.join(`event:${eventId}:map:coordinators`);
    }
  }

  @SubscribeMessage("join_room")
  joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; channel: "map" | "incidents" | "ops" },
  ) {
    // Only the three public channels can be joined here; the coordinator-only
    // map room is assigned at connect based on the session role.
    if (!["map", "incidents", "ops"].includes(data.channel)) {
      return { ok: false };
    }
    client.join(`event:${data.eventId}:${data.channel}`);
    return { ok: true };
  }
}
