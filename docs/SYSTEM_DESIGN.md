# System design

Turnstile settles one payment per HTTP request on Solana. The chain holds the funds, enforces the owner's policy and keeps the receipts. Everything off chain is there for speed and convenience.

## Components

- `programs/agent-wallet` holds agent funds in a vault, stores the spending policy and the session keys, and debits the vault only when the settlement program asks and policy allows.
- `programs/settlement` checks a signed payment authorization, consumes its nonce, asks the agent wallet program to debit, and writes a receipt. All in one instruction.
- `packages/facilitator` is the x402 facilitator. It builds payment requirements, verifies payment payloads and submits settlement transactions. It pays network fees but can never move agent funds on its own.
- `packages/sdk-resource` turns an HTTP route into a paid route.
- `packages/sdk-agent` pays a 402 automatically inside a local copy of the policy.
- `packages/demo-api` is a real metered API (text summarization) plus the demo agent runner.
- `packages/indexer` follows receipts from the chain into Postgres and resumes from a checkpoint.
- `packages/backend` serves the console. It builds unsigned owner transactions, issues console API keys and queries the indexer store.
- `packages/shared` holds program ids, IDLs, the authorization encoding, resource ids, config and database migrations.
- `apps/web` is the marketing site, the console and the live demo.

## Trust boundaries

- The chain is the source of truth for funds, policy, session keys and receipts.
- The owner authority lives in the owner's own wallet. It signs policy and funding transactions in the browser.
- The agent holds one scoped session key. It signs payment authorizations and nothing else.
- The facilitator holds a fee payer key. That key can submit transactions and pay fees. It has no authority over any vault.
- The console backend and the frontend never see an agent key or an owner key.

## On-chain design

### Program ids

| Program | Id |
| --- | --- |
| agent_wallet | `7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb` |
| settlement | `6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z` |

The same ids are used on the local validator and on devnet.

### Accounts

`AgentWallet` is a PDA of the agent_wallet program.

- Seeds are `["agent_wallet", owner, id as u64 little endian]`.
- Fields are `owner`, `id`, `mint`, `vault`, `bump`, `vault_bump`, `created_at`, `per_call_cap`, `daily_cap`, up to 4 `session_keys`, up to 16 `allow_list` entries, 97 `spend_buckets`, `total_spent`, `settlement_count`.
- A session key entry is `{ key, expires_at, active }`. An `expires_at` of 0 means no expiry.
- An allow-list entry is `{ resource_id: [u8; 32], recipient: Pubkey }`. A payment is allowed only when the pair `(resource_id, recipient)` is on the list. Binding the recipient stops a compromised resource server from pointing an allowed resource at its own address.
- An empty allow-list allows nothing.
- The account holds up to 16 entries, but one `update_policy` transaction fits at most 15 under the 1232 byte transaction limit. The client builders and the console therefore cap the allow-list at 15.

`Vault` is an SPL token account PDA with seeds `["vault", agent_wallet]`. Its authority is the agent wallet PDA.

`Receipt` is a PDA of the settlement program with seeds `["receipt", agent_wallet, nonce]`.

- Fields are `agent_wallet`, `owner`, `session_key`, `recipient`, `recipient_token`, `mint`, `amount`, `resource_id`, `nonce`, `slot`, `unix_timestamp`, `fee_payer`, `bump`, `expires_at`. `expires_at` is the expiry of the settled authorization.
- The account is 329 bytes with the discriminator. `fee_payer` starts at byte 288 and `expires_at` at byte 321.
- A receipt can only be created once per nonce, which is the replay protection.
- The fee payer that paid its rent may close it once `RECEIPT_RETENTION_SECONDS` (604800, 7 days) have passed since `expires_at`. See Receipt rent below.

`SettlementAuthority` is a PDA of the settlement program with seeds `["settlement_authority"]`. It signs the CPI into `agent_wallet::debit`. The agent_wallet program accepts a debit only when this exact PDA signs.

