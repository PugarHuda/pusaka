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
    assert_vault(token_id, owner);
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

#[near(serializers = [borsh])]
struct Rental {
    owner: AccountId,
    user: AccountId,
    expires_ms: u64,
}

fn user_key(token_id: &str) -> String {
    format!("usr:{token_id}")
}

/// The renter of `token_id` right now, if any (granted by the current holder, not expired).
pub fn current_user(token_id: &str, owner: &AccountId) -> Option<AccountId> {
    raw_get::<Rental>(&user_key(token_id)).filter(|r| &r.owner == owner && r.expires_ms > env::block_timestamp_ms()).map(|r| r.user)
}

#[near(serializers = [borsh])]
struct BtcListing {
    seller: AccountId,
    price_sats: u64,
    pay_to: Vec<u8>,
    buyer: Option<AccountId>,
    until_ms: u64,
    nonce: u64,
    bond: u128,
}

fn btc_listing_key(token_id: &str) -> String {
    format!("bl:{token_id}")
}

/// An heir's claim ends a BTC listing, but never while a reserved buyer may already have paid on Bitcoin.
pub fn end_btc_listing_for_heir(token_id: &str) {
    if let Some(l) = raw_get::<BtcListing>(&btc_listing_key(token_id)) {
        require!(!l.holds(env::block_timestamp_ms()), "Reserved: a Bitcoin buyer is paying; claim after the reservation");
        env::storage_remove(btc_listing_key(token_id).as_bytes());
        if l.buyer.is_some() && l.bond > 0 {
            refund(l.seller, NearToken::from_yoctonear(l.bond));
        }
    }
}

pub fn btc_listed(token_id: &str) -> bool {
    env::storage_has_key(btc_listing_key(token_id).as_bytes())
}

pub const BTC_BOND: NearToken = NearToken::from_millinear(100);
/// How long a buyer has to pay on Bitcoin and get it proven (light client lag included).
#[cfg(not(feature = "mainnet"))]
pub const RESERVE_MS: u64 = 6 * 3_600_000;
#[cfg(feature = "mainnet")]
pub const RESERVE_MS: u64 = 24 * 3_600_000;
/// After the time to pay, the time a paid buyer still has to get the payment proven (Bitcoin confirmations and the
/// light client's lag) before anyone else may reserve, the seller may cancel or an heir may claim.
pub const PROOF_GRACE_MS: u64 = RESERVE_MS;

impl BtcListing {
    /// A reservation holds the sale until its time to pay plus the proof grace period.
    fn holds(&self, now_ms: u64) -> bool {
        self.buyer.is_some() && now_ms <= self.until_ms.saturating_add(PROOF_GRACE_MS)
    }
}

fn btc_nonce_key(token_id: &str) -> String {
    format!("bn:{token_id}")
}

/// A Bitcoin payment that bought a Pusaka: never accepted again, whatever the listing or nonce.
fn btc_paid_key(txid: &str) -> String {
    format!("bt:{txid}")
}

/// The OP_RETURN data a BTC purchase must carry: binds the payment to this contract, token, buyer and reservation.
pub fn btc_purchase_memo(token_id: &str, buyer: &AccountId, nonce: u64) -> Vec<u8> {
    env::sha256_array(format!("pusaka-buy:{}:{token_id}:{buyer}:{nonce}", env::current_account_id()).as_bytes())[..20].to_vec()
}

/// P2WPKH, P2WSH, P2TR, P2PKH or P2SH.
fn standard_script(s: &[u8]) -> bool {
    matches!(s, [0x00, 0x14, rest @ ..] if rest.len() == 20)
        || matches!(s, [0x00, 0x20, rest @ ..] if rest.len() == 32)
        || matches!(s, [0x51, 0x20, rest @ ..] if rest.len() == 32)
        || matches!(s, [0x76, 0xa9, 0x14, mid @ .., 0x88, 0xac] if mid.len() == 20)
        || matches!(s, [0xa9, 0x14, mid @ .., 0x87] if mid.len() == 20)
}

