//! Turnstile settlement.
//!
//! `settle` takes a payment authorization signed by an agent session key. It checks the
//! signature through the Ed25519 program instruction that precedes it, consumes the nonce by
//! creating the receipt PDA, asks the agent wallet program to debit under the owner's policy
//! and writes the receipt. All of it happens in one instruction, so it either all lands or
//! nothing does.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Allocate, Assign, CreateAccount, Transfer};
use anchor_spl::token::{Token, TokenAccount};

pub mod ed25519;
pub mod error;

pub use error::SettlementError;

declare_id!("6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z");

#[constant]
pub const SEED_RECEIPT: &[u8] = b"receipt";
#[constant]
pub const SEED_SETTLEMENT_AUTHORITY: &[u8] = b"settlement_authority";
/// Domain prefix of every signed authorization. Exactly 20 ASCII bytes.
#[constant]
pub const AUTHORIZATION_DOMAIN: &[u8] = b"TURNSTILE_PAYMENT_V1";
pub const AUTHORIZATION_BODY_LEN: usize = 208;
pub const AUTHORIZATION_MESSAGE_LEN: usize = 20 + 32 + AUTHORIZATION_BODY_LEN;

/// A payment the agent's session key agreed to. Borsh layout is the 208 byte body of the
/// signed message and matches `encodeAuthorizationBody` in packages/shared.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PaymentAuthorization {
    pub agent_wallet: Pubkey,
    pub session_key: Pubkey,
    /// Owner of the recipient token account.
    pub recipient: Pubkey,
    pub mint: Pubkey,
    /// Base units of the mint.
    pub amount: u64,
    pub resource_id: [u8; 32],
    pub nonce: [u8; 32],
    /// Unix seconds.
    pub expires_at: i64,
}

impl PaymentAuthorization {
    /// `"TURNSTILE_PAYMENT_V1" || settlement program id || borsh(authorization)`.
    pub fn message(&self) -> [u8; AUTHORIZATION_MESSAGE_LEN] {
        let mut out = [0u8; AUTHORIZATION_MESSAGE_LEN];
        let parts: [&[u8]; 10] = [
            AUTHORIZATION_DOMAIN,
            crate::ID.as_ref(),
            self.agent_wallet.as_ref(),
            self.session_key.as_ref(),
            self.recipient.as_ref(),
            self.mint.as_ref(),
            &self.amount.to_le_bytes(),
            &self.resource_id,
            &self.nonce,
            &self.expires_at.to_le_bytes(),
        ];
        let mut at = 0;
        for part in parts {
            out[at..at + part.len()].copy_from_slice(part);
            at += part.len();
        }
        out
    }
}

#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub agent_wallet: Pubkey,
    pub owner: Pubkey,
    pub session_key: Pubkey,
    pub recipient: Pubkey,
    pub recipient_token: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub resource_id: [u8; 32],
    pub nonce: [u8; 32],
    pub slot: u64,
    pub unix_timestamp: i64,
    pub fee_payer: Pubkey,
    pub bump: u8,
}

/// Emitted with `emit!` so it lands in the program logs as `Program data: <base64>`.
/// Carries every receipt field plus the receipt address.
#[event]
pub struct PaymentSettled {
    pub receipt: Pubkey,
    pub agent_wallet: Pubkey,
    pub owner: Pubkey,
    pub session_key: Pubkey,
    pub recipient: Pubkey,
    pub recipient_token: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub resource_id: [u8; 32],
    pub nonce: [u8; 32],
    pub slot: u64,
    pub unix_timestamp: i64,
    pub fee_payer: Pubkey,
    pub bump: u8,
}

#[program]
pub mod settlement {
    use super::*;

    pub fn settle(ctx: Context<Settle>, authorization: PaymentAuthorization) -> Result<()> {
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp <= authorization.expires_at,
            SettlementError::AuthorizationExpired
        );

        ed25519::verify_preceding_instruction(
            &ctx.accounts.instructions.to_account_info(),
            &authorization.session_key,
            &authorization.message(),
        )?;

