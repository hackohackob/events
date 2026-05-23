-- Incidents (persistent, was in-memory)
CREATE TABLE IF NOT EXISTS incidents (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  type          TEXT NOT NULL DEFAULT 'other',
  description   TEXT NOT NULL DEFAULT '',
  severity      TEXT,
  photo_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responders    JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_incidents_event ON incidents (event_id, created_at DESC);

-- Push notification tokens
CREATE TABLE IF NOT EXISTS push_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  token      TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'expo',
  device_id  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id, token)
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_event ON push_tokens (event_id);

-- Checkpoints definition
CREATE TABLE IF NOT EXISTS checkpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL,
  discipline_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  km_marker     REAL,
  type          TEXT NOT NULL DEFAULT 'checkpoint',
  radius_meters REAL NOT NULL DEFAULT 50,
  sort_order    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_event ON checkpoints (event_id, discipline_id);

-- Checkpoint passages (who passed when)
CREATE TABLE IF NOT EXISTS checkpoint_passages (
  id            BIGSERIAL PRIMARY KEY,
  checkpoint_id UUID NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  passed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (checkpoint_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_passages_lookup ON checkpoint_passages (event_id, user_id);
