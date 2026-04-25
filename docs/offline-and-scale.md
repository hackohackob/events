# Offline and Scale Strategy

## Offline Reliability
- Mobile uses in-memory retry queues for location and incident write operations.
- Retry policy uses exponential backoff capped at 30 seconds.
- UI returns user feedback when operations are queued.
- Queue flush is triggered when requests succeed again.

## Update Frequency Policy
- Paramedic updates: target 3-10 seconds.
- Runner updates: target 5-15 seconds.
- Server classifies freshness with thresholds:
  - `fresh`: <30s
  - `warning`: 30-120s
  - `stale`: 2-5min
  - `offline`: >5min

## Realtime Fanout
- Redis pub/sub channels:
  - `event:{eventId}:map`
  - `event:{eventId}:incidents`
  - `event:{eventId}:ops`
- Socket.IO gateway subscribes clients to role-scoped rooms.

## Load Validation
- Script: `npm run load:test`
- Environment knobs:
  - `LOAD_TEST_BASE_URL`
  - `LOAD_TEST_DURATION_SECONDS`
  - `LOAD_TEST_VUS`
  - `LOAD_TEST_INTERVAL_MS`
- Initial objective: simulate 2000 participants by gradually increasing `LOAD_TEST_VUS`.

## Observability Baseline
- Use `/health/live` for liveness and `/health/ready` for readiness probes.
- Capture:
  - request latency (via reverse proxy/APM)
  - socket disconnect/reconnect rates
  - Redis memory and pub/sub lag
  - crash/error rates
