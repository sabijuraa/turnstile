# Runbook

How to run, test, deploy and recover Turnstile. Every command here exists in a `package.json` or in `infra/scripts`. Run them from the repository root unless a step says otherwise.

## Ports

Both local modes use the same host ports. Compose uses host networking, so they must be free.

| Service | Port | Health |
| --- | --- | --- |
| web | 3000 | `/` |
| facilitator | 4020 | `/healthz`, `/readyz`, `/metrics` |
| demo-api | 4021 | `/healthz`, `/readyz`, `/metrics` |
| backend | 4022 | `/healthz`, `/readyz`, `/metrics` |
| indexer | 4023 | `/healthz`, `/readyz`, `/metrics` |
| demo-agent | 4024 | `/healthz`, `/readyz`, `/metrics` |
| solana-test-validator | 8899 RPC, 8900 websocket, 9900 faucet, 18001 gossip, 18002 to 18040 dynamic | `solana cluster-version` |
| postgres | 5433 | `pg_isready` |

`POSTGRES_PORT`, `VALIDATOR_RPC_PORT` and `VALIDATOR_WS_PORT` move the chain and the database. The service ports are fixed in `infra/docker-compose.yml`.

## Run the stack locally

### Everything in Docker

```sh
pnpm install
pnpm stack:up
```

`infra/scripts/stack.sh up` builds the programs when `target/deploy` lacks them, builds every image and waits until each container is healthy (`STACK_WAIT_TIMEOUT`, default 600 seconds). The one-shot `bootstrap` container applies migrations, creates the keys in `keys/localnet`, creates the tUSDC mint and writes `deployments/localnet.json`.

| Command | Effect |
| --- | --- |
| `pnpm stack:up` | build and start, wait for healthy |
| `pnpm stack:down` | stop, keep the ledger and database volumes |
| `pnpm stack:down --volumes` | stop and delete the volumes |
| `bash infra/scripts/stack.sh logs <service>` | last 200 lines (`LOG_TAIL` changes it) |
| `bash infra/scripts/stack.sh ps` | container status |

When a pinned Agave 4.0.2 is installed on the host, the validator image is built from it (`infra/docker-compose.agave-local.yml`) instead of downloading the 218 MB release.

### Chain and database only, services from a shell

```sh
pnpm dev:up              # validator and postgres in docker
pnpm dev:up --native     # solana-test-validator on this machine, postgres in docker
pnpm dev:up --reset      # start the validator from a fresh ledger
```

`infra/scripts/dev-up.sh` starts Postgres and the validator, builds `@turnstile/shared`, runs migrations and the localnet bootstrap, then prints the variables to export. The native validator keeps its ledger in `target/localnet-ledger` and logs to `target/localnet-validator.log`.

Then build and start each service in its own shell with those variables exported. `pnpm --filter` runs a script inside the package folder, so file paths must be absolute. The exported `KEYS_DIR` and `DEPLOYMENT_FILE` already are.

```sh
pnpm build

FACILITATOR_KEYPAIR="$KEYS_DIR/facilitator.json" pnpm --filter @turnstile/facilitator start
pnpm --filter @turnstile/indexer start
WEB_ORIGIN=http://localhost:3000 pnpm --filter @turnstile/backend start
DEMO_API_PUBLIC_URL=http://127.0.0.1:4021 pnpm --filter @turnstile/demo-api start
DEMO_OWNER_KEYPAIR="$KEYS_DIR/demo-owner.json" DEMO_SESSION_KEYPAIR="$KEYS_DIR/demo-session.json" \
  pnpm --filter @turnstile/demo-api start:agent
TURNSTILE_BACKEND_URL=http://127.0.0.1:4022 TURNSTILE_DEMO_AGENT_URL=http://127.0.0.1:4024 \
  FACILITATOR_URL=http://127.0.0.1:4020 pnpm --filter @turnstile/web dev
```

