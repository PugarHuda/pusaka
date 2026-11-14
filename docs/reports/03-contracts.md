# 03 — Smart contracts (Smart Contract Engineer)

Reference: `01-tech-lead.md` (findings B1–B9), `02-strategy.md` (BUILD features: F2 Refused page, F3 TEE framing).
Last round: 9 Nov 2026. The previous round (7 Nov: A1, A2, staking) is in this file's git history.

## Summary
- **The live contract code has not changed, and it does not need to.** None of findings B1–B9 concern the contract,
  and F2/F3 were done in the frontend only. Upgrades were renounced through the DAO on 8 Nov, so the
  `pusaka-btc.testnet` code is final. Any contract fix would have to be a new contract, and that decision is up to the team.
- This round closes the quality gaps recorded in the previous report:
  - fuzz tests and invariant tests (previously "none");
  - coverage (previously "not measured"), now **96.5 % of lines**;
  - documentation for every public function;
  - `deployments/testnet.json`;
  - a gas report from real txs.

## Quality standard → state of the contract
| Required | In Pusaka |
|---|---|
| Tested libraries (the NEAR equivalent of OpenZeppelin) | `near-sdk` 5 and `near-contract-standards` (NEP-171/177/178/181/199/297); BTC/EVM/NEAR transactions are built with `omni-transaction` (Near-One) |
| Custom errors | Panics with fixed codes (`NotOwner`, `Listed`, `SignPending`, `TooEarly`, `CodeMismatch`, `KeyAlreadySet`, `EvmAddressKnown`, …), each tested with `should_panic(expected = …)`. The frontend turns them into sentences (`web/src/errors.js`) |
| Events for every important state change | NEP-297 events (`nft_mint`, `nft_transfer`, `nft_metadata_update`) plus Pusaka's own `Event` enum (30 kinds, including listing, sale, withdraw on every chain, loan, heir, gift, staking, approval). All are recorded in the per-NFT history, and upgrades have an `upgrade_proposed` event |
| NatSpec on every public function | The Rust equivalent is rustdoc `///`. **80/80 `pub fn` functions are now documented**; the 21 that were not yet (mostly `#[private]` callbacks and NEP-178 methods) were added in this round |
| Access control | `assert_owner` and `assert_free` on every asset exit path; `#[private]` callbacks; the upgrade admin was previously a DAO + timelock and is now renounced; the contract account has no access key |
| Pausable / emergency stop | **Deliberately absent.** An admin-owned pause function is the same as a custodian that can freeze people's BTC. The replacement: `unlock_stale` (the owner can release a stuck MPC lock), previously an upgrade timelock so holders had time to exit, now a renounce |
| Checks-effects-interactions, no reentrancy | NEAR is asynchronous. State is recorded **before** the promise: outpoints and the nonce floor are recorded before MPC is asked to sign, and the token is locked as `SignPending`. Callbacks restore the state on failure (`a3_…`, `s3_…`, `x2_…`); `inv1_…` tests this property randomly |
| Gas and storage | Loops are bounded: `MAX_PROVEN` 64 UTXOs, history 32 entries, at most 3 staking pools, change ≥ 1,000 sats. Storage is paid by the caller (`CHANGE_BYTES`, `POOLS_BYTES`) and tested so it cannot be charged to the contract |

## Findings fixed / gaps closed (9 Nov)
| ID | What | File |
|---|---|---|
| R3-1 | Fuzz tests (proptest, 2,000 cases): Dutch auction price (`fz1`, `fz2`), royalty split across the full u128 range (`fz3`), Bitcoin tx parser round-trip (`fz4`) and malicious bytes (`fz5`) | `contract/src/tests.rs` (`mod fuzz`), `Cargo.toml` (dev-dependency `proptest`, not in the wasm) |
| R3-2 | Invariant test over random sequences of deposit proofs, withdrawals, and MPC answers (success/failure). What it guards: `verified_sats` = the sum of proven UTXOs that have never been signed; the signature registry only grows and has no duplicates; no token is left `SignPending`; `sign_epoch` never decreases (`inv1`) | `contract/src/tests.rs` |
| R3-3 | 15 tests for paths left untouched according to the coverage report: `evm_key`/`on_evm_key` (success, different key, MPC failure, twice, no BTC key), `refresh_key`, NEP-181 enumeration views, `nft_revoke` per market, `cancel_upgrade`, `transfer_upgrade_admin`, hash and name validation in migrate (`cv1`–`cv7`) | `contract/src/tests.rs` |
| R3-4 | `///` documentation for 21 public functions | `contract/src/lib.rs`, `contract/src/upgrade.rs` |
| R3-5 | Coverage measured in CI on every push (`cargo llvm-cov`, its summary goes into the run summary) | `.github/workflows/ci.yml` |
| R3-6 | `deployments/testnet.json`: contract, wasm hash, commit, deploy tx, renounce tx, DAO/relayer/TEE accounts, and every sponsor contract used. Read by `shared/btc.mjs`, so the frontend, API, MCP, and scripts use one source | `deployments/testnet.json`, `shared/btc.mjs`, `.vercelignore` |

