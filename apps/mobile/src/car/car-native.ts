/**
 * Thin, total wrapper around the native `CarBridgeModule`.
 *
 * The module only exists on Android, and only in a native build that contains
 * the car app — so every entry point here degrades to a no-op rather than
 * throwing. That is deliberate: the car bridge must never be able to take the
 * phone app down, on iOS, in Expo Go, or on an older APK running a newer OTA.
 */
import { DeviceEventEmitter, NativeModules, Platform, type EmitterSubscription } from "react-native";
import type { CarAction } from "./car-types";
import { debugLog } from "../debug/debug-log";

interface CarBridgeNative {
  /** Master switch mirroring the Settings toggle. Off = car app shows a notice. */
  setEnabled: (enabled: boolean) => void;
  pushStatic: (json: string) => void;
  pushDynamic: (json: string) => void;
  isCarConnected: () => Promise<boolean>;
  /** Pre-download raster tiles for the car's own cache. */
  prefetchTiles: (json: string) => Promise<{ requested: number }>;
  cancelPrefetch: () => void;
  tileCacheStats: () => Promise<{ tiles: number; bytes: number }>;
  clearTileCache: () => Promise<void>;
}

const native: CarBridgeNative | null =
  Platform.OS === "android" ? ((NativeModules.CarBridgeModule as CarBridgeNative | undefined) ?? null) : null;

/** True when this build actually contains the Android Auto car app. */
export const carBridgeAvailable = native !== null;

function guard<T>(what: string, run: () => T, fallback: T): T {
  if (!native) return fallback;
  try {
    return run();
  } catch (err) {
    debugLog("app", "warn", `car bridge ${what} failed`, String(err));
    return fallback;
  }
}

export function setCarEnabled(enabled: boolean): void {
  guard("setEnabled", () => native!.setEnabled(enabled), undefined);
}

export function pushCarStatic(json: string): void {
  guard("pushStatic", () => native!.pushStatic(json), undefined);
}

export function pushCarDynamic(json: string): void {
  guard("pushDynamic", () => native!.pushDynamic(json), undefined);
}

export async function isCarConnected(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isCarConnected();
  } catch {
    return false;
  }
}

export interface TilePrefetchRequest {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  minZoom: number;
  maxZoom: number;
  tileUrlTemplate: string;
}

export async function prefetchCarTiles(request: TilePrefetchRequest): Promise<number> {
  if (!native) return 0;
  const result = await native.prefetchTiles(JSON.stringify(request));
  return result?.requested ?? 0;
}

export function cancelCarTilePrefetch(): void {
  guard("cancelPrefetch", () => native!.cancelPrefetch(), undefined);
}

export async function carTileCacheStats(): Promise<{ tiles: number; bytes: number }> {
  if (!native) return { tiles: 0, bytes: 0 };
  try {
    return await native.tileCacheStats();
  } catch {
    return { tiles: 0, bytes: 0 };
  }
}

export async function clearCarTileCache(): Promise<void> {
  if (!native) return;
  try {
    await native.clearTileCache();
  } catch {
    // Nothing to do — a cache that refuses to clear is not worth an error path.
  }
}

/** Fires when Android Auto connects or disconnects. */
export function onCarConnectionChanged(handler: (connected: boolean) => void): EmitterSubscription | null {
  if (!native) return null;
  return DeviceEventEmitter.addListener("CarBridge:connected", (event: { connected?: boolean }) => {
    handler(Boolean(event?.connected));
  });
}

/** Fires when a car screen asks the phone to do something. */
export function onCarAction(handler: (action: CarAction) => void): EmitterSubscription | null {
  if (!native) return null;
  return DeviceEventEmitter.addListener("CarBridge:action", (event: { json?: string }) => {
    if (!event?.json) return;
    let action: CarAction;
    try {
      action = JSON.parse(event.json) as CarAction;
    } catch (err) {
      debugLog("app", "warn", "unparseable car action", String(err));
      return;
    }
    handler(action);
  });
}

export interface TilePrefetchProgress {
  done: number;
  total: number;
  bytes: number;
  finished: boolean;
  error?: string;
}

export function onCarTilePrefetchProgress(
  handler: (progress: TilePrefetchProgress) => void,
): EmitterSubscription | null {
  if (!native) return null;
  return DeviceEventEmitter.addListener("CarBridge:prefetch", (event: TilePrefetchProgress) => handler(event));
}
