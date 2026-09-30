# API reference

This page covers every interface Turnstile exposes. It is the short, complete version. Each package README goes deeper.

- The x402 headers and payloads.
- The facilitator (`packages/facilitator`, port 4020).
- The resource SDK (`@turnstile/sdk-resource`).
- The agent SDK (`@turnstile/sdk-agent`).
- The metered demo API (`packages/demo-api`, port 4021).
- The console backend (`packages/backend`, port 4022) and the web routes in front of it.
- The demo agent runner (`packages/demo-api`, port 4024) and its event stream.

Examples marked captured come from real runs against a local `solana-test-validator`. The x402, facilitator and SDK examples are in `apps/web/src/app/docs/_examples/*.json`, captured on 30 Sep 2026 by `apps/web/src/app/docs/_examples/capture.ts`. The console backend examples come from `packages/backend/README.md`, captured on 29 Sep 2026. Addresses and signatures in them belong to throwaway local ledgers.

## Conventions

- Amounts on the wire are decimal strings in base units. The test stablecoin tUSDC has 6 decimals, so `"5000"` is 0.005 tUSDC.
- Keys, mints and signatures are base58. Resource ids and nonces are 64 character hex.
- Every service answers errors as `{ "error": { "code", "message" } }`. The message says what to do next.
- Every service serves `GET /healthz`, `GET /readyz` (503 with the failed dependency named) and `GET /metrics` (Prometheus text).

## x402 transport

Turnstile follows x402 version 2 transport with its own scheme, `turnstile-policy`. See [ADR 0005](adr/0005-x402-v2-with-turnstile-policy-scheme.md).

| Header | Direction | Content |
| --- | --- | --- |
| `PAYMENT-REQUIRED` | server to agent, on 402 | base64 JSON `{ x402Version: 2, error, resource, accepts: [PaymentRequirements] }`. The body holds the same JSON |
| `PAYMENT-SIGNATURE` | agent to server, on the retry | base64 JSON `{ x402Version: 2, resource, accepted: PaymentRequirements, payload: { authorization, signature } }` |
| `PAYMENT-RESPONSE` | server to agent, on success | base64 JSON `{ success, transaction, network, payer, receipt }` |

The network is `solana:localnet` on a local validator and `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` on devnet (`packages/shared/src/networks.ts`).

A captured 402, with the header decoded.

```json
{
  "x402Version": 2,
  "error": "Payment required. This route costs 0.005 tUSDC. Sign one of the accepted requirements and send it in the PAYMENT-SIGNATURE header.",
  "resource": "http://127.0.0.1:3581/v1/summarize",
  "accepts": [
    {
      "scheme": "turnstile-policy",
      "network": "solana:localnet",
      "amount": "5000",
      "asset": "5XFeDTQutPnAauoehcKFZF4TeMaiL9rA1omk2UMB6m7G",
      "payTo": "4F7ro2NGHWvMxaQKMKVchZy3cWU1cD2C1rZztAbxzkEq",
      "maxTimeoutSeconds": 60,
      "resource": "http://127.0.0.1:3581/v1/summarize",
      "description": "Summarize a text",
      "mimeType": "application/json",
      "extra": {
        "resourceId": "e01cf8c98a0124456830d5fd871d81fce39d238e7d6e9d9c8a39262feb10cd98",
        "nonce": "df377fc9743c0a7eee496747df78db2fc9cdbcc8d828ce5e685cb679aa738b97",
        "settlementProgram": "6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z",
        "agentWalletProgram": "7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb",
        "facilitator": "http://127.0.0.1:3580",
        "expiresAt": "1790768211",
        "displayAmount": "0.005 tUSDC"
      }
    }
  ]
}
```

The `payload` inside `PAYMENT-SIGNATURE`, captured.

