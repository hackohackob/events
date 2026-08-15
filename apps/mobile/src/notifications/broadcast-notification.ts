import notifee, { AndroidCategory, AndroidGroupAlertBehavior, AndroidImportance, AndroidVisibility } from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { NOTIFICATION_GROUP_ID } from "./foreground-notification";
import { debugLog } from "../debug/debug-log";

const ALERT_CHANNEL_ID = "alerts";
/**
 * Alarm-grade channel for incident alerts: max importance, bypasses Do Not
 * Disturb (honored once the user grants the app DND access), strong vibration.
 * The backend sends remote pushes on this same channel id so closed-app
 * deliveries behave identically.
 *
 * v5: created via expo-notifications (NOT notifee) so the siren gets
 * AudioAttributes USAGE_ALARM — it plays on the ALARM volume stream, which
 * stays audible when the ring/notification volume is turned down. Notifee
 * still *displays* on this channel (channels are app-global).
 *
 * v6: fresh id (channel settings are immutable once created — v5 installs in
 * the field may carry a mangled config) + the alarm-stream volume is forced up
 * right before ringing (see ensureAlarmStreamVolume), because no channel
 * config can ring through an alarm stream the user has slid to zero.
 *
 * v7: another fresh id, after a report of the alarm being inaudible with the
 * phone merely on vibrate and DND off. The device then reported the channel
 * holding exactly what was asked for — MAX importance, custom sound, ALARM
 * audio usage — and still stayed silent, which settled it: Android applies
 * ringer-mode suppression to a NOTIFICATION before the channel's audio
 * attributes are consulted. No channel config can ring through vibrate.
 *
 * v8: therefore the channel no longer carries a sound AT ALL. The app plays the
 * siren itself (incident-siren.ts), which is not a notification and is not
 * suppressed — so it is audible in every ringer mode, and it is the same sound
 * every time rather than "ours on vibrate, Android's otherwise". The channel is
 * left with vibration and MAX importance; the noise is our job now.
 *
 * The one thing this gives up: a FULLY killed app cannot play anything, and a
 * silent channel means such a delivery arrives with no sound. Location tracking
 * holds a foreground service, so the process is normally alive.
 */
export const INCIDENT_ALARM_CHANNEL_ID = "incident-alarm-v8";
/** Superseded ids, removed so the app doesn't show a pile of alarm channels in
 *  system settings (and so a stale one can't be re-targeted by an old push). */
const LEGACY_ALARM_CHANNEL_IDS = [
  "alerts-critical",
  "incident-alarm",
  "incident-alarm-v5",
  "incident-alarm-v6",
  "incident-alarm-v7",
];

/**
 * An alarm on the ALARM stream is still silent if the user dragged that volume
 * to zero — so push it to max right before ringing. Uses
 * react-native-volume-manager, which needs a new dev build; the dynamic
 * require keeps OTA-updated binaries built before the dependency from crashing
 * (they just skip the boost).
 */
export async function ensureAlarmStreamVolume(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setVolume } = require("react-native-volume-manager") as {
      setVolume: (value: number, config?: { type?: string; showUI?: boolean }) => Promise<void>;
    };
    await setVolume(1, { type: "alarm", showUI: false });
  } catch (err) {
    debugLog("app", "warn", "alarm volume boost unavailable", String(err));
  }
}
let alertChannelEnsured = false;

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  if (!alertChannelEnsured) {
    await notifee.createChannel({
      id: ALERT_CHANNEL_ID,
      name: "Alerts & Broadcasts",
      importance: AndroidImportance.HIGH, // heads-up + sound
      visibility: AndroidVisibility.PUBLIC,
    });
    alertChannelEnsured = true;
  }
  await ensureIncidentAlarmChannel();
}

/**
 * (Re-)create the alarm channel. Runs on every alarm rather than once:
 * `bypassDnd` is silently stripped by Android while the app lacks DND access,
 * but an app WITH access may update it on an existing channel — so re-applying
 * here picks the flag up as soon as the user grants access in settings.
 */
export async function ensureIncidentAlarmChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(INCIDENT_ALARM_CHANNEL_ID, {
    name: "Incident alarms",
    description: "Critical incident alerts — rings and vibrates even in Do Not Disturb.",
    importance: Notifications.AndroidImportance.MAX,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
    // No channel sound: the app plays the siren itself so it is heard in every
    // ringer mode and is always the same sound. Leaving one here as well would
    // mean two copies a beat apart whenever the ringer was on.
    sound: null,
    enableVibrate: true,
    vibrationPattern: [300, 600, 300, 600, 300, 600],
    enableLights: true,
  });
  for (const id of LEGACY_ALARM_CHANNEL_IDS) {
    await Notifications.deleteNotificationChannelAsync(id).catch(() => undefined);
  }
}

