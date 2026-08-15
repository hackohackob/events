import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EventZone } from "@events/contracts";
import { debugLog } from "../../debug/debug-log";

const STORAGE_KEY = "zone-visibility/v1";

/**
 * Per-device zone visibility.
 *
 * Whether a zone is drawn is a personal choice — a medic working the north
 * sector shouldn't have someone else's south-sector overlay forced onto their
 * map. So the layers switch writes a LOCAL override here rather than patching
 * the shared record, and the zone's server-side `visible` is only the default
 * for a device that has never touched it.
 *
 * The one team-wide lever is a coordinator broadcast ("show this to everyone").
 * That stamps `visibleBroadcastAt` on the zone; each device applies a given
 * stamp once, dropping its override so the zone reappears. Turning it off after
 * that is a fresh override the broadcast no longer overrules — exactly as asked:
 * once you hide it for yourself, it stays hidden for you.
 */
interface ZoneVisibilityState {
  /** zoneId → this device's explicit choice. Absent = follow the zone default. */
  overrides: Record<string, boolean>;
  /** zoneId → the newest broadcast stamp this device has already applied. */
  appliedBroadcasts: Record<string, string>;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** This device's answer for one zone. */
  isVisible: (zone: EventZone) => boolean;
  /** Layers switch — always local. */
  setVisible: (zoneId: string, visible: boolean) => void;
  /** Freshly drawn zones are shown to their author straight away. */
  showLocally: (zoneId: string) => void;
  /**
   * Fold in whatever the server currently says. Any zone carrying a broadcast
   * stamp this device hasn't applied yet loses its override and becomes visible.
   */
  applyBroadcasts: (zones: EventZone[]) => void;
}

function persist(state: Pick<ZoneVisibilityState, "overrides" | "appliedBroadcasts">) {
  void AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ overrides: state.overrides, appliedBroadcasts: state.appliedBroadcasts }),
  ).catch((err) => debugLog("app", "warn", "zone visibility persist failed", String(err)));
}

export const useZoneVisibilityStore = create<ZoneVisibilityState>((set, get) => ({
  overrides: {},
  appliedBroadcasts: {},
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const saved = raw ? (JSON.parse(raw) as Partial<ZoneVisibilityState>) : null;
      set({
        overrides: saved?.overrides ?? {},
        appliedBroadcasts: saved?.appliedBroadcasts ?? {},
        hydrated: true,
      });
    } catch (err) {
      debugLog("app", "warn", "zone visibility hydrate failed", String(err));
      set({ hydrated: true });
    }
  },

  isVisible: (zone) => get().overrides[zone.id] ?? zone.visible,

  setVisible: (zoneId, visible) => {
    const overrides = { ...get().overrides, [zoneId]: visible };
    set({ overrides });
    persist({ overrides, appliedBroadcasts: get().appliedBroadcasts });
  },

  showLocally: (zoneId) => get().setVisible(zoneId, true),

  applyBroadcasts: (zones) => {
    const { overrides, appliedBroadcasts } = get();
    let changed = false;
    const nextOverrides = { ...overrides };
    const nextApplied = { ...appliedBroadcasts };

    for (const zone of zones) {
      const stamp = zone.visibleBroadcastAt;
      if (!stamp || nextApplied[zone.id] === stamp) continue;
      nextApplied[zone.id] = stamp;
      // Drop the local "hidden" so the coordinator's push actually lands.
      if (zone.id in nextOverrides) delete nextOverrides[zone.id];
      changed = true;
    }

    if (!changed) return;
    set({ overrides: nextOverrides, appliedBroadcasts: nextApplied });
    persist({ overrides: nextOverrides, appliedBroadcasts: nextApplied });
  },
}));
