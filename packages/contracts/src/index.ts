export type UserRole = "runner" | "paramedic" | "coordinator" | "spectator" | "medic";

/**
 * What a medic is travelling with. This drives the routing profile used to
 * estimate how fast they can reach an incident, so the set is deliberately
 * ordered slowest → fastest-on-road and every medic always has one ("foot").
 */
export type VehicleType =
  | "foot"
  | "bike"
  | "e-bike"
  | "e-motorcycle"
  | "motorcycle"
  | "atv"
  | "car"
  | "offroad-car"
  | "ambulance"
  | "offroad-ambulance";

/** Canonical order — used for every picker so the lists never disagree. */
export const VEHICLE_TYPES: VehicleType[] = [
  "foot",
  "bike",
  "e-bike",
  "e-motorcycle",
  "motorcycle",
  "atv",
  "car",
  "offroad-car",
  "ambulance",
  "offroad-ambulance",
];

/** Everyone is on foot until someone says otherwise. */
export const DEFAULT_VEHICLE_TYPE: VehicleType = "foot";

export interface VehicleTypeMeta {
  label: string;
  /** Emoji glyph — the one visual the mobile app, dashboard and PWA share. */
  icon: string;
  /** True when the vehicle can leave the road network. */
  offroad: boolean;
}

export const VEHICLE_TYPE_META: Record<VehicleType, VehicleTypeMeta> = {
  foot: { label: "On foot", icon: "🚶", offroad: true },
  bike: { label: "Bike", icon: "🚲", offroad: true },
  // The electric pair carry a bolt so they read apart from their petrol/pedal
  // counterparts at a glance — a lone ⚡ said nothing about what it was on.
  "e-bike": { label: "E-bike", icon: "⚡🚲", offroad: true },
  // A light electric enduro bike — near-silent, very agile, and narrow enough
  // to take foot paths, which is what separates it from the petrol motorcycle.
  "e-motorcycle": { label: "E-motorcycle", icon: "⚡🏍", offroad: true },
  motorcycle: { label: "Motorcycle", icon: "🏍", offroad: true },
  atv: { label: "ATV", icon: "🛻", offroad: true },
  car: { label: "Car", icon: "🚗", offroad: false },
  "offroad-car": { label: "Offroad car", icon: "🚙", offroad: true },
  ambulance: { label: "Ambulance", icon: "🚑", offroad: false },
  "offroad-ambulance": { label: "Offroad ambulance", icon: "🚐", offroad: true },
};

/**
 * Coerce anything stored in the legacy free-text `vehicle` column (or sent by an
 * older client) into a canonical type. Rosters created before typed vehicles
 * hold values like "Ambulance Type B" or "Rapid Response SUV", and the event
 * builder used to copy the medic's *position* ("Mobile", a camp name) in there —
 * anything unrecognised falls back to {@link DEFAULT_VEHICLE_TYPE}.
 */
export function normalizeVehicleType(value: unknown): VehicleType {
  if (typeof value !== "string") return DEFAULT_VEHICLE_TYPE;
  const raw = value.trim().toLowerCase();
  if (!raw) return DEFAULT_VEHICLE_TYPE;
  if ((VEHICLE_TYPES as string[]).includes(raw)) return raw as VehicleType;

  // Legacy spellings from the first VehicleType union.
  if (raw === "bicycle") return "bike";
  if (raw === "electric-motorcycle") return "e-motorcycle";
  if (raw === "suv") return "offroad-car";

  // Free text, longest/most specific match first ("offroad ambulance" must not
  // be swallowed by the plain "ambulance" test).
  const has = (...needles: string[]) => needles.some((n) => raw.includes(n));
  const offroad = has("offroad", "off-road", "off road", "4x4", "4wd", "suv");
  if (has("ambulance")) return offroad ? "offroad-ambulance" : "ambulance";
  if (has("atv", "quad", "utv", "buggy")) return "atv";
  if (has("moto", "motorbike")) return has("e-", "electric") ? "e-motorcycle" : "motorcycle";
  if (has("bike", "bicycle", "cycl")) return has("e-", "electric") ? "e-bike" : "bike";
  if (has("car", "jeep", "van", "truck", "vehicle")) return offroad ? "offroad-car" : "car";
  if (offroad) return "offroad-car";
  if (has("foot", "walk", "pedestrian")) return "foot";
  return DEFAULT_VEHICLE_TYPE;
}

export type MedicStatus = "available" | "stationary" | "rest" | "going_to" | "sweeper";

