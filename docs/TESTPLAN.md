# Test plan

Every functional requirement (FR1 to FR18) and non-functional requirement (NFR1 to NFR9) from [SCOPE.md](SCOPE.md), mapped to the tests that prove it. Only tests that exist are listed. Items that are not proven say UNVERIFIED and why, and each one is also in [BLOCKERS.md](../BLOCKERS.md).

## How to run each suite

The requirement sections below refer to these suites by their key.

| Key | Suite | Command | Needs |
| --- | --- | --- | --- |
| `rust` | Program tests in LiteSVM | `cargo test -p settlement -p agent-wallet` | `target/deploy/*.so`, built per crate |
| `unit` | TypeScript unit tests | `pnpm build && pnpm -r --filter '!@turnstile/e2e' run test` | Postgres on 5433 |
| `int` | Service integration on a private validator | `TURNSTILE_INTEGRATION=1 pnpm --filter <pkg> test` for sdk-resource, sdk-agent, demo-api | Agave 4.0.2, built programs, Postgres |
| `idx-int` | Indexer crash and reset | `pnpm --filter @turnstile/indexer test:integration` | same, plus built shared and indexer |
| `client-int` | Program client on a validator | `TURNSTILE_TEST_RPC_URL=http://127.0.0.1:8899 pnpm --filter @turnstile/shared test` | a running validator with the programs |
| `backend-chain` | Backend chain operations | part of `pnpm --filter @turnstile/backend test`, starts its own validator on 47899 | Agave, built programs. Skips with a reason otherwise |
| `e2e` | End to end against a stack | `pnpm e2e`, or `E2E_STACK=infra pnpm e2e` as CI does | Docker |
| `web` | Browser checks with Playwright | from `apps/web`, `node e2e/<file>.mjs` with `E2E_BASE_URL` set. `pnpm --filter @turnstile/web e2e` runs `audit.mjs` | a running web app, and for `demo.mjs` and `console.mjs` a running stack |

CI (`.github/workflows/ci.yml`) runs `rust`, `unit` and `e2e` in infra mode on every push and pull request to main. The `int`, `idx-int`, `client-int` and `web` suites run by hand.

Rust tests live in `programs/settlement/tests/{settle,wallet,close_receipt,review_settlement}.rs` and as unit tests in `programs/agent-wallet/src/policy.rs` and `programs/settlement/src/lib.rs`.

## Functional requirements

### FR1. Agent wallet

- `rust` `programs/settlement/tests/wallet.rs` `create_wallet_stores_policy_and_vault`, `close_wallet_requires_an_empty_vault_and_returns_rent`, `rolling_spend_view_returns_zero_for_new_wallet`.
- `client-int` `packages/shared/test/programs.int.test.ts` "creates, funds and sets policy on a wallet".
- `backend-chain` `packages/backend/test/chain.test.ts` "creates, funds and sets the allow-list of an agent in one transaction", "splits a create with a full allow-list into two transactions when it does not fit".
- `e2e` `packages/e2e/test/product-loop.test.ts` creates, funds and sets the policy of a fresh wallet before the loop.

### FR2. Spending policy

- `rust` `wallet.rs` `create_wallet_rejects_per_call_cap_above_daily_cap`, `update_policy_validates_and_replaces`, `non_owner_is_refused_on_every_owner_instruction`, `owner_signature_is_required`.
- `rust` `settle.rs` `allow_list_update_takes_effect_at_settlement`.
- `rust` `programs/agent-wallet/src/policy.rs` `caps_must_be_ordered`, `rolling_window_counts_97_buckets`, `rolling_window_never_admits_more_than_cap_in_24h`.
- `unit` `packages/shared/test/programs.test.ts` "caps update_policy at the 15 entries that fit in one transaction".
- `backend-chain` "replaces the policy", "rejects bad policy input with precise messages", "keeps other owners out".

### FR3. Session keys