/// Every change of owner: the new holder starts without the old holder's PQ key or agent allowance.
pub fn clear_pq(token_id: &str) {
    env::storage_remove(pq_key(token_id).as_bytes());
    env::storage_remove(agent_key(token_id).as_bytes());
    env::storage_remove(user_key(token_id).as_bytes());
    env::storage_remove(vault_key(token_id).as_bytes());
    env::storage_remove(call_key(token_id).as_bytes()); // only an expired or exercised call is left by then
    // not the sign-in record: it expires by itself, so passing the NFT to an alt account can't clear it (V2-10)
}

// ---------- F14: a vault (the delay-and-clawback of a Bitcoin covenant vault, enforced by the contract) ----------

#[near(serializers = [borsh])]
struct Vault {
    owner: AccountId,
    recovery: AccountId,
    delay_ms: u64,
    /// When the last requested unlock opens owner actions; 0 = none requested.
    ready_ms: u64,
}

fn vault_key(token_id: &str) -> String {
    format!("vault:{token_id}")
}

#[cfg(not(feature = "mainnet"))]
pub const VAULT_MIN_DELAY_MS: u64 = 60_000;
#[cfg(feature = "mainnet")]
pub const VAULT_MIN_DELAY_MS: u64 = 3_600_000;
pub const VAULT_MAX_DELAY_MS: u64 = 30 * 86_400_000;
/// Once the delay has passed, owner actions stay open this long.
pub const VAULT_WINDOW_MS: u64 = 10 * 60_000;

/// The current holder's vault delay plus its action window, if they have a vault: an heir's silence must be at least
/// twice that, or a live holder couldn't show up before the heir may claim.
pub fn vault_span(token_id: &str, owner: &AccountId) -> Option<u64> {
    raw_get::<Vault>(&vault_key(token_id)).filter(|v| &v.owner == owner).map(|v| v.delay_ms + VAULT_WINDOW_MS)
}

/// A plain transfer back to the holder who set the vault or the PQ key (a market returning a loan's collateral) keeps
/// them; any other change of owner clears everything as `clear_pq` does.
pub fn clear_pq_unless_back(token_id: &str, to: &AccountId) {
    let vault = raw_get::<Vault>(&vault_key(token_id)).filter(|v| &v.owner == to);
    let pq = raw_get::<PqKey>(&pq_key(token_id)).filter(|k| &k.owner == to);
    clear_pq(token_id);
    if let Some(v) = vault { raw_put(&vault_key(token_id), &v); }
    if let Some(k) = pq { raw_put(&pq_key(token_id), &k); }
}

/// Part of `assert_pq`, so every owner action (transfer, approve, list, withdraw, account calls…) waits for the vault.
fn assert_vault(token_id: &str, owner: &AccountId) {
    if let Some(v) = raw_get::<Vault>(&vault_key(token_id)).filter(|v| &v.owner == owner) {
        let now = env::block_timestamp_ms();
        require!(v.ready_ms != 0 && now >= v.ready_ms && now <= v.ready_ms + VAULT_WINDOW_MS,
            "VaultLocked: request_unlock, wait out the vault's delay, then act within 10 minutes");
    }
}

// ---------- F15: covered call options (Hook-style): the holder sells the right to buy the Pusaka at a strike ----------

#[near(serializers = [borsh])]
struct CoveredCall {
    writer: AccountId,
    strike: u128,
    premium: u128,
    expires_ms: u64,
    holder: Option<AccountId>,
}

fn call_key(token_id: &str) -> String {
    format!("cc:{token_id}")
}

#[cfg(not(feature = "mainnet"))]
pub const CALL_MIN_MS: u64 = 60_000;
#[cfg(feature = "mainnet")]
pub const CALL_MIN_MS: u64 = 3_600_000;
pub const CALL_MAX_MS: u64 = 365 * 86_400_000;

/// A written call holds the Pusaka (no withdraw, sale, loan or transfer) until it expires, is cancelled or exercised.
pub fn call_locks(token_id: &str) -> bool {
    raw_get::<CoveredCall>(&call_key(token_id)).is_some_and(|c| env::block_timestamp_ms() <= c.expires_ms)
}