/** Roster-level classification of a medic. */
export type MedicType = "coordinator" | "paramedic" | "medic";

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface JoinEventRequest {
  joinCode: string;
  /** Runner name (required when role = runner) */
  name?: string;
  bibNumber?: string;
  phone?: string;
  /** "external" = a guest (organizer / external responder) who types their own
   *  name instead of picking from the roster; granted medic-level access. */
  role?: "runner" | "medic" | "external";
  /** Medic roster ID (required when role = medic) */
  medicId?: string;
}

export interface SessionPayload {
  eventId: string;
  userId: string;
  role: UserRole;
  /** Display name, present for medics and optionally for runners */
  name?: string;
}

// ─── Medic roster ────────────────────────────────────────────────────────────

export interface EventMedic {
  id: string;
  eventId: string;
  name: string;
  unit?: string;
  /** Free-text unit/position label ("Mobile", "Base camp") — display only. */
  vehicle?: string;
  /** What they travel with. Always set; defaults to "foot". */
  vehicleType: VehicleType;
  type?: MedicType;
  /** Medical skills, e.g. "ALS", "Paediatrics" */
  skills?: string[];
  /** Equipment / capabilities the medic can deploy, e.g. "AED", "O2" */
  capabilities?: string[];
}

export interface AddMedicRequest {
  name: string;
  unit?: string;
  vehicle?: string;
  vehicleType?: VehicleType;
  type?: MedicType;
  skills?: string[];
  capabilities?: string[];
}

export interface UpdateMedicStatusRequest {
  status: Extract<MedicStatus, "available" | "stationary" | "rest" | "sweeper">;
}

/** Coordinators may re-vehicle anyone mid-event; medics may re-vehicle themselves. */
export interface UpdateMedicVehicleRequest {
  vehicleType: VehicleType;
}

/** Dashboard → all medics broadcast alert */
export interface BroadcastRequest {
  title: string;
  body: string;
}

// ─── Medic live state ────────────────────────────────────────────────────────

export interface MedicDestination {
  lat: number;
  lng: number;
  label: string;
}

/** Surface class for a stretch of a navigation route. */
export type RouteSurface = "road" | "offroad" | "path";

/** One colour-classified run of a navigation route, `[lng, lat]` coordinates. */
export interface MedicRouteSegment {
  surface: RouteSurface;
  coordinates: [number, number][];
}

/**
 * The active navigation path a medic is following, broadcast to every device +
 * the dashboard so the route is visible to the whole team (with surface colours
 * and an ETA), exactly as the navigating medic sees it.
 */
export interface MedicRoute {
  /** Full geometry, `[lng, lat]`. */
  geometry: [number, number][];
  /** Colour-classified runs covering the geometry. */
  segments: MedicRouteSegment[];
  distanceMeters: number;
  durationMs: number;
  /** ISO ETA computed when the route was set. */
  etaIso?: string;
  /** Whether this route leads to an incident (vs a plain point). */
  incidentId?: string | null;
}

/** Persisted + broadcast state for a single medic */
export interface MedicState {
  medicId: string;
  eventId: string;
  name: string;
  /** Roster vehicle, mirrored onto the live state so map clients don't have to
   *  join against the roster on every position update. */
  vehicleType?: VehicleType;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  /** Device battery level 0–1 at the time of the last update */
  battery?: number;
  /** Whether the device was charging at the time of the last update */
  charging?: boolean;
  status: MedicStatus;
  destination?: MedicDestination | null;
  /** Active navigation path (set while navigating), or null. */
  route?: MedicRoute | null;
  recordedAt: string;
  lastSeenAt: string;
}

/** WS message sent by a medic's device → server */
export interface WsMedicLocation {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  /** Device battery level 0–1 */
  battery?: number;
  /** Whether the device is charging */
  charging?: boolean;
}

export interface AssignMedicDestinationRequest {
  destination: MedicDestination | null;
}

// ─── Closest medic (incident dispatch) ───────────────────────────────────────

/**
 * The rank colours the drawer and the map lines share, fastest → slowest. Five
 * distinguishable hues so a glance at the map tells you which line is whose
 * without reading a label.
 */
export const CLOSEST_MEDIC_COLORS = ["#22c55e", "#a3e635", "#facc15", "#fb923c", "#ef4444"];

/** How many medics the closest-medic search ranks and draws. */
export const CLOSEST_MEDIC_LIMIT = 5;

