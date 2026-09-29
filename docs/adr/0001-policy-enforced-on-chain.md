# ADR 0001. Policy is enforced on chain

Status. Accepted.

## Context

An agent pays for HTTP requests with a session key. The facilitator and the resource server sit between the agent and the chain. Either one could be buggy or compromised. The owner needs a hard limit on what the agent can spend that holds no matter what those services do.

## Decision

The spending policy lives in the `AgentWallet` account and the `agent_wallet` program checks it inside `debit`, in the same instruction that moves the tokens.

- `debit` runs only when the settlement program's `settlement_authority` PDA signs it. Only the settlement program can produce that signature, and it only does so after it has checked the session key signature over the exact authorization.
- `debit` checks, in this order, a zero amount, that the session key exists, that it is active, that it has not expired, the per-call cap, the allow-list pair of resource id and recipient, the rolling daily cap and the vault balance.
- The TypeScript mirror `evaluatePayment` in packages/shared runs the same checks in the same order. Clients use it to refuse early with the same reason the chain would give. The chain stays the only authority.
- The allow-list binds a resource id to a recipient. A resource server that swaps in its own address for an allowed resource gets `ResourceNotAllowed`.
- Every owner facing instruction requires the owner signature. The agent key cannot change the policy.

## Consequences

- A compromised facilitator can at worst submit payments the agent really signed, inside the policy. It cannot raise a cap, change a recipient or reuse a nonce.
- Policy checks cost compute on every settlement. The wallet account is about 2.9 KB and the checks are linear scans over at most 4 keys, 16 allow-list entries and 97 buckets.
- Changing the order of the checks is a breaking change for clients that show the reason. Both sides must change together.