        // The receipt PDA is the nonce record. Once this program owns it the nonce is spent.
        let receipt_info = ctx.accounts.receipt.to_account_info();
        require!(
            receipt_info.owner == &system_program::ID && receipt_info.data_is_empty(),
            SettlementError::NonceAlreadyUsed
        );

        let authority_bump = ctx.bumps.settlement_authority;
        let authority_seeds: &[&[u8]] = &[
            SEED_SETTLEMENT_AUTHORITY,
            std::slice::from_ref(&authority_bump),
        ];
        agent_wallet::cpi::debit(
            CpiContext::new_with_signer(
                ctx.accounts.agent_wallet_program.key(),
                agent_wallet::cpi::accounts::Debit {
                    settlement_authority: ctx.accounts.settlement_authority.to_account_info(),
                    agent_wallet: ctx.accounts.agent_wallet.to_account_info(),
                    vault: ctx.accounts.vault.to_account_info(),
                    recipient_token: ctx.accounts.recipient_token.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
                &[authority_seeds],
            ),
            authorization.session_key,
            authorization.amount,
            authorization.resource_id,
        )?;

        let receipt_bump = ctx.bumps.receipt;
        create_receipt_account(&ctx, &authorization, receipt_bump)?;

        let receipt = Receipt {
            agent_wallet: authorization.agent_wallet,
            owner: ctx.accounts.agent_wallet.owner,
            session_key: authorization.session_key,
            recipient: authorization.recipient,
            recipient_token: ctx.accounts.recipient_token.key(),
            mint: authorization.mint,
            amount: authorization.amount,
            resource_id: authorization.resource_id,
            nonce: authorization.nonce,
            slot: clock.slot,
            unix_timestamp: clock.unix_timestamp,
            fee_payer: ctx.accounts.fee_payer.key(),
            bump: receipt_bump,
        };
        {
            let mut data = receipt_info.try_borrow_mut_data()?;
            let mut writer: &mut [u8] = &mut data;
            receipt.try_serialize(&mut writer)?;
        }

        emit!(PaymentSettled {
            receipt: receipt_info.key(),
            agent_wallet: receipt.agent_wallet,
            owner: receipt.owner,
            session_key: receipt.session_key,
            recipient: receipt.recipient,
            recipient_token: receipt.recipient_token,
            mint: receipt.mint,
            amount: receipt.amount,
            resource_id: receipt.resource_id,
            nonce: receipt.nonce,
            slot: receipt.slot,
            unix_timestamp: receipt.unix_timestamp,
            fee_payer: receipt.fee_payer,
            bump: receipt.bump,
        });
        Ok(())
    }

    /// Read only check that the receipt for `authorization` exists and records exactly that
    /// payment. Fails with `AccountMismatch` when any field differs. Meant for simulation by a
    /// facilitator that wants the chain to confirm an earlier settlement.
    pub fn verify_receipt(
        ctx: Context<VerifyReceipt>,
        authorization: PaymentAuthorization,
    ) -> Result<()> {
        let r = &ctx.accounts.receipt;
        require!(
            r.agent_wallet == authorization.agent_wallet
                && r.session_key == authorization.session_key
                && r.recipient == authorization.recipient
                && r.mint == authorization.mint
                && r.amount == authorization.amount
                && r.resource_id == authorization.resource_id
                && r.nonce == authorization.nonce,
            SettlementError::AccountMismatch
        );
        Ok(())
    }
}