- `rust` `wallet.rs` `session_key_management`. `policy.rs` `session_key_slots`.
- `rust` `settle.rs` `revoked_key_fails`, `expired_key_fails_and_unknown_key_fails`.
- `rust` `review_settlement.rs` `re_adding_a_revoked_key_revives_its_unsettled_authorizations` (documents the known behavior).
- `backend-chain` "adds and revokes session keys".
- `unit` `packages/sdk-agent/test/cli.test.ts` "keygen writes a 0600 Solana key file and prints only the public key", "keygen refuses to overwrite an existing key".

### FR4. Settlement

- `rust` `settle.rs` `settles_moves_funds_writes_receipt_and_emits_event`, which also prints the compute units.
- `rust` `settle.rs` signature checks `missing_ed25519_instruction_fails`, `ed25519_instruction_must_be_immediately_before_settle`, `signature_by_a_different_key_fails`, `signature_over_a_different_message_fails`, `signature_for_another_program_domain_fails`, `offsets_pointing_at_another_instruction_fail`, `offsets_pointing_at_the_settle_instruction_fail`, `inline_bytes_not_covered_by_offsets_are_ignored`, `two_signatures_in_one_ed25519_instruction_fail`, `a_non_ed25519_instruction_before_settle_fails`, `wrong_instructions_sysvar_fails`.
- `rust` `review_settlement.rs` `authorization_message_matches_the_typescript_encoder`. `lib.rs` `message_is_domain_program_and_borsh_body`.
- `unit` `packages/shared/test/shared.test.ts` "produces a 260 byte message with the domain and program id up front", "verifies a signature by the session key and rejects any tampering".
- `client-int` "settles a signed authorization, writes the receipt and emits the event".
- `e2e` `product-loop.test.ts` "pays through the agent SDK and matches the receipt in chain and store field by field".

### FR5. Policy checks at settlement

- `rust` `settle.rs` `over_per_call_cap_fails`, `rolling_daily_cap_blocks_then_ages_out`, `rolling_window_spans_multiple_buckets`, `off_allow_list_resource_fails`, `allowed_resource_with_a_different_recipient_fails`, `recipient_token_account_must_belong_to_the_authorized_recipient`, `wrong_mint_fails`, `insufficient_funds_fails`, `zero_amount_fails`, `debit_called_directly_is_refused`.
- `rust` `policy.rs` `checks_run_in_mirror_order`. `unit` `shared.test.ts` "names the exact limit a payment breaks".
- `client-int` "refuses over-cap payments on chain and reports rolling spend".
- `e2e` `product-loop.test.ts` "refuses a price over the per-call cap in the program, the facilitator and the SDK", "refuses a resource off the allow-list in the program, the facilitator and the SDK". Both send the transaction straight to the program with `skipPreflight`.
- `e2e` `demo-run.test.ts` "streams six settled calls then a DailyCapExceeded refusal proven on chain".

### FR6. Replay protection

- `rust` `settle.rs` `replayed_nonce_fails_with_nonce_already_used`, `prefunded_receipt_address_does_not_block_the_nonce`, `expired_authorization_fails`.
- `rust` `review_settlement.rs` `receipt_address_prefunded_above_rent_still_settles_once`, `replay_after_authorization_expiry_reports_expired_not_nonce`.
- `rust` `close_receipt.rs` `replay_after_close_fails_as_expired_and_moves_no_funds`.
- `unit` `packages/facilitator/test/facilitator.test.ts` "turns concurrent settles of one nonce into one debit and idempotent successes", "refuses a forged signature even for a settled nonce".
- `int` `packages/sdk-resource/test/integration.test.ts` "settles concurrent copies of one payment exactly once".
- `e2e` `product-loop.test.ts` "refuses a replayed nonce in the program, the facilitator and the SDK with NonceAlreadyUsed".

### FR7. Receipts

