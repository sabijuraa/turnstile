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
- Each receipt costs rent, paid by the fee payer. Receipts are never closed, since closing one would let its nonce settle again.
- Nonces must be unpredictable per payment. The shared `randomNonce` helper draws 32 random bytes.
