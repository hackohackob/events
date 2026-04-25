import { Injectable } from "@nestjs/common";
import { SessionPayload } from "@events/contracts";
import { JoinEventDto } from "./dto/join-event.dto";

@Injectable()
export class AuthService {
  async joinEvent(payload: JoinEventDto): Promise<{ token: string; session: SessionPayload }> {
    const userId = `user_${payload.name.toLowerCase().replace(/\s+/g, "_")}`;
    const eventId = payload.joinCode;
    const session: SessionPayload = {
      userId,
      eventId,
      role: "runner",
    };
    const token = Buffer.from(JSON.stringify(session)).toString("base64");
    return { token, session };
  }
}
