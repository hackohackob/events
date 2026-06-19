/**
 * Decides whether a freshly-surfaced incident should raise an audible alarm.
 *
 * Two requirements drive this:
 *  1. An incident reported *before* the app was opened must NOT alarm just
 *     because the app came to the foreground (and re-fetched / re-received it).
 *     Only incidents created *after* this JS process started should ring.
 *  2. The same incident can arrive on two paths (socket `incident.created` and
 *     the background push), so we must de-duplicate by id.
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

const alarmedIncidentIds = new Set<string>();

export function shouldRaiseIncidentAlarm(opts: {
  incidentId?: string | null;
  createdAt?: string | number | null;
}): boolean {
  const id = opts.incidentId ? String(opts.incidentId) : null;
  if (id) {
    if (alarmedIncidentIds.has(id)) return false;
  }

  if (opts.createdAt != null) {
    const createdMs =
      typeof opts.createdAt === "number" ? opts.createdAt : Date.parse(String(opts.createdAt));
    if (Number.isFinite(createdMs) && PROCESS_START - createdMs > STALE_THRESHOLD_MS) {
      // Reported before the app opened — surface it on the map, but don't ring.
      if (id) alarmedIncidentIds.add(id);
      return false;
    }
  }

  if (id) alarmedIncidentIds.add(id);
  return true;
}
