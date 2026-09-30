# ADR 0004. Indexer checkpoint in the same transaction as the receipts

Status. Accepted.

## Context

The indexer copies settlement receipts from the chain into Postgres so the console can query them. It must survive a crash at any point with no missing receipt and no receipt stored twice. It must also cope with an RPC node that fails, forgets old history, or belongs to a local validator that was reset. Later it should be able to run as a scheduled function and be split into several streams.

## Decision

The checkpoint is a row in `indexer_checkpoints` keyed by a stream name, `settlement:<network>` by default. It holds the newest fully processed signature, its slot and the genesis hash of the ledger.

- One tick is one bounded unit of work. It reads the checkpoint, pages `getSignaturesForAddress` for the settlement program backwards with `until` set to the checkpoint signature, and keeps at most `INDEXER_BATCH` of the oldest new signatures.
- It processes them oldest first. Failed transactions are skipped. Each successful transaction is fetched at `confirmed` and every `PaymentSettled` event in it is decoded.
- Each event is checked before it is written. The receipt address must be the PDA of its wallet and nonce, the event slot must be the transaction slot, and every field must match the receipt account when that account can be read.
- The receipts are inserted with `ON CONFLICT (receipt_address) DO NOTHING` and the checkpoint is updated in the same database transaction. A crash before the commit leaves both untouched, so the batch is replayed. A crash after the commit leaves both written, so the next tick starts past them.
- The commit locks the checkpoint row and refuses the batch if the checkpoint moved since the tick read it. Two processes on one stream cannot interleave batches.
- A failed RPC call ends the tick with no write. The service retries with exponential backoff and reports the failure in readiness and metrics.
- If the node lists a signature but does not return its transaction yet, the tick commits what came before it and retries the rest next time. It never steps over it.

Resume rules.

- Checkpoint signature known to the node. Resume with `until`.
- Checkpoint signature unknown, for example after the node purged old ledger data. Resume by slot. The node can say so in two ways. `getSignatureStatuses` returns nothing, or it still answers from its status cache and `getSignaturesForAddress` then refuses the `until` with "not found". Both lead to a slot resume in the same tick. Every signature at or above the checkpoint slot is processed again and anything already stored is skipped by its receipt address.
- History gap. Whenever the tick has no signature to stop at, which is a first start, a slot resume or a reset, it asks the node for the first slot it still serves (the later of `getMinimumLedgerSlot` and `getFirstAvailableBlock`). If that is above the checkpoint slot, the node purged part of the history and `getSignaturesForAddress` cannot list it. solana-test-validator does this by default because its ledger is capped at 10,000 shreds. The tick then backfills. It reads every live receipt account with `getProgramAccounts` filtered on the Receipt discriminator, checks each PDA, writes those at or above the checkpoint slot with a null signature and moves the checkpoint to the first served slot. All of that is one transaction. The normal walk then continues and fills in the signature of any restored row whose transaction it still sees. The gap is logged at error level as `HISTORY GAP` and counted in `turnstile_indexer_history_gaps_total`, `turnstile_indexer_history_gap_slots_total` and `turnstile_indexer_receipts_backfilled_total`.
- Genesis hash changed. The local validator was reset and the old checkpoint and its receipts describe a ledger that no longer exists. The indexer deletes that network's receipts from other ledgers, rewinds the stream to its start slot and logs it at error level.

## Consequences

- No receipt is ever stored without its checkpoint, and the other way round. Re-running any range is safe.
- The same `tick()` can run in the service loop or from a scheduler with no in-memory state to carry over.
- A backlog is walked page by page on each tick, so catching up on a very long history costs extra `getSignaturesForAddress` calls. The batch size bounds the work done per tick.
- `confirmed` is not `finalized`. A confirmed block that is later dropped would leave its receipts in Postgres. On a local validator this does not happen. On a public cluster it is very rare. Switching the fetches to `finalized` removes the risk at the cost of about 13 seconds of extra lag.
- A receipt restored by a backfill has no transaction signature, so `receipts.signature` is nullable (migration 005). Readers must handle a null signature.
- A receipt that was closed with `close_receipt` inside a purged range is gone from both the ledger and the account set and cannot be recovered. The gap metrics and the log show the slot range so an operator can judge it. Receipts are only closable 7 days after their authorization expires, so this needs a gap that old.
- Several streams can index the same program. They share the receipts table and never duplicate rows. Splitting one program's history by slot range across streams is possible with `INDEXER_START_SLOT` but is not automated.
