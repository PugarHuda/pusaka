# Pusaka

[![CI](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml/badge.svg)](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml)

**NFTs that hold real Bitcoin, proven on-chain. Sell the NFT and the Bitcoin goes with it.**

Each Pusaka is a NEAR NFT (NEP-171) that controls its own native Bitcoin address through
[NEAR Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures). The address's key is held by the
NEAR MPC network and can only be used by the Pusaka contract, and the contract only asks for a signature when the
**current NFT owner** requests one. So transferring the NFT transfers control of the BTC, in one NEAR transaction:
no bridge, no wrapped BTC, no custodian, no private key the seller could keep a copy of.

And the Bitcoin inside is **proven, not claimed**: every deposit is checked on NEAR against Bitcoin's own block
headers by NEAR's on-chain Bitcoin light client, and the contract subtracts every output it ever signed away. A buyer,
a lender or an agent reads `verified_sats` from the contract and needs no indexer, no oracle and no trust in us.

> **What's real, and what isn't (yet).**
> - **Real, on NEAR testnet, every claim with a tx hash:** native BTC (testnet), the Bitcoin light-client proofs, MPC signing
>   for BTC/EVM/Solana/NEAR, sales, loans, inheritance, gift links, the MCP agent tools, and Smart Pusakas (the NFT's own account,
>   post-quantum lock, an AI agent's on-chain daily budget, signing in as the NFT, its own NEAR Intents balance, a purchase paid in
>   real testnet Bitcoin, a vault, call options), and a Pusaka sold for USDC through NEAR Intents. `node scripts/verify.mjs` checks the contract's state against chain with no wallet.
> - **Testnet only.** No mainnet deployment; mainnet needs funds (runbook: `docs/MAINNET.md`).
> - **The NEAR Intents exit executes on Tidepool**, a 1Click-compatible testnet sandbox (unmodified `defuse` verifier); 1Click's
>   real liquidity is mainnet-only. On the original contract, the exit is a live 1Click quote.
> - **NEAR MPC itself:** on 10 Nov `v1.signer` on mainnet reports 16 participants and a signing threshold of 11, and NEAR One's
>   [operator overview](https://mpc-operators.nearone.org/overview.html) says each node runs in an Intel TDX TEE.
> - **The DAO council that could upgrade Smart Pusakas (`pusaka-v2.testnet`) is our own three demo accounts.** It shows the mechanism, not independence. The
>   original contract `pusaka-btc.testnet` has no key and renounced upgrades: nobody can change it.

**How this differs from other "the NFT is a wallet" designs.** The common design gives each NFT its own NEAR
(sub-)account. That account can hold NEAR and NEP-141 tokens, so Bitcoin can only be there as a wrapped token, and
someone has to vouch for the wrapper. A Chain Signatures design that gives the NFT an EVM address does better, but a
buyer still checks that address's balance off-chain. Pusaka puts **native BTC** in the NFT: a real Bitcoin address
holding UTXOs, with no wrapper. The contract itself knows how much is inside: `verified_sats` is proven by the light
client, net of everything it has ever signed away. So a price, a loan or an inheritance can be set against BTC the
chain has verified, not BTC someone says is there.

| | NFT with a NEAR sub-account | NFT with a BTC/EVM address (Chain Signatures) | **Pusaka** |
|---|---|---|---|
| Bitcoin inside | wrapped token only | native, but nothing on NEAR knows how much | **native UTXOs at its own address** |
| Contents provable on NEAR | NEAR assets only | no: the balance is read off-chain from the other chain | **yes: `verified_sats`, light-client proven** |
| Seller can't keep a way back in | keyless account | sign log | **sign epoch: a buy fails if anything was signed since the buyer looked; outside markets wait 1 h (mainnet 24 h) after the last signature** (the counter-based lock proposed for ERC-6551 front-running, [ethereum-magicians #13030](https://ethereum-magicians.org/t/erc-6551-non-fungible-token-bound-accounts/13030/118)) |
| Borrow against what's inside | — | — | **BTC-collateral loans, enforced by the contract** |
| Sell it as Bitcoin | — | price set blind, or trust the seller | **market price shown against the proven BTC inside; signing from the web app, not a CLI** |

One NFT is a whole set of wallets: the same MPC key that holds its Bitcoin also controls one address on every EVM
chain (ETH and USDC on Ethereum, Base and Arbitrum), and a second, Ed25519 MPC key is both a **Solana address** and the
Pusaka's **own NEAR account**. Sell the NFT and all of it moves at once, with a sealed letter only the current holder
can read and a 2.5% royalty for the creator on every resale.

It is a standard NEAR NFT, so it trades outside our app too: NEP-178 approvals and NEP-199 payouts let any NEAR
market sell it (tested live on Mintbase's market), and the contract freezes the BTC for as long as a market may sell it.

**Judges and screeners:** [JUDGES.md](JUDGES.md) is a five-minute path; `node scripts/verify.mjs` checks the core claims below (code, keys, MPC derivation, proven BTC, reserves; cited transaction hashes for existence) against NEAR, its MPC signer, its Bitcoin light client and Bitcoin, with no wallet.

*Pusaka* is Indonesian for an heirloom: a valued object passed from hand to hand.

Built at NEAR HACKATHON (Nov 2026). Tracks: NFTs That Do Something, Unstoppable DeFi, Open Innovation.

Second project by the same builder, independent of this one: [Koperasi](https://github.com/PugarHuda/koperasi), an AI
agent owned and governed by its members (tracks Social Money, Autonomous Business, Agent Economy).

| | |
|---|---|
| Contract | [`pusaka-btc.testnet`](https://testnet.near.rocks/account/pusaka-btc.testnet) (NEAR testnet) |
| MPC signer | `v1.signer-prod.testnet` (NEAR Chain Signatures) |
| Bitcoin network | testnet3 ([mempool.space/testnet](https://mempool.space/testnet)), the network NEAR's Bitcoin light client tracks |
| Bitcoin light client | [`btc-client-v4.testnet`](https://testnet.near.rocks/account/btc-client-v4.testnet) (Near-One / Omni Bridge), verifies every deposit on-chain |
| Live demo | **https://pusaka-two.vercel.app** (or run locally, below) |

## Try it in two minutes (testnet wallet only)

1. Open **https://pusaka-two.vercel.app**, click *Connect NEAR wallet* and pick Meteor (testnet; new accounts get faucet NEAR).
2. **Buy:** Pusaka #4 is for sale by Dutch auction (0.6 falling to 0.45 NEAR) with 10,000 sats verified on NEAR (#10 and #11 are listed the same way, in case a judge before you bought it). Click *Buy*. **See:** "You own Pusaka #4", and you can now *Withdraw* its BTC to any `tb1…` address.
3. **Lend:** Pusaka #1 asks to borrow 0.5 NEAR, repaying 0.501 within 3 days (about 24% a year), backed by 90,946 verified sats (loan-to-value about 3%); #12, #13 and #14 ask the same, backed by 10,000 sats each. The page also shows what the collateral would sell for right now through NEAR Intents. Click *Lend*. **See:** the loan funded, the Pusaka locked as collateral, and *Take the Pusaka* once it's overdue.
   Stock runs out? `node scripts/restock.mjs` mints new demo Pusakas, funds each with 10,000 sats from #1's own BTC (a real withdrawal), proves them through the light client and lists them; re-run it after a Bitcoin confirmation (it needs the demo account's key, so it is for us, not for judges).
4. **No wallet at all?** Any Pusaka with a confirmed, unproven deposit proves itself when you open it; the relayer pays.
5. **See the attacks it refused:** open [#/refused](https://pusaka-two.vercel.app/#/refused). **See:** 11 real transactions against `pusaka-btc.testnet` (the seller withdrawing after a sale or while listed, a front-run signature, a borrower pulling collateral, a lender seizing early, an early heir, relayer dust, early and swapped code), plus 28 against Smart Pusakas (a stranger or the previous holder spending from the NFT's own account, the seller or their AI agent emptying it while listed, a missing or replayed post-quantum unlock, an agent over its budget or paying an unlisted account, a stranger posing as the agent or granting itself a budget), each one's sender, method and the contract's own panic read live from NEAR's archive, with the test that guards it.
6. **Don't trust our page:** open any Pusaka (e.g. [#/pusaka/11](https://pusaka-two.vercel.app/#/pusaka/11)) and click *Check it yourself*. **See:** your browser asks NEAR, its MPC signer, its Bitcoin light client and Bitcoin directly (no Pusaka server) and ticks off: no full-access key on the contract, code final, the Bitcoin key is the MPC's derivation for this contract, `verified_sats` = proven deposits never signed away, and each deposit is confirmed on Bitcoin to this address. Same code as `scripts/verify.mjs` (`shared/audit.mjs`).

## Try it

Requirements: Node 22+, and Rust + `cargo-near` only if you want to rebuild the contract.

### 1. Run the unit tests (offline; ~4 min on a cold build, ~10 s after) — Rust

```sh
cd contract && cargo test
```

See: `371 passed`. They cover every attack in the [threat model](docs/THREAT-MODEL.md#why-the-seller-cant-keep-the-bitcoin) (tests named `t1_…` to `t5_…`, `m…` for markets, `l…` loans, `p…` proofs, `s…` Solana, `a…` the NEAR account, `h1_letter…`–`h4_…` the sealed letter, `h1_heir…`–`h10_…` the heir, `x…` `nft_transfer_call`, `o…` the loan market, `up…` timelocked upgrades, `g…` gift links, `sn…` NEAR Social notifications, `n…` the on-chain image, `gd…` guardians, `ch…` withdrawal change, `sk…` staking) plus storage and input validation.

### 2. Run the full flow against the deployed contract (~3 min)

```sh
npm install
npm run demo
```

What happens, step by step (all on NEAR testnet + Bitcoin testnet3, against the deployed contract; the numbers match what the script prints):

0. Two fresh NEAR accounts are created through the public NEAR testnet faucet. **See:** `created pusaka-s-….testnet`.
1. The seller mints a Pusaka. The contract fetches its Bitcoin key from the MPC contract on-chain. **See:** a `tb1q…` address.
2. **The one manual step (optional):** send testnet3 BTC to that address, e.g. one click at [coinfaucet.eu/en/btc-testnet](https://coinfaucet.eu/en/btc-testnet/) (one request per IP per 12 h; any testnet3 faucet works). The script waits for **1 Bitcoin confirmation**, then calls `prove_deposit`: the contract parses the transaction, checks it pays this Pusaka, and the on-chain light client verifies the merkle proof. **See:** `proven by btc-client-v4.testnet: true` and `verified on NEAR: … sats`. **No BTC sent within 3 minutes** (an automated run can't use a faucet; `--wait 30` waits longer): the seller buys a stocked Pusaka that already holds proven BTC and the steps below run on it; at the end it is relisted for the next person. **See:** `bought stocked Pusaka #… (… sats already proven)`, and at the end `relisted #…`.
3. The seller lists it for 1 NEAR, then tries to withdraw. **See:** `rejected (Listed)`.
4. The buyer checks the safe balance and buys. **See:** `sold in ~3s — new owner: pusaka-b-…`. Nothing happened on Bitcoin.
5. The old owner tries to withdraw. **See:** `rejected (NotOwner)`.
6. The new owner withdraws 1000 sats. The contract builds the Bitcoin transaction, the MPC network signs it, the script verifies each signature locally and broadcasts. **See:** a `mempool.space/testnet/tx/…` link that the Bitcoin network accepted.
7. The buyer borrows 0.5 NEAR against the Pusaka and the seller lends it. **See:** the borrower's withdrawal rejected with `Collateralised`.
8. The loan isn't repaid in time and the lender takes the Pusaka with its BTC. **See:** the lender as the new owner.

Already have accounts in `.keys/` and a funded token? `npm run demo -- --token 1 --seller a.testnet --buyer b.testnet` skips steps 0–2.

### 2b. End-to-end checks against the live app (~3 min)

```sh
npx playwright install chromium firefox webkit   # once, on a fresh machine
npm run e2e -w web                # Playwright, against https://pusaka-two.vercel.app
npx playwright show-report web/playwright-report   # the HTML report, with traces and screenshots of any failure
```

Two suites. `e2e/ui.spec.mjs` runs on **Chromium, Firefox, WebKit, an iPad and a Pixel 7** (19 tests each, 95 in all; visual baselines are checked on Linux in CI): back/forward and deep links (leading zeros, a missing token, `-1`, a 5,000-character route, a script tag in the URL), the command palette with empty, huge and hostile input, no horizontal scroll on any key page, **axe-core** (WCAG 2.1 AA, no serious or critical violation on landing, market, a Pusaka, For AI agents and not-found, and in dark mode on landing, market and a Pusaka), **visual snapshots** of the pages whose pixels don't depend on live data (not-found; Your Pusakas without a wallet in light, then in dark after the system switches with the page open), committed per engine and OS, and **failure paths by route interception**: every NEAR RPC down (the token page, the market and the landing page say so and *Try again* recovers), both Bitcoin explorers down (NEAR-verified sats still shown, with a warning), the price API failing (no `NaN`), and going offline mid-session. Nothing on the success path is mocked: it reads the live testnet contract. These tests found four bugs, fixed: the theme ignored a system switch to dark while the page was open; the landing page stayed on *Reading the contract…* forever when NEAR was unreachable; fast back/forward left unhandled View Transition rejections; and twenty parallel reads failing on a rate-limited RPC cycled the shared failover index back onto that RPC (now each call skips an endpoint that failed in the last minute, and a contract panic is never retried: `node shared/failover.test.mjs`). `e2e/live.spec.mjs` (Chromium) checks the production deployment against the chain. See: `40 passed`, a few skipping when an outside feed is down (home, first paint without the bundle, loan offer book, detail, not-found recovery, keyboard skip link and focus on navigation, phone layout, no-wallet actions, relayer and API input checks, on-chain NFT image, outside-market listings, EVM/SOL/NEAR accounts, holder room, reserves and badges, nBTC, heir section, security headers, the NEAR Intents exit quote, the Your Pusakas page, and that the demo stock and the relayer's balance are there). Read-only: no wallet, no transactions. CI runs it on every push and once a day.

**Monitoring** (NEAR security checklist: alert on every failed callback receipt). `node scripts/receipt-monitor.mjs [--hours 6]` reads every receipt of every transaction touching `pusaka-btc.testnet` or `pusaka-relayer.testnet` in the last 6 hours (FastNear tx API, no keys). It fails if a receipt the contract sent to itself failed (`on_key`, `on_signed*`, `on_deposit_proven`, `on_usdc_proven`, `nft_resolve_transfer`, ...), or if a token's signing lock (`pending`) has been held for 600+ blocks, which means a callback never cleared it and the owner needs `unlock_stale`. A user's own call that panics on purpose (a refused withdraw, a buy that hits `StateChanged`) is that caller's failed transaction, so it's only counted. CI runs it after the e2e checks, on the same 6-hour schedule.

### 3. Use the web app

```sh
npm install
npm run dev        # http://localhost:5173
```

- **Do:** open the home page. **See:** every Pusaka as a medallion generated from its Bitcoin key, with the BTC **verified on NEAR** by the light client, plus anything still waiting to be proven.
- **Do:** open a Pusaka whose deposit is confirmed but not proven and click *Prove deposit* (any connected account can). **See:** the verified amount go up after the light client accepts the proof.
- **Do:** open a Pusaka. **See:** its Bitcoin address (links to mempool.space), safe balance, at-risk balance if any, and on-chain history.
- **Do:** connect a NEAR testnet wallet (tested with Meteor Wallet) and click *Mint a Pusaka*. Then *List for sale*, *Buy* from a second account, or *Withdraw* to any `tb1…` address.

## What it does

Each line is live on testnet with transaction hashes; the detail is one click away.

**The core (contract `pusaka-btc.testnet`, final: no key, upgrades renounced)**
- **Bitcoin proven, not claimed**: every deposit is checked by NEAR's Bitcoin light client; `verified_sats` is net of everything ever signed away. [How](docs/FEATURES.md#trustless-balance-nears-bitcoin-light-client) · [proof of reserves](https://pusaka-two.vercel.app/#/reserves)
- **Sell the NFT = sell the Bitcoin**, in one NEAR transaction; a buy fails if anything was signed since the buyer looked. Also on outside markets (NEP-178/199, tested on Mintbase). [How](docs/FEATURES.md#one-nft-many-wallets-how-control-passes-on-transfer)
- **Borrow against the Bitcoin**, auctions, a loan-offer book and refinancing. [How](docs/FEATURES.md#borrow-against-your-bitcoin-sell-by-auction) · [prices](docs/FEATURES.md#prices-what-a-lender-or-buyer-is-actually-getting)
- **Inheritance**: an heir claims after the holder goes silent, optionally only with guardians' approval. [How](docs/FEATURES.md#heirloom-it-passes-on-if-you-go-silent)
- **One NFT, many wallets**: the same MPC keys hold ETH and USDC on Ethereum/Base/Arbitrum, SOL, its own NEAR account (staking, nBTC), all moving with the NFT. [How](docs/FEATURES.md#one-nft-many-wallets-how-control-passes-on-transfer)
- **Holder room**: a sealed letter and files only the current holder can open (NEAR MPC confidential key derivation). [How](docs/FEATURES.md#holder-room-gated-by-the-nft)
- **Gift links, gas-free actions and passkeys**: send a Pusaka by link; list, borrow and inherit without NEAR for gas; no wallet needed with a passkey. [How](docs/FEATURES.md#gas-free-actions-nep-366-relayer)
- **Verified USDC, TEE prover, private AI appraisal**. [How](docs/FEATURES.md#verified-usdc-near-mpc-reads-base-and-arbitrum)

**Smart Pusakas (contract `pusaka-v2.testnet`: the same, plus)** — [docs/V2.md](docs/V2.md)
- The NFT owns a keyless NEAR account and a NEAR Intents balance; a post-quantum (ML-DSA-65) lock; an AI agent's daily budget enforced on-chain.
- Sign in to websites as the NFT (SIWE), prove its Bitcoin address (BIP-322), rent its use (ERC-4907).
- **Buy it with native Bitcoin**, the payment proven by the light client (bought live with real testnet BTC).
- **A vault** (Bitcoin covenant vaults' delay and clawback, enforced by the contract) and **covered call options**, whose strike can be paid in native Bitcoin, proven by the light client.

**Markets and agents**
- A market contract: bids and buy pools priced per verified sat, perpetual loans with rate auctions. [How](docs/FEATURES.md#bids-per-verified-sat-and-loans-with-no-due-date-a-second-market-contract)
- An MCP server with 55 tools for AI agents, a proof-of-reserves audit paid per call over x402 on NEAR, an ERC-8004 registration file. [docs/AGENTS.md](docs/AGENTS.md) · [summary](docs/FEATURES.md#for-ai-agents-pusaka-over-mcp)

**Why it holds**: the seller can't keep a way back into the Bitcoin. Every attack in the [threat model](docs/THREAT-MODEL.md) has a test named after it, and the [Refused](https://pusaka-two.vercel.app/#/refused) page shows 39 real attempts the contracts turned down. [Measured on testnet](docs/EVIDENCE.md) · [every NEAR primitive used](docs/EVIDENCE.md#every-near-primitive-pusaka-uses-and-where-to-see-it-live).

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

## Repository

```
contract/   Rust smart contract (near-sdk 5, NEP-171) + unit tests
  src/lib.rs     NFT, market, withdraw, locks, outpoint registry
  src/btc.rs     P2WPKH scripts, BIP143 sighashes, tx building
  src/tests.rs   threat-model tests
shared/     Bitcoin helpers used by scripts and web: address, safe balance, witness assembly + signature check
scripts/    setup.mjs (deploy), demo.mjs (end-to-end), withdraw*.mjs (BTC, ETH/USDC, SOL, NEAR),
            mintbase.mjs, holder-test.mjs, handover.mjs
api/        Vercel functions: relay (NEP-366), prove, holder (NEP-413), reserves, badge, prices, mcp
mcp/        MCP server for AI agents
shade/      TEE deposit prover (Phala TDX), its attestation-checking agent contract, compose/deploy config
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
