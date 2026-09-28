import client from "./client";
import type { LocationDiagRecord, LocationTuning } from "@events/contracts";

export interface MedicDiagSummary {
  medicId: string;
  name: string | null;
  lastFixAt: string | null;
  lastAccuracy: number | null;
  battery: number | null;
  status: string | null;
  platform: string | null;
  appVersion: string | null;
  device: string | null;
  lastDiagAt: string | null;
  inaccurate6h: number;
  refineOk6h: number;
  refineFail6h: number;
}

export async function fetchLocationTuning(): Promise<LocationTuning> {
  const res = await client.get("/location-tuning");
  return res.data as LocationTuning;
}

export async function saveLocationTuning(patch: Partial<LocationTuning>): Promise<LocationTuning> {
  const res = await client.put("/location-tuning", patch);
  return res.data as LocationTuning;
}

export async function fetchLocationDiagnostics(
  eventId: string,
  filters: { medicId?: string; kind?: string; level?: string; limit?: number } = {},
): Promise<LocationDiagRecord[]> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v != null && v !== "") params[k] = String(v);
  const res = await client.get(`/events/${eventId}/location-diagnostics`, { params });
  return res.data as LocationDiagRecord[];
}

export async function fetchLocationDiagSummary(eventId: string): Promise<MedicDiagSummary[]> {
  const res = await client.get(`/events/${eventId}/location-diagnostics/summary`);
  return res.data as MedicDiagSummary[];
}

/** Silent-push one medic (or, without medicId, every medic seen in 24h) for a fresh precise fix. */
export async function requestPreciseFix(eventId: string, medicId?: string): Promise<{ medics: number; devices: number }> {
  const res = await client.post(`/events/${eventId}/location-diagnostics/precise-fix`, { medicId });
  return res.data as { medics: number; devices: number };
}
