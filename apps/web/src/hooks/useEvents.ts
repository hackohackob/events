import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEvent, fetchEvents, fetchTracks, type CreateEventPayload } from "../api/events";

export function useEvents() {
  return useQuery(["events"], fetchEvents, { staleTime: 1000 * 30 });
}

export function useTracks() {
  return useQuery(["tracks"], fetchTracks, { staleTime: 1000 * 60 * 5 });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation((payload: CreateEventPayload) => createEvent(payload), {
    onSuccess: () => qc.invalidateQueries(["events"]),
  });
}
