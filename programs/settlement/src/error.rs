use anchor_lang::prelude::*;

/// Error names match SYSTEM_DESIGN.md. Codes start at 6100 in declaration order so they never
/// collide with agent_wallet codes, which start at 6000 and surface through the debit CPI.
#[error_code(offset = 6100)]
pub enum SettlementError {
    #[msg("The payment authorization has expired. Ask the agent to sign a fresh one")]
    AuthorizationExpired,
    #[msg("The instruction before settle must be an Ed25519 signature check. Add it with ed25519VerifyInstruction")]
    MissingSignatureVerification,
    #[msg("The Ed25519 check does not cover this authorization with its session key. Sign the exact authorization message")]
    SignatureMismatch,
    #[msg("This nonce has already settled. Use a new nonce for a new payment")]
    NonceAlreadyUsed,
    #[msg("An account does not match the authorization. Pass the wallet, vault, mint and recipient it names")]
    AccountMismatch,
    #[msg("This receipt is still inside its retention period. Close it after 7 days past the authorization expiry")]
    RetentionNotElapsed,
    #[msg("Only the fee payer that paid for this receipt can close it. Sign with that key")]
    NotFeePayer,
}