`pnpm --filter <pkg> dev` runs a service from source with `tsx`. Each package README lists every variable.

## Build the programs

Build each program on its own crate.

```sh
cargo build-sbf --manifest-path programs/agent-wallet/Cargo.toml --sbf-out-dir target/deploy
cargo build-sbf --manifest-path programs/settlement/Cargo.toml --sbf-out-dir target/deploy
ls -l target/deploy/*.so
```

Why per crate.

- `settlement` depends on `agent_wallet` with its `cpi` feature.
- A workspace wide build (`anchor build` or `cargo build-sbf` at the root) unifies features, so `agent_wallet` is built with `cpi` on.
- That produces an `agent_wallet.so` of a few hundred bytes that the loader rejects.
- `infra/scripts/lib.sh` and CI refuse any `.so` of 16384 bytes or less for this reason.

After a change to the program interface, sync the IDLs into the shared package with `pnpm --filter @turnstile/shared sync-idl`.

## Run the tests

| Layer | Command | Needs |
| --- | --- | --- |
| Programs (LiteSVM) | `cargo test -p settlement -p agent-wallet` | `target/deploy/*.so` |
| Unit tests | `pnpm build` then `pnpm -r --filter '!@turnstile/e2e' run test` | Postgres on 5433 (`pnpm dev:up`) |
| One package | `pnpm --filter @turnstile/facilitator test` | same |
| Resource SDK on a validator | `TURNSTILE_INTEGRATION=1 pnpm --filter @turnstile/sdk-resource test` | Agave, built programs |
| Agent SDK on a validator | `TURNSTILE_INTEGRATION=1 pnpm --filter @turnstile/sdk-agent test` | same |
| Demo run on a validator | `TURNSTILE_INTEGRATION=1 pnpm --filter @turnstile/demo-api test` | same |
| Indexer crash and reset | `pnpm --filter @turnstile/indexer test:integration` | same, plus built `@turnstile/shared` and indexer |
| Program client on a validator | `TURNSTILE_TEST_RPC_URL=http://127.0.0.1:8899 pnpm --filter @turnstile/shared test` | a running validator with the programs |
| Backend chain operations | `pnpm --filter @turnstile/backend test` | runs on its own validator on port 47899, skips with a reason when Agave or the programs are missing |
| End to end, full | `pnpm e2e` | Docker |
| End to end, infra | `E2E_STACK=infra pnpm e2e` | Docker for validator and Postgres only |
| End to end, running stack | `E2E_STACK=running pnpm e2e` | a stack from `pnpm stack:up`, left running |
| Web unit tests | `pnpm --filter @turnstile/web test` | nothing |
| Web contrast | `pnpm --filter @turnstile/web contrast` | nothing |
| Web browser audit | `pnpm --filter @turnstile/web e2e` | a running web app, Playwright Chromium |

Test databases follow one rule. Each package creates and uses `turnstile_<pkg>_test` on the server in `TEST_DATABASE_ADMIN_URL`, which defaults to `postgres://turnstile:turnstile@127.0.0.1:5433/postgres`. The backend, indexer, facilitator and sdk-resource READMEs still describe an older `TEST_DATABASE_URL` on port 5432.

`pnpm e2e` runs `infra/scripts/e2e.sh`. It stops only the containers it started. `E2E_KEEP_STACK=1` leaves them running. On failure service logs land in `target/e2e-logs`, and the suite writes results to `packages/e2e/results`. Root `pnpm test` includes the e2e package, so it fails without a running stack.

Other browser checks in `apps/web/e2e` run with `node` from `apps/web` against a started server. Set `E2E_BASE_URL` for each. `demo.mjs` needs a demo agent. `console.mjs` needs the backend, a validator, `DEPLOYMENT_FILE`, `KEYS_DIR` and `DEMO_API_URL`, and `console-audit.mjs` reads its output.

## Deploy the programs to devnet

