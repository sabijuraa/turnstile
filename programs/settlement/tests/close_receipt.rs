//! `close_receipt` returns receipt rent to the fee payer after the retention period, and a
//! closed receipt never lets its authorization settle again. Runs against the SBF builds.
#![allow(clippy::result_large_err)]

mod common;

use common::*;
use settlement::{SettlementError, RECEIPT_RETENTION_SECONDS};
use solana_keypair::Keypair;
use solana_signer::Signer;

const RECEIPT_ACCOUNT_LEN: usize = 8 + <settlement::Receipt as anchor_lang::Space>::INIT_SPACE;

/// A settled payment and the rent its receipt holds.
fn settled(env: &mut Env) -> (settlement::PaymentAuthorization, u64) {
    let auth = env.authorization(10_000);
    env.settle(&auth).unwrap();
    let (address, _) = receipt_address(&auth.agent_wallet, &auth.nonce);
    (auth, env.lamports(&address))
}

#[test]
fn receipt_layout_and_rent() {
    let mut env = Env::new();
    let (auth, rent) = settled(&mut env);
    let (address, _) = receipt_address(&auth.agent_wallet, &auth.nonce);
    let account = env.svm.get_account(&address).unwrap();
    assert_eq!(RECEIPT_ACCOUNT_LEN, 329);
    assert_eq!(account.data.len(), RECEIPT_ACCOUNT_LEN);
    assert_eq!(rent, env.svm.minimum_balance_for_rent_exemption(329));
    // fee_payer sits at byte 288, which the facilitator reclaim filter relies on.
    assert_eq!(&account.data[288..320], env.payer.pubkey().as_ref());
    assert_eq!(&account.data[321..329], &auth.expires_at.to_le_bytes());
    println!(
        "receipt account {} bytes, rent {rent} lamports",
        account.data.len()
    );
}

#[test]
fn close_before_retention_fails() {
    let mut env = Env::new();
    let (auth, rent) = settled(&mut env);
    let payer = env.payer.insecure_clone();
    assert_error(
        &env.close_receipt(&auth, &payer),
        SettlementError::RetentionNotElapsed,
    );
    // The last second of the retention period is still inside it.
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS);
    assert_error(
        &env.close_receipt(&auth, &payer),
        SettlementError::RetentionNotElapsed,
    );
    let (address, _) = receipt_address(&auth.agent_wallet, &auth.nonce);
    assert_eq!(env.lamports(&address), rent);
    assert_eq!(env.receipt(&auth).unwrap().amount, 10_000);
}

#[test]
fn close_by_another_signer_fails() {
    let mut env = Env::new();
    let (auth, rent) = settled(&mut env);
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS + 1);
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert_error(
        &env.close_receipt(&auth, &stranger),
        SettlementError::NotFeePayer,
    );
    // The wallet owner did not pay the rent either.
    let owner = env.owner.insecure_clone();
    assert_error(
        &env.close_receipt(&auth, &owner),
        SettlementError::NotFeePayer,
    );
    let (address, _) = receipt_address(&auth.agent_wallet, &auth.nonce);
    assert_eq!(env.lamports(&address), rent);
}

#[test]
fn close_needs_the_fee_payer_signature() {
    let mut env = Env::new();
    let (auth, _) = settled(&mut env);
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS + 1);
    // The real fee payer is named but a stranger pays and signs the transaction.
    let stranger = Keypair::new();
    env.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let mut ix = env.close_receipt_ix(&auth, &env.payer.pubkey());
    ix.accounts[1].is_signer = false;
    let res = env.send(&[ix], &[&stranger]);
    assert_eq!(custom_error(&res), Some(3010), "AccountNotSigner");
    assert!(env.receipt(&auth).is_some());
}

