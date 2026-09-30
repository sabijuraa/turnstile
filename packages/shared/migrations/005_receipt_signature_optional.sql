-- Indexer. A receipt restored from its account after the RPC node purged the transaction has no
-- known signature. The indexer fills it in if the transaction shows up again.
ALTER TABLE receipts ALTER COLUMN signature DROP NOT NULL;
