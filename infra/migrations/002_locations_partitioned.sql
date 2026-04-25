CREATE TABLE IF NOT EXISTS locations (
  id BIGSERIAL NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  accuracy_meters DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'mobile',
  position GEOMETRY(POINT, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS locations_default PARTITION OF locations DEFAULT;

CREATE INDEX IF NOT EXISTS idx_locations_event_user_time ON locations (event_id, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_event_time ON locations (event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_locations_geo ON locations USING GIST (position);

CREATE OR REPLACE FUNCTION create_monthly_locations_partition(target_month DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  partition_name TEXT := 'locations_' || to_char(target_month, 'YYYY_MM');
  start_ts TIMESTAMPTZ := date_trunc('month', target_month)::timestamptz;
  end_ts TIMESTAMPTZ := (date_trunc('month', target_month) + INTERVAL '1 month')::timestamptz;
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF locations FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_ts, end_ts
  );
END;
$$;

SELECT create_monthly_locations_partition(CURRENT_DATE);
SELECT create_monthly_locations_partition((CURRENT_DATE + INTERVAL '1 month')::date);