export function closestMedicColor(rank: number): string {
  return CLOSEST_MEDIC_COLORS[Math.min(Math.max(rank, 0), CLOSEST_MEDIC_COLORS.length - 1)];
}

/** One ranked medic → incident leg, routed on that medic's own vehicle profile. */
export interface ClosestMedic {
  medicId: string;
  name: string;
  status: MedicStatus;
  vehicleType: VehicleType;
  /** Medic's position the leg was measured from. */
  lat: number;
  lng: number;
  /** 0-based rank by travel time — index into {@link CLOSEST_MEDIC_COLORS}. */
  rank: number;
  distanceMeters: number;
  durationMs: number;
  /**
   * True when no route could be built and the numbers are a straight-line
   * estimate at the vehicle's cross-country speed. The client draws these
   * dashed and says so.
   */
  direct: boolean;
  /** Already responding to this incident. */
  assigned: boolean;
  lastSeenAt?: string;
  battery?: number;
  /** Drawable, surface-classified path medic → incident. Null for `direct` legs. */
  route?: { geometry: [number, number][]; segments: MedicRouteSegment[] } | null;
}

export interface ClosestMedicsResponse {
  origin: { lat: number; lng: number };
  medics: ClosestMedic[];
  /** Medics on the roster that had no position fix and so could not be ranked. */
  unlocatedCount: number;
}

// ─── Participant location ─────────────────────────────────────────────────────

export interface ParticipantLocationRequest {
  lat: number;
  lng: number;
  accuracy?: number;
  /** Device battery level 0–1 */
  battery?: number;
  timestamp: string;
}

export interface ParticipantLastLocation {
  userId: string;
  eventId: string;
  name: string;
  bibNumber?: string;
  phone?: string;
  /** Selected course/track for this event. */
  trackId?: string;
  trackLabel?: string;
  /** Server-side medical (opted in via the runner PWA). */
  allergies?: string;
  medications?: string;
  bloodType?: string;
  conditions?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  battery?: number;
  /** ISO time of the last location fetch (undefined until the first GPS fix). */
  recordedAt?: string;
  lastSeenAt?: string;
  /** Location freshness bucket derived from `recordedAt`. */
  freshness?: "fresh" | "warning" | "stale" | "offline";
}

/** Freshness bucket type, shared by backend + both frontends so status dots
 *  and "time ago" text can never disagree. */
export type FreshnessState = "fresh" | "warning" | "stale" | "offline";

/**
 * Derive the freshness bucket for a location fix from its timestamp, using
 * "now" at call time — NOT a value computed once server-side. Callers should
 * invoke this on every render (e.g. alongside a live-updating "time ago"
 * label) rather than trusting a `freshness` field that was set when a
 * record was first fetched/pushed, since that field goes stale as time
 * passes or when only lat/lng/recordedAt are patched via a live update.
 *
 * Thresholds match the participant-roster freshness used by the dashboard
 * and mobile participant list (`MedicsService.participantFreshness`):
 *   0–2 min   → fresh
 *   2–5 min   → warning
 *   5–15 min  → stale
 *   15+ min or no fix yet (`recordedAt` undefined/invalid) → offline
 */
export function computeFreshness(recordedAt?: string): FreshnessState {
  if (!recordedAt) return "offline";
  const ageMs = Date.now() - new Date(recordedAt).getTime();
  if (!Number.isFinite(ageMs)) return "offline";
  if (ageMs < 120_000) return "fresh";
  if (ageMs < 300_000) return "warning";
  if (ageMs < 900_000) return "stale";
  return "offline";
}

/** Runner self-registration payload — name/BIB/phone/track + optional medical,
 *  stored server-side and keyed by event + BIB for incident lookups. */
export interface RegisterParticipantRequest {
  name: string;
  bibNumber?: string;
  phone?: string;
  trackId?: string;
  trackLabel?: string;
  allergies?: string;
  medications?: string;
  bloodType?: string;
  conditions?: string;
}

// ─── Zones ───────────────────────────────────────────────────────────────────

/**
 * A named, hand-drawn map region for the response team (danger areas, sectors,
 * closed sections …). Zones are NEVER exposed to participants — the API and the
 * realtime broadcasts are both medic/coordinator-only.
 */