```json
{
  "authorization": {
    "agentWallet": "8zzPesK3gwLhJKeA8rxTYEfmP3eUxhbcBVdxEFQweBXS",
    "sessionKey": "4asLnPoBJDKekDRyiGhrZNMx8pTPAJ51WSk5WEG8eaTz",
    "recipient": "4F7ro2NGHWvMxaQKMKVchZy3cWU1cD2C1rZztAbxzkEq",
    "mint": "5XFeDTQutPnAauoehcKFZF4TeMaiL9rA1omk2UMB6m7G",
    "amount": "5000",
    "resourceId": "e01cf8c98a0124456830d5fd871d81fce39d238e7d6e9d9c8a39262feb10cd98",
    "nonce": "aa901dc6c234f18680f2a3b990d7bae4fa152c15e5433af1c52c4fc5bc59e8bb",
    "expiresAt": "1790768211"
  },
  "signature": "2TwAvvcKhV2zRRvYiMnbLZti3usAiCtF7UoTRKEdHwFBZR5y7cdF8cEkQWBBXerR7cVDYivNGqHWdVydvgLJp8sj"
}
```

The session key signs a 260 byte message. It is `"TURNSTILE_PAYMENT_V1"`, then the settlement program id, then the 208 byte Borsh encoding of the authorization. `signAuthorization` in `packages/shared` is the only encoder used off chain.

The decoded `PAYMENT-RESPONSE` of the paid retry, captured.

```json
{
  "success": true,
  "transaction": "38WfThMUpH5dXnaPTc2BFES6ShxNyY9Gy6RUJyTpLYaMSB7GXLhM4hLJv23T2X8Zss5S72mqm978KcJ8trQ9h8Ah",
  "network": "solana:localnet",
  "payer": "8zzPesK3gwLhJKeA8rxTYEfmP3eUxhbcBVdxEFQweBXS",
  "receipt": "8pCifTALuYB24cwq4o8BQ3p4mzqzxsk4aKJ6dSGrwzuh"
}
```

## Facilitator

Base URL `http://127.0.0.1:4020` locally. Bodies are JSON and capped at 64 KB. Configuration and metrics are in [packages/facilitator/README.md](../packages/facilitator/README.md).

| Endpoint | Body | Answer |
| --- | --- | --- |
| `GET /supported` | none | `{ kinds: [{ x402Version, scheme, network, extra: { settlementProgram, agentWalletProgram, asset } }] }` |
| `POST /requirements` | `{ resource, price \| amount, payTo, description, mimeType?, maxTimeoutSeconds?, asset? }` | `PaymentRequirements` |
| `POST /verify` | `{ paymentPayload, paymentRequirements }` | `{ isValid, invalidReason?, invalidMessage?, payer? }` |
| `POST /settle` | `{ paymentPayload, paymentRequirements }` | `{ success, transaction, network, payer, receipt?, errorReason?, errorMessage?, alreadySettled? }` |

### POST /requirements

Send `price` as a decimal in whole tokens or `amount` in base units, never both. The resource is canonicalized, which drops the query string. A fresh 32 byte nonce is drawn and the resource name is stored in the `resources` table so receipts can show it. An invalid `payTo` or a foreign asset is refused.

```json
{"error":{"code":"invalid_request","message":"payTo must be a base58 Solana address."}}
```

### POST /verify

Checks run in this order and stop at the first failure.

| Step | Check | Reason on failure |
| --- | --- | --- |
| 1 | Payload shape | `invalid_payload` |
| 2 | The requirements name this facilitator's network, mint and programs, and the resource id is the hash of the resource | `unsupported_requirements` |
| 3 | The accepted terms equal the requirements on scheme, network, amount, asset, payTo, resource, resource id and nonce | `requirements_mismatch` |
| 4 | The signed authorization is for exactly those terms | `authorization_mismatch` |
| 5 | The Ed25519 signature, checked offline | `invalid_signature` |
| 6 | Expiry of the authorization and of the requirements | `authorization_expired` |
| 7 | No receipt exists for the nonce yet | `NonceAlreadyUsed` |
| 8 | The agent wallet exists and holds this mint | `wallet_not_found`, `AccountMismatch` |
| 9 | The policy read from chain, with the vault balance, in program order | `SessionKeyNotFound`, `SessionKeyRevoked`, `SessionKeyExpired`, `PerCallCapExceeded`, `ResourceNotAllowed`, `DailyCapExceeded`, `InsufficientFunds` |
| 10 | A simulation of the exact settle transaction, so the program has the final word | any program error name, see [ADR 0006](adr/0006-facilitator-verify-ends-in-simulation.md) |

