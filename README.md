# Pusaka

**NFTs that hold real Bitcoin. Sell the NFT and the Bitcoin goes with it.**

Each Pusaka is a NEAR NFT (NEP-171) that controls its own native Bitcoin address through
[NEAR Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures). The address's key is held by the
NEAR MPC network and can only be used by the Pusaka contract, and the contract only asks for a signature when the
**current NFT owner** requests one. So transferring the NFT transfers control of the BTC, in one NEAR transaction:
no bridge, no wrapped BTC, no custodian, no private key the seller could keep a copy of.

*Pusaka* is Indonesian for an heirloom: a valued object passed from hand to hand.

Built at NEAR HACKATHON (Nov 2026). Tracks: NFTs That Do Something, Unstoppable DeFi, Open Innovation.

| | |
|---|---|
| Contract | [`pusaka-btc.testnet`](https://testnet.nearblocks.io/address/pusaka-btc.testnet) (NEAR testnet) |
| MPC signer | `v1.signer-prod.testnet` (NEAR Chain Signatures) |
| Bitcoin network | testnet4 ([mempool.space/testnet4](https://mempool.space/testnet4)) |
| Live demo | *(hosted URL added at submission)* · or run locally, below |

## Try it

Requirements: Node 22+, and Rust + `cargo-near` only if you want to rebuild the contract.

### 1. Run the unit tests (offline, ~1 min) — Rust

```sh
cd contract && cargo test
```

See: `17 passed`. They cover every attack in the [threat model](#why-the-seller-cant-keep-the-bitcoin) (tests named `t1_…` to `t5_…`) plus storage and input validation. On Windows, prefix with `AWS_LC_SYS_PREBUILT_NASM=1` if `aws-lc-sys` asks for NASM.

### 2. Run the full flow against the deployed contract (~3 min)

```sh
npm install
npm run demo
```

What happens, step by step (all on NEAR testnet + Bitcoin testnet4, against the deployed contract):

1. Two fresh NEAR accounts are created through the public NEAR testnet faucet. **See:** `created pusaka-s-….testnet`.
2. The seller mints a Pusaka. The contract fetches its Bitcoin key from the MPC contract on-chain. **See:** a `tb1q…` address.
3. **The one manual step:** send testnet4 BTC to that address, e.g. one click at [coinfaucet.eu/en/btc-testnet4](https://coinfaucet.eu/en/btc-testnet4/) (limited to one request per IP per 12 h; any testnet4 faucet works). The script waits until the deposit is in the mempool.
4. The seller lists it for 1 NEAR, then tries to withdraw. **See:** `rejected (Listed)`.
5. The buyer checks the safe balance and buys. **See:** `sold in ~3s — new owner: pusaka-b-…`. Nothing happened on Bitcoin.
6. The old owner tries to withdraw. **See:** `rejected (NotOwner)`.
7. The new owner withdraws 1000 sats. The contract builds the Bitcoin transaction, the MPC network signs it, the script verifies each signature locally and broadcasts. **See:** a `mempool.space/testnet4/tx/…` link that the Bitcoin network accepted.

Already have accounts in `.keys/` and a funded token? `npm run demo -- --token 1 --seller a.testnet --buyer b.testnet` skips steps 1–3.

### 3. Use the web app

```sh
npm install
npm run dev        # http://localhost:5173
```

- **Do:** open the home page. **See:** every Pusaka as a medallion generated from its Bitcoin key, with the BTC it holds read live from Bitcoin testnet4.
- **Do:** open a Pusaka. **See:** its Bitcoin address (links to mempool.space), safe balance, at-risk balance if any, and on-chain history.
- **Do:** connect a NEAR testnet wallet (Meteor, Intear, …) and click *Mint a Pusaka*. Then *List for sale*, *Buy* from a second account, or *Withdraw* to any `tb1…` address.

## How it works

```
 owner ──withdraw(utxos, to, amount)──▶ pusaka-btc.testnet ──sign(path="pusaka-N", sighash)──▶ v1.signer-prod.testnet
                                         │ checks: caller owns NFT N,         (NEAR MPC network,
                                         │ not listed, nothing pending        Chain Signatures)
                                         │ builds the BTC tx + BIP143 sighashes      │
                                         │ records the signed outpoints              │
          signed tx  ◀──on_signed()──────┘◀──────────── signature ───────────────────┘
             │
             └── client attaches witnesses, verifies each signature, broadcasts to Bitcoin testnet4
```

- **Key derivation.** Token `N` uses MPC derivation path `pusaka-N` with the contract as predecessor. At mint, the contract calls `derived_public_key` on the MPC contract itself and stores the result, so nobody can mint a Pusaka that points at an address they control.
- **Addresses** are native SegWit (P2WPKH, `tb1q…`). Sighashes follow BIP143, so input values are signed too.
- **The contract never signs a hash you give it.** It builds the transaction from the UTXOs you name ([`omni-transaction`](https://github.com/near/omni-transaction-rs)) and computes every sighash itself. This is what makes the outpoint registry below trustworthy.
- **Selling** is `list(price)` then `buy(expected_signed_count)`: one NEAR transaction pays the seller and moves the NFT.

## Why the seller can't keep the Bitcoin

Every way we found for a seller to try to keep the BTC after selling, and what stops it:

| # | Attack | Defence | Test |
|---|---|---|---|
| T1 | Withdraw just before the sale | Listing locks withdrawals | `t1_withdraw_while_listed_fails` |
| T2 | Request a signature, then transfer/sell before it arrives | `SignPending` lock blocks transfer, listing and buying until the callback | `t2_transfer_while_pending_fails`, `t2_list_while_pending_fails` |
| T3 | Get a signature, don't broadcast it, sell, broadcast later | Every signed outpoint is recorded on NEAR. Buyers only count UTXOs that were **never** signed ("safe balance"); signed-but-unspent coins show as at risk | `t3_signed_outpoints_are_recorded_and_lock_released` |
| T3b | Hide a signed outpoint from the registry with an upper-case or duplicated txid | Txids canonicalised to 64 lower-case hex, duplicates rejected, before signing | `uppercase_txid_is_recorded_canonically`, `duplicate_outpoints_rejected` |
| T4 | Sign something between the buyer's check and the purchase | `buy` takes `expected_signed_count`; if the registry changed, the purchase fails | `t4_buy_with_stale_count_fails` |
| T5 | Anyone else requests a signature | Owner check; the MPC path can only be used by the contract account | `t5_non_owner_withdraw_fails`, `seller_cannot_withdraw_after_sale` |
| T6 | Mint a token whose "address" is really yours | The key comes from the MPC contract via an on-chain call, not from the caller | `key_is_compressed_from_mpc_format` |

There are no NEP-178 approvals, so no marketplace or third party can move a Pusaka around these locks.

**Limits, stated plainly**

- NEAR contracts can't read Bitcoin. Whether a signed outpoint has been spent is checked by the client against an indexer (mempool.space); anyone can re-check against their own node. A Bitcoin light client on NEAR would make this trustless.
- Security rests on the NEAR MPC network's threshold assumption.
- The testnet contract is deployed with a full-access key we hold. A production deployment must remove it (or use a DAO) so the code can't be swapped.
- Testnet only. No mainnet funds were used.

## Measured on testnet (2 Nov 2026)

| What | Result |
|---|---|
| Ownership transfer of the BTC (`buy`, until the transaction and its refunds are final) | **3.0 s**, one NEAR transaction, 0 Bitcoin fees |
| MPC signature for a 1-input withdrawal (request to signed tx) | 6.8 s – 13.7 s across 5 runs |
| Bitcoin transactions built by the contract and accepted by testnet4 | [bfdcdcf2…](https://mempool.space/testnet4/tx/bfdcdcf22ea5e1816d995dc27166737a11e25d30c7950a881754526d532bb9e7), [1b6a8926…](https://mempool.space/testnet4/tx/1b6a8926a1b46a0f057bbe30c5eaf1de854f749bad098998d741ea1314817349), [79fd2311…](https://mempool.space/testnet4/tx/79fd2311787dddada2079f75721e1648e6c7d8e7bdf1487aa1b75dde45979e77) (Pusaka #1 funding Pusaka #2), [e5272011…](https://mempool.space/testnet4/tx/e527201185af46e04dddb57411a31790ebfaacb42ff06ea273ea04ff112eef90) (demo with fresh accounts), [7232cac5…](https://mempool.space/testnet4/tx/7232cac5c77f2aebd6e07a7f264531550d033a55b80a754d2d2e63face5962ef), [e2553636…](https://mempool.space/testnet4/tx/e2553636a332080c4b0c1d2417971a8ba362c71f41a7b1aecbfeb4ebcb57d5ce) |
| Unit tests | 17 / 17 passing |

## What NEAR makes possible here

- **Chain Signatures**: a smart contract owns a native Bitcoin key. On Ethereum or Solana the same product needs a bridge or a custodian.
- **Cross-contract calls with callbacks**: `derived_public_key` and `sign` are called from the contract; `on_key` and `on_signed` finish the job and release locks.
- **Account model**: the MPC derives keys from *(account, path)*, so the contract account is the only one that can use `pusaka-N`.

## Repository

```
contract/   Rust smart contract (near-sdk 5, NEP-171) + unit tests
  src/lib.rs     NFT, market, withdraw, locks, outpoint registry
  src/btc.rs     P2WPKH scripts, BIP143 sighashes, tx building
  src/tests.rs   threat-model tests
shared/     Bitcoin helpers used by scripts and web: address, safe balance, witness assembly + signature check
scripts/    setup.mjs (deploy), demo.mjs (end-to-end), withdraw.mjs (CLI withdraw)
web/        Vite + React app, NEAR wallet via @hot-labs/near-connect
docs/PRD.md product requirements and design notes
```

Build the contract: `cd contract && cargo near build non-reproducible-wasm --no-abi` → `target/near/pusaka.wasm`.
Deploy your own: put the contract id in `shared/btc.mjs` (`CONTRACT`), then `npm run setup` (creates faucet accounts, deploys, initialises).

## Built with

near-sdk 5 and near-contract-standards, [omni-transaction](https://github.com/near/omni-transaction-rs) (Bitcoin tx building in the contract), near-api-js 7, @hot-labs/near-connect, bitcoinjs-lib 7, @noble/curves, Vite + React, mempool.space API.
All code in this repository was written during the hackathon window (2 Nov 2026 onward), with help from Claude Code (AI pair programmer).

## License

[MIT](LICENSE)