export interface EventZone {
  id: string;
  eventId: string;
  name: string;
  /** Display colour (hex). */
  color: string;
  /** Polygon ring, `[lng, lat]`; the closing point is implicit. */
  polygon: [number, number][];
  /** Zones start hidden; the team toggles them on when relevant. */
  visible: boolean;
  /** Medic devices raise an alert when entering this zone. */
  alarm: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateZoneRequest {
  name: string;
  color?: string;
  polygon: [number, number][];
  visible?: boolean;
  alarm?: boolean;
}

export interface UpdateZoneRequest {
  name?: string;
  color?: string;
  polygon?: [number, number][];
  visible?: boolean;
  alarm?: boolean;
}

// ─── Legacy location (kept for backwards compat) ─────────────────────────────

export interface LocationUpdate {
  eventId: string;
  userId: string;
  lat: number;
  lng: number;
  accuracy?: number;
  /** Device battery level 0–1 */
  battery?: number;
  timestamp: string;
}

// ─── Incidents ───────────────────────────────────────────────────────────────

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "assigned" | "in_progress" | "resolved" | "closed";

/**
 * Standardised incident categories reported by the Runner Companion PWA. The
 * first four match the hi-fi design's 2×2 grid; the rest cover the wider range
 * of things that can happen to a runner on course. Each maps to a default
 * severity (see INCIDENT_CATEGORY_SEVERITY).
 */
export type IncidentCategory =
  | "severe_injury"
  | "chest_pain"
  | "collapse"
  | "minor_injury"
  | "heat_illness"
  | "dehydration"
  | "hypothermia"
  | "allergic_reaction"
  | "seizure"
  | "fall_trauma"
  | "lost_disoriented"
  | "other";

/** Default severity per category — drives triage colour + ordering. */
export const INCIDENT_CATEGORY_SEVERITY: Record<IncidentCategory, IncidentSeverity> = {
  severe_injury: "critical",
  chest_pain: "critical",
  collapse: "critical",
  seizure: "critical",
  allergic_reaction: "high",
  fall_trauma: "high",
  hypothermia: "high",
  heat_illness: "high",
  dehydration: "medium",
  minor_injury: "medium",
  lost_disoriented: "medium",
  other: "low",
};

export interface CreateIncidentRequest {
  eventId: string;
  lat: number;
  lng: number;
  /** Free-form label; optional when `category` is supplied (it derives one). */
  type?: string;
  description?: string;
  severity?: IncidentSeverity;
  photoUrl?: string;
  /** Standardised category from the runner PWA. */
  category?: IncidentCategory;
  /** GPS accuracy radius in metres at capture time. */
  accuracy?: number;
  /** Reporter bib number (runner PWA). */
  bibNumber?: string;
  /** Reporter display name (runner PWA). */
  runnerName?: string;
  /** Reporter (sender) phone — always attached so medics have a callback. */
  reporterPhone?: string;
  /** True when the report is for the reporter themselves (vs someone else). */
  forSelf?: boolean;
  /** Patient bib when reporting for someone else — backend looks up their
   *  phone + medical by this. */
  patientBib?: string;
  /** Patient allergies (the reporter's own when forSelf; resolved by BIB
   *  otherwise). */
  allergies?: string;
  /** Patient medications, same resolution as `allergies`. */
  medications?: string;
  /** Patient blood type, same resolution as `allergies`. */
  bloodType?: string;
  /** Patient pre-existing conditions, same resolution as `allergies`. */
  conditions?: string;
  /** Client capture time (ISO8601). */
  timestamp?: string;
}

/** Runner-facing response after creating an incident (medic dispatch summary). */
export interface CreatedIncidentResponse {
  incidentId: string;
  assignedMedicId: string | null;
  etaMinutes: number | null;
}

/**
 * Trimmed medic position safe to expose to runners — no battery, route, or
 * destination internals. Powers the runner map markers + nearest-medic pill.
 */
export interface PublicMedicState {
  medicId: string;
  name: string;
  lat: number;
  lng: number;
  status: MedicStatus;
  recordedAt: string;
}

/** Track route as GeoJSON, cacheable offline by the runner PWA. */
export interface TrackGeoJson {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    /** Coordinates are `[lng, lat]` or `[lng, lat, ele]` when elevation is known. */
    geometry: { type: "LineString"; coordinates: number[][] };
    properties: {
      trackId: string;
      label: string;
      color?: string;
      totalAscentMeters: number;
      totalDescentMeters: number;
      maxElevationMeters: number | null;
      minElevationMeters: number | null;
    };
  }>;
}

/** Guided ABC care step. */
export type AbcStep = "A" | "B" | "C";

export interface GuidanceRequest {
  transcript: string;
  category?: IncidentCategory;
}

