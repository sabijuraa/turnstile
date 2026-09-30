# ADR 0002. Settlement idempotency by nonce

Status. Accepted.

## Context

The facilitator may retry a settlement after a timeout without knowing whether the first attempt landed. A retry must never pay twice. A replayed authorization must also never pay twice.

## Decision

Every authorization carries a 32 byte nonce. The receipt is a PDA of the settlement program with seeds `["receipt", agent_wallet, nonce]`.

- `settle` checks the receipt address before doing anything with money. If this program already owns it, `settle` fails with `NonceAlreadyUsed`. The check runs before the account is created, so the caller gets that specific error and not a generic system program error.
- If the address holds lamports but no data, `settle` tops it up, allocates and assigns it. Nobody can block a nonce by sending SOL to its receipt address first.
- The receipt is written in the same instruction as the debit. Either both happen or neither does.
- The facilitator derives the receipt address before submitting. If a matching receipt exists it returns that receipt as a success.

## Consequences

- Replay protection needs no extra state and no cleanup job. The receipt is both the proof of payment and the spent nonce record.
- Each receipt costs rent, paid by the fee payer. See the amendment below for how that rent comes back.
- Nonces must be unpredictable per payment. The shared `randomNonce` helper draws 32 random bytes.

## Amendment. Receipt rent is reclaimed after a retention period

### Context

A receipt is 329 bytes and holds 3,180,720 lamports of rent, about 0.0032 SOL. The facilitator fee payer pays it on every settlement. For a 0.005 USD micropayment that deposit costs the facilitator far more than the payment is worth. Keeping every receipt forever makes the fee payer's locked SOL grow with every request.

### Decision

- The receipt stores `expires_at`, the expiry of the authorization it settled. `PaymentSettled` carries it too.
- `close_receipt` lets the fee payer named in the receipt close it once `RECEIPT_RETENTION_SECONDS` (7 days) have passed since `expires_at`. All lamports go back to that fee payer. Anyone else gets `NotFeePayer`, and an early close gets `RetentionNotElapsed`.
- The facilitator runs `pnpm --filter @turnstile/facilitator reclaim` to find its own receipts past retention and close them in batches.

### Why a closed receipt does not reopen its nonce

Closing empties the receipt address, so the nonce check alone would accept the authorization again. It never gets that far. `settle` refuses an authorization whose `expires_at` has passed before it looks at the receipt, and a receipt can only be closed 7 days after that moment. Any replay of the original signed authorization fails with `AuthorizationExpired` and moves no funds. The LiteSVM test `replay_after_close_fails_as_expired_and_moves_no_funds` proves it. A new payment needs a new signature with a new nonce and a fresh expiry.

### Consequences

- The fee payer's cost per payment falls to the transaction fees. The rent is a deposit held for the authorization lifetime plus 7 days.
- Receipts stay on chain for at least 7 days after the authorization expires. During that window `verify_receipt` and the facilitator's `alreadySettled` answer keep working. After it they fail, and a retried settle of the same payload answers `authorization_expired`.
- The permanent record is the `PaymentSettled` event in the settlement transaction log and the indexer's `receipts` table. The event carries every receipt field. The indexer already indexes a receipt from the event alone when the account is gone.
- The Receipt layout grew by 8 bytes. Receipts written by the earlier build are 321 bytes, do not decode, and cannot be closed. Only local ledgers held them.
