import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { UserRole } from "@events/contracts";
import { Server, Socket } from "socket.io";

@WebSocketGateway({
  cors: { origin: "*" },
  namespace: "/realtime",
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    const eventId = client.handshake.auth.eventId as string | undefined;
    const role = client.handshake.auth.role as UserRole | undefined;
    if (!eventId || !role) {
      client.disconnect(true);
      return;
    }

    client.join(`event:${eventId}:map`);
    client.join(`event:${eventId}:ops`);
    if (role === "paramedic" || role === "coordinator") {
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
