# @turnstile/backend

The console backend. It signs owners in with their wallet, issues console API keys and serves receipts and spend from the indexer store. It never holds an agent key or an owner key.

- Hono app built by `createApp(deps)`. It runs under `@hono/node-server` (`src/main.ts`) or inside any fetch based host such as a Next.js route handler.
- Postgres, the Solana connection, config and the clock are injected.
- Migrations from `@turnstile/shared/db` run at startup.
- Default port 4022.

## Run it

```sh
pnpm --filter @turnstile/backend build
DATABASE_URL=postgres://turnstile:turnstile@127.0.0.1:5433/turnstile \
  pnpm --filter @turnstile/backend start
```

Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4022` | HTTP port |
| `DATABASE_URL` | required | Postgres connection string |
| `TURNSTILE_NETWORK` | `localnet` | `localnet` or `devnet` |
| `SOLANA_RPC_URL` | the network default | Solana JSON RPC endpoint |
| `DEPLOYMENT_FILE` | unset | Deployment JSON with program and mint addresses. Checked at startup when set |
| `WEB_ORIGIN` | `http://localhost:3000` | Origin of the web app. Used for CORS, the sign-in message and the write origin check |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS so the session cookie is marked Secure |
| `LOG_LEVEL` | `info` | pino log level |

A bad variable stops the process at startup with one line per problem, for example `TURNSTILE_NETWORK must be localnet or devnet`.

## Authentication

Two ways to call the API.

- A console session. The owner signs a sign-in message with their wallet and gets an httpOnly `turnstile_session` cookie (SameSite=Lax, Secure when `COOKIE_SECURE=true`, 12 hours).
- A console API key sent as `Authorization: Bearer tsk_...`. Keys only read. They work on `/v1/me`, `/v1/receipts`, `/v1/receipts.csv`, `/v1/spend` and `/v1/summary`.

Rules that apply everywhere

- Session tokens and API keys are stored only as SHA-256 hashes.
- Writes made with the session cookie must come from `WEB_ORIGIN`. A request with any other `Origin` header gets `403 origin_not_allowed`.
- Request bodies must be JSON with `Content-Type: application/json`.
- Every response carries `x-request-id`. Send your own `x-request-id` to trace a call through the logs.

| Endpoint | Auth |
| --- | --- |
| `GET /healthz`, `GET /readyz`, `GET /metrics` | none |
| `POST /v1/auth/challenge`, `POST /v1/auth/verify`, `POST /v1/auth/signout` | none |
| `GET /v1/me` | session or API key |
| `GET /v1/receipts`, `GET /v1/receipts.csv`, `GET /v1/spend`, `GET /v1/summary` | session or API key |
| `GET /v1/api-keys`, `POST /v1/api-keys`, `DELETE /v1/api-keys/:id` | session only |
| `PUT /v1/agents/:address/label` | session only |

## Errors

Every error has the same shape. The message says what went wrong and what to do next.

```json
{ "error": { "code": "api_key_revoked", "message": "This API key was revoked. Create a new key in console settings and use it instead." } }
```

| Status | Codes |
| --- | --- |
| 400 | `invalid_request`, `invalid_query`, `invalid_json`, `invalid_cursor`, `invalid_address`, `invalid_signature_encoding` |
| 401 | `unauthenticated`, `session_expired`, `invalid_authorization`, `invalid_api_key`, `api_key_revoked`, `unknown_challenge`, `challenge_used`, `challenge_expired`, `bad_signature` |
| 403 | `api_key_not_allowed`, `origin_not_allowed`, `not_agent_owner` |
| 404 | `not_found`, `api_key_not_found` |
| 409 | `too_many_api_keys` |
| 415 | `unsupported_media_type` |
| 500 | `internal_error` |

## Examples

The examples below were captured from a local run on 29 Sep 2026 against a local validator. The receipt and dead letter rows were fixture rows inserted into a throwaway database for the capture, so addresses and signatures are random. Long lists are trimmed where marked.

### Sign in

`POST /v1/auth/challenge` takes the owner wallet address and returns the exact message to sign. It follows the Sign In With Solana layout. The challenge is valid for 5 minutes and works once.

