import client from "./client";

export interface UnitSummary {
  id: string;
  unitNumber: string;
  name: string;
  vehicle: string;
  status: "available" | "responding" | "standby";
  avatarUrl: string;
}

export async function fetchUnits() {
  const res = await client.get("/units");
  return res.data as UnitSummary[];
}
