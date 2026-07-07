import type { Hospital } from "@events/contracts";
import { apiFetch } from "../ui/api-client";

/** Fetch the global hospitals directory (all Bulgaria, seeded from OSM). */
export async function listHospitals(search?: string): Promise<Hospital[]> {
  const qs = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  return apiFetch<Hospital[]>(`/hospitals${qs}`);
}
