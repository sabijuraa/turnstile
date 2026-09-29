//! Turnstile agent wallet.
//!
//! Holds an agent's stablecoin in a vault PDA, stores the owner's spending policy and the
//! agent's session keys, and pays out only when the settlement program asks and the policy
//! allows it. Every owner facing instruction requires the owner signature. `debit` requires
//! the settlement program's `settlement_authority` PDA as signer, which only the settlement
//! program can produce.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

pub mod error;
pub mod policy;
pub mod state;

pub use error::AgentWalletError;
pub use state::*;

declare_id!("7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb");

/// Program id of the settlement program. Only its `settlement_authority` PDA may call `debit`.
pub const SETTLEMENT_PROGRAM_ID: Pubkey = pubkey!("6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z");

/// `find_program_address(["settlement_authority"], SETTLEMENT_PROGRAM_ID)`, precomputed so
/// `debit` does not pay for a PDA search. A unit test checks it against the derivation.
pub const SETTLEMENT_AUTHORITY: Pubkey = pubkey!("AchLyVbEk5nXx2K73LB43wvBCqY4V4xyei9bTwSrS5Tz");

#[constant]
pub const SEED_AGENT_WALLET: &[u8] = b"agent_wallet";
#[constant]
pub const SEED_VAULT: &[u8] = b"vault";
#[constant]
pub const SEED_SETTLEMENT_AUTHORITY: &[u8] = b"settlement_authority";

#[program]
pub mod agent_wallet {
    use super::*;

    /// Creates the agent wallet PDA and its vault for `mint`, with one session key and caps.
    /// The allow-list starts empty, which allows nothing until the owner sets it.
    pub fn create_wallet(
        ctx: Context<CreateWallet>,
        id: u64,
        per_call_cap: u64,
        daily_cap: u64,
        session_key: Pubkey,
        session_expires_at: i64,
    ) -> Result<()> {
        policy::validate_caps(per_call_cap, daily_cap)?;
        require!(session_expires_at >= 0, AgentWalletError::InvalidPolicy);
        let now = Clock::get()?.unix_timestamp;
        let wallet = &mut ctx.accounts.agent_wallet;
        wallet.owner = ctx.accounts.owner.key();
        wallet.id = id;
        wallet.mint = ctx.accounts.mint.key();
        wallet.vault = ctx.accounts.vault.key();
        wallet.bump = ctx.bumps.agent_wallet;
        wallet.vault_bump = ctx.bumps.vault;
        wallet.created_at = now;
        wallet.per_call_cap = per_call_cap;
        wallet.daily_cap = daily_cap;
        wallet.session_keys = vec![SessionKey {
            key: session_key,
            expires_at: session_expires_at,
            active: true,
        }];
        wallet.allow_list = Vec::new();
        wallet.spend_buckets = vec![SpendBucket::default(); SPEND_BUCKET_COUNT];
        wallet.total_spent = 0;
        wallet.settlement_count = 0;
        Ok(())
    }

