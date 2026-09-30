# Security

This page says what protects an owner's money, where each key lives, what the programs check and in which order, and what is not protected. It ends with the findings of the program review and what was done about each.

## Threat model

The asset is the stablecoin in each agent wallet vault. The owner decides in advance how it may be spent.

We assume any of these can be buggy or hostile.

- The agent process and its session key.
- The resource server and its SDK.
- The facilitator and its fee payer key.
- The console backend, the web app and the indexer.
- The network between them.

We trust the Solana runtime, the SPL Token program, the Ed25519 program, the two Turnstile programs as deployed, and the owner's own wallet.

The promise is narrow. No party other than the owner can move more out of a vault than the owner's policy allows, to anyone other than an allow-listed recipient, and no signed payment can settle twice.

## Trust boundaries

| Party | Holds | Can do | Cannot do |
| --- | --- | --- | --- |
| Owner wallet | owner key | create, fund, withdraw, set policy, add and revoke session keys, close | nothing is withheld from the owner |
| Agent | one session key | sign payment authorizations | change policy, withdraw, pay outside policy |
| Resource server | nothing secret | ask for payment, forward the signed payload | change any signed field, redirect funds |
| Facilitator | fee payer key | submit settlements, pay fees and receipt rent, close its own receipts after retention | move vault funds, raise a cap, change a recipient, reuse a nonce |
| Console backend | database, API key hashes | build unsigned owner transactions, read receipts | sign for the owner, see any agent or owner key |
| Web app | nothing secret | proxy to the backend and the demo agent, relay owner-signed transactions | sign anything |
| Indexer | database write | copy receipts from chain | change what the chain says |
| Demo agent runner | demo owner key and demo session key | create, fund and drain demo wallets for the demo owner | touch any other owner's wallet |

The demo runner is the one service that holds an owner key. It is the demo owner's key on localnet, used to set up a fresh wallet for each run. The compose comment on `demo-agent` says it holds only the session key. That comment is wrong.

## Key handling

- Local keys live in `keys/localnet`, created with mode 0600 by the bootstrap. `keys/` is git ignored.
- The devnet deployer is `keys/devnet/deployer.json`. It becomes the program upgrade authority when the programs are deployed. See the runbook for moving that authority.
- The program id keypairs `keys/agent_wallet-keypair.json` and `keys/settlement-keypair.json` only matter at first deploy.
- The facilitator loads `FACILITATOR_KEYPAIR` at startup. A malformed file produces an error that never echoes its contents.
- `turnstile-agent keygen` writes a session key with mode 0600, refuses to overwrite a file and prints only the public key.
- The agent SDK keeps the session key in process memory. It signs only after the local policy check passes.
- The backend stores console session tokens and API keys as SHA-256 hashes. The full API key is shown once.
- Owner keys stay in the owner's browser wallet. The backend returns unsigned transactions and never receives a signature it could reuse.
- The session cookie is httpOnly, SameSite=Lax and Secure behind HTTPS. Cookie writes must come from `WEB_ORIGIN`.

