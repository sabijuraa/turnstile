# @turnstile/facilitator

The x402 facilitator for Turnstile. It issues payment requirements, verifies signed payment payloads and submits settlement transactions to the Solana settlement program. It holds one key, a fee payer. That key pays network fees and receipt rent and has no authority over any vault, so a compromised facilitator cannot move agent funds or exceed a policy.

The only state is Postgres (`resources` and `settlement_dead_letters`). Any number of instances can serve the same traffic.

## Run

```sh
pnpm --filter @turnstile/facilitator build
DATABASE_URL=postgres://turnstile:turnstile@127.0.0.1:5433/turnstile \
DEPLOYMENT_FILE=deployments/localnet.json \
FACILITATOR_KEYPAIR=keys/localnet/facilitator.json \
pnpm --filter @turnstile/facilitator start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 4020 | HTTP port |
| `DATABASE_URL` | required | Postgres. Migrations run at startup |
| `TURNSTILE_NETWORK` | localnet | Must match the deployment file |
| `SOLANA_RPC_URL` | network default | RPC endpoint |
| `SOLANA_WS_URL` | RPC port plus one | Websocket endpoint |
| `DEPLOYMENT_FILE` | required | `deployments/<network>.json` with `programs`, `mint`, `mintDecimals` and optional `caip2` |
| `FACILITATOR_KEYPAIR` | required | Solana JSON keypair of the fee payer. Never logged |
| `FACILITATOR_PUBLIC_URL` | http://127.0.0.1:4020 | URL written into requirements |
| `LOG_LEVEL` | info | pino level |

Startup fails with a message naming every bad variable. It also fails when the deployment's program ids differ from the ids in `@turnstile/shared`.

## Endpoints

`GET /supported`

```json
{ "kinds": [{ "x402Version": 2, "scheme": "turnstile-policy", "network": "solana:localnet",
  "extra": { "settlementProgram": "6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z",
             "agentWalletProgram": "7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb", "asset": "<mint>" } }] }
```

`POST /requirements` takes `{ resource, price | amount, payTo, description, mimeType?, maxTimeoutSeconds?, asset? }`. Send `price` as a decimal in whole tokens or `amount` in base units, never both. The resource is canonicalized (query dropped), a fresh 32 byte nonce is drawn, and the resource name is stored so receipts can show it. This example was captured from a local run.

```sh
curl -s -XPOST localhost:4020/requirements -H 'content-type: application/json' \
  -d '{"resource":"http://127.0.0.1:4021/v1/summarize?x=1","price":"0.005","payTo":"HuXG...Mbit","description":"Summarize a text"}'
```

```json
{"scheme":"turnstile-policy","network":"solana:localnet","amount":"5000","asset":"So111...1112",
 "payTo":"HuXG...Mbit","maxTimeoutSeconds":60,"resource":"http://127.0.0.1:4021/v1/summarize",
 "description":"Summarize a text","mimeType":"application/json",
 "extra":{"resourceId":"c73ccd1164944748d19b8480a5f8e0594edbed03b5613afc852afcf79be6c117",
          "nonce":"8b5a9b8cd13e6d93fd09be32dcc23faef9cd88f25d1e986006e63bc25c606036",
          "settlementProgram":"6FrY...K9z","agentWalletProgram":"7onz...aiLb",
          "facilitator":"http://127.0.0.1:38420","expiresAt":"1790700599","displayAmount":"0.005 tUSDC"}}
