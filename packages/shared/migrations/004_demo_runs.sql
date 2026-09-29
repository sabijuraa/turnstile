-- Live demo runs, owned by the demo agent runner. The chain holds the money. These rows hold
-- the story of each run so the demo page can replay it after a restart.
CREATE TABLE IF NOT EXISTS demo_runs (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL CHECK (status IN ('running', 'finished', 'failed')),
  agent_wallet  TEXT,
  wallet_id     NUMERIC(20, 0),
  owner         TEXT NOT NULL,
  network       TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS demo_runs_started ON demo_runs (started_at DESC);
-- At most one run is in progress at any time, even across restarts or several processes.
CREATE UNIQUE INDEX IF NOT EXISTS demo_runs_one_running ON demo_runs ((true)) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS demo_run_events (
  run_id      TEXT NOT NULL REFERENCES demo_runs (id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, seq)
);
