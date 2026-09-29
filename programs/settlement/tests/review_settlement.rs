//! Review cases for the settlement and agent wallet programs, run against the SBF builds.
//! Proposed for programs/settlement/tests/review_settlement.rs.
#![allow(clippy::result_large_err)]

mod common;

use agent_wallet::AllowListEntry;
use common::*;
use settlement::SettlementError;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn receipt_address_prefunded_above_rent_still_settles_once() {
    let mut env = Env::new();
    let auth = env.authorization(10_000);
    let (receipt, _) = receipt_address(&env.wallet, &auth.nonce);
    env.svm.airdrop(&receipt, 50_000_000_000).unwrap();
    env.settle(&auth).unwrap();
    assert_eq!(env.receipt(&auth).unwrap().amount, 10_000);
    assert_eq!(env.balance(&env.recipient_token), 10_000);
    assert_error(&env.settle(&auth), SettlementError::NonceAlreadyUsed);
    assert_eq!(env.balance(&env.recipient_token), 10_000);
}

#[test]
fn replay_after_authorization_expiry_reports_expired_not_nonce() {
    let mut env = Env::new();
    let auth = env.authorization(10_000);
    env.settle(&auth).unwrap();
    env.set_time(auth.expires_at + 1);
    assert_error(&env.settle(&auth), SettlementError::AuthorizationExpired);
}

#[test]
fn agent_wallet_copy_owned_by_another_program_is_refused() {
    let mut env = Env::new();
    let mut account = env.svm.get_account(&env.wallet).unwrap();
    account.owner = settlement::ID;
    let fake = Keypair::new().pubkey();
    env.svm.set_account(fake, account).unwrap();
    let mut auth = env.authorization(10_000);
    auth.agent_wallet = fake;
    let res = env.settle(&auth);
    assert_eq!(custom_error(&res), Some(3007), "AccountOwnedByWrongProgram");
    assert_eq!(env.balance(&env.recipient_token), 0);
}

#[test]
fn re_adding_a_revoked_key_revives_its_unsettled_authorizations() {
    let mut env = Env::new();
    let session = env.session.pubkey();
    let pending = env.authorization(10_000);
    env.revoke_session_key(session).unwrap();
    assert_error(
        &env.settle(&pending),
        agent_wallet::AgentWalletError::SessionKeyRevoked,
    );
    // Fill the list so the revoked slot gets reused, then free a slot and add the key back.
    let others: Vec<_> = (0..3).map(|_| Keypair::new().pubkey()).collect();
    for k in &others {
        env.add_session_key(*k, 0).unwrap();
    }
    let filler = Keypair::new().pubkey();
    env.add_session_key(filler, 0).unwrap();
    env.revoke_session_key(filler).unwrap();
    env.add_session_key(session, 0).unwrap();
    // The authorization signed before the revoke settles now.
    env.settle(&pending).unwrap();
    assert_eq!(env.balance(&env.recipient_token), 10_000);
}

#[test]
fn close_and_recreate_resets_spend_and_revives_outstanding_authorizations() {
    let mut env = Env::new();
    for _ in 0..2 {
        let a = env.authorization(PER_CALL_CAP);
        env.settle(&a).unwrap();
    }
    assert_eq!(env.rolling_spend(), 2 * PER_CALL_CAP);
    let pending = env.authorization(PER_CALL_CAP);
    // 300_000 would exceed the 250_000 daily cap.
    assert_error(
        &env.settle(&pending),
        agent_wallet::AgentWalletError::DailyCapExceeded,
    );
    let left = env.balance(&env.vault);
    env.withdraw(left).unwrap();
    let owner = env.owner.insecure_clone();
    let ix = env.close_wallet_ix(&owner.pubkey());
    env.send(&[ix], &[&owner]).unwrap();
    let session = env.session.pubkey();
    env.create_wallet(PER_CALL_CAP, DAILY_CAP, session, 0)
        .unwrap();
    env.deposit(FUNDED).unwrap();
    let entries = vec![AllowListEntry {
        resource_id: env.resource,
        recipient: env.recipient.pubkey(),
    }];
    env.update_policy(PER_CALL_CAP, DAILY_CAP, entries).unwrap();
    assert_eq!(env.rolling_spend(), 0);
    // Same wallet address, so old receipts still block old nonces, but the unsettled one lands.
    env.settle(&pending).unwrap();
    assert_eq!(env.balance(&env.recipient_token), 3 * PER_CALL_CAP);
}

#[test]
fn authorization_message_matches_the_typescript_encoder() {
    // Vector from authorizationMessage in packages/shared for the same fields.
    let auth = settlement::PaymentAuthorization {
        agent_wallet: anchor_lang::prelude::Pubkey::new_from_array([1; 32]),
        session_key: anchor_lang::prelude::Pubkey::new_from_array([2; 32]),
        recipient: anchor_lang::prelude::Pubkey::new_from_array([3; 32]),
        mint: anchor_lang::prelude::Pubkey::new_from_array([4; 32]),
        amount: 0x0102_0304_0506_0708,
        resource_id: [5; 32],
        nonce: [6; 32],
        expires_at: 1_900_000_000,
    };
    let msg = auth.message();
    assert_eq!(msg.len(), 260);
    assert_eq!(&msg[..20], b"TURNSTILE_PAYMENT_V1");
    assert_eq!(&msg[20..52], settlement::ID.as_ref());
    assert_eq!(&msg[180..188], &[8, 7, 6, 5, 4, 3, 2, 1]);
    assert_eq!(&msg[252..260], &1_900_000_000i64.to_le_bytes());
}
