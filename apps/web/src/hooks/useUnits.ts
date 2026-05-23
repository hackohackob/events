import { useQuery } from "@tanstack/react-query";
import { fetchUnits } from "../api/units";

export function useUnits() {
  return useQuery({
    queryKey: ["units"],
    queryFn: fetchUnits,
    staleTime: 1000 * 30,
  });
}
