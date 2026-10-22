# Blockers

Items that could not be verified in the build environment. Each one lists the reason and the smallest step that clears it.

| Item | Status | Reason | Step to clear |
| --- | --- | --- | --- |
| Live demo on the hosted site | PARTIAL | The site is live at https://turnstile-lyart.vercel.app in live mode against devnet. Pages, the paid API and the facilitator answer. A demo run settled its first call there and then the public devnet RPC answered 429, because Vercel functions share outbound addresses. The same run passed 6 settled and 1 refused from a single machine. | Set `SOLANA_RPC_URL` on Vercel to a provider devnet URL (Helius, QuickNode or similar) and redeploy. |
| NFR8 Lighthouse mobile | UNVERIFIED | Lighthouse mobile performance on the home page measured 82 to 88. Only the home page was measured and Lighthouse is not scripted. | Script Lighthouse over every route and fix what holds mobile performance back. |
| NFR5 horizontal scale | UNVERIFIED | Tests prove the shared state rules (one debit per nonce, one indexer batch per checkpoint) but no test runs several instances behind a load balancer. | Run two facilitators and two backends against one Postgres and repeat the e2e suite. |
| Console with a real browser wallet | UNVERIFIED | The console browser test uses a test-only Wallet Standard wallet. No extension wallet was driven. | Sign in and create an agent with Phantom or Solflare on a local validator. |
| Receipt reclaim after a real 7 day wait | UNVERIFIED | LiteSVM warped the clock. The validator run closed preloaded receipts, not ones settled 7 days earlier. | Settle on a validator, advance past retention, then run `pnpm --filter @turnstile/facilitator reclaim`. |
| Indexer late start on a purged ledger | UNVERIFIED | The validator purge test is committed in `61f860f`. A run on 6 Oct 2026 passed the crash and reset suite but the purge case died in the test's own `getSignaturesForAddress` call while the host sat at a load average over 80 from unrelated work. The indexer under test showed no error. | Run `pnpm --filter @turnstile/indexer test:integration` on an idle host. |
| Quickstart commands end to end | UNVERIFIED | `pnpm dev:up` and `pnpm stack:up` were not rerun from a clean checkout after the last changes. | Run both on a clean clone and follow the README. |
