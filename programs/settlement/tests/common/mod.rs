//! Shared LiteSVM harness for the agent_wallet and settlement programs.
//! Loads the SBF builds from target/deploy, so run `cargo build-sbf` (or `anchor build`) first.

#![allow(dead_code, clippy::result_large_err)]

use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use settlement::PaymentAuthorization;
use solana_instruction_error::InstructionError;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

pub const T0: i64 = 1_800_000_000;
pub const DECIMALS: u8 = 6;
pub const PER_CALL_CAP: u64 = 100_000;
pub const DAILY_CAP: u64 = 250_000;
pub const FUNDED: u64 = 1_000_000;
pub const ED25519_ID: Pubkey = settlement::ed25519::ED25519_PROGRAM_ID;

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub fn resource(n: u8) -> [u8; 32] {
    [n; 32]
}

pub struct Env {
    pub svm: LiteSVM,
    pub payer: Keypair,
    pub owner: Keypair,
    pub session: Keypair,
    pub mint_authority: Keypair,
    pub mint: Pubkey,
    pub wallet_id: u64,
    pub wallet: Pubkey,
    pub vault: Pubkey,
    pub owner_token: Pubkey,
    pub recipient: Keypair,
    pub recipient_token: Pubkey,
    pub resource: [u8; 32],
    nonce_counter: u64,
}

fn deploy_path(name: &str) -> String {
    format!(
        "{}/../../target/deploy/{name}.so",
        env!("CARGO_MANIFEST_DIR")
    )
}

