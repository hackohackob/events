import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ExpoLocation from "expo-location";
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  type MapRef,
  Marker,
  RasterSource,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import BottomSheet, { BottomSheetScrollView, BottomSheetView } from "@gorhom/bottom-sheet";
import { IncidentFAB } from "../incidents/IncidentFAB";
import { ReportIncidentSheet } from "../incidents/ReportIncidentSheet";
import { incidentQueue } from "../incidents/persistent-incident-queue";
import { useIncidentStore } from "../incidents/incident-store";
import { getSocket } from "../realtime/socket-client";
import { apiFetch, resolveMediaUrl } from "../ui/api-client";
import { getMapyTilesTemplateUrl } from "./mapy-config";
import { useMapStore, type MedicMarkerRoute } from "./map-store";
import { useSessionStore } from "../security/session-store";
import { useRosterStore } from "../security/roster-store";
import { freshnessBucket, freshnessColor, freshnessLabel } from "./freshness";
import { LocationScreen } from "../debug/LocationScreen";
import { DebugScreen } from "../debug/DebugScreen";
import { useLocationStatus } from "../debug/location-status";
import { debugLog } from "../debug/debug-log";
import { PendingIncidentsSheet } from "../incidents/PendingIncidentsSheet";
import { Feather } from "@expo/vector-icons";
import { MedicStatusControl } from "./MedicStatusControl";
import { MedicDot } from "./MedicDot";
import { SelectionPulse } from "./SelectionPulse";
import { AssignDestinationBar } from "./AssignDestinationBar";
import { IncidentSheet } from "../incidents/IncidentSheet";
import * as Haptics from "expo-haptics";
import { NewPoiSheet } from "./NewPoiSheet";
import { SettingsScreen } from "../settings/SettingsScreen";
import { FieldGuideScreen } from "../guide/FieldGuideScreen";
import { useSettingsStore } from "../settings/settings-store";
import { useTrackingHealth } from "../location/tracking-health";
import { archivePoi, assignDestination, setMyRoute, type PoiDto } from "../ui/event-actions";
import { OfflineControlButton } from "./OfflineControlButton";
import { showBroadcastNotification } from "../notifications/broadcast-notification";
import { useNotificationFocus } from "../notifications/notification-focus";
import { useNavStore } from "../navigation/nav-store";
import { useNavigationCamera } from "../navigation/useNavigationCamera";
import { NavigationMapLayers } from "../navigation/NavigationMapLayers";
import { MedicRoutesLayer } from "../navigation/MedicRoutesLayer";
import { AssignedRoutesLayer } from "../navigation/AssignedRoutesLayer";
import { AssignedIncidentBanner } from "../navigation/AssignedIncidentBanner";
import { NavRadialMenu, type RadialAnchor } from "../navigation/NavRadialMenu";
import { TransportSheet } from "../navigation/TransportSheet";
import { RouteVariantsOverlay } from "../navigation/RouteVariantsOverlay";
import { RouteEditingSheet, RouteEditHelperBanner } from "../navigation/RouteEditingSheet";
import { ActiveNavOverlay } from "../navigation/ActiveNavOverlay";
import { startIncidentReport } from "../incidents/start-report";

const CURRENT_USER_ID = "mobile-user";
const FALLBACK_LAT = 42.6977;
const FALLBACK_LNG = 23.3219;
const FALLBACK_ZOOM = 12.4;
const USER_FOCUS_ZOOM = 15.8;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const SCREEN_WIDTH = Dimensions.get("window").width;
const SHEET_TOP_MARGIN_EXPANDED = 88;
const BOTTOM_BAR_HEIGHT = 60;
const SHEET_PEEK_HEIGHT = 320;
const SHEET_HEIGHT = Math.max(320, SCREEN_HEIGHT - SHEET_TOP_MARGIN_EXPANDED - BOTTOM_BAR_HEIGHT);
const SHEET_EXPANDED_Y = 0;
const SHEET_COLLAPSED_Y = Math.max(0, SHEET_HEIGHT - SHEET_PEEK_HEIGHT);
const SHEET_HIDDEN_Y = SHEET_HEIGHT + 40;
const MARKER_SHEET_SNAP_POINTS = ["42%", "88%"];
const TRACK_SHEET_SNAP_POINTS = ["46%", "84%"];
const USE_MAPY_TILES = process.env.EXPO_PUBLIC_USE_MAPY_TILES === "true";
const TRACK_STUDIO_CAMERA_PADDING = {
  top: 92,
  right: 28,
  bottom: 330,
  left: 28,
};

type AppViewMode = "runner" | "paramedic";

interface EventTrackResponse {
  id: string;
  label: string;
  color?: string;
  points: Array<{ lat: number; lng: number }>;
  elevationProfile?: {
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

interface NormalizedTrackPoint {
  lat: number;
  lng: number;
  ele?: number;
}

interface EventLocationResponse {
  eventId: string;
  userId: string;
  lat: number;
  lng: number;
  timestamp: string;
  freshness: "fresh" | "warning" | "stale" | "offline";
  type?: "runner" | "paramedic" | "incident";
  label?: string;
  name?: string;
  bibNumber?: string;
  vehicle?: string;
  avatarUrl?: string;
  description?: string;
  respondingIncidentId?: string;
  respondingParamedicIds?: string[];
}

interface MedicActiveResponse {
  medicId: string;
  eventId: string;
  name: string;
  lat: number;
  lng: number;
  accuracy?: number;
  battery?: number;
  status?: string;
  destination?: { lat: number; lng: number; label: string } | null;
  route?: MedicMarkerRoute | null;
  recordedAt?: string;
  lastSeenAt?: string;
}

interface IncidentResponse {
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
  createdAt?: string;
}

function incidentToMarker(incident: IncidentResponse) {
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
    createdAt: incident.createdAt,
  };
}

function poiToMarker(poi: { id: string; type: string; lat: number; lng: number; name?: string; description?: string }) {
  return {
    id: poi.id,
    type: "infrastructure" as const,
    label: poi.name ?? poi.type,
    name: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    poiType: poi.type,
    poiDescription: poi.description,
  };
}

/** Resolved/closed incidents stay on the map but render grey instead of red. */
function isClosedIncidentStatus(status?: string): boolean {
  return status === "resolved" || status === "closed";
}

/** Archived incidents are removed from the active map entirely. */
function isArchivedIncidentStatus(status?: string): boolean {
  return status === "archived";
}

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  medical: "Medical",
  cardiac: "Cardiac",
  trauma: "Trauma",
  fracture: "Fracture",
  unconscious: "Unconscious",
  other: "Other",
};
function incidentTypeLabel(type?: string): string {
  if (!type) return "Incident";
  return INCIDENT_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: "Reported live",
  assigned: "Responder assigned",
  in_progress: "On scene",
  resolved: "Resolved",
  closed: "Closed",
  archived: "Archived",
};
function incidentStatusLabel(status?: string): string {
  if (!status) return "Reported live";
  return INCIDENT_STATUS_LABELS[status] ?? status;
}

interface LayerVisibility {
  participants: boolean;
  participantsHeatmap: boolean;
  paramedics: boolean;
  incidents: boolean;
}

/** Participants display: hidden, individual dots, or aggregated heatmap. */
type ParticipantsMode = "off" | "individual" | "heatmap";

/** Selectable base map. */
type BaseLayer = "regular" | "terrain" | "satellite";

const BASE_LAYERS: Record<BaseLayer, { label: string; icon: keyof typeof Feather.glyphMap; tiles?: string; tileSize?: number; maxZoom: number }> = {
  // `regular` tiles are resolved at runtime (Mapy key or OSM fallback).
  regular: { label: "Regular", icon: "map", maxZoom: 19 },
  terrain: { label: "Terrain", icon: "triangle", tiles: "https://tile.opentopomap.org/{z}/{x}/{y}.png", tileSize: 256, maxZoom: 17 },
  satellite: {
    label: "Satellite",
    icon: "globe",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    tileSize: 256,
    maxZoom: 19,
  },
};

type TrackVisibility = Record<string, boolean>;

interface TrackVisual {
  id: string;
  label: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
  lineOffset: number;
  color: string;
  gradientSegments: Array<{ coordinates: Array<{ latitude: number; longitude: number }>; color: string }>;
}

interface TrackProfilePoint {
  progress: number;
  distanceMeters: number;
  elevationMeters: number;
  lat: number;
  lng: number;
}

interface TrackProfileData {
  points: TrackProfilePoint[];
  totalDistanceMeters: number;
  minElevationMeters: number;
  maxElevationMeters: number;
}

type TrackElevationSection = NonNullable<EventTrackResponse["elevationProfile"]>["sections"][number];

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTrackPoint(candidate: unknown): NormalizedTrackPoint | null {
  if (Array.isArray(candidate)) {
    const lng = toFiniteNumber(candidate[0]);
    const lat = toFiniteNumber(candidate[1]);
    if (lat === null || lng === null) {
      return null;
    }
    const ele = toFiniteNumber(candidate[2]);
    return {
      lat,
      lng,
      ele: ele ?? undefined,
    };
  }

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const point = candidate as Record<string, unknown>;
  const lat = toFiniteNumber(point.lat ?? point.latitude);
  const lng = toFiniteNumber(point.lng ?? point.lon ?? point.longitude ?? point.long);
  if (lat === null || lng === null) {
    return null;
  }

  const ele = toFiniteNumber(point.ele ?? point.elevation ?? point.altitude ?? point.alt);
  return {
    lat,
    lng,
    ele: ele ?? undefined,
  };
}

function normalizeTrackPoints(source: unknown): NormalizedTrackPoint[] {
  if (!Array.isArray(source)) {
    return [];
  }
  return source.map((item) => normalizeTrackPoint(item)).filter((item): item is NormalizedTrackPoint => Boolean(item));
}

function hasElevationSignal(profile: EventTrackResponse["elevationProfile"] | undefined): boolean {
  if (!profile) {
    return false;
  }
  if (profile.segmentSlopes.some((slope) => Math.abs(slope) > 0.000001)) {
    return true;
  }
  return profile.sections.some((section) => Math.abs(section.elevationChangeMeters) > 0.000001);
}

function mergeTracksPreservingElevation(
  incomingTracks: EventTrackResponse[],
  existingTracks: EventTrackResponse[],
): EventTrackResponse[] {
  if (incomingTracks.length === 0) {
    return incomingTracks;
  }
  const existingById = new Map(existingTracks.map((track) => [track.id, track]));
  return incomingTracks.map((track) => {
    if (hasElevationSignal(track.elevationProfile)) {
      return track;
    }
    const existing = existingById.get(track.id);
    if (!existing || !hasElevationSignal(existing.elevationProfile)) {
      return track;
    }
    return {
      ...track,
      elevationProfile: existing.elevationProfile,
    };
  });
}

function pushSectionIfMeaningful(
  sections: TrackElevationSection[],
  section: {
    type: "climb" | "descent";
    startIndex: number;
    endIndex: number;
    distanceMeters: number;
    elevationChangeMeters: number;
  },
): void {
  const meaningfulDistance = section.distanceMeters >= 80;
  const meaningfulElevation = Math.abs(section.elevationChangeMeters) >= 4;
  if (!meaningfulDistance && !meaningfulElevation) {
    return;
  }
  sections.push({
    type: section.type,
    startIndex: section.startIndex,
    endIndex: section.endIndex,
    distanceMeters: Math.round(section.distanceMeters),
    elevationChangeMeters: Math.round(section.elevationChangeMeters * 10) / 10,
  });
}

function buildElevationProfileFromPoints(
  points: NormalizedTrackPoint[],
): EventTrackResponse["elevationProfile"] | undefined {
  if (points.length < 2) {
    return undefined;
  }

  const elevations = points.map((point) => point.ele).filter((ele): ele is number => Number.isFinite(ele));
  if (elevations.length < 2) {
    return undefined;
  }

  let totalAscentMeters = 0;
  let totalDescentMeters = 0;
  const segmentSlopes: number[] = [];
  const sections: TrackElevationSection[] = [];

  let currentSection:
    | {
        type: "climb" | "descent";
        startIndex: number;
        endIndex: number;
        distanceMeters: number;
        elevationChangeMeters: number;
      }
    | null = null;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const distanceMeters = Math.max(
      pointDistanceMeters({ lat: current.lat, lng: current.lng }, { lat: next.lat, lng: next.lng }),
      1,
    );
    const eleCurrent = current.ele ?? next.ele;
    const eleNext = next.ele ?? current.ele;
    const hasElevation = typeof eleCurrent === "number" && typeof eleNext === "number";
    const elevationDelta = hasElevation ? eleNext - eleCurrent : 0;
    const gradePercent = (elevationDelta / distanceMeters) * 100;
    const normalizedSlope = Math.max(-1, Math.min(1, gradePercent / 16));
    segmentSlopes.push(normalizedSlope);

    if (elevationDelta > 0) {
      totalAscentMeters += elevationDelta;
    } else if (elevationDelta < 0) {
      totalDescentMeters += Math.abs(elevationDelta);
    }

    const nextType = elevationDelta >= 1 ? "climb" : elevationDelta <= -1 ? "descent" : null;
    if (!nextType) {
      if (currentSection) {
        pushSectionIfMeaningful(sections, currentSection);
        currentSection = null;
      }
      continue;
    }

    if (!currentSection) {
      currentSection = {
        type: nextType,
        startIndex: index,
        endIndex: index + 1,
        distanceMeters,
        elevationChangeMeters: elevationDelta,
      };
      continue;
    }

    if (currentSection.type === nextType) {
      currentSection.endIndex = index + 1;
      currentSection.distanceMeters += distanceMeters;
      currentSection.elevationChangeMeters += elevationDelta;
    } else {
      pushSectionIfMeaningful(sections, currentSection);
      currentSection = {
        type: nextType,
        startIndex: index,
        endIndex: index + 1,
        distanceMeters,
        elevationChangeMeters: elevationDelta,
      };
    }
  }

  if (currentSection) {
    pushSectionIfMeaningful(sections, currentSection);
  }

  return {
    totalAscentMeters: Math.round(totalAscentMeters),
    totalDescentMeters: Math.round(totalDescentMeters),
    maxElevationMeters: Math.round(Math.max(...elevations)),
    minElevationMeters: Math.round(Math.min(...elevations)),
    segmentSlopes,
    sections,
  };
}

function normalizeElevationProfile(
  candidate: unknown,
  normalizedPoints: NormalizedTrackPoint[],
): EventTrackResponse["elevationProfile"] | undefined {
  const fallbackProfile = buildElevationProfileFromPoints(normalizedPoints);
  if (!candidate || typeof candidate !== "object") {
    return fallbackProfile;
  }

  const raw = candidate as Record<string, unknown>;
  const segmentSlopes = Array.isArray(raw.segmentSlopes)
    ? raw.segmentSlopes.map((value) => toFiniteNumber(value)).filter((value): value is number => value !== null)
    : [];
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = rawSections
    .map((section) => {
      if (!section || typeof section !== "object") {
        return null;
      }
      const item = section as Record<string, unknown>;
      const type = item.type === "climb" || item.type === "descent" ? item.type : null;
      const startIndex = toFiniteNumber(item.startIndex);
      const endIndex = toFiniteNumber(item.endIndex);
      const distanceMeters = toFiniteNumber(item.distanceMeters);
      const elevationChangeMeters = toFiniteNumber(item.elevationChangeMeters);
      if (
        type === null ||
        startIndex === null ||
        endIndex === null ||
        distanceMeters === null ||
        elevationChangeMeters === null
      ) {
        return null;
      }
      return {
        type,
        startIndex: Math.max(0, Math.round(startIndex)),
        endIndex: Math.max(0, Math.round(endIndex)),
        distanceMeters,
        elevationChangeMeters,
      } satisfies TrackElevationSection;
    })
    .filter((section): section is TrackElevationSection => Boolean(section));

  const minElevationMetersRaw = raw.minElevationMeters;
  const maxElevationMetersRaw = raw.maxElevationMeters;
  const minElevationMeters =
    minElevationMetersRaw === null ? null : (toFiniteNumber(minElevationMetersRaw) ?? fallbackProfile?.minElevationMeters ?? null);
  const maxElevationMeters =
    maxElevationMetersRaw === null ? null : (toFiniteNumber(maxElevationMetersRaw) ?? fallbackProfile?.maxElevationMeters ?? null);

  const totalAscentMeters = toFiniteNumber(raw.totalAscentMeters) ?? fallbackProfile?.totalAscentMeters ?? 0;
  const totalDescentMeters = toFiniteNumber(raw.totalDescentMeters) ?? fallbackProfile?.totalDescentMeters ?? 0;
  const normalized: EventTrackResponse["elevationProfile"] = {
    totalAscentMeters,
    totalDescentMeters,
    maxElevationMeters,
    minElevationMeters,
    segmentSlopes,
    sections,
  };

  if (!hasElevationSignal(normalized) && fallbackProfile && hasElevationSignal(fallbackProfile)) {
    return fallbackProfile;
  }
  return normalized;
}

function normalizeTrack(track: unknown, index: number): EventTrackResponse | null {
  if (!track || typeof track !== "object") {
    return null;
  }

  const raw = track as Record<string, unknown>;
  const idCandidate = raw.id;
  const labelCandidate = raw.label ?? raw.name;
  const id = typeof idCandidate === "string" && idCandidate.length > 0 ? idCandidate : `track-${index + 1}`;
  const label = typeof labelCandidate === "string" && labelCandidate.length > 0 ? labelCandidate : id;

  const pointsFromPoints = normalizeTrackPoints(raw.points);
  const geometry = raw.geometry && typeof raw.geometry === "object" ? (raw.geometry as Record<string, unknown>) : null;
  const pointsFromGeometry = normalizeTrackPoints(geometry?.coordinates);
  const pointsFromCoordinates = normalizeTrackPoints(raw.coordinates);
  const normalizedPoints = pointsFromPoints.length > 0 ? pointsFromPoints : pointsFromGeometry.length > 0 ? pointsFromGeometry : pointsFromCoordinates;
  if (normalizedPoints.length < 2) {
    return null;
  }

  const color = typeof raw.color === "string" && raw.color.length > 0 ? raw.color : undefined;

  return {
    id,
    label,
    color,
    points: normalizedPoints.map((point) => ({ lat: point.lat, lng: point.lng })),
    elevationProfile: normalizeElevationProfile(raw.elevationProfile, normalizedPoints),
  };
}

const ELEVATION_ENRICHMENT_SAMPLE_POINTS = 140;
const ELEVATION_API_BATCH_SIZE = 50;
const ELEVATION_API_RETRY_ATTEMPTS = 3;

