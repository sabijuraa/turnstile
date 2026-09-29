use anchor_lang::prelude::*;

pub const MAX_SESSION_KEYS: usize = 4;
pub const MAX_ALLOW_LIST: usize = 16;
/// Rolling daily cap is tracked in 15 minute buckets.
pub const SPEND_BUCKET_SECONDS: i64 = 900;
pub const SPEND_BUCKET_COUNT: usize = 97;
/// Buckets with `index >= now_index - SPEND_WINDOW_LOOKBACK` count toward the daily cap.
pub const SPEND_WINDOW_LOOKBACK: i64 = 96;

#[account]
#[derive(InitSpace)]
pub struct AgentWallet {
    pub owner: Pubkey,
    pub id: u64,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    pub created_at: i64,
    pub per_call_cap: u64,
    pub daily_cap: u64,
    #[max_len(4)]
    pub session_keys: Vec<SessionKey>,
    #[max_len(16)]
    pub allow_list: Vec<AllowListEntry>,
    /// Ring of 97 buckets. The slot for bucket index `i` is `i mod 97`.
    #[max_len(97)]
    pub spend_buckets: Vec<SpendBucket>,
    pub total_spent: u64,
    pub settlement_count: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct SessionKey {
    pub key: Pubkey,
    /// Unix seconds. 0 means no expiry.
    pub expires_at: i64,
    pub active: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct AllowListEntry {
    pub resource_id: [u8; 32],
    /// Owner of the recipient token account.
    pub recipient: Pubkey,
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace,
)]
pub struct SpendBucket {
    /// `floor(unix_timestamp / 900)`.
    pub index: i64,
    pub amount: u64,
}
