/**
 * Builds the two payloads the native car app consumes, straight from the live
 * stores. Pure read-side code: nothing here mutates app state.
 */
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useMapStore, type MapMarker } from "../map/map-store";
import { useSessionStore } from "../security/session-store";
import { useSettingsStore, effectiveLocationIntervalMs } from "../settings/settings-store";
import { useNavStore } from "../navigation/nav-store";
import { useTrackNavStore } from "../tracknav/track-nav-store";
import { useZonesStore } from "../map/zones/zones-store";
import { useZoneVisibilityStore } from "../map/zones/zone-visibility-store";
import { useLocationStatus } from "../debug/location-status";
import { useBatteryDiagnostics, drainPercentPerHour } from "../debug/battery-diagnostics";
import { useBuildInfo, APP_VERSION, NATIVE_BUILD } from "../debug/build-info";
import { incidentQueue } from "../incidents/persistent-incident-queue";
import { incidentTitle } from "../incidents/IncidentSheet";
import { getMapyTilesTemplateUrl } from "../map/mapy-config";
import { isOnline } from "../offline/connectivity";
import { isSocketConnected } from "../realtime/socket-client";
import { distanceMeters } from "../navigation/geo";
import { maneuverLabel } from "../navigation/surface";
import type { LngLat } from "../navigation/types";
import {
  CAR_PROTOCOL_VERSION,
  type CarDynamic,
  type CarMarker,
  type CarNav,
  type CarPolygon,
  type CarPolyline,
  type CarStatic,
  type FlatCoords,
} from "./car-types";

/** Below this many metres of deviation a vertex adds nothing on a car screen. */
const TRACK_SIMPLIFY_TOLERANCE_M = 8;
/** Hard ceiling per line, so one pathological GPX cannot stall the renderer. */
const MAX_LINE_POINTS = 3000;

/** Perpendicular distance from `p` to segment `a`–`b`, in flat degrees scaled
 *  to metres. Good enough at the scale a simplification tolerance cares about. */
function segmentDistanceMeters(p: LngLat, a: LngLat, b: LngLat): number {
  const latScale = Math.cos((a[1] * Math.PI) / 180);
  const px = (p[0] - a[0]) * latScale;
  const py = p[1] - a[1];
  const bx = (b[0] - a[0]) * latScale;
  const by = b[1] - a[1];
  const lenSq = bx * bx + by * by;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / lenSq)) : 0;
  const dx = px - bx * t;
  const dy = py - by * t;
  return Math.sqrt(dx * dx + dy * dy) * 111_320;
}

/**
 * Ramer–Douglas–Peucker, iterative so a 40k-point GPX cannot blow the JS stack.
 * Runs once per track change, never on the 2 Hz path.
 */
export function simplifyLine(points: LngLat[], toleranceMeters = TRACK_SIMPLIFY_TOLERANCE_M): LngLat[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = 0;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = segmentDistanceMeters(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worstIndex !== -1 && worst > toleranceMeters) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  const out: LngLat[] = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
  return out;
}

