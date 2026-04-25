# Deployment Runbook

## Local
1. Copy env file:
   - `cp .env.example .env`
2. Start stack:
   - `docker compose up --build`
3. Verify:
   - `curl http://localhost:3000/health/live`
   - `curl http://localhost:3000/health/ready`

## Staging
1. Build and tag backend image:
   - `docker build -t events-backend:<tag> -f apps/backend/Dockerfile .`
2. Push image to your registry.
3. Deploy with env vars:
   - `DATABASE_URL`
   - `REDIS_URL`
   - `PORT=3000`
4. Run SQL migrations at deploy startup via container command (`migrate:sql`).
5. Attach health probes:
   - Liveness: `/health/live`
   - Readiness: `/health/ready`

## Production
1. Use immutable image tags and keep rollback tags available.
2. Run one-off migration job for each release before shifting traffic.
3. Roll out backend instances gradually.
4. Monitor:
   - 5xx rate
   - socket reconnect spikes
   - Redis memory/pubsub behavior
   - DB latency

## Operational Notes
- Socket namespace: `/realtime`
- Realtime rooms:
  - `event:{eventId}:map`
  - `event:{eventId}:incidents`
  - `event:{eventId}:ops`
- Incident and location events are propagated through Redis pub/sub.
