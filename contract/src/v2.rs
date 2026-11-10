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

/// A Pusaka held by its own account (or alias) could never move again: only its owner drives that account.
pub fn assert_not_its_own_account(token_id: &str, to: &AccountId) {
    let alias = format!("t{token_id}.{}", env::current_account_id());
    require!(*to != state_init(token_id).derive_account_id() && to.as_str() != alias, "OwnAccount: a Pusaka can't be held by its own account");
}

/// `nft_transfer_call` keeps the PQ key (a returned token must stay locked) but not the agent budget.
pub fn clear_agent(token_id: &str) {
    env::storage_remove(agent_key(token_id).as_bytes());
}

/// Every change of owner: the new holder starts without the old holder's PQ key or agent allowance.
pub fn clear_pq(token_id: &str) {
    env::storage_remove(pq_key(token_id).as_bytes());
    env::storage_remove(agent_key(token_id).as_bytes());
    // not the sign-in record: it expires by itself, so passing the NFT to an alt account can't clear it (V2-10)
}

/// F8, an agent with a budget: the holder lets one account (an AI agent) send NEAR out of the NFT's own
/// account, at most `daily` yoctoNEAR per UTC day and only to `to` (if non-empty). Enforced here, on-chain,
/// not by the agent's own software: a compromised agent can lose at most a day's budget.
#[near(serializers = [borsh])]
struct AgentAllowance {
    owner: AccountId,
    agent: AccountId,
    daily: u128,
    to: Vec<AccountId>,
    day: u64,
    spent: u128,
}

fn agent_key(token_id: &str) -> String {
    format!("agent:{token_id}")
}

const DAY_MS: u64 = 86_400_000;

/// V2-9 / V2-11: anything the NFT's account sets up elsewhere that stays behind (a signing key on the NEAR
/// Intents verifier, an approval, a listing, gift link, loan or heir on an NFT it holds, a switched-off auth)
/// would outlive a sale: the old holder could use it after the buyer paid. So the account only moves assets,
/// at once: NEAR, fungible/multi tokens and NFTs out, NEAR Intents withdrawals, wNEAR, storage, staking.
/// An allowlist, not a denylist, so no method name can slip through.
pub const ACCOUNT_METHODS: [&str; 15] = ["", "ft_transfer", "ft_transfer_call", "nft_transfer", "mt_transfer",
    "mt_batch_transfer", "ft_withdraw", "nft_withdraw", "mt_withdraw", "storage_deposit", "near_deposit",
    "near_withdraw", "deposit_and_stake", "unstake", "withdraw_all"];
fn assert_no_grant(method_name: &str) {
    require!(ACCOUNT_METHODS.contains(&method_name),
        "AccountGrant: the NFT's account only moves assets (transfers, Intents withdrawals, staking), nothing that would outlive a sale");
}

/// V2-10 with nesting: a Pusaka moved into another Pusaka's account (`0s…` or `t<id>.<contract>`) is sold with
/// that one, so it mustn't carry a live sign-in there either.
pub fn assert_no_sign_in_into_a_token_account(token_id: &str, to: &AccountId) {
    let to = to.as_str();
    if to.starts_with("0s") || to.ends_with(&format!(".{}", env::current_account_id())) {
        assert_no_live_sign_in(token_id);
    }
}

// ---------- F9: sign in as the NFT (EIP-4361) ----------

/// How long a sign-in message stays valid.
pub const SIGN_IN_TTL_MS: u64 = 3_600_000;

fn sign_in_key(token_id: &str) -> String {
    format!("si:{token_id}")
}

/// V2-10: a sign-in mustn't outlive a sale, so while one is valid (whoever holds the NFT now) nothing a counterparty
/// pays for can start: no listing, market approval, `nft_transfer_call` (markets, NEAR Intents) or loan.
pub fn assert_no_live_sign_in(token_id: &str) {
    if let Some(until) = raw_get::<u64>(&sign_in_key(token_id)) {
        require!(env::block_timestamp_ms() >= until, format!("SignedIn: a sign-in as this Pusaka is valid until {until} ms; list it after that"));
    }
}

