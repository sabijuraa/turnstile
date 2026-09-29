# Blockers

Items that could not be verified in the build environment. Each one lists the reason and the smallest step that clears it.

| Item | Status | Reason | Step to clear |
| --- | --- | --- | --- |
| Devnet program deploy | UNVERIFIED | The deployer `Ez15MJVD5PGMVgHDHVXx29fSiHhnS7aUSVXFp49ZhM8J` has no devnet SOL. The public faucet rate limited the airdrop. | Send about 8 devnet SOL to the deployer, then run the devnet deploy in RUNBOOK.md. |
| Validator image download path | UNVERIFIED | The Agave release tarball is 218 MB and the build host downloads at about 40 KB/s. The image was built from the local Agave install instead. | Build `infra/docker/validator.Dockerfile` on a fast link or let the CI docker job build it. |