/// Creates the receipt PDA owned by this program. Handles an address that already holds
/// lamports, so nobody can block a nonce by sending SOL to its receipt address first.
fn create_receipt_account(
    ctx: &Context<Settle>,
    authorization: &PaymentAuthorization,
    bump: u8,
) -> Result<()> {
    let space = 8 + Receipt::INIT_SPACE;
    let rent = Rent::get()?.minimum_balance(space);
    let receipt = ctx.accounts.receipt.to_account_info();
    let fee_payer = ctx.accounts.fee_payer.to_account_info();
    let system = ctx.accounts.system_program.key();
    let seeds: &[&[u8]] = &[
        SEED_RECEIPT,
        authorization.agent_wallet.as_ref(),
        &authorization.nonce,
        std::slice::from_ref(&bump),
    ];
    let signer: &[&[&[u8]]] = &[seeds];
    let current = receipt.lamports();
    if current == 0 {
        return system_program::create_account(
            CpiContext::new_with_signer(
                system,
                CreateAccount {
                    from: fee_payer,
                    to: receipt,
                },
                signer,
            ),
            rent,
            space as u64,
            &crate::ID,
        );
    }
    let top_up = rent.saturating_sub(current);
    if top_up > 0 {
        system_program::transfer(
            CpiContext::new(
                system,
                Transfer {
                    from: fee_payer,
                    to: receipt.clone(),
                },
            ),
            top_up,
        )?;
    }
    system_program::allocate(
        CpiContext::new_with_signer(
            system,
            Allocate {
                account_to_allocate: receipt.clone(),
            },
            signer,
        ),
        space as u64,
    )?;
    system_program::assign(
        CpiContext::new_with_signer(
            system,
            Assign {
                account_to_assign: receipt,
            },
            signer,
        ),
        &crate::ID,
    )
}

#[derive(Accounts)]
#[instruction(authorization: PaymentAuthorization)]
pub struct Settle<'info> {
    /// Pays the transaction fee and the receipt rent. Has no authority over any funds.
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    /// CHECK: PDA of this program. It signs the debit CPI and holds no data.
    #[account(seeds = [SEED_SETTLEMENT_AUTHORITY], bump)]
    pub settlement_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        address = authorization.agent_wallet @ SettlementError::AccountMismatch,
        constraint = agent_wallet.mint == authorization.mint @ SettlementError::AccountMismatch,
    )]
    pub agent_wallet: Box<Account<'info, agent_wallet::AgentWallet>>,
    #[account(mut, address = agent_wallet.vault @ SettlementError::AccountMismatch)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = recipient_token.owner == authorization.recipient @ SettlementError::AccountMismatch,
        constraint = recipient_token.mint == authorization.mint @ SettlementError::AccountMismatch,
    )]
    pub recipient_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: receipt PDA for this nonce. `settle` refuses it when it already exists and
    /// creates it otherwise.
    #[account(
        mut,
        seeds = [SEED_RECEIPT, authorization.agent_wallet.as_ref(), authorization.nonce.as_ref()],
        bump,
    )]
    pub receipt: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar, checked by address.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub agent_wallet_program: Program<'info, agent_wallet::program::AgentWallet>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(authorization: PaymentAuthorization)]
pub struct VerifyReceipt<'info> {
    #[account(
        seeds = [SEED_RECEIPT, authorization.agent_wallet.as_ref(), authorization.nonce.as_ref()],
        bump = receipt.bump,
    )]
    pub receipt: Account<'info, Receipt>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_is_domain_program_and_borsh_body() {
        let auth = PaymentAuthorization {
            agent_wallet: Pubkey::new_from_array([1; 32]),
            session_key: Pubkey::new_from_array([2; 32]),
            recipient: Pubkey::new_from_array([3; 32]),
            mint: Pubkey::new_from_array([4; 32]),
            amount: 0x0102_0304_0506_0708,
            resource_id: [5; 32],
            nonce: [6; 32],
            expires_at: 1_900_000_000,
        };
        let body = anchor_lang::prelude::borsh::to_vec(&auth).unwrap();
        assert_eq!(body.len(), AUTHORIZATION_BODY_LEN);
        let msg = auth.message();
        assert_eq!(&msg[..20], b"TURNSTILE_PAYMENT_V1");
        assert_eq!(&msg[20..52], crate::ID.as_ref());
        assert_eq!(&msg[52..], body.as_slice());
    }
}