```http
POST /v1/auth/challenge
Content-Type: application/json

{ "pubkey": "DJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4" }
```

```json
{
  "pubkey": "DJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4",
  "nonce": "ST7TFLsY6jRFHhzxYETYdU",
  "message": "localhost:3000 wants you to sign in with your Solana account:\nDJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4\n\nSign in to the Turnstile console. This request does not send a transaction or cost any fees.\n\nURI: http://localhost:3000\nVersion: 1\nChain ID: localnet\nNonce: ST7TFLsY6jRFHhzxYETYdU\nIssued At: 2026-09-29T15:12:38.734Z\nExpiration Time: 2026-09-29T15:17:38.734Z",
  "issuedAt": "2026-09-29T15:12:38.734Z",
  "expiresAt": "2026-09-29T15:17:38.734Z"
}
```

The browser asks the wallet to sign `message` as UTF-8 bytes (`signMessage`) and sends the 64 byte Ed25519 signature in base58.

```http
POST /v1/auth/verify
Content-Type: application/json

{ "pubkey": "DJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4", "nonce": "ST7TFLsY6jRFHhzxYETYdU", "signature": "<base58 signature>" }
```

```http
HTTP/1.1 200 OK
Set-Cookie: turnstile_session=<token>; Max-Age=43200; Path=/; HttpOnly; SameSite=Lax

{ "owner": "DJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4", "expiresAt": "2026-09-30T03:12:38.971Z" }
```

Sending the same nonce again fails.

```json
{ "error": { "code": "challenge_used", "message": "This sign-in request was already used. Start sign-in again to get a fresh one." } }
```

A wrong key or a changed message gives `401 bad_signature`. A challenge older than 5 minutes gives `401 challenge_expired`.

`POST /v1/auth/signout` deletes the session and clears the cookie. It returns `{ "signedOut": true }`.

### Who am I

```http
GET /v1/me
Cookie: turnstile_session=<token>
```

```json
{
  "owner": "DJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4",
  "authMethod": "session",
  "network": "localnet",
  "createdAt": "2026-09-29T15:12:38.971Z",
  "lastSeenAt": "2026-09-29T15:12:38.971Z"
}
```

Without a session or key.

```json
{ "error": { "code": "unauthenticated", "message": "Sign in to the console or send an API key as Authorization: Bearer tsk_... and try again." } }
```

### API keys

Create a key. The full key is in this response only. The database keeps its SHA-256 hash and the display prefix. An owner can hold 25 active keys.

```http
POST /v1/api-keys
Cookie: turnstile_session=<token>
Content-Type: application/json

{ "name": "reporting job" }
```

```json
{
  "apiKey": {
    "id": "key_76ee11ee-fa11-4ce7-b267-d2a3f95f8859",
    "name": "reporting job",
    "prefix": "tsk_DnR1mg",
    "createdAt": "2026-09-29T15:12:39.169Z",
    "lastUsedAt": null,
    "revokedAt": null,
    "status": "active"
  },
  "key": "tsk_DnR1mgDBwbLLwQ7AxuMFSNXYzCXbP6TEBMWEzBhT1sAd",
  "notice": "Copy this key now. It is shown only once and cannot be recovered."
}
```

`GET /v1/api-keys` returns `{ "apiKeys": [ ...same objects without the key ] }`, active keys first. `lastUsedAt` updates on every authenticated call.

Revoke a key.

```http
DELETE /v1/api-keys/key_76ee11ee-fa11-4ce7-b267-d2a3f95f8859
Cookie: turnstile_session=<token>
```

```json
{
  "apiKey": {
    "id": "key_76ee11ee-fa11-4ce7-b267-d2a3f95f8859",
    "name": "reporting job",
    "prefix": "tsk_DnR1mg",
    "createdAt": "2026-09-29T15:12:39.169Z",
    "lastUsedAt": "2026-09-29T15:12:39.257Z",
    "revokedAt": "2026-09-29T15:12:39.281Z",
    "status": "revoked"
  }
}
```

A revoked key is refused.