export interface GuidanceResponse {
  currentStep: AbcStep;
  instruction: string;
  note: string;
}

/** Casualty-care summary captured when an incident is closed. */
export interface CloseIncidentRequest {
  vitals?: string;
  treatment?: string;
  transport?: string;
}

/**
 * Incident chat message kinds. `first_aid` and `cpr` are structured entries
 * logged automatically by the runner app during guided care; `handover` is the
 * casualty handover written when the incident is closed; `text` always carries
 * a human-readable fallback line for old clients.
 */
export type IncidentMessageKind = "text" | "voice" | "first_aid" | "cpr" | "system" | "handover";

export interface IncidentMessage {
  id: string;
  incidentId: string;
  eventId: string;
  authorId: string;
  authorName: string;
  text: string;
  kind?: IncidentMessageKind;
  /** Structured context for first_aid/cpr entries (question, answer, action, durationMs …). */
  meta?: Record<string, unknown>;
  photoUrl?: string;
  /** Voice note attachment (server-relative URL) and its length. */
  audioUrl?: string;
  audioDurationMs?: number;
  /** Speech-to-text transcript of a voice note, when available. */
  transcript?: string;
  createdAt: string;
}

export interface SendIncidentMessageRequest {
  text: string;
  photoUrl?: string;
  kind?: IncidentMessageKind;
  meta?: Record<string, unknown>;
}

/** Event-wide team chat. `system` messages are the live feed (incident / response / POI). */
export type EventMessageKind = "text" | "voice" | "system" | "image" | "location";
export type EventFeedType = "incident" | "response" | "poi";

/** A point shared into the chat (from the app, or relayed from a PTT channel). */
export interface EventMessageLocation {
  lat: number;
  lng: number;
  /** Reverse-geocoded street address when the sender provided one. */
  address?: string;
  /** Reported GPS accuracy in metres. */
  accuracyM?: number;
}