Not yet executed. The deployer `Ez15MJVD5PGMVgHDHVXx29fSiHhnS7aUSVXFp49ZhM8J` has no devnet SOL. See BLOCKERS.md.

Keys used.

- `keys/devnet/deployer.json` pays for the deploy and becomes the upgrade authority.
- `keys/agent_wallet-keypair.json` and `keys/settlement-keypair.json` fix the program ids to the ones compiled into the programs.

1. Fund the deployer with about 8 devnet SOL and check it.

```sh
solana-keygen pubkey keys/devnet/deployer.json
solana balance --url devnet --keypair keys/devnet/deployer.json
```

2. Build both programs per crate as above.

3. Deploy with the fixed program ids.

```sh
solana program deploy target/deploy/agent_wallet.so \
  --url devnet --keypair keys/devnet/deployer.json \
  --program-id keys/agent_wallet-keypair.json
solana program deploy target/deploy/settlement.so \
  --url devnet --keypair keys/devnet/deployer.json \
  --program-id keys/settlement-keypair.json
solana program show 7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb --url devnet
solana program show 6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z --url devnet
```

4. Bootstrap the devnet mint and the facilitator. The localnet bootstrap only handles localnet, so this is done with the Solana CLI.

```sh
mkdir -p keys/devnet && chmod 700 keys/devnet
for k in facilitator mint-authority demo-owner demo-session demo-recipient; do
  solana-keygen new --no-bip39-passphrase --silent --outfile keys/devnet/$k.json
done
solana-keygen new --no-bip39-passphrase --silent --outfile keys/devnet/tusdc-mint.json

# fees for the facilitator and the demo owner
solana transfer --url devnet --keypair keys/devnet/deployer.json --allow-unfunded-recipient \
  "$(solana-keygen pubkey keys/devnet/facilitator.json)" 1
solana transfer --url devnet --keypair keys/devnet/deployer.json --allow-unfunded-recipient \
  "$(solana-keygen pubkey keys/devnet/demo-owner.json)" 0.5

# the 6 decimal test stablecoin
spl-token create-token keys/devnet/tusdc-mint.json --decimals 6 --url devnet \
  --fee-payer keys/devnet/deployer.json \
  --mint-authority "$(solana-keygen pubkey keys/devnet/mint-authority.json)"
MINT="$(solana-keygen pubkey keys/devnet/tusdc-mint.json)"

# token accounts for the demo recipient and the demo owner, and 1000 tUSDC for the owner
spl-token create-account "$MINT" --url devnet --fee-payer keys/devnet/deployer.json \
  --owner "$(solana-keygen pubkey keys/devnet/demo-recipient.json)"
spl-token create-account "$MINT" --url devnet --fee-payer keys/devnet/deployer.json \
  --owner "$(solana-keygen pubkey keys/devnet/demo-owner.json)"
spl-token mint "$MINT" 1000 --url devnet --fee-payer keys/devnet/deployer.json \
  --mint-authority keys/devnet/mint-authority.json \
  --recipient-owner "$(solana-keygen pubkey keys/devnet/demo-owner.json)"
```

5. Write `deployments/devnet.json` in the same shape as `deployments/localnet.json`.

```json
{
  "network": "devnet",
  "caip2": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "genesisHash": "<solana genesis-hash --url devnet>",
  "programs": {
    "agentWallet": "7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb",
    "settlement": "6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z"
  },
  "settlementAuthority": "AchLyVbEk5nXx2K73LB43wvBCqY4V4xyei9bTwSrS5Tz",
  "mint": "<MINT>",
  "mintSymbol": "tUSDC",
  "mintDecimals": 6,
  "mintAuthority": "<pubkey of keys/devnet/mint-authority.json>",
  "facilitator": "<pubkey of keys/devnet/facilitator.json>",
  "demoOwner": "<pubkey of keys/devnet/demo-owner.json>",
  "demoSession": "<pubkey of keys/devnet/demo-session.json>",
  "demoRecipient": "<pubkey of keys/devnet/demo-recipient.json>",
  "createdAt": "<ISO timestamp>"
}
```

