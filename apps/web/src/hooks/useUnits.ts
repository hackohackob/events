import { useQuery } from "@tanstack/react-query";
import { fetchUnits } from "../api/units";

export function useUnits() {
  return useQuery(["units"], fetchUnits, { staleTime: 1000 * 30 });
}