When the RPC node cannot be reached the answer is 503 `chain_unavailable`, not a verdict. Malformed requirements give 400.

A captured refusal. The payment was 20000 base units against a per-call cap of 10000.

```json
{
  "isValid": false,
  "invalidReason": "PerCallCapExceeded",
  "invalidMessage": "The price is above the agent wallet's per-call cap. Ask the owner to raise the cap, or use a cheaper resource.",
  "payer": "8zzPesK3gwLhJKeA8rxTYEfmP3eUxhbcBVdxEFQweBXS"
}
```

A captured verify of a payload that had already settled.

```json
{
  "isValid": false,
  "invalidReason": "NonceAlreadyUsed",
  "invalidMessage": "This payment has already settled. Call settle with the same payload to get the original receipt, or sign a new payment.",
  "payer": "8zzPesK3gwLhJKeA8rxTYEfmP3eUxhbcBVdxEFQweBXS"
}
```

### POST /settle

The facilitator derives the receipt address before anything else.

- If a receipt exists and matches the authorization, it returns the original transaction with `alreadySettled: true`. A retry never pays twice.
- Otherwise it runs verify, sends `[ed25519 instruction, settle]` with its fee payer as the only signer, and waits for `confirmed`.
- Concurrent settles of one nonce end with one debit. The losers read the receipt back and answer as `alreadySettled`.
- Policy and program rejections are final and returned by name. They are never queued.
- A send whose outcome is unknown (transport error, confirmation timeout, expired blockhash) is upserted into `settlement_dead_letters` and answered with `errorReason: "settlement_failed"`.

A captured first settle.

```json
{
  "success": true,
  "transaction": "38WfThMUpH5dXnaPTc2BFES6ShxNyY9Gy6RUJyTpLYaMSB7GXLhM4hLJv23T2X8Zss5S72mqm978KcJ8trQ9h8Ah",
  "network": "solana:localnet",
  "payer": "8zzPesK3gwLhJKeA8rxTYEfmP3eUxhbcBVdxEFQweBXS",
  "receipt": "8pCifTALuYB24cwq4o8BQ3p4mzqzxsk4aKJ6dSGrwzuh"
}
```

The same payload sent again, captured. Same transaction, no second debit.

```json
{
  "success": true,
  "transaction": "38WfThMUpH5dXnaPTc2BFES6ShxNyY9Gy6RUJyTpLYaMSB7GXLhM4hLJv23T2X8Zss5S72mqm978KcJ8trQ9h8Ah",
  "network": "solana:localnet",
  "payer": "8zzPesK3gwLhJKeA8rxTYEfmP3eUxhbcBVdxEFQweBXS",
  "receipt": "8pCifTALuYB24cwq4o8BQ3p4mzqzxsk4aKJ6dSGrwzuh",
  "alreadySettled": true
}
```

### Idempotency after the receipt is closed

The idempotent answer lasts as long as the receipt account exists.

- The fee payer may close a receipt with `close_receipt` once 7 days have passed since the authorization expired. `pnpm --filter @turnstile/facilitator reclaim` does this.
- After that a retried settle of the same payload answers `authorization_expired`. It never double spends, because `settle` on chain refuses an expired authorization before it looks at the receipt.
- The `PaymentSettled` event and the indexer's `receipts` table stay the permanent record.

### Reason codes

Facilitator reasons are snake case. Program reasons keep their on-chain names.