6. Run the services against devnet with `TURNSTILE_NETWORK=devnet`, `SOLANA_RPC_URL=https://api.devnet.solana.com`, `DEPLOYMENT_FILE="$PWD/deployments/devnet.json"` and the devnet keys by absolute path. Migrate the production database with `DATABASE_URL=... pnpm --filter @turnstile/shared migrate`. The facilitator checks at startup that the deployment's program ids equal the ids in `@turnstile/shared`.

After the deploy, consider moving the upgrade authority off the deployer with `solana program set-upgrade-authority`.

## Deploy the web app to Vercel

Not yet executed. The web app only proxies. The backend, the demo agent and the facilitator must run somewhere public first.

- Project root directory `apps/web`, framework Next.js, package manager pnpm.
- Build command `cd ../.. && pnpm --filter "@turnstile/web..." build`, which builds `@turnstile/shared` before the site.

| Variable | Needed for | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | metadata and canonical links | `https://turnstile.example` |
| `TURNSTILE_NETWORK` | console and demo network label | `devnet` |
| `SOLANA_RPC_URL` | `/api/console/send` and chain reads | `https://api.devnet.solana.com` |
| `TURNSTILE_BACKEND_URL` | `/api/backend/*` and `/api/console/session` | the public backend URL |
| `TURNSTILE_DEMO_AGENT_URL` | `/demo/api/*` | the public demo agent URL |
| `FACILITATOR_URL` | shown in the console deployment facts | the public facilitator URL |
| `DEPLOYMENT_FILE` | `/api/console/deployment` | a path to a deployment JSON bundled with the app |

Without `DEPLOYMENT_FILE` the console falls back to the program ids in `@turnstile/shared` and reports no mint. A path on Vercel must point at a file inside the deployment, which is not set up yet.

On the backend set `WEB_ORIGIN` to the site origin and `COOKIE_SECURE=true`. On the demo agent set `WEB_ORIGIN` to the site origin as well.

## Recover the indexer

The indexer recovers from most failures on its own. [ADR 0004](adr/0004-indexer-checkpoint.md) and [packages/indexer/README.md](../packages/indexer/README.md) have the detail.

| Situation | What happens | What you do |
| --- | --- | --- |
| Crash or kill | Resumes from the checkpoint. An uncommitted batch is replayed, a committed one is not | Restart it |
| RPC errors | Writes nothing, backs off up to `INDEXER_MAX_BACKOFF_MS`, readiness turns 503 when stale | Fix the RPC node |
| Checkpoint signature unknown to the node | Resumes by slot and skips rows it already has | Point it at a node with full history if older receipts matter |
| Local validator reset | Logs `LEDGER RESET DETECTED`, deletes that network's receipts from the old ledger, rewinds to `INDEXER_START_SLOT` | Nothing, unless you meant to keep the old rows |
| Integrity error | Stops and stays 503 | Check that `DEPLOYMENT_FILE` and `SOLANA_RPC_URL` point at the same cluster |
| Checkpoint conflict | Drops the batch, starts from the new checkpoint | Run one indexer per `INDEXER_STREAM` |

Re-index a stream from its start slot. Inserts skip existing rows, so this is safe at any time.

```sh
psql "$DATABASE_URL" -c "DELETE FROM indexer_checkpoints WHERE stream = 'settlement:localnet'"
```

Rebuild the rows themselves. Stop the indexer first.

```sh
psql "$DATABASE_URL" <<'SQL'
BEGIN;
DELETE FROM receipts WHERE network = 'solana:localnet';
DELETE FROM indexer_checkpoints WHERE stream = 'settlement:localnet';
COMMIT;
SQL
```

