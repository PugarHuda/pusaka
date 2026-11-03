# Pusaka

[![CI](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml/badge.svg)](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml)

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
| Bitcoin network | testnet3 ([mempool.space/testnet](https://mempool.space/testnet)), the network NEAR's Bitcoin light client tracks |
| Bitcoin light client | [`btc-client-v4.testnet`](https://testnet.nearblocks.io/address/btc-client-v4.testnet) (Near-One / Omni Bridge), verifies every deposit on-chain |
| Live demo | **https://pusaka-two.vercel.app** (or run locally, below) |

## Try it in two minutes (testnet wallet only)

1. Open **https://pusaka-two.vercel.app**, click *Connect NEAR wallet* and pick Meteor (testnet; new accounts get faucet NEAR).
2. **Buy:** Pusaka #4 is for sale at 0.5 NEAR with 10,000 sats verified on NEAR. Click *Buy*. **See:** "You own Pusaka #4", and you can now *Withdraw* its BTC to any `tb1…` address.
3. **Lend:** Pusaka #1 asks to borrow 0.5 NEAR, repaying 0.55 within 3 days, backed by 164,446 verified sats (loan-to-value ~1.5%). Click *Lend*. **See:** the loan funded, the Pusaka locked as collateral, and *Take the Pusaka* once it's overdue.
4. **No wallet at all?** Any Pusaka with a confirmed, unproven deposit proves itself when you open it; the relayer pays.

## Try it

Requirements: Node 22+, and Rust + `cargo-near` only if you want to rebuild the contract.

### 1. Run the unit tests (offline, ~1 min) — Rust

```sh
cd contract && cargo test
```

See: `61 passed`. They cover every attack in the [threat model](#why-the-seller-cant-keep-the-bitcoin) (tests named `t1_…` to `t5_…`) plus storage and input validation.

### 2. Run the full flow against the deployed contract (~3 min)

```sh
npm install
npm run demo
```

What happens, step by step (all on NEAR testnet + Bitcoin testnet3, against the deployed contract):

1. Two fresh NEAR accounts are created through the public NEAR testnet faucet. **See:** `created pusaka-s-….testnet`.
2. The seller mints a Pusaka. The contract fetches its Bitcoin key from the MPC contract on-chain. **See:** a `tb1q…` address.
3. **The one manual step:** send testnet3 BTC to that address, e.g. one click at [coinfaucet.eu/en/btc-testnet](https://coinfaucet.eu/en/btc-testnet/) (one request per IP per 12 h; any testnet3 faucet works). The script waits for **1 Bitcoin confirmation**, then calls `prove_deposit`: the contract parses the transaction, checks it pays this Pusaka, and the on-chain light client verifies the merkle proof. **See:** `proven by btc-client-v4.testnet: true` and `verified on NEAR: … sats`.
4. The seller lists it for 1 NEAR, then tries to withdraw. **See:** `rejected (Listed)`.
5. The buyer checks the safe balance and buys. **See:** `sold in ~3s — new owner: pusaka-b-…`. Nothing happened on Bitcoin.
6. The old owner tries to withdraw. **See:** `rejected (NotOwner)`.
7. The new owner withdraws 1000 sats. The contract builds the Bitcoin transaction, the MPC network signs it, the script verifies each signature locally and broadcasts. **See:** a `mempool.space/testnet/tx/…` link that the Bitcoin network accepted.

Already have accounts in `.keys/` and a funded token? `npm run demo -- --token 1 --seller a.testnet --buyer b.testnet` skips steps 1–3.

### 2b. End-to-end checks against the live app (~20 s)

```sh
npm run e2e -w web          # Playwright, against https://pusaka-two.vercel.app
```

See: `7 passed` (home, detail, not-found recovery, phone layout, no-wallet actions, relayer input checks, on-chain NFT image).

### 3. Use the web app

```sh
npm install
npm run dev        # http://localhost:5173
```

- **Do:** open the home page. **See:** every Pusaka as a medallion generated from its Bitcoin key, with the BTC **verified on NEAR** by the light client, plus anything still waiting to be proven.
- **Do:** open a Pusaka whose deposit is confirmed but not proven and click *Prove deposit* (any connected account can). **See:** the verified amount go up after the light client accepts the proof.
- **Do:** open a Pusaka. **See:** its Bitcoin address (links to mempool.space), safe balance, at-risk balance if any, and on-chain history.
- **Do:** connect a NEAR testnet wallet (tested with Meteor Wallet) and click *Mint a Pusaka*. Then *List for sale*, *Buy* from a second account, or *Withdraw* to any `tb1…` address.

## Borrow against your Bitcoin, sell by auction

- **Loans:** the owner posts `request_loan(principal, repay, duration)`. A lender funds it with `fund_loan` and the NEAR goes straight to the borrower. While the loan is open the Pusaka can't be withdrawn from, sold or moved (`Collateralised`). The borrower repays with `repay_loan`; if they don't by the due date, the lender calls `claim_collateral` and receives the NFT, and with it the native BTC. No bridge, no oracle, no liquidation bot.
- **Ether too:** the MPC key behind `pusaka-N` also controls one address on every EVM chain. `withdraw_eth` builds an EIP-1559 transaction in the contract (Sepolia in the demo) and gets it signed the same way, so a Pusaka can hold BTC and ETH and both change hands with the NFT.
- **Dutch auctions:** `list(price, floor, duration_ms)` lowers the price linearly to `floor`; `buy` pays the current price and refunds the rest.

## How it works

```
 owner ──withdraw(utxos, to, amount)──▶ pusaka-btc.testnet ──sign(path="pusaka-N", sighash)──▶ v1.signer-prod.testnet
                                         │ checks: caller owns NFT N,         (NEAR MPC network,
                                         │ not listed, nothing pending        Chain Signatures)
                                         │ builds the BTC tx + BIP143 sighashes      │
                                         │ records the signed outpoints              │
          signed tx  ◀──on_signed()──────┘◀──────────── signature ───────────────────┘
             │
             └── client attaches witnesses, verifies each signature, broadcasts to Bitcoin testnet3
```

- **Key derivation.** Token `N` uses MPC derivation path `pusaka-N` with the contract as predecessor. At mint, the contract calls `derived_public_key` on the MPC contract itself and stores the result, so nobody can mint a Pusaka that points at an address they control.
- **Addresses** are native SegWit (P2WPKH, `tb1q…`). Sighashes follow BIP143, so input values are signed too.
- **The contract never signs a hash you give it.** It builds the transaction from the UTXOs you name ([`omni-transaction`](https://github.com/near/omni-transaction-rs)) and computes every sighash itself. This is what makes the outpoint registry below trustworthy.
- **Selling** is `list(price)` then `buy(expected_sign_epoch)`: one NEAR transaction pays the seller and moves the NFT. The sign epoch counts every signature ever requested for the token (BTC inputs and EVM transactions).

## Trustless balance: NEAR's Bitcoin light client

Anyone can call `prove_deposit(token_id, tx_hex, vout, block_hash, tx_index, merkle_proof, coinbase_txid, coinbase_merkle_proof)`:

1. The contract hashes `tx_hex` (non-witness serialization) to get the txid, parses output `vout` and requires it to pay this Pusaka's P2WPKH address.
2. It calls `verify_transaction_inclusion_v2` on Near-One's light client with the merkle proofs (borsh, internal byte order) and the required confirmations.
3. On `true`, the deposit is recorded. `verified_sats` = proven deposits never signed for.

The web app shows this verified amount first, offers *Prove deposit* for confirmed deposits that aren't proven yet, and the medallion's ring fills with verified BTC only.

## The NFT itself is alive

- **On-chain dynamic image.** `nft_token(s)` returns `media` as an SVG drawn by the contract (`contract/src/art.rs`) from the token's Bitcoin key: the brass ring fills with BTC *verified by the light client*, and a red seal appears while it's listed, collateral, or signing. Any NEAR wallet shows the current state, no server involved.
- **Live description:** "Holds 0.00174946 BTC verified on NEAR by the Bitcoin light client."
- **NEP-297 events:** mints emit `nft_mint` (the standard helper we first used didn't, so indexers missed the collection; `emit_mint_events` re-emitted for older tokens). Transfers, sales and loan defaults emit `nft_transfer`. (NearBlocks' testnet indexer has not processed new blocks since 27 Sep 2026, so the collection doesn't show there yet; the events are on-chain and covered by `n1_mint_emits_nep297_event`.)

## For AI agents: Pusaka over MCP

`mcp/server.mjs` is a Model Context Protocol server, so an agent (Claude, any MCP host) can do due diligence and trade on the live contract:

```json
{ "mcpServers": { "pusaka": { "command": "node", "args": ["<repo>/mcp/server.mjs"],
  "env": { "PUSAKA_ACCOUNT_ID": "agent.testnet", "PUSAKA_PRIVATE_KEY": "ed25519:…", "PUSAKA_MAX_SPEND_NEAR": "5" } } } }
```

Tools: `pusaka_overview`, `pusaka_inspect` (verified BTC, USD value, ETH safe/at-risk, listing premium, loan LTV/APR, sign epoch), `pusaka_buy`, `pusaka_fund_loan`, `pusaka_repay_loan`, `pusaka_claim_collateral`, `pusaka_list`, `pusaka_cancel_listing`, `pusaka_request_loan`, `pusaka_prove_deposits`, `pusaka_withdraw_btc`, `pusaka_mint`.
Guard rails the agent can't talk its way around: a per-session NEAR spend cap, `max_price_near` on buys, `max_ltv` on loans (it refuses collateral with no verified BTC), and the same sign-epoch / loan-terms binding as the web app.
**Remote, no install:** point any MCP client at `https://pusaka-two.vercel.app/api/mcp` (Streamable HTTP) for the read-only tools (`pusaka_overview`, `pusaka_inspect`); check it with `node mcp/remote-smoke.mjs`. Trading tools stay local so the agent's key never leaves its machine.
**Try:** `npm run smoke -w mcp` (read tools and guards) and `node mcp/trade.mjs <seller> <buyer> <id> <price>`. On testnet one agent listed Pusaka #1 for 0.3 NEAR and another bought it under a 0.35 NEAR cap.

## Gas-free actions: NEP-366 relayer

`api/relay.mjs` (Vercel function) accepts a borsh `SignedDelegate` and submits it from a relayer account that pays the gas. It only relays calls to the Pusaka contract, only `list`, `cancel_listing`, `request_loan`, `cancel_loan_request`, `claim_collateral`, never with a deposit. `api/prove.mjs` proves a token's confirmed deposits through the light client with the relayer paying, which is what the web app's *Prove for free* button calls, so a visitor with no wallet can still make a deposit count.
**Verified on testnet** (`node scripts/relay-test.mjs <owner> <id>`): the owner signed `list` and `cancel_listing` as meta-transactions, the relayer submitted them, and the owner's balance changed by 0.000000 NEAR; a signed `buy` was refused.
The deployment needs `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` set in Vercel; without them the functions answer 503 and the app falls back to proving from the user's wallet.
In the web app, *List*, *Cancel listing*, *Ask for a loan*, *Cancel loan request* and *Take the Pusaka* go through this relayer when the connected wallet supports NEP-366 (`signDelegateActions` in near-connect); otherwise they are normal transactions. Meteor currently signs them as normal transactions (checked on testnet). A Vercel Firewall rate-limit rule on `/api/prove` and `/api/relay` (20 POSTs per minute per IP) is staged in log mode.

## Prices: what a lender or buyer is actually getting

The web app values collateral and listings with live market data: BTC/USD from mempool.space, NEAR (and ETH) from Rhea/Ref, i.e. NEAR DEX prices. A loan shows its loan-to-value and annualised interest; a listing shows how far above or below the BTC's value it is priced. NEAR's on-chain oracles (`pyth-oracle.near`, `pyth-oracle.testnet`, `priceoracle.near`) were all stale when we checked, so the contract doesn't depend on a price; the numbers are labelled as mainnet prices.

## Why the seller can't keep the Bitcoin

Every way we found for a seller to try to keep the BTC after selling, and what stops it:

| # | Attack | Defence | Test |
|---|---|---|---|
| T1 | Withdraw just before the sale | Listing locks withdrawals | `t1_withdraw_while_listed_fails` |
| T2 | Request a signature, then transfer/sell before it arrives | `SignPending` lock blocks transfer, listing and buying until the callback | `t2_transfer_while_pending_fails`, `t2_list_while_pending_fails` |
| T3 | Get a signature, don't broadcast it, sell, broadcast later | Every outpoint is recorded on NEAR **before** the MPC is asked to sign, so even a signature that arrives late (MPC timeout) is accounted for. Buyers only count UTXOs that were **never** signed; signed-but-unspent coins show as at risk | `t3_outpoints_are_recorded_before_signing_and_lock_released`, `repeated_withdrawals_do_not_duplicate_outpoints` |
| T3b | Hide a signed outpoint from the registry with an upper-case or duplicated txid | Txids canonicalised to 64 lower-case hex, duplicates rejected, before signing | `uppercase_txid_is_recorded_canonically`, `duplicate_outpoints_rejected` |
| T4 | Sign something (BTC or ETH) between the buyer's or lender's check and their transaction, e.g. unlist → sign → relist | `buy` and `fund_loan` take `expected_sign_epoch`; any signature request in between makes them fail | `t4_buy_with_stale_count_fails`, `r1_eth_signature_between_check_and_buy_fails`, `l2_lender_with_stale_signed_count_fails` |
| T11 | Swap in worse loan terms just before the lender's transaction lands | `fund_loan` restates principal, repay and duration; any difference fails with `TermsChanged` | `r2_lender_rejects_changed_terms` |
| T12 | Get an EVM signature on a chain buyers don't look at | `withdraw_eth` only signs for chains in `EVM_CHAINS`, the same list the UI shows (Sepolia on testnet) | `r3_unlisted_chain_rejected` |
| T5 | Anyone else requests a signature | Owner check; the MPC path can only be used by the contract account | `t5_non_owner_withdraw_fails`, `seller_cannot_withdraw_after_sale` |
| T6 | Mint a token whose "address" is really yours | The key comes from the MPC contract via an on-chain call, not from the caller | `key_is_compressed_from_mpc_format` |
| T7 | Fund the token with an unconfirmed (RBF) transaction, sell, then double-spend the deposit back | The safe balance only counts **confirmed** coins; unconfirmed ones are shown separately and not counted | client logic in `shared/btc.mjs` (`balances`) |
| T8 | `nft_transfer_call` gives the receiver the token mid-call; it withdraws the BTC, then returns an empty token | `nft_transfer_call` is disabled; Pusaka moves only by `nft_transfer` or the built-in market | `transfer_call_is_disabled` |
| T10 | Get an EVM transaction signed, keep it, sell, broadcast later | The contract records a per-chain **nonce floor** (highest signed nonce + 1) before signing. A buyer only counts the ETH once the account's on-chain nonce reaches the floor; until then it shows as at risk | `e1_nonce_floor_recorded_before_signing`, `e1_floor_never_goes_down` |
| T9 | A failed callback leaves the token locked forever | After ~600 blocks the owner can `unlock_stale`; safe because outpoints were recorded before signing | `unlock_stale_waits_for_timeout`, `unlock_stale_releases_after_timeout` |

There are no NEP-178 approvals and no `nft_transfer_call`, so no marketplace or third party can move a Pusaka around these locks.

T3 (late signatures), T7–T9 and T11–T12, and the ETH part of T4, were found by independent review passes during QA and fixed with the tests above.

**Limits, stated plainly**

- **What is trustless:** the *verified* balance. A deposit counts only after `btc-client-v4.testnet` (a Bitcoin SPV light client on NEAR) has verified its merkle proof and the contract has checked the output pays this Pusaka. Only this contract can get signatures for the address and it records each one, so a proven, never-signed UTXO can't have been spent. A buyer or lender needs nothing but the contract's `verified_sats`.
- **What isn't:** mempool.space is still used to *find* deposits and build proofs (any Esplora works; a lying API can only make a proof fail). Light-client security assumptions apply: it follows the most-work chain it is fed by relayers, so a deep reorg attack is bounded by the confirmations required (1 on testnet, 6 on mainnet).
- Security rests on the NEAR MPC network's threshold assumption.
- The testnet contract is deployed with a full-access key we hold. A production deployment must remove it (or use a DAO) so the code can't be swapped.
- Testnet only. No mainnet funds were used.

## Measured on testnet (2 Nov 2026)

| What | Result |
|---|---|
| Ownership transfer of the BTC (`buy`, until the transaction and its refunds are final) | **3.0 s**, one NEAR transaction, 0 Bitcoin fees |
| MPC signature for a 1-input withdrawal (request to signed tx) | 6.8 s – 13.7 s across 5 runs |
| Bitcoin transactions built by the contract and accepted by testnet4 | [bfdcdcf2…](https://mempool.space/testnet4/tx/bfdcdcf22ea5e1816d995dc27166737a11e25d30c7950a881754526d532bb9e7), [1b6a8926…](https://mempool.space/testnet4/tx/1b6a8926a1b46a0f057bbe30c5eaf1de854f749bad098998d741ea1314817349), [79fd2311…](https://mempool.space/testnet4/tx/79fd2311787dddada2079f75721e1648e6c7d8e7bdf1487aa1b75dde45979e77) (Pusaka #1 funding Pusaka #2), [e5272011…](https://mempool.space/testnet4/tx/e527201185af46e04dddb57411a31790ebfaacb42ff06ea273ea04ff112eef90) (demo with fresh accounts), [7232cac5…](https://mempool.space/testnet4/tx/7232cac5c77f2aebd6e07a7f264531550d033a55b80a754d2d2e63face5962ef), [e2553636…](https://mempool.space/testnet4/tx/e2553636a332080c4b0c1d2417971a8ba362c71f41a7b1aecbfeb4ebcb57d5ce) |
| Full flow through the web app with Meteor Wallet (mint, list, buy, withdraw) | passed; withdrawal [edbf984c…](https://mempool.space/testnet4/tx/edbf984cd4bfc9db49a8305cee4cfd642b14d3c25246167decc8790f45c4caa6) was built in the contract, signed by MPC, assembled and broadcast by the browser |
| Same key on Ethereum: contract-built EIP-1559 tx for Sepolia, MPC-signed, broadcast | [0x85a7466d…](https://sepolia.etherscan.io/tx/0x85a7466d06d1af540315b8b1fa2b33956a773784742c4352d095f8909478eecb): 0.002 ETH out of Pusaka #1. Before it, the 0.01 ETH deposit showed as **at risk** (an earlier nonce-0 signature existed); once nonce 0 was used on-chain, the rest showed as safe |
| Trustless deposit proof: testnet3 tx [2caf27f4…](https://mempool.space/testnet/tx/2caf27f4151b0399cb8cc3d89a9b4f9e8dff6d5affe3612be41310a968c035a0) proven by `btc-client-v4.testnet` via `prove_deposit` | `true` in 3.4 s; 176,246 sats verified on NEAR |
| Unit tests | 61 / 61 passing |
| Loan on testnet: request, fund, collateral locked, default, lender claims Pusaka + BTC; and request, fund, repay | passed (`npm run demo` steps 7–8) |

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
Deploy your own: put the contract id in `shared/btc.mjs` (`CONFIG`), then `npm run setup` (creates faucet accounts, deploys, initialises). Moving to mainnet: see [docs/MAINNET.md](docs/MAINNET.md).

## Built with

near-sdk 5 and near-contract-standards, [omni-transaction](https://github.com/near/omni-transaction-rs) (Bitcoin tx building in the contract), near-api-js 7, @hot-labs/near-connect, bitcoinjs-lib 7, @noble/curves, Vite + React, mempool.space API.
All code in this repository was written during the hackathon window (2 Nov 2026 onward), with help from Claude Code (AI pair programmer).

## License

[MIT](LICENSE)
