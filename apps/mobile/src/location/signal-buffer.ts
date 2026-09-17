import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { COVERAGE_MAX_BATCH, type CoverageSampleInput, type SignalSample } from "@events/contracts";
import { apiFetch } from "../ui/api-client";
import { isOnline } from "../offline/connectivity";
import { debugLog } from "../debug/debug-log";

/**
 * The coverage survey's own backlog.
 *
 * A medic standing in a hole cannot report from it — and that reading is the
 * single most valuable one the survey can take. The live location queue cannot
 * carry it: that queue is last-write-wins by design (a stale position is
 * worthless the moment a fresher one exists, and replaying an hours-long
 * backlog of individual POSTs hammers the radio just as coverage returns).
 *
 * Coverage samples have the opposite semantics. Each one is a distinct
 * measurement of a distinct place, append-only, and none of them supersedes
 * another. So they get their own buffer, which:
 *
 *   • thins on the device with the same deadband the server applies, so three
 *     hours parked in a dead spot is tens of rows and not thousands;
 *   • is capped, so a pathological outage cannot grow without bound;
 *   • persists to AsyncStorage, so the OS killing the app mid-outage does not
 *     erase the survey; and
 *   • drains as ONE batched request per chunk rather than a burst — which
 *     answers the radio concern better than dropping the data did.
 */

interface BufferedSample extends CoverageSampleInput {
  eventId: string;
  medicId: string;
}

const STORAGE_KEY = "coverage.signal.buffer.v1";

/**
 * Ceiling on buffered readings. At the thinning rates below this is many hours
 * of walking; past it the OLDEST go, because a backlog that long means the
 * recent ground is the part still worth surveying.
 */
const MAX_BUFFERED = 1_000;

/** Floor on spacing between stored readings. */
const MIN_GAP_MS = 20_000;

/** …but a stationary device still records this often. Standing still is the
 *  informative case here: "this post had no data for three hours" only exists
 *  if we keep sampling a parked phone. */
const HEARTBEAT_MS = 5 * 60_000;

/** Movement that earns a reading of its own, in metres. */
const MIN_MOVE_M = 20;

/**
 * Writes to AsyncStorage are debounced: a disk write per GPS fix is exactly the
 * kind of background churn the battery rules forbid, and losing the last few
 * seconds of buffer to a hard kill costs one reading.
 */
const PERSIST_DEBOUNCE_MS = 15_000;

let buffer: BufferedSample[] = [];
let lastStored: { lat: number; lng: number; atMs: number; bars: number | undefined } | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;
let hydrated = false;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Group key for a medic's readings on one event. JSON rather than a delimiter
 *  because ids are free-form text and could contain whichever char we picked. */
function groupKey(eventId: string, medicId: string): string {
  return JSON.stringify([eventId, medicId]);
}

/** Load a backlog left over from a previous run. Safe to call more than once. */
export async function hydrateSignalBuffer(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    // Anything already in memory was recorded THIS run and is newer, so the
    // restored rows go in front of it.
    buffer = [...(parsed as BufferedSample[]), ...buffer].slice(-MAX_BUFFERED);
    if (buffer.length > 0) {
      debugLog("location", "info", `restored ${buffer.length} buffered coverage reading(s)`);
    }
  } catch (err) {
    debugLog("location", "warn", "could not restore coverage buffer", String(err));
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, PERSIST_DEBOUNCE_MS);
  persistTimer.unref?.();
}

async function persistNow(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    if (buffer.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch (err) {
    debugLog("location", "warn", "could not persist coverage buffer", String(err));
  }
}

// Backgrounding is the usual prelude to the OS killing the app, so cut the
// debounce short right then rather than waiting it out.
AppState.addEventListener("change", (next) => {
  if (next !== "active" && buffer.length > 0) void persistNow();
});

/**
 * Record a reading taken while the device could not reach the server.
 *
 * Returns true when it cleared the deadband and was stored. Cheap and
 * synchronous — it runs on the location hot path.
 */
export function bufferSignalSample(sample: {
  eventId: string;
  medicId: string;
  lat: number;
  lng: number;
  at: string;
  signal: SignalSample;
}): boolean {
  if (!sample.eventId || !sample.medicId) return false;
  if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return false;

  const atMs = Date.parse(sample.at);
  if (!Number.isFinite(atMs)) return false;

  if (lastStored) {
    const elapsed = atMs - lastStored.atMs;
    // Out-of-order delivery (a Doze backlog). Keep it — the survey aggregates,
    // order is irrelevant — but don't drag the anchor backwards.
    if (elapsed > 0) {
      if (elapsed < MIN_GAP_MS) return false;
      const stale = elapsed >= HEARTBEAT_MS;
      // A change in signal is the event worth capturing, so it earns a row
      // regardless of how little the medic moved.
      const changed = lastStored.bars !== sample.signal.bars;
      if (!stale && !changed) {
        if (haversineMeters(lastStored.lat, lastStored.lng, sample.lat, sample.lng) < MIN_MOVE_M) {
          return false;
        }
      }
    }
  }

  lastStored = { lat: sample.lat, lng: sample.lng, atMs, bars: sample.signal.bars };
  buffer.push({
    eventId: sample.eventId,
    medicId: sample.medicId,
    lat: sample.lat,
    lng: sample.lng,
    at: sample.at,
    signal: sample.signal,
  });
  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
  schedulePersist();
  return true;
}

export function signalBufferSize(): number {
  return buffer.length;
}

/**
 * Post the backlog. Chunked so a long outage is a few requests rather than one
 * enormous body, and so a chunk that fails takes only itself down.
 *
 * Rows are grouped by (event, medic): a medic may have switched events during
 * the outage, and each reading belongs to the event it was taken on.
 */
export async function flushSignalBuffer(): Promise<void> {
  if (flushInFlight || !isOnline() || buffer.length === 0) return;
  flushInFlight = true;

  try {
    const groups = new Map<string, BufferedSample[]>();
    for (const sample of buffer) {
      const key = groupKey(sample.eventId, sample.medicId);
      const group = groups.get(key);
      if (group) group.push(sample);
      else groups.set(key, [sample]);
    }

    const delivered = new Set<BufferedSample>();
    let sent = 0;

    outer: for (const [key, group] of groups) {
      const [eventId, medicId] = JSON.parse(key) as [string, string];
      for (let i = 0; i < group.length; i += COVERAGE_MAX_BATCH) {
        const chunk = group.slice(i, i + COVERAGE_MAX_BATCH);
        try {
          await apiFetch("/coverage/samples", {
            method: "POST",
            body: JSON.stringify({
              eventId,
              medicId,
              samples: chunk.map(({ lat, lng, at, signal }) => ({ lat, lng, at, signal })),
            }),
          });
          for (const sample of chunk) delivered.add(sample);
          sent += chunk.length;
        } catch (err) {
          // Stop at the first failure: the network is evidently still bad, and
          // hammering it with the rest of the backlog is what this whole module
          // exists to avoid. Everything undelivered stays buffered for the next
          // trigger.
          debugLog("location", "warn", "coverage backlog flush interrupted", String(err));
          break outer;
        }
      }
    }

    if (delivered.size > 0) {
      buffer = buffer.filter((sample) => !delivered.has(sample));
      await persistNow();
      debugLog("location", "info", `coverage backlog: sent ${sent}, ${buffer.length} left`);
    }
  } finally {
    flushInFlight = false;
  }
}
