//! Checks that the Ed25519 program instruction right before `settle` verified the session key
//! signature over the exact authorization message.
//!
//! The Ed25519 program verifies whatever its offsets point at, possibly bytes in another
//! instruction. That is the classic spoofing hole. This module accepts only one signature whose
//! public key, message and signature all live inside the Ed25519 instruction itself, and then
//! compares those bytes with the expected key and message.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::error::SettlementError;

pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

/// Instruction index value that means "this same instruction".
pub const SAME_INSTRUCTION: u16 = u16::MAX;
const HEADER_LEN: usize = 2;
const OFFSETS_LEN: usize = 14;
const PUBKEY_LEN: usize = 32;
const SIGNATURE_LEN: usize = 64;

/// Loads the instruction before the current one and checks it with `check_ed25519_data`.
pub fn verify_preceding_instruction(
    instructions_sysvar: &AccountInfo,
    session_key: &Pubkey,
    message: &[u8],
) -> Result<()> {
    let current = load_current_index_checked(instructions_sysvar)
        .map_err(|_| SettlementError::MissingSignatureVerification)?;
    let previous = current
        .checked_sub(1)
        .ok_or(SettlementError::MissingSignatureVerification)?;
    let ix = load_instruction_at_checked(usize::from(previous), instructions_sysvar)
        .map_err(|_| SettlementError::MissingSignatureVerification)?;
    require_keys_eq!(
        ix.program_id,
        ED25519_PROGRAM_ID,
        SettlementError::MissingSignatureVerification
    );
    check_ed25519_data(&ix.data, session_key, message)
}

fn read_u16(data: &[u8], at: usize) -> Result<u16> {
    let bytes = data
        .get(at..at + 2)
        .ok_or(SettlementError::SignatureMismatch)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn slice(data: &[u8], offset: u16, len: usize) -> Result<&[u8]> {
    let start = usize::from(offset);
    let end = start
        .checked_add(len)
        .ok_or(SettlementError::SignatureMismatch)?;
    Ok(data
        .get(start..end)
        .ok_or(SettlementError::SignatureMismatch)?)
}

/// Validates the data of an Ed25519 program instruction.
pub fn check_ed25519_data(data: &[u8], session_key: &Pubkey, message: &[u8]) -> Result<()> {
    require!(
        data.len() >= HEADER_LEN + OFFSETS_LEN,
        SettlementError::SignatureMismatch
    );
    require!(data[0] == 1, SettlementError::SignatureMismatch);
    let o = HEADER_LEN;
    let signature_offset = read_u16(data, o)?;
    let signature_ix = read_u16(data, o + 2)?;
    let pubkey_offset = read_u16(data, o + 4)?;
    let pubkey_ix = read_u16(data, o + 6)?;
    let message_offset = read_u16(data, o + 8)?;
    let message_size = read_u16(data, o + 10)?;
    let message_ix = read_u16(data, o + 12)?;
    require!(
        signature_ix == SAME_INSTRUCTION
            && pubkey_ix == SAME_INSTRUCTION
            && message_ix == SAME_INSTRUCTION,
        SettlementError::SignatureMismatch
    );
    slice(data, signature_offset, SIGNATURE_LEN)?;
    let pubkey = slice(data, pubkey_offset, PUBKEY_LEN)?;
    require!(
        pubkey == session_key.as_ref(),
        SettlementError::SignatureMismatch
    );
    require!(
        usize::from(message_size) == message.len(),
        SettlementError::SignatureMismatch
    );
    let signed = slice(data, message_offset, message.len())?;
    require!(signed == message, SettlementError::SignatureMismatch);
    Ok(())
}