    /// Moves `amount` from an owner token account into the vault.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, AgentWalletError::ZeroAmount);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.owner_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )
    }

    /// Moves `amount` from the vault to a token account the owner holds.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, AgentWalletError::ZeroAmount);
        require!(
            ctx.accounts.vault.amount >= amount,
            AgentWalletError::InsufficientFunds
        );
        let wallet = &ctx.accounts.agent_wallet;
        let id_bytes = wallet.id.to_le_bytes();
        let seeds: &[&[u8]] = &[
            SEED_AGENT_WALLET,
            wallet.owner.as_ref(),
            &id_bytes,
            std::slice::from_ref(&wallet.bump),
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: ctx.accounts.agent_wallet.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )
    }

    /// Adds a session key. A full list reuses the first slot held by a revoked or expired key.
    pub fn add_session_key(ctx: Context<OwnerOnly>, key: Pubkey, expires_at: i64) -> Result<()> {
        require!(expires_at >= 0, AgentWalletError::InvalidPolicy);
        let now = Clock::get()?.unix_timestamp;
        policy::add_session_key(
            &mut ctx.accounts.agent_wallet.session_keys,
            key,
            expires_at,
            now,
        )
    }

    /// Revokes a session key. A revoked key can never authorize a payment again.
    pub fn revoke_session_key(ctx: Context<OwnerOnly>, key: Pubkey) -> Result<()> {
        policy::revoke_session_key(&mut ctx.accounts.agent_wallet.session_keys, &key)
    }

    /// Replaces the caps and the allow-list in one step.
    pub fn update_policy(
        ctx: Context<OwnerOnly>,
        per_call_cap: u64,
        daily_cap: u64,
        allow_list: Vec<AllowListEntry>,
    ) -> Result<()> {
        require!(
            allow_list.len() <= MAX_ALLOW_LIST,
            AgentWalletError::AllowListTooLong
        );
        policy::validate_caps(per_call_cap, daily_cap)?;
        let wallet = &mut ctx.accounts.agent_wallet;
        wallet.per_call_cap = per_call_cap;
        wallet.daily_cap = daily_cap;
        wallet.allow_list = allow_list;
        Ok(())
    }

    /// Closes an empty vault and the wallet. Rent from both goes back to the owner.
    pub fn close_wallet(ctx: Context<CloseWallet>) -> Result<()> {
        require!(
            ctx.accounts.vault.amount == 0,
            AgentWalletError::VaultNotEmpty
        );
        let wallet = &ctx.accounts.agent_wallet;
        let id_bytes = wallet.id.to_le_bytes();
        let seeds: &[&[u8]] = &[
            SEED_AGENT_WALLET,
            wallet.owner.as_ref(),
            &id_bytes,
            std::slice::from_ref(&wallet.bump),
        ];
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: ctx.accounts.agent_wallet.to_account_info(),
            },
            &[seeds],
        ))
    }

    /// Pays `amount` from the vault to `recipient_token` after the full policy check.
    /// Callable only through CPI signed by the settlement program's `settlement_authority`.
    pub fn debit(
        ctx: Context<Debit>,
        session_key: Pubkey,
        amount: u64,
        resource_id: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let recipient = ctx.accounts.recipient_token.owner;
        let wallet = &mut ctx.accounts.agent_wallet;
        policy::check_payment(
            wallet,
            &session_key,
            amount,
            &resource_id,
            &recipient,
            ctx.accounts.vault.amount,
            now,
        )?;
        policy::record_spend(&mut wallet.spend_buckets, amount, now)?;
        wallet.total_spent = wallet
            .total_spent
            .checked_add(amount)
            .ok_or(AgentWalletError::ArithmeticOverflow)?;
        wallet.settlement_count = wallet
            .settlement_count
            .checked_add(1)
            .ok_or(AgentWalletError::ArithmeticOverflow)?;

        let owner = wallet.owner;
        let id_bytes = wallet.id.to_le_bytes();
        let bump = wallet.bump;
        let seeds: &[&[u8]] = &[
            SEED_AGENT_WALLET,
            owner.as_ref(),
            &id_bytes,
            std::slice::from_ref(&bump),
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.agent_wallet.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )
    }

    /// Returns the spend that counts toward the daily cap right now, as u64 return data.
    pub fn rolling_spend(ctx: Context<ReadWallet>) -> Result<u64> {
        let now = Clock::get()?.unix_timestamp;
        policy::rolling_spend(&ctx.accounts.agent_wallet.spend_buckets, now)
    }
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateWallet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + AgentWallet::INIT_SPACE,
        seeds = [SEED_AGENT_WALLET, owner.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub agent_wallet: Box<Account<'info, AgentWallet>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = owner,
        seeds = [SEED_VAULT, agent_wallet.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = agent_wallet,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub owner: Signer<'info>,
    #[account(
        has_one = owner @ AgentWalletError::UnauthorizedCaller,
        has_one = vault @ AgentWalletError::AccountMismatch,
    )]
    pub agent_wallet: Box<Account<'info, AgentWallet>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = owner_token.mint == agent_wallet.mint @ AgentWalletError::MintMismatch,
    )]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(
        has_one = owner @ AgentWalletError::UnauthorizedCaller,
        has_one = vault @ AgentWalletError::AccountMismatch,
    )]
    pub agent_wallet: Box<Account<'info, AgentWallet>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = owner_token.mint == agent_wallet.mint @ AgentWalletError::MintMismatch,
        constraint = owner_token.owner == owner.key() @ AgentWalletError::RecipientMismatch,
    )]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ AgentWalletError::UnauthorizedCaller)]
    pub agent_wallet: Box<Account<'info, AgentWallet>>,
}

#[derive(Accounts)]
pub struct CloseWallet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = owner,
        has_one = owner @ AgentWalletError::UnauthorizedCaller,
        has_one = vault @ AgentWalletError::AccountMismatch,
    )]
    pub agent_wallet: Box<Account<'info, AgentWallet>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Debit<'info> {
    /// CHECK: must be the settlement program's `settlement_authority` PDA and must sign.
    /// Any other caller gets `UnauthorizedCaller`.
    #[account(
        signer @ AgentWalletError::UnauthorizedCaller,
        address = SETTLEMENT_AUTHORITY @ AgentWalletError::UnauthorizedCaller,
    )]
    pub settlement_authority: UncheckedAccount<'info>,
    #[account(mut, has_one = vault @ AgentWalletError::AccountMismatch)]
    pub agent_wallet: Box<Account<'info, AgentWallet>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = recipient_token.mint == agent_wallet.mint @ AgentWalletError::MintMismatch,
        constraint = recipient_token.key() != vault.key() @ AgentWalletError::RecipientMismatch,
    )]
    pub recipient_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReadWallet<'info> {
    pub agent_wallet: Box<Account<'info, AgentWallet>>,
}
