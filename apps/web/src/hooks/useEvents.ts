import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEvent,
  fetchEvents,
  fetchEventById,
  activateEvent,
  deactivateEvent,
  fetchTracks,
} from "../api/events";
import type { EventFormData } from "@/lib/types";

export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: fetchEvents,
    staleTime: 1000 * 30,
  });
}

export function useTracks() {
  return useQuery({
    queryKey: ["tracks"],
    queryFn: fetchTracks,
    staleTime: 1000 * 60 * 5,
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ["events", id],
    queryFn: () => fetchEventById(id),
    staleTime: 1000 * 30,
    enabled: !!id,
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: EventFormData) => createEvent(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });
}

export function useActivateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => activateEvent(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["events", id] });
    },
  });
}

export function useDeactivateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateEvent(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["events", id] });
    },
  });
}
