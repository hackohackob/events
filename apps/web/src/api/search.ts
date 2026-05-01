import client from "./client";
import type { RunnerSearchQuery } from "@events/contracts";

export async function runnerSearch(query: RunnerSearchQuery) {
  const res = await client.get(`/search/runners`, { params: query });
  return res.data as any[];
}
