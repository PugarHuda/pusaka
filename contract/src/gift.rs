//! Give a Pusaka as a link: a NEAR linkdrop (NEP-452 `claim` / `create_account_and_claim`) built into the contract.
//!
//! The owner calls `gift(token_id, public_key)`: the token is locked like a listing and the contract adds a
//! function-call key for `public_key` to its own account, limited to `claim` and `create_account_and_claim`. The
//! private key travels in the link. Whoever opens it signs one of those two calls as the contract account; the
//! contract finds the gift by the signing key (`env::signer_account_pk`), transfers the NFT (and so the Bitcoin it
//! controls) and deletes the key. `create_account_and_claim` first creates a brand-new named account through the
//! network's registrar and funds it, so the recipient needs no wallet and no NEAR to start.
//!
//! Keypom (the reference NEP-452 contract) computes key allowances for an older gas price, and a 100 TGas claim
//! is refused at today's pessimistic price; this contract sizes the allowance for it (GIFT_ALLOWANCE).
//! ponytail: raw storage keys (gk:, gt:) like the heir and loan market, so no state migration is needed.
use crate::*;
use near_sdk::{Allowance, PublicKey};

/// Worst-case gas cost of one 100 TGas claim at the protocol's pessimistic price (~0.101 NEAR measured on testnet).
const GIFT_ALLOWANCE: NearToken = NearToken::from_millinear(110);
/// What the giver attaches: the allowance (mostly unspent; it stays with the contract, which pays the claim's gas),
/// plus NEAR for the recipient's new account, plus storage.
pub const GIFT_DEPOSIT: NearToken = NearToken::from_millinear(250);
/// Sent to whoever claims, so a new account can pay its first transactions: a wallet prepays a 100 TGas call at
/// the pessimistic gas price (~0.101 NEAR), so less than that and it can't even move its new Pusaka.
const GIFT_TO_RECIPIENT: NearToken = NearToken::from_millinear(130);
const CLAIM_METHODS: &str = "claim,create_account_and_claim";
#[cfg(not(feature = "mainnet"))]
pub(crate) const REGISTRAR: &str = "testnet";
#[cfg(feature = "mainnet")]
pub(crate) const REGISTRAR: &str = "near";

#[near(serializers = [borsh, json])]
pub struct Gift {
    pub token_id: TokenId,
    pub from: AccountId,
    /// set while a new account is being created for it, so the key can't claim twice meanwhile
    pub claiming: bool,
    /// set once this contract's own AddKey succeeded: only then is the key ours to use and to delete
    pub active: bool,
}

fn key_slot(pk: &PublicKey) -> String {
    format!("gk:{}", String::from(pk))
}

pub(crate) fn token_slot(token_id: &str) -> String {
    format!("gt:{token_id}")
}

pub(crate) fn is_gifted(token_id: &str) -> bool {
    env::storage_has_key(token_slot(token_id).as_bytes())
}

