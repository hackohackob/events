import { create } from "zustand";

/** Unread badge count for the Team chat tab. Bumped by a global socket listener
 *  in MapScreen while the chat tab isn't open; reset when it is opened. */
interface EventChatState {
  unread: number;
  bump: () => void;
  reset: () => void;
}

export const useEventChatStore = create<EventChatState>((set) => ({
  unread: 0,
  bump: () => set((s) => ({ unread: Math.min(99, s.unread + 1) })),
  reset: () => set({ unread: 0 }),
}));
