# ADR 0006. Facilitator verify ends in a simulation of the exact settle transaction

Status. Accepted.

## Context

`POST /verify` tells a resource server whether a payment will settle. A wrong yes costs the server work it will not be paid for. A wrong no refuses a good customer.

The facilitator can check a lot off chain. It checks the payload, the terms, the signature, the expiry, the nonce, the wallet and the policy. The policy check uses `evaluatePayment` from `packages/shared`, a mirror of the program's `check_payment`. A mirror can drift from the program. It also cannot see everything, for example a recipient token account that belongs to someone else or a wallet whose vault was swapped.

## Decision

Verify runs its checks in a fixed order and stops at the first failure. The last step simulates the exact transaction that `settle` would send.

1. Offline checks. Shape, supported requirements, terms, authorization and Ed25519 signature.
2. Expiry of the authorization and of the requirements.
3. Chain reads. The receipt address (a used nonce), the wallet and its mint.
4. The policy mirror in program order, with the vault balance. This gives the specific reason quickly and without a simulation.
5. `simulateTransaction` of `[ed25519 instruction, settle]` with the facilitator as fee payer. A program error is returned by its name.

`settle` runs the same verify, then sends without preflight, since it just simulated. The chain still checks everything again when the transaction lands.

## Consequences

- The program has the final word before any money moves. A drift between the mirror and the program shows up as a verify refusal, not as a failed settlement.
- Each verify costs one simulation and a few account reads. The paid request median on a lightly loaded host was about 440 ms including settle at `confirmed`.
- When the RPC node is down, verify answers 503 `chain_unavailable` rather than a verdict.
- A simulation is a snapshot. A payment that passes verify can still fail at settle if the wallet changes in between, for example when two payments race for the last of the daily cap. That failure is final and returned by name.