| Reason | Source |
| --- | --- |
| `invalid_payload`, `unsupported_requirements`, `requirements_mismatch`, `authorization_mismatch`, `authorization_expired`, `invalid_signature`, `wallet_not_found`, `settlement_failed`, `settlement_simulation_failed` | facilitator |
| `SessionKeyNotFound`, `SessionKeyRevoked`, `SessionKeyExpired`, `PerCallCapExceeded`, `DailyCapExceeded`, `ResourceNotAllowed`, `UnauthorizedCaller`, `InsufficientFunds`, `ZeroAmount`, `InvalidPolicy`, `TooManySessionKeys`, `AllowListTooLong`, `DuplicateSessionKey`, `VaultNotEmpty`, `MintMismatch`, `RecipientMismatch`, `AccountMismatch`, `ArithmeticOverflow` | agent_wallet, codes 6000 to 6017 |
| `AuthorizationExpired`, `MissingSignatureVerification`, `SignatureMismatch`, `NonceAlreadyUsed`, `AccountMismatch`, `RetentionNotElapsed`, `NotFeePayer` | settlement, codes 6100 to 6106 |

## Resource SDK

`@turnstile/sdk-resource` turns a route into a paid route. It never sees an agent key. The full guide is [packages/sdk-resource/README.md](../packages/sdk-resource/README.md).

```ts
import { Hono } from "hono";
import { honoPaywall, type PaywallEnv } from "@turnstile/sdk-resource";

const app = new Hono<PaywallEnv>();
app.use(
  "*",
  honoPaywall({
    facilitatorUrl: "http://127.0.0.1:4020",
    payTo: "<owner of the receiving token account>",
    publicUrl: "https://api.example.com",
    routes: { "POST /v1/summarize": { price: "0.005", description: "Summarize a text" } },
  }),
);
app.post("/v1/summarize", (c) => c.json({ receipt: c.get("turnstilePayment")?.receipt }));
```

Exports are `createPaywall`, `honoPaywall`, `expressPaywall` (also plain `node:http`), `getSettlement`, `resourceIdHex`, `FacilitatorClient` and `FacilitatorUnavailableError`.

`PaywallOptions`

| Option | Default | Meaning |
| --- | --- | --- |
| `facilitatorUrl` | required | Facilitator base URL |
| `payTo` | required | Owner of the recipient token account, base58 |
| `routes` | required | Keyed by `"METHOD /path"`. Each has `price` (decimal, whole tokens), `description`, optional `mimeType` and `maxTimeoutSeconds` |
| `publicUrl` | request origin | External origin. The canonical resource is this origin plus the path without query string. Allow-lists are keyed by its hash |
| `fetch` | global fetch | Custom fetch |
| `timeoutMs` | 10000 | Timeout for requirements and verify calls |
| `settleTimeoutMs` | 60000 | Timeout for settle |

What a request gets.

| Situation | Response |
| --- | --- |
| Route not in `routes` | passes through |
| No `PAYMENT-SIGNATURE` | 402 with `PAYMENT-REQUIRED` and the same JSON body |
| Header not base64 JSON, or wrong shape | 402 with `reason: "invalid_payload"` and fresh requirements |
| Signed for a different price, payee, resource or asset | 402 with `reason: "requirements_mismatch"`. The facilitator is not called |
| Facilitator refuses | 402 with the facilitator reason and message |
| Payment settles | handler runs, response carries `PAYMENT-RESPONSE` |
| Same header sent again | handler runs again on the original receipt (`alreadySettled: true`), no second debit |
| Settlement outcome unknown | 503 with `Retry-After: 2`. Retrying the same header is safe |
| Facilitator unreachable | 503 `payment_service_unavailable`. The handler never runs |

A captured refusal body.

```json
{
  "x402Version": 2,
  "error": "The price is above the agent wallet's per-call cap. Ask the owner to raise the cap, or use a cheaper resource.",
  "resource": "http://127.0.0.1:3581/v1/report",
  "accepts": [{ "scheme": "turnstile-policy", "amount": "20000", "...": "trimmed" }],
  "reason": "PerCallCapExceeded",
  "message": "The price is above the agent wallet's per-call cap. Ask the owner to raise the cap, or use a cheaper resource."
}
```

