//! Settlement behavior and every settlement error path, run against the SBF builds in LiteSVM.
#![allow(clippy::result_large_err)]

mod common;

use agent_wallet::{AgentWalletError, AllowListEntry};
use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token;
use common::*;
use settlement::SettlementError;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn settle_program_units(res: &TxResult) -> Option<u64> {
    let logs = match res {
        Ok(meta) => &meta.logs,
        Err(failed) => &failed.meta.logs,
    };
    let prefix = format!("Program {} consumed ", settlement::ID);
    logs.iter().find_map(|l| {
        l.strip_prefix(&prefix)
            .and_then(|rest| rest.split(' ').next())
            .and_then(|n| n.parse().ok())
    })
}

#[test]
fn settles_moves_funds_writes_receipt_and_emits_event() {
    let mut env = Env::new();
    let auth = env.authorization(40_000);
    let res = env.settle(&auth);
    assert!(res.is_ok(), "{res:?}");

    assert_eq!(env.balance(&env.vault), FUNDED - 40_000);
    assert_eq!(env.balance(&env.recipient_token), 40_000);

    let receipt = env.receipt(&auth).expect("receipt written");
    assert_eq!(receipt.agent_wallet, env.wallet);
    assert_eq!(receipt.owner, env.owner.pubkey());
    assert_eq!(receipt.session_key, env.session.pubkey());
    assert_eq!(receipt.recipient, env.recipient.pubkey());
    assert_eq!(receipt.recipient_token, env.recipient_token);
    assert_eq!(receipt.mint, env.mint);
    assert_eq!(receipt.amount, 40_000);
    assert_eq!(receipt.resource_id, env.resource);
    assert_eq!(receipt.nonce, auth.nonce);
    assert_eq!(receipt.unix_timestamp, T0);
    assert_eq!(receipt.fee_payer, env.payer.pubkey());
    assert_eq!(receipt.bump, receipt_address(&env.wallet, &auth.nonce).1);
    assert_eq!(receipt.expires_at, auth.expires_at);

    let wallet = env.wallet_state();
    assert_eq!(wallet.total_spent, 40_000);
    assert_eq!(wallet.settlement_count, 1);
    assert_eq!(env.rolling_spend(), 40_000);

    let meta = res.unwrap();
    let event_logs: Vec<_> = meta
        .logs
        .iter()
        .filter(|l| l.starts_with("Program data: "))
        .collect();
    assert_eq!(event_logs.len(), 1, "one PaymentSettled event log");

    let tx_units = meta.compute_units_consumed;
    let settle_units = settle_program_units(&Ok(meta)).unwrap();
    println!("settle compute units: settle program {settle_units}, whole transaction {tx_units}");
}

#[test]
fn replayed_nonce_fails_with_nonce_already_used() {
    let mut env = Env::new();
    let auth = env.authorization(10_000);
    env.settle(&auth).unwrap();
    // A different fee payer makes it a new transaction with the same authorization.
    env.payer = Keypair::new();
    env.svm.airdrop(&env.payer.pubkey(), 1_000_000_000).unwrap();
    let res = env.settle(&auth);
    assert_error(&res, SettlementError::NonceAlreadyUsed);
    assert_eq!(env.balance(&env.recipient_token), 10_000);
    assert_eq!(env.balance(&env.vault), FUNDED - 10_000);
}

#[test]
fn prefunded_receipt_address_does_not_block_the_nonce() {
    let mut env = Env::new();
    let auth = env.authorization(10_000);
    let (receipt, _) = receipt_address(&env.wallet, &auth.nonce);
    env.svm.airdrop(&receipt, 1_000).unwrap();
    env.settle(&auth).unwrap();
    assert_eq!(env.receipt(&auth).unwrap().amount, 10_000);
    assert_eq!(env.balance(&env.recipient_token), 10_000);
}

#[test]
fn expired_authorization_fails() {
    let mut env = Env::new();
    let mut auth = env.authorization(10_000);
    auth.expires_at = T0 - 1;
    assert_error(&env.settle(&auth), SettlementError::AuthorizationExpired);
    // Valid through its expiry second, refused one second later.
    let mut auth = env.authorization(10_000);
    auth.expires_at = T0 + 60;
    env.set_time(T0 + 61);
    assert_error(&env.settle(&auth), SettlementError::AuthorizationExpired);
    env.set_time(T0 + 60);
    env.settle(&auth).unwrap();
}

