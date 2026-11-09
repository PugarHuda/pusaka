//! A token-bound account: obeys only the Pusaka contract that minted its NFT, which forwards
//! calls from the NFT's current holder. It has no access keys, so nobody else can act for it.
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TokenAccount {
    /// The Pusaka contract; its state is written by NEP-616 StateInit (or `new`, for a named alias).
    pub nft: AccountId,
    pub token_id: String,
}

#[near]
impl TokenAccount {
    /// For a named alias (`t<id>.<contract>`): only the Pusaka contract creates it.
    #[init]
    pub fn new(#[serializer(borsh)] nft: AccountId, #[serializer(borsh)] token_id: String) -> Self {
        require!(env::predecessor_account_id() == nft, "only the NFT contract");
        Self { nft, token_id }
    }

    /// Sends NEAR (empty `method_name`) or calls `receiver_id` from this account. Only the NFT contract.
    /// Arguments are borsh (no JSON in this wasm, to keep the global contract small): the Pusaka contract calls it.
    pub fn execute(&mut self, #[serializer(borsh)] receiver_id: AccountId, #[serializer(borsh)] method_name: String, #[serializer(borsh)] args: Vec<u8>, #[serializer(borsh)] deposit: u128, #[serializer(borsh)] gas_tgas: u64) -> Promise {
        require!(env::predecessor_account_id() == self.nft, "only the NFT contract");
        let p = Promise::new(receiver_id);
        if method_name.is_empty() {
            p.transfer(NearToken::from_yoctonear(deposit))
        } else {
            p.function_call(method_name, args, NearToken::from_yoctonear(deposit), Gas::from_tgas(gas_tgas))
        }
    }

    /// Which NFT controls this account.
    #[result_serializer(borsh)]
    pub fn bound_to(&self) -> (AccountId, String) {
        (self.nft.clone(), self.token_id.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(pred: AccountId) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(pred).build());
    }

    #[test]
    fn only_the_nft_contract_acts() {
        ctx(accounts(0));
        let mut a = TokenAccount::new(accounts(0), "7".into());
        assert_eq!(a.bound_to(), (accounts(0), "7".to_string()));
        a.execute(accounts(2), String::new(), vec![], 1, 0);
    }

    #[test]
    #[should_panic(expected = "only the NFT contract")]
    fn a_stranger_cannot_execute() {
        ctx(accounts(0));
        let mut a = TokenAccount::new(accounts(0), "7".into());
        ctx(accounts(1));
        a.execute(accounts(1), String::new(), vec![], 1, 0);
    }

    #[test]
    #[should_panic(expected = "only the NFT contract")]
    fn a_stranger_cannot_create_the_alias() {
        ctx(accounts(1));
        TokenAccount::new(accounts(0), "7".into());
    }
}