```

An invalid `payTo` or asset is refused.

```json
{"error":{"code":"invalid_request","message":"payTo must be a base58 Solana address."}}
```

`POST /verify` takes `{ paymentPayload, paymentRequirements }` and returns `{ isValid, invalidReason?, invalidMessage?, payer? }`. Checks run in this order and stop at the first failure.

1. Payload shape. `invalid_payload`
2. The requirements were issued for this network, mint and programs. `unsupported_requirements`
3. The accepted terms equal the requirements on scheme, network, amount, asset, payTo, resource, resource id and nonce. `requirements_mismatch`
4. The signed authorization matches those terms. `authorization_mismatch`
5. The Ed25519 signature, offline. `invalid_signature`
6. Expiry of the authorization and of the requirements. `authorization_expired`
7. The nonce has no receipt yet. `NonceAlreadyUsed`
8. The agent wallet exists and holds this mint. `wallet_not_found`, `AccountMismatch`
9. The policy from chain, with the vault balance. `SessionKeyNotFound`, `SessionKeyRevoked`, `SessionKeyExpired`, `PerCallCapExceeded`, `ResourceNotAllowed`, `DailyCapExceeded`, `InsufficientFunds`
10. A simulation of the exact settle transaction, so the program has the final word. Any program error name.

`invalidMessage` is a plain sentence that says what to do next. When the RPC cannot be reached the answer is 503 `chain_unavailable`, not a verdict.

`POST /settle` takes the same body and returns `{ success, transaction, network, payer, receipt?, errorReason?, errorMessage?, alreadySettled? }`.

- It derives the receipt address first. If the receipt exists and matches the authorization, it returns the original transaction with `alreadySettled: true`. A retry never double spends, even after the authorization expired. Once the reclaim job has closed the receipt (at least 7 days after expiry) the retry answers `authorization_expired`, and the chain still refuses it.
- Otherwise it verifies, sends `[ed25519Ix, settleIx]` with the facilitator as the only signer, and waits for `confirmed`.
- Concurrent settles of one nonce end with one debit. The losers re-read the receipt and answer as `alreadySettled`.
- Policy and program rejections are final and returned by name.
- A send whose outcome is unknown (transport error, confirmation timeout, expired blockhash) is upserted into `settlement_dead_letters` by agent wallet and nonce, with the payload, requirements, error and attempt count. The answer is `errorReason: "settlement_failed"`.

Also `GET /healthz`, `GET /readyz` (Postgres and RPC, 503 when either is down) and `GET /metrics`. Errors are JSON `{ error: { code, message } }`. Bodies are capped at 64 KB.

## Replaying dead letters

```sh
pnpm --filter @turnstile/facilitator replay            # up to 100 pending letters
node dist/replay-main.js --limit=500
```

Each pending letter goes through the normal settle path. A letter whose payment had already landed is marked `replayed` with no second debit. A letter the program now refuses, or whose authorization expired, is marked `abandoned` with the reason. A letter still failing after 5 attempts is abandoned. The exit code is 1 when letters stay pending.

## Reclaiming receipt rent

Every settlement creates a 329 byte receipt whose rent, 3,180,720 lamports, the fee payer pays. The settlement program lets that same fee payer close a receipt once 7 days have passed since its authorization expired, and the lamports go back to it. The `PaymentSettled` event and the indexer's `receipts` table remain the permanent record.

```sh
pnpm --filter @turnstile/facilitator reclaim             # close every receipt past retention
node dist/reclaim-main.js --batch=10 --limit=500 --dry-run
```

It reads the same environment as the service (`DATABASE_URL` must be set but is not used). It lists the settlement accounts with a `dataSize` filter of 329 and a `memcmp` on `fee_payer` at byte 288, compares each `expires_at` against the chain clock, and closes the ones past retention, oldest first, `--batch` per transaction (default 10, at most 20). `--limit` caps one run. `--dry-run` only reports. It prints each transaction, the lamports reclaimed and when the next receipt becomes closable. The exit code is 1 when any batch failed. Those receipts stay on chain and the next run tries them again, so running it from cron once a day is enough.

Output from a run against a local validator with two receipts past retention, one still retained and one paid by another fee payer.

```
closed 2 receipts 5bPC3Sdh...LN2JP 6361440 lamports
found 3, past retention 2, retained 1 (next one closable at unix 1791373184)
closed 2, failed 0, reclaimed 6361440 lamports (0.006361440 SOL)
```

## Metrics

| Metric | Labels |
| --- | --- |
| `turnstile_facilitator_http_requests_total` | method, route, status |
| `turnstile_facilitator_http_request_duration_seconds` | method, route, status |
| `turnstile_facilitator_verify_results_total` | result (`valid` or the reason) |
| `turnstile_facilitator_settlements_total` | outcome (`settled`, `already_settled`, `rejected`, `dead_lettered`) |
| `turnstile_facilitator_settle_duration_seconds` | outcome |
| `turnstile_facilitator_dead_letters_total` | stage (`settle`, `replay`) |
| `turnstile_facilitator_requirements_issued_total` | |

Logs are pino JSON with `requestId` on every line and `nonce`, `agentWallet` and `receipt` on payment lines.

## Measured latency (NFR3)

From `packages/sdk-resource/test/integration.test.ts`, 25 sequential paid requests against a real facilitator and a Hono resource server with the paywall. Everything runs on one machine (WSL2, Linux 6.x, Node 22) with a local `solana-test-validator` from Agave 4.0.2 at default slot timing. The agent signs by hand with the shared helpers.

| Run | Paid request median | p90 | Full loop median (402 then paid) |
| --- | --- | --- | --- |
| 1 | 455 ms | 611 ms | 475 ms |
| 2 | 427 ms | 579 ms | 446 ms |

"Paid request" is from sending the request with `PAYMENT-SIGNATURE` to reading the resource body. That covers verify, settle with confirmation at `confirmed`, and the handler.

## Code layout

- `src/service.ts` holds the verify and settle logic. It talks to the chain only through `SettlementChain` in `src/chain/types.ts`.
- `src/chain/solana.ts` is the real chain. It uses a shared blockhash cache, sends without preflight after its own simulation, polls signature status, and resends until the blockhash expires. `src/chain/codec.ts` plugs in the program client from `@turnstile/shared/programs`.
- `src/reclaim.ts` selects and batches receipt closes through `ReclaimChain`. `src/chain/reclaim-solana.ts` is its real chain and `src/reclaim-main.ts` the command.
- Tests in `test/` use a fake chain with the program's policy rules and a real Postgres (`TEST_DATABASE_URL`, default database `turnstile_facilitator_test` on port 5432).
