-- ─── Location accuracy diagnostics ──────────────────────────────────────────
--
-- Sampled, human-readable log lines the medic app uploads when a fix comes in
-- vague, when it re-measures, and when someone presses "center on me". Not a
-- history: rows older than 14 days are swept (location-diagnostics.service).
CREATE TABLE IF NOT EXISTS location_diagnostics (
  id           BIGSERIAL PRIMARY KEY,
  event_id     TEXT NOT NULL,
  medic_id     TEXT NOT NULL,
  name         TEXT,
  platform     TEXT,
  app_version  TEXT,
  device       TEXT,
  at           TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind         TEXT NOT NULL,
  level        TEXT NOT NULL,
  message      TEXT NOT NULL,
  accuracy     REAL,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  data         JSONB
);
CREATE INDEX IF NOT EXISTS location_diagnostics_event_at ON location_diagnostics (event_id, at DESC);

-- Coordinator-tunable accuracy knobs. One global row; see LocationTuning in
-- @events/contracts for the fields.
CREATE TABLE IF NOT EXISTS location_tuning (
  scope       TEXT PRIMARY KEY,
  settings    JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