### Rolling daily cap

The daily cap covers a rolling 24 hour window, tracked in 15 minute buckets.

- Bucket index is `floor(unix_timestamp / 900)`.
- The wallet keeps a ring of 97 buckets, each `{ index: i64, amount: u64 }`.
- Rolling spend is the sum of buckets with `index >= now_index - 96`.
- A payment therefore counts toward the cap for at least 24 hours and at most 24 hours 15 minutes. The window errs on the side of the owner and never lets more than the cap through in any true 24 hour period.

### Instructions

agent_wallet, all owner-signed except `debit`.

- `create_wallet(id, per_call_cap, daily_cap, session_key, session_expires_at)` creates the wallet and the vault for a given mint.
- `deposit(amount)` moves tokens from an owner token account into the vault.
- `withdraw(amount)` moves tokens from the vault to an owner token account.
- `add_session_key(key, expires_at)` and `revoke_session_key(key)`.
- `update_policy(per_call_cap, daily_cap, allow_list)` replaces the policy atomically. The per-call cap may not exceed the daily cap.
- `close_wallet()` closes an empty vault and the wallet and returns rent to the owner.
- `debit(session_key, amount, resource_id)` is callable only through CPI signed by the settlement authority PDA. It checks the session key is active and unexpired, the per-call cap, the allow-list pair, and the rolling daily cap, then records spend and transfers from the vault to the recipient token account.

settlement.

- `settle(authorization)` must be preceded in the same transaction by an Ed25519 program instruction that verifies the session key signature over the authorization message. It checks expiry, checks that signature via the instructions sysvar, refuses a used nonce, CPIs into `debit`, writes the receipt and emits `PaymentSettled`.
- `verify_receipt(authorization)` is a read only check that the receipt for the authorization exists and records exactly that payment.
- `close_receipt()` takes the receipt (writable) and the fee payer (writable, signer). The receipt must be the PDA its own `agent_wallet` and `nonce` derive and must name this fee payer, or it fails with `NotFeePayer`. It succeeds only when chain time is greater than `expires_at + RECEIPT_RETENTION_SECONDS`, otherwise `RetentionNotElapsed`. It zeroes the account and returns every lamport to the fee payer.

### Receipt rent

Each receipt holds 3,180,720 lamports of rent, measured in LiteSVM and on a local validator for the 329 byte account. The facilitator fee payer pays it. For a 0.005 USD payment that deposit is far larger than the payment, so it has to come back.

- `pnpm --filter @turnstile/facilitator reclaim` finds the receipts whose `fee_payer` is this facilitator, closes the ones past retention in batches and logs the lamports reclaimed.
- A closed receipt never lets its nonce settle again. `settle` checks `authorization.expires_at` before it looks at the receipt, and a receipt can only be closed 7 days after that expiry, so a replay fails with `AuthorizationExpired` and moves no funds.
- The `PaymentSettled` event in the transaction log and the indexer `receipts` table are the permanent record. `verify_receipt` and the facilitator's receipt lookup only work while the receipt is on chain, which is at least 7 days after the authorization expired.

### Payment authorization

```
PaymentAuthorization {
  agent_wallet: Pubkey,
  session_key:  Pubkey,
  recipient:    Pubkey,   // owner of the recipient token account
  mint:         Pubkey,
  amount:       u64,      // base units
  resource_id:  [u8; 32],
  nonce:        [u8; 32],
  expires_at:   i64,      // unix seconds
}
```

The signed message is `"TURNSTILE_PAYMENT_V1"` (20 ASCII bytes) followed by the settlement program id (32 bytes) followed by the Borsh encoding of the authorization (208 bytes). Total 260 bytes. The encoder lives in `packages/shared` and is the only one used off chain.

### Resource id

`resource_id = sha256("turnstile:resource:" + resource)` where `resource` is the canonical resource string, the absolute URL of the route without query string, for example `https://demo.turnstile.dev/v1/summarize`.