impl Env {
    /// A funded wallet with the default caps and one allow-list entry for `resource(1)` paid to
    /// `recipient`.
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(agent_wallet::ID, deploy_path("agent_wallet"))
            .expect("agent_wallet.so is missing. Run cargo build-sbf first.");
        svm.add_program_from_file(settlement::ID, deploy_path("settlement"))
            .expect("settlement.so is missing. Run cargo build-sbf first.");
        let mut env = Self {
            svm,
            payer: Keypair::new(),
            owner: Keypair::new(),
            session: Keypair::new(),
            mint_authority: Keypair::new(),
            mint: Pubkey::default(),
            wallet_id: 7,
            wallet: Pubkey::default(),
            vault: Pubkey::default(),
            owner_token: Pubkey::default(),
            recipient: Keypair::new(),
            recipient_token: Pubkey::default(),
            resource: resource(1),
            nonce_counter: 0,
        };
        env.set_time(T0);
        for kp in [&env.payer, &env.owner, &env.mint_authority] {
            env.svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        }
        env.mint = env.create_mint();
        env.owner_token = env.create_token_account(&env.owner.pubkey());
        env.recipient_token = env.create_token_account(&env.recipient.pubkey());
        env.mint_to(&env.owner_token.clone(), 5_000_000);
        let (wallet, _) = wallet_address(&env.owner.pubkey(), env.wallet_id);
        env.wallet = wallet;
        env.vault = vault_address(&wallet).0;
        let session = env.session.pubkey();
        env.create_wallet(PER_CALL_CAP, DAILY_CAP, session, 0)
            .unwrap();
        env.deposit(FUNDED).unwrap();
        let entries = vec![agent_wallet::AllowListEntry {
            resource_id: env.resource,
            recipient: env.recipient.pubkey(),
        }];
        env.update_policy(PER_CALL_CAP, DAILY_CAP, entries).unwrap();
        env
    }

    pub fn set_time(&mut self, unix: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = unix;
        clock.slot = clock.slot.saturating_add(1);
        self.svm.set_sysvar(&clock);
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
        let payer = signers[0].pubkey();
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer),
            signers,
            self.svm.latest_blockhash(),
        );
        let res = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        res
    }

    pub fn create_mint(&mut self) -> Pubkey {
        let mint = Keypair::new();
        let rent = self
            .svm
            .minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
        let ixs = [
            system_instruction::create_account(
                &self.payer.pubkey(),
                &mint.pubkey(),
                rent,
                spl_token::state::Mint::LEN as u64,
                &spl_token::ID,
            ),
            spl_token::instruction::initialize_mint2(
                &spl_token::ID,
                &mint.pubkey(),
                &self.mint_authority.pubkey(),
                None,
                DECIMALS,
            )
            .unwrap(),
        ];
        let payer = self.payer.insecure_clone();
        self.send(&ixs, &[&payer, &mint]).unwrap();
        mint.pubkey()
    }

    pub fn create_token_account(&mut self, owner: &Pubkey) -> Pubkey {
        let mint = self.mint;
        self.create_token_account_for_mint(owner, &mint)
    }

    pub fn create_token_account_for_mint(&mut self, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        let account = Keypair::new();
        let rent = self
            .svm
            .minimum_balance_for_rent_exemption(spl_token::state::Account::LEN);
        let ixs = [
            system_instruction::create_account(
                &self.payer.pubkey(),
                &account.pubkey(),
                rent,
                spl_token::state::Account::LEN as u64,
                &spl_token::ID,
            ),
            spl_token::instruction::initialize_account3(
                &spl_token::ID,
                &account.pubkey(),
                mint,
                owner,
            )
            .unwrap(),
        ];
        let payer = self.payer.insecure_clone();
        self.send(&ixs, &[&payer, &account]).unwrap();
        account.pubkey()
    }

    pub fn mint_to(&mut self, account: &Pubkey, amount: u64) {
        let ix = spl_token::instruction::mint_to(
            &spl_token::ID,
            &self.mint,
            account,
            &self.mint_authority.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        let authority = self.mint_authority.insecure_clone();
        self.send(&[ix], &[&authority]).unwrap();
    }

    pub fn balance(&self, account: &Pubkey) -> u64 {
        let data = self.svm.get_account(account).unwrap().data;
        spl_token::state::Account::unpack(&data).unwrap().amount
    }

    pub fn wallet_state(&self) -> agent_wallet::AgentWallet {
        let data = self.svm.get_account(&self.wallet).unwrap().data;
        agent_wallet::AgentWallet::try_deserialize(&mut data.as_slice()).unwrap()
    }

    // Owner instructions.

    pub fn create_wallet_ix(
        &self,
        owner: &Pubkey,
        id: u64,
        per_call_cap: u64,
        daily_cap: u64,
        session_key: Pubkey,
        session_expires_at: i64,
    ) -> Instruction {
        let (wallet, _) = wallet_address(owner, id);
        Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::CreateWallet {
                id,
                per_call_cap,
                daily_cap,
                session_key,
                session_expires_at,
            }
            .data(),
            agent_wallet::accounts::CreateWallet {
                owner: *owner,
                agent_wallet: wallet,
                mint: self.mint,
                vault: vault_address(&wallet).0,
                token_program: spl_token::ID,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn create_wallet(
        &mut self,
        per_call_cap: u64,
        daily_cap: u64,
        session_key: Pubkey,
        expires_at: i64,
    ) -> TxResult {
        let owner = self.owner.insecure_clone();
        let ix = self.create_wallet_ix(
            &owner.pubkey(),
            self.wallet_id,
            per_call_cap,
            daily_cap,
            session_key,
            expires_at,
        );
        self.send(&[ix], &[&owner])
    }

    pub fn deposit_ix(&self, owner: &Pubkey, owner_token: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::Deposit { amount }.data(),
            agent_wallet::accounts::Deposit {
                owner: *owner,
                agent_wallet: self.wallet,
                vault: self.vault,
                owner_token: *owner_token,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn deposit(&mut self, amount: u64) -> TxResult {
        let owner = self.owner.insecure_clone();
        let ix = self.deposit_ix(&owner.pubkey(), &self.owner_token, amount);
        self.send(&[ix], &[&owner])
    }

    pub fn withdraw_ix(&self, owner: &Pubkey, owner_token: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::Withdraw { amount }.data(),
            agent_wallet::accounts::Withdraw {
                owner: *owner,
                agent_wallet: self.wallet,
                vault: self.vault,
                owner_token: *owner_token,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn withdraw(&mut self, amount: u64) -> TxResult {
        let owner = self.owner.insecure_clone();
        let ix = self.withdraw_ix(&owner.pubkey(), &self.owner_token, amount);
        self.send(&[ix], &[&owner])
    }

    fn owner_only_metas(&self, owner: &Pubkey) -> Vec<anchor_lang::prelude::AccountMeta> {
        agent_wallet::accounts::OwnerOnly {
            owner: *owner,
            agent_wallet: self.wallet,
        }
        .to_account_metas(None)
    }

    pub fn add_session_key_ix(&self, owner: &Pubkey, key: Pubkey, expires_at: i64) -> Instruction {
        Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::AddSessionKey { key, expires_at }.data(),
            self.owner_only_metas(owner),
        )
    }

    pub fn revoke_session_key_ix(&self, owner: &Pubkey, key: Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::RevokeSessionKey { key }.data(),
            self.owner_only_metas(owner),
        )
    }

    pub fn update_policy_ix(
        &self,
        owner: &Pubkey,
        per_call_cap: u64,
        daily_cap: u64,
        allow_list: Vec<agent_wallet::AllowListEntry>,
    ) -> Instruction {
        Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::UpdatePolicy {
                per_call_cap,
                daily_cap,
                allow_list,
            }
            .data(),
            self.owner_only_metas(owner),
        )
    }

    pub fn owner_call(&mut self, ix: Instruction) -> TxResult {
        let owner = self.owner.insecure_clone();
        self.send(&[ix], &[&owner])
    }

    pub fn add_session_key(&mut self, key: Pubkey, expires_at: i64) -> TxResult {
        let ix = self.add_session_key_ix(&self.owner.pubkey(), key, expires_at);
        self.owner_call(ix)
    }

    pub fn revoke_session_key(&mut self, key: Pubkey) -> TxResult {
        let ix = self.revoke_session_key_ix(&self.owner.pubkey(), key);
        self.owner_call(ix)
    }

    pub fn update_policy(
        &mut self,
        per_call_cap: u64,
        daily_cap: u64,
        allow_list: Vec<agent_wallet::AllowListEntry>,
    ) -> TxResult {
        let ix = self.update_policy_ix(&self.owner.pubkey(), per_call_cap, daily_cap, allow_list);
        self.owner_call(ix)
    }

    pub fn close_wallet_ix(&self, owner: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::CloseWallet {}.data(),
            agent_wallet::accounts::CloseWallet {
                owner: *owner,
                agent_wallet: self.wallet,
                vault: self.vault,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn rolling_spend(&mut self) -> u64 {
        let ix = Instruction::new_with_bytes(
            agent_wallet::ID,
            &agent_wallet::instruction::RollingSpend {}.data(),
            agent_wallet::accounts::ReadWallet {
                agent_wallet: self.wallet,
            }
            .to_account_metas(None),
        );
        let payer = self.payer.insecure_clone();
        let meta = self.send(&[ix], &[&payer]).unwrap();
        assert_eq!(meta.return_data.program_id, agent_wallet::ID);
        u64::from_le_bytes(meta.return_data.data.as_slice().try_into().unwrap())
    }

    // Settlement.

    pub fn next_nonce(&mut self) -> [u8; 32] {
        self.nonce_counter += 1;
        let mut nonce = [0u8; 32];
        nonce[..8].copy_from_slice(&self.nonce_counter.to_le_bytes());
        nonce[31] = 0xAB;
        nonce
    }

    pub fn authorization(&mut self, amount: u64) -> PaymentAuthorization {
        PaymentAuthorization {
            agent_wallet: self.wallet,
            session_key: self.session.pubkey(),
            recipient: self.recipient.pubkey(),
            mint: self.mint,
            amount,
            resource_id: self.resource,
            nonce: self.next_nonce(),
            expires_at: self.now() + 300,
        }
    }

    pub fn settle_ix(&self, auth: &PaymentAuthorization, recipient_token: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            settlement::ID,
            &settlement::instruction::Settle {
                authorization: *auth,
            }
            .data(),
            settlement::accounts::Settle {
                fee_payer: self.payer.pubkey(),
                settlement_authority: settlement_authority(),
                agent_wallet: auth.agent_wallet,
                vault: self.vault,
                recipient_token: *recipient_token,
                receipt: receipt_address(&auth.agent_wallet, &auth.nonce).0,
                instructions: solana_sdk_ids::sysvar::instructions::ID,
                agent_wallet_program: agent_wallet::ID,
                token_program: spl_token::ID,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    /// Signs `auth` with the session key and sends `[ed25519, settle]`.
    pub fn settle(&mut self, auth: &PaymentAuthorization) -> TxResult {
        let session = self.session.insecure_clone();
        self.settle_signed_by(auth, &session)
    }

    pub fn settle_signed_by(&mut self, auth: &PaymentAuthorization, signer: &Keypair) -> TxResult {
        let ed = ed25519_ix(signer, &auth.message());
        let settle = self.settle_ix(auth, &self.recipient_token);
        let payer = self.payer.insecure_clone();
        self.send(&[ed, settle], &[&payer])
    }

    pub fn receipt(&self, auth: &PaymentAuthorization) -> Option<settlement::Receipt> {
        let (address, _) = receipt_address(&auth.agent_wallet, &auth.nonce);
        let account = self.svm.get_account(&address)?;
        if account.data.is_empty() {
            return None;
        }
        Some(settlement::Receipt::try_deserialize(&mut account.data.as_slice()).unwrap())
    }
}

pub fn wallet_address(owner: &Pubkey, id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"agent_wallet", owner.as_ref(), &id.to_le_bytes()],
        &agent_wallet::ID,
    )
}

pub fn vault_address(wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vault", wallet.as_ref()], &agent_wallet::ID)
}

pub fn receipt_address(wallet: &Pubkey, nonce: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"receipt", wallet.as_ref(), nonce], &settlement::ID)
}

pub fn settlement_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"settlement_authority"], &settlement::ID).0
}

