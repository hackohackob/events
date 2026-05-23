import { Injectable, BadRequestException } from "@nestjs/common";
import { SessionPayload } from "@events/contracts";
import { DbService } from "../infra/db.service";
import { JoinEventDto } from "./dto/join-event.dto";

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  async joinEvent(payload: JoinEventDto): Promise<{ token: string; session: SessionPayload }> {
    const eventId = payload.joinCode;
    const role = payload.role ?? "runner";

    if (role === "medic") {
      return this.joinAsMedic(eventId, payload);
    }
    return this.joinAsRunner(eventId, payload);
  }

  private async joinAsRunner(
    eventId: string,
    payload: JoinEventDto,
  ): Promise<{ token: string; session: SessionPayload }> {
    if (!payload.name?.trim()) {
      throw new BadRequestException("name is required for runners");
    }
    // Stable userId from name+bib so rejoining gives the same ID
    const slug = payload.name.toLowerCase().replace(/\s+/g, "_");
    const bib = payload.bibNumber ? `_${payload.bibNumber}` : "";
    const userId = `runner_${slug}${bib}`;

    const session: SessionPayload = {
      userId,
      eventId,
      role: "runner",
      name: payload.name,
    };
    const token = Buffer.from(JSON.stringify(session)).toString("base64");
    return { token, session };
  }

  private async joinAsMedic(
    eventId: string,
    payload: JoinEventDto,
  ): Promise<{ token: string; session: SessionPayload }> {
    if (!payload.medicId) {
      throw new BadRequestException("medicId is required when role is medic");
    }

    const { rows } = await this.db.query<{ id: string; name: string }>(
      "SELECT id, name FROM event_medics WHERE event_id = $1 AND id = $2",
      [eventId, payload.medicId],
    );
    if (!rows[0]) {
      throw new BadRequestException("Medic not found in the roster for this event");
    }

    const session: SessionPayload = {
      userId: rows[0].id,
      eventId,
      role: "medic",
      name: rows[0].name,
    };
    const token = Buffer.from(JSON.stringify(session)).toString("base64");
    return { token, session };
  }
}