```json
{ "error": { "code": "api_key_revoked", "message": "This API key was revoked. Create a new key in console settings and use it instead." } }
```

A key used on a management endpoint is refused.

```json
{ "error": { "code": "api_key_not_allowed", "message": "API keys can only read receipts, spend and the summary. Sign in to the console to make this change." } }
```

### Receipts

`GET /v1/receipts` lists the signed-in owner's receipts. Another owner's receipts never appear, whatever the filters.

Query parameters

- `agent` agent wallet address.
- `resource` a 64 character hex resource id, a resource URL or a canonical resource string. URLs are canonicalized and hashed the same way the programs do.
- `from` inclusive and `to` exclusive, ISO 8601 date or timestamp.
- `search` matches the start of a signature, receipt address, agent wallet, recipient or nonce, and any part of the resource string or agent label.
- `sort` one of `newest` (default), `oldest`, `amount_desc`, `amount_asc`.
- `limit` 1 to 200, default 50.
- `cursor` the `nextCursor` of the previous page. A cursor only works with the sort that produced it.

Amounts are base units as strings, plus an exact decimal `displayAmount` in whole stablecoin units. `resource` comes from the receipt or from the `resources` table.

```http
GET /v1/receipts?limit=2
Authorization: Bearer tsk_DnR1mgDBwbLLwQ7AxuMFSNXYzCXbP6TEBMWEzBhT1sAd
```

```json
{
  "receipts": [
    {
      "receiptAddress": "GgQoxMGjWey48x8pSBnUtE1tqAoNRfL34kdoFX9rSaQe",
      "signature": "2ugSV8h5fovf3kFUZcsqLnj5LLXvrFQ31bd4ytLfUuTNGSZ2wzC9EbWfTm9h5Dw3j7yywCsdfgwiusnBCq9m7XNo",
      "slot": "1000",
      "blockTime": "2026-09-29T15:11:39.014Z",
      "agentWallet": "kEFKmiZpSzthePiUDTLPPdX2MbAe52swRqT8WkwYUcW",
      "agentLabel": "research bot",
      "owner": "DJALXfrynH6hWNmBTm5LKpSLXr8Vca6ym6uh5fPMB6c4",
      "sessionKey": "GvDxMKgHQxX1or1TbevMK3fLmq1UsugNHDJb6xus1ae6",
      "recipient": "DjLQQL3oFEuqfK8fTS91ySehqHBYsyXjZdZxaNvnhAoo",
      "recipientToken": "347fxiU6romV4FxHuF9zz17QzZL8sbVtfaDhH1qH7AJV",
      "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      "amount": "2500",
      "displayAmount": "0.0025",
      "resourceId": "eff6aba3234c1c5bfe3ab4219b80ff4191d5e05596dce210c922826059da70b0",
      "resource": "https://demo.turnstile.dev/v1/summarize",
      "nonce": "75da30b493915699d9c29ea028bab2d6fba530dd9dfe7b3b08f562c5ac3a6a66",
      "feePayer": "HuEVYWDP1pvn4kkqVKxaBE9E4oDFYvTH53AbMeJivxEG",
      "network": "solana:localnet",
      "status": "settled",
      "explorerUrl": "https://explorer.solana.com/tx/2ugSV8h5fovf3kFUZcsqLnj5LLXvrFQ31bd4ytLfUuTNGSZ2wzC9EbWfTm9h5Dw3j7yywCsdfgwiusnBCq9m7XNo?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899"
    }
  ],
  "nextCursor": "eyJzIjoibmV3ZXN0IiwiayI6IjIwMjYtMDktMjkgMjA6MDU6MzkuMDE0KzA1IiwiYSI6ImpEd1N4SEx4S3FiS3ZHZTk3RmdiUFRKelJHVnlTZlp5MnRGdEdDUnI4QVkifQ"
}
```

The second receipt of that page is trimmed. The last page returns `"nextCursor": null`.

A bad parameter names the field.

```json
{ "error": { "code": "invalid_query", "message": "limit must be 200 or less." } }
```

### CSV statement