- `rust` `settle.rs` `verify_receipt_confirms_only_the_exact_payment`.
- `rust` `close_receipt.rs` `receipt_layout_and_rent`, `close_before_retention_fails`, `close_by_another_signer_fails`, `close_needs_the_fee_payer_signature`, `close_after_retention_returns_exact_rent_to_fee_payer`, `verify_receipt_after_close_fails`, `close_twice_fails`, `a_program_owned_account_that_is_not_the_receipt_pda_is_refused`.
- `unit` `packages/shared/test/close-receipt.test.ts` all four cases, and `programs.test.ts` "decodes PaymentSettled only from settlement program logs".
- `e2e` `product-loop.test.ts` reads the receipt with `fetchReceipt` and compares every field with the indexer row.
- UNVERIFIED. Settle, a real 7 day wait, then reclaim on a validator. The validator run used preloaded receipts and LiteSVM warped the clock.

### FR8. Withdraw

- `rust` `wallet.rs` `deposit_and_withdraw_move_exact_amounts`, `withdraw_only_to_an_owner_token_account_of_the_wallet_mint`.
- `backend-chain` "deposits and withdraws exact amounts", "closes a funded wallet only when told to withdraw the rest", "reports a transaction the program rejects as failed with the program error".
- `unit` `packages/demo-api/test/runner.test.ts` "runs six paid calls, proves the seventh refusal on chain and withdraws".

### FR9. Facilitator

- `unit` `packages/facilitator/test/facilitator.test.ts`, every case under "GET /supported", "POST /requirements", "POST /verify", "POST /settle" and "health and metrics". Key ones are "names the policy rule a payment breaks, before simulating", "lets the program have the final word through simulation", "answers a repeat with the original receipt and no second debit", "writes an unknown outcome to the dead letters and counts attempts", "treats a timed out send that landed as settled".
- `unit` `replay.test.ts` all five cases. `reclaim.test.ts` all five cases. `classify.test.ts` and `config.test.ts`.
- `int` `sdk-resource/test/integration.test.ts` runs a real facilitator on a validator.

### FR10. Resource SDK

- `unit` `packages/sdk-resource/test/paywall.test.ts`, every case for both the Hono and the Express adapter, and the `createPaywall` cases.
- `int` `sdk-resource/test/integration.test.ts` "pays, settles on chain, writes the receipt and returns the resource", "answers a replayed payment header with the same settlement and no second debit", "refuses a price above the per-call cap before anything moves", "refuses a resource that is not on the allow-list", "refuses an expired authorization", "serves nothing when the facilitator is unreachable".

### FR11. Agent SDK

- `unit` `packages/sdk-agent/test/agent.test.ts`, every case. The policy ones are "refuses a price above the per-call cap and sends nothing", "counts its own settled payments toward the daily cap between chain reads" and "refuses a requirement for another settlement program".
- `int` `packages/sdk-agent/test/integration.test.ts` "settles two payments on chain and refuses the third locally without signing".
- `e2e` `product-loop.test.ts` pays through the agent SDK and checks the SDK refusals.

### FR12. Metered demo API

- `unit` `packages/demo-api/test/api.test.ts` all six cases, for example "asks for payment before doing the work" and "rejects bad input before the paywall so it never costs money".
- `unit` `packages/demo-api/test/text.test.ts` for summarize and keywords.
- `int` `packages/demo-api/test/integration.test.ts` "settles six calls, and the chain refuses the seventh with DailyCapExceeded".

### FR13. Indexer

- `unit` `packages/indexer/test/indexer.test.ts`, every case, including "a crash between the receipt insert and the checkpoint update replays the batch exactly once", "falls back to a slot resume when the node forgot the checkpoint signature", "starts over when the local validator was reset" and "refuses a batch whose event disagrees with the receipt account".
- `unit` `rpc-source.test.ts` and `service.test.ts`.
- `idx-int` `packages/indexer/test/integration/validator.test.ts` "survives a SIGKILL mid-stream with no gap and no duplicate", "starts over when the validator is reset to a new genesis".
- `e2e` `product-loop.test.ts` and `demo-run.test.ts` check the store against the chain.
- Open gap. A late started indexer on a test validator missed settlements older than about 100 slots. No test covers a late start yet.

