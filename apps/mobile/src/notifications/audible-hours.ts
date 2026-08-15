/**
 * The window in which the app is allowed to make itself heard regardless of the
 * phone's ringer switch.
 *
 * During an event a phone lives in a pocket under a jacket and is very often on
 * silent or vibrate — a chat message that arrives with no sound is a message
 * nobody reads. So between these hours notifications are routed onto the ALARM
 * audio stream, which ignores the ring/notification volume and the silent
 * switch. Outside them the app goes back to being a well-behaved citizen and
 * respects whatever the user set.
 *
 * (This is only about the ringer. Incident alarms are a separate, always-on
 * channel that also bypasses Do Not Disturb — see broadcast-notification.ts.)
 */
const AUDIBLE_START_HOUR = 8; // 08:00
const AUDIBLE_END_HOUR = 20; // 20:00

/** Device-local time — the medic and their phone are at the same event. */
export function isWithinAudibleHours(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= AUDIBLE_START_HOUR && hour < AUDIBLE_END_HOUR;
}
