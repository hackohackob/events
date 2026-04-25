import { create } from "zustand";

interface Marker {
  id: string;
  type: "runner" | "paramedic" | "incident" | "infrastructure";
  label: string;
  lat: number;
  lng: number;
  staleState?: "fresh" | "warning" | "stale" | "offline";
  name?: string;
  bibNumber?: string;
  vehicle?: string;
  avatarUrl?: string;
  description?: string;
  respondingIncidentId?: string;
  respondingParamedicIds?: string[];
}

export interface RaceTrack {
  id: string;
  label: string;
  points: Array<{ lat: number; lng: number }>;
}

interface MapState {
  markers: Marker[];
  tracks: RaceTrack[];
  centerOnUserRequestId: number;
  resetNorthRequestId: number;
  setMarkers: (markers: Marker[]) => void;
  setTracks: (tracks: RaceTrack[]) => void;
  requestCenterOnUser: () => void;
  requestResetNorth: () => void;
}

export const useMapStore = create<MapState>((set) => ({
  markers: [],
  tracks: [],
  centerOnUserRequestId: 0,
  resetNorthRequestId: 0,
  setMarkers: (markers) => set({ markers }),
  setTracks: (tracks) => set({ tracks }),
  requestCenterOnUser: () => set((state) => ({ centerOnUserRequestId: state.centerOnUserRequestId + 1 })),
  requestResetNorth: () => set((state) => ({ resetNorthRequestId: state.resetNorthRequestId + 1 })),
}));
