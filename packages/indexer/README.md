# @turnstile/indexer

Follows settlement receipts from the chain into Postgres. It reads every transaction of the settlement program, decodes the `PaymentSettled` events, checks them against the receipt accounts and writes them to the `receipts` table. A checkpoint in `indexer_checkpoints` records how far it got. Receipts and checkpoint are written in one database transaction, so a crash at any point leaves no gap and no duplicate. See [ADR 0004](../../docs/adr/0004-indexer-checkpoint.md) for the design.

## Run

The indexer needs Postgres and a Solana RPC node with the Turnstile programs loaded. It runs the migrations on start.

```sh
pnpm --filter @turnstile/indexer build
DATABASE_URL=postgres://turnstile:turnstile@127.0.0.1:5433/turnstile \
SOLANA_RPC_URL=http://127.0.0.1:8899 \
TURNSTILE_NETWORK=localnet \
DEPLOYMENT_FILE=deployments/localnet.json \
pnpm --filter @turnstile/indexer start
```

In the compose stack it runs as the `indexer` service on port 4023.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | required | Postgres connection string. |
| `TURNSTILE_NETWORK` | `localnet` | `localnet` or `devnet`. Sets the `network` column, written as the CAIP-2 id such as `solana:localnet`. |
| `SOLANA_RPC_URL` | the network default | RPC node to read from. |
| `DEPLOYMENT_FILE` | unset | Deployment record. When set, `programs.settlement` from it is the program to follow. Otherwise the id from `@turnstile/shared`. |
| `PORT` | `4023` | Port for health, readiness and metrics. |
| `LOG_LEVEL` | `info` | pino log level. |
| `INDEXER_STREAM` | `settlement:<network>` | Checkpoint row name. Use different names to run separate streams. |
| `INDEXER_START_SLOT` | `0` | Slot to start from when the stream has no checkpoint yet. Older history is ignored. |
| `INDEXER_POLL_MS` | `1000` | Wait between ticks once caught up. A backlog is processed without waiting. |
| `INDEXER_BATCH` | `200` | Signatures per `getSignaturesForAddress` page and the most transactions handled in one tick. 1 to 1000. |
| `INDEXER_MAX_BACKOFF_MS` | `30000` | Longest wait between retries after RPC or database errors. |
| `INDEXER_READY_STALE_MS` | the larger of 30 s, 10 polls and 2 max backoffs | Readiness fails when the last successful tick is older than this. |

## Endpoints

- `GET /healthz` answers while the process is up.
- `GET /readyz` answers 200 once a tick has succeeded and the last success is recent, and Postgres answers. Otherwise 503 with the reason, the checkpoint, the lag and the failure count.
- `GET /metrics` is Prometheus text. The main series are `turnstile_indexer_receipts_indexed_total`, `turnstile_indexer_ticks_total{outcome}`, `turnstile_indexer_tick_errors_total{kind}`, `turnstile_indexer_lag_slots`, `turnstile_indexer_tick_duration_seconds`, `turnstile_indexer_checkpoint_slot`, `turnstile_indexer_slot_resumes_total` and `turnstile_indexer_ledger_resets_total`.

## How a tick works

1. Read the checkpoint. Compare its genesis hash with the node's. A different hash means the local validator was reset, so the stream starts over (see below).
2. Page `getSignaturesForAddress` for the settlement program backwards from the newest signature until the checkpoint signature. Nothing older than the checkpoint slot is taken.
3. Keep the oldest `INDEXER_BATCH` signatures and walk them oldest first. Failed transactions are skipped. Each other one is fetched at `confirmed` and every `PaymentSettled` event in it is decoded.
4. Check each receipt. The address must be the PDA of its wallet and nonce, and every field must match the receipt account.
5. In one database transaction, insert the receipts with `ON CONFLICT (receipt_address) DO NOTHING` and move the checkpoint to the newest processed signature.

`createIndexer(deps).tick()` does exactly one of these and returns what it did, so it can run from a scheduler as well as from the service loop.

## Recover

The indexer recovers on its own in these cases. Each is logged.

