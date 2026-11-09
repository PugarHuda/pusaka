//! Pusaka v2 additions. Kept in raw storage (string-prefixed keys), so the v1 state layout is unchanged.
//!
//! F5, the NFT owns an account: every token has a NEP-616 deterministic account `0s…`, derived from a
//! global contract (`token-account`, published by hash, so it can't change) plus `{nft, token_id}`. Its
//! address is known before it exists; it has no keys and obeys only this contract, which forwards calls
//! from the current holder while the token is free (not listed, pledged, approved or signing), so a
//! seller can't empty it before a sale settles.
//!
//! F7, a name: the same account as a named alias, `t<id>.<this contract>`. A real top-level name is
//! impossible on NEAR (only `registrar` creates names under 65 characters without a dot).
//!
//! F6, post-quantum: the holder can register an ML-DSA-65 key (NEP-645). While one is registered, every
//! owner action needs a fresh unlock signed with it and verified on-chain by `env::ml_dsa_verify`.
//! It protects NEAR-side authority over the NFT. It does not make the Bitcoin/EVM keys (MPC, secp256k1)
//! or the letter keys (CKD, BLS) post-quantum: neither exists yet.
use crate::*;
use near_sdk::json_types::Base64VecU8;
use near_sdk::state_init::{StateInit, StateInitV1};
use near_sdk::GlobalContractId;

/// `token-account/res/token_account.wasm`, built from `token-account/` in this repo.
pub const TOKEN_ACCOUNT_CODE: &[u8] = include_bytes!("../../token-account/res/token_account.wasm");
/// Publishing a global contract burns 0.0001 NEAR per byte (nearcore `global_contract_storage_amount_per_byte`).
const GLOBAL_BURN_PER_BYTE: u128 = 100_000_000_000_000_000_000;
/// The 0s account starts with this much: the account-creation charge (0.007 NEAR, NEP-642) and change.
pub const OPEN_DEPOSIT: NearToken = NearToken::from_millinear(10);
/// The named alias needs its own storage (no code: it uses the global contract).
pub const ALIAS_DEPOSIT: NearToken = NearToken::from_millinear(20);
const EXECUTE_OVERHEAD_TGAS: u64 = 10;
const MAX_CALL_TGAS: u64 = 200;

pub const PQ_PK_BYTES: usize = 1952;
pub const PQ_SIG_BYTES: usize = 3309;
/// How long a PQ unlock lasts: about 2 minutes of blocks, enough for the wallet's next transaction.
pub const PQ_WINDOW_BLOCKS: u64 = 120;

#[near(serializers = [borsh])]
struct TokenAccountState {
    nft: AccountId,
    token_id: String,
}

#[near(serializers = [borsh])]
struct PqKey {
    owner: AccountId,
    public_key: Vec<u8>,
    /// Last unlock nonce used: each unlock needs a higher one, so a signature can't be replayed.
    nonce: u64,
    until_block: u64,
}

fn pq_key(token_id: &str) -> String {
    format!("pq:{token_id}")
}

pub fn code_hash() -> [u8; 32] {
    env::sha256_array(TOKEN_ACCOUNT_CODE)
}

fn state_init(token_id: &str) -> StateInit {
    let state = TokenAccountState { nft: env::current_account_id(), token_id: token_id.to_string() };
    StateInitV1::code(GlobalContractId::CodeHash(code_hash()))
        .with_data_entry(b"STATE".to_vec(), near_sdk::borsh::to_vec(&state).unwrap())
        .into()
}

/// The message a PQ unlock signs: bound to this contract, token, holder and nonce.
pub fn pq_message(token_id: &str, owner: &AccountId, nonce: u64) -> String {
    format!("pusaka-pq-unlock:{}:{token_id}:{owner}:{nonce}", env::current_account_id())
}

/// Called from `assert_owner` and owner-initiated transfers and approvals.
pub fn assert_pq(token_id: &str, owner: &AccountId) {
    if let Some(k) = raw_get::<PqKey>(&pq_key(token_id)) {
        if &k.owner == owner {
            require!(env::block_height() <= k.until_block, "PqLocked: sign an unlock with your post-quantum key (pq_unlock) first");
        }
    }
}

/// Every change of owner: the new holder starts without the old holder's PQ key.
pub fn clear_pq(token_id: &str) {
    env::storage_remove(pq_key(token_id).as_bytes());
}