### FR14. Console backend

- `unit` `packages/backend/test/auth.test.ts`, `apiKeys.test.ts`, `receipts.test.ts` and `health.test.ts`, every case.
- `backend-chain` `chain.test.ts`, every case.
- `e2e` `product-loop.test.ts` "signs the owner in with a wallet signature and serves the receipt, summary, CSV and agents".

### FR15. Marketing site

- `unit` `apps/web/src/lib/site.test.ts` "has a page" for every header and footer link.
- `web` `apps/web/e2e/audit.mjs` loads every route at 360, 768 and 1440 wide and fails on axe violations, sideways scroll, console errors or layout shift.
- The about and legal pages ship as a heading and one sentence.

### FR16. Console

- `web` `apps/web/e2e/console.mjs` signs a fresh owner in, creates and funds an agent, pays the demo API, edits the policy, rotates session keys, moves funds, reads and exports receipts and creates and revokes an API key, against the real backend and a local validator. `console-audit.mjs` then runs axe and layout checks on each console route.
- `unit` `apps/web/src/lib/format.test.ts` and `sort.test.ts` for the meters and tables.
- UNVERIFIED. A real browser extension wallet. `console.mjs` uses the test-only Wallet Standard wallet in `console-wallet.mjs`.
- The console browser scripts were still being finished when this page was written and were not yet committed.

### FR17. Live demo

- `e2e` `packages/e2e/test/demo-run.test.ts` "streams six settled calls then a DailyCapExceeded refusal proven on chain".
- `unit` `packages/demo-api/test/runner.test.ts`, every case, for example "streams events live over SSE and ends the stream after the last one" and "fails loudly when the chain accepts a payment the facilitator refused".
- `unit` `apps/web/src/app/demo/_lib/view.test.ts`, every case.
- `web` `apps/web/e2e/demo.mjs` drives a real run in the browser, checks the busy path and reduced motion, and records the real receipts and the refused transaction.

### FR18. Real data only

- `e2e` `product-loop.test.ts` "signs the owner in with a wallet signature and serves the receipt, summary, CSV and agents". The console data is the same receipt the chain holds.
- `web` `demo.mjs` records the receipts and the refused transaction the page showed, from a real run.
- Marketing sample content is wrapped in `Illustration`, which prints a visible caption. No automated test checks the captions.

## Non-functional requirements

### NFR1. Security

