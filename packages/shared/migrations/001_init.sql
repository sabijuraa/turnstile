-- Indexer state
CREATE TABLE IF NOT EXISTS receipts (
  receipt_address   TEXT PRIMARY KEY,
  signature         TEXT NOT NULL,
  slot              BIGINT NOT NULL,
  block_time        TIMESTAMPTZ NOT NULL,
  agent_wallet      TEXT NOT NULL,
  owner             TEXT NOT NULL,
  session_key       TEXT NOT NULL,
  recipient         TEXT NOT NULL,
  recipient_token   TEXT NOT NULL,
  mint              TEXT NOT NULL,
  amount            NUMERIC(20, 0) NOT NULL CHECK (amount > 0),
  resource_id       TEXT NOT NULL,
  resource          TEXT,
  nonce             TEXT NOT NULL,
  fee_payer         TEXT NOT NULL,
  network           TEXT NOT NULL,
  indexed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_wallet, nonce)
);
CREATE INDEX IF NOT EXISTS receipts_owner_time ON receipts (owner, block_time DESC);
CREATE INDEX IF NOT EXISTS receipts_wallet_time ON receipts (agent_wallet, block_time DESC);
CREATE INDEX IF NOT EXISTS receipts_resource ON receipts (resource_id);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  stream          TEXT PRIMARY KEY,
  last_signature  TEXT,
  last_slot       BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resource strings seen by the facilitator, so receipts can show a readable resource.
CREATE TABLE IF NOT EXISTS resources (
  resource_id  TEXT PRIMARY KEY,
  resource     TEXT NOT NULL,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Facilitator dead letters
CREATE TABLE IF NOT EXISTS settlement_dead_letters (
  id              BIGSERIAL PRIMARY KEY,
  agent_wallet    TEXT NOT NULL,
  nonce           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  requirements    JSONB NOT NULL,
  error           TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replayed', 'abandoned')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_wallet, nonce)
);

-- Console backend
CREATE TABLE IF NOT EXISTS owners (
  pubkey       TEXT PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce       TEXT PRIMARY KEY,
  pubkey      TEXT NOT NULL,
  message     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS console_sessions (
  token_hash  TEXT PRIMARY KEY,
  owner       TEXT NOT NULL REFERENCES owners (pubkey),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL REFERENCES owners (pubkey),
  name        TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_owner ON api_keys (owner);

-- Agent wallets registered through the console, for labels only. The chain holds the state.
CREATE TABLE IF NOT EXISTS agent_labels (
  agent_wallet TEXT PRIMARY KEY,
  owner        TEXT NOT NULL REFERENCES owners (pubkey),
  label        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
