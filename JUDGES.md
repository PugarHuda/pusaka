# Pusaka in five minutes, for judges and screeners

Everything below runs without a wallet and without a key, on a fresh clone. Nothing is signed or sent.

## 1. Check the core claims against the chains (about 2 minutes; it stops itself after 5)

```
npm install
node scripts/verify.mjs
```

Expect `all checks passed`, with these lines (numbers move as the demo is used):

```
✓ deployed code = the README's reproducible build: sha256 …, commit …
✓ NEP-330 build info names the reproducible image: sourcescan/cargo-near:0.21.1-rust-1.96.1
✓ nobody holds a key to the contract account: no key at all (or only open gift-link keys limited to claim)
✓ new code only after a public announcement: upgrades renounced: final
✓ all 21 Pusaka BTC keys are the MPC's derivation for pusaka-btc.testnet: signer v1.signer-prod.testnet
✓ verified_sats = proven deposits never signed away; 9 proven deposits found on Bitcoin, confirmed, paying the right address: …
✓ the app's /api/reserves matches the contract: … sats verified in total
✓ all … NEAR transactions cited in the README are on chain: via FastNear's archival index
```

If a line starts with ⚠, a Bitcoin explorer (mempool.space or Blockstream) didn't answer from your network: those
deposits weren't checked either way. Run it again later; nothing is counted as passed that wasn't checked.

What each line means:
- **Deployed code**: the contract's on-chain code hash equals the sha256 of the wasm CI built in a pinned Docker
  image (`reproducible-wasm` job), and the contract's NEP-330 metadata names that commit.
- **No access key, and the code is final**: nobody, including us, can sign as `pusaka-btc.testnet`, and since 8 Nov
  upgrades are renounced (DAO proposal 7, tx `GdASfxh5…`): `apply_upgrade` refuses everything, so the code judges
  read is the code that runs, for good. Before that, code changed only through a DAO vote plus a 10-minute timelock
  (7 days on mainnet) on announced sha256 bytes (`contract/src/upgrade.rs`).
- **MPC derivation**: for each Pusaka the script asks the MPC signer itself for `derived_public_key(path, predecessor
  = the contract)` and compares it with the key the token's Bitcoin address comes from. Only this contract can ask
  the MPC to sign with it, and the contract only asks for the current NFT owner.
- **Proven deposits**: `verified_sats` is recomputed from the token's proven UTXOs minus the ones it ever signed,
  and each UTXO is looked up on Bitcoin: confirmed, at or below the light client's height, paying this address.

## 2. Run the tests (2 minutes once built; the first build adds ~2)

```
cd contract && cargo test        # 330 passed (incl. fuzz + invariant tests)
```

Tests are named after the attack they stop; the README's [threat model](README.md#why-the-seller-cant-keep-the-bitcoin)
maps each attack to its tests (`t1_…` to `t5_…`, loans `l…`/`o…`, heir `h…`, guardians `gd…`, upgrades `up…`, gift links `g…`).

## 3. Use it (2 minutes)

Open https://pusaka-two.vercel.app, connect any NEAR testnet wallet, and follow the README's
[try it](README.md#try-it-in-two-minutes-testnet-wallet-only) steps: buy a Pusaka (its BTC moves to you), lend against one, or take the
standing loan offer on the home page gas-free. `#/mine` shows what you hold.

## Where the core claims live

| Claim | Code | Tests |
|---|---|---|
| The BTC key belongs to the MPC network, derived per token for this contract | `on_key` in `contract/src/lib.rs` | `key_is_compressed_from_mpc_format`; live: `verify.mjs` asks the MPC itself |
| Only the current owner can get a signature | `assert_owner`, `withdraw` | `t5_*` |
| A sale moves the BTC with the NFT, and the seller can't sign in between | `buy` with `expected_sign_epoch` (`assert_epoch`) | `t1_*`–`t4_*` |
| Deposits count only once NEAR's Bitcoin light client proves them | `prove_deposit` → `on_deposit_proven` | `p*_*` |
| A loan's collateral can't be emptied before or during the loan | `fund_loan`, `accept_loan_offer`, `claim_collateral` | `l*_*`, `o*_*` |
| An heir can claim only after the holder's silence | `claim_inheritance` | `h*_heir*` |
| Guardians can only release to the named heir, only after the silence, and anything the holder signs voids their approvals | `set_guardians`, `approve_release`, `claim_inheritance` | `gd1_*`–`gd10_*` |
| No key on the contract; code changed only after a public, timelocked announcement, and once renounced (done 8 Nov) never again | `contract/src/upgrade.rs` | `up1_*`–`up8_*` |