#[near]
impl Pusaka {
    // ---------- F5 / F7: the NFT's own account ----------

    /// The token-bound account's global contract: sha256 (its global id) and size.
    pub fn token_account_code(&self) -> Value {
        json!({ "sha256": hex::encode(code_hash()), "bytes": TOKEN_ACCOUNT_CODE.len(),
                "publish_cost_yocto": U128(TOKEN_ACCOUNT_CODE.len() as u128 * GLOBAL_BURN_PER_BYTE) })
    }

    /// Publishes `token-account` as a global contract by hash (immutable). Anyone may call it; the caller
    /// pays the burn (0.0001 NEAR per byte). Needed once, before the first `open_account`.
    #[payable]
    pub fn publish_account_code(&mut self) -> Promise {
        let cost = NearToken::from_yoctonear(TOKEN_ACCOUNT_CODE.len() as u128 * GLOBAL_BURN_PER_BYTE);
        require!(env::attached_deposit() >= cost, format!("attach {cost}: publishing burns 0.0001 NEAR per byte"));
        Promise::new(env::current_account_id()).deploy_global_contract(TOKEN_ACCOUNT_CODE.to_vec())
    }

    /// Token `token_id`'s own account (NEP-616 `0s…`), whether or not it exists yet: fund it any time.
    pub fn account_of(&self, token_id: TokenId) -> AccountId {
        require!(self.tokens.owner_by_id.contains_key(&token_id), "NoToken");
        state_init(&token_id).derive_account_id()
    }

    /// The named alias of the same NFT: `t<id>.<this contract>` (exists after `name_account`).
    pub fn alias_of(&self, token_id: TokenId) -> AccountId {
        require!(self.tokens.owner_by_id.contains_key(&token_id), "NoToken");
        format!("t{token_id}.{}", env::current_account_id()).parse().unwrap()
    }

    /// Creates the `0s…` account on chain. Anyone may (its content is fixed by its address); attach 0.01 NEAR,
    /// which becomes its balance minus the creation charge.
    #[payable]
    pub fn open_account(&mut self, token_id: TokenId) -> Promise {
        require!(env::attached_deposit() >= OPEN_DEPOSIT, "attach 0.01 NEAR");
        let si = state_init(&token_id);
        let id = self.account_of(token_id);
        Promise::new(id).state_init(si, env::attached_deposit())
    }

    /// Owner: creates the named alias `t<id>.<contract>`, running the same global contract, bound to this NFT.
    #[payable]
    pub fn name_account(&mut self, token_id: TokenId) -> Promise {
        self.assert_owner(&token_id);
        require!(env::attached_deposit() >= ALIAS_DEPOSIT, "attach 0.02 NEAR");
        let alias = self.alias_of(token_id.clone());
        let args = near_sdk::borsh::to_vec(&(env::current_account_id(), token_id)).unwrap();
        Promise::new(alias)
            .create_account()
            .transfer(env::attached_deposit())
            .use_global_contract(code_hash())
            .function_call("new".to_string(), args, NearToken::from_yoctonear(0), Gas::from_tgas(EXECUTE_OVERHEAD_TGAS))
    }