Rotation steps for every key are in [RUNBOOK.md](RUNBOOK.md#rotate-keys).

## On-chain guarantees

### settle

Anchor checks the accounts first, then the handler runs. A failure at any step aborts the whole transaction, so nothing moves.

Account checks, in account order.

1. `fee_payer` signs.
2. `settlement_authority` is the PDA `["settlement_authority"]`.
3. `agent_wallet` is at `authorization.agent_wallet`, is owned by the agent_wallet program and holds `authorization.mint`. Otherwise `AccountMismatch`, or Anchor's owner error 3007.
4. `vault` is the wallet's own vault.
5. `recipient_token` is owned by `authorization.recipient` and holds `authorization.mint`.
6. `receipt` is the PDA `["receipt", agent_wallet, nonce]`.
7. `instructions` is the instructions sysvar.

Handler, in order.

1. Chain time is at or before `authorization.expires_at`. Otherwise `AuthorizationExpired`.
2. The instruction right before `settle` is an Ed25519 program instruction. Otherwise `MissingSignatureVerification`.
3. That instruction verifies exactly one signature whose key, message and signature all sit inside the instruction itself. The key must be `authorization.session_key` and the message must be the 260 byte authorization message. Otherwise `SignatureMismatch`.
4. The receipt address is still owned by the system program and holds no data. Otherwise `NonceAlreadyUsed`.
5. CPI into `agent_wallet::debit`, signed by the settlement authority PDA.
6. The receipt is created (an address that already holds lamports is topped up, allocated and assigned), written and `PaymentSettled` is emitted.

### debit

`debit` runs only through that CPI.

1. `settlement_authority` signs and is the known settlement authority address. Otherwise `UnauthorizedCaller`.
2. The vault is the wallet's vault, the recipient token account holds the wallet's mint (`MintMismatch`) and is not the vault (`RecipientMismatch`).
3. `amount` is above zero. `ZeroAmount`
4. The session key is on the wallet. `SessionKeyNotFound`
5. It is active. `SessionKeyRevoked`
6. It has not expired (an expiry of 0 never expires). `SessionKeyExpired`
7. `amount` is at or under the per-call cap. `PerCallCapExceeded`
8. The pair of resource id and recipient token owner is on the allow-list. An empty list allows nothing. `ResourceNotAllowed`
9. Rolling 24 hour spend plus `amount` is at or under the daily cap. `DailyCapExceeded`
10. The vault holds `amount`. `InsufficientFunds`

Then it records the spend in the 15 minute bucket ring, bumps the counters with checked math and transfers. The TypeScript mirror `evaluatePayment` runs steps 3 to 10 in the same order.

### Owner instructions

Every instruction except `debit` requires the owner signature and `has_one = owner`. `withdraw` pays only to a token account of the wallet mint owned by the owner. `update_policy` refuses a per-call cap above the daily cap and more than 16 entries. `close_wallet` requires an empty vault.

### close_receipt

1. The receipt is the PDA of its own `agent_wallet` and `nonce`.
2. It names the signing fee payer. Otherwise `NotFeePayer`.
3. Chain time is later than `expires_at` plus 604800 seconds. Otherwise `RetentionNotElapsed`.
4. The account is zeroed and every lamport goes to the fee payer.

## What is not protected

- Spending inside the policy. A compromised session key, or a hostile resource server on the allow-list, can spend up to the caps. The caps are the limit of the damage.
- Long lived authorizations. The resource server picks `expiresAt` in the requirements. The facilitator caps `maxTimeoutSeconds` at 3600 when it issues requirements, but the agent SDK does not cap the expiry it signs. A server that forges requirements can get a signature that stays valid for a long time and settle it later, within policy.
- Revocation is not retroactive. Revoking a key stops its unsettled authorizations only while it stays revoked. See the findings below.
- The owner key. Whoever holds it controls the wallet. There is no recovery and no way to change the owner.
- Availability. The facilitator, the RPC node or the backend can refuse service. They cannot redirect funds.
- The indexer and the console show what the chain said, but they can lag. A late started indexer on a test validator missed settlements older than about 100 slots. That gap is open and listed in BLOCKERS.md.
- `confirmed` is not `finalized`. A confirmed block that is later dropped would leave its receipt in Postgres.
- The program upgrade authority. Whoever holds it can replace the programs.
- Rent. The facilitator pays about 0.0032 SOL per receipt until it reclaims it after retention.

## Review findings

The program review was run against the SBF builds. Its cases live in `programs/settlement/tests/review_settlement.rs` and `programs/settlement/tests/close_receipt.rs`.

| Finding | Severity | Disposition |
| --- | --- | --- |
| Receipt rent is never returned | Medium | Fixed in `e6ebf7d` and `589e5d7` |
| Re-adding a revoked session key revives its unsettled authorizations | Medium | Documented in `f607655`, accepted |
| Closing and recreating a wallet at the same id resets spend and revives outstanding authorizations | Medium | Accepted, documented here |
| The signed message carries no cluster id | Low | Accepted, documented here |
| A replay after expiry reports `AuthorizationExpired`, not `NonceAlreadyUsed` | Informational | Accepted, documented in ADR 0002 |
| The recipient token account is not pinned to the associated token account | Low | Accepted, documented here |
| A receipt address prefunded with lamports could block a nonce | Low | Fixed before the review. Test added in `52143a0` |
| A copy of an agent wallet owned by another program | Informational | Not exploitable. Test added in `52143a0` |

### Receipt rent

Each settlement creates a 329 byte receipt that locks 3,180,720 lamports of the fee payer's SOL. For a 0.005 USD payment that deposit is far larger than the payment. Kept forever, the fee payer's locked SOL grows with every request.

- Fix. The receipt stores `expires_at`. `close_receipt` lets the named fee payer close it 7 days after that expiry and returns all the rent. It uses 4,155 compute units. The facilitator `reclaim` command finds and closes its receipts in batches.
- Replay safety. A closed receipt does not reopen its nonce, because `settle` refuses an expired authorization before it looks at the receipt. `replay_after_close_fails_as_expired_and_moves_no_funds` proves it.
- Trade-off. `verify_receipt` and the facilitator's `alreadySettled` answer work only while the receipt exists. The event and the indexer store are the permanent record. See [ADR 0002](adr/0002-settlement-idempotency-by-nonce.md).
- UNVERIFIED. The full settle, wait 7 days, reclaim cycle ran in LiteSVM with a warped clock. On a validator the reclaim ran against preloaded receipts.

### Key revival on re-add

The policy stores a session key with an `active` flag. Revoking sets it false. The key's authorizations that were signed but never settled stay valid signatures. If the key comes back, they settle.

- Adding the same key while its revoked entry is still in a slot fails with `DuplicateSessionKey`.
- Once the 4 slots are full, a revoked slot is reused. After that the old key can be added again, and its old unexpired authorizations settle. `re_adding_a_revoked_key_revives_its_unsettled_authorizations` proves it.
- Disposition. Documented in the `revoke_session_key` doc comment and the IDL. The rule is to rotate to a new key and never add a revoked key back. Authorizations still expire, and the caps still apply.

### Close and recreate

A wallet address is derived from the owner and a numeric id. Closing a wallet and creating a new one at the same id gives the same address with fresh spend buckets.

- Old receipts still exist, so old settled nonces stay spent.
- An authorization that was signed but not settled before the close settles against the new wallet, if the new wallet adds the same session key and allow-list entry. `close_and_recreate_resets_spend_and_revives_outstanding_authorizations` proves it.
- The console picks the next id as one above the highest live wallet. If the highest wallet was closed, its id is reused.
- Disposition. Accepted. Give a recreated wallet a new session key. A later change could keep a closed id marker or have the console never reuse an id.

### No cluster id in the message

The signed message is `"TURNSTILE_PAYMENT_V1"`, the settlement program id and the authorization. The program ids are the same on localnet and devnet, and an owner who uses one key everywhere gets the same wallet address on every cluster.

- An authorization signed on one cluster is therefore a valid signature on another.
- The authorization also names the mint, and `settle` requires the wallet to hold that mint. Real stablecoin mints differ between clusters, so a cross-cluster replay needs the same mint address on both.
- Disposition. Accepted for now. Adding a genesis hash to the message would close it and is a breaking change for every client.

### Replay after expiry naming

A settled authorization replayed after it expired fails with `AuthorizationExpired`, because expiry is checked before the nonce. A caller that expects `NonceAlreadyUsed` for every replay sees a different name. No funds move either way. `replay_after_authorization_expiry_reports_expired_not_nonce` covers it. The order is kept on purpose. It is what makes closing receipts safe.

### Recipient token not pinned to the associated token account

`settle` requires the recipient token account to be owned by the signed `recipient` and to hold the signed mint. It does not require the associated token account. Anyone can create another token account whose owner is the recipient, and the facilitator could pay into it.

- The funds still land in an account the recipient owns and controls.
- The receipt records `recipient_token`, so the recipient can find them.
- The shared settle builder uses the associated token account by default.
- Disposition. Accepted. Pinning to the associated account would block recipients who use other token accounts.
