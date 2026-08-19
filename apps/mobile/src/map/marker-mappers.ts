/**
 * Server payload → map marker converters.
 *
 * Extracted from MapScreen unchanged so the Android Auto feed (which runs
 * without any React tree, see `src/car/car-feed.ts`) produces markers that are
 * byte-for-byte what the phone map produces — one definition of "what an
 * incident looks like as a pin", rather than a car-flavoured second opinion.
 */
import type { VehicleType } from "@events/contracts";
import type { MedicMarkerRoute } from "./map-store";
import { freshnessBucket } from "./freshness";

export interface MedicActiveResponse {
  medicId: string;
  eventId: string;
  name: string;
  vehicleType?: VehicleType;
  lat: number;
  lng: number;
  accuracy?: number;
  battery?: number;
  charging?: boolean;
  status?: string;
  destination?: { lat: number; lng: number; label: string } | null;
  route?: MedicMarkerRoute | null;
  recordedAt?: string;
  lastSeenAt?: string;
}

export interface IncidentResponse {
  id: string;
  name?: string;
  type: string;
  description?: string;
  lat: number;
  lng: number;
  status?: string;
  severity?: string;
  photoUrl?: string;
  photoUrls?: string[];
  responders?: string[];
  createdBy?: string;
  reportedBy?: string;
  reporterPhone?: string;
  patientBib?: string;
  patientName?: string;
  patientPhone?: string;
  allergies?: string;
  medications?: string;
  bloodType?: string;
  conditions?: string;
  createdAt?: string;
  lastMessageAt?: string;
}

export interface PoiResponse {
  id: string;
  type: string;
  lat: number;
  lng: number;
  name?: string;
  description?: string;
  icon?: string;
  archived?: boolean;
}

export function incidentToMarker(incident: IncidentResponse) {
  return {
    id: incident.id,
    type: "incident" as const,
    label: incident.name ?? incident.type,
    name: incident.name,
    lat: incident.lat,
    lng: incident.lng,
    description: incident.description,
    respondingParamedicIds: incident.responders,
    status: incident.status,
    incidentType: incident.type,
    photoUrl: incident.photoUrl,
    photoUrls: incident.photoUrls,
    reportedBy: incident.reportedBy,
    reporterPhone: incident.reporterPhone,
    patientBib: incident.patientBib,
    patientName: incident.patientName,
    patientPhone: incident.patientPhone,
    allergies: incident.allergies,
    medications: incident.medications,
    bloodType: incident.bloodType,
    conditions: incident.conditions,
    createdBy: incident.createdBy,
    createdAt: incident.createdAt,
  };
}

export function poiToMarker(poi: PoiResponse) {
  return {
    id: poi.id,
    type: "infrastructure" as const,
    label: poi.name ?? poi.type,
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    poiType: poi.type,
    poiIcon: poi.icon,
    poiDescription: poi.description,
    poiArchived: poi.archived,
  };
}

/** Last-known medic position → marker, with its freshness ring resolved. */
export function activeMedicToMarker(medic: MedicActiveResponse) {
  const ageMs = medic.lastSeenAt ? Date.now() - new Date(medic.lastSeenAt).getTime() : undefined;
  return {
    id: medic.medicId,
    type: "paramedic" as const,
    label: medic.name ?? medic.medicId,
    name: medic.name,
    vehicleType: medic.vehicleType,
    lat: medic.lat,
    lng: medic.lng,
    accuracy: medic.accuracy,
    battery: medic.battery,
    charging: medic.charging,
    staleState: freshnessBucket(ageMs),
    lastSeenAt: medic.lastSeenAt,
    status: medic.status,
    destination: medic.destination ?? null,
    route: medic.route ?? null,
  };
}