    /// Owner, while the token is free: the NFT's account (`alias: false` = the `0s…` account, `true` = the
    /// named alias) sends `deposit` yoctoNEAR (empty `method_name`) or calls `receiver_id`. Bumps `sign_epoch`,
    /// so a buyer or lender who looked before must look again.
    #[payable]
    pub fn account_call(&mut self, token_id: TokenId, alias: bool, receiver_id: AccountId, method_name: String,
                        args: Base64VecU8, deposit: U128, gas_tgas: u64) -> Promise {
        near_sdk::assert_one_yocto();
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        require!(gas_tgas <= MAX_CALL_TGAS, "gas_tgas: at most 200");
        let account = if alias { self.alias_of(token_id.clone()) } else { self.account_of(token_id.clone()) };
        self.bump_epoch(&token_id, 1);
        self.log(&token_id, Event::AccountCall { account: account.clone(), receiver: receiver_id.clone(), method: method_name.clone(), deposit });
        let args = near_sdk::borsh::to_vec(&(receiver_id, method_name, args.0, deposit.0, gas_tgas)).unwrap();
        // Locked until the account has acted, like a signature in flight: no sale, loan or approval can start
        // while the call is still on its way (it would land after the buyer paid).
        self.pending.insert(token_id.clone(), env::block_height());
        Promise::new(account)
            .function_call("execute".to_string(), args, NearToken::from_yoctonear(0), Gas::from_tgas(gas_tgas + EXECUTE_OVERHEAD_TGAS))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_account_call(token_id))
    }

    /// Callback of `account_call`: releases the lock (`unlock_stale` also does, if this ran out of gas).
    #[private]
    pub fn on_account_call(&mut self, token_id: TokenId) -> bool {
        self.pending.remove(&token_id);
        env::promise_result_checked(0, 4096).is_ok()
    }

    // ---------- F6: post-quantum (ML-DSA-65) ----------

    /// Owner: registers (or with `None` removes) an ML-DSA-65 public key (1952 bytes). Replacing or removing
    /// one needs an unlock signed with the current key. Attach ~0.03 NEAR for storage (refunded beyond cost).
    #[payable]
    pub fn set_pq_key(&mut self, token_id: TokenId, public_key: Option<Base64VecU8>) {
        self.assert_owner(&token_id); // with a key registered, this already demands a PQ unlock
        let owner = env::predecessor_account_id();
        match public_key {
            None => {
                clear_pq(&token_id);
                self.log(&token_id, Event::PqKey { set: false });
            }
            Some(pk) => {
                require!(pk.0.len() == PQ_PK_BYTES, "public_key: 1952 bytes (ML-DSA-65)");
                // A market approved before the lock could still transfer without a PQ unlock.
                require!(!self.has_approvals(&token_id), "Approved: call nft_revoke_all first");
                if !env::storage_has_key(pq_key(&token_id).as_bytes()) {
                    charge_storage((PQ_PK_BYTES + 200) as u64, 0);
                }
                // The key is usable at once: registering it was itself an owner action.
                raw_put(&pq_key(&token_id), &PqKey { owner, public_key: pk.0, nonce: 0, until_block: env::block_height() });
                self.log(&token_id, Event::PqKey { set: true });
            }
        }
    }

    /// Owner: opens owner actions for `PQ_WINDOW_BLOCKS` with an ML-DSA-65 signature over
    /// `pq_message(token_id, owner, nonce)`, verified on-chain (`env::ml_dsa_verify`). `nonce` must exceed the last one.
    pub fn pq_unlock(&mut self, token_id: TokenId, nonce: U64, signature: Base64VecU8) -> U64 {
        let owner = self.owner_of(&token_id);
        require!(owner == env::predecessor_account_id(), "NotOwner");
        let mut k: PqKey = raw_get(&pq_key(&token_id)).expect("no post-quantum key for this token");
        require!(k.owner == owner, "the key belongs to an earlier holder");
        require!(nonce.0 > k.nonce, "nonce must be higher than the last unlock");
        let sig: &[u8; PQ_SIG_BYTES] = signature.0.as_slice().try_into().unwrap_or_else(|_| env::panic_str("signature: 3309 bytes (ML-DSA-65)"));
        let pk: &[u8; PQ_PK_BYTES] = k.public_key.as_slice().try_into().unwrap();
        require!(env::ml_dsa_verify(sig, pq_message(&token_id, &owner, nonce.0), pk), "PqBadSignature");
        k.nonce = nonce.0;
        k.until_block = env::block_height() + PQ_WINDOW_BLOCKS;
        let until = k.until_block;
        raw_put(&pq_key(&token_id), &k);
        self.log(&token_id, Event::PqUnlocked { nonce, until_block: U64(until) });
        U64(until)
    }

    /// The registered PQ key (base64) with its last nonce, and whether owner actions are open right now.
    pub fn pq_key_of(&self, token_id: TokenId) -> Option<Value> {
        let owner = self.tokens.owner_by_id.get(&token_id)?;
        raw_get::<PqKey>(&pq_key(&token_id)).filter(|k| k.owner == owner).map(|k| json!({
            "owner": k.owner, "public_key": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &k.public_key),
            "nonce": U64(k.nonce), "unlocked_until_block": U64(k.until_block),
            "open": env::block_height() <= k.until_block,
            "message_for_next_unlock": pq_message(&token_id, &k.owner, k.nonce + 1),
        }))
    }
}