`GET /v1/receipts.csv` takes the same filters and sort as `/v1/receipts` without `limit` and `cursor`. It streams every matching receipt. `amount` is the exact decimal and `amount_base_units` the raw integer. Cells that start with `=`, `+`, `-` or `@` get a leading `'` so spreadsheets do not run them.

```http
GET /v1/receipts.csv?agent=kEFKmiZpSzthePiUDTLPPdX2MbAe52swRqT8WkwYUcW
Authorization: Bearer tsk_DnR1mgDBwbLLwQ7AxuMFSNXYzCXbP6TEBMWEzBhT1sAd
```

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="turnstile-receipts-2026-09-29.csv"
```

```csv
block_time,receipt_address,signature,agent_wallet,agent_label,resource,resource_id,recipient,mint,amount,amount_base_units,nonce,slot,network,status
2026-09-29T14:32:39.014Z,Ha11vuCoamKvvhYvfJmqYGKWFHUzE2vF1o6zpMaKZiBN,5riEVLAB5BuqMBimyVUvte2PZ72oLnoNhXbh6YWWiUR1ExPNd9s276kX7brVRrHZHRCUYPGbeQyBs3PUG66zUDVx,kEFKmiZpSzthePiUDTLPPdX2MbAe52swRqT8WkwYUcW,research bot,https://demo.turnstile.dev/v1/summarize,eff6aba3234c1c5bfe3ab4219b80ff4191d5e05596dce210c922826059da70b0,8EZTf81KupgvF4NtCuTRXM2e5Eg28hqiDYLqz7thJRFQ,4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU,0.012,12000,a5c4e8a2f8c00e5755f8e8039faf3bdfa7cd793ca4e13ac05b8874709b403549,1002,solana:localnet,settled
2026-09-28T13:12:39.014Z,6SqozGszpLCkJXXPwG5SqF2QVt6bgYcZDa9QJXDTTM9q,57io2ik1jypHuC8BjnhP8bh6K7B333MttHjfMjqoniE7Vzi2pymSjYJ4N8paHnyB5HhX7VQUGanndjDkDsFuWQzr,kEFKmiZpSzthePiUDTLPPdX2MbAe52swRqT8WkwYUcW,research bot,https://demo.turnstile.dev/v1/summarize,eff6aba3234c1c5bfe3ab4219b80ff4191d5e05596dce210c922826059da70b0,AVDSbFnLQexfubftLkx31Tupzrcj465a8SmrpSWvSNSJ,4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU,1,1000000,2468b673ab0add9830401c82ce8e8d0cd9628b91b353515613dac80165ebbbdf,1003,solana:localnet,settled
```

Two of the four rows are trimmed.

### Spend over time

`GET /v1/spend?range=24h|7d|30d` (default `7d`, optional `agent`). `24h` gives 24 hourly buckets and the others give daily buckets. Buckets align to whole UTC hours or days, and the last one holds the current hour or day. Empty buckets are present with zero.

```http
GET /v1/spend?range=24h
```

```json
{
  "range": "24h",
  "bucket": "hour",
  "from": "2026-09-28T16:00:00.000Z",
  "to": "2026-09-29T16:00:00.000Z",
  "series": [
    { "start": "2026-09-29T13:00:00.000Z", "amount": "0", "displayAmount": "0", "count": 0 },
    { "start": "2026-09-29T14:00:00.000Z", "amount": "12000", "displayAmount": "0.012", "count": 1 },
    { "start": "2026-09-29T15:00:00.000Z", "amount": "5000", "displayAmount": "0.005", "count": 2 }
  ],
  "totals": { "amount": "17000", "displayAmount": "0.017", "count": 3 }
}
```

The first 21 buckets are trimmed.

### Dashboard summary

`GET /v1/summary?range=24h|7d|30d` (default `7d`) returns everything the dashboard needs in one call.

- `totalSpend` and `settlementCount` over the same window as `/v1/spend`.
- `activeAgents` counts distinct agent wallets with a receipt in the window.
- `recentReceipts` holds the 8 newest receipts in the same shape as `/v1/receipts`.
- `failures` lists settlements waiting in the facilitator dead letter table (`status = pending`) for this owner's agent wallets.

```json
{
  "range": "7d",
  "from": "2026-09-23T00:00:00.000Z",
  "to": "2026-09-30T00:00:00.000Z",
  "totalSpend": { "amount": "1017000", "displayAmount": "1.017" },
  "settlementCount": 4,
  "activeAgents": 1,
  "recentReceipts": [ { "receiptAddress": "GgQoxMGjWey48x8pSBnUtE1tqAoNRfL34kdoFX9rSaQe", "amount": "2500", "displayAmount": "0.0025" } ],
  "failures": {
    "pendingCount": 1,
    "items": [
      {
        "id": "1",
        "agentWallet": "kEFKmiZpSzthePiUDTLPPdX2MbAe52swRqT8WkwYUcW",
        "nonce": "2a8d6268cdd5383124aa61839c29c4be5ad24a5698e50c86c11feac6b4239f2d",
        "error": "Transaction was not confirmed in 30 seconds",
        "attempts": 3,
        "amount": "2500",
        "displayAmount": "0.0025",
        "resource": "https://demo.turnstile.dev/v1/summarize",
        "createdAt": "2026-09-29T15:12:39.128Z",
        "updatedAt": "2026-09-29T15:12:39.128Z",
        "status": "pending"
      }
    ]
  }
}
```

The receipt fields in `recentReceipts` are trimmed.

### Agent labels

`PUT /v1/agents/:address/label` names an agent wallet for the console. The owner must own the wallet. Ownership is proven by a receipt for that wallet under this owner, or by reading the `owner` field of the AgentWallet account on chain.

```http
PUT /v1/agents/kEFKmiZpSzthePiUDTLPPdX2MbAe52swRqT8WkwYUcW/label
Cookie: turnstile_session=<token>
Content-Type: application/json

