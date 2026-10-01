# Turnstile

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![ci](https://github.com/sabijuraa/turnstile/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sabijuraa/turnstile/actions/workflows/ci.yml)
[![Solana programs](https://img.shields.io/badge/solana-anchor%201.2-9945FF.svg)](programs)

Turnstile lets software pay for what it uses, one HTTP request at a time, inside limits its owner sets in advance. An API answers an unpaid request with HTTP 402. The calling agent signs a stablecoin payment with a scoped session key and retries. Two Solana programs check the payment against the owner's policy, move the funds and write a receipt in a single instruction. The per-call cap, the rolling daily cap and the allow-list live on chain, so no server and no SDK can spend past them.

```
 agent + sdk-agent              resource server + sdk-resource           facilitator
 ─────────────────              ──────────────────────────────           ───────────
 GET /v1/summarize  ─────────▶  402 PAYMENT-REQUIRED
 sign with session key
 retry with PAYMENT-SIGNATURE ▶ verify and settle  ──────────────────▶  ed25519 check + settle tx
                                                                               │
                                       ┌───────────────────────────────────────┘
                                       ▼
                              settlement program ── CPI debit ──▶ agent_wallet program
                              nonce, receipt, event               policy, session keys, vault
                                       │
                                       ▼
                              indexer ──▶ Postgres ──▶ console backend ──▶ web console
 200 + PAYMENT-RESPONSE  ◀───  handler runs with the receipt
```

## Why this exists

Software is starting to buy things on its own. An agent that calls a search API, a model endpoint or a data feed a few thousand times a day needs a way to pay for each call. The usual answers are a shared API key with a monthly invoice or a prepaid credit balance per vendor. Both put the spending limit in the vendor's database and both assume a human signed up first. Neither works when an agent discovers a new paid endpoint at runtime.

x402 fixes the transport. A server says what a request costs in a 402 response and the client pays in the retry. What x402 leaves open is the harder question of who stops an agent from spending too much. If the limit lives in the agent's own code, a bug or a prompt injection removes it. If it lives at the payment processor, the owner has to trust that processor with the money.

Turnstile puts the limit where neither the agent nor any server can move it. The owner's funds sit in a program-owned vault. The policy sits next to them on chain. The session key an agent holds can sign payments and nothing else, and the settlement program rejects any payment that breaks the policy before a single token moves. The owner can revoke a key or change the caps with one transaction, and every settled payment leaves a receipt anyone can verify.

## Verified

Every item below is asserted by a test in this repository.

**Programs.** `cargo test -p settlement -p agent-wallet` runs 61 tests in LiteSVM against the compiled programs.

- A payment over the per-call cap, over the rolling daily cap, to a resource off the allow-list, to the wrong recipient or in the wrong mint fails inside the program.
- A replayed nonce fails with `NonceAlreadyUsed`. An expired authorization or a revoked or unknown session key fails.
- The ed25519 signature must cover this exact program, message and key, and must sit in the instruction right before `settle`.
- `debit` called directly, outside settlement, is refused. Every owner instruction refuses a non-owner signer.
- The rolling daily cap ages out bucket by bucket and never admits more than the cap inside any 24 hour window.
- A receipt can be closed after its retention period, returns its exact rent to the fee payer, and a replay after the close fails as expired and moves no funds.
- The program's authorization message matches the TypeScript encoder byte for byte.

**Services and SDKs.** `pnpm -r --filter '!@turnstile/e2e' run test` runs 322 tests across the shared library, facilitator, both SDKs, indexer, console backend, demo API and web app. With `TURNSTILE_INTEGRATION=1`, all 31 `sdk-resource` tests run against a real `solana-test-validator` and facilitator.

**End to end.** `pnpm e2e` brings up the full stack in Docker and runs 19 tests. CI runs it on every push to `main`.

- The full loop from 402 to a receipt on chain that matches the indexer row field by field (`packages/e2e/test/product-loop.test.ts`).
- An over-cap payment, an off allow-list payment and a replayed nonce are each refused by the program, the facilitator and the SDK.
- A replayed payment header is answered from the original receipt without a second debit.
- The console backend signs an owner in with a wallet signature and serves the same receipt, the summary and the CSV export.
- The demo agent settles six calls and the chain refuses the seventh with `DailyCapExceeded` (`packages/e2e/test/demo-run.test.ts`).
- Every service answers `/healthz`, `/readyz` and `/metrics`.

## Performance

| Measurement | Result | Conditions |
| --- | --- | --- |
| `settle` compute units | 48,907 to 53,407 | LiteSVM, `programs/settlement/tests/settle.rs`. The spread comes from PDA bump searches |
| `close_receipt` compute units | 4,155 | LiteSVM, `programs/settlement/tests/close_receipt.rs` |
| Rent reclaimed per closed receipt | 3,180,720 lamports | 329 byte receipt account |
| Paid request, end to end | median 364 ms, p90 520 ms | 20 sequential requests, full Docker stack on a 4 CPU CI runner, local validator |
| Paid request, SDK to settlement | median 392 ms, p90 545 ms | 25 requests, `sdk-resource` integration test on a local validator |

## Layout

| Path | What it does |
| --- | --- |
| `programs/agent-wallet` | Holds the funds in a vault. Stores the policy (per-call cap, rolling daily cap, allow-list) and the session keys. Debits only when the settlement program asks |
| `programs/settlement` | Checks the session key signature, spends the nonce, calls `debit` and writes a receipt, all in one instruction |
| `packages/shared` | Program ids, IDLs, the authorization encoder, the policy mirror, config and migrations |
| `packages/facilitator` | Issues payment requirements, verifies payloads and submits settlement transactions. Its key pays fees and cannot move agent funds |
| `packages/sdk-resource` | Turns a Hono, Express or plain `node:http` route into a paid route |
| `packages/sdk-agent` | Pays a 402 automatically and refuses anything outside the policy before it signs |
| `packages/indexer` | Copies receipts from the chain into Postgres and resumes from a checkpoint |
| `packages/backend` | Serves the console. Builds unsigned owner transactions, issues API keys and reads the indexer store |
| `packages/demo-api` | A metered text API and the demo agent runner behind the live demo |
| `packages/e2e` | The end to end suite against a running stack |
| `apps/web` | Next.js marketing site, docs, owner console and live demo |
| `infra/` | Docker compose, validator and Node images, stack and e2e scripts, CI helpers |
| `docs/` | System design, API reference, runbook, security review, test plan and ADRs |

Program ids.

| Program | Id |
| --- | --- |
| agent_wallet | `7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb` |
| settlement | `6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z` |

## Usage

### Requirements

- Node 22 and pnpm 11 (`npm install -g pnpm@11.24.0`).
- Rust 1.98 and Agave 4.0.2, which provides `solana-test-validator`, `cargo build-sbf` and the `solana` CLI.
- Docker with the compose plugin.

### Run the stack

```sh
pnpm install
pnpm stack:up
```

The site is on http://localhost:3000, the live demo on http://localhost:3000/demo and the services on ports 4020 to 4024. Stop it with `pnpm stack:down`. To run the services from a shell instead, `pnpm dev:up` starts only the validator and Postgres and prints the variables each service needs.

### Charge for a route

```ts
import { honoPaywall, type PaywallEnv } from "@turnstile/sdk-resource";
import { Hono } from "hono";

const app = new Hono<PaywallEnv>();

app.use(
  "*",
  honoPaywall({
    facilitatorUrl: "http://127.0.0.1:4020",
    payTo: "4F7ro2NGHWvMxaQKMKVchZy3cWU1cD2C1rZztAbxzkEq",
    routes: {
      "POST /v1/summarize": { price: "0.005", description: "Summarize a text" },
    },
  }),
);

app.post("/v1/summarize", async (c) => {
  const payment = c.get("turnstilePayment");
  return c.json({ summary: "...", receipt: payment?.receipt });
});

export default app;
```

`expressPaywall` does the same for Express and plain `node:http`. `createPaywall` is the framework agnostic core.

### Pay from an agent

```ts
import { createAgent, PolicyRefusedError, readKeypairFile } from "@turnstile/sdk-agent";

const agent = createAgent({
  rpcUrl: "http://127.0.0.1:8899",
  agentWallet: "9mJm7GQ5JkzJ2Lq4bYVd3m1kXyU8cTzQnF1wR6pH2sDa",
  sessionKey: readKeypairFile("agent-session.json"),
  maxPerCall: "0.01",
});

try {
  const res = await agent.fetch("http://127.0.0.1:4021/v1/summarize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Long text to summarize." }),
  });
  console.log(res.status, res.payment?.receipt);
} catch (err) {
  if (err instanceof PolicyRefusedError) {
    console.log(`refused before signing: ${err.reason}`);
  } else {
    throw err;
  }
}
```

`agent.fetch` behaves like `fetch`. It reads the wallet policy from chain, refuses a payment outside it before the key signs anything, pays a 402 that fits and retries once. The addresses above are illustrative. Use your own wallet PDA and recipient.

### Run the tests

```sh
cargo test -p settlement -p agent-wallet                               # programs in LiteSVM, needs target/deploy/*.so
pnpm build
pnpm -r --filter '!@turnstile/e2e' run test                            # unit tests, needs Postgres on 5433
TURNSTILE_INTEGRATION=1 pnpm --filter @turnstile/sdk-resource test     # real validator and facilitator
pnpm e2e                                                               # full stack and the end to end suite
```

## CLI and API

The agent SDK ships a small CLI for session keys.

```sh
node packages/sdk-agent/dist/cli.js keygen --out agent-session.json   # writes mode 0600, prints only the public key
node packages/sdk-agent/dist/cli.js address agent-session.json
```

The facilitator speaks x402 version 2 with the `turnstile-policy` scheme.

| Endpoint | Purpose |
| --- | --- |
| `GET /supported` | Schemes, network, program ids and asset this facilitator settles |
| `POST /requirements` | Builds `PaymentRequirements` for a resource and price |
| `POST /verify` | Checks a signed payment against the requirements |
| `POST /settle` | Submits the settlement transaction and returns the receipt |

Headers on the wire are `PAYMENT-REQUIRED` on the 402, `PAYMENT-SIGNATURE` on the retry and `PAYMENT-RESPONSE` on success. [docs/API.md](docs/API.md) has every field, the console backend routes and captured examples.

## Documentation

- [docs/SCOPE.md](docs/SCOPE.md) for goals, non-goals and requirements.
- [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) for accounts, instructions, errors and the x402 interface.
- [docs/API.md](docs/API.md) for the facilitator, SDKs, console backend and demo runner.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) for running, deploying and recovering.
- [docs/SECURITY.md](docs/SECURITY.md) for the threat model and the program review findings.
- [docs/TESTPLAN.md](docs/TESTPLAN.md) for the requirement to test matrix.
- [docs/FRONTEND_SPEC.md](docs/FRONTEND_SPEC.md) for the design system and page inventory.
- [docs/adr](docs/adr) for the decisions behind the design.
- Package READMEs in `packages/*/README.md` for each service in depth.

## License

MIT. See [LICENSE](LICENSE).
