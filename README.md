# Pusaka

[![CI](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml/badge.svg?event=push)](https://github.com/PugarHuda/pusaka/actions/workflows/ci.yml)

**An NFT on NEAR that holds real Bitcoin. Sell it, borrow against it or leave it to an heir, and the BTC moves with it. NEAR's
Bitcoin light client proves every deposit. Live on NEAR testnet; not on mainnet yet ([what's real](#whats-real-and-what-isnt-yet)).**

Today, putting BTC in an NFT means wrapped BTC or a custodian. Here the NFT controls a native Bitcoin address itself.

Three things to check, in this order:

1. **Proven, not claimed.** Every satoshi inside is checked by NEAR's own Bitcoin light client, net of everything ever
   signed away. See the [proof of reserves](https://pusaka-two.vercel.app/#/reserves), or run
   `node scripts/mainnet-proof.mjs` to watch NEAR's *mainnet* light client accept the same proof.
2. **Clean to buy.** Before paying, a buyer sees whether anything the seller already signed could still move what's
   inside, on Bitcoin, three EVM chains, Solana and the NFT's NEAR account. The badges below are redrawn from the chains
   on every view; the same answer is a JSON format other wallets can read:
   [proof of clean](docs/PROOF-OF-CLEAN.md) (`/api/badge?id=4&contract=pusaka-btc.testnet&format=json`).
3. **It passes on, with no custodian.** Name an heir and a silence period. If the holder stays silent, the heir claims
   the NFT and every Bitcoin in it: [claimed Pusaka #2 gas-free](https://testnet.near.rocks/tx/DzHQ4456hRkbJxTBRHDJCJ2C8PhXto5T7AgF33zSD3Dn).
   An agent in a TEE (attested hardware) can claim for the heir with a key that never leaves it and can only call
   `claim_inheritance` ([claimed classic #2](https://testnet.near.rocks/tx/ECFUYRkyr23STgCu8okhYs52RXvHXUmrg9449Q3mUTqR) with the first agent's key; [check the current key is the enclave's](docs/FEATURES.md#the-heirs-agent-in-a-tee)).
   Failure cases, each with its test: a guardian loses their key, a guardian turns hostile, the holder is alive but
   offline ([table](docs/FEATURES.md#heirloom-it-passes-on-if-you-go-silent)). The next one, live: classic #27's heir can
   claim from 16 Nov 02:00 UTC and the TEE agent claims it then; this badge counts down, then names who inherited it:

   [![Pusaka #27: heir countdown](https://pusaka-two.vercel.app/api/badge?id=27&contract=pusaka-btc.testnet&heir=1)](https://pusaka-two.vercel.app/?contract=pusaka-btc.testnet#/pusaka/27)

Each Pusaka is a NEAR NFT (NEP-171) with its own native Bitcoin address, signed for by the NEAR MPC network through
[Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures) only when the **current NFT owner** asks.
Every deposit is **proven on NEAR** against Bitcoin's own headers by NEAR's Bitcoin light client, and the contract
subtracts every output it ever signed away: `verified_sats` is a number a buyer, lender, heir or AI agent can rely on
with no indexer, no oracle and no custodian. (Smart Pusakas can also hold nBTC, which is bridged BTC; the app counts it
separately.)

Live badges, redrawn from the chains on every view (BTC proven on NEAR, and whether anything the holder already signed
could still move it, with the time of the check):

[![Pusaka #4: proof of clean](https://pusaka-two.vercel.app/api/badge?id=4&contract=pusaka-btc.testnet&clean=1)](https://pusaka-two.vercel.app/?contract=pusaka-btc.testnet#/pusaka/4)
[![Pusaka #27: proof of clean](https://pusaka-two.vercel.app/api/badge?id=27&contract=pusaka-btc.testnet&clean=1)](https://pusaka-two.vercel.app/?contract=pusaka-btc.testnet#/pusaka/27)

**About 3 minutes, no wallet:**
```
git clone https://github.com/PugarHuda/pusaka && cd pusaka
npm install && node scripts/verify.mjs        # every claim below, checked against NEAR, its MPC, its light client and Bitcoin
node scripts/mainnet-proof.mjs                # the same proof, accepted by NEAR's *mainnet* Bitcoin light client (free view call)
```
Then open **https://pusaka-two.vercel.app/#/market**: every Pusaka, the Bitcoin proven inside it, and what you can do now.

## What it looks like (live app, 14 Nov)

| | |
|---|---|
| ![The market: every Pusaka with the Bitcoin proven inside it](docs/screenshots/market.png) | ![A Pusaka for sale by Dutch auction: 10,000 sats verified on NEAR, its price against the BTC inside, a live NEAR Intents exit quote](docs/screenshots/token.png) |
| **Market**: every Pusaka, the BTC proven inside, what you can do now | **A Pusaka**: BTC verified on NEAR, price vs. the BTC inside, live exit quote |
| ![Clean to buy: nothing the seller signed can still move what's inside, checked on every chain](docs/screenshots/clean-to-buy.png) | ![Borrow Circle USDC from the pool, priced by three reporters](docs/screenshots/lend-pool.png) |
| **Clean to buy**: Bitcoin, every EVM chain, Solana, its NEAR account | **Two ways to borrow**: NEAR from a person, or Circle USDC from the pool |
| ![Proof trail: each deposit's Bitcoin tx, the light client's merkle check, and the attested TEE agent that proved it](docs/screenshots/proof-trail-tee.png) | ![An exchange checks a Pusaka's BIP-322 proof: valid, exchange-ready, clean](docs/screenshots/verify-exchange.png) |
| **Proof trail**, with deposits proven by the attested Shade Agent | **For exchanges**: BIP-322 proof, sats proven, clean, `exchange_ready` |
| ![A Smart Pusaka: its own keyless NEAR account, nBTC inside, its Omni deposit address](docs/screenshots/smart-pusaka-nbtc.png) | ![Proof of reserves across both contracts, each row re-checkable in the browser](docs/screenshots/reserves.png) |
| **Smart Pusaka**: its own account, nBTC in and out | **Proof of reserves**, re-checkable from your browser |
| ![Real attacks the contracts refused, each confirmed failed on NEAR](docs/screenshots/refused.png) | ![For AI agents: the live MCP endpoint's tools, prompts and resources](docs/screenshots/agents.png) |
| **Refused**: real attacks, failed on-chain | **For AI agents**: 61 MCP tools, x402 audits |
| ![Pusaka #27's will: if its holder stays silent until 16 Nov 02:00 UTC, pusaka-buyer.testnet can claim it with everything it holds](docs/screenshots/heir.png) | ![A prompt-injected agent tries to send a Pusaka's Bitcoin to an attacker and is refused three ways; nothing changes on chain](docs/screenshots/attack-demo.png) |
| **It passes on**: #27's heir can claim from 16 Nov 02:00 UTC, by the TEE agent (its page history shows the claim) | **Attack demo**: a prompt-injected agent, refused before signing |

Regenerate: `node web/e2e/readme-shots.mjs [bip322-proof.json]`.

## Why it's different

| | NFT = a Chain Signatures wallet (Satchel, Handover, Incorpr) | BTC vault NFT for loans (Unwrapped) | BTC escrow with light-client proofs (Trueque) | **Pusaka** |
|---|---|---|---|---|
| Bitcoin inside | none (Satchel: 16 EVM chains), or native BTC read off-chain | native UTXOs, SPV-proven on NEAR | native, proven once for one deal | **native UTXOs proven on NEAR, plus nBTC in the NFT's own account, redeemable back to native BTC (done live)** |
| Balance stays right after spends | EVM sign record (Satchel); otherwise nothing on NEAR | proven minus a signature ledger | n/a (escrow ends) | **proven minus every signed output, and a buy fails if anything was signed since the buyer looked (sign epoch)** |
| Borrowing | no | USDC from a pool, oracle price, liquidation | no | **both, and the holder picks the risk: NEAR from a person (standing offers, gas-free accept, refinance; fixed term, no oracle, so a price dip never costs the Bitcoin), or **Circle's testnet USDC** from a pool (`pusaka-lend.testnet`: liquidation from 80% at ≥95% of the BTC's value with the surplus paid to the borrower, 2-of-3 reporter price; with all three reports fresh one outlier can't move either side)** |
| "Clean to buy" check | yes for EVM (Satchel) | n/a | n/a | **yes, on every token page: Bitcoin, every EVM chain, Solana and its NEAR account (NEAR, nBTC), loan status** |
| Outside NEAR | no | no | no | **SIWE sign-in and BIP-322 proofs an exchange checks at `#/verify` or `POST /api/verify`, with the sats proven at that address** |
| What else it does | transfer, sale | loan | one swap | **Dutch auctions, Mintbase, NEAR Intents exit, heir with guardians, gift link, staking, bundles, sealed letters, NEAR AI TEE appraisal, deposits proven by an attested Shade Agent, 61-tool MCP server, x402 audits** |
| Code anyone can trust | Satchel: locked, 0 keys | upgradeable | varies | **classic contract keyless, upgrades renounced, reproducible build (NEP-330); every event replayed from genesis by `verify.mjs`** |

Where others are ahead, said plainly: Unwrapped's pool has a longer track record of liquidation logic; Pusaka's pool
(Circle's own testnet USDC since 13 Nov, from Circle's faucet) is newer, runs tight on testnet (borrow up to 79.5%,
liquidation from 80%) so that a real price move can trigger a real liquidation during judging (mainnet: 50/80), and its three price reporters (mempool.space, CoinGecko, Rhea's nBTC
pool) are all run by us on testnet, so the 2-of-3 quorum guards against one bad source, not against us. Satchel covers
16 EVM chains and is on mainnet (Pusaka covers Bitcoin first, EVM/Solana/NEAR alongside, on testnet).

One NFT is a whole set of wallets: the same MPC key holds an address on every EVM chain (ETH, USDC), a second Ed25519
key is a Solana address and the NFT's own NEAR account. **Smart Pusakas** (`pusaka-v2.testnet`) add a keyless NEAR
account per NFT: it can hold USDC from a NEAR Intents swap of the NFT's own Bitcoin, or another Pusaka, and all of it
is sold, lent and inherited as one bundle (live: an AI agent bought one at 66% below its contents, then an heir inherited it).
Since 13 Nov `pusaka-v2.testnet` is the main contract; the classic `pusaka-btc.testnet` stays frozen for good (open any of its Pusakas with `?contract=pusaka-btc.testnet`), and the Market, reserves, offer book and refusals cover both.

### What's real, and what isn't (yet)

> **Run by us on testnet:** the three price reporters, the gas relayer, and the 3-account DAO that can upgrade
> `pusaka-v2.testnet`. **Nobody can change** the classic `pusaka-btc.testnet`.
> - **Real, on NEAR testnet, every claim with a tx hash** (200 of them, all checked by `verify.mjs`).
> - **Mainnet:** not deployed (needs funds; `docs/MAINNET.md`), but `scripts/mainnet-proof.mjs` shows Pusaka's proof
>   accepted by the mainnet light client `btc-client.bridge.near` for a real mainnet Bitcoin transaction.
> - **NEAR Intents** swaps execute on Tidepool, a 1Click-compatible testnet sandbox with NEAR's unmodified `defuse`
>   verifier; 1Click's own liquidity is mainnet-only, so mainnet is shown as a live quote.
> - **Smart Pusakas** (`pusaka-v2.testnet`, no key since 13 Nov) are upgradeable only through a DAO (our own three demo accounts) plus a 10-minute timelock. The market (`pusaka-market.testnet`), the USDC pool (`pusaka-lend.testnet`) and pUSD (`pusaka-usd.testnet`) have had no key since 13 Nov either. The original
>   contract `pusaka-btc.testnet` has no key and renounced upgrades: nobody can change it.
> - **The USDC pool** lends Circle's own testnet USDC. Its three price reporters are ours, and on testnet it runs tight
>   (borrow up to 79.5%, liquidation from 80%) so a real price move can trigger a real liquidation, and one did on 14 Nov at 81.15% ([BSDwVry5…](https://testnet.near.rocks/tx/BSDwVry5HC95QByn9RYcH2MW5emjSwx8Pa6TCJsKWH8)); mainnet: 50/80.

**Judges and screeners:** [JUDGES.md](JUDGES.md) is the shortest path (3-minute check, 10-minute tour). For AI agents: `npx -y pusaka-mcp` (61 tools,
spend caps), also in the official MCP Registry as `io.github.PugarHuda/pusaka`.

*Pusaka* is Indonesian for an heirloom: a valued object passed from hand to hand.

Built at NEAR HACKATHON (Nov 2026). Tracks: NFTs That Do Something, Unstoppable DeFi, Open Innovation.

Second project by the same builder, independent of this one: [Koperasi](https://github.com/PugarHuda/koperasi), an AI
agent owned and governed by its members (tracks Social Money, Autonomous Business, Agent Economy).

| | |
|---|---|
| Contracts | [`pusaka-v2.testnet`](https://testnet.near.rocks/account/pusaka-v2.testnet) (main: Smart Pusakas) and the frozen classic [`pusaka-btc.testnet`](https://testnet.near.rocks/account/pusaka-btc.testnet) (keyless, renounced), NEAR testnet |
| MPC signer | `v1.signer-prod.testnet` (NEAR Chain Signatures) |
| Bitcoin network | testnet3 ([mempool.space/testnet](https://mempool.space/testnet)), the network NEAR's Bitcoin light client tracks |
| Bitcoin light client | [`btc-client-v4.testnet`](https://testnet.near.rocks/account/btc-client-v4.testnet) (Near-One / Omni Bridge), verifies every deposit on-chain |
| Live demo | **https://pusaka-two.vercel.app** (or run locally, below) |

## Try it in two minutes (testnet wallet only)

1. Open **https://pusaka-two.vercel.app/#/market**, click *Connect NEAR wallet* and pick Meteor (testnet; new accounts get faucet NEAR).
2. **Buy:** pick any card marked *For sale* in the Market (the demo stock is refilled, so the numbers move). Each card says how its price compares with the BTC inside. Click one, then *Buy*. **See:** "You own Pusaka #N", and you can *Withdraw* its BTC to any `tb1…` address.
3. **Lend:** pick any card marked *Asking to borrow*. The page shows the loan-to-value and what the collateral would sell for right now through NEAR Intents. Click *Lend*. **See:** the loan funded, the Pusaka locked as collateral, and *Take the Pusaka* once it's overdue.
4. **A bundle:** a Smart Pusaka can hold other Pusakas and USDC in its own account; a card marked *Bundle* lists what is inside, its page says so before you buy, and the Market counts that Bitcoin once.
5. **No wallet at all?** Any Pusaka with a confirmed, unproven deposit proves itself when you open it; the relayer pays.
6. **See the attacks it refused:** [#/refused](https://pusaka-two.vercel.app/#/refused) lists real failed transactions (a seller withdrawing after a sale, a front-run signature, an early heir, a stranger spending from an NFT's own account, …), each with the contract's own panic read live from NEAR's archive and the test that guards it.
7. **Don't trust our page:** open any Pusaka and click *Check it yourself*: your browser asks NEAR, its MPC signer, its light client and Bitcoin directly. Same code as `scripts/verify.mjs`.

## Run it locally

Requirements: Node 22+, and Rust + `cargo-near` only if you want to rebuild the contract.

### 1. Run the unit tests (offline; ~4 min on a cold build, ~10 s after) — Rust

```sh
cd contract && cargo test
```

See: `375 passed`. They cover every attack in the [threat model](docs/THREAT-MODEL.md#why-the-seller-cant-keep-the-bitcoin) (tests named `t1_…` to `t5_…`, `m…` for markets, `l…` loans, `p…` proofs, `s…` Solana, `a…` the NEAR account, `h1_letter…`–`h4_…` the sealed letter, `h1_heir…`–`h10_…` the heir, `x…` `nft_transfer_call`, `o…` the loan market, `up…` timelocked upgrades, `g…` gift links, `sn…` NEAR Social notifications, `n…` the on-chain image, `gd…` guardians, `ch…` withdrawal change, `sk…` staking) plus storage and input validation.

### 2. Run the full flow against the deployed contract (~5 min, 3 of them waiting for an optional BTC deposit)

```sh
npm install
npm run demo
```

What happens, step by step (all on NEAR testnet + Bitcoin testnet3, against the classic contract `pusaka-btc.testnet`, the one nobody can change, where the demo stock is; `PUSAKA_CONTRACT=pusaka-v2.testnet` runs it on Smart Pusakas; the numbers match what the script prints):

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

115 UI tests on Chromium, Firefox, WebKit, an iPad and a Pixel 7, plus 45 read-only checks against the live app; CI runs
them on every push and daily, with a receipt monitor for failed callbacks. Details: [docs/TESTING.md](docs/TESTING.md).

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

The three things above are the product. Everything else is built on the same proven balance, live on testnet with
transaction hashes, and listed in full in [docs/FEATURES.md](docs/FEATURES.md#everything-it-does):

- **Markets:** sell in one transaction (a buy fails if anything was signed since the buyer looked), Dutch auctions,
  Mintbase (NEP-178/199), per-sat bids, buy with native Bitcoin, NEAR Intents exit.
- **Credit:** NEAR loans from a person (offer book, refinance, no oracle) or Circle USDC from a pool with a 2-of-3
  reporter price and liquidation.
- **One NFT, many wallets:** ETH and USDC on three EVM chains, SOL, its own NEAR account (staking, nBTC), all moving
  with the NFT.
- **Smart Pusakas** (`pusaka-v2.testnet`, [docs/V2.md](docs/V2.md)): a keyless account per NFT, bundles, vault with
  clawback, covered calls, post-quantum lock, SIWE and BIP-322 proofs for exchanges.
- **For agents:** `npx -y pusaka-mcp` (61 tools, spend caps), x402 audits. [docs/AGENTS.md](docs/AGENTS.md).
  A prompt-injected agent that tries to send the Bitcoin to an attacker is refused three ways before anything is signed:
  `node mcp/injection-demo.mjs` ([log](docs/FEATURES.md#attack-demo-a-prompt-injected-agent-tries-to-pay-an-attacker)).
- **Why it holds:** every attack in the [threat model](docs/THREAT-MODEL.md) has a test named after it, and
  [#/refused](https://pusaka-two.vercel.app/#/refused) shows 39 real attempts the contracts turned down.

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
api/        Vercel functions: relay (NEP-366), prove, holder (NEP-413), reserves, badge, prices (+ pool price reports), mcp, verify, audit (x402), appraise
lend/       the USDC lending pool (Rust): shares, 2-of-3 reporter price, liquidation; lend/pusd the faucet test token it started on
market/     per-sat bids and perpetual loans (Rust)
mcp/        MCP server for AI agents
shade/      TEE deposit prover (Phala TDX), its attestation-checking agent contract, compose/deploy config
web/        Vite + React app, NEAR wallet via @hot-labs/near-connect
docs/PRD.md product requirements and design notes
```

Build the contract: `cd contract && cargo near build non-reproducible-wasm --no-abi` → `target/near/pusaka.wasm`.
Deploy your own: set `PUSAKA_CONTRACT=<your contract id>` (or edit `deployments/testnet-v2.json`, which `shared/btc.mjs` reads), then `npm run setup` (creates faucet accounts, deploys, initialises). Moving to mainnet: see [docs/MAINNET.md](docs/MAINNET.md).

## Built with

near-sdk 5 and near-contract-standards, [omni-transaction](https://github.com/near/omni-transaction-rs) (Bitcoin tx building in the contract), near-api-js 7, @hot-labs/near-connect, bitcoinjs-lib 7, @noble/curves, Vite + React, mempool.space API.
All code in this repository was written during the hackathon window (2 Nov 2026 onward), with help from Claude Code (AI pair programmer).

## License

[MIT](LICENSE)
