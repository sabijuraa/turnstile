//! Pure policy logic. `check_payment` runs its checks in the same order as `evaluatePayment`
//! in packages/shared/src/policy.ts so off-chain clients report the same reason the chain would.

use anchor_lang::prelude::*;

use crate::error::AgentWalletError;
use crate::state::{
    AgentWallet, SessionKey, SpendBucket, MAX_SESSION_KEYS, SPEND_BUCKET_COUNT,
    SPEND_BUCKET_SECONDS, SPEND_WINDOW_LOOKBACK,
};

pub fn validate_caps(per_call_cap: u64, daily_cap: u64) -> Result<()> {
    require!(per_call_cap <= daily_cap, AgentWalletError::InvalidPolicy);
    Ok(())
}

/// `floor(unix_timestamp / 900)`.
pub fn bucket_index(unix_timestamp: i64) -> i64 {
    unix_timestamp.div_euclid(SPEND_BUCKET_SECONDS)
}

fn is_expired(key: &SessionKey, now: i64) -> bool {
    key.expires_at != 0 && now > key.expires_at
}

/// Sum of buckets with `index >= now_index - 96`.
pub fn rolling_spend(buckets: &[SpendBucket], now: i64) -> Result<u64> {
    let floor = bucket_index(now)
        .checked_sub(SPEND_WINDOW_LOOKBACK)
        .ok_or(AgentWalletError::ArithmeticOverflow)?;
    let mut total: u64 = 0;
    for bucket in buckets {
        if bucket.amount > 0 && bucket.index >= floor {
            total = total
                .checked_add(bucket.amount)
                .ok_or(AgentWalletError::ArithmeticOverflow)?;
        }
    }
    Ok(total)
}

/// Adds `amount` to the bucket for `now`. A slot still holding an older index is reset first.
/// The window covers 97 consecutive indexes, each in its own slot, so a reset slot only ever
/// held spend that has already left the window.
pub fn record_spend(buckets: &mut [SpendBucket], amount: u64, now: i64) -> Result<()> {
    let index = bucket_index(now);
    let slot = usize::try_from(index.rem_euclid(SPEND_BUCKET_COUNT as i64))
        .map_err(|_| AgentWalletError::ArithmeticOverflow)?;
    let bucket = buckets
        .get_mut(slot)
        .ok_or(AgentWalletError::AccountMismatch)?;
    if bucket.index == index {
        bucket.amount = bucket
            .amount
            .checked_add(amount)
            .ok_or(AgentWalletError::ArithmeticOverflow)?;
    } else {
        *bucket = SpendBucket { index, amount };
    }
    Ok(())
}

/// Full policy check for one payment. Order matters and mirrors the TypeScript mirror.
pub fn check_payment(
    wallet: &AgentWallet,
    session_key: &Pubkey,
    amount: u64,
    resource_id: &[u8; 32],
    recipient: &Pubkey,
    vault_balance: u64,
    now: i64,
) -> Result<()> {
    require!(amount > 0, AgentWalletError::ZeroAmount);
    let key = wallet
        .session_keys
        .iter()
        .find(|k| k.key == *session_key)
        .ok_or(AgentWalletError::SessionKeyNotFound)?;
    require!(key.active, AgentWalletError::SessionKeyRevoked);
    require!(!is_expired(key, now), AgentWalletError::SessionKeyExpired);
    require!(
        amount <= wallet.per_call_cap,
        AgentWalletError::PerCallCapExceeded
    );
    let allowed = wallet
        .allow_list
        .iter()
        .any(|e| e.resource_id == *resource_id && e.recipient == *recipient);
    require!(allowed, AgentWalletError::ResourceNotAllowed);
    let spent = rolling_spend(&wallet.spend_buckets, now)?;
    // A sum past u64::MAX is above any cap, so overflow is a cap violation.
    let after = spent
        .checked_add(amount)
        .ok_or(AgentWalletError::DailyCapExceeded)?;
    require!(
        after <= wallet.daily_cap,
        AgentWalletError::DailyCapExceeded
    );
    require!(vault_balance >= amount, AgentWalletError::InsufficientFunds);
    Ok(())
}

