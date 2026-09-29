//! Agent wallet owner instructions and their error paths, run against the SBF builds.
#![allow(clippy::result_large_err)]

mod common;

use agent_wallet::{AgentWalletError, AllowListEntry, SessionKey, SPEND_BUCKET_COUNT};
use anchor_lang::prelude::Pubkey;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn stranger(env: &mut Env) -> Keypair {
    let kp = Keypair::new();
    env.svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
    kp
}

#[test]
fn create_wallet_stores_policy_and_vault() {
    let env = Env::new();
    let w = env.wallet_state();
    assert_eq!(w.owner, env.owner.pubkey());
    assert_eq!(w.id, env.wallet_id);
    assert_eq!(w.mint, env.mint);
    assert_eq!(w.vault, env.vault);
    assert_eq!(w.bump, wallet_address(&env.owner.pubkey(), env.wallet_id).1);
    assert_eq!(w.vault_bump, vault_address(&env.wallet).1);
    assert_eq!(w.created_at, T0);
    assert_eq!(w.per_call_cap, PER_CALL_CAP);
    assert_eq!(w.daily_cap, DAILY_CAP);
    assert_eq!(
        w.session_keys,
        vec![SessionKey {
            key: env.session.pubkey(),
            expires_at: 0,
            active: true
        }]
    );
    assert_eq!(w.allow_list.len(), 1);
    assert_eq!(w.spend_buckets.len(), SPEND_BUCKET_COUNT);
    assert_eq!(w.total_spent, 0);
    assert_eq!(w.settlement_count, 0);
    assert_eq!(env.balance(&env.vault), FUNDED);
    assert_eq!(env.balance(&env.owner_token), 5_000_000 - FUNDED);
    // The vault is owned by the wallet PDA.
    let vault = env.svm.get_account(&env.vault).unwrap();
    let parsed = <anchor_spl::token::spl_token::state::Account as anchor_lang::solana_program::program_pack::Pack>::unpack(&vault.data).unwrap();
    assert_eq!(parsed.owner, env.wallet);
    assert_eq!(parsed.mint, env.mint);
}

#[test]
fn create_wallet_rejects_per_call_cap_above_daily_cap() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let ix = env.create_wallet_ix(&owner.pubkey(), 99, 10, 9, Pubkey::new_unique(), 0);
    assert_error(&env.send(&[ix], &[&owner]), AgentWalletError::InvalidPolicy);
    let ix = env.create_wallet_ix(&owner.pubkey(), 99, 9, 10, Pubkey::new_unique(), -1);
    assert_error(&env.send(&[ix], &[&owner]), AgentWalletError::InvalidPolicy);
}

#[test]
fn deposit_and_withdraw_move_exact_amounts() {
    let mut env = Env::new();
    env.deposit(250).unwrap();
    assert_eq!(env.balance(&env.vault), FUNDED + 250);
    env.withdraw(FUNDED + 250).unwrap();
    assert_eq!(env.balance(&env.vault), 0);
    assert_eq!(env.balance(&env.owner_token), 5_000_000);
    assert_error(&env.withdraw(1), AgentWalletError::InsufficientFunds);
    assert_error(&env.withdraw(0), AgentWalletError::ZeroAmount);
    assert_error(&env.deposit(0), AgentWalletError::ZeroAmount);
}

#[test]
fn withdraw_only_to_an_owner_token_account_of_the_wallet_mint() {
    let mut env = Env::new();
    let other = Keypair::new();
    let other_token = env.create_token_account(&other.pubkey());
    let owner = env.owner.insecure_clone();
    let ix = env.withdraw_ix(&owner.pubkey(), &other_token, 10);
    assert_error(
        &env.send(&[ix], &[&owner]),
        AgentWalletError::RecipientMismatch,
    );

    let other_mint = env.create_mint();
    let wrong_mint_token = env.create_token_account_for_mint(&owner.pubkey(), &other_mint);
    let ix = env.withdraw_ix(&owner.pubkey(), &wrong_mint_token, 10);
    assert_error(&env.send(&[ix], &[&owner]), AgentWalletError::MintMismatch);
    let ix = env.deposit_ix(&owner.pubkey(), &wrong_mint_token, 10);
    assert_error(&env.send(&[ix], &[&owner]), AgentWalletError::MintMismatch);
    assert_eq!(env.balance(&env.vault), FUNDED);
}