## Agent SDK

`@turnstile/sdk-agent` pays a 402 from an agent wallet with a session key. It checks the payment against the wallet policy read from chain before the key signs anything.

```ts
import { createAgent, readKeypairFile } from "@turnstile/sdk-agent";

const agent = createAgent({
  rpcUrl: "http://127.0.0.1:8899",
  agentWallet: "<agent wallet PDA>",
  sessionKey: readKeypairFile("agent-session.json"),
  maxPerCall: "0.01",
  onPayment: (event) => console.log(event.type),
});

const res = await agent.fetch("http://127.0.0.1:4021/v1/summarize", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "..." }),
});
console.log(res.status, res.payment?.receipt);
```

`agent.fetch` behaves like `fetch`. It pays a 402 inside the policy and retries once. The settled payment is on `res.payment`. `agent.wallet({ refresh })` returns the cached wallet state.

`AgentOptions`

| Option | Default | Meaning |
| --- | --- | --- |
| `agentWallet` | required | Agent wallet PDA |
| `sessionKey` | required | `Keypair` or 64 byte secret. It never leaves the process |
| `rpcUrl` or `connection` | one required | Where the wallet is read from |
| `maxPerCall` | none | Local cap per call as a decimal, tighter than the chain |
| `localPolicyCheck` | true | Run the policy mirror before signing |
| `policyTtlMs` | 15000 | How long a wallet read stays fresh |
| `settlementProgram`, `agentWalletProgram` | the shared ids | Requirements naming another program are refused |
| `mintDecimals` | 6 | Used to parse `maxPerCall` |
| `onPayment` | none | Called inline with `settled`, `refused` or `rejected` events |
| `fetch`, `stateSource`, `now` | defaults | For tests and custom caching |

Between chain reads the SDK counts its own settled and in-flight payments toward the daily cap and the vault balance, so concurrent calls cannot overspend locally.

Errors. Every one extends `TurnstileAgentError` and has a stable `code`.

| Class | `code` | When |
| --- | --- | --- |
| `PolicyRefusedError` | `policy_refused` | Outside policy. Nothing was signed or sent. `reason` is a policy error name, `LocalCapExceeded`, `AuthorizationExpired` or `MintMismatch` |
| `PaymentRejectedError` | `payment_rejected` | The server or facilitator refused a signed payment. Carries `reason`, `status`, the authorization, the signature and the payload |
| `PaymentRequirementsError` | the reason | `missing_requirements`, `malformed_requirements`, `no_matching_requirement`, `untrusted_program`, `resource_id_mismatch` |
| `WalletStateError` | `wallet_state_unavailable` | The wallet could not be read from chain |
| `TurnstileAgentError` | `invalid_option` | Bad options at construction |

Captured errors from the docs run, serialized.

```json
{ "name": "PolicyRefusedError", "code": "policy_refused", "reason": "PerCallCapExceeded",
  "message": "The price 20000 is above the per-call cap of 10000.",
  "resource": "http://127.0.0.1:3581/v1/report", "amount": "20000" }
```

```json
{ "name": "PaymentRejectedError", "code": "payment_rejected", "reason": "PerCallCapExceeded", "status": 402,
  "message": "The price is above the agent wallet's per-call cap. Ask the owner to raise the cap, or use a cheaper resource." }
```

The first comes from the local check. The second comes from a run with `localPolicyCheck: false`, where the facilitator refused.

The package also ships a CLI, `turnstile-agent`, in `dist/cli.js`.

```sh
node packages/sdk-agent/dist/cli.js keygen --out agent-session.json   # mode 0600, prints only the public key
node packages/sdk-agent/dist/cli.js address agent-session.json
```

## Demo API

The metered API behind the live demo. Port 4021.

