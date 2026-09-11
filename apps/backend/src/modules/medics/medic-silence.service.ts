import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DbService } from "../infra/db.service";
import { EventsService } from "../events/events.service";
import { NotificationsService } from "../notifications/notifications.service";

/**
 * Wake medics whose phone has stopped reporting.
 *
 * iOS suspends a backgrounded app once the OS stops producing location fixes,
 * and a suspended JS runtime runs no timers — so the app's own heartbeat AND
 * its tracking watchdog both freeze. Nothing inside the app can fix that: the
 * wake has to come from outside, and the only thing that reaches a suspended
 * app is a silent (`content-available`) push.
 *
 * This service is that outside. It watches `medic_last_location.recorded_at`
 * and pings the devices that have gone quiet for too long. Nothing is ever
 * displayed to the medic — see NotificationsService.sendSilentToUser.
 */

/** How often the sweep runs. Cheap: one indexed query over live medics. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Silence that counts as "gone dark", by declared status.
 *
 * A medic holding a post produces no fixes by design (iOS has nothing but a
 * distance filter to gate on), so they are given longer before we spend a
 * background push on them. A moving medic going quiet for ten minutes is
 * already abnormal.
 *
 * Both sit under the 15 min at which `computeFreshness` writes a medic off as
 * offline for the moving case, and at it for the stationary one — the ping and
 * the fix it triggers are what keep them on the map.
 */
const SILENCE_MOVING_MS = 10 * 60_000;
const SILENCE_STATIONARY_MS = 15 * 60_000;

/** Statuses that mean "deliberately not moving". */
const STATIONARY_STATUSES = new Set(["stationary", "rest"]);

/** Minimum gap between pings to the same medic while they stay silent. */
const PING_COOLDOWN_MS = 5 * 60_000;

/**
 * After this many pings with no fix coming back, the phone is off, out of
 * coverage, or force-quit (iOS does not deliver background pushes to an app
 * the user swiped away). Keep trying, but slowly — a phone that rejoins the
 * network should still get woken, without us burning a push every 5 minutes
 * on one that never will.
 */
const PING_ATTEMPTS_BEFORE_BACKOFF = 5;
const PING_COOLDOWN_BACKOFF_MS = 30 * 60_000;

/**
 * Past this much silence the medic has gone home without leaving the event.
 * Stop pinging; their row stays for the dashboard to show as offline.
 */
const GIVE_UP_AFTER_MS = 6 * 60 * 60_000;

interface PingState {
  /** When we last sent a silent push to this medic. */
  lastPingAt: number;
  /** Consecutive pings with no fresher fix since. */
  attempts: number;
  /** The fix age marker the attempts were counted against. */
  lastSeenFixAt: number;
}

@Injectable()
export class MedicSilenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MedicSilenceService.name);
  private readonly pings = new Map<string, PingState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DbService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    // Node keeps the process alive for timers; this one must never be the
    // reason a shutdown hangs.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async sweep(): Promise<void> {
    try {
      // The cheaper of the two thresholds bounds the query; the per-row check
      // below applies the right one for that medic's declared status.
      const { rows } = await this.db.query<{
        medic_id: string;
        event_id: string;
        name: string | null;
        status: string;
        recorded_at: string;
      }>(
        `SELECT medic_id::text AS medic_id, event_id, name, status, recorded_at
           FROM medic_last_location
          WHERE recorded_at < now() - ($1::double precision * interval '1 millisecond')`,
        [SILENCE_MOVING_MS],
      );

      const now = Date.now();
      for (const row of rows) {
        const key = `${row.event_id}:${row.medic_id}`;
        // Only live events. A closed event's medics are expected to be quiet.
        if (this.events.findById(row.event_id)?.status !== "active") {
          this.pings.delete(key);
          continue;
        }

        const fixAt = new Date(row.recorded_at).getTime();
        const silentForMs = now - fixAt;
        if (!Number.isFinite(silentForMs)) continue;

        const threshold = STATIONARY_STATUSES.has(row.status)
          ? SILENCE_STATIONARY_MS
          : SILENCE_MOVING_MS;
        if (silentForMs < threshold) continue;
        if (silentForMs > GIVE_UP_AFTER_MS) {
          this.pings.delete(key);
          continue;
        }

        // A fresher fix than the one the attempts were counted against means
        // the medic came back at some point — start counting again.
        const state = this.pings.get(key);
        const attempts = state && state.lastSeenFixAt === fixAt ? state.attempts : 0;
        const cooldown = attempts >= PING_ATTEMPTS_BEFORE_BACKOFF
          ? PING_COOLDOWN_BACKOFF_MS
          : PING_COOLDOWN_MS;
        if (state && now - state.lastPingAt < cooldown) continue;

        const devices = await this.notifications.sendSilentToUser(row.medic_id, row.event_id, {
          kind: "location_ping",
          eventId: row.event_id,
          medicId: row.medic_id,
          sentAt: new Date(now).toISOString(),
        });
        // No registered device — nothing to wake, and no point holding state.
        if (devices === 0) {
          this.pings.delete(key);
          continue;
        }

        this.pings.set(key, { lastPingAt: now, attempts: attempts + 1, lastSeenFixAt: fixAt });
        this.logger.log(
          `Silent location ping → ${row.name ?? row.medic_id} (${row.status}, quiet for ` +
            `${Math.round(silentForMs / 60_000)} min, attempt ${attempts + 1}, ${devices} device(s))`,
        );
      }
    } catch (err) {
      this.logger.warn(`Medic silence sweep failed: ${(err as Error).message}`);
    }
  }
}
