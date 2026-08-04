import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import Constants from "expo-constants";

const STORAGE_KEY = "build-info/v1";

/**
 * When each JS bundle first RAN on this device.
 *
 * `Updates.createdAt` is when a bundle was published, which says nothing about
 * whether a given phone has it yet — and "has the OTA landed?" is the question
 * actually being asked. expo-updates has no "downloaded at" of its own, so the
 * first launch of a new `updateId` is recorded here instead.
 *
 * Deliberately not using expo-application for the install time: it is a native
 * module, so adding it would need a store build — and this whole screen exists
 * to verify OTA delivery, which must keep working on the builds already in the
 * field. First launch of the app on this device is a good enough stand-in.
 */
interface StoredBuildInfo {
  /** First time the app was ever opened on this device. */
  firstLaunchAt: number;
  /** The updateId that was running last time we looked. */
  updateId: string | null;
  /** When that updateId first ran here — i.e. when the OTA actually arrived. */
  updateAppliedAt: number;
}

interface BuildInfoState extends Partial<StoredBuildInfo> {
  hydrated: boolean;
  hydrate: () => Promise<void>;
}

export const useBuildInfo = create<BuildInfoState>((set, get) => ({
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const now = Date.now();
    const current = Updates.updateId ?? null;

    let stored: StoredBuildInfo | null = null;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as StoredBuildInfo;
    } catch {
      // Corrupt or missing — treat as a first run rather than failing.
    }

    // A different updateId than last launch means a new bundle just took over.
    // Same id (or both embedded/null) means we are still on the one we recorded.
    const isNewBundle = !stored || stored.updateId !== current;
    const next: StoredBuildInfo = {
      firstLaunchAt: stored?.firstLaunchAt ?? now,
      updateId: current,
      updateAppliedAt: isNewBundle ? now : stored!.updateAppliedAt,
    };

    set({ ...next, hydrated: true });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  },
}));

/** JS bundle's app version — moves with an OTA, unlike the native build. */
export const APP_VERSION = Constants.expoConfig?.version ?? "—";

/** Native build number. Only changes with a real store/APK install. */
export const NATIVE_BUILD = String(
  Constants.expoConfig?.android?.versionCode ??
    Constants.expoConfig?.ios?.buildNumber ??
    "—",
);
