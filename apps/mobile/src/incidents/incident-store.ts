import { create } from "zustand";

export type ReportPhase = "idle" | "submitting" | "success" | "details" | "offline";

export type IncidentType = "medical" | "cardiac" | "trauma" | "fracture" | "unconscious" | "other";

export interface NearbyParamedic {
  id: string;
  name: string;
  distanceMeters: number;
  vehicle?: string;
}

interface IncidentReportState {
  phase: ReportPhase;
  incidentId: string | null;
  lat: number | null;
  lng: number | null;
  incidentType: IncidentType | null;
  peopleAffected: number;
  description: string;
  photoUri: string | null;
  nearbyParamedics: NearbyParamedic[];
  isOnline: boolean;
  toastMessage: string | null;

  setPhase: (phase: ReportPhase) => void;
  setIncidentId: (id: string) => void;
  setLocation: (lat: number, lng: number) => void;
  setIncidentType: (type: IncidentType) => void;
  setPeopleAffected: (count: number) => void;
  setDescription: (text: string) => void;
  setPhotoUri: (uri: string | null) => void;
  setNearbyParamedics: (list: NearbyParamedic[]) => void;
  setOnline: (online: boolean) => void;
  showToast: (msg: string) => void;
  dismissToast: () => void;
  reset: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useIncidentStore = create<IncidentReportState>((set) => ({
  phase: "idle",
  incidentId: null,
  lat: null,
  lng: null,
  incidentType: null,
  peopleAffected: 1,
  description: "",
  photoUri: null,
  nearbyParamedics: [],
  isOnline: true,
  toastMessage: null,

  setPhase: (phase) => set({ phase }),
  setIncidentId: (incidentId) => set({ incidentId }),
  setLocation: (lat, lng) => set({ lat, lng }),
  setIncidentType: (incidentType) => set({ incidentType }),
  setPeopleAffected: (peopleAffected) => set({ peopleAffected }),
  setDescription: (description) => set({ description }),
  setPhotoUri: (photoUri) => set({ photoUri }),
  setNearbyParamedics: (nearbyParamedics) => set({ nearbyParamedics }),
  setOnline: (isOnline) => set({ isOnline }),

  showToast: (msg) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toastMessage: msg });
    toastTimer = setTimeout(() => {
      set({ toastMessage: null });
      toastTimer = null;
    }, 3500);
  },

  dismissToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ toastMessage: null });
  },

  reset: () =>
    set({
      phase: "idle",
      incidentId: null,
      lat: null,
      lng: null,
      incidentType: null,
      peopleAffected: 1,
      description: "",
      photoUri: null,
      nearbyParamedics: [],
    }),
}));
