import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { buildItinerary, formatTime, type ItineraryStop } from "@events/planner";
import { useSessionStore } from "../security/session-store";
import { debugLog } from "../debug/debug-log";
import { fetchPlan, fetchPlanTracks } from "./plan-api";
import { buildPlanCourses, buildSweepWindows, sweepsForMedic } from "./plan-model";
import { DEFAULT_MIN_TRAVEL_MINUTES } from "@events/planner";

/**
 * Departure reminders from the deployment plan.
 *
 * The plan is the only thing in the app that knows where a medic has to be
 * BEFORE anyone asks them to go — so it is the only thing that can tell them in
 * time to get there. Every alert here is a local schedule, not a push: the
 * times are known hours ahead, and a reminder to leave for a col with no
 * reception is exactly the one a server could never deliver.
 */
export const PLAN_CHANNEL_ID = "plan-moves-v1";

/** Marks our own notifications so a re-sync only cancels the ones it owns. */
const PLAN_MARKER = "plan-move";

/** Heads-up before a departure. Enough to pack up, short enough to still be now. */
const HEADS_UP_MINUTES = 10;

/**
 * iOS keeps at most 64 pending local notifications per app, and the incident
 * and chat paths need room in that budget too. Two alerts per move means this
 * covers the next ~15 moves, which on a race day is the whole shift.
 */
const MAX_SCHEDULED = 30;

let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android" || channelReady) return;
  await Notifications.setNotificationChannelAsync(PLAN_CHANNEL_ID, {
    name: "Deployment plan",
    description: "Reminders to move to your next position.",
    // HIGH, not MAX: a move is time-critical enough to interrupt, but it is a
    // schedule, not an emergency — the incident alarm keeps that ground alone.
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableVibrate: true,
    vibrationPattern: [0, 200, 120, 200],
  });
  channelReady = true;
}

async function cancelPlanNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const item of scheduled) {
    if ((item.content?.data as { kind?: string } | undefined)?.kind !== PLAN_MARKER) continue;
    await Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => undefined);
  }
}

/** What a stop's alert says. Mirrors the briefing line, so the phone and the
 *  call sheet never word the same move differently. */
function moveCopy(stop: ItineraryStop, headsUp: boolean): { title: string; body: string } {
  const travel = stop.travelMinutes > 0 ? `${stop.travelMinutes} min travel` : null;
  const arrival = `be there by ${formatTime(stop.arriveMs)}`;
  const detail = [travel, arrival].filter(Boolean).join(" · ");
  return headsUp
    ? { title: `Leaving in ${HEADS_UP_MINUTES} min`, body: `${stop.label} — ${detail}` }
    : { title: `Move to ${stop.label}`, body: `Leave now — ${detail}` };
}

/**
 * Re-schedule this medic's reminders from the current plan.
 *
 * Cheap enough to call on every launch and every plan save: it reads one
 * document, and the schedule it produces is replaced wholesale rather than
 * diffed — a plan that changed while the phone was asleep must not leave a
 * reminder behind for a move that no longer exists.
 */
export async function syncPlanNotifications(): Promise<void> {
  const { eventId, userId, role } = useSessionStore.getState();
  if (!eventId || !userId) return;
  if (role === "runner" || role === "spectator") return;

  try {
    const [plan, tracks] = await Promise.all([
      fetchPlan(eventId),
      fetchPlanTracks().catch(() => []),
    ]);
    const mine = plan.medics.find((m) => m.medicId === userId && !m.hidden);
    await cancelPlanNotifications();
    if (!mine) return;

    const windows = buildSweepWindows(buildPlanCourses(plan, tracks));
    const itinerary = buildItinerary(mine, {
      minTravelMinutes: plan.settings?.minTravelMinutes ?? DEFAULT_MIN_TRAVEL_MINUTES,
      sweeps: sweepsForMedic(mine, windows),
    });

    await ensureChannel();
    const now = Date.now();
    let scheduled = 0;

    for (let i = 0; i < itinerary.stops.length && scheduled < MAX_SCHEDULED; i += 1) {
      const stop = itinerary.stops[i];
      const previous = itinerary.stops[i - 1];
      // The first stop has no journey to leave for; every other one is entered
      // by leaving the stop before it, which is where the reminder belongs.
      const departMs = previous?.departMs ?? null;
      if (departMs == null || departMs <= now) continue;

      const alerts: Array<{ at: number; headsUp: boolean }> = [{ at: departMs, headsUp: false }];
      const headsUpAt = departMs - HEADS_UP_MINUTES * 60_000;
      // Skipped when the medic is barely on station: two alerts inside a few
      // minutes of each other is noise, and the later one is the real one.
      if (headsUpAt > now && (previous.dwellMinutes ?? 0) > HEADS_UP_MINUTES) {
        alerts.unshift({ at: headsUpAt, headsUp: true });
      }

      for (const alert of alerts) {
        if (scheduled >= MAX_SCHEDULED) break;
        const copy = moveCopy(stop, alert.headsUp);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: copy.title,
            body: copy.body,
            data: { kind: PLAN_MARKER, eventId, stationId: stop.stationId },
            ...(Platform.OS === "android" ? {} : { interruptionLevel: "timeSensitive" as const }),
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(alert.at),
            channelId: PLAN_CHANNEL_ID,
          },
        });
        scheduled += 1;
      }
    }

    debugLog("api", "info", `plan reminders scheduled: ${scheduled}`);
  } catch (err) {
    // A medic without plan access (or an event with no plan at all) is the
    // normal case, not a failure worth surfacing.
    debugLog("api", "info", "plan reminders not scheduled", String(err));
  }
}

/** Drop every pending reminder — on sign-out, or when leaving an event. */
export async function clearPlanNotifications(): Promise<void> {
  await cancelPlanNotifications().catch(() => undefined);
}
