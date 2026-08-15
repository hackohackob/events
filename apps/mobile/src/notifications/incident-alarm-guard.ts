import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Decides whether a freshly-surfaced incident should raise an audible alarm.
 *
 * Three requirements drive this:
 *  1. An incident reported *before* the app was opened must NOT alarm just
 *     because the app came to the foreground (and re-fetched / re-received it).
 *     Only incidents created *after* this JS process started should ring.
 *  2. The same incident can arrive on two paths (socket `incident.created` and
 *     the background push), so we must de-duplicate by id.
 *  3. That de-duplication has to survive a PROCESS BOUNDARY. Tapping an
 *     incident notification cold-starts the app, and the queued push is then
 *     re-delivered to the background task in the fresh process — where an
 *     in-memory set is empty and `PROCESS_START` is "now", so a just-reported
 *     incident sailed through the age check and rang a second time while the
 *     user was already looking at it. Hence the ids are persisted.
 *
 * `PROCESS_START` is captured at module load. In the foreground that's app
 * launch; in the headless background-push task it's roughly the push delivery
 * time (which lines up with the report time), so genuinely new incidents still
 * ring while the app is closed.
 */
const PROCESS_START = Date.now();

/** Incidents created more than this long before the process started are treated
 *  as "pre-existing" and never alarm. The small grace absorbs clock skew and the
 *  gap between report time and process start on the cold-launch path. */
const STALE_THRESHOLD_MS = 10_000;

const STORAGE_KEY = "incident-alarms/v1";
/** Long enough to outlive any re-delivery, short enough that the record stays
 *  small over a multi-day event. */
const RETENTION_MS = 6 * 60 * 60 * 1000;

/** incidentId → when we rang for it (epoch ms). */
let alarmed: Record<string, number> = {};
let hydrated = false;
let hydrating: Promise<void> | null = null;

function prune(record: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - RETENTION_MS;
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(record)) if (at >= cutoff) out[id] = at;
  return out;
}

/**
 * Load the persisted ids. Safe to call repeatedly and from several places at
 * once — concurrent callers share one read, which matters because the socket
 * handler and the background task can both land in the same tick.
 */
export function hydrateAlarmGuard(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const saved = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      // Merge rather than assign: an alarm may have been recorded between the
      // read starting and finishing.
      alarmed = prune({ ...saved, ...alarmed });
    } catch {
      // Unreadable store → fall back to in-memory only. Worst case is one
      // duplicate ring, which is what we had before.
    } finally {
      hydrated = true;
      hydrating = null;
    }
  })();
  return hydrating;
}

function persist(): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(alarmed)).catch(() => undefined);
}

/** Record that this incident has rung, so no other path rings for it again. */
export function markIncidentAlarmed(incidentId: string): void {
  if (!incidentId) return;
  alarmed[incidentId] = Date.now();
  alarmed = prune(alarmed);
  persist();
}

export async function shouldRaiseIncidentAlarm(opts: {
  incidentId?: string | null;
  createdAt?: string | number | null;
}): Promise<boolean> {
  await hydrateAlarmGuard();

  const id = opts.incidentId ? String(opts.incidentId) : null;
  if (id && alarmed[id] != null) return false;

  if (opts.createdAt != null) {
    const createdMs =
      typeof opts.createdAt === "number" ? opts.createdAt : Date.parse(String(opts.createdAt));
    if (Number.isFinite(createdMs) && PROCESS_START - createdMs > STALE_THRESHOLD_MS) {
      // Reported before the app opened — surface it on the map, but don't ring.
      if (id) markIncidentAlarmed(id);
      return false;
    }
  }

  if (id) markIncidentAlarmed(id);
  return true;
}
