import { useQuery } from "@tanstack/react-query";
import { runnerSearch } from "../api/search";

export function useRunnerSearch(params: { eventId: string; name?: string; bibNumber?: string } | null) {
  return useQuery({
    queryKey: ["runners", params],
    queryFn: () => runnerSearch(params as any),
    enabled: !!params,
    staleTime: 1000 * 10,
  });
}