**Proof that the contract code has not changed:** `git diff 4bf36b2 -- contract/src ':!contract/src/tests.rs'` contains only new `///` lines, without a single line of code. A wasm built from HEAD has a different hash, because rustc stores line numbers for panic messages and the documentation shifts those numbers. The deployed wasm remains the reproducible build of `4bf36b2` (sha256 `ac16e80e…`); `node scripts/verify.mjs` proves this against the chain.

## Contracts and accounts
All of them are in [`deployments/testnet.json`](../../deployments/testnet.json).

| Name | Account | Network | Explorer | Status |
|---|---|---|---|---|
| Pusaka (NEP-171 + BTC/EVM/SOL/NEAR via MPC) | `pusaka-btc.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-btc.testnet) | 0 access keys, upgrades renounced (`GdASfxh5…`), wasm sha256 `ac16e80e…` = reproducible build of commit `4bf36b2`, deploy `67hUwJuA…` |
| Upgrade DAO (formerly admin) | `pusaka-council.sputnikv2.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-council.sputnikv2.testnet) | Sputnik v2. Its role ended with proposal 7 (renounce) |
| Pusaka v2 (+ NEP-616 NFT-owned accounts, aliases, ML-DSA-65 PQ keys) | `pusaka-v2.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-v2.testnet) | Upgrades through the DAO + 10-minute timelock; wasm sha256 `d6c183da…` (proposal 9, `DbaTmJfi…`); no access keys since 13 Nov (`6PrDXyqq…`, see 05 V2-7). Details in [`deployments/testnet-v2.json`](../../deployments/testnet-v2.json) |
| Market (per-sat bids, buy pools, perpetual loans) | `pusaka-market.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-market.testnet) | No upgrade path in the code; no access keys since 13 Nov (`J6McLhmA…`): the code can never change |
| USDC lending pool | `pusaka-lend.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-lend.testnet) | Lends Circle testnet USDC, 2-of-3 reporter price; no access keys since 13 Nov (`HZnY3FJF…`); real liquidation 14 Nov (`BSDwVry5…`) |
| pUSD (the pool's first, faucet stablecoin) | `pusaka-usd.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-usd.testnet) | History only; no access keys since 13 Nov (`JCU9DDo4…`) |
| Token account contract (global, by hash) | `3xLVdgZA…` | NEAR testnet | publish `7nerp9Z3…` | `token-account/`, 43 KB, no key, only obeys `pusaka-v2.testnet` |
| TEE agent (deposit prover) | `pusaka-agent.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-agent.testnet) | Shade Agent contract; Phala TDX attestation checked on-chain |
| Relayer (not a contract) | `pusaka-relayer.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-relayer.testnet) | NEP-611 gas key, only relays safe methods |

**Source verification on the explorer.** NEAR has no Etherscan-style verifier. The equivalents:
1. **NEP-330**: build metadata (Docker image pinned by digest, commit, command) is stored on-chain in `contract_source_metadata`.
2. `cargo near verify` / SourceScan rebuild from GitHub and then compare the hash.
3. `scripts/verify.mjs` runs the same comparison on every CI run.

SourceScan and `cargo near verify` take the source from the GitHub repo, so **this step can only run after the repo is made public**. That is a blocker in the user's hands (see B9).

**Repeatable deploys:** the path goes through CI (`reproducible-wasm`), then `scripts/dao-upgrade.mjs` and `scripts/upgrade.mjs`. This path has been closed permanently by the renounce. For a new contract (for example mainnet), the runbook is in `docs/MAINNET.md`: build `--features mainnet`, deploy, set the DAO admin, then renounce.