| Endpoint | Paid | Body | Answer |
| --- | --- | --- | --- |
| `GET /v1/catalog` | no | none | name, scheme, network, asset, decimals, payTo, facilitator and each route with its canonical resource, resource id and price |
| `POST /v1/summarize` | yes | `{ text, sentences? }` | extractive summary with `compressionRatio` |
| `POST /v1/keywords` | yes | `{ text, limit? }` (1 to 50) | `{ keywords }` |

`text` is 1 to 100,000 characters. The body is validated before the paywall, so bad input never costs money. The price per call is `DEMO_PRICE` (default `0.005`) and the recipient is `demoRecipient` from the deployment file.

## Console backend

Base URL `http://127.0.0.1:4022`. The full reference with captured examples of every endpoint is [packages/backend/README.md](../packages/backend/README.md).

Authentication has two forms.

- A console session. `POST /v1/auth/challenge` returns a Sign In With Solana style message. The owner wallet signs it and `POST /v1/auth/verify` sets an httpOnly `turnstile_session` cookie (SameSite=Lax, 12 hours, Secure with `COOKIE_SECURE=true`).
- A console API key as `Authorization: Bearer tsk_...`. Keys only read.

Writes made with the cookie must carry an `Origin` equal to `WEB_ORIGIN`, or they get `403 origin_not_allowed`. Session tokens and API keys are stored only as SHA-256 hashes.

| Endpoint | Auth |
| --- | --- |
| `POST /v1/auth/challenge`, `POST /v1/auth/verify`, `POST /v1/auth/signout` | none |
| `GET /v1/me` | session or API key |
| `GET /v1/receipts`, `GET /v1/receipts.csv`, `GET /v1/spend`, `GET /v1/summary` | session or API key |
| `GET /v1/agents`, `GET /v1/agents/:address` | session or API key |
| `GET /v1/api-keys`, `POST /v1/api-keys`, `DELETE /v1/api-keys/:id` | session only |
| `PUT /v1/agents/:address/label` | session only |
| `POST /v1/tx/create-agent`, `/deposit`, `/withdraw`, `/update-policy`, `/add-session-key`, `/revoke-session-key`, `/close-wallet`, `/confirm` | session only |

The backend never signs for the owner. Each `/v1/tx/*` builder returns unsigned legacy transactions with the owner as fee payer. The browser wallet signs and sends them, then calls `/v1/tx/confirm`.

A captured challenge.

```json
{
  "pubkey": "DJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4",
  "nonce": "ST7TFLsY6jRFHhzxYETYdU",
  "message": "localhost:3000 wants you to sign in with your Solana account:\nDJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4\n\nSign in to the Turnstile console. This request does not send a transaction or cost any fees.\n\nURI: http://localhost:3000\nVersion: 1\nChain ID: localnet\nNonce: ST7TFLsY6jRFHhzxYETYdU\nIssued At: 2026-09-29T15:12:38.734Z\nExpiration Time: 2026-09-29T15:17:38.734Z",
  "issuedAt": "2026-09-29T15:12:38.734Z",
  "expiresAt": "2026-09-29T15:17:38.734Z"
}
```

A captured confirm of a rejected withdraw.

```json
{
  "status": "failed",
  "error": { "code": 6007, "name": "InsufficientFunds",
             "message": "The vault does not hold enough tokens. Deposit more before paying or withdrawing" }
}
```

| Status | Error codes |
| --- | --- |
| 400 | `invalid_request`, `invalid_query`, `invalid_json`, `invalid_cursor`, `invalid_address`, `invalid_signature_encoding`, `insufficient_owner_balance`, `owner_token_account_missing`, `insufficient_vault_balance`, `transaction_too_large` |
| 401 | `unauthenticated`, `session_expired`, `invalid_authorization`, `invalid_api_key`, `api_key_revoked`, `unknown_challenge`, `challenge_used`, `challenge_expired`, `bad_signature` |
| 403 | `api_key_not_allowed`, `origin_not_allowed`, `not_agent_owner` |
| 404 | `not_found`, `api_key_not_found`, `agent_not_found`, `session_key_not_found` |
| 409 | `too_many_api_keys`, `agent_exists`, `duplicate_session_key`, `too_many_session_keys`, `session_key_revoked`, `vault_not_empty` |
| 415 | `unsupported_media_type` |
| 500 | `internal_error` |
| 503 | `mint_not_configured` |

