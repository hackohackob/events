import { create } from "zustand";

interface NotificationFocusState {
  /** Incident the user tapped a notification for; the map focuses + opens it. */
  incidentId: string | null;
  /** Bumped each request so repeated taps on the same incident still trigger. */
  requestId: number;
  focusIncident: (incidentId: string) => void;
  clear: () => void;
}

export const useNotificationFocus = create<NotificationFocusState>((set) => ({
  incidentId: null,
  requestId: 0,
  focusIncident: (incidentId) => set((s) => ({ incidentId, requestId: s.requestId + 1 })),
  clear: () => set({ incidentId: null }),
}));