function buildSampleIndices(pointCount: number, targetSampleCount: number): number[] {
  if (pointCount <= 0) {
    return [];
  }
  const sampleCount = Math.max(2, Math.min(pointCount, targetSampleCount));
  const indices = new Set<number>();
  for (let index = 0; index < sampleCount; index += 1) {
    const ratio = sampleCount <= 1 ? 0 : index / (sampleCount - 1);
    indices.add(Math.round(ratio * (pointCount - 1)));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

function interpolatePointElevations(
  sampleIndices: number[],
  sampleElevations: number[],
  pointCount: number,
): number[] {
  if (pointCount <= 0) {
    return [];
  }
  if (sampleIndices.length === 0 || sampleElevations.length === 0) {
    return Array.from({ length: pointCount }, () => 0);
  }
  if (sampleIndices.length === 1 || sampleElevations.length === 1) {
    return Array.from({ length: pointCount }, () => sampleElevations[0] ?? 0);
  }

  const elevations = Array.from({ length: pointCount }, () => sampleElevations[0] ?? 0);
  let segmentCursor = 0;
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    while (
      segmentCursor < sampleIndices.length - 2 &&
      pointIndex > sampleIndices[segmentCursor + 1]
    ) {
      segmentCursor += 1;
    }

    const startIndex = sampleIndices[segmentCursor] ?? 0;
    const endIndex = sampleIndices[Math.min(sampleIndices.length - 1, segmentCursor + 1)] ?? startIndex;
    const startElevation = sampleElevations[segmentCursor] ?? sampleElevations[0] ?? 0;
    const endElevation =
      sampleElevations[Math.min(sampleElevations.length - 1, segmentCursor + 1)] ??
      sampleElevations[sampleElevations.length - 1] ??
      startElevation;
    if (endIndex <= startIndex) {
      elevations[pointIndex] = startElevation;
      continue;
    }
    const ratio = Math.max(0, Math.min(1, (pointIndex - startIndex) / (endIndex - startIndex)));
    elevations[pointIndex] = startElevation + (endElevation - startElevation) * ratio;
  }

  return elevations;
}

async function fetchElevationValues(points: Array<{ lat: number; lng: number }>): Promise<number[] | null> {
  if (points.length === 0) {
    return [];
  }

  const values: number[] = [];
  for (let offset = 0; offset < points.length; offset += ELEVATION_API_BATCH_SIZE) {
    const batch = points.slice(offset, offset + ELEVATION_API_BATCH_SIZE);
    const latParam = batch.map((point) => point.lat.toFixed(6)).join(",");
    const lngParam = batch.map((point) => point.lng.toFixed(6)).join(",");
    let batchValues: number[] | null = null;
    for (let attempt = 0; attempt < ELEVATION_API_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${latParam}&longitude=${lngParam}`,
        );
        if (!response.ok) {
          if (attempt < ELEVATION_API_RETRY_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
            continue;
          }
          return null;
        }
        const body = (await response.json()) as { elevation?: unknown };
        if (!Array.isArray(body.elevation)) {
          if (attempt < ELEVATION_API_RETRY_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
            continue;
          }
          return null;
        }
        const normalizedBatch = body.elevation
          .map((value) => toFiniteNumber(value))
          .filter((value): value is number => value !== null);
        if (normalizedBatch.length !== batch.length) {
          if (attempt < ELEVATION_API_RETRY_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
            continue;
          }
          return null;
        }
        batchValues = normalizedBatch;
        break;
      } catch {
        if (attempt < ELEVATION_API_RETRY_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
          continue;
        }
        return null;
      }
    }
    if (!batchValues) {
      return null;
    }
    values.push(...batchValues);
  }

  return values.length === points.length ? values : null;
}

async function enrichTrackElevationProfile(track: EventTrackResponse): Promise<EventTrackResponse> {
  if (track.points.length < 2) {
    return track;
  }

  if (
    hasElevationSignal(track.elevationProfile) &&
    track.elevationProfile?.minElevationMeters !== null &&
    track.elevationProfile?.minElevationMeters !== undefined &&
    track.elevationProfile?.maxElevationMeters !== null &&
    track.elevationProfile?.maxElevationMeters !== undefined
  ) {
    return track;
  }

  const sampleTargets = [
    ELEVATION_ENRICHMENT_SAMPLE_POINTS,
    Math.min(track.points.length, 96),
    Math.min(track.points.length, 56),
  ].filter((value, index, arr) => value >= 2 && arr.indexOf(value) === index);

  for (const sampleTarget of sampleTargets) {
    const sampleIndices = buildSampleIndices(track.points.length, sampleTarget);
    const sampledPoints = sampleIndices.map((index) => track.points[index]).filter(Boolean);
    const sampledElevations = await fetchElevationValues(sampledPoints);
    if (!sampledElevations || sampledElevations.length !== sampleIndices.length) {
      continue;
    }

    const pointElevations = interpolatePointElevations(sampleIndices, sampledElevations, track.points.length);
    const pointsWithElevation = track.points.map((point, index) => ({
      lat: point.lat,
      lng: point.lng,
      ele: pointElevations[index],
    }));
    const computedProfile = buildElevationProfileFromPoints(pointsWithElevation);
    if (!computedProfile || !hasElevationSignal(computedProfile)) {
      continue;
    }

    return {
      ...track,
      elevationProfile: computedProfile,
    };
  }

  return track;
}

async function enrichTracksElevationProfiles(tracks: EventTrackResponse[]): Promise<EventTrackResponse[]> {
  if (tracks.length === 0) {
    return tracks;
  }
  const enriched: EventTrackResponse[] = [];
  for (const track of tracks) {
    enriched.push(await enrichTrackElevationProfile(track));
  }
  return enriched;
}

interface RunnerHeatFeature {
  type: "Feature";
  properties: {
    count: number;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

interface LineFeature {
  type: "Feature";
  properties: Record<string, never>;
  geometry: {
    type: "LineString";
    coordinates: Array<[number, number]>;
  };
}

interface FeatureCollection<TFeature> {
  type: "FeatureCollection";
  features: TFeature[];
}

const MARKER_RENDER_PRIORITY: Record<"runner" | "incident" | "paramedic" | "infrastructure", number> = {
  runner: 0,
  infrastructure: 0,
  incident: 1,
  paramedic: 2,
};

function markerInitials(label: string): string {
  const words = (label ?? "")
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return "PM";
}

function distanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function pointDistanceMeters(
  pointA: { lat: number; lng: number },
  pointB: { lat: number; lng: number },
): number {
  return distanceKm(pointA.lat, pointA.lng, pointB.lat, pointB.lng) * 1000;
}

/**
 * True only for a usable, finite lng/lat pair. Native map Markers crash with a
 * null-cast error if handed a null/undefined/NaN coordinate, so every marker is
 * filtered through this before rendering.
 */
function isFiniteCoord(lng: unknown, lat: unknown): boolean {
  return typeof lng === "number" && typeof lat === "number" && Number.isFinite(lng) && Number.isFinite(lat);
}

function trackColor(trackId: string): string {
  if (trackId.includes("10")) {
    return "#22c55e";
  }
  if (trackId.includes("21")) {
    return "#7c63ff";
  }
  if (trackId.includes("42")) {
    return "#ff3d61";
  }
  return "#14b8a6";
}

function buildSegmentSlopesFromSections(
  sections: TrackElevationSection[],
  segmentCount: number,
): number[] {
  if (segmentCount <= 0) {
    return [];
  }

  const slopes = Array.from({ length: segmentCount }, () => 0);
  for (const section of sections) {
    const startSegmentIndex = Math.max(0, Math.min(segmentCount - 1, section.startIndex));
    const endSegmentExclusive = Math.max(
      startSegmentIndex + 1,
      Math.min(segmentCount, section.endIndex),
    );
    const segmentLength = endSegmentExclusive - startSegmentIndex;
    if (segmentLength <= 0 || section.distanceMeters <= 0) {
      continue;
    }

    const slopePerMeter = section.elevationChangeMeters / section.distanceMeters;
    for (let index = startSegmentIndex; index < endSegmentExclusive; index += 1) {
      slopes[index] = slopePerMeter;
    }
  }

  return slopes;
}

function mixHexColor(baseHex: string, mixHex: string, ratio: number): string {
  const clampRatio = Math.max(0, Math.min(1, ratio));
  const base = baseHex.replace("#", "");
  const mix = mixHex.replace("#", "");
  const baseInt = Number.parseInt(base, 16);
  const mixInt = Number.parseInt(mix, 16);
  const baseR = (baseInt >> 16) & 0xff;
  const baseG = (baseInt >> 8) & 0xff;
  const baseB = baseInt & 0xff;
  const mixR = (mixInt >> 16) & 0xff;
  const mixG = (mixInt >> 8) & 0xff;
  const mixB = mixInt & 0xff;

  const red = Math.round(baseR + (mixR - baseR) * clampRatio);
  const green = Math.round(baseG + (mixG - baseG) * clampRatio);
  const blue = Math.round(baseB + (mixB - baseB) * clampRatio);
  return `rgb(${red}, ${green}, ${blue})`;
}

function slopeColor(baseColor: string, normalizedSlope: number): string {
  if (normalizedSlope > 0) {
    return mixHexColor(baseColor, "#141d2a", Math.min(0.45, normalizedSlope * 0.45));
  }
  if (normalizedSlope < 0) {
    return mixHexColor(baseColor, "#f1f4f9", Math.min(0.49, Math.abs(normalizedSlope) * 0.49));
  }
  return baseColor;
}

function normalizedSegmentSlopes(rawSlopes: number[], segmentCount: number): number[] {
  if (segmentCount <= 0) {
    return [];
  }
  if (rawSlopes.length === 0) {
    return Array.from({ length: segmentCount }, () => 0);
  }
  if (rawSlopes.length === segmentCount) {
    return rawSlopes;
  }
  if (rawSlopes.length === segmentCount + 1) {
    return rawSlopes.slice(0, segmentCount);
  }

  if (segmentCount === 1) {
    return [rawSlopes[0] ?? 0];
  }

  return Array.from({ length: segmentCount }, (_, index) => {
    const sourceIndex = Math.round((index / (segmentCount - 1)) * (rawSlopes.length - 1));
    return rawSlopes[sourceIndex] ?? 0;
  });
}

function normalizedSlopeToGradeRatio(normalizedSlope: number): number {
  return normalizedSlope * 0.16;
}

function gradeRatioToNormalizedSlope(gradeRatio: number): number {
  return Math.max(-1, Math.min(1, gradeRatio / 0.16));
}

function getTrackSegmentNormalizedSlopes(track: EventTrackResponse, segmentCount: number): number[] {
  const rawNormalized = normalizedSegmentSlopes(track.elevationProfile?.segmentSlopes ?? [], segmentCount);
  const rawHasSignal = rawNormalized.some((value) => Math.abs(value) > 0.000001);
  if (rawHasSignal) {
    return rawNormalized;
  }

  const sectionGradeRatios = buildSegmentSlopesFromSections(track.elevationProfile?.sections ?? [], segmentCount);
  const sectionHasSignal = sectionGradeRatios.some((value) => Math.abs(value) > 0.000001);
  if (sectionHasSignal) {
    return sectionGradeRatios.map(gradeRatioToNormalizedSlope);
  }

  return rawNormalized;
}

function getTrackSegmentGradeRatios(track: EventTrackResponse, segmentCount: number): number[] {
  const rawNormalized = normalizedSegmentSlopes(track.elevationProfile?.segmentSlopes ?? [], segmentCount);
  const rawHasSignal = rawNormalized.some((value) => Math.abs(value) > 0.000001);
  if (rawHasSignal) {
    return rawNormalized.map(normalizedSlopeToGradeRatio);
  }

  return buildSegmentSlopesFromSections(track.elevationProfile?.sections ?? [], segmentCount);
}

function buildTrackGradientSegments(
  track: EventTrackResponse,
  coordinates: Array<{ latitude: number; longitude: number }>,
  baseColor: string,
): Array<{ coordinates: Array<{ latitude: number; longitude: number }>; color: string }> {
  if (coordinates.length < 2) {
    return [{ coordinates, color: baseColor }];
  }

  const segmentCount = coordinates.length - 1;
  const rawSlopes = getTrackSegmentNormalizedSlopes(track, segmentCount);
  const gradientBucketCount = Math.max(
    TRACK_GRADIENT_MIN_BUCKETS,
    Math.min(TRACK_GRADIENT_MAX_BUCKETS, Math.round(segmentCount / 20)),
  );
  const slopes = smoothSeriesToBuckets(rawSlopes, gradientBucketCount);
  const maxAbsSlope = Math.max(0.0001, ...slopes.map((value) => Math.abs(value)));
  const segments: Array<{ coordinates: Array<{ latitude: number; longitude: number }>; color: string }> = [];
  const slopeBucket = (value: number) => Math.round((Math.max(-1, Math.min(1, value)) * 10));

  let startIndex = 0;
  let currentBucket = slopeBucket((slopes[0] ?? 0) / maxAbsSlope);

  for (let index = 1; index < segmentCount; index += 1) {
    const normalized = (slopes[index] ?? 0) / maxAbsSlope;
    const nextBucket = slopeBucket(normalized);
    if (nextBucket === currentBucket) {
      continue;
    }

    segments.push({
      coordinates: coordinates.slice(startIndex, index + 1),
      color: slopeColor(baseColor, currentBucket / 10),
    });

    startIndex = index;
    currentBucket = nextBucket;
  }

  segments.push({
    coordinates: coordinates.slice(startIndex, coordinates.length),
    color: slopeColor(baseColor, currentBucket / 10),
  });

  return segments;
}

function buildTrackProfile(track: EventTrackResponse): TrackProfileData | null {
  if (track.points.length < 2) {
    return null;
  }

  const segmentCount = track.points.length - 1;
  const rawSegmentGradeRatios = getTrackSegmentGradeRatios(track, segmentCount);
  const profileBucketCount = Math.max(
    TRACK_PROFILE_MIN_BUCKETS,
    Math.min(TRACK_PROFILE_MAX_BUCKETS, Math.round(segmentCount / 8)),
  );
  const segmentGradeRatios = smoothSeriesToBuckets(rawSegmentGradeRatios, profileBucketCount);
  const distances = Array.from({ length: segmentCount }, (_, index) =>
    pointDistanceMeters(track.points[index], track.points[index + 1]),
  );

  const cumulativeDistances: number[] = [0];
  const rawElevations: number[] = [0];

  for (let index = 0; index < segmentCount; index += 1) {
    cumulativeDistances.push(cumulativeDistances[index] + distances[index]);
    rawElevations.push(rawElevations[index] + (segmentGradeRatios[index] ?? 0) * distances[index]);
  }

  const totalDistanceMeters = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
  const rawMinElevation = Math.min(...rawElevations);
  const rawMaxElevation = Math.max(...rawElevations);
  const rawRange = rawMaxElevation - rawMinElevation;
  const minElevationHint = track.elevationProfile?.minElevationMeters;
  const maxElevationHint = track.elevationProfile?.maxElevationMeters;
  let normalizedElevations = rawElevations;

  if (
    minElevationHint !== null &&
    minElevationHint !== undefined &&
    maxElevationHint !== null &&
    maxElevationHint !== undefined &&
    rawRange > 0.0001 &&
    maxElevationHint > minElevationHint
  ) {
    const targetRange = maxElevationHint - minElevationHint;
    normalizedElevations = rawElevations.map(
      (value) => minElevationHint + ((value - rawMinElevation) / rawRange) * targetRange,
    );
  } else if (minElevationHint !== null && minElevationHint !== undefined) {
    normalizedElevations = rawElevations.map((value) => value - rawMinElevation + minElevationHint);
  }

  const points = track.points.map((point, index) => ({
    progress: totalDistanceMeters > 0 ? cumulativeDistances[index] / totalDistanceMeters : index / segmentCount,
    distanceMeters: cumulativeDistances[index],
    elevationMeters: normalizedElevations[index] ?? normalizedElevations[normalizedElevations.length - 1] ?? 0,
    lat: point.lat,
    lng: point.lng,
  }));

  return {
    points,
    totalDistanceMeters,
    minElevationMeters: Math.min(...normalizedElevations),
    maxElevationMeters: Math.max(...normalizedElevations),
  };
}

function sampleTrackProfile(profile: TrackProfileData, progress: number): TrackProfilePoint {
  const clamped = Math.max(0, Math.min(1, progress));
  const points = profile.points;
  if (points.length === 1) {
    return points[0];
  }

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (clamped > next.progress) {
      continue;
    }

    const span = Math.max(0.000001, next.progress - prev.progress);
    const ratio = (clamped - prev.progress) / span;
    return {
      progress: clamped,
      distanceMeters: prev.distanceMeters + (next.distanceMeters - prev.distanceMeters) * ratio,
      elevationMeters: prev.elevationMeters + (next.elevationMeters - prev.elevationMeters) * ratio,
      lat: prev.lat + (next.lat - prev.lat) * ratio,
      lng: prev.lng + (next.lng - prev.lng) * ratio,
    };
  }

  return {
    ...points[points.length - 1],
    progress: clamped,
  };
}

function elevationToChartTopPercent(
  elevationMeters: number,
  minElevationMeters: number,
  maxElevationMeters: number,
): number {
  const range = Math.max(1, maxElevationMeters - minElevationMeters);
  const normalized = Math.max(0, Math.min(1, (elevationMeters - minElevationMeters) / range));
  return 78 - normalized * 56;
}

function smoothSeriesToBuckets(values: number[], bucketCount: number): number[] {
  if (values.length <= 1) {
    return [...values];
  }

  const clampedBucketCount = Math.max(1, Math.min(values.length, Math.round(bucketCount)));
  if (clampedBucketCount >= values.length) {
    return [...values];
  }

  const bucketAverages = Array.from({ length: clampedBucketCount }, (_, bucketIndex) => {
    const start = Math.floor((bucketIndex * values.length) / clampedBucketCount);
    const end = Math.max(start + 1, Math.floor(((bucketIndex + 1) * values.length) / clampedBucketCount));
    let sum = 0;
    let count = 0;
    for (let index = start; index < Math.min(values.length, end); index += 1) {
      sum += values[index] ?? 0;
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  });

  return Array.from({ length: values.length }, (_, index) => {
    const bucketIndex = Math.min(
      bucketAverages.length - 1,
      Math.floor((index * clampedBucketCount) / values.length),
    );
    return bucketAverages[bucketIndex] ?? 0;
  });
}

function smoothSeriesMovingAverage(values: number[], radius: number): number[] {
  if (values.length <= 2 || radius <= 0) {
    return [...values];
  }

  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor <= end; cursor += 1) {
      sum += values[cursor] ?? 0;
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  });
}

const TRACK_OFFSET_STEP_PIXELS = 7;
const HEATMAP_WEIGHT_MIN = 0.01;
const HEATMAP_WEIGHT_MAX = 1;
const HEATMAP_WEIGHT_STEP = 0.01;
const HEATMAP_SLIDER_WIDTH = 170;
const TRACK_GRADIENT_MIN_BUCKETS = 14;
const TRACK_GRADIENT_MAX_BUCKETS = 48;
const TRACK_ELEVATION_CHART_MIN_POINTS = 120;
const TRACK_ELEVATION_CHART_MAX_POINTS = 260;
const TRACK_PROFILE_MIN_BUCKETS = 28;
const TRACK_PROFILE_MAX_BUCKETS = 140;
const FUTURE_MENU_PAGES = [
  {
    id: "event-dashboard",
    title: "Event Dashboard",
    subtitle: "Race timeline, checkpoints, and status overview",
  },
  {
    id: "medical-ops",
    title: "Medical Operations",
    subtitle: "Incidents, team load, and dispatch queue",
  },
  {
    id: "participants",
    title: "Participants",
    subtitle: "Search, groups, and live participant states",
  },
  {
    id: "communications",
    title: "Communications",
    subtitle: "Broadcasts, unit channels, and alerts",
  },
  {
    id: "resources",
    title: "Resources",
    subtitle: "Equipment, stations, and route assets",
  },
];

const POI_CONFIG: Record<string, { color: string; icon: string; size: number }> = {
  "base-medical-camp": { color: "#ef4444", icon: "🏠", size: 34 },
  "ambulance":         { color: "#ef4444", icon: "🚑", size: 30 },
  "medical-point":     { color: "#ef4444", icon: "+",  size: 28 },
  "water-point":       { color: "#3b82f6", icon: "💧", size: 28 },
  "wc":                { color: "#8b5cf6", icon: "WC", size: 28 },
  "wardrobe":          { color: "#f97316", icon: "👕", size: 28 },
  "parking":           { color: "#f59e0b", icon: "P",  size: 28 },
  "custom":            { color: "#94a3b8", icon: "★",  size: 28 },
};

function poiConfig(type?: string): { color: string; icon: string; size: number } {
  return POI_CONFIG[type ?? ""] ?? { color: "#64748b", icon: "•", size: 26 };
}

const POI_TYPE_LABELS: Record<string, string> = {
  "base-medical-camp": "Medical camp",
  "ambulance": "Ambulance",
  "medical-point": "Medical point",
  "water-point": "Water point",
  "wc": "Toilets",
  "wardrobe": "Wardrobe",
  "parking": "Parking",
  "custom": "Point of interest",
  "marker": "Point of interest",
};
function poiTypeLabel(type?: string): string {
  if (!type) return "Point of interest";
  return POI_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, " ");
}

function buildTrackVisuals(tracks: EventTrackResponse[]): TrackVisual[] {
  if (tracks.length === 0) {
    return [];
  }

  return tracks.map((track, index) => {
    const centerIndex = (tracks.length - 1) / 2;
    const offsetFactor = index - centerIndex;
    const lineOffset = offsetFactor * TRACK_OFFSET_STEP_PIXELS;
    const coordinates = track.points.map((point) => ({ latitude: point.lat, longitude: point.lng }));
    const baseColor = track.color ?? trackColor(track.id);

    return {
      id: track.id,
      label: track.label,
      coordinates,
      lineOffset,
      color: baseColor,
      gradientSegments: buildTrackGradientSegments(
        track,
        coordinates,
        baseColor,
      ),
    };
  });
}

function lineFeatureFromCoordinates(
  coordinates: Array<{ latitude: number; longitude: number }>,
): FeatureCollection<LineFeature> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: coordinates.map((point) => [point.longitude, point.latitude]),
        },
      },
    ],
  };
}

const HEATMAP_GRID_SCALE = 280;

function buildRunnerHeatFeatureCollection(
  runners: Array<{ lat: number; lng: number }>,
): FeatureCollection<RunnerHeatFeature> {
  const cells = new Map<string, { latSum: number; lngSum: number; count: number }>();

  for (const runner of runners) {
    const gridLat = Math.round(runner.lat * HEATMAP_GRID_SCALE);
    const gridLng = Math.round(runner.lng * HEATMAP_GRID_SCALE);
    const key = `${gridLat}:${gridLng}`;
    const existing = cells.get(key);

    if (!existing) {
      cells.set(key, { latSum: runner.lat, lngSum: runner.lng, count: 1 });
      continue;
    }

    existing.latSum += runner.lat;
    existing.lngSum += runner.lng;
    existing.count += 1;
  }

  return {
    type: "FeatureCollection",
    features: Array.from(cells.values()).map((cell) => ({
      type: "Feature",
      properties: {
        count: cell.count,
      },
      geometry: {
        type: "Point",
        coordinates: [cell.lngSum / cell.count, cell.latSum / cell.count],
      },
    })),
  };
}

function padCollapsedBounds(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): { minLng: number; minLat: number; maxLng: number; maxLat: number } {
  const lngSpan = Math.max(maxLng - minLng, 0.0009);
  const latSpan = Math.max(maxLat - minLat, 0.0009);
  const lngPad = lngSpan * 0.08;
  const latPad = latSpan * 0.08;

  return {
    minLng: minLng - lngPad,
    minLat: minLat - latPad,
    maxLng: maxLng + lngPad,
    maxLat: maxLat + latPad,
  };
}

/**
 * Build a GeoJSON polygon approximating a circle of `radiusMeters` around a
 * lat/lng — used to visualize a paramedic's reported GPS accuracy on the map.
 */
function buildAccuracyCircle(
  lat: number,
  lng: number,
  radiusMeters: number,
  steps = 48,
): FeatureCollection<{ type: "Feature"; properties: Record<string, never>; geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> } }> {
  const earthRadius = 6378137;
  const latRad = (lat * Math.PI) / 180;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    const dx = (radiusMeters * Math.cos(angle)) / (earthRadius * Math.cos(latRad)) * (180 / Math.PI);
    const dy = (radiusMeters * Math.sin(angle)) / earthRadius * (180 / Math.PI);
    ring.push([lng + dx, lat + dy]);
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

export function MapScreen({ viewMode }: { viewMode: AppViewMode }) {
  const eventTitle = useSessionStore((state) => state.eventTitle);
  const sessionUserId = useSessionStore((state) => state.userId);
  const clearSession = useSessionStore((state) => state.clear);
  const sessionToken = useSessionStore((state) => state.token);
  const markers = useMapStore((state) => state.markers);
  const tracks = useMapStore((state) => state.tracks);
  const centerOnUserRequestId = useMapStore((state) => state.centerOnUserRequestId);
  const resetNorthRequestId = useMapStore((state) => state.resetNorthRequestId);
  const setMarkers = useMapStore((state) => state.setMarkers);
  const setTracks = useMapStore((state) => state.setTracks);
  const rosterMedics = useRosterStore((state) => state.medics);
  const loadRoster = useRosterStore((state) => state.load);
  const trackingHealth = useTrackingHealth();

  const mapRef = useRef<MapRef | null>(null);
  const cameraRef = useRef<CameraRef | null>(null);
  const didInitialEventFitRef = useRef(false);
  const markerSheetRef = useRef<BottomSheet | null>(null);
  const trackSheetRef = useRef<BottomSheet | null>(null);
  const [trackSheetIndex, setTrackSheetIndex] = useState(0);
  const myLocationFix = useLocationStatus((s) => s.lastFix);

  const isOnline = useIncidentStore((s) => s.isOnline);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [justFlushed, setJustFlushed] = useState(false);
  const offlineBadgeOpacity = useRef(new Animated.Value(1)).current;

  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"map" | "tracks" | "location" | "debug" | "settings" | "profile" | "guide">("map");
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapZoom, setMapZoom] = useState(FALLBACK_ZOOM);
  const [layersOpen, setLayersOpen] = useState(false);
  const [pendingPoi, setPendingPoi] = useState<{ lat: number; lng: number } | null>(null);
  const [radialAnchor, setRadialAnchor] = useState<RadialAnchor | null>(null);
  const navPhase = useNavStore((s) => s.phase);
  const navCameraMode = useNavStore((s) => s.navCameraMode);
  const navPendingInsert = useNavStore((s) => s.pendingInsertIndex);
  useNavigationCamera(cameraRef);
  const [photoViewerUrl, setPhotoViewerUrl] = useState<string | null>(null);
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null);
  const [trackProfileProgress, setTrackProfileProgress] = useState(0);
  const [trackProfileWidth, setTrackProfileWidth] = useState(0);
  const trackProfileChartRef = useRef<View | null>(null);
  const trackProfileChartPageXRef = useRef(0);
  const lastTrackSelectionLayerResetRef = useRef<string | null>(null);
  // Remembers paramedics/incidents layer visibility before Track Studio hides them,
  // so we can restore the user's choice when they return to the map.
  const savedLayersBeforeTrackRef = useRef<{ paramedics: boolean; incidents: boolean } | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    participants: false,
    participantsHeatmap: false,
    paramedics: true,
    incidents: true,
  });
  const [trackVisibility, setTrackVisibility] = useState<TrackVisibility>({});
  const [heatWeightScale, setHeatWeightScale] = useState(0.12);
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("regular");

  const mapyTilesTemplateUrl = USE_MAPY_TILES ? getMapyTilesTemplateUrl() : null;
  const regularTilesTemplateUrl = mapyTilesTemplateUrl ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const regularRasterTileSize = mapyTilesTemplateUrl ? 512 : 256;
  // Active base map (regular street / topo terrain / satellite imagery).
  const baseLayerConfig = BASE_LAYERS[baseLayer];
  const baseTilesTemplateUrl = baseLayer === "regular" ? regularTilesTemplateUrl : baseLayerConfig.tiles!;
  const baseRasterTileSize = baseLayer === "regular" ? regularRasterTileSize : baseLayerConfig.tileSize!;
  const baseRasterMaxZoom = baseLayerConfig.maxZoom;
  const heatWeightNormalized =
    (heatWeightScale - HEATMAP_WEIGHT_MIN) / (HEATMAP_WEIGHT_MAX - HEATMAP_WEIGHT_MIN);
  const heatSliderPosition = Math.max(0, Math.min(1, heatWeightNormalized)) * HEATMAP_SLIDER_WIDTH;
  const heatSliderKnobLeft = Math.max(0, Math.min(HEATMAP_SLIDER_WIDTH - 14, heatSliderPosition - 7));
  const densityScale = Math.max(0.01, heatWeightScale * 10);

  const setHeatWeightFromTouch = (locationX: number) => {
    const clampedX = Math.max(0, Math.min(HEATMAP_SLIDER_WIDTH, locationX));
    const ratio = clampedX / HEATMAP_SLIDER_WIDTH;
    const value = HEATMAP_WEIGHT_MIN + ratio * (HEATMAP_WEIGHT_MAX - HEATMAP_WEIGHT_MIN);
    setHeatWeightScale(Number(value.toFixed(2)));
  };

  const heatWeightPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        setHeatWeightFromTouch(event.nativeEvent.locationX);
      },
      onPanResponderMove: (event) => {
        setHeatWeightFromTouch(event.nativeEvent.locationX);
      },
    }),
  ).current;

  const updateTrackProfileProgressFromX = (locationX: number) => {
    if (trackProfileWidth <= 0) {
      return;
    }
    const ratio = Math.max(0, Math.min(1, locationX / trackProfileWidth));
    setTrackProfileProgress(ratio);
  };

  const measureTrackProfileChart = () => {
    trackProfileChartRef.current?.measureInWindow((pageX, _pageY, width) => {
      trackProfileChartPageXRef.current = pageX;
      setTrackProfileWidth(width);
    });
  };

  const updateTrackProfileProgressFromPageX = (pageX: number, locationX?: number) => {
    if (typeof locationX === "number" && Number.isFinite(locationX)) {
      trackProfileChartPageXRef.current = pageX - locationX;
    }
    updateTrackProfileProgressFromX(pageX - trackProfileChartPageXRef.current);
  };


  // Re-pull the DB-backed last-known medic positions and merge them into the
  // map. The initial load happens once on mount, but the live socket can miss
  // the self-broadcast (e.g. when resuming from the background, or if the ping
  // went out over HTTP), so we also refresh on every foreground.
  const refreshActiveMedics = useCallback(async () => {
    const eventId = useSessionStore.getState().eventId ?? "";
    if (!eventId) return;
    try {
      const activeMedics = await apiFetch<MedicActiveResponse[]>(`/events/${eventId}/medics/active`);
      const medicMarkers = activeMedics.map((medic) => {
        const ageMs = medic.lastSeenAt ? Date.now() - new Date(medic.lastSeenAt).getTime() : undefined;
        return {
          id: medic.medicId,
          type: "paramedic" as const,
          label: medic.name ?? medic.medicId,
          name: medic.name,
          lat: medic.lat,
          lng: medic.lng,
          accuracy: medic.accuracy,
          battery: medic.battery,
          staleState: freshnessBucket(ageMs),
          lastSeenAt: medic.lastSeenAt,
          status: medic.status,
          destination: medic.destination ?? null,
          route: medic.route ?? null,
        };
      });
      const existing = useMapStore.getState().markers;
      const others = existing.filter((marker) => marker.type !== "paramedic");
      setMarkers([...others, ...medicMarkers]);
      debugLog("api", "info", `pulled ${medicMarkers.length} medic(s) from API`);
    } catch (err) {
      debugLog("api", "error", "medics refresh failed", String(err));
    }
  }, [setMarkers]);

  // Re-pull incidents (used on foreground + when focusing a notification's incident),
  // since the live socket may miss events while the app is backgrounded.
  const refreshIncidents = useCallback(async () => {
    try {
      const incidents = await apiFetch<IncidentResponse[]>("/incidents");
      const existing = useMapStore.getState().markers;
      const others = existing.filter((m) => m.type !== "incident");
      const visible = incidents.filter((i) => !isArchivedIncidentStatus(i.status));
      setMarkers([...others, ...visible.map(incidentToMarker)]);
    } catch (err) {
      debugLog("api", "error", "incidents refresh failed", String(err));
    }
  }, [setMarkers]);

  // Bounding box around all current markers + tracks, for caching the event area offline.
  const computeOfflineBounds = useCallback((): [number, number, number, number] | null => {
    const points: Array<{ lat: number; lng: number }> = [];
    for (const marker of useMapStore.getState().markers) {
      if (Number.isFinite(marker.lat) && Number.isFinite(marker.lng)) {
        points.push({ lat: marker.lat, lng: marker.lng });
      }
    }
    for (const track of useMapStore.getState().tracks) {
      for (const point of track.points) points.push(point);
    }
    if (points.length === 0) return null;
    let minLat = Infinity;
    let minLng = Infinity;
    let maxLat = -Infinity;
    let maxLng = -Infinity;
    for (const point of points) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
    }
    const padLat = Math.max((maxLat - minLat) * 0.12, 0.01);
    const padLng = Math.max((maxLng - minLng) * 0.12, 0.01);
    return [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat];
  }, []);

  useEffect(() => {
    void refreshActiveMedics();
    void refreshIncidents();
    void loadRoster();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void refreshActiveMedics();
        void refreshIncidents();
      }
    });
    return () => sub.remove();
  }, [refreshActiveMedics, refreshIncidents, loadRoster]);

  useEffect(() => {
    let mounted = true;

    const loadInitialData = async () => {
      try {
        const eventId = useSessionStore.getState().eventId ?? "";
        const [initialLocations, activeMedics, eventTracksPayload, eventPois, incidents] = await Promise.all([
          apiFetch<EventLocationResponse[]>("/locations/event"),
          eventId
            ? apiFetch<MedicActiveResponse[]>(`/events/${eventId}/medics/active`).catch(() => [])
            : Promise.resolve<MedicActiveResponse[]>([]),
          apiFetch<unknown>("/events/tracks"),
          apiFetch<Array<{ id?: string; type: string; name?: string; description?: string; lat: number; lng: number }>>("/events/pois").catch(() => []),
          apiFetch<IncidentResponse[]>("/incidents").catch(() => [] as IncidentResponse[]),
        ]);

        if (!mounted) {
          return;
        }

        const locationMarkers = initialLocations.map((item) => ({
          id: item.userId,
          type: item.type ?? ("runner" as const),
          label: item.label ?? item.userId,
          lat: item.lat,
          lng: item.lng,
          staleState: item.freshness,
          name: item.name,
          bibNumber: item.bibNumber,
          vehicle: item.vehicle,
          avatarUrl: item.avatarUrl,
          description: item.description,
          respondingIncidentId: item.respondingIncidentId,
          respondingParamedicIds: item.respondingParamedicIds,
        }));
        // Last-known paramedic positions (DB-backed), so the map matches the web
        // on launch instead of only showing medics that ping after we connect.
        const medicMarkers = activeMedics.map((medic) => {
          const ageMs = medic.lastSeenAt ? Date.now() - new Date(medic.lastSeenAt).getTime() : undefined;
          return {
            id: medic.medicId,
            type: "paramedic" as const,
            label: medic.name ?? medic.medicId,
            name: medic.name,
            lat: medic.lat,
            lng: medic.lng,
            accuracy: medic.accuracy,
            battery: medic.battery,
            staleState: freshnessBucket(ageMs),
            lastSeenAt: medic.lastSeenAt,
            status: medic.status,
            destination: medic.destination ?? null,
            route: medic.route ?? null,
          };
        });
        const poiMarkers = eventPois.map((poi, i) => ({
          id: poi.id ?? `poi-${i}-${poi.lat}-${poi.lng}`,
          type: "infrastructure" as const,
          label: poi.name ?? poi.type,
          lat: poi.lat,
          lng: poi.lng,
          poiType: poi.type,
          poiDescription: poi.description,
        }));
        const incidentMarkers = incidents
          .filter((i) => !isArchivedIncidentStatus(i.status))
          .map(incidentToMarker);
        setMarkers([...locationMarkers, ...medicMarkers, ...poiMarkers, ...incidentMarkers]);
        const normalizedTracks = Array.isArray(eventTracksPayload)
          ? eventTracksPayload
              .map((track, index) => normalizeTrack(track, index))
              .filter((track): track is EventTrackResponse => Boolean(track))
          : [];
        const existingTracksBeforeNormalize = useMapStore.getState().tracks as EventTrackResponse[];
        const normalizedMergedTracks = mergeTracksPreservingElevation(
          normalizedTracks,
          existingTracksBeforeNormalize,
        );
        setTracks(normalizedMergedTracks);
        const enrichedTracks = await enrichTracksElevationProfiles(normalizedMergedTracks);
        if (!mounted) {
          return;
        }
        const existingTracksBeforeEnrichedSet = useMapStore.getState().tracks as EventTrackResponse[];
        const enrichedMergedTracks = mergeTracksPreservingElevation(
          enrichedTracks,
          existingTracksBeforeEnrichedSet,
        );
        setTracks(enrichedMergedTracks);
      } catch {
        if (mounted) {
          setTracks([]);
        }
      }
    };

    void loadInitialData();

    return () => {
      mounted = false;
    };
  }, [setMarkers, setTracks]);

  useEffect(() => {
    const socket = getSocket();

    socket.on("location.updated", (payload) => {
      const existing = useMapStore.getState().markers;
      setMarkers(
        [
          ...existing.filter((marker) => marker.id !== payload.userId),
          {
            id: payload.userId,
            type: "runner" as const,
            label: payload.userId,
            lat: payload.lat,
            lng: payload.lng,
            staleState: payload.freshness,
          },
        ].slice(-2200),
      );
    });

    socket.on("medic_location", (payload: { medicId: string; name?: string; lat: number; lng: number; heading?: number; speed?: number; accuracy?: number; battery?: number; lastSeenAt?: string; status?: string; destination?: { lat: number; lng: number; label: string } | null; route?: MedicMarkerRoute | null }) => {
      const existing = useMapStore.getState().markers;
      const filtered = existing.filter((marker) => marker.id !== payload.medicId);
      const existing_marker = existing.find((marker) => marker.id === payload.medicId);
      setMarkers(
        [
          ...filtered,
          {
            id: payload.medicId,
            type: "paramedic" as const,
            label: existing_marker?.label ?? payload.name ?? payload.medicId,
            name: existing_marker?.name ?? payload.name,
            vehicle: existing_marker?.vehicle,
            lat: payload.lat,
            lng: payload.lng,
            accuracy: payload.accuracy ?? existing_marker?.accuracy,
            battery: payload.battery ?? existing_marker?.battery,
            staleState: "fresh" as const,
            lastSeenAt: payload.lastSeenAt ?? new Date().toISOString(),
            status: payload.status ?? existing_marker?.status,
            destination: payload.destination !== undefined ? payload.destination : existing_marker?.destination ?? null,
            route: payload.route !== undefined ? payload.route : existing_marker?.route ?? null,
          },
        ].slice(-2200),
      );
    });

    socket.on("incident.created", (payload: IncidentResponse) => {
      const existing = useMapStore.getState().markers;
      setMarkers(
        [...existing.filter((m) => m.id !== payload.id), incidentToMarker(payload)].slice(-2200),
      );
      // Alarm: heads-up notification for everyone except the medic who reported it.
      const myId = useSessionStore.getState().userId;
      if (payload.createdBy !== myId) {
        const detail = payload.description ? `${payload.type} — ${payload.description}` : `${payload.type} reported`;
        void showBroadcastNotification(`🚨 ${payload.name ?? "New incident"}`, detail, { incidentId: payload.id }, true);
      }
    });

    // Any incident change (details edit, status, close) re-renders its pin in place.
    const upsertIncident = (payload: IncidentResponse) => {
      const existing = useMapStore.getState().markers;
      const existingMarker = existing.find((m) => m.id === payload.id);
      const withoutIncident = existing.filter((m) => m.id !== payload.id);
      // Archived incidents drop off the active map entirely.
      if (isArchivedIncidentStatus(payload.status)) {
        setMarkers(withoutIncident);
        return;
      }
      const merged = { ...incidentToMarker(payload) };
      // Preserve responders/description if a partial action payload omits them.
      if (!merged.respondingParamedicIds && existingMarker?.respondingParamedicIds) {
        merged.respondingParamedicIds = existingMarker.respondingParamedicIds;
      }
      // Just became a responder (dashboard assigned me) → alarm with a tap-to-focus.
      const myUserId = useSessionStore.getState().userId ?? "";
      const wasResponder = (existingMarker?.respondingParamedicIds ?? []).includes(myUserId);
      const isResponder = (merged.respondingParamedicIds ?? []).includes(myUserId);
      if (!wasResponder && isResponder && !isClosedIncidentStatus(merged.status)) {
        const detail = merged.description ? `${merged.incidentType} — ${merged.description}` : "Respond now";
        void showBroadcastNotification(`🚑 Assigned: ${merged.name ?? merged.label}`, detail, { incidentId: merged.id }, true);
      }
      setMarkers([...withoutIncident, merged].slice(-2200));
    };
    socket.on("incident.updated", upsertIncident);
    // Dashboard broadcast → real OS heads-up notification (no in-app banner).
    socket.on("broadcast", (payload: { title?: string; body?: string }) => {
      const title = payload.title ?? "📢 Broadcast";
      const body = payload.body ?? "";
      void showBroadcastNotification(title, body);
    });
    // Status-only changes arrive on the ops channel as incident.action.
    socket.on("incident.action", (payload: { incidentId: string; status?: string }) => {
      const existing = useMapStore.getState().markers;
      setMarkers(
        existing.map((m) =>
          m.id === payload.incidentId && m.type === "incident"
            ? { ...m, status: payload.status ?? m.status }
            : m,
        ),
      );
    });

    // POIs created/archived elsewhere appear/disappear for everyone live.
    socket.on("poi.created", (poi: { id: string; type: string; lat: number; lng: number; name?: string; description?: string }) => {
      const existing = useMapStore.getState().markers;
      setMarkers([...existing.filter((m) => m.id !== poi.id), poiToMarker(poi)]);
    });
    socket.on("poi.removed", (payload: { id: string }) => {
      const existing = useMapStore.getState().markers;
      setMarkers(existing.filter((m) => m.id !== payload.id));
    });

    return () => {
      socket.off("location.updated");
      socket.off("medic_location");
      socket.off("incident.created");
      socket.off("incident.updated");
      socket.off("incident.action");
      socket.off("broadcast");
      socket.off("poi.created");
      socket.off("poi.removed");
    };
    // Re-subscribe when the session token changes: getSocket() reconnects with
    // the new identity, so we must re-attach listeners to the fresh socket.
  }, [setMarkers, sessionToken]);

  useEffect(() => {
    const centerOnUser = async () => {
      const permission = await ExpoLocation.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        return;
      }

      const location = await ExpoLocation.getCurrentPositionAsync({});
      cameraRef.current?.easeTo({
        center: [location.coords.longitude, location.coords.latitude],
        zoom: USER_FOCUS_ZOOM,
        duration: 450,
      });
    };

    if (centerOnUserRequestId > 0) {
      void centerOnUser();
    }
  }, [centerOnUserRequestId]);

  useEffect(() => {
    const resetNorth = async () => {
      const viewState = await mapRef.current?.getViewState();
      if (!viewState) {
        return;
      }

      cameraRef.current?.easeTo({
        center: viewState.center,
        zoom: viewState.zoom,
        bearing: 0,
        duration: 360,
      });
    };

    if (resetNorthRequestId > 0) {
      void resetNorth();
    }
  }, [resetNorthRequestId]);

  useEffect(() => {
    if (didInitialEventFitRef.current) {
      return;
    }

    // Launched from an incident notification → that focus owns the camera;
    // don't fight it with the tracks overview fit.
    if (useNotificationFocus.getState().incidentId) {
      didInitialEventFitRef.current = true;
      return;
    }

    const trackPoints = tracks.flatMap((track) => track.points);
    if (trackPoints.length === 0) {
      return;
    }

    let cancelled = false;

    const fitEventBounds = async () => {
      if (!cameraRef.current || cancelled) {
        return;
      }

      let minLat = Number.POSITIVE_INFINITY;
      let minLng = Number.POSITIVE_INFINITY;
      let maxLat = Number.NEGATIVE_INFINITY;
      let maxLng = Number.NEGATIVE_INFINITY;

      for (const point of trackPoints) {
        minLat = Math.min(minLat, point.lat);
        minLng = Math.min(minLng, point.lng);
        maxLat = Math.max(maxLat, point.lat);
        maxLng = Math.max(maxLng, point.lng);
      }

      const knownUserMarker = markers.find((marker) => marker.id === CURRENT_USER_ID);
      if (knownUserMarker) {
        minLat = Math.min(minLat, knownUserMarker.lat);
        minLng = Math.min(minLng, knownUserMarker.lng);
        maxLat = Math.max(maxLat, knownUserMarker.lat);
        maxLng = Math.max(maxLng, knownUserMarker.lng);
      } else {
        const permission = await ExpoLocation.getForegroundPermissionsAsync();
        if (permission.status === "granted") {
          const knownLocation =
            (await ExpoLocation.getLastKnownPositionAsync()) ?? (await ExpoLocation.getCurrentPositionAsync({}));
          if (knownLocation && !cancelled) {
            minLat = Math.min(minLat, knownLocation.coords.latitude);
            minLng = Math.min(minLng, knownLocation.coords.longitude);
            maxLat = Math.max(maxLat, knownLocation.coords.latitude);
            maxLng = Math.max(maxLng, knownLocation.coords.longitude);
          }
        }
      }

      const padded = padCollapsedBounds(minLng, minLat, maxLng, maxLat);
      cameraRef.current?.fitBounds([padded.minLng, padded.minLat, padded.maxLng, padded.maxLat], {
        padding: { top: 92, right: 24, bottom: 172, left: 24 },
        duration: 720,
      });
      didInitialEventFitRef.current = true;
    };

    const timer = setTimeout(() => {
      void fitEventBounds();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [markers, tracks]);

  const nonCurrentMarkers = useMemo(
    () => markers.filter((marker) => marker.id !== CURRENT_USER_ID),
    [markers],
  );

  const markerById = useMemo(
    () => new Map(nonCurrentMarkers.map((marker) => [marker.id, marker])),
    [nonCurrentMarkers],
  );

  const runners = useMemo(
    () => nonCurrentMarkers.filter((marker) => marker.type === "runner"),
    [nonCurrentMarkers],
  );

  const visibleMarkers = useMemo(
    () =>
      nonCurrentMarkers.filter((marker) => {
        if (marker.type === "runner") {
          return layerVisibility.participants;
        }
        if (marker.type === "paramedic") {
          // While navigating, the nav puck stands in for the user's own position —
          // hide the server-echoed marker of themselves.
          if (navPhase === "active" && marker.id === sessionUserId) return false;
          return layerVisibility.paramedics;
        }
        if (marker.type === "incident") {
          return layerVisibility.incidents;
        }
        // infrastructure (POIs) — always visible
        return true;
      }),
    [layerVisibility.incidents, layerVisibility.paramedics, layerVisibility.participants, nonCurrentMarkers, navPhase, sessionUserId],
  );
  const orderedVisibleMarkers = useMemo(
    () =>
      [...visibleMarkers].sort(
        (a, b) => MARKER_RENDER_PRIORITY[a.type] - MARKER_RENDER_PRIORITY[b.type],
      ),
    [visibleMarkers],
  );

  // Am I currently responding to an open incident? (Mirrors the
  // AssignedIncidentBanner visibility — used to swap the status button out.)
  const assignedToIncident = useMemo(
    () =>
      markers.some(
        (marker) =>
          marker.type === "incident" &&
          !isClosedIncidentStatus(marker.status) &&
          !isArchivedIncidentStatus(marker.status) &&
          (marker.respondingParamedicIds ?? []).includes(sessionUserId ?? "__none__"),
      ),
    [markers, sessionUserId],
  );

  const runnerHeatFeatureCollection = useMemo(
    () => buildRunnerHeatFeatureCollection(runners),
    [runners],
  );
  const trackVisuals = useMemo(() => buildTrackVisuals(tracks), [tracks]);
  const visibleTracks = useMemo(
    () => tracks.filter((track) => trackVisibility[track.id] ?? true),
    [trackVisibility, tracks],
  );
  const visibleTrackVisuals = useMemo(() => buildTrackVisuals(visibleTracks), [visibleTracks]);
  const focusedTrack = useMemo(
    () => (focusedTrackId ? tracks.find((track) => track.id === focusedTrackId) ?? null : null),
    [focusedTrackId, tracks],
  );
  const focusedTrackVisual = useMemo(
    () => (focusedTrackId ? trackVisuals.find((track) => track.id === focusedTrackId) ?? null : null),
    [focusedTrackId, trackVisuals],
  );
  const trackModeActive = activeTab === "tracks";
  const renderedTrackVisuals = useMemo(() => {
    if (trackModeActive && focusedTrackVisual) {
      return [focusedTrackVisual];
    }
    return visibleTrackVisuals;
  }, [focusedTrackVisual, trackModeActive, visibleTrackVisuals]);
  const focusedTrackProfile = useMemo(
    () => (focusedTrack ? buildTrackProfile(focusedTrack) : null),
    [focusedTrack],
  );
  const focusedTrackElevationLineColor = useMemo(
    () => (focusedTrack ? mixHexColor(focusedTrack.color ?? trackColor(focusedTrack.id), "#ffffff", 0.12) : "#b9c6d8"),
    [focusedTrack],
  );
  const focusedTrackElevationLinePoints = useMemo(() => {
    if (!focusedTrackProfile || focusedTrackProfile.points.length === 0) {
      return [];
    }

    const pointCount = Math.max(
      TRACK_ELEVATION_CHART_MIN_POINTS,
      Math.min(TRACK_ELEVATION_CHART_MAX_POINTS, focusedTrackProfile.points.length),
    );
    const sampledPoints = Array.from({ length: pointCount }, (_, index) => {
      const progress = pointCount > 1 ? index / (pointCount - 1) : 0;
      return {
        key: `elevation-line-${index}`,
        progress,
        value: sampleTrackProfile(focusedTrackProfile, progress).elevationMeters,
      };
    });
    const smoothedValues = smoothSeriesMovingAverage(
      sampledPoints.map((point) => point.value),
      2,
    );
    return sampledPoints.map((point, index) => ({
      ...point,
      value: smoothedValues[index] ?? point.value,
    }));
  }, [focusedTrackProfile]);
  const focusedTrackSample = useMemo(
    () => (focusedTrackProfile ? sampleTrackProfile(focusedTrackProfile, trackProfileProgress) : null),
    [focusedTrackProfile, trackProfileProgress],
  );
  const focusedTrackElevationCursorTopPercent = useMemo(() => {
    if (!focusedTrackProfile || !focusedTrackSample) {
      return 50;
    }
    return elevationToChartTopPercent(
      focusedTrackSample.elevationMeters,
      focusedTrackProfile.minElevationMeters,
      focusedTrackProfile.maxElevationMeters,
    );
  }, [focusedTrackProfile, focusedTrackSample]);

  // Project the user's current GPS fix onto the focused track to find where they
  // are along it, then derive remaining distance / climb / descent to the finish.
  const myTrackPosition = useMemo(() => {
    if (!focusedTrackProfile || !myLocationFix || focusedTrackProfile.points.length < 2) {
      return null;
    }
    let bestIndex = 0;
    let bestDistanceKm = Infinity;
    focusedTrackProfile.points.forEach((point, index) => {
      const d = distanceKm(myLocationFix.lat, myLocationFix.lng, point.lat, point.lng);
      if (d < bestDistanceKm) {
        bestDistanceKm = d;
        bestIndex = index;
      }
    });
    const here = focusedTrackProfile.points[bestIndex];
    let ascentLeftMeters = 0;
    let descentLeftMeters = 0;
    for (let i = bestIndex + 1; i < focusedTrackProfile.points.length; i += 1) {
      const delta = focusedTrackProfile.points[i].elevationMeters - focusedTrackProfile.points[i - 1].elevationMeters;
      if (delta > 0) ascentLeftMeters += delta;
      else descentLeftMeters += -delta;
    }
    return {
      progress: here.progress,
      distanceMeters: here.distanceMeters,
      elevationMeters: here.elevationMeters,
      lat: here.lat,
      lng: here.lng,
      offTrackMeters: bestDistanceKm * 1000,
      distanceLeftMeters: Math.max(0, focusedTrackProfile.totalDistanceMeters - here.distanceMeters),
      ascentLeftMeters,
      descentLeftMeters,
    };
  }, [focusedTrackProfile, myLocationFix]);

  const myTrackCursorTopPercent = useMemo(() => {
    if (!focusedTrackProfile || !myTrackPosition) return 50;
    return elevationToChartTopPercent(
      myTrackPosition.elevationMeters,
      focusedTrackProfile.minElevationMeters,
      focusedTrackProfile.maxElevationMeters,
    );
  }, [focusedTrackProfile, myTrackPosition]);
  const focusedTrackScrubSegmentFeature = useMemo(() => {
    if (!focusedTrack || focusedTrack.points.length < 2) {
      return null;
    }
    const segmentCount = focusedTrack.points.length - 1;
    const segmentIndex = Math.min(
      segmentCount - 1,
      Math.max(0, Math.round(trackProfileProgress * (segmentCount - 1))),
    );
    const start = focusedTrack.points[segmentIndex];
    const end = focusedTrack.points[segmentIndex + 1];
    if (!start || !end) {
      return null;
    }
    return lineFeatureFromCoordinates([
      { latitude: start.lat, longitude: start.lng },
      { latitude: end.lat, longitude: end.lng },
    ]);
  }, [focusedTrack, trackProfileProgress]);
  // When the user disables track offsetting, overlapping routes draw on top of
  // each other (offset 0) instead of side by side.
  const trackOffsetEnabled = useSettingsStore((s) => s.trackOffsetEnabled);
  const trackGradientEnabled = useSettingsStore((s) => s.trackGradientEnabled);
  const trackRenderOffsetOverride = trackModeActive || !trackOffsetEnabled ? 0 : null;
  const trackLineOffsetValue = (lineOffset: number): any => {
    if (trackRenderOffsetOverride !== null) {
      return trackRenderOffsetOverride;
    }
    return [
      "interpolate",
      ["linear"],
      ["zoom"],
      9,
      lineOffset * 0.3,
      12,
      lineOffset * 0.5,
      15,
      lineOffset,
    ];
  };
  const shouldMuteTrackColors = layerVisibility.participantsHeatmap && !trackModeActive;
  const allTracksVisible = useMemo(
    () => trackVisuals.length > 0 && trackVisuals.every((track) => trackVisibility[track.id] ?? true),
    [trackVisibility, trackVisuals],
  );

  const respondingParamedics = useMemo(
    () =>
      nonCurrentMarkers.filter(
        (marker) =>
          marker.type === "paramedic" &&
          Boolean(marker.respondingIncidentId) &&
          layerVisibility.paramedics &&
          layerVisibility.incidents,
      ),
    [layerVisibility.incidents, layerVisibility.paramedics, nonCurrentMarkers],
  );

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const check = () => {
      const count = incidentQueue.listReady().length;
      setOfflineQueueCount(count);
    };
    check();
    const timer = setInterval(check, 3_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (offlineQueueCount === 0) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(offlineBadgeOpacity, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(offlineBadgeOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [offlineQueueCount, offlineBadgeOpacity]);

  useEffect(() => {
    if (isOnline && offlineQueueCount === 0 && !justFlushed) return;
    if (isOnline && offlineQueueCount === 0) {
      setJustFlushed(true);
      offlineBadgeOpacity.setValue(1);
      const timer = setTimeout(() => setJustFlushed(false), 3_000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, offlineQueueCount, justFlushed, offlineBadgeOpacity]);

  useEffect(() => {
    if (respondingParamedics.length === 0) {
      return;
    }

    const timer = setInterval(() => setTick((value) => value + 1), 650);
    return () => clearInterval(timer);
  }, [respondingParamedics.length]);

  const densityCountExpression = useMemo(
    () => ["*", ["get", "count"], densityScale],
    [densityScale],
  );

  const selectedMarker = selectedMarkerId ? markerById.get(selectedMarkerId) : undefined;
  const selectedIncident = selectedMarker?.type === "incident" ? selectedMarker : undefined;
  const overlayOpen = menuOpen || layersOpen;

  useEffect(() => {
    setTrackVisibility((previous) => {
      const next: TrackVisibility = {};
      for (const track of tracks) {
        next[track.id] = previous[track.id] ?? true;
      }
      return next;
    });
  }, [tracks]);

  useEffect(() => {
    if (!trackModeActive) {
      setTrackPickerOpen(false);
      lastTrackSelectionLayerResetRef.current = null;
      // Restore the paramedics/incidents layers the user had on before Track Studio.
      if (savedLayersBeforeTrackRef.current) {
        const saved = savedLayersBeforeTrackRef.current;
        savedLayersBeforeTrackRef.current = null;
        setLayerVisibility((state) => ({ ...state, paramedics: saved.paramedics, incidents: saved.incidents }));
      }
      return;
    }

    if (tracks.length === 0) {
      setFocusedTrackId(null);
      return;
    }

    const hasFocusedTrack = focusedTrackId ? tracks.some((track) => track.id === focusedTrackId) : false;
    if (!hasFocusedTrack) {
      setFocusedTrackId(tracks[0].id);
      setTrackProfileProgress(0);
    }
  }, [focusedTrackId, trackModeActive, tracks]);

  useEffect(() => {
    if (!trackModeActive || !focusedTrackId) {
      return;
    }
    if (lastTrackSelectionLayerResetRef.current === focusedTrackId) {
      return;
    }
    lastTrackSelectionLayerResetRef.current = focusedTrackId;
    setLayerVisibility((state) => {
      // Capture the user's layer choice the first time Track Studio hides them.
      if (savedLayersBeforeTrackRef.current === null) {
        savedLayersBeforeTrackRef.current = { paramedics: state.paramedics, incidents: state.incidents };
      }
      return { ...state, paramedics: false, incidents: false };
    });
  }, [focusedTrackId, trackModeActive]);

  useEffect(() => {
    if (!trackModeActive || !focusedTrack || focusedTrack.points.length === 0) {
      return;
    }
    let minLat = focusedTrack.points[0].lat;
    let minLng = focusedTrack.points[0].lng;
    let maxLat = focusedTrack.points[0].lat;
    let maxLng = focusedTrack.points[0].lng;
    for (const point of focusedTrack.points) {
      minLat = Math.min(minLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLat = Math.max(maxLat, point.lat);
      maxLng = Math.max(maxLng, point.lng);
    }
    const padded = padCollapsedBounds(minLng, minLat, maxLng, maxLat);
    cameraRef.current?.fitBounds([padded.minLng, padded.minLat, padded.maxLng, padded.maxLat], {
      padding: TRACK_STUDIO_CAMERA_PADDING,
      duration: 620,
    });
  }, [focusedTrack, trackModeActive]);

  useEffect(() => {
    if (selectedMarker) {
      markerSheetRef.current?.snapToIndex(0);
    } else {
      markerSheetRef.current?.close();
    }
  }, [selectedMarker]);

  // Track Studio sheet follows the "tracks" tab.
  useEffect(() => {
    if (trackModeActive) {
      trackSheetRef.current?.snapToIndex(0);
    } else {
      trackSheetRef.current?.close();
    }
  }, [trackModeActive]);

  // A tapped incident notification focuses the map on it and opens its sheet.
  const focusIncidentId = useNotificationFocus((s) => s.incidentId);
  const focusRequestId = useNotificationFocus((s) => s.requestId);
  const clearNotificationFocus = useNotificationFocus((s) => s.clear);
  const focusFetchedRef = useRef(-1);
  useEffect(() => {
    if (!focusIncidentId) return;
    const marker = useMapStore
      .getState()
      .markers.find((m) => m.id === focusIncidentId && m.type === "incident");
    if (!marker) {
      // Created while backgrounded? Fetch incidents once, then this effect retries.
      if (focusFetchedRef.current !== focusRequestId) {
        focusFetchedRef.current = focusRequestId;
        void refreshIncidents();
      }
      return;
    }
    setActiveTab("map");
    didInitialEventFitRef.current = true; // the tracks-overview fit must not override this
    // Frame BOTH me and the incident, horizontally centred on their midpoint and
    // pushed into the upper part of the screen — the incident sheet covers the
    // lower ~half of the map.
    const myFix = useLocationStatus.getState().lastFix;
    if (myFix && isFiniteCoord(myFix.lng, myFix.lat)) {
      const midLng = (myFix.lng + marker.lng) / 2;
      const midLat = (myFix.lat + marker.lat) / 2;
      const latSpan = Math.abs(myFix.lat - marker.lat);
      const lngSpan = Math.abs(myFix.lng - marker.lng) * Math.cos((midLat * Math.PI) / 180);
      const spanDeg = Math.max(latSpan, lngSpan, 0.003) * 2.6; // breathing room
      const zoom = Math.max(10.5, Math.min(16.5, Math.log2(360 / spanDeg)));
      cameraRef.current?.easeTo({
        center: [midLng, midLat],
        zoom,
        padding: { top: 90, bottom: Math.round(SCREEN_HEIGHT * 0.5), left: 0, right: 0 },
        duration: 600,
      });
    } else {
      cameraRef.current?.easeTo({
        center: [marker.lng, marker.lat],
        zoom: USER_FOCUS_ZOOM,
        padding: { top: 0, bottom: Math.round(SCREEN_HEIGHT * 0.4), left: 0, right: 0 },
        duration: 550,
      });
    }
    setSelectedMarkerId(marker.id);
    clearNotificationFocus();
  }, [focusRequestId, focusIncidentId, markers, clearNotificationFocus, refreshIncidents]);

  const closeSelection = () => {
    setSelectedMarkerId(null);
  };

  // Starting navigation (e.g. "Navigate" from a marker sheet) opens the transport
  // overlay — close any open marker selection / menus so they don't overlap it.
  useEffect(() => {
    if (navPhase !== "idle") {
      setSelectedMarkerId(null);
      setMenuOpen(false);
      setLayersOpen(false);
    }
  }, [navPhase]);

  // Broadcast my active navigation path to the whole team when navigation starts,
  // and clear it when it ends — so everyone + the dashboard sees the route + ETA.
  const navWasActiveRef = useRef(false);
  useEffect(() => {
    const isActive = navPhase === "active";
    const wasActive = navWasActiveRef.current;
    navWasActiveRef.current = isActive;
    if (isActive && !wasActive) {
      const st = useNavStore.getState();
      const route = st.routes.find((r) => r.id === st.selectedRouteId) ?? st.routes[0];
      if (route) {
        void setMyRoute(
          {
            geometry: route.geometry,
            segments: route.segments.map((s) => ({ surface: s.surface, coordinates: s.coordinates })),
            distanceMeters: route.distanceMeters,
            durationMs: route.durationMs,
            etaIso: new Date(Date.now() + route.durationMs).toISOString(),
            incidentId: st.destinationIncidentId,
          },
          st.destination ? { lat: st.destination.lat, lng: st.destination.lng, label: st.destination.label } : null,
        ).catch(() => {});
      }
    } else if (!isActive && wasActive) {
      void setMyRoute(null).catch(() => {});
    }
  }, [navPhase]);

  // Medics currently responding to an open incident — drives the flashing blue
  // lights on their marker for everyone (works for app dispatch + simulator).
  const respondingMedicIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of markers) {
      if (m.type === "incident" && !isClosedIncidentStatus(m.status)) {
        for (const id of m.respondingParamedicIds ?? []) ids.add(id);
      }
    }
    return ids;
  }, [markers]);

  const toggleLayer = (key: keyof LayerVisibility) => {
    setLayerVisibility((state) => ({
      ...state,
      [key]: !state[key],
    }));
  };

  // Participants are a single 3-state control (Off / Individual / Heatmap) backed
  // by the two underlying booleans.
  const participantsMode: ParticipantsMode = layerVisibility.participantsHeatmap
    ? "heatmap"
    : layerVisibility.participants
      ? "individual"
      : "off";
  const setParticipantsMode = (mode: ParticipantsMode) => {
    setLayerVisibility((state) => ({
      ...state,
      participants: mode === "individual",
      participantsHeatmap: mode === "heatmap",
    }));
  };

  const toggleTrack = (trackId: string) => {
    setTrackVisibility((state) => ({
      ...state,
      [trackId]: !(state[trackId] ?? true),
    }));
  };

  const toggleAllTracks = () => {
    setTrackVisibility((state) => {
      const shouldShowAll = !allTracksVisible;
      const next: TrackVisibility = { ...state };
      for (const track of trackVisuals) {
        next[track.id] = shouldShowAll;
      }
      return next;
    });
  };

  const centerOnCurrentPosition = async () => {
    const permission = await ExpoLocation.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return;
    }

    const location = await ExpoLocation.getCurrentPositionAsync({});
    cameraRef.current?.easeTo({
      center: [location.coords.longitude, location.coords.latitude],
      zoom: USER_FOCUS_ZOOM,
      padding: { top: 0, bottom: 0, left: 0, right: 0 }, // clear any focus offset
      duration: 420,
    });
  };

  const resetMapNorth = async () => {
    const viewState = await mapRef.current?.getViewState();
    if (!viewState) {
      return;
    }

    cameraRef.current?.easeTo({
      center: viewState.center,
      zoom: viewState.zoom,
      bearing: 0,
      pitch: 0, // flatten any 3D tilt along with the heading reset
      duration: 340,
    });
  };

  const incidentDistance =
    selectedIncident && myLocationFix
      ? distanceKm(myLocationFix.lat, myLocationFix.lng, selectedIncident.lat, selectedIncident.lng)
      : null;

  return (
    <View style={styles.container}>
      <MapLibreMap
        ref={mapRef}
        style={styles.map}
        mapStyle={{
          version: 8,
          sources: {},
          layers: [
            {
              id: "base-bg",
              type: "background",
              paint: {
                "background-color": mapyTilesTemplateUrl ? "#051325" : "#0b172a",
              },
            },
          ],
        }}
        logo={false}
        attribution={false}
        compass={false}
        onRegionDidChange={(event: any) => {
          const z = event?.properties?.zoom ?? event?.nativeEvent?.zoom;
          if (typeof z === "number" && Number.isFinite(z)) setMapZoom(z);
        }}
        onLongPress={(event: any) => {
          // PressEvent: { nativeEvent: { lngLat: [lng, lat], point: [x, y] } }.
          const lngLat = event?.nativeEvent?.lngLat ?? event?.geometry?.coordinates;
          const point = event?.nativeEvent?.point;
          if (Array.isArray(lngLat) && lngLat.length >= 2) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setMenuOpen(false);
            setLayersOpen(false);
            closeSelection();
            // Open the contextual radial menu at the pressed point. "Navigate
            // here" is the primary action; "Add point" still opens the POI sheet.
            setRadialAnchor({
              x: Array.isArray(point) ? point[0] : SCREEN_WIDTH / 2,
              y: Array.isArray(point) ? point[1] : SCREEN_HEIGHT / 2,
              lat: lngLat[1],
              lng: lngLat[0],
            });
          }
        }}
        onPress={(event: any) => {
          // During route editing, a tap places the pending inserted waypoint.
          if (navPhase !== "editing" || navPendingInsert === null) return;
          const lngLat = event?.nativeEvent?.lngLat;
          if (Array.isArray(lngLat) && lngLat.length >= 2) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void useNavStore.getState().placePoint({ lat: lngLat[1], lng: lngLat[0] });
          }
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [FALLBACK_LNG, FALLBACK_LAT],
            zoom: FALLBACK_ZOOM,
          }}
          trackUserLocation={navPhase === "active" ? undefined : "default"}
        />
        {navPhase !== "active" ? <UserLocation /> : null}

        <NavigationMapLayers />
        <MedicRoutesLayer zoom={mapZoom} dimmed={assignedToIncident} />

        <RasterSource
          key={`base-${baseLayer}`}
          id="base-raster-source"
          tiles={[baseTilesTemplateUrl]}
          maxzoom={baseRasterMaxZoom}
          tileSize={baseRasterTileSize}
        >
          <Layer
            id="base-raster-layer"
            type="raster"
            paint={{
              "raster-opacity": 1,
            }}
          />
        </RasterSource>

        {renderedTrackVisuals.map((track) => (
          <React.Fragment key={`track-${track.id}`}>
            <GeoJSONSource
              id={`${track.id}-outline-source`}
              data={lineFeatureFromCoordinates(track.coordinates)}
            >
              <Layer
                id={`${track.id}-outline-layer`}
                type="line"
                layout={{
                  "line-join": "round",
                  "line-cap": "round",
                }}
                paint={{
                  "line-color": shouldMuteTrackColors ? "rgba(105, 114, 126, 0.72)" : "rgba(6, 15, 28, 0.82)",
                  "line-width": 10,
                  "line-opacity": shouldMuteTrackColors ? 0.72 : 1,
                  "line-offset": trackLineOffsetValue(track.lineOffset),
                }}
              />
            </GeoJSONSource>
            {trackGradientEnabled ? (
              <>
                <GeoJSONSource
                  id={`${track.id}-gradient-base-source`}
                  data={lineFeatureFromCoordinates(track.coordinates)}
                >
                  <Layer
                    id={`${track.id}-gradient-base-layer`}
                    type="line"
                    layout={{
                      "line-join": "round",
                      "line-cap": "round",
                    }}
                    paint={{
                      "line-color": shouldMuteTrackColors ? "rgb(142,142,142)" : track.color,
                      "line-width": 6.4,
                      "line-opacity": shouldMuteTrackColors ? 0.6 : 0.95,
                      "line-offset": trackLineOffsetValue(track.lineOffset),
                    }}
                  />
                </GeoJSONSource>
                {track.gradientSegments.map((segment, segmentIndex) => (
                  <GeoJSONSource
                    key={`${track.id}-segment-source-${segmentIndex}`}
                    id={`${track.id}-segment-source-${segmentIndex}`}
                    data={lineFeatureFromCoordinates(segment.coordinates)}
                  >
                    <Layer
                      id={`${track.id}-segment-layer-${segmentIndex}`}
                      type="line"
                      layout={{
                        "line-join": "round",
                        "line-cap": "round",
                      }}
                      paint={{
                        "line-color": shouldMuteTrackColors ? "rgb(142,142,142)" : segment.color,
                        "line-width": 6,
                        "line-opacity": shouldMuteTrackColors ? 0.6 : 1,
                        "line-offset": trackLineOffsetValue(track.lineOffset),
                      }}
                    />
                  </GeoJSONSource>
                ))}
              </>
            ) : (
              <GeoJSONSource id={`${track.id}-base-source`} data={lineFeatureFromCoordinates(track.coordinates)}>
                <Layer
                  id={`${track.id}-base-layer`}
                  type="line"
                  layout={{
                    "line-join": "round",
                    "line-cap": "round",
                  }}
                  paint={{
                    "line-color": shouldMuteTrackColors ? "rgb(142,142,142)" : track.color,
                    "line-width": 6.4,
                    "line-opacity": shouldMuteTrackColors ? 0.6 : 1,
                    "line-offset": trackLineOffsetValue(track.lineOffset),
                  }}
                />
              </GeoJSONSource>
            )}
          </React.Fragment>
        ))}

        {trackModeActive && focusedTrackScrubSegmentFeature ? (
          <GeoJSONSource id="track-scrub-segment-source" data={focusedTrackScrubSegmentFeature}>
            <Layer
              id="track-scrub-segment-layer"
              type="line"
              layout={{
                "line-join": "round",
                "line-cap": "round",
              }}
              paint={{
                "line-color": focusedTrackElevationLineColor,
                "line-width": 9,
                "line-opacity": 0.96,
              }}
            />
          </GeoJSONSource>
        ) : null}

        {layerVisibility.participantsHeatmap && !trackModeActive ? (
          <GeoJSONSource id="participants-heat-source" data={runnerHeatFeatureCollection}>
            <Layer
              id="participants-density-glow-layer"
              type="circle"
              filter={[">=", ["get", "count"], 1]}
              paint={
                {
                  "circle-color": [
                    "interpolate",
                    ["linear"],
                    densityCountExpression,
                    0,
                    "rgba(33,102,172,0)",
                    0.8,
                    "rgba(103,169,207,0.36)",
                    2.5,
                    "rgba(166,217,106,0.46)",
                    5.5,
                    "rgba(253,174,97,0.58)",
                    9,
                    "rgba(239,138,98,0.72)",
                    14,
                    "rgba(178,24,43,0.86)",
                  ],
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10,
                    [
                      "interpolate",
                      ["linear"],
                      densityCountExpression,
                      0.6,
                      14,
                      2,
                      26,
                      6,
                      38,
                      12,
                      54,
                      20,
                      68,
                    ],
                    14,
                    [
                      "interpolate",
                      ["linear"],
                      densityCountExpression,
                      0.6,
                      18,
                      2,
                      33,
                      6,
                      48,
                      12,
                      68,
                      20,
                      84,
                    ],
                    18,
                    [
                      "interpolate",
                      ["linear"],
                      densityCountExpression,
                      0.6,
                      24,
                      2,
                      44,
                      6,
                      64,
                      12,
                      88,
                      20,
                      108,
                    ],
                  ],
                  "circle-opacity": 0.95,
                  "circle-blur": 0.82,
                } as any
              }
            />
            <Layer
              id="participants-density-core-layer"
              type="circle"
              filter={[">=", ["get", "count"], 1]}
              paint={
                {
                  "circle-color": [
                    "interpolate",
                    ["linear"],
                    densityCountExpression,
                    0,
                    "rgba(33,102,172,0)",
                    1.2,
                    "rgba(103,169,207,0.58)",
                    4.5,
                    "rgba(253,174,97,0.74)",
                    8,
                    "rgba(215,48,39,0.86)",
                    12,
                    "rgba(178,24,43,1)",
                  ],
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10,
                    [
                      "interpolate",
                      ["linear"],
                      densityCountExpression,
                      0.6,
                      7,
                      2,
                      13,
                      6,
                      20,
                      12,
                      30,
                    ],
                    14,
                    [
                      "interpolate",
                      ["linear"],
                      densityCountExpression,
                      0.6,
                      9,
                      2,
                      17,
                      6,
                      26,
                      12,
                      39,
                    ],
                    18,
                    [
                      "interpolate",
                      ["linear"],
                      densityCountExpression,
                      0.6,
                      12,
                      2,
                      23,
                      6,
                      36,
                      12,
                      54,
                    ],
                  ],
                  "circle-opacity": 0.84,
                  "circle-blur": 0.58,
                } as any
              }
            />
          </GeoJSONSource>
        ) : null}

        {/* Curved, flowing "Assigned" lines from responding medics to incidents
            (replaced by the coloured route once they start navigating). */}
        <AssignedRoutesLayer />

        {/* "Going to" lines — straight dashed line to the destination. Suppressed
            when the medic has a real navigation path (the coloured route is shown
            instead, so we don't draw a misleading straight line over it). */}
        {markers
          .filter(
            (m) =>
              m.type === "paramedic" &&
              m.destination &&
              !m.route &&
              !respondingMedicIds.has(m.id) &&
              isFiniteCoord(m.destination.lng, m.destination.lat) &&
              isFiniteCoord(m.lng, m.lat),
          )
          .map((medic) => {
            const dest = medic.destination!;
            return (
              <React.Fragment key={`dest-${medic.id}`}>
                <GeoJSONSource
                  id={`dest-line-source-${medic.id}`}
                  data={lineFeatureFromCoordinates([
                    { latitude: medic.lat, longitude: medic.lng },
                    { latitude: dest.lat, longitude: dest.lng },
                  ])}
                >
                  <Layer
                    id={`dest-line-layer-${medic.id}`}
                    type="line"
                    paint={{
                      "line-color":
                        assignedToIncident && medic.id !== sessionUserId
                          ? "rgba(245, 158, 11, 0.45)"
                          : "rgba(245, 158, 11, 0.85)",
                      "line-width": 3,
                      "line-dasharray": [1.5, 1.8],
                    }}
                  />
                </GeoJSONSource>
                <Marker lngLat={[dest.lng, dest.lat]}>
                  <View style={styles.destFlag}>
                    <Text style={styles.destFlagText}>🚩</Text>
                  </View>
                </Marker>
              </React.Fragment>
            );
          })}

        {selectedMarker && selectedMarker.type === "paramedic" && selectedMarker.accuracy != null && selectedMarker.accuracy > 0 ? (
          <GeoJSONSource
            id="accuracy-circle-source"
            data={buildAccuracyCircle(selectedMarker.lat, selectedMarker.lng, selectedMarker.accuracy)}
          >
            <Layer
              id="accuracy-circle-fill"
              type="fill"
              paint={{ "fill-color": "#22c55e", "fill-opacity": 0.12 }}
            />
            <Layer
              id="accuracy-circle-outline"
              type="line"
              paint={{ "line-color": "#22c55e", "line-width": 1.5, "line-opacity": 0.5 }}
            />
          </GeoJSONSource>
        ) : null}

        {orderedVisibleMarkers.filter((marker) => isFiniteCoord(marker.lng, marker.lat)).map((marker) => (
          <Marker
            key={marker.id}
            lngLat={[marker.lng, marker.lat]}
            onPress={() => {
              setSelectedMarkerId(marker.id);
              // Bring the tapped marker into the upper half — the detail sheet
              // opens over the bottom ~42% of the screen.
              cameraRef.current?.easeTo({
                center: [marker.lng, marker.lat],
                zoom: Math.max(mapZoom, 13.5),
                padding: { top: 0, bottom: Math.round(SCREEN_HEIGHT * 0.42), left: 0, right: 0 },
                duration: 480,
              });
            }}
          >
            <View>
              {marker.type === "incident" ? (() => {
                const closed = isClosedIncidentStatus(marker.status);
                const isSelected = marker.id === selectedMarkerId;
                return (
                  <SelectionPulse active={isSelected} size={26} color={closed ? "#94a3b8" : "#ef4444"}>
                    <View style={[styles.incidentDot, closed && styles.incidentDotClosed, isSelected && styles.incidentDotSelected]}>
                      <Text style={[styles.incidentDotText, closed && styles.incidentDotTextClosed]}>
                        {closed ? "✓" : "!"}
                      </Text>
                    </View>
                  </SelectionPulse>
                );
              })() : null}

              {marker.type === "paramedic" ? (() => {
                const ageMs = marker.lastSeenAt
                  ? Date.now() - new Date(marker.lastSeenAt).getTime()
                  : undefined;
                // Fresher = greener (0–20m), yellow (20–40m), grey (>40m).
                const freshColor = freshnessColor(ageMs);
                const isGrey = freshnessBucket(ageMs) === "stale";
                const isResting = marker.status === "rest";
                const isStationary = marker.status === "stationary";
                // Responding to an incident → whole dot flashes red/blue for everyone.
                const isResponding = respondingMedicIds.has(marker.id) || Boolean(marker.route?.incidentId);
                // Heading to a (non-incident) point → a "moving" badge.
                const isGoingToPoint = !isResponding && (Boolean(marker.route) || Boolean(marker.destination)) && marker.status === "going_to";
                const dotColor = isResting ? "#a78bfa" : freshColor;
                return (
                  <SelectionPulse active={marker.id === selectedMarkerId} size={30} color={isGrey ? "#94a3b8" : dotColor}>
                    <MedicDot
                      initials={markerInitials(marker.label)}
                      dotColor={dotColor}
                      isGrey={isGrey}
                      isResponding={isResponding}
                      isStationary={isStationary}
                      isGoingToPoint={isGoingToPoint}
                      selected={false}
                      // I'm on an incident → fade everyone but me so my own path
                      // stays the visual focus.
                      dimmed={assignedToIncident && marker.id !== sessionUserId}
                    />
                  </SelectionPulse>
                );
              })() : null}

              {marker.type === "runner" ? <View style={styles.runnerDot} /> : null}

              {marker.type === "infrastructure" ? (() => {
                const cfg = poiConfig(marker.poiType);
                return (
                  <View style={[styles.poiDot, { backgroundColor: cfg.color, width: cfg.size, height: cfg.size, borderRadius: cfg.size / 2 }]}>
                    <Text style={styles.poiDotText}>{cfg.icon}</Text>
                  </View>
                );
              })() : null}
            </View>
          </Marker>
        ))}

        {trackModeActive && focusedTrackSample ? (
          <Marker key="track-focus-cursor" lngLat={[focusedTrackSample.lng, focusedTrackSample.lat]}>
            <View style={styles.trackCursorOuter}>
              <View style={styles.trackCursorInner} />
            </View>
          </Marker>
        ) : null}
      </MapLibreMap>

      {/* Heatmap temporary tuner (disabled with heatmap).
      <View style={styles.heatTunerPanel}>
        <Text style={styles.heatTunerTitle}>Heat weight {heatWeightScale.toFixed(2)}</Text>
        <View style={styles.heatTunerRow}>
          <Pressable
            style={styles.heatTunerButton}
            onPress={() =>
              setHeatWeightScale((value) => Math.max(HEATMAP_WEIGHT_MIN, Number((value - HEATMAP_WEIGHT_STEP).toFixed(2))))
            }
          >
            <Text style={styles.heatTunerButtonText}>-</Text>
          </Pressable>
          <View style={styles.heatSliderTrack} {...heatWeightPanResponder.panHandlers}>
            <View style={[styles.heatSliderFill, { width: heatSliderPosition }]} />
            <View style={[styles.heatSliderKnob, { left: heatSliderKnobLeft }]} />
          </View>
          <Pressable
            style={styles.heatTunerButton}
            onPress={() =>
              setHeatWeightScale((value) => Math.min(HEATMAP_WEIGHT_MAX, Number((value + HEATMAP_WEIGHT_STEP).toFixed(2))))
            }
          >
            <Text style={styles.heatTunerButtonText}>+</Text>
          </Pressable>
        </View>
      </View> */}

      {overlayOpen ? (
        <Pressable
          style={styles.menuBackdrop}
          onPress={() => {
            setMenuOpen(false);
            setLayersOpen(false);
          }}
        />
      ) : null}

      {/* Offline incident badge — tap to inspect pending reports */}
      {(offlineQueueCount > 0 || justFlushed) ? (
        <Pressable
          style={styles.offlineBadgeHit}
          onPress={() => setPendingSheetOpen(true)}
          disabled={justFlushed}
        >
          <Animated.View
            style={[styles.offlineBadge, { opacity: offlineBadgeOpacity, backgroundColor: justFlushed ? "#22c55e" : "#f97316" }]}
          >
            <Text style={styles.offlineBadgeText}>
              {justFlushed ? "✓ Sent" : `${offlineQueueCount} unsent ›`}
            </Text>
          </Animated.View>
        </Pressable>
      ) : null}

      {/* <View style={styles.missionStrip}>
        <Text style={styles.missionStripText}>MISSION: ACTIVE</Text>
        <Text style={styles.missionStripText}>ACADEMY FIRST AID</Text>
      </View> */}

      {/* box-none: the header container is as tall as the action-button column and
          spans the full width — without it, it swallows touches over the map
          (e.g. the radial menu's buttons rendered underneath at zIndex 0). */}
      <View style={styles.topHeader} pointerEvents="box-none">
        <Pressable
          style={styles.menuButton}
          onPress={() => {
            setMenuOpen((open) => !open);
            setLayersOpen(false);
          }}
        >
          <Text style={styles.menuButtonText}>Menu</Text>
        </Pressable>

        <Pressable style={styles.eventChip}>
          <View style={styles.eventHeaderRow}>
            <Text style={styles.eventTitle} numberOfLines={1}>{eventTitle ?? "EVENT"}</Text>
            {/* <Text style={styles.eventCaret}>v</Text> */}
          </View>
          <View style={styles.eventMetaRow}>
            {/* <Text style={styles.livePill}>LIVE</Text> */}
            {/* <Text style={styles.eventMetaText}>02:45:18</Text> */}
            {/* <Text style={styles.eventMetaText}>{viewMode.toUpperCase()}</Text> */}
          </View>
        </Pressable>

        {!selectedMarker ? (
          <View style={styles.headerActions} pointerEvents="box-none">
            <Pressable
              style={[styles.headerActionButton, layersOpen && styles.headerActionButtonActive]}
              onPress={() => {
                setLayersOpen((open) => !open);
                setMenuOpen(false);
              }}
            >
              <Feather name="layers" size={20} color={layersOpen ? "#34d399" : "#ecf4ff"} />
            </Pressable>

            <Pressable
              style={styles.headerActionButton}
              onPress={centerOnCurrentPosition}
              onLongPress={() => {
                if (!trackingHealth.ok) setActiveTab("location");
              }}
            >
              <Feather name="crosshair" size={20} color="#ecf4ff" />
              {!trackingHealth.ok ? (
                <View style={styles.healthBadge}>
                  <Text style={styles.healthBadgeText}>!</Text>
                </View>
              ) : null}
            </Pressable>

            <Pressable
              style={[styles.headerActionButton, navPhase === "active" && navCameraMode === "north" && styles.headerActionButtonActive]}
              onPress={() => {
                if (navPhase === "active") {
                  void Haptics.selectionAsync();
                  useNavStore.getState().toggleNavCamera();
                } else {
                  void resetMapNorth();
                }
              }}
            >
              {navPhase === "active" ? (
                navCameraMode === "north" ? (
                  // North-up while navigating: show an "N" compass marker.
                  <Feather name="compass" size={20} color="#34d399" />
                ) : (
                  // Follow (look-ahead): show the heading arrow.
                  <Feather name="navigation" size={19} color="#ecf4ff" />
                )
              ) : (
                <Feather name="compass" size={20} color="#ecf4ff" />
              )}
            </Pressable>

            <OfflineControlButton
              tilesUrl={baseTilesTemplateUrl}
              tileSize={baseRasterTileSize}
              getBounds={computeOfflineBounds}
            />
          </View>
        ) : null}
      </View>

      {menuOpen ? (
        <View style={styles.menuPopup}>
          <Text style={styles.menuPopupTitle}>Menu</Text>
          <Pressable
            style={styles.menuPageRow}
            onPress={() => {
              setActiveTab("location");
              setMenuOpen(false);
            }}
          >
            <Feather name="map-pin" size={18} color="#7dd3fc" style={styles.menuPageIcon} />
            <View style={styles.menuPageTextWrap}>
              <Text style={styles.menuPageTitle}>Location diagnostics</Text>
              <Text style={styles.menuPageSubtitle}>GPS status, accuracy, history</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#475569" />
          </Pressable>
          <Pressable
            style={styles.menuPageRow}
            onPress={() => {
              setActiveTab("guide");
              setMenuOpen(false);
            }}
          >
            <Feather name="book-open" size={18} color="#fbbf24" style={styles.menuPageIcon} />
            <View style={styles.menuPageTextWrap}>
              <Text style={styles.menuPageTitle}>Field Guide</Text>
              <Text style={styles.menuPageSubtitle}>Symptom search & action reminders</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#475569" />
          </Pressable>
          <Pressable
            style={styles.menuPageRow}
            onPress={() => {
              setActiveTab("settings");
              setMenuOpen(false);
            }}
          >
            <Feather name="settings" size={18} color="#34d399" style={styles.menuPageIcon} />
            <View style={styles.menuPageTextWrap}>
              <Text style={styles.menuPageTitle}>Settings</Text>
              <Text style={styles.menuPageSubtitle}>Map display & location tracking</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#475569" />
          </Pressable>
          <Pressable
            style={styles.menuPageRow}
            onPress={() => {
              setActiveTab("debug");
              setMenuOpen(false);
            }}
          >
            <Feather name="terminal" size={18} color="#a78bfa" style={styles.menuPageIcon} />
            <View style={styles.menuPageTextWrap}>
              <Text style={styles.menuPageTitle}>Debug Console</Text>
              <Text style={styles.menuPageSubtitle}>Logs, network & diagnostics</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#475569" />
          </Pressable>
          <Pressable
            style={[styles.menuPageRow, styles.menuLeaveRow]}
            onPress={() => {
              setMenuOpen(false);
              clearSession();
            }}
          >
            <Feather name="log-out" size={18} color="#f87171" style={styles.menuPageIcon} />
            <View style={styles.menuPageTextWrap}>
              <Text style={[styles.menuPageTitle, styles.menuLeaveText]}>Leave Event</Text>
              <Text style={styles.menuPageSubtitle}>Return to the join screen</Text>
            </View>
            <Text style={styles.menuLeaveArrow}>→</Text>
          </Pressable>
        </View>
      ) : null}

      {layersOpen ? (
        <ScrollView style={styles.layersPopup} contentContainerStyle={styles.layersPopupContent}>
          {/* Base map selector */}
          <Text style={styles.layerSectionLabel}>BASE MAP</Text>
          <View style={styles.segmentRow}>
            {(Object.keys(BASE_LAYERS) as BaseLayer[]).map((key) => {
              const active = baseLayer === key;
              return (
                <Pressable
                  key={key}
                  style={[styles.segmentItem, active && styles.segmentItemActive]}
                  onPress={() => setBaseLayer(key)}
                >
                  <Feather name={BASE_LAYERS[key].icon} size={14} color={active ? "#04121f" : "#9fb3cc"} />
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{BASE_LAYERS[key].label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Overlays */}
          <Text style={styles.layerSectionLabel}>OVERLAYS</Text>
          <Pressable style={styles.layerRow} onPress={() => toggleLayer("paramedics")}>
            <Text style={styles.layerLabel}>Medics</Text>
            <View style={[styles.switchTrack, layerVisibility.paramedics ? styles.switchTrackOn : null]}>
              <View style={[styles.switchKnob, layerVisibility.paramedics ? styles.switchKnobOn : null]} />
            </View>
          </Pressable>

          <Pressable style={styles.layerRow} onPress={() => toggleLayer("incidents")}>
            <Text style={styles.layerLabel}>Incidents</Text>
            <View style={[styles.switchTrack, layerVisibility.incidents ? styles.switchTrackOn : null]}>
              <View style={[styles.switchKnob, layerVisibility.incidents ? styles.switchKnobOn : null]} />
            </View>
          </Pressable>

          {/* Participants — compact 3-state, inline under overlays. */}
          <View style={styles.layerRow}>
            <Text style={styles.layerLabel}>Participants</Text>
            <View style={styles.miniSegmentRow}>
              {(["off", "individual", "heatmap"] as ParticipantsMode[]).map((mode) => {
                const active = participantsMode === mode;
                const label = mode === "off" ? "Off" : mode === "individual" ? "Dots" : "Heat";
                return (
                  <Pressable
                    key={mode}
                    style={[styles.miniSegmentItem, active && styles.segmentItemActive]}
                    onPress={() => setParticipantsMode(mode)}
                  >
                    <Text style={[styles.miniSegmentText, active && styles.segmentTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.tracksHeaderRow}>
            <Text style={styles.tracksHeaderText}>Tracks</Text>
            <Pressable style={styles.tracksToggleAllButton} onPress={toggleAllTracks}>
              <Text style={styles.tracksToggleAllText}>{allTracksVisible ? "Turn off all" : "Turn on all"}</Text>
            </Pressable>
          </View>

          {trackVisuals.map((track) => (
            <Pressable key={track.id} style={styles.trackLayerRow} onPress={() => toggleTrack(track.id)}>
              <View style={styles.trackLayerLabelWrap}>
                <View style={[styles.trackColorDot, { backgroundColor: track.color }]} />
                <Text style={styles.layerLabel}>{track.label}</Text>
              </View>
              <View style={[styles.switchTrack, (trackVisibility[track.id] ?? true) ? styles.switchTrackOn : null]}>
                <View style={[styles.switchKnob, (trackVisibility[track.id] ?? true) ? styles.switchKnobOn : null]} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <BottomSheet
        ref={trackSheetRef}
        index={-1}
        snapPoints={TRACK_SHEET_SNAP_POINTS}
        enableDynamicSizing={false}
        enablePanDownToClose={false}
        // Only the top handle drags the sheet — so scrubbing the elevation graph
        // doesn't steal the gesture and move the drawer.
        enableContentPanningGesture={false}
        onChange={setTrackSheetIndex}
        backgroundStyle={styles.markerSheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        <BottomSheetView style={styles.markerSheetContent}>
        <View style={styles.tracksDrawer}>
          <View style={styles.tracksDrawerHeaderRow}>
            <Text style={styles.tracksDrawerKicker}>TRACK STUDIO</Text>
            <Text style={styles.tracksDrawerMeta}>
              {trackSheetIndex >= 1
                ? (focusedTrackProfile ? `${(focusedTrackProfile.totalDistanceMeters / 1000).toFixed(1)} km` : "No track")
                : "▲ pull up for details"}
            </Text>
          </View>

          <Pressable style={styles.trackSelectButton} onPress={() => setTrackPickerOpen((open) => !open)}>
            <Text style={styles.trackSelectLabel}>Selected track</Text>
            <View style={styles.trackSelectValueWrap}>
              <Text style={styles.trackSelectValue}>{focusedTrack?.label ?? "Choose track"}</Text>
              <Text style={styles.trackSelectCaret}>{trackPickerOpen ? "^" : "v"}</Text>
            </View>
          </Pressable>

          {trackPickerOpen ? (
            <ScrollView
              style={styles.trackPickerScroll}
              contentContainerStyle={styles.trackPickerContent}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {tracks.map((track) => {
                const isActive = focusedTrack?.id === track.id;
                return (
                  <Pressable
                    key={track.id}
                    style={[styles.trackPickerChip, isActive ? styles.trackPickerChipActive : null]}
                    onPress={() => {
                      setFocusedTrackId(track.id);
                      setTrackProfileProgress(0);
                      setTrackPickerOpen(false);
                    }}
                  >
                    <Text style={[styles.trackPickerChipText, isActive ? styles.trackPickerChipTextActive : null]}>
                      {track.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {focusedTrackProfile && focusedTrackSample ? (
            <View style={styles.profileCard}>
              <View style={styles.profileReadoutRow}>
                <View>
                  <Text style={styles.profileMetricLabel}>Distance from start</Text>
                  <Text style={styles.profileMetricValue}>{(focusedTrackSample.distanceMeters / 1000).toFixed(2)} km</Text>
                </View>
                <View style={styles.profileMetricSpacer} />
                <View>
                  <Text style={styles.profileMetricLabel}>Elevation</Text>
                  <Text style={styles.profileMetricValue}>{Math.round(focusedTrackSample.elevationMeters)} m</Text>
                </View>
              </View>
              <View ref={trackProfileChartRef} style={styles.profileGradientChart}>
                <View
                  style={styles.profileGradientScrubSurface}
                  onLayout={(event) => {
                    setTrackProfileWidth(event.nativeEvent.layout.width);
                    measureTrackProfileChart();
                  }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(event) => {
                    updateTrackProfileProgressFromPageX(event.nativeEvent.pageX, event.nativeEvent.locationX);
                  }}
                  onResponderMove={(event) => {
                    updateTrackProfileProgressFromPageX(event.nativeEvent.pageX, event.nativeEvent.locationX);
                  }}
                  onTouchStart={(event) => {
                    updateTrackProfileProgressFromPageX(event.nativeEvent.pageX, event.nativeEvent.locationX);
                  }}
                  onTouchMove={(event) => {
                    updateTrackProfileProgressFromPageX(event.nativeEvent.pageX, event.nativeEvent.locationX);
                  }}
                />
                <View style={styles.profileGradientChartZeroLine} />
                {focusedTrackElevationLinePoints.slice(0, -1).map((point, index) => {
                  const next = focusedTrackElevationLinePoints[index + 1];
                  if (!next) {
                    return null;
                  }
                  const currentTop = elevationToChartTopPercent(
                    point.value,
                    focusedTrackProfile.minElevationMeters,
                    focusedTrackProfile.maxElevationMeters,
                  );
                  const nextTop = elevationToChartTopPercent(
                    next.value,
                    focusedTrackProfile.minElevationMeters,
                    focusedTrackProfile.maxElevationMeters,
                  );
                  const stepTop = Math.min(currentTop, nextTop);
                  const stepHeight = Math.max(1, Math.abs(nextTop - currentTop));
                  const horizontalWidth = Math.max(0.8, (next.progress - point.progress) * 100);
                  return (
                    <React.Fragment key={point.key}>
                      <View
                        style={[
                          styles.profileGradientChartSegmentHorizontal,
                          {
                            left: `${point.progress * 100}%`,
                            width: `${horizontalWidth}%`,
                            top: `${currentTop}%`,
                            backgroundColor: focusedTrackElevationLineColor,
                          },
                        ]}
                      />
                      <View
                        style={[
                          styles.profileGradientChartSegmentVertical,
                          {
                            left: `${next.progress * 100}%`,
                            top: `${stepTop}%`,
                            height: `${stepHeight}%`,
                            backgroundColor: focusedTrackElevationLineColor,
                          },
                        ]}
                      />
                    </React.Fragment>
                  );
                })}
                <View style={[styles.profileGradientChartCursorLine, { left: `${trackProfileProgress * 100}%` }]} />
                <View
                  style={[
                    styles.profileGradientChartCursorDot,
                    {
                      left: `${trackProfileProgress * 100}%`,
                      top: `${focusedTrackElevationCursorTopPercent}%`,
                    },
                  ]}
                />
                {/* The user's own position projected onto the track */}
                {myTrackPosition ? (
                  <>
                    <View style={[styles.profileMyLocationLine, { left: `${myTrackPosition.progress * 100}%` }]} />
                    <View
                      style={[
                        styles.profileMyLocationDot,
                        { left: `${myTrackPosition.progress * 100}%`, top: `${myTrackCursorTopPercent}%` },
                      ]}
                    />
                  </>
                ) : null}
              </View>

              {trackSheetIndex >= 1 ? (
                <View style={styles.trackExpandedSection}>
                  <Text style={styles.trackExpandedKicker}>YOUR PROGRESS</Text>
                  {myTrackPosition ? (
                    <>
                      <View style={styles.trackMetricsGrid}>
                        <View style={styles.trackMetricCard}>
                          <Text style={styles.trackMetricLabel}>Distance left</Text>
                          <Text style={styles.trackMetricValue}>{(myTrackPosition.distanceLeftMeters / 1000).toFixed(2)} km</Text>
                        </View>
                        <View style={styles.trackMetricCard}>
                          <Text style={styles.trackMetricLabel}>Climb left</Text>
                          <Text style={[styles.trackMetricValue, { color: "#f97316" }]}>↑ {Math.round(myTrackPosition.ascentLeftMeters)} m</Text>
                        </View>
                        <View style={styles.trackMetricCard}>
                          <Text style={styles.trackMetricLabel}>Descent left</Text>
                          <Text style={[styles.trackMetricValue, { color: "#38bdf8" }]}>↓ {Math.round(myTrackPosition.descentLeftMeters)} m</Text>
                        </View>
                        <View style={styles.trackMetricCard}>
                          <Text style={styles.trackMetricLabel}>Completed</Text>
                          <Text style={styles.trackMetricValue}>{Math.round(myTrackPosition.progress * 100)}%</Text>
                        </View>
                        <View style={styles.trackMetricCard}>
                          <Text style={styles.trackMetricLabel}>Off track</Text>
                          <Text style={[styles.trackMetricValue, myTrackPosition.offTrackMeters > 80 ? { color: "#ef4444" } : null]}>
                            {Math.round(myTrackPosition.offTrackMeters)} m
                          </Text>
                        </View>
                        <View style={styles.trackMetricCard}>
                          <Text style={styles.trackMetricLabel}>Total climb</Text>
                          <Text style={styles.trackMetricValue}>↑ {focusedTrack?.elevationProfile?.totalAscentMeters ?? 0} m</Text>
                        </View>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.profileEmptyText}>Waiting for your location to place you on the track…</Text>
                  )}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.profileEmpty}>
              <Text style={styles.profileEmptyText}>Pick a track to inspect profile and location cursor.</Text>
            </View>
          )}
        </View>
        </BottomSheetView>
      </BottomSheet>

      <BottomSheet
        ref={markerSheetRef}
        index={-1}
        snapPoints={MARKER_SHEET_SNAP_POINTS}
        enableDynamicSizing={false}
        enablePanDownToClose
        onClose={closeSelection}
        backgroundStyle={styles.markerSheetBg}
        handleIndicatorStyle={styles.sheetHandle}
      >
        {/* Plain View (not BottomSheetView) so the inner BottomSheetScrollView
            keeps a bounded flex height and actually scrolls long content. */}
        <View style={styles.markerSheetContent}>
        {selectedMarker && selectedIncident ? (
          <IncidentSheet
            incident={selectedIncident}
            distanceKm={incidentDistance}
            markerById={markerById}
            onClose={closeSelection}
            onOpenPhoto={(url) => setPhotoViewerUrl(url)}
          />
        ) : selectedMarker ? (
          <>
            <View style={styles.sheetHeader}>
              <View
                style={[
                  styles.incidentIconWrap,
                  selectedMarker.type === "paramedic"
                    ? styles.sheetParamedicIconBg
                    : selectedMarker.type === "runner"
                      ? styles.sheetParticipantIconBg
                      : selectedMarker.type === "infrastructure"
                        ? { backgroundColor: `${poiConfig(selectedMarker.poiType).color}26` }
                        : null,
                ]}
              >
                <Text
                  style={[
                    styles.incidentIconText,
                    selectedMarker.type === "incident" ? null : styles.sheetCompactIconText,
                    selectedMarker.type === "infrastructure"
                      ? { color: poiConfig(selectedMarker.poiType).color }
                      : null,
                  ]}
                >
                  {selectedMarker.type === "incident"
                    ? "!"
                    : selectedMarker.type === "paramedic"
                      ? markerInitials(selectedMarker.label)
                      : selectedMarker.type === "infrastructure"
                        ? poiConfig(selectedMarker.poiType).icon
                        : selectedMarker.bibNumber?.slice(0, 2) ?? "R"}
                </Text>
              </View>
              <View style={styles.sheetHeaderTextWrap}>
                <Text style={styles.sheetTitle}>{selectedMarker.name ?? selectedMarker.label}</Text>
                <Text style={styles.sheetMetaText}>
                  {selectedMarker.type === "incident"
                    ? `${incidentTypeLabel(selectedIncident?.incidentType)} · ${incidentStatusLabel(selectedIncident?.status)}`
                    : selectedMarker.type === "paramedic"
                      ? "Medical unit"
                      : selectedMarker.type === "infrastructure"
                        ? poiTypeLabel(selectedMarker.poiType)
                        : "Participant"}
                </Text>
                <Text style={styles.sheetMetaText}>
                  {selectedMarker.type === "incident"
                    ? incidentDistance != null
                      ? `${incidentDistance.toFixed(1)} km from your location`
                      : "Locating you…"
                    : selectedMarker.type === "paramedic"
                      ? selectedMarker.vehicle ?? "Mobile Unit"
                      : selectedMarker.type === "infrastructure"
                        ? `${selectedMarker.lat.toFixed(5)}, ${selectedMarker.lng.toFixed(5)}`
                        : `Bib ${selectedMarker.bibNumber ?? "N/A"}`}
                </Text>
              </View>

              <Pressable style={styles.sheetCloseButton} onPress={closeSelection}>
                <Text style={styles.sheetCloseButtonText}>X</Text>
              </Pressable>
            </View>

            <BottomSheetScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent} showsVerticalScrollIndicator={false}>
              {selectedMarker.type === "infrastructure" ? (
                <>
                  {selectedMarker.poiDescription ? (
                    <View style={styles.sheetInfoRow}>
                      <Text style={styles.sheetInfoLabel}>Description</Text>
                      <Text style={styles.sheetInfoValue}>{selectedMarker.poiDescription}</Text>
                    </View>
                  ) : (
                    <Text style={styles.sheetInfoValue}>Point of interest</Text>
                  )}
                  <AssignDestinationBar
                    destination={{
                      lat: selectedMarker.lat,
                      lng: selectedMarker.lng,
                      label: selectedMarker.name ?? selectedMarker.label,
                    }}
                  />
                  <Pressable
                    style={styles.poiArchiveBtn}
                    onPress={() => {
                      const poiId = selectedMarker.id;
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      const existing = useMapStore.getState().markers;
                      setMarkers(existing.filter((m) => m.id !== poiId));
                      closeSelection();
                      void archivePoi(poiId).catch((err) =>
                        debugLog("api", "error", "archive POI failed", String(err)),
                      );
                    }}
                  >
                    <Text style={styles.poiArchiveBtnText}>🗄  Archive point (hide for everyone)</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {(() => {
                    const rosterEntry =
                      selectedMarker.type === "paramedic"
                        ? rosterMedics.find((m) => m.id === selectedMarker.id)
                        : undefined;
                    const skills = [...(rosterEntry?.skills ?? []), ...(rosterEntry?.capabilities ?? [])];
                    return (
                      <>
                        <View style={styles.sheetInfoRow}>
                          <Text style={styles.sheetInfoLabel}>Role</Text>
                          <Text style={styles.sheetInfoValue}>
                            {rosterEntry?.type === "coordinator"
                              ? "Coordinator"
                              : selectedMarker.type === "paramedic"
                                ? "Medic"
                                : "Participant"}
                          </Text>
                        </View>
                        {skills.length > 0 ? (
                          <View style={styles.sheetInfoRow}>
                            <Text style={styles.sheetInfoLabel}>Skills</Text>
                            <Text style={[styles.sheetInfoValue, { flex: 1, textAlign: "right" }]}>{skills.join(" · ")}</Text>
                          </View>
                        ) : null}
                      </>
                    );
                  })()}
                  <View style={styles.sheetInfoRow}>
                    <Text style={styles.sheetInfoLabel}>Identifier</Text>
                    <Text style={styles.sheetInfoValue}>{selectedMarker.bibNumber ?? selectedMarker.id}</Text>
                  </View>
                  {(() => {
                    const ageMs = selectedMarker.lastSeenAt
                      ? Date.now() - new Date(selectedMarker.lastSeenAt).getTime()
                      : undefined;
                    return (
                      <View style={styles.sheetInfoRow}>
                        <Text style={styles.sheetInfoLabel}>Last seen</Text>
                        <Text style={[styles.sheetInfoValue, { color: freshnessColor(ageMs) }]}>
                          {ageMs === undefined ? "Unknown" : freshnessLabel(ageMs)}
                        </Text>
                      </View>
                    );
                  })()}
                  {selectedMarker.accuracy != null ? (
                    <View style={styles.sheetInfoRow}>
                      <Text style={styles.sheetInfoLabel}>Accuracy</Text>
                      <Text style={styles.sheetInfoValue}>±{Math.round(selectedMarker.accuracy)} m</Text>
                    </View>
                  ) : null}
                  {selectedMarker.battery != null ? (
                    <View style={styles.sheetInfoRow}>
                      <Text style={styles.sheetInfoLabel}>Battery</Text>
                      <Text style={styles.sheetInfoValue}>{Math.round(selectedMarker.battery * 100)}%</Text>
                    </View>
                  ) : null}
                  {selectedMarker.type === "paramedic" && (selectedMarker.destination || selectedMarker.route) ? (
                    <>
                      {selectedMarker.destination?.label ? (
                        <View style={styles.sheetInfoRow}>
                          <Text style={styles.sheetInfoLabel}>Heading to</Text>
                          <Text style={styles.sheetInfoValue} numberOfLines={1}>{selectedMarker.destination.label}</Text>
                        </View>
                      ) : null}
                      <Pressable
                        style={styles.clearDestBtn}
                        onPress={() => {
                          const medicId = selectedMarker.id;
                          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                          // Optimistic: drop the destination/route locally; the
                          // server broadcast confirms it for everyone else.
                          const existing = useMapStore.getState().markers;
                          setMarkers(
                            existing.map((m) =>
                              m.id === medicId ? { ...m, destination: null, route: null, status: "available" } : m,
                            ),
                          );
                          void assignDestination(null, medicId).catch((err) =>
                            debugLog("api", "error", "clear destination failed", String(err)),
                          );
                        }}
                      >
                        <Feather name="x-circle" size={15} color="#fca5a5" />
                        <Text style={styles.clearDestBtnText}>Clear destination</Text>
                      </Pressable>
                    </>
                  ) : null}
                </>
              )}

            </BottomSheetScrollView>
          </>
        ) : null}
        </View>
      </BottomSheet>

      {/* Hidden while assigned to an incident — the assigned banner takes over
          that slot (status can't be changed while responding anyway). */}
      {activeTab === "map" && !selectedMarker && navPhase === "idle" && !assignedToIncident ? <MedicStatusControl /> : null}
      {!selectedMarker && navPhase === "idle" ? <IncidentFAB /> : null}
      <ReportIncidentSheet />

      {/* Navigation feature: radial menu + transport/variants/editing/active overlays. */}
      <NavRadialMenu
        anchor={radialAnchor}
        onNavigate={() => {
          if (!radialAnchor) return;
          useNavStore.getState().openTransport({
            lat: radialAnchor.lat,
            lng: radialAnchor.lng,
            label: "Dropped pin",
          });
          setRadialAnchor(null);
        }}
        onMarkIncident={() => {
          const at = radialAnchor ? { lat: radialAnchor.lat, lng: radialAnchor.lng } : undefined;
          setRadialAnchor(null);
          void startIncidentReport(at);
        }}
        onAddPoint={() => {
          if (radialAnchor) setPendingPoi({ lat: radialAnchor.lat, lng: radialAnchor.lng });
          setRadialAnchor(null);
        }}
        onCancel={() => setRadialAnchor(null)}
      />
      {activeTab === "map" && !selectedMarker ? <AssignedIncidentBanner /> : null}
      <TransportSheet />
      <RouteVariantsOverlay />
      <RouteEditHelperBanner />
      <RouteEditingSheet />
      <ActiveNavOverlay />

      <NewPoiSheet
        pending={pendingPoi}
        onClose={() => setPendingPoi(null)}
        onCreated={(poi: PoiDto) => {
          const existing = useMapStore.getState().markers;
          setMarkers([...existing.filter((m) => m.id !== poi.id), poiToMarker(poi)]);
          setPendingPoi(null);
        }}
      />

      <Modal
        visible={!!photoViewerUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoViewerUrl(null)}
        statusBarTranslucent
      >
        <Pressable style={styles.photoViewerBackdrop} onPress={() => setPhotoViewerUrl(null)}>
          {photoViewerUrl ? (
            <Image source={{ uri: photoViewerUrl }} style={styles.photoViewerImage} resizeMode="contain" />
          ) : null}
          <Pressable style={styles.photoViewerClose} onPress={() => setPhotoViewerUrl(null)}>
            <Feather name="x" size={26} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>

      {activeTab === "location" ? (
        <View style={styles.tabOverlay}>
          <LocationScreen />
        </View>
      ) : null}
      {activeTab === "debug" ? (
        <View style={styles.tabOverlay}>
          <DebugScreen />
        </View>
      ) : null}
      {activeTab === "settings" ? (
        <View style={styles.tabOverlay}>
          <SettingsScreen onClose={() => setActiveTab("map")} />
        </View>
      ) : null}
      {activeTab === "guide" ? (
        <View style={styles.tabOverlay}>
          <FieldGuideScreen onClose={() => setActiveTab("map")} />
        </View>
      ) : null}

      <PendingIncidentsSheet visible={pendingSheetOpen} onClose={() => setPendingSheetOpen(false)} />

      {/* Bottom navigation bar — hidden during active navigation, and while a
          marker detail sheet is open (the sheet covers it and Tracks isn't a
          useful destination from there). */}
      {navPhase !== "active" && !selectedMarker ? (
        <View style={styles.bottomMenu}>
          {([
            { tab: "map", label: "Map", icon: "map" },
            { tab: "tracks", label: "Tracks", icon: "git-merge" },
          ] as const).map(({ tab, label, icon }) => {
            const active = activeTab === tab;
            return (
              <Pressable key={tab} style={styles.bottomMenuItem} onPress={() => setActiveTab(tab)}>
                <View style={[styles.bottomMenuAccent, active && styles.bottomMenuAccentActive]} />
                <Feather name={icon} size={20} color={active ? "#34d399" : "#5b6b80"} />
                <Text style={[styles.bottomMenuText, active && styles.bottomMenuTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020b18" },
  map: { flex: 1 },
  offlineButtonWrap: {
    position: "absolute",
    left: 12,
    bottom: BOTTOM_BAR_HEIGHT + 14,
    zIndex: 25,
  },
  tabOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: BOTTOM_BAR_HEIGHT,
    zIndex: 40,
    backgroundColor: "#020b18",
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    backgroundColor: "rgba(0, 0, 0, 0.12)",
  },
  missionStrip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 40,
    zIndex: 20,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  missionStripText: {
    color: "#5fdf7a",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  topHeader: {
    position: "absolute",
    top: 15,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    zIndex: 21,
    gap: 8,
  },
  menuButton: {
    minWidth: 66,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  menuButtonText: {
    color: "#eff6ff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  eventChip: {
    flex: 1,
    minHeight: 42,
    borderRadius: 13,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: "center",
  },
  eventHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eventTitle: {
    color: "#f2f8ff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  eventCaret: {
    color: "#acc0d9",
    fontSize: 11,
    fontWeight: "700",
  },
  eventMetaRow: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  livePill: {
    color: "#0f2b13",
    backgroundColor: "#69dd7b",
    fontSize: 10,
    fontWeight: "900",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  eventMetaText: {
    color: "#c2d0e2",
    fontSize: 11,
    fontWeight: "600",
  },
  headerActions: {
    gap: 9,
  },
  clearDestBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  clearDestBtnText: { color: "#fca5a5", fontSize: 13, fontWeight: "800" },
  headerActionButtonActive: {
    borderColor: "rgba(52, 211, 153, 0.55)",
    backgroundColor: "rgba(6, 24, 20, 0.95)",
  },
  healthBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f59e0b",
    borderWidth: 1.5,
    borderColor: "#0a1322",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  healthBadgeText: { color: "#1a1206", fontSize: 11, fontWeight: "900", lineHeight: 13 },
  headerActionButton: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActionText: {
    color: "#ecf4ff",
    fontSize: 12,
    fontWeight: "900",
  },
  layersIcon: {
    width: 16,
    height: 13,
    justifyContent: "space-between",
  },
  layersIconLine: {
    height: 2,
    borderRadius: 2,
    backgroundColor: "#ecf4ff",
  },
  layersIconLineMiddle: {
    width: 12,
    alignSelf: "center",
  },
  locationIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  locationIconRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.6,
    borderColor: "#ecf4ff",
  },
  locationIconCenterDot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ecf4ff",
  },
  menuPopup: {
    position: "absolute",
    top: 94,
    left: 12,
    width: 288,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.28)",
    backgroundColor: "rgba(8, 15, 28, 0.96)",
    zIndex: 44,
    padding: 12,
    gap: 10,
  },
  layersPopup: {
    position: "absolute",
    top: 84,
    right: 12,
    width: 266,
    maxHeight: SCREEN_HEIGHT * 0.66,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.28)",
    backgroundColor: "rgba(8, 15, 28, 0.97)",
    zIndex: 44,
  },
  layersPopupContent: { padding: 12, gap: 9 },
  layerSectionLabel: {
    color: "#4A5F7A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 4,
    marginBottom: 1,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 5,
    backgroundColor: "rgba(13, 24, 42, 0.7)",
    borderRadius: 11,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 8,
  },
  segmentItemActive: { backgroundColor: "#34d399" },
  segmentText: { color: "#9fb3cc", fontSize: 11.5, fontWeight: "800" },
  segmentTextActive: { color: "#04121f" },
  miniSegmentRow: {
    flexDirection: "row",
    gap: 3,
    backgroundColor: "rgba(13, 24, 42, 0.7)",
    borderRadius: 8,
    padding: 3,
  },
  miniSegmentItem: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 6 },
  miniSegmentText: { color: "#9fb3cc", fontSize: 10.5, fontWeight: "800" },
  menuPopupTitle: {
    color: "#f1f7ff",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 2,
  },
  menuPageRow: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.16)",
    backgroundColor: "rgba(13, 24, 42, 0.68)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  menuPageIcon: {
    marginRight: 2,
  },
  menuPageTextWrap: {
    flex: 1,
  },
  menuPageTitle: {
    color: "#ecf4ff",
    fontSize: 12,
    fontWeight: "700",
  },
  menuPageSubtitle: {
    marginTop: 2,
    color: "#a5bad3",
    fontSize: 10,
    fontWeight: "500",
  },
  menuSoonLabel: {
    color: "#90a6c0",
    fontSize: 10,
    fontWeight: "700",
  },
  menuLeaveRow: {
    borderTopWidth: 1,
    borderTopColor: "rgba(177, 199, 224, 0.12)",
    marginTop: 4,
    paddingTop: 4,
  },
  menuLeaveText: {
    color: "#f87171",
  },
  menuLeaveArrow: {
    color: "#f87171",
    fontSize: 16,
    fontWeight: "700",
  },
  offlineBadgeHit: {
    position: "absolute",
    top: 90,
    left: 12,
    zIndex: 50,
  },
  offlineBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  offlineBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  layerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 30,
  },
  layerLabel: {
    color: "#d8e3f1",
    fontSize: 12,
    fontWeight: "600",
  },
  heatTunerPanel: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 70,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.28)",
    backgroundColor: "rgba(8, 15, 28, 0.9)",
    zIndex: 26,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  heatTunerTitle: {
    color: "#e6effb",
    fontSize: 12,
    fontWeight: "700",
  },
  heatTunerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  heatTunerButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.34)",
    backgroundColor: "rgba(15, 28, 45, 0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  heatTunerButtonText: {
    color: "#ebf3fe",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 16,
  },
  heatSliderTrack: {
    width: HEATMAP_SLIDER_WIDTH,
    height: 12,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.34)",
    overflow: "hidden",
    justifyContent: "center",
  },
  heatSliderFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(103, 169, 207, 0.9)",
  },
  heatSliderKnob: {
    position: "absolute",
    top: -1,
    width: 14,
    height: 14,
    borderRadius: 999,
    backgroundColor: "#f3f8ff",
    borderWidth: 1,
    borderColor: "rgba(10, 20, 35, 0.7)",
  },
  tracksHeaderRow: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(177, 199, 224, 0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tracksHeaderText: {
    color: "#f1f7ff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  tracksToggleAllButton: {
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.3)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(18, 31, 49, 0.7)",
  },
  tracksToggleAllText: {
    color: "#c9d8e9",
    fontSize: 10,
    fontWeight: "700",
  },
  trackLayerRow: {
    marginLeft: 14,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trackLayerLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trackColorDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  switchTrack: {
    width: 42,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.35)",
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  switchTrackOn: {
    backgroundColor: "rgba(104, 214, 121, 0.85)",
  },
  switchKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f1f5f9",
  },
  switchKnobOn: {
    alignSelf: "flex-end",
  },
  incidentDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#ef4444",
    borderWidth: 1.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  incidentDotText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 14,
    textAlign: "center",
  },
  // Selected marker: bright halo ring so the active selection is unmistakable.
  selectedHalo: {
    padding: 5,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.95)",
    backgroundColor: "rgba(255,255,255,0.18)",
    shadowColor: "#fff",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 10,
  },
  incidentDotSelected: {
    borderWidth: 2.5,
    transform: [{ scale: 1.12 }],
  },
  incidentDotClosed: {
    backgroundColor: "#64748b",
    borderColor: "rgba(255,255,255,0.5)",
  },
  incidentDotTextClosed: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
  },
  medicMarkerWrap: { alignItems: "center", justifyContent: "center" },
  medicLight: {
    position: "absolute",
    top: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    zIndex: 3,
  },
  medicLightLeft: { left: -2 },
  medicLightRight: { right: -2 },
  medicLightOn: {
    backgroundColor: "#3b82f6",
    shadowColor: "#3b82f6",
    shadowOpacity: 0.95,
    shadowRadius: 6,
    elevation: 8,
  },
  medicLightOff: { backgroundColor: "rgba(59,130,246,0.28)" },
  medicCornerBadge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#04121f",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  medicStationaryBadge: { backgroundColor: "#34d399" },
  medicMovingBadge: { backgroundColor: "#fbbf24" },
  paramedicDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#22c55e",
    borderWidth: 1.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  paramedicDotText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 13,
    textAlign: "center",
    includeFontPadding: false,
  },
  paramedicDotStale: {
    backgroundColor: "#475569",
    borderColor: "rgba(255,255,255,0.4)",
    opacity: 0.65,
  },
  paramedicDotTextStale: {
    color: "rgba(255,255,255,0.7)",
  },
  poiDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ef4444",
    borderWidth: 1.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  poiDotText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 16,
  },
  runnerDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: "#3b82f6",
    borderWidth: 1,
    borderColor: "#ffffff",
  },
  responseArrow: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(34,197,94,0.95)",
    borderWidth: 1,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  destFlag: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(245,158,11,0.95)",
    borderWidth: 1.5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  destFlagText: { fontSize: 13 },
  responseArrowText: {
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 11,
  },
  selectionCard: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 72,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.28)",
    backgroundColor: "rgba(6, 16, 34, 0.95)",
    padding: 14,
    zIndex: 22,
  },
  selectionClose: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 31, 49, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(190, 206, 224, 0.35)",
  },
  selectionCloseText: {
    color: "#dce8f6",
    fontSize: 12,
    fontWeight: "900",
  },
  selectionKicker: {
    color: "#6fe684",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  selectionTitle: {
    color: "#f4f8ff",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 3,
  },
  selectionMeta: {
    marginTop: 4,
    color: "#a9bdd4",
    fontSize: 13,
    fontWeight: "600",
  },
  incidentSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 60,
    height: SHEET_HEIGHT,
    backgroundColor: "rgba(4, 11, 24, 0.985)",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(180, 201, 223, 0.28)",
    zIndex: 30,
  },
  markerSheetBg: {
    backgroundColor: "rgba(4, 11, 24, 0.985)",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(180, 201, 223, 0.28)",
  },
  markerSheetContent: {
    flex: 1,
  },
  sheetDragZone: {
    width: "100%",
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetHandle: {
    width: 52,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(150, 171, 196, 0.62)",
  },
  sheetHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 4,
    alignItems: "center",
  },
  incidentIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ef4444",
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  sheetParamedicIconBg: {
    backgroundColor: "#22c55e",
    shadowColor: "#22c55e",
  },
  sheetParticipantIconBg: {
    backgroundColor: "#3b82f6",
    shadowColor: "#3b82f6",
  },
  incidentIconText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 24,
  },
  sheetCompactIconText: {
    fontSize: 14,
    lineHeight: 16,
  },
  sheetHeaderTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  sheetTitle: {
    color: "#f4f8ff",
    fontSize: 29,
    fontWeight: "800",
  },
  sheetMetaText: {
    color: "#a8bbd2",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 1,
  },
  sheetCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(24, 38, 58, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(192, 210, 228, 0.36)",
  },
  sheetCloseButtonText: {
    color: "#e2edf8",
    fontSize: 13,
    fontWeight: "900",
  },
  sheetTabs: {
    marginTop: 12,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(177, 199, 224, 0.18)",
  },
  sheetTabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
  },
  sheetTabText: {
    color: "#8da5c0",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  sheetTabTextActive: {
    color: "#f1f7ff",
  },
  sheetTabUnderline: {
    marginTop: 8,
    width: "72%",
    height: 2,
    borderRadius: 2,
    backgroundColor: "#f25656",
  },
  poiArchiveBtn: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  poiArchiveBtnText: { color: "#94a3b8", fontSize: 13, fontWeight: "800" },
  incidentPhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    padding: 10,
  },
  incidentPhotoThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: "#1e293b" },
  incidentPhotoMeta: { flex: 1 },
  incidentPhotoTitle: { color: "#e2e8f0", fontSize: 13.5, fontWeight: "800" },
  incidentPhotoHint: { color: "#64748b", fontSize: 12, fontWeight: "600", marginTop: 2 },
  photoViewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoViewerImage: { width: "100%", height: "82%" },
  photoViewerClose: {
    position: "absolute",
    top: 54,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBody: {
    flex: 1,
  },
  sheetBodyContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    // Keep the last actions clear of the bottom navigation bar when the
    // drawer content is taller than the sheet.
    paddingBottom: BOTTOM_BAR_HEIGHT + 24,
    gap: 12,
  },
  sheetInfoRow: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(177, 199, 224, 0.16)",
    paddingBottom: 10,
  },
  incidentChipsRow: { flexDirection: "row", gap: 7 },
  incidentChip: {
    flex: 1,
    backgroundColor: "rgba(15, 29, 48, 0.74)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.14)",
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  incidentChipLabel: { color: "#6b829c", fontSize: 8.5, fontWeight: "900", letterSpacing: 0.6 },
  incidentChipValue: { color: "#e4edf8", fontSize: 12.5, fontWeight: "800", marginTop: 2 },
  sheetInfoLabel: {
    color: "#96adc7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  sheetInfoValue: {
    color: "#e4edf8",
    fontSize: 14,
    lineHeight: 20,
  },
  responderRow: {
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.2)",
    backgroundColor: "rgba(15, 29, 48, 0.74)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  responderName: {
    color: "#f1f7ff",
    fontSize: 14,
    fontWeight: "800",
  },
  responderMeta: {
    color: "#9ab0c8",
    fontSize: 12,
    marginTop: 2,
  },
  messageButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f35c5c",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  messageButtonText: {
    color: "#f9b0b0",
    fontSize: 12,
    fontWeight: "700",
  },
  trackCursorOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 158, 11, 0.45)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.96)",
  },
  trackCursorInner: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(245, 158, 11, 0.98)",
  },
  tracksDrawer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 72, // clear the bottom tab bar that overlays the sheet
    gap: 10,
  },
  profileMyLocationLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: "rgba(56, 189, 248, 0.85)",
  },
  profileMyLocationDot: {
    position: "absolute",
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    borderRadius: 7,
    backgroundColor: "#38bdf8",
    borderWidth: 2.5,
    borderColor: "#021018",
  },
  trackExpandedSection: {
    marginTop: 14,
    gap: 10,
  },
  trackExpandedKicker: {
    color: "#5f7da0",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  trackMetricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  trackMetricCard: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: "30%",
    backgroundColor: "#0b1729",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.12)",
  },
  trackMetricLabel: {
    color: "#7c8a9c",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  trackMetricValue: {
    color: "#eaf2fb",
    fontSize: 16,
    fontWeight: "800",
  },
  tracksDrawerHandle: {
    alignSelf: "center",
    width: 56,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(165, 186, 214, 0.7)",
    marginBottom: 2,
  },
  tracksDrawerHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tracksDrawerKicker: {
    color: "#c7d7ea",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  tracksDrawerMeta: {
    color: "#95a9c3",
    fontSize: 11,
    fontWeight: "700",
  },
  trackSelectButton: {
    borderWidth: 1,
    borderColor: "rgba(168, 191, 218, 0.28)",
    borderRadius: 12,
    backgroundColor: "rgba(13, 26, 44, 0.9)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  trackSelectLabel: {
    color: "#9cb2cd",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  trackSelectValueWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trackSelectValue: {
    color: "#eef5ff",
    fontSize: 14,
    fontWeight: "800",
    flexShrink: 1,
  },
  trackSelectCaret: {
    color: "#b3c7de",
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 10,
  },
  trackPickerScroll: {
    maxHeight: 44,
  },
  trackPickerContent: {
    gap: 8,
    paddingRight: 4,
  },
  trackPickerChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(158, 184, 212, 0.3)",
    backgroundColor: "rgba(15, 29, 48, 0.78)",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  trackPickerChipActive: {
    borderColor: "rgba(247, 194, 94, 0.85)",
    backgroundColor: "rgba(59, 43, 16, 0.82)",
  },
  trackPickerChipText: {
    color: "#d5e2f3",
    fontSize: 12,
    fontWeight: "700",
  },
  trackPickerChipTextActive: {
    color: "#ffefc9",
  },
  profileCard: {
    borderWidth: 1,
    borderColor: "rgba(173, 196, 221, 0.24)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(10, 22, 39, 0.9)",
    gap: 10,
  },
  profileReadoutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileMetricLabel: {
    color: "#91a7c2",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  profileMetricValue: {
    color: "#f2f7ff",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  profileMetricSpacer: {
    width: 8,
  },
  profileGradientChart: {
    position: "relative",
    height: 108,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(167, 190, 216, 0.22)",
    backgroundColor: "rgba(15, 31, 53, 0.78)",
    overflow: "hidden",
  },
  profileGradientScrubSurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  profileGradientChartZeroLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: 1,
    backgroundColor: "rgba(181, 200, 222, 0.45)",
  },
  profileGradientChartSegmentHorizontal: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    marginTop: -1,
  },
  profileGradientChartSegmentVertical: {
    position: "absolute",
    width: 2,
    borderRadius: 1,
    marginLeft: -1,
  },
  profileGradientChartCursorLine: {
    position: "absolute",
    top: 4,
    bottom: 4,
    width: 2,
    backgroundColor: "rgba(255, 235, 189, 0.95)",
    marginLeft: -1,
  },
  profileGradientChartCursorDot: {
    position: "absolute",
    width: 9,
    height: 9,
    borderRadius: 999,
    marginLeft: -4.5,
    marginTop: -4.5,
    backgroundColor: "#f8d889",
    borderWidth: 1,
    borderColor: "#fff6de",
    zIndex: 25,
  },
  profileEmpty: {
    borderWidth: 1,
    borderColor: "rgba(167, 190, 216, 0.2)",
    borderRadius: 12,
    backgroundColor: "rgba(12, 25, 43, 0.66)",
    minHeight: 78,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  profileEmptyText: {
    color: "#9bb1cc",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  sheetActions: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(177, 199, 224, 0.15)",
  },
  sheetSecondaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.32)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 23, 40, 0.82)",
  },
  sheetSecondaryActionText: {
    color: "#d8e5f5",
    fontSize: 12,
    fontWeight: "700",
  },
  sheetPrimaryAction: {
    flex: 1.2,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#de4747",
  },
  sheetPrimaryActionText: {
    color: "#fff2f2",
    fontSize: 13,
    fontWeight: "900",
  },
  bottomMenu: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
    flexDirection: "row",
    backgroundColor: "rgba(7, 15, 29, 0.98)",
    borderTopWidth: 1,
    borderTopColor: "rgba(177, 199, 224, 0.2)",
    zIndex: 40,
  },
  bottomMenuItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  bottomMenuAccent: {
    position: "absolute",
    top: 0,
    width: 26,
    height: 3,
    borderRadius: 999,
    backgroundColor: "transparent",
  },
  bottomMenuAccentActive: { backgroundColor: "#34d399" },
  bottomMenuText: {
    color: "#5b6b80",
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  bottomMenuTextActive: {
    color: "#34d399",
  },
});
