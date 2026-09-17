-- ─── Signal coverage survey ──────────────────────────────────────────────────
--
-- Radio conditions sampled at every medic location report, across every event.
-- Read back as an aggregated grid (see coverage.service.ts), never row by row.
--
-- Design notes, and where they differ from medic_location_history (006):
--  * Same monthly RANGE partitioning and the same "history is permanent" rule.
--  * The trail table is always read as (event_id, medic_id, time) — its primary
--    key serves every query. This one is read the opposite way: a bbox over a
--    time range across ALL events and medics. So the PK still de-duplicates,
--    but a separate (recorded_at, lat, lng) index is what the grid query runs
--    on. Partition pruning handles the time half; the index handles the box.
--  * `bars` is the derived 0–4 quality score, not vendor bars. `rssi` is true
--    dBm and stays NULL until a native probe exists — the column is here so
--    that build is a code change and not a migration.
--  * Nullable everywhere except position and time: an old app build reports a
--    location with no radio snapshot at all, and that row is still worth
--    keeping (it proves a phone was there and online enough to report).
CREATE TABLE IF NOT EXISTS medic_signal_history (
  event_id     TEXT NOT NULL,
  medic_id     TEXT NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  bars         SMALLINT,
  rssi         SMALLINT,
  network_type TEXT,
  generation   TEXT,
  carrier      TEXT,
  latency_ms   INTEGER,
  PRIMARY KEY (event_id, medic_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS medic_signal_history_default
  PARTITION OF medic_signal_history DEFAULT;

-- The grid query's access path: time first (also the partition key, so this
-- stays selective inside each month), then the bounding box.
CREATE INDEX IF NOT EXISTS medic_signal_history_geo_idx
  ON medic_signal_history (recorded_at, lat, lng);

CREATE OR REPLACE FUNCTION create_monthly_medic_signal_partition(target_month DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  partition_name TEXT := 'medic_signal_history_' || to_char(target_month, 'YYYY_MM');
  start_ts TIMESTAMPTZ := date_trunc('month', target_month)::timestamptz;
  end_ts   TIMESTAMPTZ := (date_trunc('month', target_month) + INTERVAL '1 month')::timestamptz;
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF medic_signal_history FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_ts, end_ts
  );
EXCEPTION
  -- A row already parked in DEFAULT for this range blocks the attach. Leave it
  -- there rather than failing the migration.
  WHEN OTHERS THEN
    RAISE NOTICE 'skipped partition %: %', partition_name, SQLERRM;
END;
$$;

SELECT create_monthly_medic_signal_partition(CURRENT_DATE);
SELECT create_monthly_medic_signal_partition((CURRENT_DATE + INTERVAL '1 month')::date);
