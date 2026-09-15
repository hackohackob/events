import { create } from "zustand";
import type { EventPlan, PlanMedic } from "@events/contracts";
import { EMPTY_EVENT_PLAN } from "@events/contracts";
import { useSessionStore } from "../security/session-store";
import { debugLog } from "../debug/debug-log";
import { fetchPlan, fetchPlanTracks, savePlan, type PlanTrack } from "./plan-api";
import { syncPlanNotifications } from "./plan-notifications";

/**
 * The pages behind the planner. "timeline" is the screen itself — map on top,
 * transport at the bottom; everything else is a page you open from it, because
 * a briefing is something you read, not something you steer.
 */
export type PlanPage = "timeline" | "my-plan" | "team" | "courses";

export type PlanSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface PlanState {
  open: boolean;
  page: PlanPage;

  plan: EventPlan | null;
  tracks: PlanTrack[];
  loading: boolean;
  error: string | null;
  /** Set when the server refuses the plan to this role. */
  forbidden: boolean;

  /** Scrub position. `null` means "follow the wall clock". */
  cursorMs: number | null;
  editing: boolean;
  selectedMedicId: string | null;

  saveState: PlanSaveState;

  load: (options?: { force?: boolean }) => Promise<void>;
  openPlanner: (page?: PlanPage) => void;
  closePlanner: () => void;
  setPage: (page: PlanPage) => void;
  setCursor: (ms: number | null) => void;
  setEditing: (editing: boolean) => void;
  selectMedic: (planMedicId: string | null) => void;
  mutate: (updater: (current: EventPlan) => EventPlan) => void;
  saveNow: () => Promise<void>;
  reset: () => void;
}

/** Autosave debounce. Long enough that dragging a station doesn't fire a PUT
 *  per frame, short enough that nobody locks the phone on an unsaved edit. */
const SAVE_DEBOUNCE_MS = 1200;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** The event the loaded document belongs to — guards against a plan surviving
 *  a switch to another event. */
let loadedFor: string | null = null;

export const usePlanStore = create<PlanState>((set, get) => ({
  open: false,
  page: "timeline",
  plan: null,
  tracks: [],
  loading: false,
  error: null,
  forbidden: false,
  cursorMs: null,
  editing: false,
  selectedMedicId: null,
  saveState: "idle",

  load: async (options = {}) => {
    const eventId = useSessionStore.getState().eventId;
    if (!eventId) return;
    if (!options.force && loadedFor === eventId && get().plan) return;
    set({ loading: true, error: null });
    try {
      const [plan, tracks] = await Promise.all([
        fetchPlan(eventId),
        fetchPlanTracks().catch(() => [] as PlanTrack[]),
      ]);
      loadedFor = eventId;
      set({
        plan: { ...EMPTY_EVENT_PLAN, ...plan },
        tracks,
        loading: false,
        forbidden: false,
        saveState: "idle",
      });
      void syncPlanNotifications();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      debugLog("api", "error", "plan load failed", String(err));
      set({
        loading: false,
        forbidden: status === 403,
        error: status === 403 ? "The plan is not shared with this role." : "Could not load the plan.",
      });
    }
  },

  openPlanner: (page = "timeline") => {
    set({ open: true, page });
    // Re-read on open unless there are edits waiting to go up. Saving is
    // last-write-wins, so the narrower the gap between reading the plan and
    // editing it, the less chance a phone overwrites something the desk did
    // while the app was in a pocket.
    void get().load({ force: get().saveState !== "dirty" });
  },

  closePlanner: () => set({ open: false, editing: false, page: "timeline" }),
  setPage: (page) => set({ page }),
  setCursor: (ms) => set({ cursorMs: ms }),
  setEditing: (editing) => set({ editing }),
  selectMedic: (planMedicId) => set({ selectedMedicId: planMedicId }),

  mutate: (updater) => {
    const current = get().plan;
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    set({ plan: next, saveState: "dirty" });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), SAVE_DEBOUNCE_MS);
  },

  saveNow: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const { plan, saveState } = get();
    const eventId = useSessionStore.getState().eventId;
    if (!plan || !eventId || saveState === "saving") return;
    set({ saveState: "saving" });
    try {
      const saved = await savePlan(eventId, { ...plan, updatedAt: new Date().toISOString() });
      // Only the server's answer is kept, so a field the phone doesn't know
      // about can't be dropped by a round trip through this screen.
      set({ plan: { ...EMPTY_EVENT_PLAN, ...saved }, saveState: "saved" });
      void syncPlanNotifications();
    } catch (err) {
      debugLog("api", "error", "plan save failed", String(err));
      set({ saveState: "error" });
    }
  },

  reset: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    loadedFor = null;
    set({
      open: false,
      page: "timeline",
      plan: null,
      tracks: [],
      loading: false,
      error: null,
      forbidden: false,
      cursorMs: null,
      editing: false,
      selectedMedicId: null,
      saveState: "idle",
    });
  },
}));

/** The plan row that belongs to the signed-in medic, if the desk put them on it. */
export function myPlanMedic(plan: EventPlan | null, userId: string | null): PlanMedic | null {
  if (!plan || !userId) return null;
  return plan.medics.find((m) => m.medicId === userId && !m.hidden) ?? null;
}