#[test]
fn over_per_call_cap_fails() {
    let mut env = Env::new();
    let auth = env.authorization(PER_CALL_CAP + 1);
    assert_error(&env.settle(&auth), AgentWalletError::PerCallCapExceeded);
    let auth = env.authorization(PER_CALL_CAP);
    env.settle(&auth).unwrap();
    assert_eq!(env.balance(&env.recipient_token), PER_CALL_CAP);
}

#[test]
fn rolling_daily_cap_blocks_then_ages_out() {
    let mut env = Env::new();
    // 100k + 100k + 50k reaches the 250k cap exactly.
    for amount in [100_000, 100_000, 50_000] {
        let auth = env.authorization(amount);
        env.settle(&auth).unwrap();
    }
    assert_eq!(env.rolling_spend(), DAILY_CAP);
    let auth = env.authorization(1);
    assert_error(&env.settle(&auth), AgentWalletError::DailyCapExceeded);

    // T0 sits inside bucket T0 / 900. 24 hours later the spend still counts.
    env.set_time(T0 + 86_400);
    assert_eq!(env.rolling_spend(), DAILY_CAP);
    let auth = env.authorization(1);
    assert_error(&env.settle(&auth), AgentWalletError::DailyCapExceeded);

    // Once the 97th bucket after the spend begins, it has aged out.
    let bucket_start = (T0 / 900) * 900;
    env.set_time(bucket_start + 97 * 900);
    assert_eq!(env.rolling_spend(), 0);
    let auth = env.authorization(PER_CALL_CAP);
    env.settle(&auth).unwrap();
    assert_eq!(env.rolling_spend(), PER_CALL_CAP);
    assert_eq!(env.balance(&env.recipient_token), DAILY_CAP + PER_CALL_CAP);
    assert_eq!(env.balance(&env.vault), FUNDED - DAILY_CAP - PER_CALL_CAP);
}

#[test]
fn rolling_window_spans_multiple_buckets() {
    let mut env = Env::new();
    let bucket_start = (T0 / 900) * 900;
    env.set_time(bucket_start);
    let a = env.authorization(100_000);
    env.settle(&a).unwrap();
    env.set_time(bucket_start + 12 * 3600);
    let b = env.authorization(100_000);
    env.settle(&b).unwrap();
    // First spend ages out at bucket + 97, the second one still counts.
    env.set_time(bucket_start + 97 * 900);
    assert_eq!(env.rolling_spend(), 100_000);
    let c = env.authorization(100_000);
    env.settle(&c).unwrap();
    let d = env.authorization(50_001);
    assert_error(&env.settle(&d), AgentWalletError::DailyCapExceeded);
}

#[test]
fn off_allow_list_resource_fails() {
    let mut env = Env::new();
    let mut auth = env.authorization(1_000);
    auth.resource_id = resource(2);
    assert_error(&env.settle(&auth), AgentWalletError::ResourceNotAllowed);
}

#[test]
fn allowed_resource_with_a_different_recipient_fails() {
    let mut env = Env::new();
    let attacker = Keypair::new();
    let attacker_token = env.create_token_account(&attacker.pubkey());
    let mut auth = env.authorization(1_000);
    auth.recipient = attacker.pubkey();
    let ed = ed25519_ix(&env.session, &auth.message());
    let settle = env.settle_ix(&auth, &attacker_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, settle], &[&payer]);
    assert_error(&res, AgentWalletError::ResourceNotAllowed);
    assert_eq!(env.balance(&attacker_token), 0);
}

#[test]
fn recipient_token_account_must_belong_to_the_authorized_recipient() {
    let mut env = Env::new();
    let attacker = Keypair::new();
    let attacker_token = env.create_token_account(&attacker.pubkey());
    let auth = env.authorization(1_000);
    let ed = ed25519_ix(&env.session, &auth.message());
    let settle = env.settle_ix(&auth, &attacker_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, settle], &[&payer]);
    assert_error(&res, SettlementError::AccountMismatch);
}

#[test]
fn wrong_mint_fails() {
    let mut env = Env::new();
    let mut auth = env.authorization(1_000);
    auth.mint = Pubkey::new_unique();
    assert_error(&env.settle(&auth), SettlementError::AccountMismatch);
}

#[test]
fn revoked_key_fails() {
    let mut env = Env::new();
    let key = env.session.pubkey();
    env.revoke_session_key(key).unwrap();
    let auth = env.authorization(1_000);
    assert_error(&env.settle(&auth), AgentWalletError::SessionKeyRevoked);
}

