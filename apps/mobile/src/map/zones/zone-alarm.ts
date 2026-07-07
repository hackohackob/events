import { useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useLocationStatus } from "../../debug/location-status";
import { useZonesStore } from "./zones-store";
import { pointInPolygon } from "./zone-geometry";
import { showBroadcastNotification } from "../../notifications/broadcast-notification";
import { debugLog } from "../../debug/debug-log";

/**
 * Zone entry alarm for medics: whenever the device's own GPS fix crosses INTO a
 * zone flagged `alarm`, raise an alarm-channel notification + strong haptics +
 * a spoken cue. Fires once per entry (re-armed when the medic leaves the zone),
 * and regardless of the zone's `visible` flag — hiding a zone from the map must
 * not disable the safety alert. Runners never have zones loaded, so this is
 * inert for them by construction.
 */
export function useZoneEntryAlarm(enabled: boolean): void {
  const fix = useLocationStatus((s) => s.lastFix);
  const zones = useZonesStore((s) => s.zones);
  const insideRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !fix) return;
    const nowInside = new Set<string>();
    for (const zone of zones) {
      if (!zone.alarm || zone.polygon.length < 3) continue;
      if (pointInPolygon(fix.lng, fix.lat, zone.polygon)) nowInside.add(zone.id);
    }

    for (const zone of zones) {
      if (!nowInside.has(zone.id) || insideRef.current.has(zone.id)) continue;
      // Crossed into an alarm zone.
      debugLog("app", "info", "entered alarm zone", zone.name);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Speech.speak(`Warning. Entering zone ${zone.name}.`, { language: "en-US" });
      void showBroadcastNotification(
        `⚠️ Entered zone: ${zone.name}`,
        "You crossed into an alarm zone — check the map.",
        { zoneId: zone.id },
        true,
      );
    }

    insideRef.current = nowInside;
  }, [enabled, fix, zones]);
}