/** Uniformly thin a line to at most `max` points, endpoints preserved. */
function cap(points: LngLat[], max = MAX_LINE_POINTS): LngLat[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: LngLat[] = [];
  for (let i = 0; i < max - 1; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

function flatten(points: LngLat[]): FlatCoords {
  const out: FlatCoords = new Array(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    out[i * 2] = round6(points[i][0]);
    out[i * 2 + 1] = round6(points[i][1]);
  }
  return out;
}

/** ~11 cm of precision — anything finer is pure JSON weight. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function prepareLine(points: LngLat[]): FlatCoords {
  return flatten(cap(simplifyLine(points)));
}

// ---------------------------------------------------------------- static ----

export function buildStatic(): CarStatic {
  const tracks = useMapStore.getState().tracks;
  const zones = useZonesStore.getState().zones;
  const isVisible = useZoneVisibilityStore.getState().isVisible;
  const build = useBuildInfo.getState();

  const carTracks: CarPolyline[] = tracks.map((track) => ({
    id: track.id,
    label: track.label,
    color: track.color,
    points: prepareLine(track.points.map((p): LngLat => [p.lng, p.lat])),
  }));

  const carZones: CarPolygon[] = zones
    .filter((zone) => {
      try {
        return isVisible(zone);
      } catch {
        return false;
      }
    })
    .map((zone) => ({
      id: zone.id,
      label: zone.name,
      color: zone.color,
      points: flatten(cap(zone.polygon as LngLat[], 500)),
    }));

  return {
    v: CAR_PROTOCOL_VERSION,
    tileUrlTemplate: getMapyTilesTemplateUrl(),
    tracks: carTracks,
    zones: carZones,
    build: {
      appVersion: APP_VERSION,
      nativeBuild: NATIVE_BUILD,
      runtimeVersion: String(Constants.expoConfig?.runtimeVersion ?? "—"),
      updateId: Updates.updateId ?? null,
      channel: Updates.channel ?? null,
      updateAppliedAt: build.updateAppliedAt ?? null,
      firstLaunchAt: build.firstLaunchAt ?? null,
    },
  };
}

// --------------------------------------------------------------- dynamic ----

function isClosedIncident(status?: string): boolean {
  return status === "resolved" || status === "closed" || status === "archived";
}

function markerLabel(marker: MapMarker): string {
  if (marker.type === "incident") return incidentTitle(marker);
  return marker.name ?? marker.label ?? "—";
}

function buildNav(): CarNav {
  const nav = useNavStore.getState();
  const track = useTrackNavStore.getState();

  // Point-to-point wins when both somehow exist: the two stores cancel each
  // other on start, so this is only a tie-break for the instant in between.
  if (nav.phase === "active") {
    const route = nav.routes.find((r) => r.id === nav.selectedRouteId);
    const progress = nav.progress;
    const instruction = route?.instructions[progress?.instructionIndex ?? 0];
    const geometry = route?.geometry ?? [];
    const travelledIndex = travelledSplit(geometry, progress?.alongMeters ?? 0);
    return {
      mode: "point",
      active: true,
      destinationLabel: nav.destination?.label ?? null,
      routePoints: flatten(cap(geometry.slice(travelledIndex))),
      travelledPoints: flatten(cap(geometry.slice(0, Math.max(1, travelledIndex + 1)))),
      remainingMeters: progress?.remainingMeters ?? route?.distanceMeters ?? null,
      remainingMs: progress?.remainingMs ?? route?.durationMs ?? null,
      toManeuverMeters: progress?.toManeuverMeters ?? null,
      maneuver: instruction?.maneuver ?? null,
      cue: instruction ? maneuverLabel(instruction.maneuver, instruction.exitNumber) : null,
      road: instruction?.streetName ?? null,
      offRoute: progress?.offRoute ?? false,
      bearing: progress?.bearing ?? null,
      speedMps: progress?.speedMps ?? null,
      voiceMuted: nav.voiceMuted,
    };
  }

  if (track.phase === "active" || track.phase === "paused") {
    const progress = track.progress;
    const prepared = track.prepared;
    const instruction = prepared?.instructions[progress?.instructionIndex ?? 0];
    const geometry = prepared?.geometry ?? [];
    const travelledIndex = travelledSplit(geometry, progress?.alongMeters ?? 0);
    return {
      mode: "track",
      active: track.phase === "active",
      destinationLabel: track.track?.label ?? null,
      routePoints: flatten(cap(geometry.slice(travelledIndex))),
      travelledPoints: flatten(cap(geometry.slice(0, Math.max(1, travelledIndex + 1)))),
      remainingMeters: progress?.remainingMeters ?? null,
      // Track-following has no engine ETA — the car shows distance only.
      remainingMs: null,
      toManeuverMeters: progress?.toManeuverMeters ?? null,
      maneuver: instruction?.maneuver ?? null,
      cue: instruction ? maneuverLabel(instruction.maneuver) : null,
      road: null,
      offRoute: progress?.offTrack ?? false,
      bearing: progress?.bearing ?? null,
      speedMps: progress?.speedMps ?? null,
      voiceMuted: track.muted,
    };
  }

  return {
    mode: "none",
    active: false,
    destinationLabel: null,
    routePoints: [],
    travelledPoints: [],
    remainingMeters: null,
    remainingMs: null,
    toManeuverMeters: null,
    maneuver: null,
    cue: null,
    road: null,
    offRoute: false,
    bearing: null,
    speedMps: null,
    voiceMuted: useNavStore.getState().voiceMuted,
  };
}

/** Index of the vertex the medic has travelled up to, for the dimmed trail. */
function travelledSplit(geometry: LngLat[], alongMeters: number): number {
  if (geometry.length < 2 || alongMeters <= 0) return 0;
  let acc = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    acc += distanceMeters(
      { lat: geometry[i - 1][1], lng: geometry[i - 1][0] },
      { lat: geometry[i][1], lng: geometry[i][0] },
    );
    if (acc >= alongMeters) return i - 1;
  }
  return geometry.length - 1;
}

export function buildDynamic(recording: boolean, toast: string | null): CarDynamic {
  const session = useSessionStore.getState();
  const settings = useSettingsStore.getState();
  const markers = useMapStore.getState().markers;
  const fix = useLocationStatus.getState().lastFix;
  const report = useLocationStatus.getState().lastReport;
  const battery = useBatteryDiagnostics.getState();
  const nav = buildNav();
  const now = Date.now();

  const isMedic = session.role === "medic" || session.role === "paramedic";
  const mine = markers.find((m) => m.id === session.userId && m.type === "paramedic");
  const here = fix ? { lat: fix.lat, lng: fix.lng } : null;

  const assigned = markers.find(
    (m) =>
      m.type === "incident" &&
      !isClosedIncident(m.status) &&
      (m.respondingParamedicIds ?? []).includes(session.userId ?? "__none__"),
  );

  const carMarkers: CarMarker[] = markers
    .filter((m) => (settings.showArchived ? true : !m.poiArchived))
    .map((marker) => ({
      id: marker.id,
      type: marker.type,
      label: markerLabel(marker),
      lat: round6(marker.lat),
      lng: round6(marker.lng),
      status: marker.status,
      vehicleType: marker.vehicleType,
      poiType: marker.poiType,
      incidentType: marker.incidentType,
      incidentStatus: marker.type === "incident" ? marker.status : undefined,
      staleState: marker.staleState,
      assignedToMe: marker.id === assigned?.id,
      isMe: marker.id === session.userId && marker.type === "paramedic",
      distanceMeters: here
        ? Math.round(distanceMeters(here, { lat: marker.lat, lng: marker.lng }))
        : undefined,
    }));

  const medicRoutes: CarPolyline[] = markers
    .filter((m) => m.type === "paramedic" && m.id !== session.userId && m.route?.geometry?.length)
    .map((m) => ({
      id: m.id,
      label: m.name ?? m.label,
      color: m.respondingIncidentId ? "#f87171" : "#38bdf8",
      points: flatten(cap(m.route!.geometry as LngLat[], 800)),
    }));

  return {
    v: CAR_PROTOCOL_VERSION,
    signedIn: Boolean(session.token && session.eventId),
    hydrated: session.hydrated,
    eventTitle: session.eventTitle,
    userId: session.userId,
    role: session.role,
    isMedic,
    me: fix
      ? { lat: round6(fix.lat), lng: round6(fix.lng), accuracyMeters: fix.accuracy ?? null, at: fix.at }
      : null,
    myStatus: (mine?.status as string | undefined) ?? "available",
    markers: carMarkers,
    medicRoutes,
    assignedIncidentId: assigned?.id ?? null,
    nav,
    settings: {
      locationIntervalMs: settings.locationIntervalMs,
      trackOffsetEnabled: settings.trackOffsetEnabled,
      trackGradientEnabled: settings.trackGradientEnabled,
      kmMarkersEnabled: settings.kmMarkersEnabled,
      kmMarkerIntervalKm: settings.kmMarkerIntervalKm,
      showArchived: settings.showArchived,
      androidAutoEnabled: settings.androidAutoEnabled,
      voiceMuted: nav.voiceMuted,
    },
    diagnostics: {
      fixAgeMs: fix ? now - fix.at : null,
      accuracyMeters: fix?.accuracy ?? null,
      batteryPercent: fix?.battery ?? null,
      lastReportOk: report?.ok ?? null,
      lastReportVia: report?.via ?? null,
      lastReportAgeMs: report ? now - report.at : null,
      socketConnected: isSocketConnected(),
      online: isOnline(),
      queuedLocations: battery.locationQueueSize,
      queuedIncidents: incidentQueue.count,
      effectiveIntervalMs: effectiveLocationIntervalMs(),
      // Filled by the bridge (async probes) rather than recomputed at 2 Hz.
      trackingIssues: [],
      batteryOptimizationIgnored: null,
      drainPercentPerHour: drainPercentPerHour(battery.batterySamples),
    },
    recording,
    toast,
  };
}