#[test]
fn expired_key_fails_and_unknown_key_fails() {
    let mut env = Env::new();
    let temp = Keypair::new();
    env.add_session_key(temp.pubkey(), T0 + 100).unwrap();
    let mut auth = env.authorization(1_000);
    auth.session_key = temp.pubkey();
    auth.expires_at = T0 + 10_000;
    env.settle_signed_by(&auth, &temp).unwrap();

    env.set_time(T0 + 101);
    let mut auth = env.authorization(1_000);
    auth.session_key = temp.pubkey();
    assert_error(
        &env.settle_signed_by(&auth, &temp),
        AgentWalletError::SessionKeyExpired,
    );

    let stranger = Keypair::new();
    let mut auth = env.authorization(1_000);
    auth.session_key = stranger.pubkey();
    assert_error(
        &env.settle_signed_by(&auth, &stranger),
        AgentWalletError::SessionKeyNotFound,
    );
}

#[test]
fn insufficient_funds_fails() {
    let mut env = Env::new();
    env.withdraw(FUNDED - 500).unwrap();
    let auth = env.authorization(501);
    assert_error(&env.settle(&auth), AgentWalletError::InsufficientFunds);
    let auth = env.authorization(500);
    env.settle(&auth).unwrap();
    assert_eq!(env.balance(&env.vault), 0);
}

#[test]
fn zero_amount_fails() {
    let mut env = Env::new();
    let auth = env.authorization(0);
    assert_error(&env.settle(&auth), AgentWalletError::ZeroAmount);
}

// Signature verification and spoofing.

#[test]
fn missing_ed25519_instruction_fails() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let settle = env.settle_ix(&auth, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[settle], &[&payer]);
    assert_error(&res, SettlementError::MissingSignatureVerification);
}

#[test]
fn ed25519_instruction_must_be_immediately_before_settle() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let ed = ed25519_ix(&env.session, &auth.message());
    // A zero lamport self transfer sits between the Ed25519 check and settle.
    let spacer = anchor_lang::solana_program::system_instruction::transfer(
        &env.payer.pubkey(),
        &env.payer.pubkey(),
        0,
    );
    let settle = env.settle_ix(&auth, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, spacer, settle], &[&payer]);
    assert_error(&res, SettlementError::MissingSignatureVerification);
}

#[test]
fn signature_by_a_different_key_fails() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let other = Keypair::new();
    assert_error(
        &env.settle_signed_by(&auth, &other),
        SettlementError::SignatureMismatch,
    );
}

#[test]
fn signature_over_a_different_message_fails() {
    let mut env = Env::new();
    let signed = env.authorization(1_000);
    // The session key signed 1000. The facilitator submits 90000 with the same signature data.
    let mut submitted = signed;
    submitted.amount = 90_000;
    let ed = ed25519_ix(&env.session, &signed.message());
    let settle = env.settle_ix(&submitted, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, settle], &[&payer]);
    assert_error(&res, SettlementError::SignatureMismatch);
    assert_eq!(env.balance(&env.recipient_token), 0);
}

#[test]
fn signature_for_another_program_domain_fails() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let mut message = auth.message();
    message[20..52].copy_from_slice(Pubkey::new_unique().as_ref());
    let ed = ed25519_ix(&env.session, &message);
    let settle = env.settle_ix(&auth, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    assert_error(
        &env.send(&[ed, settle], &[&payer]),
        SettlementError::SignatureMismatch,
    );
}

#[test]
fn offsets_pointing_at_another_instruction_fail() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let message = auth.message();
    // Instruction 0 is a genuine Ed25519 check by the session key.
    let genuine = ed25519_ix(&env.session, &message);
    // Instruction 1 carries an attacker key and signature inline but its offsets point at
    // instruction 0 for the key and the message. The precompile passes, and a naive parser that
    // reads the inline bytes or ignores the index would be fooled.
    let attacker = Keypair::new();
    let attacker_sig = sign(&attacker, &message);
    let data = ed25519_data_with(
        &attacker.pubkey().to_bytes(),
        &attacker_sig,
        &message,
        EdOffsets {
            signature_offset: ED_SIGNATURE_AT,
            signature_ix: 0,
            pubkey_offset: ED_PUBKEY_AT,
            pubkey_ix: 0,
            message_offset: ED_MESSAGE_AT,
            message_size: message.len() as u16,
            message_ix: 0,
        },
    );
    let pointer = Instruction::new_with_bytes(ED25519_ID, &data, vec![]);
    let settle = env.settle_ix(&auth, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[genuine, pointer, settle], &[&payer]);
    assert_error(&res, SettlementError::SignatureMismatch);
}

