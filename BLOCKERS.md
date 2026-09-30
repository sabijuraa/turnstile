# Blockers

Items that could not be verified in the build environment. Each one lists the reason and the smallest step that clears it.

| Item | Status | Reason | Step to clear |
| --- | --- | --- | --- |
| Devnet program deploy | UNVERIFIED | The deployer `Ez15MJVD5PGMVgHDHVXx29fSiHhnS7aUSVXFp49ZhM8J` has no devnet SOL. The public faucet rate limited the airdrop. | Send about 8 devnet SOL to the deployer, then run the devnet deploy in RUNBOOK.md. |
| Validator image download path | UNVERIFIED | The Agave release tarball is 218 MB and the build host downloads at about 40 KB/s. The image was built from the local Agave install instead. | Build `infra/docker/validator.Dockerfile` on a fast link or let the CI docker job build it. |
| Vercel deploy of the web app | UNVERIFIED | Vercel login is a gated step for the owner. The backend, facilitator and demo agent also have no public hosting yet, and `DEPLOYMENT_FILE` has no bundled file on Vercel. | Host the services, set the variables in RUNBOOK.md, then deploy `apps/web`. |
| NFR3 latency under load | UNVERIFIED | The e2e latency run failed its 2,000 ms budget with a 2,931.6 ms median and a 4,042.8 ms p90 while the host load average was about 87 on 8 CPUs. The lightly loaded integration run measured about 440 ms. | Run `pnpm e2e` on an idle host or in CI and read `packages/e2e/results/latency.json`. |
| NFR8 Lighthouse mobile | UNVERIFIED | Lighthouse mobile performance on the home page measured 82 to 88. Only the home page was measured and Lighthouse is not scripted. | Script Lighthouse over every route and fix what holds mobile performance back. |
| NFR5 horizontal scale | UNVERIFIED | Tests prove the shared state rules (one debit per nonce, one indexer batch per checkpoint) but no test runs several instances behind a load balancer. | Run two facilitators and two backends against one Postgres and repeat the e2e suite. |
| Console with a real browser wallet | UNVERIFIED | The console browser test uses a test-only Wallet Standard wallet. No extension wallet was driven. | Sign in and create an agent with Phantom or Solflare on a local validator. |
| Receipt reclaim after a real 7 day wait | UNVERIFIED | LiteSVM warped the clock. The validator run closed preloaded receipts, not ones settled 7 days earlier. | Settle on a validator, advance past retention, then run `pnpm --filter @turnstile/facilitator reclaim`. |
| Indexer late start | OPEN | An indexer started late on a test validator missed settlements older than about 100 slots. The cause is not known yet. | Reproduce with a late start, check the validator history limits and `INDEXER_START_SLOT`, and add a test. |
| Quickstart commands end to end | UNVERIFIED | `pnpm dev:up` and `pnpm stack:up` were not rerun from a clean checkout after the last changes. | Run both on a clean clone and follow the README. |
