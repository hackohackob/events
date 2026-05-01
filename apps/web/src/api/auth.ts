import client from "./client";
import type { JoinEventRequest } from "@events/contracts";

export async function joinEvent(payload: JoinEventRequest) {
  const res = await client.post("/auth/join", payload);
  return res.data as { token: string; session: any };
}