#[test]
fn offsets_pointing_at_the_settle_instruction_fail() {
    // The key and message live in the settle instruction data. The signature is real, but the
    // indexes are not u16::MAX, so the check refuses it.
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let settle = env.settle_ix(&auth, &env.recipient_token);
    // Settle data is 8 byte discriminator then the 208 byte body. Session key is at 8 + 32.
    let sig = sign(&env.session, &auth.message());
    let data = ed25519_data_with(
        &env.session.pubkey().to_bytes(),
        &sig,
        &auth.message(),
        EdOffsets {
            signature_offset: ED_SIGNATURE_AT,
            signature_ix: u16::MAX,
            pubkey_offset: 8 + 32,
            pubkey_ix: 1,
            message_offset: ED_MESSAGE_AT,
            message_size: auth.message().len() as u16,
            message_ix: u16::MAX,
        },
    );
    let ed = Instruction::new_with_bytes(ED25519_ID, &data, vec![]);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, settle], &[&payer]);
    assert_error(&res, SettlementError::SignatureMismatch);
}

#[test]
fn inline_bytes_not_covered_by_offsets_are_ignored() {
    // The attacker signs the real message with their own key and places the session key bytes
    // in the data where a parser with hardcoded offsets would look. The offsets point at the
    // attacker key, which is what the precompile verified, so the check must refuse it.
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let message = auth.message();
    let attacker = Keypair::new();
    let sig = sign(&attacker, &message);
    let mut data = ed25519_data(&env.session.pubkey().to_bytes(), &sig, &message);
    let attacker_at = data.len() as u16;
    data.extend_from_slice(&attacker.pubkey().to_bytes());
    data[6..8].copy_from_slice(&attacker_at.to_le_bytes());
    let ed = Instruction::new_with_bytes(ED25519_ID, &data, vec![]);
    let settle = env.settle_ix(&auth, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, settle], &[&payer]);
    assert_error(&res, SettlementError::SignatureMismatch);
}

#[test]
fn two_signatures_in_one_ed25519_instruction_fail() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let message = auth.message();
    let other = Keypair::new();
    let other_msg = [9u8; 32];
    let sig1 = sign(&env.session, &message);
    let sig2 = sign(&other, &other_msg);
    // Layout: header, two offset entries, then key1, sig1, msg1, key2, sig2, msg2.
    let start = 2 + 14 * 2;
    let k1 = start;
    let s1 = k1 + 32;
    let m1 = s1 + 64;
    let k2 = m1 + message.len();
    let s2 = k2 + 32;
    let m2 = s2 + 64;
    let mut data = vec![2u8, 0u8];
    for (s, k, m, len) in [(s1, k1, m1, message.len()), (s2, k2, m2, other_msg.len())] {
        for v in [s, 0xFFFF, k, 0xFFFF, m, len, 0xFFFF] {
            data.extend_from_slice(&(v as u16).to_le_bytes());
        }
    }
    data.extend_from_slice(&env.session.pubkey().to_bytes());
    data.extend_from_slice(&sig1);
    data.extend_from_slice(&message);
    data.extend_from_slice(&other.pubkey().to_bytes());
    data.extend_from_slice(&sig2);
    data.extend_from_slice(&other_msg);
    let ed = Instruction::new_with_bytes(ED25519_ID, &data, vec![]);
    let settle = env.settle_ix(&auth, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, settle], &[&payer]);
    assert_error(&res, SettlementError::SignatureMismatch);
}

#[test]
fn a_non_ed25519_instruction_before_settle_fails() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let ed_data = ed25519_ix(&env.session, &auth.message()).data;
    // Same bytes as a real Ed25519 check, but sent to a different program that accepts anything.
    // Same bytes as a real Ed25519 check, sent to the agent wallet rolling_spend view, which
    // succeeds and ignores trailing data. Settle must still refuse it.
    let mut data = agent_wallet::instruction::RollingSpend {}.data();
    data.extend_from_slice(&ed_data);
    let fake = Instruction::new_with_bytes(
        agent_wallet::ID,
        &data,
        agent_wallet::accounts::ReadWallet {
            agent_wallet: env.wallet,
        }
        .to_account_metas(None),
    );
    let settle = env.settle_ix(&auth, &env.recipient_token);
    let payer = env.payer.insecure_clone();
    let res = env.send(&[fake, settle], &[&payer]);
    assert_error(&res, SettlementError::MissingSignatureVerification);
    assert_eq!(env.balance(&env.recipient_token), 0);
}