{ "label": "research bot" }
```

```json
{ "agentWallet": "kEFKmiZpSzthePiUDTLPPdX2MbAe52swRqT8WkwYUcW", "label": "research bot" }
```

Another owner's wallet gives `403 not_agent_owner`.

## Health, readiness and metrics

- `GET /healthz` answers `{"status":"ok","service":"backend"}` while the process runs.
- `GET /readyz` checks Postgres with `SELECT 1` and Solana with `getSlot`, each with a 3 second limit.

```json
{"status":"ready","checks":{"database":{"ok":true,"ms":21},"solana":{"ok":true,"ms":51}}}
```

When a dependency fails it answers 503 and names it. This one was captured with `DATABASE_URL` pointing at a closed port.

```json
{"status":"unavailable","failed":["database"],"checks":{"database":{"ok":false,"ms":44,"error":"connect ECONNREFUSED 127.0.0.1:1"},"solana":{"ok":true,"ms":87}}}
```

- `GET /metrics` serves Prometheus metrics. Request count and latency are labelled by method, route pattern and status. Domain counters cover sign-ins by result, API key auth by result, keys created and revoked, CSV exports and CSV rows.

```text
turnstile_backend_http_requests_total{method="POST",route="/v1/auth/verify",status="401"} 1
turnstile_backend_http_requests_total{method="PUT",route="/v1/agents/:address/label",status="200"} 1
turnstile_backend_http_requests_total{method="GET",route="/v1/receipts.csv",status="200"} 1
```

Logs are JSON lines from pino with the request id.

```json
{"level":30,"time":1790694759315,"service":"backend","requestId":"b28c4892-90b6-4baa-be6e-290f3109f8ba","method":"GET","path":"/v1/me","route":"/v1/me","status":401,"ms":1.88,"msg":"request"}
```

## Tests

Tests run against a real Postgres. They use `TEST_DATABASE_URL` or by default `postgres://turnstile_backend_test:turnstile_backend_test@127.0.0.1:5432/turnstile_backend_test`. Create it once on the host.

```sh
sudo -u postgres psql -c "CREATE ROLE turnstile_backend_test LOGIN PASSWORD 'turnstile_backend_test'"
sudo -u postgres psql -c "CREATE DATABASE turnstile_backend_test OWNER turnstile_backend_test"
pnpm --filter @turnstile/backend test
```

Tests insert receipt rows directly as fixtures and truncate the tables between cases.