/**
 * Report what Android ACTUALLY stored for the alarm channel.
 *
 * The app can only ask; once a channel exists the system owns its sound,
 * importance and DND bypass, and silently ignores every later change. When an
 * alarm doesn't ring there is no way to tell from the source whether the
 * request was refused, so read the truth back and put it in the debug console.
 */
export async function logIncidentChannelState(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await ensureIncidentAlarmChannel();
    const channel = await Notifications.getNotificationChannelAsync(INCIDENT_ALARM_CHANNEL_ID);
    if (!channel) {
      debugLog("app", "error", "incident alarm channel missing", INCIDENT_ALARM_CHANNEL_ID);
      return;
    }
    debugLog("app", "info", "incident alarm channel state", {
      id: channel.id,
      importance: channel.importance,
      sound: channel.sound,
      audioUsage: (channel as { audioAttributes?: { usage?: unknown } }).audioAttributes?.usage,
      bypassDnd: channel.bypassDnd,
      vibrate: channel.enableVibrate,
    });
  } catch (err) {
    debugLog("app", "warn", "incident alarm channel probe failed", String(err));
  }
}

/**
 * Present a heads-up OS notification for a dashboard broadcast or incident alarm.
 * Uses notifee directly so it fires even while the app is foregrounded and needs
 * no push token / FCM setup.
 *
 * `alarm: true` turns it into an incident alarm: alarm channel (DND bypass),
 * looping sound that keeps ringing until the notification is opened or
 * dismissed, and full-screen prominence on the lock screen.
 */
export async function showBroadcastNotification(
  title: string,
  body: string,
  data?: Record<string, string>,
  alarm = false,
): Promise<void> {
  try {
    // While the app is open we still surface the alert as a heads-up
    // notification, but drop the insistent looping siren + full-screen takeover
    // (those are meant for when the phone is pocketed/locked). Otherwise a new
    // incident arriving with the app foregrounded would show nothing at all.
    const foregrounded = AppState.currentState === "active";
    const insistent = alarm && !foregrounded;
    if (alarm && foregrounded) {
      debugLog("app", "info", "foreground incident alert (non-insistent)", data?.incidentId ?? title);
    }
    await notifee.requestPermission();
    await ensureChannels();
    // Ring-through guarantee: an alarm-stream siren is inaudible at alarm
    // volume 0 no matter how the channel is configured.
    if (alarm) await ensureAlarmStreamVolume();
    await notifee.displayNotification({
      // Stable id per incident: the socket path and the data-only push path can
      // both fire for the same incident — the second display replaces the
      // first instead of stacking a duplicate.
      //
      // Spread, never `id: undefined`. notifee validates with
      // `objectHasProperty`, so a present-but-undefined `id` is NOT the same as
      // an absent one: it throws and nothing is displayed. That is why dashboard
      // broadcasts (which carry no incidentId) never appeared.
      ...(data?.incidentId ? { id: `incident-${data.incidentId}` } : {}),
      title,
      body,
      data,
      android: {
        channelId: alarm ? INCIDENT_ALARM_CHANNEL_ID : ALERT_CHANNEL_ID,
        color: alarm ? "#ef4444" : "#f59e0b",
        smallIcon: "ic_launcher",
        // Stack under the persistent tracking notification (the group summary)
        // instead of piling up as separate tray entries.
        groupId: NOTIFICATION_GROUP_ID,
        groupAlertBehavior: AndroidGroupAlertBehavior.CHILDREN,
        pressAction: { id: "default", launchActivity: "default" },
        ...(alarm
          ? {
              category: AndroidCategory.ALARM,
              // Channel sound drives 8.0+; the notification-level sound covers
              // older Androids and doubles as a belt-and-braces fallback.
              sound: "incident_alarm",
              // The bundled siren is itself ~30s long, so a single play already
              // rings for the full window. We deliberately do NOT loop it
              // (FLAG_INSISTENT): looping would ring forever until dismissed, and
              // capping that with `timeoutAfter` would also remove the incident
              // from the tray. Playing the 30s file once stops the sound on its
              // own while leaving the notification in place.
              loopSound: false,
              autoCancel: true,
              ongoing: false,
              // Light up / take over the lock screen like an incoming call —
              // only worthwhile when the app isn't already in the foreground.
              ...(insistent ? { fullScreenAction: { id: "default", launchActivity: "default" } } : {}),
            }
          : {}),
      },
      ios: { sound: "default", critical: alarm },
    });
  } catch (err) {
    // Surface to Metro (debugLog only writes to the in-app console).
    console.warn("[broadcast-notification] failed:", err);
    debugLog("app", "error", "broadcast notification failed", String(err));
  }
}