- Every `rust` test above. The spoofing and direct CPI cases under FR4 and FR5 carry most of the weight.
- `rust` `review_settlement.rs` `agent_wallet_copy_owned_by_another_program_is_refused`.
- `e2e` `product-loop.test.ts` "policy is enforced inside the program" block, which bypasses the facilitator and the SDK.
- `unit` `auth.test.ts` "blocks a cookie write from another origin", "refuses to reuse a nonce", "signs in with a valid signature, sets an httpOnly cookie and stores only the hash". `apiKeys.test.ts` "shows the key once and stores only its hash", "does not let a bearer key manage keys".
- `unit` `facilitator/test/config.test.ts` "refuses a malformed keypair without echoing its contents".
- Review findings and their dispositions are in [SECURITY.md](SECURITY.md#review-findings).

### NFR2. Exact money

- `rust` `wallet.rs` `deposit_and_withdraw_move_exact_amounts`. `close_receipt.rs` `close_after_retention_returns_exact_rent_to_fee_payer`.
- `unit` `shared.test.ts` "formats and parses exactly". `format.test.ts` "is exact for amounts beyond float precision". `sort.test.ts` "compares bigint amounts exactly".
- `unit` `receipts.test.ts` "exports a CSV statement with exact decimals". `facilitator.test.ts` "refuses a foreign asset, both amount and price, and too many decimals".
- `e2e` `product-loop.test.ts` checks that the vault and the recipient move by exactly the price.

### NFR3. Latency

- `int` `sdk-resource/test/integration.test.ts` "keeps the median paid request under two seconds (NFR3)". Two runs of 25 measured medians of 455 ms and 427 ms on a lightly loaded WSL2 host. The numbers are in [packages/facilitator/README.md](../packages/facilitator/README.md).
- `e2e` `packages/e2e/test/latency.test.ts` measures 20 paid requests through the agent SDK and writes `packages/e2e/results/latency.json`.
- UNVERIFIED under load. The last e2e run failed its 2,000 ms budget with a 2,931.6 ms median and a 4,042.8 ms p90. The 1 minute load average was about 87 on 8 CPUs during that run.

### NFR4. Reliability

- `unit` `indexer.test.ts` "no gaps and no duplicates" and "RPC failures" blocks. `idx-int` SIGKILL and ledger reset cases.
- `unit` `facilitator.test.ts` "writes an unknown outcome to the dead letters and counts attempts", "treats a timed out send that landed as settled". `replay.test.ts` all cases.
- `unit` `paywall.test.ts` "returns 503 when the settlement outcome is unknown", "returns 503 and never serves the resource when the facilitator is down".
- `unit` `runner.test.ts` "marks a run left running by a previous process as interrupted".
- `unit` `packages/shared/test/testing.test.ts` "creates the database once and tolerates concurrent callers".

### NFR5. Horizontal scale

- `unit` `facilitator.test.ts` "turns concurrent settles of one nonce into one debit and idempotent successes". The facilitator keeps all state in Postgres.
- `unit` `indexer.test.ts` "refuses a batch when another indexer moved the checkpoint first", "keeps streams apart so the work can be partitioned".
- UNVERIFIED. No test runs several facilitator or backend instances behind a load balancer.

### NFR6. Observability

- `e2e` `packages/e2e/test/health.test.ts` checks `/healthz`, `/readyz` and every metric family by name on the facilitator, demo API, backend, indexer and demo agent.
- `unit` backend `health.test.ts` "counts requests by route and status". Facilitator "counts requests by route and verify results by reason". Indexer `service.test.ts` "serves health and the indexer metrics" and the readiness cases.

### NFR7. Accessibility

- `unit` `apps/web/src/lib/contrast.test.ts` "matches the WCAG reference values" and one case per token pair.
- `web` `audit.mjs` runs axe-core (WCAG 2.1 A and AA and best practice) on every route and checks visible focus and the mobile menu. `docs.mjs`, `demo.mjs` and `console-audit.mjs` run axe on their pages and states.

### NFR8. Frontend performance

- `web` `audit.mjs` fails on layout shift above 0.01. `demo.mjs` measures layout shift during a run.
- Lighthouse on the home page, saved in `apps/web/e2e/output/lh-home-*.report.json`, scored 100 on desktop.
- UNVERIFIED on mobile. Lighthouse mobile performance on the home page measured 82 to 88 across runs. Only the home page was measured, and Lighthouse is not scripted.

### NFR9. Responsive layout

- `web` `audit.mjs` screenshots at 360, 768 and 1440 and fails on sideways scroll on every route.
- `web` `docs.mjs` at 360 and 1440, including the narrow docs menu. `demo.mjs` at 360 and 1440 in each state. `console.mjs` captures every console screen at 360 and 1440.

## Also UNVERIFIED

- Devnet. Nothing has been deployed or run on a public cluster.
- Vercel. The web app has not been deployed, and the services have no public hosting.
- The validator image built from the Agave release download.
- The quickstart commands `pnpm dev:up` and `pnpm stack:up` were not rerun end to end after the last changes.
