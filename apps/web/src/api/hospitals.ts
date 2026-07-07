import client from "./client";
import type { Hospital, UpsertHospitalRequest } from "@events/contracts";

export async function fetchHospitals(search?: string): Promise<Hospital[]> {
  const res = await client.get("/hospitals", { params: search ? { search } : undefined });
  return res.data as Hospital[];
}

export async function createHospital(data: UpsertHospitalRequest): Promise<Hospital> {
  const res = await client.post("/hospitals", data);
  return res.data as Hospital;
}

export async function updateHospital(id: string, data: UpsertHospitalRequest): Promise<Hospital> {
  const res = await client.put(`/hospitals/${id}`, data);
  return res.data as Hospital;
}

export async function deleteHospital(id: string): Promise<void> {
  await client.delete(`/hospitals/${id}`);
}
