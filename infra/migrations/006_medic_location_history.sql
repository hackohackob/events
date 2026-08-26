-- ─── Medic location history ("Trails") ──────────────────────────────────────
--
-- Permanent breadcrumb store for medic positions. Written by a batching buffer
-- (see trails.service.ts), never on the request path, and read back as a 12h
-- window per medic.
--
-- Design notes:
--  * RANGE-partitioned by month so the hot window always lives in one small
--    partition and old months can be DETACHED (never deleted — history is
--    permanent) without touching live traffic.
--  * The primary key IS the query index: every read filters
--    (event_id, medic_id, recorded_at >= …), so one btree serves both the
--    lookup and de-duplication. No secondary indexes — writes stay cheap.
--  * No foreign keys and no triggers: bulk inserts must not take extra locks.
--  * event_id/medic_id are TEXT to match medic_last_location (external guests
--    have slugged, non-UUID ids).
CREATE TABLE IF NOT EXISTS medic_location_history (
  event_id     TEXT NOT NULL,
  medic_id     TEXT NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  speed        REAL,
  heading      REAL,
  accuracy     REAL,
  battery      REAL,
  charging     BOOLEAN,
  PRIMARY KEY (event_id, medic_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Catch-all so an insert can never fail for want of a partition. The boot-time
-- maintenance in trails.service.ts keeps the current and next month present, so
-- in practice this stays empty.
CREATE TABLE IF NOT EXISTS medic_location_history_default
  PARTITION OF medic_location_history DEFAULT;

CREATE OR REPLACE FUNCTION create_monthly_medic_history_partition(target_month DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  partition_name TEXT := 'medic_location_history_' || to_char(target_month, 'YYYY_MM');
  start_ts TIMESTAMPTZ := date_trunc('month', target_month)::timestamptz;
  end_ts   TIMESTAMPTZ := (date_trunc('month', target_month) + INTERVAL '1 month')::timestamptz;
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF medic_location_history FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_ts, end_ts
  );
EXCEPTION
  -- A row already parked in the DEFAULT partition for this range blocks the
  -- attach. Leave it in default rather than failing the whole migration.
  WHEN OTHERS THEN
    RAISE NOTICE 'skipped partition %: %', partition_name, SQLERRM;
END;
$$;

SELECT create_monthly_medic_history_partition(CURRENT_DATE);
SELECT create_monthly_medic_history_partition((CURRENT_DATE + INTERVAL '1 month')::date);
