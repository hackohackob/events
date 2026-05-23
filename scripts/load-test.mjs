import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = process.env.LOAD_TEST_BASE_URL ?? "http://localhost:8500/api";
const eventId = process.env.LOAD_TEST_EVENT_ID ?? "event-demo";
const role = process.env.LOAD_TEST_ROLE ?? "runner";
const durationSeconds = Number(process.env.LOAD_TEST_DURATION_SECONDS ?? 30);
const virtualUsers = Number(process.env.LOAD_TEST_VUS ?? 50);
const updateIntervalMs = Number(process.env.LOAD_TEST_INTERVAL_MS ?? 5000);

const endAt = Date.now() + durationSeconds * 1000;

async function sendLocation(userIdx) {
  const lat = 42.6977 + Math.random() * 0.01;
  const lng = 23.3219 + Math.random() * 0.01;
  await fetch(`${baseUrl}/locations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": `vu_${userIdx}`,
      "x-event-id": eventId,
      "x-role": role,
    },
    body: JSON.stringify({
      lat,
      lng,
      timestamp: new Date().toISOString(),
      accuracy: 8 + Math.random() * 4,
    }),
  });
}

async function worker(userIdx) {
  while (Date.now() < endAt) {
    await sendLocation(userIdx);
    await sleep(updateIntervalMs);
  }
}

console.log(
  `Running load simulation: vus=${virtualUsers}, duration=${durationSeconds}s, interval=${updateIntervalMs}ms`,
);
await Promise.all(Array.from({ length: virtualUsers }, (_, idx) => worker(idx + 1)));
console.log("Load simulation complete.");
