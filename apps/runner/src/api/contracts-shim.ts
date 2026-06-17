/**
 * Re-exports from the shared contracts package, plus a few response shapes that
 * live in the backend (EventTrack, IncidentRecord) and aren't exported there.
 */
export type {
  AbcStep,
  CreateIncidentRequest,
  GuidanceRequest,
  GuidanceResponse,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
  JoinEventRequest,
  ParticipantLocationRequest,
  PublicMedicState,
  SessionPayload,
  TrackGeoJson,
} from "@events/contracts";

export interface EventTrackLike {
  id: string;
  label: string;
  color?: string;
  points: Array<{ lat: number; lng: number }>;
  elevationProfile: {
    totalAscentMeters: number;
    totalDescentMeters: number;
    maxElevationMeters: number | null;
    minElevationMeters: number | null;
    segmentSlopes: number[];
    sections: Array<{
      type: "climb" | "descent";
      startIndex: number;
      endIndex: number;
      distanceMeters: number;
      elevationChangeMeters: number;
    }>;
  };
}

export interface IncidentRecordLike {
  id: string;
  eventId: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  category?: string;
  severity?: string;
  status: string;
  responders: string[];
  createdAt: string;
}