#[test]
fn non_owner_is_refused_on_every_owner_instruction() {
    let mut env = Env::new();
    let intruder = stranger(&mut env);
    let intruder_token = env.create_token_account(&intruder.pubkey());
    let me = intruder.pubkey();
    let ixs = vec![
        (
            "withdraw to owner account",
            env.withdraw_ix(&me, &env.owner_token, 1),
        ),
        (
            "withdraw to own account",
            env.withdraw_ix(&me, &intruder_token, 1),
        ),
        (
            "add_session_key",
            env.add_session_key_ix(&me, Pubkey::new_unique(), 0),
        ),
        (
            "revoke_session_key",
            env.revoke_session_key_ix(&me, env.session.pubkey()),
        ),
        (
            "update_policy",
            env.update_policy_ix(
                &me,
                u64::MAX,
                u64::MAX,
                vec![AllowListEntry {
                    resource_id: [0; 32],
                    recipient: me,
                }],
            ),
        ),
        ("close_wallet", env.close_wallet_ix(&me)),
    ];
    for (name, ix) in ixs {
        let res = env.send(&[ix], &[&intruder]);
        assert_eq!(
            custom_error(&res),
            Some(AgentWalletError::UnauthorizedCaller.into()),
            "{name} must be owner only, got {res:?}"
        );
    }
    let w = env.wallet_state();
    assert_eq!(w.per_call_cap, PER_CALL_CAP);
    assert_eq!(w.session_keys.len(), 1);
    assert!(w.session_keys[0].active);
    assert_eq!(env.balance(&env.vault), FUNDED);
}

#[test]
fn owner_signature_is_required() {
    // The owner key is listed but does not sign. The runtime refuses before the program runs
    // or Anchor refuses with AccountNotSigner (3010).
    let mut env = Env::new();
    let mut ix = env.update_policy_ix(&env.owner.pubkey(), 1, 1, vec![]);
    ix.accounts[0].is_signer = false;
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ix], &[&payer]);
    assert_eq!(custom_error(&res), Some(3010));
}

#[test]
fn session_key_management() {
    let mut env = Env::new();
    let session = env.session.pubkey();
    assert_error(
        &env.add_session_key(session, 0),
        AgentWalletError::DuplicateSessionKey,
    );
    let keys: Vec<Pubkey> = (0..3).map(|_| Pubkey::new_unique()).collect();
    for k in &keys {
        env.add_session_key(*k, T0 + 3600).unwrap();
    }
    assert_error(
        &env.add_session_key(Pubkey::new_unique(), 0),
        AgentWalletError::TooManySessionKeys,
    );
    assert_error(
        &env.revoke_session_key(Pubkey::new_unique()),
        AgentWalletError::SessionKeyNotFound,
    );
    env.revoke_session_key(keys[0]).unwrap();
    assert_error(
        &env.revoke_session_key(keys[0]),
        AgentWalletError::SessionKeyRevoked,
    );
    // The revoked slot is reused.
    let fresh = Pubkey::new_unique();
    env.add_session_key(fresh, 0).unwrap();
    let w = env.wallet_state();
    assert_eq!(w.session_keys.len(), 4);
    assert_eq!(w.session_keys[1].key, fresh);
    // Once the timed keys expire their slots can be reused too.
    env.set_time(T0 + 3601);
    env.add_session_key(Pubkey::new_unique(), 0).unwrap();
    assert_error(
        &env.add_session_key(Pubkey::new_unique(), -5),
        AgentWalletError::InvalidPolicy,
    );
}

#[test]
fn update_policy_validates_and_replaces() {
    let mut env = Env::new();
    assert_error(
        &env.update_policy(11, 10, vec![]),
        AgentWalletError::InvalidPolicy,
    );
    let too_long: Vec<AllowListEntry> = (0..17)
        .map(|i| AllowListEntry {
            resource_id: [i as u8; 32],
            recipient: Pubkey::new_unique(),
        })
        .collect();
    let res = env.update_policy(1, 1, too_long);
    assert_error(&res, AgentWalletError::AllowListTooLong);
    let full: Vec<AllowListEntry> = (0..16)
        .map(|i| AllowListEntry {
            resource_id: [i as u8; 32],
            recipient: Pubkey::new_unique(),
        })
        .collect();
    env.update_policy(5, 50, full.clone()).unwrap();
    let w = env.wallet_state();
    assert_eq!(w.per_call_cap, 5);
    assert_eq!(w.daily_cap, 50);
    assert_eq!(w.allow_list, full);
}

#[test]
fn close_wallet_requires_an_empty_vault_and_returns_rent() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let ix = env.close_wallet_ix(&owner.pubkey());
    assert_error(&env.send(&[ix], &[&owner]), AgentWalletError::VaultNotEmpty);

    env.withdraw(FUNDED).unwrap();
    let wallet_rent = env.svm.get_account(&env.wallet).unwrap().lamports;
    let vault_rent = env.svm.get_account(&env.vault).unwrap().lamports;
    let before = env.svm.get_balance(&owner.pubkey()).unwrap();
    let ix = env.close_wallet_ix(&owner.pubkey());
    let res = env.send(&[ix], &[&owner]);
    assert!(res.is_ok(), "{res:?}");
    let after = env.svm.get_balance(&owner.pubkey()).unwrap();
    // The owner paid the 5000 lamport fee for this transaction.
    assert_eq!(after, before + wallet_rent + vault_rent - 5_000);
    let closed = |k: &Pubkey| env.svm.get_account(k).is_none_or(|a| a.lamports == 0);
    assert!(closed(&env.wallet));
    assert!(closed(&env.vault));
}

#[test]
fn rolling_spend_view_returns_zero_for_new_wallet() {
    let mut env = Env::new();
    assert_eq!(env.rolling_spend(), 0);
}