pub fn add_session_key(
    keys: &mut Vec<SessionKey>,
    key: Pubkey,
    expires_at: i64,
    now: i64,
) -> Result<()> {
    require!(
        !keys.iter().any(|k| k.key == key),
        AgentWalletError::DuplicateSessionKey
    );
    let entry = SessionKey {
        key,
        expires_at,
        active: true,
    };
    if keys.len() < MAX_SESSION_KEYS {
        keys.push(entry);
        return Ok(());
    }
    let reusable = keys
        .iter_mut()
        .find(|k| !k.active || is_expired(k, now))
        .ok_or(AgentWalletError::TooManySessionKeys)?;
    *reusable = entry;
    Ok(())
}

pub fn revoke_session_key(keys: &mut [SessionKey], key: &Pubkey) -> Result<()> {
    let entry = keys
        .iter_mut()
        .find(|k| k.key == *key)
        .ok_or(AgentWalletError::SessionKeyNotFound)?;
    require!(entry.active, AgentWalletError::SessionKeyRevoked);
    entry.active = false;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AllowListEntry;

    const T0: i64 = 1_800_000_000;

    fn err_name(result: Result<()>) -> String {
        match result {
            Err(Error::AnchorError(e)) => e.error_name,
            other => format!("{other:?}"),
        }
    }

    fn wallet(session: Pubkey, recipient: Pubkey, resource: [u8; 32]) -> AgentWallet {
        AgentWallet {
            owner: Pubkey::new_unique(),
            id: 0,
            mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            bump: 255,
            vault_bump: 255,
            created_at: T0,
            per_call_cap: 100,
            daily_cap: 250,
            session_keys: vec![SessionKey {
                key: session,
                expires_at: 0,
                active: true,
            }],
            allow_list: vec![AllowListEntry {
                resource_id: resource,
                recipient,
            }],
            spend_buckets: vec![SpendBucket::default(); SPEND_BUCKET_COUNT],
            total_spent: 0,
            settlement_count: 0,
        }
    }

    #[test]
    fn settlement_authority_constant_matches_derivation() {
        let (pda, _) = Pubkey::find_program_address(
            &[crate::SEED_SETTLEMENT_AUTHORITY],
            &crate::SETTLEMENT_PROGRAM_ID,
        );
        assert_eq!(pda, crate::SETTLEMENT_AUTHORITY);
    }

    #[test]
    fn checks_run_in_mirror_order() {
        let session = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let resource = [7u8; 32];
        let mut w = wallet(session, recipient, resource);
        // Zero amount wins over an unknown key.
        let unknown = Pubkey::new_unique();
        assert_eq!(
            err_name(check_payment(&w, &unknown, 0, &resource, &recipient, 0, T0)),
            "ZeroAmount"
        );
        assert_eq!(
            err_name(check_payment(&w, &unknown, 1, &resource, &recipient, 0, T0)),
            "SessionKeyNotFound"
        );
        // Over the per-call cap and off the allow-list reports the cap first.
        assert_eq!(
            err_name(check_payment(
                &w, &session, 101, &[0u8; 32], &recipient, 0, T0
            )),
            "PerCallCapExceeded"
        );
        // Off the allow-list and with an empty vault reports the allow-list first.
        assert_eq!(
            err_name(check_payment(
                &w, &session, 10, &[0u8; 32], &recipient, 0, T0
            )),
            "ResourceNotAllowed"
        );
        record_spend(&mut w.spend_buckets, 200, T0).unwrap();
        // Over the daily cap with an empty vault reports the daily cap first.
        assert_eq!(
            err_name(check_payment(
                &w, &session, 51, &resource, &recipient, 0, T0
            )),
            "DailyCapExceeded"
        );
        assert_eq!(
            err_name(check_payment(
                &w, &session, 50, &resource, &recipient, 49, T0
            )),
            "InsufficientFunds"
        );
        assert!(check_payment(&w, &session, 50, &resource, &recipient, 50, T0).is_ok());
        w.session_keys[0].expires_at = T0 - 1;
        assert_eq!(
            err_name(check_payment(
                &w, &session, 1, &resource, &recipient, 50, T0
            )),
            "SessionKeyExpired"
        );
        // Expiry is inclusive of the expiry second itself.
        w.session_keys[0].expires_at = T0;
        assert!(check_payment(&w, &session, 1, &resource, &recipient, 50, T0).is_ok());
        w.session_keys[0].active = false;
        assert_eq!(
            err_name(check_payment(
                &w, &session, 1, &resource, &recipient, 50, T0
            )),
            "SessionKeyRevoked"
        );
    }

    #[test]
    fn rolling_window_counts_97_buckets() {
        let mut buckets = vec![SpendBucket::default(); SPEND_BUCKET_COUNT];
        let start = 2_000 * SPEND_BUCKET_SECONDS; // start of a bucket
        record_spend(&mut buckets, 10, start).unwrap();
        record_spend(&mut buckets, 5, start + 899).unwrap();
        assert_eq!(buckets.iter().filter(|b| b.amount > 0).count(), 1);
        assert_eq!(rolling_spend(&buckets, start).unwrap(), 15);
        // Still counted 96 buckets later, which is 24 hours after the bucket start.
        assert_eq!(rolling_spend(&buckets, start + 96 * 900).unwrap(), 15);
        assert_eq!(rolling_spend(&buckets, start + 96 * 900 + 899).unwrap(), 15);
        // Gone once the 97th bucket after it begins.
        assert_eq!(rolling_spend(&buckets, start + 97 * 900).unwrap(), 0);
        // A new spend 97 buckets later lands in the same slot and replaces the old one.
        record_spend(&mut buckets, 3, start + 97 * 900).unwrap();
        assert_eq!(buckets.iter().filter(|b| b.amount > 0).count(), 1);
        assert_eq!(rolling_spend(&buckets, start + 97 * 900).unwrap(), 3);
    }

    #[test]
    fn rolling_window_never_admits_more_than_cap_in_24h() {
        // Spend the cap in one bucket, then try again every 15 minutes for a day.
        let mut buckets = vec![SpendBucket::default(); SPEND_BUCKET_COUNT];
        let t = 5_000 * SPEND_BUCKET_SECONDS + 450;
        record_spend(&mut buckets, 250, t).unwrap();
        let mut now = t;
        while now < t + 86_400 {
            assert_eq!(rolling_spend(&buckets, now).unwrap(), 250);
            now += 900;
        }
    }

    #[test]
    fn session_key_slots() {
        let now = T0;
        let mut keys = Vec::new();
        let k: Vec<Pubkey> = (0..6).map(|_| Pubkey::new_unique()).collect();
        for key in &k[..4] {
            add_session_key(&mut keys, *key, 0, now).unwrap();
        }
        assert_eq!(
            err_name(add_session_key(&mut keys, k[0], 0, now)),
            "DuplicateSessionKey"
        );
        assert_eq!(
            err_name(add_session_key(&mut keys, k[4], 0, now)),
            "TooManySessionKeys"
        );
        revoke_session_key(&mut keys, &k[1]).unwrap();
        assert_eq!(
            err_name(revoke_session_key(&mut keys, &k[1])),
            "SessionKeyRevoked"
        );
        assert_eq!(
            err_name(revoke_session_key(&mut keys, &k[5])),
            "SessionKeyNotFound"
        );
        // A revoked key stays blocked while it holds its slot.
        assert_eq!(
            err_name(add_session_key(&mut keys, k[1], 0, now)),
            "DuplicateSessionKey"
        );
        add_session_key(&mut keys, k[4], 0, now).unwrap();
        assert_eq!(keys[1].key, k[4]);
        assert!(keys[1].active);
        assert_eq!(keys.len(), 4);
    }

    #[test]
    fn caps_must_be_ordered() {
        assert!(validate_caps(10, 10).is_ok());
        assert_eq!(err_name(validate_caps(11, 10)), "InvalidPolicy");
    }
}