/// Offsets of one Ed25519 signature entry.
#[derive(Clone, Copy)]
pub struct EdOffsets {
    pub signature_offset: u16,
    pub signature_ix: u16,
    pub pubkey_offset: u16,
    pub pubkey_ix: u16,
    pub message_offset: u16,
    pub message_size: u16,
    pub message_ix: u16,
}

pub const ED_PUBKEY_AT: u16 = 16;
pub const ED_SIGNATURE_AT: u16 = 48;
pub const ED_MESSAGE_AT: u16 = 112;

/// Standard layout, same as `Ed25519Program.createInstructionWithPublicKey` in web3.js.
pub fn ed25519_data(pubkey: &[u8; 32], signature: &[u8; 64], message: &[u8]) -> Vec<u8> {
    ed25519_data_with(
        pubkey,
        signature,
        message,
        EdOffsets {
            signature_offset: ED_SIGNATURE_AT,
            signature_ix: u16::MAX,
            pubkey_offset: ED_PUBKEY_AT,
            pubkey_ix: u16::MAX,
            message_offset: ED_MESSAGE_AT,
            message_size: message.len() as u16,
            message_ix: u16::MAX,
        },
    )
}

pub fn ed25519_data_with(
    pubkey: &[u8; 32],
    signature: &[u8; 64],
    message: &[u8],
    o: EdOffsets,
) -> Vec<u8> {
    let mut data = vec![1u8, 0u8];
    for v in [
        o.signature_offset,
        o.signature_ix,
        o.pubkey_offset,
        o.pubkey_ix,
        o.message_offset,
        o.message_size,
        o.message_ix,
    ] {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(pubkey);
    data.extend_from_slice(signature);
    data.extend_from_slice(message);
    data
}

pub fn sign(signer: &Keypair, message: &[u8]) -> [u8; 64] {
    let sig = signer.sign_message(message);
    let bytes: &[u8] = sig.as_ref();
    bytes.try_into().unwrap()
}

pub fn ed25519_ix(signer: &Keypair, message: &[u8]) -> Instruction {
    let data = ed25519_data(&signer.pubkey().to_bytes(), &sign(signer, message), message);
    Instruction::new_with_bytes(ED25519_ID, &data, vec![])
}

/// Custom program error code of a failed transaction, if any.
pub fn custom_error(res: &TxResult) -> Option<u32> {
    match res {
        Err(failed) => match &failed.err {
            TransactionError::InstructionError(_, InstructionError::Custom(c)) => Some(*c),
            _ => None,
        },
        Ok(_) => None,
    }
}

#[track_caller]
pub fn assert_error<E: Into<u32> + std::fmt::Debug + Copy>(res: &TxResult, expected: E) {
    let code: u32 = expected.into();
    match res {
        Ok(_) => panic!("expected {expected:?} ({code}) but the transaction succeeded"),
        Err(failed) => assert_eq!(
            custom_error(res),
            Some(code),
            "expected {expected:?} ({code}), got {:?}\nlogs {:#?}",
            failed.err,
            failed.meta.logs
        ),
    }
}

pub fn compute_units(res: &TxResult) -> u64 {
    match res {
        Ok(meta) => meta.compute_units_consumed,
        Err(failed) => failed.meta.compute_units_consumed,
    }
}
