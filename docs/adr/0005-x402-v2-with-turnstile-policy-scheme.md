# ADR 0005. x402 v2 transport with a custom turnstile-policy scheme

Status. Accepted.

## Context

Agents and resource servers should speak a payment protocol they may already know. x402 gives the shape. A 402 names what to pay, the client retries with a signed payment, and a facilitator verifies and settles it.

The common x402 schemes on Solana have the client sign a token transfer. That transfer moves money from a wallet the client controls. Turnstile needs something else.

- The money sits in a vault that the agent cannot move on its own.
- The owner's policy (per-call cap, rolling daily cap, allow-list) must be checked by the program in the same instruction that moves the money.
- The agent holds only a scoped session key. It must not hold a key that can sign token transfers.

## Decision

Turnstile uses the x402 version 2 transport unchanged and defines its own scheme, `turnstile-policy`.

- Headers are `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`, each base64 JSON. The 402 body repeats the `PAYMENT-REQUIRED` JSON.
- The network is a CAIP-2 id. It is `solana:localnet` on a local validator and `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` on devnet.
- `PaymentRequirements.extra` carries `resourceId`, `nonce`, `expiresAt`, `settlementProgram`, `agentWalletProgram` and `facilitator`. The server picks the nonce, so it can tell which requirements a payment answers.
- The payload is `{ authorization, signature }`. The authorization is a `PaymentAuthorization` (agent wallet, session key, recipient, mint, amount, resource id, nonce, expiry). The session key signs `"TURNSTILE_PAYMENT_V1"`, then the settlement program id, then the Borsh body.
- The facilitator keeps the standard endpoints, `GET /supported`, `POST /verify` and `POST /settle`, and adds `POST /requirements` so a resource server can get requirements with a fresh nonce without knowing the scheme.
- Reasons follow the x402 `invalidReason` and `errorReason` fields. Program errors keep their on-chain names.

## Consequences

- Any x402 v2 client can read the 402 and the receipt. Only a client that knows `turnstile-policy` can pay. `@turnstile/sdk-agent` is that client.
- The settlement transaction is built and signed by the facilitator, not by the client. The session key signature is checked on chain through the Ed25519 program, so the facilitator cannot change a single field.
- The signed message binds the settlement program id and the mint, but no cluster id. See the review finding in [SECURITY.md](../SECURITY.md).
- `docs/SYSTEM_DESIGN.md` still says the network is `solana:<genesis hash>`. The code uses `solana:localnet` for local ledgers, because a local genesis hash changes on every reset.
