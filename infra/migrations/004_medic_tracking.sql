-- Medic roster: pre-registered medics per event
CREATE TABLE IF NOT EXISTS event_medics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  unit        TEXT,
  vehicle     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);
CREATE INDEX IF NOT EXISTS idx_event_medics_event ON event_medics (event_id);

-- Live medic state: one row per medic, upserted on each location update
CREATE TABLE IF NOT EXISTS medic_last_location (
  medic_id      TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  heading       REAL,
  speed         REAL,
  accuracy      REAL,
  status        TEXT NOT NULL DEFAULT 'available',  -- available | going_to
  destination   JSONB,                              -- { lat, lng, label } or null
  recorded_at   TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, medic_id)
);

-- Participant last known location: one row per participant, upserted
CREATE TABLE IF NOT EXISTS participant_last_location (
  user_id       TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  bib_number    TEXT,
  phone         TEXT,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  accuracy      REAL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Sparse participant location history (max 1 row/min per participant)
CREATE TABLE IF NOT EXISTS participant_location_history (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  accuracy      REAL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_part_history_lookup ON participant_location_history (event_id, user_id, recorded_at DESC);