### Web routes in front of the backend

The browser never calls the backend directly. `apps/web` proxies it so the session cookie is first party.

| Route | What it does |
| --- | --- |
| `/api/backend/*` | Same origin proxy to `TURNSTILE_BACKEND_URL`. Forwards `cookie`, `content-type`, `origin`, `x-request-id` and `authorization`. 502 when the backend does not answer |
| `GET /api/console/session` | `{ me }` from `/v1/me`, with `me: null` instead of a 401 |
| `GET /api/console/deployment` | Public facts from `DEPLOYMENT_FILE` (network, program ids, mint, decimals, facilitator) |
| `POST /api/console/send` | Passes an owner-signed transaction of at most 1232 bytes to the RPC node, for wallets that only sign. Refuses another `Origin` with 403. It holds no key |

## Demo agent runner

Port 4024. It runs one demo at a time. Each run creates a fresh agent wallet for the demo owner, funds it with 0.10 tUSDC, sets a per-call cap of 0.01 and a daily cap of 0.03, and pays `POST /v1/summarize` at 0.005 until the chain refuses. At most 12 calls run. The rest is withdrawn at the end.

| Endpoint | Answer |
| --- | --- |
| `GET /policy` | the policy a run sets up, with the allow-list from the demo API catalog. 503 `demo_api_unreachable` when the catalog cannot be read |
| `POST /runs` | 202 `{ runId }`. 409 `run_in_progress` with the running `runId`. 503 with the reason when setup cannot start, for example an underfunded demo owner |
| `GET /runs/latest` | `{ run, events }`. 404 `no_runs` |
| `GET /runs/:id` | `{ run, events }`. 404 `run_not_found` |
| `GET /runs/:id/events` | Server-Sent Events |

The web app proxies `GET /policy`, `GET /runs/latest`, `GET /runs/:id`, `GET /runs/:id/events` and `POST /runs` at `/demo/api/*`. It answers 503 `demo_agent_not_configured` when `TURNSTILE_DEMO_AGENT_URL` is unset and 502 `demo_agent_unreachable` when the runner does not answer.

### Event stream

Each SSE message has `id` set to the event `seq`, `event` set to the type and `data` set to the JSON `{ runId, seq, type, data, at }`. Send `Last-Event-ID` to resume. The stream replays history first, then follows live, sends `: keepalive` comments while idle and ends after a terminal event.

| Event | `data` fields |
| --- | --- |
| `run.started` | `runId`, `agentWallet`, `walletId`, `vault`, `policy`, `setupTransaction` |
| `call.settled` | `index`, `amount`, `receipt`, `transaction`, `rollingSpend`, `dailyCap`, `vaultBalance`, `passage`, `summaryExcerpt`, `compressionRatio`, `latencyMs` |
| `call.refused` | `index`, `amount`, `reason` (program error), `message`, `facilitatorReason`, `failedTransaction`, `programLogs`, `rollingSpend`, `dailyCap` |
| `run.finished` | `settledCalls`, `refusedCalls`, `totalSpent`, `withdrawn`, `withdrawTransaction`, `receipts`, `durationMs`. Terminal |
| `run.failed` | `reason`, `message`, optional `withdrawn` and `withdrawTransaction`. Terminal |

Amounts are `{ baseUnits, display }`. When the facilitator refuses a call, the runner sends the same signed authorization straight to the settlement program. `failedTransaction` is that failed transaction, so the refusal is proven on chain and not only by the facilitator. If the chain ever accepted it, the run fails with `limit_not_enforced`.