### Errors

agent_wallet errors are `SessionKeyNotFound`, `SessionKeyRevoked`, `SessionKeyExpired`, `PerCallCapExceeded`, `DailyCapExceeded`, `ResourceNotAllowed`, `UnauthorizedCaller`, `InsufficientFunds`, `ZeroAmount`, `InvalidPolicy`, `TooManySessionKeys`, `AllowListTooLong`, `DuplicateSessionKey`, `VaultNotEmpty`, `MintMismatch`, `RecipientMismatch`, `AccountMismatch`, `ArithmeticOverflow`. Codes are 6000 to 6017 in that order.

settlement errors are `AuthorizationExpired`, `MissingSignatureVerification`, `SignatureMismatch`, `NonceAlreadyUsed`, `AccountMismatch`, `RetentionNotElapsed`, `NotFeePayer`. Codes are 6100 to 6106 in that order, so they never collide with agent_wallet codes that surface through the debit CPI.

`PaymentSettled` is emitted with `emit!`. It is a `Program data:` log line inside the settlement invocation and carries every receipt field, `expires_at` included, plus the receipt address.

## x402 interface

Turnstile follows x402 version 2 transport. The scheme is `turnstile-policy` on network `solana:<genesis hash>`.

- A 402 response carries a `PAYMENT-REQUIRED` header with base64 JSON `{ x402Version: 2, error, resource, accepts: [PaymentRequirements] }`. The same JSON is the body.
- `PaymentRequirements` is `{ scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra: { resourceId, nonce, settlementProgram, agentWalletProgram, facilitator } }`. Amounts are decimal strings in base units.
- The client retries with a `PAYMENT-SIGNATURE` header holding base64 JSON `{ x402Version: 2, resource, accepted: PaymentRequirements, payload: { authorization, signature } }`. The authorization fields are base58 or hex strings, and `signature` is base58.
- A paid response carries `PAYMENT-RESPONSE` with base64 JSON `{ success, transaction, network, payer, receipt }`.
- The facilitator exposes `GET /supported`, `POST /requirements`, `POST /verify` and `POST /settle`. `verify` and `settle` take `{ paymentPayload, paymentRequirements }`.

## Settlement idempotency and dead letters

- The nonce is part of the receipt address, so the chain refuses a second settlement of the same authorization.
- Before submitting, the facilitator derives the receipt address. If a receipt already exists and matches the authorization, `settle` returns the existing receipt as a success. A retry never double spends. After the receipt has been closed a retry fails as expired.
- A settlement that fails for a reason other than a policy rejection goes to the `settlement_dead_letters` table with the full payload, the error and the attempt count. `pnpm --filter @turnstile/facilitator replay` replays them. Policy rejections are final and are returned to the caller, not queued.

## Indexer

- The indexer polls `getSignaturesForAddress` for the settlement program, walks forward from its checkpoint, fetches each transaction, decodes `PaymentSettled` events and reads the receipt account. A receipt already closed is indexed from the event alone.
- Each batch writes receipts with `ON CONFLICT (receipt_address) DO NOTHING` and advances the checkpoint in the same database transaction. A crash before commit replays the batch. A crash after commit resumes past it. No gaps, no duplicates.

## Data

Postgres holds the queryable state. Migrations live in `packages/shared/migrations`.

- `receipts` and `indexer_checkpoints` belong to the indexer.
- `settlement_dead_letters` belongs to the facilitator.
- `owners`, `console_sessions` and `api_keys` belong to the backend. API keys and session tokens are stored as SHA-256 hashes.

## Local ports

| Service | Port |
| --- | --- |
| web | 3000 |
| facilitator | 4020 |
| demo-api | 4021 |
| backend | 4022 |
| indexer (health and metrics) | 4023 |
| demo-agent | 4024 |
| solana-test-validator | 8899, 8900 |
| postgres | 5433 |