## Test and coverage results
| Type | Result |
|---|---|
| Unit + revert paths | **375 passing** (`cargo test`) and **375 passing** (`cargo test --features mainnet`) |
| Fuzz (proptest) | 5 properties: 2,000 cases for pure functions, 256 for those that build a contract per case (can be raised via `PROPTEST_CASES`). A full 2,000-case run for all of them also passes (728 s, 9 Nov) |
| Invariant | `inv1` (random sequences of ≤ 24 operations, 256 sequences per run) |
| Coverage (`cargo llvm-cov`, `tests.rs` excluded) | **Lines 96.48 %, functions 94.38 %, regions 91.47 %** (target ≥ 90 % ✓). Per file: `art` 100 %, `btc` 99.4 %, `gift` 97.7 %, `lib` 95.8 %, `upgrade` 98.6 %, `usdc` 95.4 % (lines) |
| Fork test | NEAR has no Anvil-style fork node. The replacement is stronger: integration is tested directly against sponsor protocols live on testnet (MPC `v1.signer-prod.testnet`, light client `btc-client-v4.testnet`, Mintbase, staking pool factory, Omni nBTC). Their txs are listed in the table below, and `verify.mjs` rechecks them on every CI run. The `near-workspaces` sandbox cannot be used: it does not run on Windows, and MPC and the light client need a node or state that cannot be forked |
| Dependency analysis | `cargo audit` in CI. 1 advisory ignored with a reason: it exists only in the unit-testing VM, not in the wasm |

Not yet covered (the remaining 3.5 % of lines): `migrate()` (a one-time migration from the old layout, already executed on-chain), a few `unwrap_or_else` branches for malformed MPC answers, and two USDC views.

## Gas and proof txs for the main flows (all real successful txs on `pusaka-btc.testnet`)
Computed from **442 txs** indexed on FastNear (`tx.test.fastnear.com`). Gas is the total gas burnt per tx, including all receipts and callbacks; median and maximum per method. Costs use the testnet gas price. The last column is an example median tx.