#[test]
fn close_after_retention_returns_exact_rent_to_fee_payer() {
    let mut env = Env::new();
    let (auth, rent) = settled(&mut env);
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS + 1);
    let payer = env.payer.insecure_clone();
    let before = env.lamports(&payer.pubkey());
    let res = env.close_receipt(&auth, &payer);
    assert!(res.is_ok(), "{res:?}");
    let meta = res.unwrap();
    // The fee payer also paid the 5000 lamport signature fee for the close transaction.
    let after = env.lamports(&payer.pubkey());
    assert_eq!(after, before + rent - 5_000);
    let (address, _) = receipt_address(&auth.agent_wallet, &auth.nonce);
    assert_eq!(env.lamports(&address), 0);
    assert!(env
        .svm
        .get_account(&address)
        .is_none_or(|a| a.data.is_empty()));
    assert!(env.receipt(&auth).is_none());
    println!(
        "close_receipt compute units {}, reclaimed {rent} lamports",
        meta.compute_units_consumed
    );
}

#[test]
fn replay_after_close_fails_as_expired_and_moves_no_funds() {
    let mut env = Env::new();
    let (auth, _) = settled(&mut env);
    let vault_before = env.balance(&env.vault);
    let recipient_before = env.balance(&env.recipient_token);
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS + 1);
    let payer = env.payer.insecure_clone();
    env.close_receipt(&auth, &payer).unwrap();
    assert!(env.receipt(&auth).is_none());

    // The nonce address is empty again, but the authorization expired long ago.
    assert_error(&env.settle(&auth), SettlementError::AuthorizationExpired);
    // Also from a different fee payer, so it is a distinct transaction.
    env.payer = Keypair::new();
    env.svm.airdrop(&env.payer.pubkey(), 1_000_000_000).unwrap();
    assert_error(&env.settle(&auth), SettlementError::AuthorizationExpired);

    assert_eq!(env.balance(&env.vault), vault_before);
    assert_eq!(env.balance(&env.recipient_token), recipient_before);
    assert!(env.receipt(&auth).is_none());
    assert_eq!(env.wallet_state().settlement_count, 1);
}

#[test]
fn verify_receipt_after_close_fails() {
    let mut env = Env::new();
    let (auth, _) = settled(&mut env);
    assert!(env.verify_receipt(&auth).is_ok());
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS + 1);
    let payer = env.payer.insecure_clone();
    env.close_receipt(&auth, &payer).unwrap();
    // Anchor reports AccountNotInitialized for the empty address.
    assert_eq!(custom_error(&env.verify_receipt(&auth)), Some(3012));
}

#[test]
fn close_twice_fails() {
    let mut env = Env::new();
    let (auth, _) = settled(&mut env);
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS + 1);
    let payer = env.payer.insecure_clone();
    env.close_receipt(&auth, &payer).unwrap();
    let before = env.lamports(&payer.pubkey());
    assert_eq!(
        custom_error(&env.close_receipt(&auth, &payer)),
        Some(3012),
        "AccountNotInitialized"
    );
    assert_eq!(env.lamports(&payer.pubkey()), before - 5_000);
}

#[test]
fn a_program_owned_account_that_is_not_the_receipt_pda_is_refused() {
    let mut env = Env::new();
    let (auth, _) = settled(&mut env);
    env.set_time(auth.expires_at + RECEIPT_RETENTION_SECONDS + 1);
    // Copy the real receipt to another address owned by the program.
    let (address, _) = receipt_address(&auth.agent_wallet, &auth.nonce);
    let account = env.svm.get_account(&address).unwrap();
    let fake = Keypair::new().pubkey();
    env.svm.set_account(fake, account).unwrap();
    let payer = env.payer.insecure_clone();
    let mut ix = env.close_receipt_ix(&auth, &payer.pubkey());
    ix.accounts[0].pubkey = fake;
    let res = env.send(&[ix], &[&payer]);
    assert_eq!(custom_error(&res), Some(2006), "ConstraintSeeds");
    assert!(env.receipt(&auth).is_some());
}
