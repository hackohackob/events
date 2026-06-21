import { create } from "zustand";

export type DebugLevel = "info" | "warn" | "error";
export type DebugCategory = "location" | "socket" | "api" | "incident" | "app";

export interface DebugEntry {
  id: number;
  at: number; // epoch ms
  level: DebugLevel;
  category: DebugCategory;
  message: string;
  detail?: string;
}

const MAX_ENTRIES = 250;

interface DebugLogState {
  entries: DebugEntry[];
  clear: () => void;
}

let seq = 0;

export const useDebugLog = create<DebugLogState>((set) => ({
  entries: [],
  clear: () => set({ entries: [] }),
}));

/**
 * Append a structured entry to the in-memory debug ring buffer. Safe to call
 * from anywhere (background task, socket handlers, API client) — it never throws.
 */
export function debugLog(
  category: DebugCategory,
  level: DebugLevel,
  message: string,
  detail?: unknown,
): void {
  try {
    const entry: DebugEntry = {
      id: ++seq,
      at: Date.now(),
      level,
      category,
      message,
      detail:
        detail === undefined
          ? undefined
          : typeof detail === "string"
            ? detail
            : safeStringify(detail),
    };
    const next = [entry, ...useDebugLog.getState().entries].slice(0, MAX_ENTRIES);
    useDebugLog.setState({ entries: next });
  } catch {
    // never let logging break the app
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Expand an error into a structured, log-friendly object: name, message, native
 * error code, a trimmed JS stack, any native Android stack/extra fields, and the
 * full nested `cause` chain. `String(err)` only surfaces the top message — this
 * is what to pass to debugLog when you actually need to diagnose a failure
 * (e.g. the expo-location background-task NPE, whose useful detail lives in the
 * native stack and the cause chain).
 */
export function describeError(err: unknown, depth = 0): unknown {
  if (err == null || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown> & { stack?: unknown; cause?: unknown };
  const out: Record<string, unknown> = {};
  if (typeof e.name === "string") out.name = e.name;
  if (typeof e.message === "string") out.message = e.message;
  if (e.code != null) out.code = e.code; // expo NativeModule / JS error codes
  if (e.stack != null) out.stack = String(e.stack).split("\n").slice(0, 16).join("\n");
  // Fields expo/react-native attach to native exceptions.
  for (const k of ["userInfo", "domain", "nativeStackAndroid", "nativeStackIOS"]) {
    if (e[k] != null) out[k] = e[k];
  }
  // Recurse the cause chain (the actual root, e.g. the SharedPreferences NPE).
  if (e.cause != null && depth < 4) out.cause = describeError(e.cause, depth + 1);
  return Object.keys(out).length ? out : String(err);
}