#[test]
fn wrong_instructions_sysvar_fails() {
    let mut env = Env::new();
    let auth = env.authorization(1_000);
    let ed = ed25519_ix(&env.session, &auth.message());
    let mut settle = env.settle_ix(&auth, &env.recipient_token);
    let sysvar = solana_sdk_ids::sysvar::instructions::ID;
    for meta in settle.accounts.iter_mut() {
        if meta.pubkey == sysvar {
            *meta = AccountMeta::new_readonly(solana_sdk_ids::sysvar::clock::ID, false);
        }
    }
    let payer = env.payer.insecure_clone();
    let res = env.send(&[ed, settle], &[&payer]);
    assert!(res.is_err());
    assert_eq!(custom_error(&res), Some(2012), "ConstraintAddress");
}

// Direct debit without the settlement authority.

fn debit_ix(env: &Env, authority: Pubkey, authority_signs: bool) -> Instruction {
    let mut metas = agent_wallet::accounts::Debit {
        settlement_authority: authority,
        agent_wallet: env.wallet,
        vault: env.vault,
        recipient_token: env.recipient_token,
        token_program: spl_token::ID,
    }
    .to_account_metas(None);
    metas[0] = AccountMeta::new_readonly(authority, authority_signs);
    Instruction::new_with_bytes(
        agent_wallet::ID,
        &agent_wallet::instruction::Debit {
            session_key: env.session.pubkey(),
            amount: 1_000,
            resource_id: env.resource,
        }
        .data(),
        metas,
    )
}

#[test]
fn debit_called_directly_is_refused() {
    let mut env = Env::new();
    // The real settlement authority address, but it cannot sign outside the settlement program.
    let ix = debit_ix(&env, settlement_authority(), false);
    let payer = env.payer.insecure_clone();
    assert_error(
        &env.send(&[ix], &[&payer]),
        AgentWalletError::UnauthorizedCaller,
    );
    // Any signer that is not the settlement authority.
    let impostor = Keypair::new();
    env.svm.airdrop(&impostor.pubkey(), 1_000_000_000).unwrap();
    let ix = debit_ix(&env, impostor.pubkey(), true);
    assert_error(
        &env.send(&[ix], &[&impostor]),
        AgentWalletError::UnauthorizedCaller,
    );
    // The owner cannot debit either.
    let owner = env.owner.insecure_clone();
    let ix = debit_ix(&env, owner.pubkey(), true);
    assert_error(
        &env.send(&[ix], &[&owner]),
        AgentWalletError::UnauthorizedCaller,
    );
    assert_eq!(env.balance(&env.vault), FUNDED);
}

#[test]
fn allow_list_update_takes_effect_at_settlement() {
    let mut env = Env::new();
    let second = Keypair::new();
    let second_token = env.create_token_account(&second.pubkey());
    let entries = vec![
        AllowListEntry {
            resource_id: env.resource,
            recipient: env.recipient.pubkey(),
        },
        AllowListEntry {
            resource_id: resource(3),
            recipient: second.pubkey(),
        },
    ];
    env.update_policy(PER_CALL_CAP, DAILY_CAP, entries).unwrap();
    let mut auth = env.authorization(2_000);
    auth.resource_id = resource(3);
    auth.recipient = second.pubkey();
    let ed = ed25519_ix(&env.session, &auth.message());
    let settle = env.settle_ix(&auth, &second_token);
    let payer = env.payer.insecure_clone();
    env.send(&[ed, settle], &[&payer]).unwrap();
    assert_eq!(env.balance(&second_token), 2_000);

    // An empty allow-list allows nothing.
    env.update_policy(PER_CALL_CAP, DAILY_CAP, vec![]).unwrap();
    let auth = env.authorization(1_000);
    assert_error(&env.settle(&auth), AgentWalletError::ResourceNotAllowed);
}

#[test]
fn verify_receipt_confirms_only_the_exact_payment() {
    let mut env = Env::new();
    let auth = env.authorization(12_345);
    let verify = |env: &mut Env, a: &settlement::PaymentAuthorization| {
        let ix = Instruction::new_with_bytes(
            settlement::ID,
            &settlement::instruction::VerifyReceipt { authorization: *a }.data(),
            settlement::accounts::VerifyReceipt {
                receipt: receipt_address(&a.agent_wallet, &a.nonce).0,
            }
            .to_account_metas(None),
        );
        let payer = env.payer.insecure_clone();
        env.send(&[ix], &[&payer])
    };
    // Before settlement the receipt does not exist. Anchor reports AccountNotInitialized.
    assert_eq!(custom_error(&verify(&mut env, &auth)), Some(3012));
    env.settle(&auth).unwrap();
    assert!(verify(&mut env, &auth).is_ok());
    let mut other = auth;
    other.amount = 12_346;
    assert_error(&verify(&mut env, &other), SettlementError::AccountMismatch);
}
