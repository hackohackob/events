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
