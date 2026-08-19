/**
 * Minimal team-data feed for the case where Android Auto is connected but the
 * phone app has no UI — the app was swiped away and the car service started the
 * JS runtime headlessly.
 *
 * MapScreen owns the real feed (and a lot more besides: incident alarms,
 * unread tracking, participant dots, elevation enrichment). None of that is
 * duplicated here, deliberately:
 *
 *  - Alarms are NOT raised. When the app is killed, incident alerts already
 *    arrive as remote pushes; ringing again from here would double-alarm.
 *  - Runner dots are NOT loaded. Thousands of pins nobody can read at 90 km/h.
 *
 * Exactly one of the two feeds is ever attached. MapScreen takes precedence and
 * announces itself through {@link setMapFeedOwnedByScreen}; this feed detaches
 * while that is true and re-attaches when the screen goes away.
 */
import type { Socket } from "socket.io-client";
import type { EventZone } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { getSocket } from "../realtime/socket-client";
import { useSessionStore } from "../security/session-store";
import { useSettingsStore } from "../settings/settings-store";
import { useMapStore, type MapMarker } from "../map/map-store";
import { useZonesStore } from "../map/zones/zones-store";
import { hydrateMapCacheIfEmpty } from "../map/map-cache";
import {
  activeMedicToMarker,
  incidentToMarker,
  poiToMarker,
  type IncidentResponse,
  type MedicActiveResponse,
  type PoiResponse,
} from "../map/marker-mappers";
import { debugLog } from "../debug/debug-log";

/** Re-pull the roster this often while the car is the only consumer. */
const REFRESH_INTERVAL_MS = 120_000;

let wanted = false;
let ownedByScreen = false;
let attached = false;
let socket: Socket | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
/** Watches for the session arriving after we first wanted to attach. */
let sessionUnsubscribe: (() => void) | null = null;
let lastSeenToken: string | null = null;

function isArchived(status?: string): boolean {
  return status === "archived";
}

function upsertMarkers(next: MapMarker[], replaceIds: Set<string>): void {
  const existing = useMapStore.getState().markers;
  useMapStore
    .getState()
    .setMarkers([...existing.filter((m) => !replaceIds.has(m.id)), ...next].slice(-2200));
}

async function loadOnce(): Promise<void> {
  const eventId = useSessionStore.getState().eventId;
  if (!eventId) return;
  const includeArchived = useSettingsStore.getState().showArchived;

  // Each class is replaced ONLY if its own fetch succeeded. A failed request
  // must never wipe the class: with no coverage that would clear the cached
  // snapshot and leave the car showing an empty event — exactly when the medic
  // most needs the last known picture. (`null` = "we learned nothing".)
  const [medics, pois, incidents] = await Promise.all([
    apiFetch<MedicActiveResponse[]>(`/events/${eventId}/medics/active`).catch(() => null),
    apiFetch<PoiResponse[]>(includeArchived ? "/events/pois?includeArchived=1" : "/events/pois").catch(() => null),
    apiFetch<IncidentResponse[]>("/incidents").catch(() => null),
  ]);

  if (medics === null && pois === null && incidents === null) {
    debugLog("api", "warn", "car feed refresh failed — keeping the cached picture");
    return;
  }

  const replaced = new Set<MapMarker["type"]>();
  const fresh: MapMarker[] = [];

  if (medics !== null) {
    replaced.add("paramedic");
    fresh.push(...medics.map(activeMedicToMarker));
  }
  if (pois !== null) {
    replaced.add("infrastructure");
    fresh.push(...pois.map((poi, i) => poiToMarker({ ...poi, id: poi.id ?? `poi-${i}-${poi.lat}-${poi.lng}` })));
  }
  if (incidents !== null) {
    replaced.add("incident");
    fresh.push(
      ...incidents.filter((incident) => includeArchived || !isArchived(incident.status)).map(incidentToMarker),
    );
  }

  const freshIds = new Set(fresh.map((m) => m.id));
  const keep = useMapStore
    .getState()
    .markers.filter((m) => !freshIds.has(m.id) && !replaced.has(m.type));
  useMapStore.getState().setMarkers([...keep, ...fresh].slice(-2200));
  debugLog("app", "info", "car feed refreshed", {
    medics: medics?.length ?? "kept",
    pois: pois?.length ?? "kept",
    incidents: incidents?.length ?? "kept",
  });

  // Zones are medic-only server-side; a runner's 403 is swallowed by the store.
  await useZonesStore.getState().load();
}

function attach(): void {
  if (attached) return;
  const session = useSessionStore.getState();
  if (!session.token || !session.eventId) return;
  attached = true;
  debugLog("app", "info", "car feed attached (no map screen mounted)");

  socket = getSocket();

  socket.on("medic_location", onMedicLocation);
  socket.on("incident.created", onIncidentUpsert);
  socket.on("incident.updated", onIncidentUpsert);
  socket.on("incident.action", onIncidentAction);
  socket.on("poi.created", onPoiUpsert);
  socket.on("poi.updated", onPoiUpsert);
  socket.on("poi.removed", onPoiRemoved);
  socket.on("zone.created", onZoneUpsert);
  socket.on("zone.updated", onZoneUpsert);
  socket.on("zone.removed", onZoneRemoved);

  void hydrateMapCacheIfEmpty().then(() => loadOnce()).catch((err) =>
    debugLog("api", "warn", "car feed initial load failed", String(err)),
  );

  refreshTimer = setInterval(() => {
    void loadOnce().catch(() => undefined);
  }, REFRESH_INTERVAL_MS);
}