| Flow | Method | n | Median gas (TGas) | Max | Median cost (NEAR) | Proof tx |
|---|---|---|---|---|---|---|
| Mint (+ BTC key from MPC) | `nft_mint` | 21 | 14.88 | 16.74 | 0.00140 | `G1uHYXWaByoBigcW19Mc3KnFGdbtWGN16q6UX1RdmUcX` |
| Deposit proof (light client) | `prove_deposit` | 15 | 8.56 | 45.88 | 0.00077 | `GfUJuAddBTmnJmCQ54cqKrAyJtGfKNfLiMYEytNWuXW3` |
| Listing | `list` | 41 | 3.01 | 4.50 | 0.00028 | `7MtfmWAiQx4AhymtAnTMQayrABBnEDDpuCH2AyYf9pjg` |
| **Buy (NFT + BTC move)** | `buy` | 18 | 4.91 | 9.73 | 0.00045 | `777q3S4PoiMTZhEEKekpLYGuiv6Tu5knGLuBB3itDDJ6` |
| Withdraw BTC (MPC signature) | `withdraw` | 22 | 15.99 | 16.85 | 0.00149 | `AWvTeeYffCVj5nPryLCrTURCczrXMtG7wULSWz5Zu2pp` |
| Withdraw ETH (EIP-1559) | `withdraw_eth` | 3 | 15.11 | 15.60 | 0.00140 | `EkRK4bbBqH1zLzCdXGCkWFiWikV7oEaEq2AneZvHuL2P` |
| Withdraw SOL | `withdraw_sol` | 3 | 23.24 | 23.29 | 0.00219 | `7aDGADF83uJhvdLsi4zx5X6H1nQPguNxDgZKSJGT5LD1` |
| Withdraw NEAR (implicit account) | `withdraw_near` | 2 | 23.88 | 23.88 | 0.00223 | `8Gd2gbPfiReegf8SFToRqvUVbqhXr91yKtP9tkipJ5BJ` |
| Withdraw nBTC (Omni) | `withdraw_nbtc` | 1 | 24.10 | 24.10 | 0.00225 | `4tBAw8h5kR6pQsRrhQ6c9TSBJ56tWaz2kMMzFZWqYwQK` |
| USDC proof (MPC foreign-tx) | `prove_usdc_deposit` | 1 | 14.49 | 14.49 | 0.00136 | `FkQwHG2ZQ3EN7B1JD8jeVPqwGDHkqhaJ3iD8W4Pqd71m` |
| Request a loan | `request_loan` | 21 | 3.02 | 3.47 | 0.00028 | `AZh9rfFJPisXrkhs7ee9bGpjBFaC7mJHhi6Zx8xEHiga` |
| Fund a loan | `fund_loan` | 8 | 3.44 | 7.24 | 0.00030 | `8XF2KkZnvM9WCDt2QAjKNiwXUmoG7oSPmaSiKt1RAdk` |
| Repay | `repay_loan` | 8 | 3.57 | 6.96 | 0.00031 | `G79qZEbiKazqqzYtyWa2XGPrEW19waaeUbc33Rp9t7hb` |
| Seize collateral (past due) | `claim_collateral` | 5 | 3.99 | 4.66 | 0.00038 | `C7B3BtXcYy6aUT4vYkuNhZuowDY5mCABwWT3nXK7L9oJ` |
| Loan offers | `offer_loan` / `accept_loan_offer` | 21 / 7 | 3.45 / 5.08 | 3.54 / 6.09 | 0.00030 / 0.00044 | `AoqkEoyDYabQb6HT8Z7Zu2SzGC7SoqUoqby1NQYaQDYM` / `8uFttLyy4hMLFxmVkV3rKQCTq1fEFxL8QRBDPGieR6CJ` |
| Heir | `set_heir` / `still_here` / `claim_inheritance` | 18 / 13 / 3 | 3.60 / 3.76 / 5.60 | 7.61 / 3.88 / 5.60 | 0.00032 / 0.00033 / 0.00051 | `EbuPRZhBs5KL4fuUKF6pvDhYwZhprKLKDnXJtHNCTr4N` / `BvrzBTo5Ej9bVaw7MhDi3LWx2WYSXJkD9MLD13gmSxa` / `4JXv66X9jJ735QyVQSywV8JCeRMKUihnnYJyJXvNF6bu` |
| MPC letter (CKD) | `letter_key` / `set_letter` | 6 / 6 | 11.31 / 3.63 | 11.45 / 3.91 | 0.00106 / 0.00032 | `HakDbnyJqEKftxmBoGiyqnrD6YTg7T2Q5LBTdEEwmWQJ` / `AzdwD8kG5a6WKSKv1T8qV4jPdYttj3nbxLPkgvRgS4Wv` |
| Gift link (NEP-452) | `gift` | 3 | 6.84 | 6.98 | 0.00062 | `ECr8JMYHVf58Actw2VjHKNMFzG3ndJeyj3X7UCH2KiuG` |
| Staking the NFT's NEAR | `stake_near` | 3 | 25.48 | 25.49 | 0.00239 | `H9hm7pKcsYBU5kj35DZPYCjsDohdt9U2CNbeQAyWyCxg` |
| External market (NEP-178/199, Mintbase) | `nft_approve` / `nft_transfer_payout` | 3 / 1 | 7.29 / 12.94 | 7.33 / 12.94 | 0.00066 / 0.00118 | `HK7ski1JBYfEKdZoEFkQSHtJuwGts6ZCcUPhwcZ1hMGS` / `CCxgRJ7iwKccnTEwpToZNC9hg3BW17tqqD5oj2X9VXcB` |
| Upgrade through the timelock / renounce | `apply_upgrade` / `renounce_upgrades` | 9 / 1 | 95.99 / 9.24 | 101.28 / 9.24 | 0.00955 / 0.00083 | `HfGrfHNv22hEJABuSFUKZzhfADHMgBQeiDpxbczX3zbi` / `GdASfxh5Xr6UCGeg5LPTXsH3SCn4aWvCLGUqPWNDGa6N` |

Gas notes:
- The most expensive methods call MPC (withdraw on every chain, `stake_near`, `letter_key`). The gas paid for MPC is already included in the numbers above; the MPC deposit (1 yocto) is not gas.
- The `prove_deposit` maximum of 45.88 TGas happened on a Bitcoin tx with many inputs/outputs: its parsing is linear in the tx size and bounded by the gas the caller attaches.
- `apply_upgrade` is expensive (≈ 96 TGas) because it deploys ±628 KB of wasm. It can no longer be called.
- **Transferring BTC ownership through `buy` takes only 4.91 TGas (≈ 0.00045 NEAR), with no Bitcoin fee.** This is the core of the product.

The script that produced this table is in the 9 Nov session run and uses the same logic as `scripts/receipt-monitor.mjs`: the account's tx list from `/v0/account`, receipts from `/v0/transactions`. To check a single hash, open `https://testnet.near.rocks/tx/<hash>`.

## Not done, with reasons
| Item | Reason |
|---|---|
| New functions in the contract | No BUILD feature needs the contract, and the code is final after the renounce. A new contract = a team decision (mainnet F1) |
| Pausable | See the standards table: an admin-owned pause = a custodian |
| SourceScan verification | Needs a public repo (user blocker) |
| Fork test | See the test table: replaced by live tests against the actual sponsor protocols |
