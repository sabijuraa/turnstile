-- Indexer. Each checkpoint and receipt records the genesis hash of the ledger it came from.
-- A reset local validator has a new genesis hash, so the indexer can tell its old checkpoint
-- and its old receipts belong to a ledger that no longer exists.
ALTER TABLE indexer_checkpoints ADD COLUMN IF NOT EXISTS genesis_hash TEXT;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS genesis_hash TEXT;
CREATE INDEX IF NOT EXISTS receipts_network_genesis ON receipts (network, genesis_hash);