/// UTC, RFC 3339 with milliseconds (days-to-civil, H. Hinnant).
pub fn iso8601(ms: u64) -> String {
    let (secs, milli) = (ms / 1000, ms % 1000);
    let (days, sod) = ((secs / 86_400) as i64, secs % 86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{milli:03}Z", sod / 3600, sod / 60 % 60, sod % 60)
}

/// The EIP-4361 message the NFT signs. Every field is checked, so the text can only ever be a sign-in: it
/// can't be read as a transaction or as a NEAR Intents payload (those are JSON).
#[allow(clippy::too_many_arguments)]
pub fn siwe_message(domain: &str, address: &str, token_id: &str, holder: &AccountId, uri: &str, chain_id: u64,
                    nonce: &str, now_ms: u64) -> String {
    require!(!domain.is_empty() && domain.len() <= 100
        && domain.bytes().all(|b| b.is_ascii_alphanumeric() || b"-.:".contains(&b)), "domain: a host name (and port)");
    require!(uri.len() <= 200 && uri.contains("://") && uri.bytes().all(|b| b.is_ascii_graphic()), "uri: an absolute URI");
    require!((8..=64).contains(&nonce.len()) && nonce.bytes().all(|b| b.is_ascii_alphanumeric()), "nonce: 8 to 64 letters or digits");
    require!(chain_id > 0, "chain_id: an EVM chain id");
    format!("{domain} wants you to sign in with your Ethereum account:\n{address}\n\n\
             Sign in as Pusaka #{token_id} ({}), held by {holder}.\n\n\
             URI: {uri}\nVersion: 1\nChain ID: {chain_id}\nNonce: {nonce}\nIssued At: {}\nExpiration Time: {}",
        env::current_account_id(), iso8601(now_ms), iso8601(now_ms + SIGN_IN_TTL_MS))
}

pub const MAX_AGENT_RECEIVERS: usize = 5;

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
        assert_no_grant(&method_name);
        // V2-11: on this contract the account can only hand a Pusaka it holds out (ft_* don't exist here)
        require!(receiver_id != env::current_account_id() || method_name == "nft_transfer",
            "AccountGrant: the NFT's account can only nft_transfer a Pusaka it holds");
        let account = if alias { self.alias_of(token_id.clone()) } else { self.account_of(token_id.clone()) };
        self.log(&token_id, Event::AccountCall { account: account.clone(), receiver: receiver_id.clone(), method: method_name.clone(), deposit });
        self.forward(token_id, account, receiver_id, method_name, args.0, deposit.0, gas_tgas)
    }

    fn forward(&mut self, token_id: TokenId, account: AccountId, receiver_id: AccountId, method_name: String,
               args: Vec<u8>, deposit: u128, gas_tgas: u64) -> Promise {
        self.bump_epoch(&token_id, 1);
        let args = near_sdk::borsh::to_vec(&(receiver_id, method_name, args, deposit, gas_tgas)).unwrap();
        // Locked until the account has acted, like a signature in flight: no sale, loan or approval can start
        // while the call is still on its way (it would land after the buyer paid).
        let since = env::block_height();
        self.pending.insert(token_id.clone(), since);
        Promise::new(account)
            .function_call("execute".to_string(), args, NearToken::from_yoctonear(0), Gas::from_tgas(gas_tgas + EXECUTE_OVERHEAD_TGAS))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_account_call(token_id, since))
    }

    /// Callback of `account_call`: releases the lock (`unlock_stale` also does, if this ran out of gas).
    #[private]
    pub fn on_account_call(&mut self, token_id: TokenId, since: u64) -> bool {
        // only its own lock: after `unlock_stale` a newer withdrawal or call may hold this slot
        if self.pending.get(&token_id) == Some(&since) { self.pending.remove(&token_id); }
        env::promise_result_checked(0, 4096).is_ok()
    }

    // ---------- F8: an agent with an on-chain budget ----------

    /// Owner: lets `agent` send NEAR from the NFT's `0s…` account, at most `daily` yoctoNEAR per UTC day,
    /// only to `to` (empty = anyone; at most 5). `daily: None` revokes. Cleared when the NFT changes hands.
    /// Attach ~0.01 NEAR for storage (refunded beyond cost).
    #[payable]
    pub fn set_agent(&mut self, token_id: TokenId, agent: AccountId, daily: Option<U128>, to: Vec<AccountId>) {
        self.assert_owner(&token_id);
        let owner = env::predecessor_account_id();
        let daily = daily.map_or(0, |d| d.0); // 0 = revoked; the record stays so today's spending is kept
        require!(daily > 0 || to.is_empty(), "to: empty when revoking");
        require!(to.len() <= MAX_AGENT_RECEIVERS, "to: at most 5 accounts");
        require!(agent != owner, "agent: not the holder (the holder uses account_call)");
        let prev: Option<AgentAllowance> = raw_get::<AgentAllowance>(&agent_key(&token_id)).filter(|p| p.owner == owner);
        if prev.is_none() {
            charge_storage(400, 0);
        }
        // Revoking and re-granting (to any agent) can't reset today's budget.
        let (day, spent) = prev.map(|p| (p.day, p.spent)).unwrap_or((0, 0));
        raw_put(&agent_key(&token_id), &AgentAllowance { owner, agent: agent.clone(), daily, to: to.clone(), day, spent });
        self.log(&token_id, Event::AgentSet { agent, daily: U128(daily), to });
    }

    /// The agent: sends `amount` yoctoNEAR from the NFT's `0s…` account to `receiver_id`, within today's
    /// budget, while the token is free (no sale, loan, approval or call in flight). Bumps `sign_epoch`.
    pub fn agent_send(&mut self, token_id: TokenId, receiver_id: AccountId, amount: U128) -> Promise {
        let owner = self.owner_of(&token_id);
        let mut a: AgentAllowance = raw_get(&agent_key(&token_id)).unwrap_or_else(|| env::panic_str("NoAgent"));
        require!(a.owner == owner && a.daily > 0, "NoAgent");
        require!(a.agent == env::predecessor_account_id(), "NotAgent");
        require!(!in_transfer_call(&token_id), "TransferCallPending");
        self.assert_free(&token_id);
        require!(amount.0 > 0, "amount: more than 0");
        require!(a.to.is_empty() || a.to.contains(&receiver_id), "AgentReceiver: not on the holder's list");
        let today = env::block_timestamp_ms() / DAY_MS;
        if a.day != today {
            a.day = today;
            a.spent = 0;
        }
        let spent = a.spent.saturating_add(amount.0);
        require!(spent <= a.daily, format!("AgentBudget: {} yoctoNEAR left today", a.daily.saturating_sub(a.spent)));
        a.spent = spent;
        raw_put(&agent_key(&token_id), &a);
        let account = self.account_of(token_id.clone());
        self.log(&token_id, Event::AgentSend { agent: a.agent, receiver: receiver_id.clone(), amount, spent_today: U128(spent) });
        self.forward(token_id, account, receiver_id, String::new(), vec![], amount.0, 5)
    }

    /// The agent allowance of the current holder, with what is left today.
    pub fn agent_of(&self, token_id: TokenId) -> Option<Value> {
        let owner = self.tokens.owner_by_id.get(&token_id)?;
        raw_get::<AgentAllowance>(&agent_key(&token_id)).filter(|a| a.owner == owner && a.daily > 0).map(|a| {
            let spent = if a.day == env::block_timestamp_ms() / DAY_MS { a.spent } else { 0 };
            json!({ "agent": a.agent, "daily": U128(a.daily), "to": a.to, "spent_today": U128(spent), "left_today": U128(a.daily.saturating_sub(spent)) })
        })
    }

    // ---------- F9: sign in as the NFT ----------

    /// Owner: the NFT's own EVM key (NEAR MPC, the key that holds its BTC) signs an EIP-4361 "Sign-In with
    /// Ethereum" message for `domain`, naming the current holder and expiring in an hour. Any SIWE site sees
    /// the NFT's address as the user, so whatever that address holds or is allowed in to goes with the NFT.
    /// Returns `{message, address, signature}` (the MPC's secp256k1 signature of the EIP-191 hash). Attach 1 yocto.
    #[payable]
    pub fn sign_in(&mut self, token_id: TokenId, domain: String, uri: String, chain_id: U64, nonce: String) -> Promise {
        near_sdk::assert_one_yocto();
        self.assert_owner(&token_id);
        self.assert_free(&token_id); // not while listed, pledged or approved to a market
        let address = self.evm_address(token_id.clone()).unwrap_or_else(|| env::panic_str("NoEvmAddress: call evm_key first"));
        let now = env::block_timestamp_ms();
        let message = siwe_message(&domain, &address, &token_id, &env::predecessor_account_id(), &uri, chain_id.0, &nonce, now);
        let hash = env::keccak256_array(format!("\x19Ethereum Signed Message:\n{}{message}", message.len()).as_bytes());
        raw_put(&sign_in_key(&token_id), &(now + SIGN_IN_TTL_MS));
        log_only(&token_id, &Event::SignIn { domain, expires_ms: U64(now + SIGN_IN_TTL_MS) });
        Promise::new(self.mpc.clone())
            .function_call_weight(
                "sign",
                json!({"request": {"path": btc_path(&token_id), "payload_v2": {"Ecdsa": hex::encode(hash)}, "domain_id": 0}}).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(SIGN_TGAS),
                GasWeight(1),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).with_unused_gas_weight(0).on_sign_in(message, address))
    }

    /// Until when (ms) a sign-in as this Pusaka is valid, if one is; it can't be listed or approved before then.
    pub fn signed_in_until(&self, token_id: TokenId) -> Option<U64> {
        raw_get::<u64>(&sign_in_key(&token_id)).filter(|u| *u > env::block_timestamp_ms()).map(U64)
    }

    /// Callback of `sign_in`.
    #[private]
    pub fn on_sign_in(&self, message: String, address: String) -> Value {
        let signature: Option<Value> = env::promise_result_checked(0, 1024).ok().and_then(|b| serde_json::from_slice(&b).ok());
        json!({ "message": message, "address": address, "signature": signature })
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
                env::storage_remove(pq_key(&token_id).as_bytes());
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
