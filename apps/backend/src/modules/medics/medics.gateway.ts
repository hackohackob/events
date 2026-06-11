import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import { Socket } from "socket.io";
import { SessionPayload, WsMedicLocation } from "@events/contracts";
import { MedicsService } from "./medics.service";
import { RedisService } from "../infra/redis.service";
import { IncidentsService } from "../incidents/incidents.service";

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@WebSocketGateway({
  cors: { origin: "*" },
  namespace: "/realtime",
})
export class MedicsGateway {
  constructor(
    private readonly medicsService: MedicsService,
    private readonly redis: RedisService,
    private readonly incidentsService: IncidentsService,
  ) {}

  @SubscribeMessage("medic_location")
  async handleMedicLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: WsMedicLocation,
  ) {
    const session = client.data.session as SessionPayload | undefined;
    if (!session || (session.role !== "medic" && session.role !== "paramedic")) return;

    const eventId = session.eventId;
    const medicId = session.userId;

    await this.medicsService.upsertMedicLocation({
      eventId,
      medicId,
      name: session.name ?? medicId,
      lat: data.lat,
      lng: data.lng,
      heading: data.heading,
      speed: data.speed,
      accuracy: data.accuracy,
      battery: data.battery,
    });

    await this.incidentsService.noteNearbyResponderArrivals(eventId, medicId, data.lat, data.lng);

    const state = await this.medicsService.getMedicState(eventId, medicId);
    if (state && state.status === "going_to" && state.destination) {
      const destination = state.destination;
      const dist = haversineMeters(data.lat, data.lng, destination.lat, destination.lng);
      if (dist < 80) {
        await this.medicsService.assignDestination(eventId, medicId, null);
        await this.redis.publish(`event:${eventId}:ops`, {
          type: "medic_arrived",
          payload: { medicId, label: destination.label },
        });
      }
    }
  }
}