function detach(): void {
  if (!attached) return;
  attached = false;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  // Remove only OUR handlers by reference. MapScreen's cleanup uses the
  // event-wide `socket.off(event)`, which would take these with it — so the
  // handoff order matters and is why re-attaching is deferred a tick.
  socket?.off("medic_location", onMedicLocation);
  socket?.off("incident.created", onIncidentUpsert);
  socket?.off("incident.updated", onIncidentUpsert);
  socket?.off("incident.action", onIncidentAction);
  socket?.off("poi.created", onPoiUpsert);
  socket?.off("poi.updated", onPoiUpsert);
  socket?.off("poi.removed", onPoiRemoved);
  socket?.off("zone.created", onZoneUpsert);
  socket?.off("zone.updated", onZoneUpsert);
  socket?.off("zone.removed", onZoneRemoved);
  socket = null;
  debugLog("app", "info", "car feed detached");
}

type MedicLocationPayload = Parameters<typeof activeMedicToMarker>[0] & {
  medicId: string;
  lat: number;
  lng: number;
};

function onMedicLocation(payload: MedicLocationPayload): void {
  const previous = useMapStore.getState().markers.find((m) => m.id === payload.medicId);
  const marker = activeMedicToMarker({ ...payload, lastSeenAt: payload.lastSeenAt ?? new Date().toISOString() });
  upsertMarkers(
    [
      {
        ...marker,
        // A location ping carries no roster fields; keep whatever we know.
        name: marker.name ?? previous?.name,
        label: marker.name ?? previous?.label ?? payload.medicId,
        vehicleType: marker.vehicleType ?? previous?.vehicleType,
        staleState: "fresh",
      },
    ],
    new Set([payload.medicId]),
  );
}

function onIncidentUpsert(payload: IncidentResponse): void {
  const showArchived = useSettingsStore.getState().showArchived;
  if (isArchived(payload.status) && !showArchived) {
    const existing = useMapStore.getState().markers;
    useMapStore.getState().setMarkers(existing.filter((m) => m.id !== payload.id));
    return;
  }
  const previous = useMapStore.getState().markers.find((m) => m.id === payload.id);
  const merged = incidentToMarker(payload);
  if (!merged.respondingParamedicIds && previous?.respondingParamedicIds) {
    merged.respondingParamedicIds = previous.respondingParamedicIds;
  }
  upsertMarkers([merged], new Set([payload.id]));
}

function onIncidentAction(payload: { incidentId: string; status?: string }): void {
  const existing = useMapStore.getState().markers;
  useMapStore
    .getState()
    .setMarkers(
      existing.map((m) =>
        m.id === payload.incidentId && m.type === "incident" ? { ...m, status: payload.status ?? m.status } : m,
      ),
    );
}

function onPoiUpsert(poi: PoiResponse): void {
  upsertMarkers([poiToMarker(poi)], new Set([poi.id]));
}

function onPoiRemoved(payload: { id: string }): void {
  const existing = useMapStore.getState().markers;
  if (useSettingsStore.getState().showArchived) {
    useMapStore.getState().setMarkers(existing.map((m) => (m.id === payload.id ? { ...m, poiArchived: true } : m)));
    return;
  }
  useMapStore.getState().setMarkers(existing.filter((m) => m.id !== payload.id));
}

function onZoneUpsert(zone: EventZone): void {
  useZonesStore.getState().upsert(zone);
}

function onZoneRemoved(payload: { id: string }): void {
  useZonesStore.getState().remove(payload.id);
}

function reconcile(): void {
  if (wanted && !ownedByScreen) attach();
  else detach();
}

/** True while the phone's MapScreen owns the live feed (i.e. the UI is up). */
export function isMapScreenMounted(): boolean {
  return ownedByScreen;
}

/** Called by the bridge when the car connects/disconnects. */
export function setCarFeedWanted(next: boolean): void {
  if (wanted === next) return;
  wanted = next;

  if (wanted) {
    // On a cold headless start the session is still being read off disk when
    // the car connects, so `attach` finds no token and gives up. Nothing would
    // ever call it again, and the car sat on an empty event for the whole ride.
    // Watch the session instead, and attach the moment a token appears (which
    // also covers signing in on the phone while the car is already connected).
    lastSeenToken = useSessionStore.getState().token;
    sessionUnsubscribe = useSessionStore.subscribe((state) => {
      if (state.token === lastSeenToken) return;
      lastSeenToken = state.token;
      // A different identity invalidates the handlers bound to the old socket.
      detach();
      reconcile();
    });
  } else {
    sessionUnsubscribe?.();
    sessionUnsubscribe = null;
  }

  reconcile();
}

/**
 * MapScreen announces that it owns the live feed. While true this module stays
 * out of the way entirely.
 */
export function setMapFeedOwnedByScreen(next: boolean): void {
  if (ownedByScreen === next) return;
  ownedByScreen = next;
  // Deferred by a tick on release: MapScreen's cleanup calls the event-wide
  // `socket.off(...)` AFTER flipping this flag, and re-attaching synchronously
  // would put our handlers back only to have them stripped a line later.
  if (ownedByScreen) reconcile();
  else setTimeout(reconcile, 0);
}
