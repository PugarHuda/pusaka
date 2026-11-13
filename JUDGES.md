# Pusaka in five minutes, for judges and screeners

Everything below runs without a wallet and without a key, on a fresh clone. Nothing is signed or sent.

## 1. Check the core claims against the chains (about 2 minutes; it stops itself after 5)

```
npm install
node scripts/verify.mjs
```

It checks the main contract, `pusaka-v2.testnet`: since 14 Nov it has no key at all (tx `6PrDXyqq…`), and its code
changes only through a DAO vote plus a timelock (the classic contract renounced even that). The frozen classic contract,
which holds most of the Bitcoin, passes everything too:

```
PUSAKA_CONTRACT=pusaka-btc.testnet node scripts/verify.mjs     # 13 Nov: all checks passed
```

Expect `all checks passed`, with these lines (numbers move as the demo is used):

```
✓ deployed code = the recorded build: sha256 …, commit …
✓ NEP-330 build info names the reproducible image: sourcescan/cargo-near:0.21.1-rust-1.96.1
✓ nobody holds a key to the contract account: no key at all (or only open gift-link keys limited to claim)
✓ new code only after a public announcement: upgrades renounced: final
✓ all 27 Pusaka BTC keys are the MPC's derivation for pusaka-btc.testnet: signer v1.signer-prod.testnet
✓ verified_sats = proven deposits never signed away; 13 proven deposits found on Bitcoin, confirmed, paying the right address: …
✓ the app's /api/reserves matches the contract: … sats verified in total
✓ all … NEAR transactions cited in the README and docs/ are on chain: via FastNear's archival index
✓ replayed from genesis: 553 transactions, 26 logged mints and 60 transfers give every owner the contract reports now: …
✓ each of the 13 proven UTXOs the contract counts traces to a proof transaction on chain where the light client answered true: …
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
- **Replayed from genesis**: every `nft_mint` / `nft_transfer` event the contract ever logged (all its transactions,
  from FastNear's archival index) is replayed in chain order; each transfer must start from the owner the log had
  so far, and the result must equal every owner `nft_tokens` reports today. Nothing is taken from our servers.
- **Proof provenance**: every UTXO the contract counts in `verified_sats` must match (token, txid, vout, value) an
  `on_deposit_proven` callback in its history, in a transaction where the Bitcoin light client's
  `verify_transaction_inclusion` returned `true`. The contract can't count Bitcoin nobody proved.

### 1b. The same proof on mainnet, free (30 seconds)

```
node scripts/mainnet-proof.mjs
```

Builds the exact bytes Pusaka's contract sends to NEAR's Bitcoin light client (`proof_args_borsh`, 6 confirmations as
in the `mainnet` build) for a real Bitcoin **mainnet** transaction, and asks the mainnet light client
`btc-client.bridge.near` as a view call: `true`. The same proof with one merkle hash changed: `false`. No wallet,
no NEAR spent. (12 Nov: tx `e1ad57ea…` in block 975,511, 13-step proof, accepted; the forged one refused.)
If the default explorer rate-limits you, `BTC_MAINNET_ESPLORA=https://mempool.space/api` uses another.

## 2. Run the tests (2 minutes once built; the first build adds ~2)

```
cd contract && cargo test        # 375 passed (incl. fuzz + invariant tests)
```

Tests are named after the attack they stop; the README's [threat model](docs/THREAT-MODEL.md)
maps each attack to its tests (`t1_…` to `t5_…`, loans `l…`/`o…`, heir `h…`, guardians `gd…`, upgrades `up…`, gift links `g…`).

## 3. Use it (2 minutes)

Open https://pusaka-two.vercel.app, connect any NEAR testnet wallet, and follow the README's
[try it](README.md#try-it-in-two-minutes-testnet-wallet-only) steps: buy a Pusaka (its BTC moves to you), lend against one, or take the
standing loan offer on the home page gas-free. `#/mine` shows what you hold.
Any token page also offers **Circle testnet USDC from the pool** (`pusaka-lend.testnet`): borrow up to 79.5% of the
proven BTC's value at a 2-of-3 reporter price (tight on testnet so a real price move can trigger a real liquidation;
mainnet 50/80), repay any time, and see **Clean to buy**: whether anything the seller signed could still move what's
inside, on every chain. `cd lend && cargo test` runs its 22 attack tests
(Linux/macOS; on Windows the test dependency aws-lc needs NASM).

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
