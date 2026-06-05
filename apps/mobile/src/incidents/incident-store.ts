import { create } from "zustand";

export type ReportPhase = "idle" | "submitting" | "success" | "details" | "offline";

export type IncidentType = "medical" | "cardiac" | "trauma" | "fracture" | "unconscious" | "other";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

/** Background creation status shown in the details sheet. */
export type CreationStatus = "creating" | "created" | "failed";

export interface NearbyParamedic {
  id: string;
  name: string;
  distanceMeters: number;
  vehicle?: string;
}

interface IncidentReportState {
  phase: ReportPhase;
  incidentId: string | null;
  incidentName: string | null;
  creationStatus: CreationStatus;
  lat: number | null;
  lng: number | null;
  incidentType: IncidentType | null;
  severity: IncidentSeverity | null;
  peopleAffected: number;
  description: string;
  photoUri: string | null;
  nearbyParamedics: NearbyParamedic[];
  isOnline: boolean;
  toastMessage: string | null;
  /** Bumped when an external trigger (e.g. notification button) requests a report. */
  reportRequestId: number;

  setPhase: (phase: ReportPhase) => void;
  requestReport: () => void;
  setIncidentId: (id: string) => void;
  setIncidentName: (name: string) => void;
  setCreationStatus: (status: CreationStatus) => void;
  setLocation: (lat: number, lng: number) => void;
  setIncidentType: (type: IncidentType) => void;
  setSeverity: (severity: IncidentSeverity) => void;
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
  incidentName: null,
  creationStatus: "creating",
  lat: null,
  lng: null,
  incidentType: null,
  severity: null,
  peopleAffected: 1,
  description: "",
  photoUri: null,
  nearbyParamedics: [],
  isOnline: true,
  toastMessage: null,
  reportRequestId: 0,

  setPhase: (phase) => set({ phase }),
  requestReport: () => set((s) => ({ reportRequestId: s.reportRequestId + 1 })),
  setIncidentId: (incidentId) => set({ incidentId }),
  setIncidentName: (incidentName) => set({ incidentName }),
  setCreationStatus: (creationStatus) => set({ creationStatus }),
  setLocation: (lat, lng) => set({ lat, lng }),
  setIncidentType: (incidentType) => set({ incidentType }),
  setSeverity: (severity) => set({ severity }),
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
      incidentName: null,
      creationStatus: "creating",
      lat: null,
      lng: null,
      incidentType: null,
      severity: null,
      peopleAffected: 1,
      description: "",
      photoUri: null,
      nearbyParamedics: [],
    }),
}));
