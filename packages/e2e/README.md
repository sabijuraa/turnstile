# @turnstile/e2e

The end-to-end suite. It proves the whole product loop against a running stack, with no mocks. Every check reads the real validator, the real services and the real Postgres.

## What it checks

- `test/health.test.ts` hits `/healthz`, `/readyz` and `/metrics` on the facilitator, demo API, backend, indexer and demo agent, and checks each metric family by name (NFR6).
- `test/product-loop.test.ts` runs the loop for a fresh owner (FR1 to FR14).
  - Airdrops SOL to a new owner, mints tUSDC to it with `keys/localnet/mint-authority.json`, then creates, funds and sets the policy of a new agent wallet with the shared instruction builders. The allow-list is the demo API catalog with the deployment's `demoRecipient`.
  - An unpaid request gets 402 with `PAYMENT-REQUIRED`. The agent SDK pays. The answer is 200 with the summary and `PAYMENT-RESPONSE`.
  - The receipt is read from chain with `fetchReceipt` and every field is checked. The indexer row in `receipts` must agree with it field by field. The vault and the recipient move by exactly the price.
  - The same payment header sent again returns the original receipt with no second debit.
  - A replayed nonce, a price over the per-call cap and a resource off the allow-list are each sent straight to the settlement program with `skipPreflight`, bypassing the facilitator and the SDK. The failed transaction must carry `NonceAlreadyUsed`, `PerCallCapExceeded` or `ResourceNotAllowed` from `parseProgramError`. The facilitator (`/verify` and `/settle`) and the SDK must refuse with the same names.
  - The owner signs in to the console backend with a wallet signature. `/v1/receipts`, `/v1/summary`, `/v1/receipts.csv` and `/v1/agents` must show the same receipt and wallets.
- `test/demo-run.test.ts` starts a demo run with `POST /runs` and follows its event stream to the end. It expects six `call.settled` events, then one `call.refused` with `DailyCapExceeded` whose failed transaction fails on chain with `DailyCapExceeded`. The six receipts must be on chain and in the indexer store.
- `test/latency.test.ts` times 20 sequential paid requests through the agent SDK after one warm-up call (NFR3). It prints the median and p90 and writes them with the conditions to `results/latency.json`. The median must stay under `E2E_LATENCY_BUDGET_MS`, 2000 by default.

Files under `results/` are run output and stay out of git.

## Run it against compose

Bring the stack up, then run the suite. The defaults are the compose ports.

```sh
pnpm stack:up
pnpm --filter @turnstile/e2e test
```

Or let the harness do both and tear the stack down afterwards.

```sh
infra/scripts/e2e.sh
```

## Run it against the lighter infra mode

`E2E_STACK=infra` brings up only the validator, Postgres and the bootstrap. The suite then starts the facilitator, demo API, demo agent, indexer and backend itself from their build output, with the same variables compose passes, and stops them at the end. Their logs go to `results/logs`.

```sh
pnpm --filter "@turnstile/e2e..." build
E2E_STACK=infra infra/scripts/e2e.sh
```

To run the suite by hand against validator and Postgres you started yourself, set the variables below and `E2E_STACK=infra`. For example, a private validator on 58899, a separate database and services on 54020 to 54024.

```sh
export E2E_STACK=infra
export SOLANA_RPC_URL=http://127.0.0.1:58899 SOLANA_WS_URL=ws://127.0.0.1:58900
export DATABASE_URL=postgres://turnstile:turnstile@127.0.0.1:5433/turnstile_e2e
export DEPLOYMENT_FILE=/path/to/localnet.json KEYS_DIR=/path/to/keys
export FACILITATOR_URL=http://127.0.0.1:54020 DEMO_API_URL=http://127.0.0.1:54021
export BACKEND_URL=http://127.0.0.1:54022 INDEXER_URL=http://127.0.0.1:54023
export DEMO_AGENT_URL=http://127.0.0.1:54024
pnpm --filter @turnstile/e2e test
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `E2E_STACK` | `full` | `full` expects every service running. `infra` starts the services |
| `E2E_START_SERVICES` | `1` | Set `0` in infra mode when you started the services yourself |
| `E2E_READY_TIMEOUT_MS` | `120000` | How long to wait for every `/readyz` before failing |
| `E2E_LATENCY_BUDGET_MS` | `2000` | Median the latency test must stay under |
| `SOLANA_RPC_URL` | `http://127.0.0.1:8899` | Validator RPC |
| `SOLANA_WS_URL` | RPC port plus one | Validator websocket |
| `DATABASE_URL` | `postgres://turnstile:turnstile@127.0.0.1:5433/turnstile` | The indexer store |
| `FACILITATOR_URL` | `http://127.0.0.1:4020` | Facilitator |
| `DEMO_API_URL` | `http://127.0.0.1:4021` | Demo API |
| `BACKEND_URL` | `http://127.0.0.1:4022` | Console backend |
| `INDEXER_URL` | `http://127.0.0.1:4023` | Indexer health and metrics |
| `DEMO_AGENT_URL` | `http://127.0.0.1:4024` | Demo agent runner |
| `DEPLOYMENT_FILE` | `deployments/localnet.json` | Deployment record written by the bootstrap |
| `KEYS_DIR` | `keys/localnet` | Local keys. The suite reads `mint-authority.json`, and in infra mode passes the service keys on |
| `WEB_ORIGIN` | `http://localhost:3000` | Origin sent to the backend, must match its `WEB_ORIGIN` |

## When the stack is not ready

Before any test runs, the suite polls the validator, Postgres and every service `/readyz`. If one is still not ready when the timeout passes it stops with a list of what failed and why.

```text
The stack is not ready after 120 s. These did not answer ready:
  - backend (http://127.0.0.1:4022/readyz): ECONNREFUSED
```

## Notes

- Each run creates a fresh owner with its own wallets, so it can run again on the same ledger. The demo run uses the demo owner from the bootstrap and creates a new wallet each time.
- The latency numbers depend on the host. `results/latency.json` records the CPU count and the load average next to the samples, so a slow number on a busy machine can be told apart from a slow loop.
