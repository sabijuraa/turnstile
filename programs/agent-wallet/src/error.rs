use anchor_lang::prelude::*;

/// Error names match `PolicyViolation` in packages/shared/src/policy.ts and SYSTEM_DESIGN.md.
/// Codes start at 6000 in declaration order. Append new variants at the end only.
#[error_code]
pub enum AgentWalletError {
    #[msg(
        "This session key is not registered on the agent wallet. Add it with add_session_key first"
    )]
    SessionKeyNotFound,
    #[msg("This session key was revoked. Sign with an active session key")]
    SessionKeyRevoked,
    #[msg("This session key has expired. Ask the owner to add a new session key")]
    SessionKeyExpired,
    #[msg("The amount is above the per-call cap. Pay less or ask the owner to raise the cap")]
    PerCallCapExceeded,
    #[msg("The payment would take the last 24 hours above the daily cap. Wait for older spend to age out or raise the cap")]
    DailyCapExceeded,
    #[msg("This resource and recipient pair is not on the allow-list. Ask the owner to add it")]
    ResourceNotAllowed,
    #[msg("The caller is not allowed to run this instruction. Use the wallet owner or the settlement program")]
    UnauthorizedCaller,
    #[msg("The vault does not hold enough tokens. Deposit more before paying or withdrawing")]
    InsufficientFunds,
    #[msg("The amount must be above zero")]
    ZeroAmount,
    #[msg("The per-call cap must not exceed the daily cap and expiry times must not be negative")]
    InvalidPolicy,
    #[msg("The wallet already holds 4 usable session keys. Revoke one before adding another")]
    TooManySessionKeys,
    #[msg("The allow-list can hold at most 16 entries")]
    AllowListTooLong,
    #[msg("This session key is already on the wallet")]
    DuplicateSessionKey,
    #[msg("The vault still holds tokens. Withdraw everything before closing the wallet")]
    VaultNotEmpty,
    #[msg("The token account uses a different mint than the agent wallet")]
    MintMismatch,
    #[msg("The destination token account belongs to the wrong owner")]
    RecipientMismatch,
    #[msg("An account does not match the agent wallet. Pass the wallet's own vault")]
    AccountMismatch,
    #[msg("A counter would overflow. The wallet cannot record this payment")]
    ArithmeticOverflow,
}