- **Crash or kill.** Restart it. It resumes from the checkpoint. A batch that was not committed is replayed. A committed one is not.
- **RPC errors.** The tick writes nothing and the loop retries with backoff up to `INDEXER_MAX_BACKOFF_MS`. Readiness turns 503 once the last success is older than `INDEXER_READY_STALE_MS`, and `turnstile_indexer_tick_errors_total{kind="rpc"}` rises.
- **Checkpoint signature unknown to the node**, for example after the node pruned history or you switched to another node. The tick resumes by slot. It takes every signature at or above the checkpoint slot again, and rows already stored are skipped. `turnstile_indexer_slot_resumes_total` counts it. Receipts in slots the node can no longer serve are lost to that node, so point it at a node with full history if that matters.
- **Local validator reset.** The genesis hash no longer matches. The indexer logs `LEDGER RESET DETECTED` at error level, deletes this network's receipts from the old ledger, rewinds the stream to `INDEXER_START_SLOT` and indexes the new ledger. `turnstile_indexer_ledger_resets_total` counts it.

Two cases stop progress on purpose and keep readiness at 503 until someone acts.

- **Integrity error.** An event disagrees with its receipt account or its PDA. Nothing is written. Check that `DEPLOYMENT_FILE` and `SOLANA_RPC_URL` point at the same cluster and the right settlement program.
- **Checkpoint conflict.** Another process moved the checkpoint of the same stream. The batch is dropped and the next tick starts from the new checkpoint. Running two indexers on one stream is safe but wasteful. Give each its own `INDEXER_STREAM` or run one.

## Re-index a stream

Re-indexing is safe at any time because inserts skip rows that exist.

Rebuild everything for a stream from its start slot.

```sh
psql "$DATABASE_URL" -c "DELETE FROM indexer_checkpoints WHERE stream = 'settlement:localnet'"
```

The next tick recreates the checkpoint and walks the whole history again. Existing receipts stay and are not duplicated.

To also rebuild the rows themselves, for example after a decoder fix, stop the indexer and delete them first.

```sh
psql "$DATABASE_URL" <<'SQL'
BEGIN;
DELETE FROM receipts WHERE network = 'solana:localnet';
DELETE FROM indexer_checkpoints WHERE stream = 'settlement:localnet';
COMMIT;
SQL
```

To re-index from a given slot, set `INDEXER_START_SLOT` and delete the checkpoint row, or move it back.

```sh
psql "$DATABASE_URL" -c "UPDATE indexer_checkpoints SET last_signature = NULL, last_slot = 123456 WHERE stream = 'settlement:localnet'"
```

## Tests

Unit tests run against a real Postgres with an in-memory ledger in place of the RPC node. They use `TEST_DATABASE_URL` or by default `postgres://turnstile_indexer_test:turnstile_indexer_test@127.0.0.1:5432/turnstile_indexer_test`. Create it once on the host.

```sh
sudo -u postgres psql -c "CREATE ROLE turnstile_indexer_test LOGIN PASSWORD 'turnstile_indexer_test'"
sudo -u postgres psql -c "CREATE DATABASE turnstile_indexer_test OWNER turnstile_indexer_test"
pnpm --filter @turnstile/indexer test
```

### Integration test against a real validator

`test/integration/validator.test.ts` starts `solana-test-validator` with the programs from `target/deploy` on port 8999 (set `IT_RPC_PORT` to change it). It creates the database `turnstile_indexer_it` on the compose Postgres at 5433 and lands real settlements with the shared client, some of them failed on purpose. It runs `dist/main.js` as a separate process, kills it with SIGKILL while settlements keep landing, and restarts it. Then it checks that the receipts table matches the receipt accounts on chain in count and in every field. A second case restarts the validator on a new ledger and checks that the stream starts over.

```sh
anchor build   # or cargo build-sbf, so target/deploy holds agent_wallet.so and settlement.so
pnpm --filter @turnstile/shared build
pnpm --filter @turnstile/indexer build
pnpm --filter @turnstile/indexer test:integration
```

Set `IT_KEEP=1` to keep the ledgers and the indexer logs in the temp directory it prints.