/// An heir's claim ends an unsold call, but never one a buyer can still exercise.
pub fn end_call_for_heir(token_id: &str) {
    if let Some(c) = raw_get::<CoveredCall>(&call_key(token_id)) {
        require!(c.holder.is_none() || env::block_timestamp_ms() > c.expires_ms, "CallOpen: the call's buyer may still exercise; claim after it expires");
        env::storage_remove(call_key(token_id).as_bytes());
    }
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
pub fn siwe_message(domain: &str, address: &str, token_id: &str, holder: &AccountId, user: Option<&AccountId>, uri: &str,
                    chain_id: u64, nonce: &str, now_ms: u64) -> String {
    require!(!domain.is_empty() && domain.len() <= 100
        && domain.bytes().all(|b| b.is_ascii_alphanumeric() || b"-.:".contains(&b)), "domain: a host name (and port)");
    require!(uri.len() <= 200 && uri.contains("://") && uri.bytes().all(|b| b.is_ascii_graphic()), "uri: an absolute URI");
    require!((8..=64).contains(&nonce.len()) && nonce.bytes().all(|b| b.is_ascii_alphanumeric()), "nonce: 8 to 64 letters or digits");
    require!(chain_id > 0, "chain_id: an EVM chain id");
    let renter = user.map(|u| format!(", used by {u} (rented)")).unwrap_or_default();
    format!("{domain} wants you to sign in with your Ethereum account:\n{address}\n\n\
             Sign in as Pusaka #{token_id} ({}), held by {holder}{renter}.\n\n\
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
        // the holder, or (F11) the renter they named, while the rental lasts
        let holder = self.owner_of(&token_id);
        let caller = env::predecessor_account_id();
        let user = if caller == holder {
            self.assert_owner(&token_id);
            None
        } else {
            require!(current_user(&token_id, &holder).as_ref() == Some(&caller), "NotOwner");
            Some(caller)
        };
        self.assert_free(&token_id); // not while listed, pledged or approved to a market
        let address = self.evm_address(token_id.clone()).unwrap_or_else(|| env::panic_str("NoEvmAddress: call evm_key first"));
        let now = env::block_timestamp_ms();
        let message = siwe_message(&domain, &address, &token_id, &holder, user.as_ref(), &uri, chain_id.0, &nonce, now);
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

    // ---------- F10: prove the NFT's Bitcoin address with a BIP-322 signature ----------

    /// Owner: the NFT's Bitcoin key (NEAR MPC) signs a BIP-322 "simple" proof that it controls the Pusaka's
    /// address, over `message` prefixed by the contract with the token, holder and NEAR block, so a stale proof
    /// says when and for whom it was made. Any BIP-322 verifier checks it (exchange whitelists, reserve audits).
    /// Returns `{address_pkh, message, sighash, pubkey, signature}`; the client builds the witness. Attach 1 yocto.
    #[payable]
    pub fn sign_btc_message(&mut self, token_id: TokenId, message: String) -> Promise {
        near_sdk::assert_one_yocto();
        self.assert_owner(&token_id);
        require!(message.len() <= 512 && !message.contains('\n'), "message: one line, at most 512 bytes");
        let pk = self.btc_keys.get(&token_id).expect("KeyNotReady").clone();
        let pkh = btc::hash160(&pk);
        let full = format!("Pusaka #{token_id} ({}), held by {} at NEAR block {}: {message}",
            env::current_account_id(), env::predecessor_account_id(), env::block_height());
        let sighash = btc::bip322_sighash(&pkh, full.as_bytes());
        log_only(&token_id, &Event::BtcMessageSigned { sighash: hex::encode(sighash) });
        Promise::new(self.mpc.clone())
            .function_call_weight(
                "sign",
                json!({"request": {"path": btc_path(&token_id), "payload_v2": {"Ecdsa": hex::encode(sighash)}, "domain_id": 0}}).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(SIGN_TGAS),
                GasWeight(1),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).with_unused_gas_weight(0)
                .on_btc_message_signed(full, hex::encode(sighash), hex::encode(&pk), hex::encode(pkh)))
    }

    /// Callback of `sign_btc_message`.
    #[private]
    pub fn on_btc_message_signed(&self, message: String, sighash: String, pubkey: String, address_pkh: String) -> Value {
        let signature: Option<Value> = env::promise_result_checked(0, 1024).ok().and_then(|b| serde_json::from_slice(&b).ok());
        json!({ "message": message, "sighash": sighash, "pubkey": pubkey, "address_pkh": address_pkh, "signature": signature })
    }

    // ---------- F11: a renter (ERC-4907 "user") ----------

    /// Owner: lets `user` use this Pusaka until `expires_ms` (sign in as it), without being able to move it or what
    /// it holds. `None` ends it. Cleared when the NFT changes hands. Attach ~0.01 NEAR for storage.
    #[payable]
    pub fn set_user(&mut self, token_id: TokenId, user: Option<AccountId>, expires_ms: U64) {
        self.assert_owner(&token_id);
        let owner = env::predecessor_account_id();
        match user {
            None => {
                env::storage_remove(user_key(&token_id).as_bytes());
            }
            Some(u) => {
                require!(u != owner, "user: someone other than the holder");
                require!(expires_ms.0 > env::block_timestamp_ms(), "expires_ms: in the future");
                if !env::storage_has_key(user_key(&token_id).as_bytes()) {
                    charge_storage(200, 0);
                }
                raw_put(&user_key(&token_id), &Rental { owner, user: u.clone(), expires_ms: expires_ms.0 });
                self.log(&token_id, Event::UserSet { user: u, expires_ms });
            }
        }
    }

    /// The current renter, while the rental lasts and the holder who granted it still holds the NFT.
    pub fn user_of(&self, token_id: TokenId) -> Option<Value> {
        let owner = self.tokens.owner_by_id.get(&token_id)?;
        raw_get::<Rental>(&user_key(&token_id)).filter(|r| r.owner == owner && r.expires_ms > env::block_timestamp_ms())
            .map(|r| json!({ "user": r.user, "expires_ms": U64(r.expires_ms) }))
    }

    // ---------- F12: buy a Pusaka with native Bitcoin, settled by NEAR's Bitcoin light client ----------

    /// Owner: sells the Pusaka for `price_sats` paid on Bitcoin to `pay_to_script` (hex scriptPubKey). Locks it
    /// like a listing. A buyer reserves it on NEAR first, so two buyers can never pay for the same sale.
    #[payable]
    pub fn list_for_btc(&mut self, token_id: TokenId, price_sats: U64, pay_to_script: String) {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        assert_no_live_sign_in(&token_id);
        let script = hex::decode(&pay_to_script).unwrap_or_else(|_| env::panic_str("pay_to_script: hex"));
        require!(standard_script(&script), "pay_to_script: a P2WPKH, P2WSH, P2TR, P2PKH or P2SH output script");
        require!(price_sats.0 >= 1_000, "price_sats: at least 1,000");
        charge_storage(300, 0);
        let seller = env::predecessor_account_id();
        raw_put(&btc_listing_key(&token_id), &BtcListing { seller, price_sats: price_sats.0, pay_to: script, buyer: None, until_ms: 0, nonce: 0, bond: 0 });
        self.bump_epoch(&token_id, 1);
        self.log(&token_id, Event::ListedForBtc { price_sats });
    }

    /// Seller: ends the BTC listing, unless a buyer's reservation is still running.
    pub fn cancel_btc_listing(&mut self, token_id: TokenId) {
        let l: BtcListing = raw_get(&btc_listing_key(&token_id)).unwrap_or_else(|| env::panic_str("NotListed"));
        require!(l.seller == env::predecessor_account_id(), "NotOwner");
        require!(!l.holds(env::block_timestamp_ms()), "Reserved: a buyer is paying; wait for the reservation to run out");
        env::storage_remove(btc_listing_key(&token_id).as_bytes());
        // an expired reservation's bond goes to the seller, for the time the Pusaka was held for nobody
        if l.buyer.is_some() && l.bond > 0 {
            refund(l.seller.clone(), NearToken::from_yoctonear(l.bond));
        }
        self.log(&token_id, Event::BtcListingCancelled);
    }

    /// Buyer: reserves the BTC sale for `RESERVE_MS` with a bond (at least 0.1 NEAR, back on purchase). Returns
    /// the OP_RETURN data (hex) the Bitcoin payment must carry, binding it to this buyer and this reservation.
    #[payable]
    pub fn reserve_btc_purchase(&mut self, token_id: TokenId) -> String {
        let mut l: BtcListing = raw_get(&btc_listing_key(&token_id)).unwrap_or_else(|| env::panic_str("NotListed"));
        let buyer = env::predecessor_account_id();
        require!(buyer != l.seller, "SelfBuy");
        require!(env::attached_deposit() >= BTC_BOND, "attach 0.1 NEAR: a bond, back when you buy");
        let now = env::block_timestamp_ms();
        require!(!l.holds(now), "Reserved: another buyer is paying");
        if l.buyer.is_some() && l.bond > 0 {
            refund(l.seller.clone(), NearToken::from_yoctonear(l.bond));
        }
        // never reused for this token, across listings: an old payment's OP_RETURN can't match a new reservation
        l.nonce = raw_get::<u64>(&btc_nonce_key(&token_id)).unwrap_or(0).max(l.nonce) + 1;
        raw_put(&btc_nonce_key(&token_id), &l.nonce);
        l.buyer = Some(buyer.clone());
        l.until_ms = now + RESERVE_MS;
        l.bond = env::attached_deposit().as_yoctonear();
        let memo = btc_purchase_memo(&token_id, &buyer, l.nonce);
        raw_put(&btc_listing_key(&token_id), &l);
        self.log(&token_id, Event::BtcPurchaseReserved { buyer, until_ms: U64(l.until_ms), op_return: hex::encode(&memo) });
        hex::encode(memo)
    }

    /// The BTC listing: price, where to pay, the reservation and the OP_RETURN it needs.
    pub fn btc_listing_of(&self, token_id: TokenId) -> Option<Value> {
        raw_get::<BtcListing>(&btc_listing_key(&token_id)).map(|l| json!({
            "seller": l.seller, "price_sats": U64(l.price_sats), "pay_to_script": hex::encode(&l.pay_to),
            "buyer": l.buyer.clone(), "reserved_until_ms": U64(l.until_ms), "proof_until_ms": U64(l.until_ms.saturating_add(PROOF_GRACE_MS)),
            "op_return": l.buyer.as_ref().map(|b| hex::encode(btc_purchase_memo(&token_id, b, l.nonce))),
        }))
    }

    /// Anyone: proves the reserved buyer's Bitcoin payment (output `pay_vout` pays the seller at least the price,
    /// output `memo_vout` is the reservation's OP_RETURN) with NEAR's Bitcoin light client; then the NFT goes to
    /// the buyer and the bond back to them.
    #[allow(clippy::too_many_arguments)]
    pub fn prove_btc_purchase(&mut self, token_id: TokenId, tx_hex: String, pay_vout: u32, memo_vout: u32, block_hash: String,
                              tx_index: U64, merkle_proof: Vec<String>, coinbase_txid: String, coinbase_merkle_proof: Vec<String>) -> Promise {
        let l: BtcListing = raw_get(&btc_listing_key(&token_id)).unwrap_or_else(|| env::panic_str("NotListed"));
        let buyer = l.buyer.clone().unwrap_or_else(|| env::panic_str("NotReserved"));
        let tx = hex::decode(&tx_hex).unwrap_or_else(|_| env::panic_str("tx_hex: hex"));
        require!(tx.len() != 64, "64-byte transactions are not accepted");
        let (paid, script) = btc::output(&tx, pay_vout);
        require!(script == l.pay_to && paid >= l.price_sats, "the payment output doesn't pay the seller the price");
        let (_, memo) = btc::output(&tx, memo_vout);
        let want = btc_purchase_memo(&token_id, &buyer, l.nonce);
        require!(memo.len() == 2 + want.len() && memo[0] == 0x6a && memo[1] as usize == want.len() && memo[2..] == want[..],
            "the OP_RETURN isn't this reservation's");
        let txid_internal = btc::sha256d(&tx);
        let args = btc::proof_args_borsh(&txid_internal, &block_hash, tx_index.0, &merkle_proof, &coinbase_txid, &coinbase_merkle_proof, BTC_MIN_CONFIRMATIONS);
        let mut txid = txid_internal;
        txid.reverse();
        require!(!env::storage_has_key(btc_paid_key(&hex::encode(txid)).as_bytes()), "this Bitcoin payment already bought a Pusaka");
        Promise::new(BTC_LIGHT_CLIENT.parse().unwrap())
            .function_call("verify_transaction_inclusion_v2", args, NearToken::from_yoctonear(0), Gas::from_tgas(PROOF_TGAS))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30))
                .on_btc_purchase_proven(token_id, buyer, U64(l.nonce), hex::encode(txid), U64(paid)))
    }

    /// Callback of `prove_btc_purchase`: hands the NFT over if the light client confirmed the payment and the
    /// same reservation still stands.
    #[private]
    pub fn on_btc_purchase_proven(&mut self, token_id: TokenId, buyer: AccountId, nonce: U64, txid: String, sats: U64) -> bool {
        let ok = matches!(env::promise_result_checked(0, 16), Ok(b) if b == b"true");
        let Some(l) = raw_get::<BtcListing>(&btc_listing_key(&token_id)) else { return false };
        if !ok || l.buyer.as_ref() != Some(&buyer) || l.nonce != nonce.0 || env::storage_has_key(btc_paid_key(&txid).as_bytes()) {
            return false;
        }
        // every transfer path refuses while it's listed for Bitcoin (assert_unlocked); checked again here so a gap
        // elsewhere can't make internal_transfer panic halfway: the buyer gets the bond back and the listing stays
        if self.tokens.owner_by_id.get(&token_id).as_ref() != Some(&l.seller) {
            refund(buyer, NearToken::from_yoctonear(l.bond));
            env::log_str(&format!("pusaka #{token_id}: Bitcoin sale not completed: the seller no longer holds it"));
            return false;
        }
        env::storage_remove(btc_listing_key(&token_id).as_bytes());
        raw_put(&btc_paid_key(&txid), &());
        // also covers reservations made before the per-token counter existed (proposal 16)
        raw_put(&btc_nonce_key(&token_id), &raw_get::<u64>(&btc_nonce_key(&token_id)).unwrap_or(0).max(l.nonce));
        self.tokens.internal_transfer(&l.seller, &buyer, &token_id, None, None);
        clear_heir(&token_id);
        clear_pq(&token_id);
        self.log(&token_id, Event::BtcSale { from: l.seller, to: buyer.clone(), sats, txid });
        refund(buyer, NearToken::from_yoctonear(l.bond));
        true
    }

    /// F13: proof of reserves as one composable view: every Pusaka's verified sats (light-client proven, net of
    /// everything signed away) and the total, for other contracts and dashboards.
    pub fn reserves(&self, from_index: Option<U64>, limit: Option<U64>) -> Value {
        let rows: Vec<Value> = self.tokens.owner_by_id.iter().map(|(id, _)| id.clone())
            .skip(from_index.map_or(0, |v| v.0) as usize).take(limit.map_or(100, |v| v.0) as usize)
            .map(|id| json!({ "verified_sats": self.verified_sats(&id), "token_id": id })).collect();
        let total: u64 = rows.iter().map(|r| r["verified_sats"].as_u64().unwrap_or(0)).sum();
        json!({ "light_client": BTC_LIGHT_CLIENT, "tokens": rows, "total_sats": total })
    }

    // ---------- F14: vault ----------

    /// Owner: puts the Pusaka in a vault (or with `recovery` None takes it out). From then on every owner action
    /// needs an unlock requested `delay_ms` earlier (`request_unlock`), and during that delay `recovery` (the holder's
    /// cold account, or a guardian) can claw the Pusaka back. Changing or removing the vault is itself an owner action,
    /// so a stolen key has to wait the delay too. Cleared when the NFT changes hands.
    #[payable]
    pub fn set_vault(&mut self, token_id: TokenId, recovery: Option<AccountId>, delay_ms: U64) {
        self.assert_owner(&token_id);
        let owner = env::predecessor_account_id();
        match recovery {
            None => {
                env::storage_remove(vault_key(&token_id).as_bytes());
                self.log(&token_id, Event::VaultSet { recovery: None, delay_ms: U64(0) });
            }
            Some(r) => {
                require!(r != owner, "recovery: an account other than the holder");
                assert_not_its_own_account(&token_id, &r); // a clawback into it would strand the NFT for good
                if let Some(h) = raw_get::<Heir>(&heir_key(&token_id)).filter(|h| h.owner == owner) {
                    require!(delay_ms.0 + VAULT_WINDOW_MS <= h.after_ms / 2, "delay_ms: too long for your heir's waiting time (at most half of it, less 10 minutes)");
                }
                require!((VAULT_MIN_DELAY_MS..=VAULT_MAX_DELAY_MS).contains(&delay_ms.0), "delay_ms: out of range");
                // a sale, loan, gift or market approval made before the vault would not wait for it
                self.assert_free(&token_id);
                if !env::storage_has_key(vault_key(&token_id).as_bytes()) {
                    charge_storage(250, 0);
                }
                raw_put(&vault_key(&token_id), &Vault { owner, recovery: r.clone(), delay_ms: delay_ms.0, ready_ms: 0 });
                self.log(&token_id, Event::VaultSet { recovery: Some(r), delay_ms });
            }
        }
    }

    /// Holder: asks to open owner actions; they open `delay_ms` from now, for 10 minutes. The recovery account is
    /// notified (NEAR Social) and can claw the Pusaka back before then.
    pub fn request_unlock(&mut self, token_id: TokenId) -> U64 {
        let owner = self.owner_of(&token_id);
        require!(owner == env::predecessor_account_id(), "NotOwner");
        let mut v: Vault = raw_get::<Vault>(&vault_key(&token_id)).filter(|v| v.owner == owner).unwrap_or_else(|| env::panic_str("no vault"));
        v.ready_ms = env::block_timestamp_ms() + v.delay_ms;
        raw_put(&vault_key(&token_id), &v);
        let ready = v.ready_ms;
        self.log(&token_id, Event::VaultUnlockRequested { recovery: v.recovery, ready_ms: U64(ready) });
        U64(ready)
    }

    /// Recovery account: cancels any requested unlock and, if nothing holds the Pusaka (sale, loan, gift, approval),
    /// moves it to itself. Returns whether it moved.
    pub fn vault_clawback(&mut self, token_id: TokenId) -> bool {
        let owner = self.owner_of(&token_id);
        let mut v: Vault = raw_get::<Vault>(&vault_key(&token_id)).filter(|v| v.owner == owner).unwrap_or_else(|| env::panic_str("no vault"));
        require!(env::predecessor_account_id() == v.recovery, "only the vault's recovery account");
        let free = self.lock_reason(&token_id).is_none() && !self.has_approvals(&token_id);
        let to = v.recovery.clone();
        if free {
            self.tokens.internal_transfer(&owner, &to, &token_id, None, None);
            clear_heir(&token_id);
            clear_pq(&token_id);
        } else {
            v.ready_ms = 0;
            raw_put(&vault_key(&token_id), &v);
        }
        self.log(&token_id, Event::VaultClawback { from: owner, to, moved: free });
        free
    }

    /// The current holder's vault: recovery account, delay, and when owner actions open (if an unlock was requested).
    pub fn vault_of(&self, token_id: TokenId) -> Option<Value> {
        let owner = self.tokens.owner_by_id.get(&token_id)?;
        let now = env::block_timestamp_ms();
        raw_get::<Vault>(&vault_key(&token_id)).filter(|v| v.owner == owner).map(|v| json!({
            "recovery": v.recovery, "delay_ms": U64(v.delay_ms), "ready_ms": U64(v.ready_ms),
            "open": v.ready_ms != 0 && now >= v.ready_ms && now <= v.ready_ms + VAULT_WINDOW_MS,
        }))
    }

    // ---------- F15: covered calls ----------

    /// Owner: writes a covered call. Anyone may buy it for `premium` (paid to the holder at once); its buyer may then buy
    /// the Pusaka for `strike` until `expires_ms`. The Pusaka is held meanwhile, so its Bitcoin can't leave first.
    #[payable]
    pub fn write_call(&mut self, token_id: TokenId, strike: U128, premium: U128, expires_ms: U64) {
        self.assert_owner(&token_id);
        self.assert_free(&token_id);
        assert_no_live_sign_in(&token_id);
        let now = env::block_timestamp_ms();
        require!(strike.0 > 0 && premium.0 > 0, "strike and premium: more than 0");
        require!(expires_ms.0 >= now + CALL_MIN_MS && expires_ms.0 <= now + CALL_MAX_MS, "expires_ms: out of range");
        charge_storage(300, 0);
        let writer = env::predecessor_account_id();
        raw_put(&call_key(&token_id), &CoveredCall { writer, strike: strike.0, premium: premium.0, expires_ms: expires_ms.0, holder: None });
        self.bump_epoch(&token_id, 1);
        self.log(&token_id, Event::CallWritten { strike, premium, expires_ms });
    }

    /// Writer: withdraws a call nobody bought (or one that expired).
    pub fn cancel_call(&mut self, token_id: TokenId) {
        let c: CoveredCall = raw_get(&call_key(&token_id)).unwrap_or_else(|| env::panic_str("no call"));
        require!(c.writer == env::predecessor_account_id(), "NotOwner");
        require!(c.holder.is_none() || env::block_timestamp_ms() > c.expires_ms, "Bought: the buyer may exercise until it expires");
        env::storage_remove(call_key(&token_id).as_bytes());
        self.log(&token_id, Event::CallCancelled);
    }

    /// Buys the call: attach the premium. `expected_sign_epoch` binds it to the Bitcoin the buyer saw inside.
    #[payable]
    pub fn buy_call(&mut self, token_id: TokenId, expected_sign_epoch: u32) {
        let mut c: CoveredCall = raw_get(&call_key(&token_id)).unwrap_or_else(|| env::panic_str("no call"));
        let buyer = env::predecessor_account_id();
        let paid = env::attached_deposit().as_yoctonear();
        require!(c.holder.is_none(), "Bought: someone already holds this call");
        require!(env::block_timestamp_ms() < c.expires_ms, "Expired");
        require!(buyer != c.writer, "SelfBuy");
        require!(paid >= c.premium, "attach the premium");
        self.assert_epoch(&token_id, expected_sign_epoch);
        c.holder = Some(buyer.clone());
        raw_put(&call_key(&token_id), &c);
        refund(c.writer.clone(), NearToken::from_yoctonear(c.premium));
        refund(buyer.clone(), NearToken::from_yoctonear(paid - c.premium));
        self.log(&token_id, Event::CallBought { holder: buyer, premium: U128(c.premium) });
    }

    /// The call's buyer: passes it on.
    pub fn transfer_call(&mut self, token_id: TokenId, to: AccountId) {
        let mut c: CoveredCall = raw_get(&call_key(&token_id)).unwrap_or_else(|| env::panic_str("no call"));
        require!(c.holder.as_ref() == Some(&env::predecessor_account_id()), "only the call's holder");
        require!(env::block_timestamp_ms() <= c.expires_ms, "Expired");
        c.holder = Some(to.clone());
        raw_put(&call_key(&token_id), &c);
        self.log(&token_id, Event::CallTransferred { to });
    }

    /// The call's buyer: buys the Pusaka for the strike (attach it) before expiry; the writer is paid like a sale,
    /// creator royalty included.
    #[payable]
    pub fn exercise_call(&mut self, token_id: TokenId) {
        let c: CoveredCall = raw_get(&call_key(&token_id)).unwrap_or_else(|| env::panic_str("no call"));
        let buyer = env::predecessor_account_id();
        let paid = env::attached_deposit().as_yoctonear();
        require!(c.holder.as_ref() == Some(&buyer), "only the call's holder");
        require!(env::block_timestamp_ms() <= c.expires_ms, "Expired");
        require!(paid >= c.strike, "attach the strike");
        require!(self.tokens.owner_by_id.get(&token_id).as_ref() == Some(&c.writer), "the writer no longer holds it");
        env::storage_remove(call_key(&token_id).as_bytes());
        self.tokens.internal_transfer(&c.writer, &buyer, &token_id, None, None);
        clear_heir(&token_id);
        clear_pq(&token_id);
        let price = NearToken::from_yoctonear(c.strike);
        self.log(&token_id, Event::Sale { from: c.writer.clone(), to: buyer.clone(), price });
        for (to, amount) in self.split(&token_id, &c.writer, c.strike) {
            if to != c.writer {
                self.log(&token_id, Event::Royalty { creator: to.clone(), amount: NearToken::from_yoctonear(amount) });
            }
            refund(to, NearToken::from_yoctonear(amount));
        }
        refund(buyer, NearToken::from_yoctonear(paid - c.strike));
    }

    /// The open call on a Pusaka: writer, strike, premium, expiry and its buyer, if any.
    pub fn call_of(&self, token_id: TokenId) -> Option<Value> {
        raw_get::<CoveredCall>(&call_key(&token_id)).filter(|c| env::block_timestamp_ms() <= c.expires_ms).map(|c| json!({
            "writer": c.writer, "strike": U128(c.strike), "premium": U128(c.premium),
            "expires_ms": U64(c.expires_ms), "holder": c.holder,
        }))
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
