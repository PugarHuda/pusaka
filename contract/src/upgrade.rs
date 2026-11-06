//! Timelocked upgrades, so the contract account can hold no access key at all.
//!
//! The admin (a separate account, named once by the contract itself) can only *announce* new code by its
//! sha256; the code can be deployed no earlier than UPGRADE_DELAY_MS later, by anyone holding the exact bytes.
//! Every holder sees the announcement (event log and `upgrade_status`) and has the whole delay to withdraw
//! their BTC or sell before code they don't like goes live. `renounce_upgrades` makes the contract immutable.
//! ponytail: raw storage keys (up:*) like the heir and loan market, so no state migration is needed.
use crate::*;

/// Testnet: 10 minutes, so it can be shown. Mainnet: 7 days, longer than any reasonable exit takes.
#[cfg(not(feature = "mainnet"))]
pub const UPGRADE_DELAY_MS: u64 = 10 * 60 * 1000;
#[cfg(feature = "mainnet")]
pub const UPGRADE_DELAY_MS: u64 = 7 * 24 * 3600 * 1000;
const ADMIN: &str = "up:admin";
const PROPOSAL: &str = "up:next";
const RENOUNCED: &str = "up:off";
/// Gas for the migration call chained after a deploy, when one is announced.
const MIGRATE_TGAS: u64 = 100;

#[near(serializers = [borsh, json])]
pub struct UpgradeProposal {
    /// sha256 of the wasm, lower-case hex (what `sha256sum pusaka.wasm` prints)
    pub code_sha256: String,
    /// optional method the new code runs right after it is deployed (a state migration)
    pub migrate: Option<String>,
    pub proposed_ms: U64,
    pub applicable_from_ms: U64,
}

fn admin() -> Option<AccountId> {
    raw_get(ADMIN)
}

fn assert_admin() -> AccountId {
    let a = admin().unwrap_or_else(|| env::panic_str("NoUpgradeAdmin: upgrades are off"));
    require!(env::predecessor_account_id() == a, "NotUpgradeAdmin");
    a
}

#[near]
impl Pusaka {
    /// Names the account that may announce upgrades. Only the contract account itself can call this, so it
    /// is set once, before the contract's own keys are deleted; after that nobody can change it.
    #[private]
    pub fn set_upgrade_admin(&mut self, admin: AccountId) {
        // #[private] already checks this in the wasm wrapper; said again so the rule is in the body and tested
        require!(env::predecessor_account_id() == env::current_account_id(), "OnlyTheContractItself");
        require!(env::storage_read(RENOUNCED.as_bytes()).is_none(), "Renounced: this contract can't be upgraded");
        raw_put(ADMIN, &admin);
        env::log_str(&format!("upgrade admin: {admin}"));
    }

    /// The admin announces new code by its sha256. It can be deployed from `applicable_from_ms` on.
    /// A new announcement replaces the old one and restarts the delay.
    pub fn propose_upgrade(&mut self, code_sha256: String, migrate: Option<String>) -> UpgradeProposal {
        assert_admin();
        let h = code_sha256.to_ascii_lowercase();
        require!(h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()), "code_sha256 must be 64 hex characters");
        if let Some(m) = &migrate {
            require!(!m.is_empty() && m.len() <= 64 && m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'), "bad migrate method name");
        }
        let now = env::block_timestamp_ms();
        let p = UpgradeProposal { code_sha256: h, migrate, proposed_ms: U64(now), applicable_from_ms: U64(now + UPGRADE_DELAY_MS) };
        raw_put(PROPOSAL, &p);
        env::log_str(&format!(
            "EVENT_JSON:{}",
            json!({"standard": "pusaka", "version": "1.0.0", "event": "upgrade_proposed", "data": [&p]})
        ));
        p
    }

    /// The admin hands the role to another account, e.g. a DAO, so upgrades then need its vote too.
    /// Any pending announcement is dropped: the new admin announces for itself.
    pub fn transfer_upgrade_admin(&mut self, new_admin: AccountId) {
        let old = assert_admin();
        raw_put(ADMIN, &new_admin);
        env::storage_remove(PROPOSAL.as_bytes());
        env::log_str(&format!("upgrade admin: {old} -> {new_admin}"));
    }

    /// The admin withdraws the announcement.
    pub fn cancel_upgrade(&mut self) {
        assert_admin();
        env::storage_remove(PROPOSAL.as_bytes());
        env::log_str("upgrade cancelled");
    }

    /// The admin gives up upgrades for good: the code deployed now is final.
    pub fn renounce_upgrades(&mut self) {
        assert_admin();
        env::storage_remove(PROPOSAL.as_bytes());
        env::storage_remove(ADMIN.as_bytes());
        env::storage_write(RENOUNCED.as_bytes(), &[1]);
        env::log_str("upgrades renounced: this code is final");
    }

    /// Deploys the announced code once the delay has passed. The arguments are the raw wasm bytes (not
    /// JSON); anyone may send them, since only the announced hash is accepted.
    pub fn apply_upgrade(&mut self) -> Promise {
        let p: UpgradeProposal = raw_get(PROPOSAL).unwrap_or_else(|| env::panic_str("NoUpgradeProposed"));
        let now = env::block_timestamp_ms();
        require!(now >= p.applicable_from_ms.0, format!("TooEarly: deployable from {} ms", p.applicable_from_ms.0));
        let code = env::input().unwrap_or_default();
        require!(hex::encode(env::sha256_array(&code)) == p.code_sha256, "CodeMismatch: these bytes aren't the announced code");
        env::storage_remove(PROPOSAL.as_bytes());
        env::log_str(&format!("upgrade applied: {}", p.code_sha256));
        let deploy = Promise::new(env::current_account_id()).deploy_contract(code);
        match p.migrate {
            Some(m) => deploy.function_call(m, vec![], NearToken::from_yoctonear(0), Gas::from_tgas(MIGRATE_TGAS)),
            None => deploy,
        }
    }

    pub fn upgrade_status(&self) -> Value {
        json!({
            "admin": admin(),
            "renounced": env::storage_read(RENOUNCED.as_bytes()).is_some(),
            "delay_ms": U64(UPGRADE_DELAY_MS),
            "proposal": raw_get::<UpgradeProposal>(PROPOSAL),
        })
    }
}