#[near]
impl Pusaka {
    /// The owner turns the Pusaka into a one-use claim link for `public_key`. Attach GIFT_DEPOSIT (0.25 NEAR).
    #[payable]
    pub fn gift(&mut self, token_id: TokenId, public_key: PublicKey) {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        require!(env::attached_deposit() >= GIFT_DEPOSIT, format!("attach {GIFT_DEPOSIT} (key allowance, the recipient's first NEAR, storage)"));
        let slot = key_slot(&public_key);
        require!(!env::storage_has_key(slot.as_bytes()), "that key is already a gift");
        let from = env::predecessor_account_id();
        raw_put(&slot, &Gift { token_id: token_id.clone(), from: from.clone(), claiming: false, active: false });
        raw_put(&token_slot(&token_id), &String::from(&public_key));
        emit_metadata_update(&token_id); // locked: the live art shows it
        env::log_str(&format!("pusaka #{token_id}: gifted by {from} as a claim link"));
        Promise::new(env::current_account_id())
            .add_access_key_allowance(public_key.clone(), Allowance::limited(GIFT_ALLOWANCE).unwrap(), env::current_account_id(), CLAIM_METHODS)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_gift_key",
                json!({ "public_key": public_key }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            ))
            .detach();
        refund(from, env::attached_deposit().saturating_sub(GIFT_DEPOSIT));
    }

    /// The giver takes the gift back: the key is deleted, the Pusaka unlocked, the deposit returned.
    pub fn cancel_gift(&mut self, token_id: TokenId) {
        self.assert_owner(&token_id);
        let pk: String = raw_get(&token_slot(&token_id)).expect("NotGifted");
        let g: Gift = raw_get(&format!("gk:{pk}")).expect("NotGifted");
        require!(g.active, "the link's key isn't confirmed yet; try again in a moment");
        require!(!g.claiming, "a claim is in flight");
        self.end_gift(&token_id);
        refund(g.from, GIFT_DEPOSIT.saturating_sub(GIFT_ALLOWANCE));
    }

    /// NEP-452: claim the gift into an existing account. Signed with the link's key, as this contract.
    pub fn claim(&mut self, account_id: AccountId) {
        let (pk, g) = self.gift_for_signer();
        let _ = pk;
        self.hand_over(g, account_id);
    }

    /// NEP-452: create `new_account_id` (a top-level name like `ana.testnet`) with `new_public_key` as its full
    /// access key, fund it, and give it the Pusaka. Signed with the link's key, as this contract.
    pub fn create_account_and_claim(&mut self, new_account_id: AccountId, new_public_key: PublicKey) -> Promise {
        let (pk, mut g) = self.gift_for_signer();
        g.claiming = true;
        raw_put(&key_slot(&pk), &g);
        Promise::new(REGISTRAR.parse().unwrap())
            .function_call(
                "create_account",
                json!({ "new_account_id": new_account_id, "new_public_key": new_public_key }).to_string().into_bytes(),
                GIFT_TO_RECIPIENT,
                Gas::from_tgas(30),
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "on_gift_account",
                json!({ "public_key": pk, "account_id": new_account_id }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(30),
            ))
    }

    /// The AddKey's outcome. A key that already existed (AddKey fails) is never ours: the gift is void, nothing
    /// is ever deleted for it, and the giver gets the deposit back.
    #[private]
    pub fn on_gift_key(&mut self, public_key: PublicKey) -> bool {
        let added = env::promise_result_checked(0, 0).is_ok();
        let Some(mut g) = raw_get::<Gift>(&key_slot(&public_key)) else {
            // the gift ended before this callback: a key we just added ourselves must not outlive it
            if added {
                Promise::new(env::current_account_id()).delete_key(public_key).detach();
            }
            return false;
        };
        if added {
            g.active = true;
            raw_put(&key_slot(&public_key), &g);
            return true;
        }
        env::storage_remove(key_slot(&public_key).as_bytes());
        env::storage_remove(token_slot(&g.token_id).as_bytes());
        emit_metadata_update(&g.token_id);
        refund(g.from, GIFT_DEPOSIT);
        false
    }

    /// The registrar's answer: on success the new account gets the Pusaka; otherwise the link stays claimable
    /// (the registrar refunds the deposit) and can be retried with another name.
    #[private]
    pub fn on_gift_account(&mut self, public_key: PublicKey, account_id: AccountId) -> bool {
        let created = env::promise_result_checked(0, 16).is_ok_and(|b| serde_json::from_slice::<bool>(&b).unwrap_or(true));
        let Some(mut g) = raw_get::<Gift>(&key_slot(&public_key)) else { return false };
        if !created {
            g.claiming = false;
            raw_put(&key_slot(&public_key), &g);
            return false;
        }
        let token_id = g.token_id.clone();
        let from = g.from.clone();
        self.end_gift(&token_id);
        self.tokens.internal_transfer(&from, &account_id, &token_id, None, None);
        clear_heir(&token_id);
        crate::v2::clear_pq(&token_id);
        self.log(&token_id, Event::Transfer { from, to: account_id });
        true
    }

    /// The gift a link's public key opens, if any (NEP-452-style key lookup).
    pub fn gift_for_key(&self, public_key: PublicKey) -> Option<Gift> {
        raw_get(&key_slot(&public_key))
    }

    /// The open gift on a token, if any: its key and giver.
    pub fn gift_of(&self, token_id: TokenId) -> Option<Value> {
        let pk: String = raw_get(&token_slot(&token_id))?;
        let g: Gift = raw_get(&format!("gk:{pk}"))?;
        Some(json!({ "public_key": pk, "from": g.from, "claiming": g.claiming }))
    }
}

impl Pusaka {
    /// Only the contract account can call the claim methods, and its only keys are gift keys limited to them.
    fn gift_for_signer(&self) -> (PublicKey, Gift) {
        require!(env::predecessor_account_id() == env::current_account_id(), "sign with the gift link's key");
        let pk = env::signer_account_pk();
        let g: Gift = raw_get(&key_slot(&pk)).unwrap_or_else(|| env::panic_str("NoGift: this key opens no gift"));
        require!(g.active, "the link's key isn't confirmed yet");
        require!(!g.claiming, "a claim is in flight");
        require!(self.owner_of(&g.token_id) == g.from, "the giver no longer holds it");
        (pk, g)
    }

    fn hand_over(&mut self, g: Gift, to: AccountId) {
        require!(to != g.from, "claim it as someone else");
        let token_id = g.token_id.clone();
        self.end_gift(&token_id);
        self.tokens.internal_transfer(&g.from, &to, &token_id, None, None);
        clear_heir(&token_id);
        crate::v2::clear_pq(&token_id);
        self.log(&token_id, Event::Transfer { from: g.from, to: to.clone() });
        refund(to, GIFT_TO_RECIPIENT);
    }

    /// Removes the gift's records and deletes its key from the contract account.
    pub(crate) fn end_gift(&mut self, token_id: &str) {
        let Some(pk) = raw_get::<String>(&token_slot(token_id)) else { return };
        let active = raw_get::<Gift>(&format!("gk:{pk}")).is_some_and(|g| g.active);
        env::storage_remove(token_slot(token_id).as_bytes());
        env::storage_remove(format!("gk:{pk}").as_bytes());
        emit_metadata_update(token_id);
        // only a key this contract added itself (confirmed in on_gift_key) is ever deleted
        if let (true, Ok(key)) = (active, pk.parse::<PublicKey>()) {
            Promise::new(env::current_account_id()).delete_key(key).detach();
        }
    }
}