export interface EventMessage {
  id: string;
  eventId: string;
  /** Null for system feed messages and for anything relayed from a PTT channel. */
  authorId: string | null;
  authorName: string;
  kind: EventMessageKind;
  /** Set when kind === "system". */
  feedType?: EventFeedType;
  text?: string;
  /** Voice note attachment (server-relative URL), length, and transcript. */
  audioUrl?: string;
  audioDurationMs?: number;
  transcript?: string;
  /** Image attachment (server-relative URLs) for kind === "image". */
  imageUrl?: string;
  thumbnailUrl?: string;
  /** Shared point for kind === "location". */
  location?: EventMessageLocation;
  /** Where the message came from. Absent/"app" = written in the app itself. */
  origin?: PttMessageOrigin;
  /** The sender's handle on the external channel (Zello username, radio call sign). */
  originUser?: string;
  /** Structured context for system feed messages (incidentId / poiId / coords / severity …). */
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface SendEventMessageRequest {
  text: string;
}

export interface SendEventLocationRequest {
  lat: number;
  lng: number;
  address?: string;
  accuracyM?: number;
  text?: string;
}

// ─── PTT bridges (Zello today, digital radio next) ───────────────────────────

/**
 * An external push-to-talk network the team chat can be bridged to. Everything
 * downstream of this type is provider-agnostic on purpose: adding the digital
 * radio gateway means implementing one provider and adding a member here.
 */
export type PttChannelKind = "zello" | "radio";

export const PTT_CHANNEL_KINDS: PttChannelKind[] = ["zello", "radio"];

/** Where a chat message entered the system. */
export type PttMessageOrigin = "app" | PttChannelKind;

/** The four media types a bridge may or may not carry. */
export interface PttCapabilities {
  text: boolean;
  voice: boolean;
  image: boolean;
  location: boolean;
}

export type PttConnectionState = "disabled" | "offline" | "connecting" | "online" | "error";

/**
 * One connection config field a provider needs. The dashboard renders the form
 * straight from this list, so a new provider needs no dashboard changes.
 */
export interface PttConfigField {
  key: string;
  label: string;
  hint?: string;
  /**
   * `secret` values are never returned by the API — only whether they are set.
   * `list` holds a comma-separated set the UI edits as chips.
   */
  type: "text" | "secret" | "multiline" | "list";
  required: boolean;
  placeholder?: string;
  /**
   * Render as a dropdown whose options are the entries of another `list` field
   * — how the Zello channel is picked from the known-channels list. The Channel
   * API has no "list my channels" command, so the set is operator-maintained.
   */
  optionsFrom?: string;
}

export interface PttProviderInfo {
  kind: PttChannelKind;
  label: string;
  description: string;
  /** False for providers that are scaffolded but not yet implemented. */
  available: boolean;
  capabilities: PttCapabilities;
  fields: PttConfigField[];
}

export interface PttProviderSettings {
  kind: PttChannelKind;
  /** Master switch: whether the server holds a connection to this network at all. */
  enabled: boolean;
  /** Non-secret config values. Secrets appear in `secretsSet` instead. */
  config: Record<string, string>;
  /** Keys of secret fields that currently have a stored value. */
  secretsSet: string[];
  updatedAt: string;
}

export interface PttProviderStatus {
  kind: PttChannelKind;
  enabled: boolean;
  /** All required fields have values. */
  configured: boolean;
  state: PttConnectionState;
  /** Human-readable last error / current activity. */
  detail?: string;
  channel?: string;
  usersOnline?: number;
  connectedAt?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  /** Rolling counters since the process started. */
  inboundCount: number;
  outboundCount: number;
}

export interface UpdatePttProviderRequest {
  enabled?: boolean;
  config?: Record<string, string>;
  /** Secret keys to clear (sending an empty string in `config` keeps the old value). */
  clearSecrets?: string[];
}

/**
 * Per-event forwarding switches for one channel. The two directions are
 * independent so a coordinator can, say, listen to radio traffic without the
 * app's chatter going back out over the air.
 */
export interface PttRoute {
  kind: PttChannelKind;
  /** External channel → this event's team chat. */
  inbound: boolean;
  /** This event's team chat → external channel. */
  outbound: boolean;
}

export interface PttEventRoutes {
  eventId: string;
  routes: PttRoute[];
}

export interface UpdatePttRouteRequest {
  kind: PttChannelKind;
  inbound?: boolean;
  outbound?: boolean;
}

/** Everything the settings screens need in one round trip. */
export interface PttOverview {
  providers: PttProviderInfo[];
  settings: PttProviderSettings[];
  statuses: PttProviderStatus[];
}

export type IncidentActionType = "going" | "arrived" | "need_backup" | "resolved" | "stand_down";

export interface IncidentActionRequest {
  incidentId: string;
  action: IncidentActionType;
}

export interface RunnerSearchQuery {
  eventId: string;
  name?: string;
  bibNumber?: string;
}

export interface RealtimeEnvelope<TPayload> {
  eventId: string;
  type: string;
  payload: TPayload;
}

/**
 * Daily active-hours window for an event ("HH:mm", Europe/Sofia local time).
 * Outside this window medic locations are visible only to coordinators.
 * Overnight windows (end < start, e.g. 20:00–06:00) are supported.
 */
export interface EventActiveHours {
  start: string;
  end: string;
}

/** Diagnostic/treatment capabilities a hospital can be badged with. */
export type HospitalCapability =
  | "er"
  | "trauma"
  | "icu"
  | "ct"
  | "mri"
  | "xray"
  | "cardiology"
  | "pediatric"
  | "burn"
  | "neurology"
  | "orthopedics"
  | "surgery";

export const HOSPITAL_CAPABILITIES: HospitalCapability[] = [
  "er",
  "trauma",
  "icu",
  "ct",
  "mri",
  "xray",
  "cardiology",
  "pediatric",
  "burn",
  "neurology",
  "orthopedics",
  "surgery",
];

/** Structured working-hours rule. `days`: 0=Sunday … 6=Saturday; "HH:mm" local time. */
export interface HospitalHoursRule {
  days: number[];
  open: string;
  close: string;
}

export interface Hospital {
  id: string;
  name: string;
  nameBg?: string;
  address?: string;
  city?: string;
  lat: number;
  lng: number;
  phones: string[];
  emergency24h: boolean;
  /** Structured rules when known; `hoursText` is the raw OSM opening_hours fallback. */
  hours?: HospitalHoursRule[];
  hoursText?: string;
  capabilities: HospitalCapability[];
  notes?: string;
  source: "osm" | "manual";
  osmId?: string;
  updatedAt: string;
}

export interface UpsertHospitalRequest {
  name: string;
  nameBg?: string;
  address?: string;
  city?: string;
  lat: number;
  lng: number;
  phones?: string[];
  emergency24h?: boolean;
  hours?: HospitalHoursRule[];
  hoursText?: string;
  capabilities?: HospitalCapability[];
  notes?: string;
}
