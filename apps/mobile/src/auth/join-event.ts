import { JoinEventRequest, SessionPayload } from "@events/contracts";
import { apiFetch } from "../ui/api-client";

interface JoinResponse {
  token: string;
  session: SessionPayload;
}

export async function joinEvent(payload: JoinEventRequest): Promise<JoinResponse> {
  return apiFetch<JoinResponse>("/auth/join", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
