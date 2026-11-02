//! Pusaka — NEP-171 NFTs that each control a native Bitcoin address via NEAR Chain Signatures.
//!
//! The BTC key for token `N` is derived by the MPC network from (this contract, "pusaka-N").
//! Only this contract can request signatures for it, and it only does so for the current
//! NFT owner. Owning the NFT therefore *is* owning the BTC.

mod btc;

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};
use std::collections::HashMap;

const MAX_INPUTS: usize = 8;
const KEY_TGAS: u64 = 10;
const SIGN_TGAS: u64 = 15;
const CALLBACK_TGAS: u64 = 20;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Owners,
    TokenMeta,
    Enumeration,
    BtcKeys,
    Listings,
    Pending,
    Signed,
    History,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Utxo {
    /// Explorer-style (big-endian) txid hex.
    pub txid: String,
    pub vout: u32,
    pub value: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub struct OutPointRef {
    pub txid: String,
    pub vout: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Listing {
    pub seller: AccountId,
    pub price: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
#[serde(tag = "kind")]
pub enum Event {
    Mint { owner: AccountId },
    Listed { price: NearToken },
    Unlisted,
    Sale { from: AccountId, to: AccountId, price: NearToken },
    Transfer { from: AccountId, to: AccountId },
    Withdraw { inputs: u32, amount_sat: U64, signed: u32 },
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Entry {
    pub at_ms: U64,
    pub event: Event,
}

/// Everything the UI needs about one token, in one view call.
#[near(serializers = [json])]
pub struct TokenInfo {
    pub token: Token,
    pub btc_path: String,
    /// 33-byte compressed secp256k1 key (hex); `None` until the MPC key callback lands.
    pub btc_pubkey: Option<String>,
    pub listing: Option<Listing>,
    pub pending: bool,
    pub signed_outpoints: Vec<OutPointRef>,
    pub history: Vec<Entry>,
}

/// Returned by `on_signed`: the client attaches witnesses and broadcasts.
#[near(serializers = [json])]
pub struct SignedSpend {
    pub unsigned_tx: String,
    pub btc_pubkey: String,
    /// One per input, raw MPC `SignatureResponse` JSON; `None` if that signature failed.
    pub signatures: Vec<Option<Value>>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pusaka {
    tokens: NonFungibleToken,
    mpc: AccountId,
    next_id: u64,
    btc_keys: LookupMap<TokenId, Vec<u8>>,
    listings: LookupMap<TokenId, Listing>,
    pending: LookupSet<TokenId>,
    signed: LookupMap<TokenId, Vec<OutPointRef>>,
    history: LookupMap<TokenId, Vec<Entry>>,
}

pub fn btc_path(token_id: &str) -> String {
    format!("pusaka-{token_id}")
}

#[near]
impl Pusaka {
    #[init]
    pub fn new(mpc: AccountId) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                Key::Owners,
                env::current_account_id(),
                Some(Key::TokenMeta),
                Some(Key::Enumeration),
                None::<Key>, // no NEP-178 approvals: nobody but the owner can move a Pusaka
            ),
            mpc,
            next_id: 1,
            btc_keys: LookupMap::new(Key::BtcKeys),
            listings: LookupMap::new(Key::Listings),
            pending: LookupSet::new(Key::Pending),
            signed: LookupMap::new(Key::Signed),
            history: LookupMap::new(Key::History),
        }
    }

    // ---------- mint ----------

    /// Mints a Pusaka and asks the MPC contract for its derived BTC key. Attach ~0.02 NEAR for storage.
    #[payable]
    pub fn nft_mint(&mut self, receiver_id: Option<AccountId>) -> Promise {
        let id = self.next_id.to_string();
        self.next_id += 1;
        let owner = receiver_id.unwrap_or_else(env::predecessor_account_id);
        self.tokens.internal_mint(
            id.clone(),
            owner.clone(),
            Some(TokenMetadata {
                title: Some(format!("Pusaka #{id}")),
                description: Some("An NFT that holds native Bitcoin.".into()),
                ..empty_meta()
            }),
        );
        self.log(&id, Event::Mint { owner });

        // The key is fetched on-chain from the MPC contract, so nobody can mint a
        // Pusaka that points at an address they control privately.
        Promise::new(self.mpc.clone())
            .function_call(
                "derived_public_key",
                json!({
                    "path": btc_path(&id),
                    "predecessor": env::current_account_id(),
                    "domain_id": 0
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(KEY_TGAS),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_key(id))
    }

    #[private]
    pub fn on_key(&mut self, token_id: TokenId) {
        let Ok(bytes) = env::promise_result_checked(0, 256) else {
            env::panic_str("MPC key derivation failed; call refresh_key");
        };
        let s: String = serde_json::from_slice(&bytes).expect("key json");
        self.btc_keys.insert(token_id, btc::compress_mpc_key(&s));
    }

    /// Retries key derivation if the mint callback failed.
    pub fn refresh_key(&mut self, token_id: TokenId) -> Promise {
        require!(self.tokens.owner_by_id.contains_key(&token_id), "NoToken");
        require!(!self.btc_keys.contains_key(&token_id), "KeyAlreadySet");
        Promise::new(self.mpc.clone())
            .function_call(
                "derived_public_key",
                json!({"path": btc_path(&token_id), "predecessor": env::current_account_id(), "domain_id": 0})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(KEY_TGAS),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_key(token_id))
    }

    // ---------- withdraw ----------

    /// Owner-only. Builds a BTC tx spending `utxos` of this token's address, sends
    /// `amount_sat` to `to_script_hex` (any scriptPubKey) and change back home, then asks
    /// the MPC network to sign each input. Attach 1 yoctoNEAR per input and 300 TGas.
    #[payable]
    pub fn withdraw(
        &mut self,
        token_id: TokenId,
        utxos: Vec<Utxo>,
        to_script_hex: String,
        amount_sat: U64,
        fee_sat: U64,
    ) -> Promise {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        require!(!utxos.is_empty() && utxos.len() <= MAX_INPUTS, "1..=8 inputs");
        require!(
            env::attached_deposit() >= NearToken::from_yoctonear(utxos.len() as u128),
            "attach 1 yoctoNEAR per input"
        );

        let pk = self.btc_keys.get(&token_id).unwrap().clone();
        let pkh = btc::hash160(&pk);
        let inputs: Vec<_> = utxos.iter().map(|u| (u.txid.clone(), u.vout, u.value.0)).collect();
        let dest = hex::decode(&to_script_hex).expect("bad script hex");
        let spend = btc::build_spend(&pkh, &inputs, dest, amount_sat.0, fee_sat.0);

        let path = btc_path(&token_id);
        let mut signs: Option<Promise> = None;
        for h in &spend.sighashes {
            let p = Promise::new(self.mpc.clone()).function_call_weight(
                "sign",
                json!({"request": {"path": path, "payload_v2": {"Ecdsa": hex::encode(h)}, "domain_id": 0}})
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(SIGN_TGAS),
                GasWeight(1),
            );
            signs = Some(match signs {
                None => p,
                Some(acc) => acc.and(p),
            });
        }

        // Locked until the callback: no transfer/listing while a signature is in flight.
        self.pending.insert(token_id.clone());
        signs.unwrap().then(
            Self::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(CALLBACK_TGAS))
                .with_unused_gas_weight(0)
                .on_signed(token_id, utxos, amount_sat, btc::unsigned_hex(&spend.tx)),
        )
    }

    #[private]
    pub fn on_signed(
        &mut self,
        token_id: TokenId,
        utxos: Vec<Utxo>,
        amount_sat: U64,
        unsigned_tx: String,
    ) -> SignedSpend {
        self.pending.remove(&token_id);
        let signatures: Vec<Option<Value>> = (0..env::promise_results_count())
            .map(|i| match env::promise_result_checked(i, 1024) {
                Ok(b) => serde_json::from_slice(&b).ok(),
                _ => None,
            })
            .collect();

        // Every outpoint that now has a valid signature is recorded forever: a buyer
        // must treat it as spendable by whoever held the token at signing time.
        let signed = self.signed.entry(token_id.clone()).or_default();
        for (u, s) in utxos.iter().zip(&signatures) {
            if s.is_some() {
                signed.push(OutPointRef { txid: u.txid.clone(), vout: u.vout });
            }
        }
        let ok = signatures.iter().filter(|s| s.is_some()).count() as u32;
        self.log(
            &token_id,
            Event::Withdraw { inputs: utxos.len() as u32, amount_sat, signed: ok },
        );
        SignedSpend {
            unsigned_tx,
            btc_pubkey: hex::encode(self.btc_keys.get(&token_id).unwrap()),
            signatures,
        }
    }

    // ---------- market ----------

    pub fn list(&mut self, token_id: TokenId, price: NearToken) {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        self.listings.insert(
            token_id.clone(),
            Listing { seller: env::predecessor_account_id(), price },
        );
        self.log(&token_id, Event::Listed { price });
    }

    pub fn cancel_listing(&mut self, token_id: TokenId) {
        self.assert_owner(&token_id);
        require!(self.listings.remove(&token_id).is_some(), "NotListed");
        self.log(&token_id, Event::Unlisted);
    }

    /// Atomic purchase. `expected_signed_count` is the number of signed outpoints the
    /// buyer saw when checking the token's safe balance; if it changed, the buy fails.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId, expected_signed_count: u32) {
        let listing = self.listings.remove(&token_id).expect("NotListed");
        let buyer = env::predecessor_account_id();
        let paid = env::attached_deposit();
        require!(paid >= listing.price, "InsufficientDeposit");
        require!(buyer != listing.seller, "SelfBuy");
        require!(
            self.signed_count(&token_id) == expected_signed_count,
            "StateChanged: signed outpoints differ from what you checked"
        );

        self.tokens.internal_transfer(&listing.seller, &buyer, &token_id, None, None);
        self.log(
            &token_id,
            Event::Sale { from: listing.seller.clone(), to: buyer.clone(), price: listing.price },
        );
        Promise::new(listing.seller).transfer(listing.price).detach();
        let refund = paid.saturating_sub(listing.price);
        if !refund.is_zero() {
            Promise::new(buyer).transfer(refund).detach();
        }
    }

    // ---------- views ----------

    pub fn token_info(&self, token_id: TokenId) -> Option<TokenInfo> {
        let token = self.tokens.nft_token(token_id.clone())?;
        Some(TokenInfo {
            token,
            btc_path: btc_path(&token_id),
            btc_pubkey: self.btc_keys.get(&token_id).map(hex::encode),
            listing: self.listings.get(&token_id).cloned(),
            pending: self.pending.contains(&token_id),
            signed_outpoints: self.signed.get(&token_id).cloned().unwrap_or_default(),
            history: self.history.get(&token_id).cloned().unwrap_or_default(),
        })
    }

    pub fn mpc_contract(&self) -> AccountId {
        self.mpc.clone()
    }

    // ---------- internals ----------

    fn signed_count(&self, token_id: &TokenId) -> u32 {
        self.signed.get(token_id).map_or(0, |v| v.len() as u32)
    }

    fn assert_owner(&self, token_id: &TokenId) {
        let owner = self.tokens.owner_by_id.get(token_id).expect("NoToken");
        require!(owner == env::predecessor_account_id(), "NotOwner");
    }

    /// A token may move or sign only when nothing else is in flight.
    fn assert_free(&self, token_id: &TokenId) {
        require!(self.btc_keys.contains_key(token_id), "KeyNotReady");
        require!(!self.pending.contains(token_id), "SignPending");
        require!(!self.listings.contains_key(token_id), "Listed");
    }

    fn log(&mut self, token_id: &str, event: Event) {
        self.history
            .entry(token_id.to_string())
            .or_default()
            .push(Entry { at_ms: U64(env::block_timestamp_ms()), event });
    }
}

fn empty_meta() -> TokenMetadata {
    TokenMetadata {
        title: None,
        description: None,
        media: None,
        media_hash: None,
        copies: None,
        issued_at: None,
        expires_at: None,
        starts_at: None,
        updated_at: None,
        extra: None,
        reference: None,
        reference_hash: None,
    }
}

// ---------- NEP-171 with transfer locks ----------

#[near]
impl NonFungibleTokenCore for Pusaka {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.assert_free(&token_id);
        let from = env::predecessor_account_id();
        self.tokens.nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        self.log(&token_id, Event::Transfer { from, to: receiver_id });
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.assert_free(&token_id);
        let from = env::predecessor_account_id();
        self.log(&token_id, Event::Transfer { from, to: receiver_id.clone() });
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Pusaka {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Pusaka {
    fn nft_total_supply(&self) -> near_sdk::json_types::U128 {
        self.tokens.nft_total_supply()
    }
    fn nft_tokens(&self, from_index: Option<near_sdk::json_types::U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> near_sdk::json_types::U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }
    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<near_sdk::json_types::U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Pusaka {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Pusaka".into(),
            symbol: "PUSAKA".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests;
