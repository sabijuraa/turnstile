-- Console backend query support. Receipts sorted by amount, challenge cleanup and session lookups.
CREATE INDEX IF NOT EXISTS receipts_owner_amount ON receipts (owner, amount DESC, receipt_address DESC);
CREATE INDEX IF NOT EXISTS receipts_owner_time_address ON receipts (owner, block_time DESC, receipt_address DESC);
CREATE INDEX IF NOT EXISTS auth_challenges_expires ON auth_challenges (expires_at);
CREATE INDEX IF NOT EXISTS console_sessions_owner ON console_sessions (owner);
CREATE INDEX IF NOT EXISTS agent_labels_owner ON agent_labels (owner);
CREATE INDEX IF NOT EXISTS dead_letters_pending_wallet ON settlement_dead_letters (agent_wallet) WHERE status = 'pending';
