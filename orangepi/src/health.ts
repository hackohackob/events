import { readFileSync } from "node:fs";
import { loadavg, uptime } from "node:os";
import { run } from "./util";
import { STATE_DIR } from "./config";
import type { HealthState } from "./types";

/**
 * Vitals for the console's header and the server's heartbeat. Every reading is
 * optional: a board without a thermal zone, or a `df` that fails, should show a
 * blank tile rather than take the report down.
 */

let cachedDiskMb: number | undefined;
let diskCheckedAt = 0;

export async function readHealth(queued: number): Promise<HealthState> {
  return {
    uptimeS: Math.round(uptime()),
    cpuTempC: readCpuTemp(),
    loadAvg: Number(loadavg()[0]?.toFixed(2)) || undefined,
    diskFreeMb: await readDiskFree(),
    queued,
  };
}

function readCpuTemp(): number | undefined {
  for (const path of [
    "/sys/class/thermal/thermal_zone0/temp",
    "/sys/devices/virtual/thermal/thermal_zone0/temp",
  ]) {
    try {
      const raw = Number(readFileSync(path, "utf8").trim());
      if (!Number.isFinite(raw)) continue;
      // Kernels report milli-degrees; some report whole degrees.
      return Math.round(raw > 1000 ? raw / 100 : raw * 10) / 10;
    } catch {
      // try the next path
    }
  }
  return undefined;
}

/** Spawning `df` every heartbeat is wasteful; a minute-old figure is fine. */
async function readDiskFree(): Promise<number | undefined> {
  if (Date.now() - diskCheckedAt < 60_000) return cachedDiskMb;
  diskCheckedAt = Date.now();
  const res = await run("df", ["-Pm", STATE_DIR], { timeoutMs: 5000 });
  if (res.code !== 0) return cachedDiskMb;
  const line = res.stdout.trim().split("\n")[1];
  const available = line?.trim().split(/\s+/)[3];
  cachedDiskMb = Number(available) || undefined;
  return cachedDiskMb;
}
