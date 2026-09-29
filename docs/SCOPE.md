# Scope

Turnstile lets software pay for what it uses, one request at a time, inside limits its owner sets in advance. Payments settle in a stablecoin on Solana and follow the x402 standard.

## Goals

- A working x402 payment loop on Solana. Request, 402, signed payment, on-chain settlement, receipt, resource.
- Spending policy enforced on chain. A per-call cap, a rolling daily cap and an allow-list that a compromised facilitator or resource server cannot get around.
- A resource-server SDK that turns an endpoint into a paid endpoint in a few lines.
- An agent SDK that pays a 402 automatically and refuses anything outside policy.
- A console where an owner creates agent wallets, sets limits, funds them and reads every receipt.
- A live demo where an agent pays a metered API per call and the chain refuses the call that would break the cap.
- A marketing site that explains the product plainly.

## Non-goals

- A wallet app for people. End users never click to pay.
- A token. There is no project token.
- A DeFi protocol. Turnstile moves an existing stablecoin.
- Other chains in v1. The settlement interface is kept narrow so another chain could be added later.
- An off-chain ledger. Every settled payment lands on Solana with a receipt.

## Requirements

Functional requirements are FR1 to FR18 and non-functional requirements are NFR1 to NFR9. TESTPLAN.md maps each one to the tests that prove it.

- On chain. Agent wallet (FR1), spending policy (FR2), session keys (FR3), settlement (FR4), policy checks at settlement (FR5), replay protection (FR6), receipts (FR7), withdraw (FR8).
- Services. Facilitator (FR9), resource-server SDK (FR10), agent SDK (FR11), metered demo API (FR12), indexer (FR13), console backend (FR14).
- Frontend. Marketing site (FR15), console (FR16), live demo (FR17), real data only (FR18).
- Qualities. Security (NFR1), exact money (NFR2), latency (NFR3), reliability (NFR4), horizontal scale (NFR5), observability (NFR6), accessibility (NFR7), frontend performance (NFR8), responsive layout (NFR9).

## Definition of done

- Every functional requirement is implemented and demonstrated.
- Every non-functional requirement is met, or listed in BLOCKERS.md as UNVERIFIED with the reason.
- The full loop runs against a real validator and the receipt read from chain matches the indexer store.
- An over-cap payment, an off allow-list payment and a replayed nonce all fail inside the program.
- Every program, service, SDK, page and section passes the QA gate with recorded evidence.
- The frontend meets the design system, accessibility rules and performance budgets and shows only real or clearly illustrative data.
