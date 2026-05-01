import { useQuery } from "@tanstack/react-query";
import { runnerSearch } from "../api/search";

export function useRunnerSearch(params: { eventId: string; name?: string; bibNumber?: string } | null) {
  return useQuery(["runners", params], () => runnerSearch(params as any), {
    enabled: !!params,
    staleTime: 1000 * 10,
  });
}
