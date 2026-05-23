import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listIncidents, createIncident, actionIncident, assignIncident } from "../api/incidents";
import type { CreateIncidentRequest, IncidentActionRequest } from "@events/contracts";

export function useIncidents() {
  return useQuery({
    queryKey: ["incidents"],
    queryFn: listIncidents,
    staleTime: 1000 * 10,
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateIncidentRequest) => createIncident(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
}

export function useIncidentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: IncidentActionRequest }) => actionIncident(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
}

export function useAssignIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paramedicId }: { id: string; paramedicId: string }) => assignIncident(id, paramedicId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
}