Re-index from a given slot.

```sh
psql "$DATABASE_URL" -c "UPDATE indexer_checkpoints SET last_signature = NULL, last_slot = 123456 WHERE stream = 'settlement:localnet'"
```

Known gap. An indexer started late on a test validator missed settlements older than about 100 slots. It is under investigation and listed in BLOCKERS.md. Start the indexer with the validator, or check the count of `receipts` against the chain after a late start.

A ledger reset also invalidates `deployments/localnet.json`. Run `pnpm dev:up` again, or `pnpm stack:up`, so the bootstrap writes a new mint and genesis hash. Receipts from builds before `close_receipt` are 321 bytes and only exist on old local ledgers. Reset those ledgers.

## Replay dead letters

A settlement whose outcome was unknown sits in `settlement_dead_letters` with `status = pending`. The console summary lists them under failures.

```sh
pnpm --filter @turnstile/facilitator build
pnpm --filter @turnstile/facilitator replay                                  # up to 100 pending letters
cd packages/facilitator && node dist/replay-main.js --limit=500
```

It reads the facilitator environment. Each letter goes through the normal settle path.

- A payment that had already landed is marked `replayed`, with no second debit.
- A payment the program now refuses, or whose authorization expired, is marked `abandoned` with the reason.
- A letter still failing after 5 attempts is abandoned.
- The exit code is 1 while letters stay pending.

## Reclaim receipt rent

Each receipt holds 3,180,720 lamports that the facilitator fee payer paid. The fee payer may close it 7 days after the authorization expired.

```sh
pnpm --filter @turnstile/facilitator reclaim
cd packages/facilitator && node dist/reclaim-main.js --batch=10 --limit=500 --dry-run
```

- It reads the facilitator environment. `DATABASE_URL` must be set but is not used.
- It finds 329 byte receipts whose `fee_payer` is this key, closes those past retention oldest first, `--batch` per transaction (default 10, at most 20).
- `--limit` caps a run and `--dry-run` only reports.
- Exit code 1 means a batch failed. Those receipts stay and the next run retries them. Once a day from cron is enough.

## Rotate keys

### Agent session key

1. Create a new key where the agent runs. `node packages/sdk-agent/dist/cli.js keygen --out agent-session-2.json` prints only the public key.
2. Add it to the wallet. In the console open the agent and add a session key, or call `POST /v1/tx/add-session-key` and sign the transaction with the owner wallet.
3. Switch the agent to the new key file.
4. Revoke the old key in the console or with `POST /v1/tx/revoke-session-key`.

Never add a revoked key back. Re-adding it revives its unexpired, unsettled authorizations (see SECURITY.md). A wallet holds 4 key slots. A revoked or expired slot is reused when all 4 are taken.

### Facilitator fee payer

1. Create a new keypair and fund it with SOL for fees and receipt rent.
2. Point `FACILITATOR_KEYPAIR` at it on every facilitator instance and restart them. Update `facilitator` in the deployment file.
3. Keep the old key. Receipts it paid for name it as `fee_payer`, and only it can close them. Run `reclaim` with the old key once their retention has passed, then retire it.

The fee payer has no authority over any vault, so a leaked fee payer key can spend its own SOL but cannot move agent funds.

### Console API key

Revoke it in console settings, or with `DELETE /v1/api-keys/:id` from a signed-in session. The next call with it gets `401 api_key_revoked`. Create a replacement with `POST /v1/api-keys`. The full key is shown only once.

### Owner key

The programs have no instruction to change the owner of an agent wallet. To move to a new owner key, create new agent wallets under the new owner, move the agents to them, then withdraw everything from the old wallets and close them with the old key (`POST /v1/tx/close-wallet` with `withdrawRemaining: true`). Give the new wallets new session keys.

### Console sessions

Sign out ends a session. Sessions expire after 12 hours. To end every session at once, delete the rows in `console_sessions`.
