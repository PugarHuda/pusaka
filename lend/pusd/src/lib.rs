//! pUSD: a test stablecoin (NEP-141, 6 decimals) for Pusaka lend on testnet. Anyone can mint up to 1,000 at a time
//! (`faucet`); it has no value and exists only so the lending pool can be used without a bridged USDC.
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

const FAUCET_MAX: u128 = 1_000_000_000; // 1,000 pUSD

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pusd {
    token: FungibleToken,
}

#[near]
impl Pusd {
    #[init]
    pub fn new() -> Self {
        Self { token: FungibleToken::new(b"t".to_vec()) }
    }

    /// Mints up to 1,000 pUSD to the caller (registers them if needed; attach 0.00125 NEAR the first time).
    #[payable]
    pub fn faucet(&mut self, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= FAUCET_MAX, "1 to 1,000 pUSD at a time");
        let who = env::predecessor_account_id();
        if !self.token.accounts.contains_key(&who) {
            self.storage_deposit(Some(who.clone()), None);
        }
        self.token.internal_deposit(&who, amount.0);
        near_contract_standards::fungible_token::events::FtMint { owner_id: &who, amount, memo: Some("faucet") }.emit();
    }
}

#[near]
impl FungibleTokenCore for Pusd {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }
    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Pusd {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Pusd {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Pusd {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata { spec: FT_METADATA_SPEC.to_string(), name: "Pusaka test USD (no value)".into(), symbol: "pUSD".into(),
            icon: None, reference: None, reference_hash: None, decimals: 6 }
    }
}
