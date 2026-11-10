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
>   for BTC/EVM/Solana/NEAR, sales, loans, inheritance, gift links, the MCP agent tools, and Pusaka v2 (the NFT's own account,
>   post-quantum lock, an AI agent's on-chain daily budget, signing in as the NFT, its own NEAR Intents balance), and a Pusaka sold for USDC through NEAR Intents. `node scripts/verify.mjs` checks the contract's state against chain with no wallet.
> - **Testnet only.** No mainnet deployment; mainnet needs funds (runbook: `docs/MAINNET.md`).
> - **The NEAR Intents exit executes on Tidepool**, a 1Click-compatible testnet sandbox (unmodified `defuse` verifier); 1Click's
>   real liquidity is mainnet-only. On the original contract, the exit is a live 1Click quote.
> - **NEAR MPC itself:** on 10 Nov `v1.signer` on mainnet reports 16 participants and a signing threshold of 11, and NEAR One's
>   [operator overview](https://mpc-operators.nearone.org/overview.html) says each node runs in an Intel TDX TEE.
> - **The DAO council that could upgrade v2 is our own three demo accounts.** It shows the mechanism, not independence. The
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
5. **See the attacks it refused:** open [#/refused](https://pusaka-two.vercel.app/#/refused). **See:** 11 real transactions against `pusaka-btc.testnet` (the seller withdrawing after a sale or while listed, a front-run signature, a borrower pulling collateral, a lender seizing early, an early heir, relayer dust, early and swapped code), plus 25 against Pusaka v2 (a stranger or the previous holder spending from the NFT's own account, the seller or their AI agent emptying it while listed, a missing or replayed post-quantum unlock, an agent over its budget or paying an unlisted account, a stranger posing as the agent or granting itself a budget), each one's sender, method and the contract's own panic read live from NEAR's archive, with the test that guards it.
6. **Don't trust our page:** open any Pusaka (e.g. [#/pusaka/11](https://pusaka-two.vercel.app/#/pusaka/11)) and click *Check it yourself*. **See:** your browser asks NEAR, its MPC signer, its Bitcoin light client and Bitcoin directly (no Pusaka server) and ticks off: no full-access key on the contract, code final, the Bitcoin key is the MPC's derivation for this contract, `verified_sats` = proven deposits never signed away, and each deposit is confirmed on Bitcoin to this address. Same code as `scripts/verify.mjs` (`shared/audit.mjs`).

## Try it

Requirements: Node 22+, and Rust + `cargo-near` only if you want to rebuild the contract.

### 1. Run the unit tests (offline; ~4 min on a cold build, ~10 s after) — Rust

```sh
cd contract && cargo test
```

See: `330 passed`. They cover every attack in the [threat model](#why-the-seller-cant-keep-the-bitcoin) (tests named `t1_…` to `t5_…`, `m…` for markets, `l…` loans, `p…` proofs, `s…` Solana, `a…` the NEAR account, `h1_letter…`–`h4_…` the sealed letter, `h1_heir…`–`h10_…` the heir, `x…` `nft_transfer_call`, `o…` the loan market, `up…` timelocked upgrades, `g…` gift links, `sn…` NEAR Social notifications, `n…` the on-chain image, `gd…` guardians, `ch…` withdrawal change, `sk…` staking) plus storage and input validation.

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

## Borrow against your Bitcoin, sell by auction

- **Loans:** the owner posts `request_loan(principal, repay, duration)`. A lender funds it with `fund_loan` and the NEAR goes straight to the borrower. While the loan is open the Pusaka can't be withdrawn from, sold or moved (`Collateralised`). The borrower repays with `repay_loan`; if they don't by the due date, the lender calls `claim_collateral` and receives the NFT, and with it the native BTC. No bridge, no oracle, no liquidation bot.
- **Lender offers:** a lender can post first. `offer_loan(token_id | min_verified_sats, principal, repay, duration_ms)` escrows the principal in the contract, either for one Pusaka or for any Pusaka with at least that much BTC proven by the light client. The owner takes it with `accept_loan_offer(token_id, offer_id, expected_sign_epoch)`: the loan is funded at once and the NEAR goes to the owner. `cancel_loan_offer` gives the lender the principal and storage back; `loan_offers(from, limit)` lists open offers.
- **Refinance, part repayment, extensions:** a funded loan is refinanced the way NFTfi and Gondi do it: any lender posts an offer for the Pusaka (`offer_loan` again) and the borrower takes it with the same `accept_loan_offer`. The new principal first pays the current lender the full repay amount, the rest goes to the borrower; if the offer is smaller, the borrower attaches the difference (`doesn't cover` otherwise). The old lender is never paid less than agreed, the new lender earns their own terms, and the borrower chooses. The borrower can pay down the loan early with `repay_partial` (straight to the lender). The lender can `propose_extension(extra_ms, fee)` and the borrower takes it with `accept_extension`, paying the fee before the due date.
- **Ether too:** the MPC key behind `pusaka-N` also controls one address on every EVM chain. `withdraw_eth` builds an EIP-1559 transaction in the contract (Sepolia in the demo) and gets it signed the same way, so a Pusaka can hold BTC and ETH and both change hands with the NFT.
- **Dutch auctions:** `list(price, floor, duration_ms)` lowers the price linearly to `floor`; `buy` pays the current price and refunds the rest.

## Heirloom: it passes on if you go silent

*Pusaka* means heirloom, so a Pusaka can have an heir. The holder calls `set_heir(token_id, heir, after_ms)`; from then on, if they stay silent for `after_ms`, the heir calls `claim_inheritance` and receives the NFT, and with it the BTC, ETH, USDC, SOL, nBTC and NEAR account it controls, plus the sealed letter: the CKD key opens for whoever holds the Pusaka, so the heir reads what the holder left for them. Bitcoin inheritance usually means handing someone a seed phrase or a lawyer; here no key ever exists to hand over, and the contract enforces the will.

- **Proof of life:** anything the holder signs for the Pusaka (withdraw, list, loan request, letter, naming the heir) restarts the clock; `still_here(token_id)` does it without doing anything else. It is relayed gas-free (NEP-366, one free check-in per hour or per tenth of the silence; more often, the holder pays), and the MCP tool `pusaka_still_here` lets an agent check in on a schedule.
- **Reminders:** the deadlines that cost something if missed get a calendar entry: the holder's last day to check in, the day the heir can claim, and a funded loan's due date for both borrower and lender. One click downloads an RFC 5545 `.ics` with an alarm (a day before, or a quarter of the time left when that is shorter), or opens Google Calendar; it is built in the browser, so no email, account or server is involved (`web/src/ics.js`, test in CI). Checked with a real wallet: `node web/e2e/wallet-qa.mjs <profile> remind pusaka-buyer.testnet 2` downloads `Check in on Pusaka #2, or pusaka-seller.testnet can claim it`, and as the heir `Pusaka #2 can be claimed`.
- **A sale ends the will:** every transfer path (`nft_transfer`, `buy`, market payouts, `claim_collateral`) clears the heir, so a buyer never inherits a stranger's heir, even if the Pusaka later comes back to the old holder.
- **A lender comes first:** while a loan is funded, the heir can't claim; an open listing or loan request of the silent holder is withdrawn when the heir claims, and NEP-178 approvals are cleared, so no market can sell it afterwards.
- **Public:** `heir_of` shows the heir and the date from which they can claim, on the page and in `pusaka_inspect`, so a buyer knows. Shortest silence: 10 minutes on testnet (to show it), 30 days on mainnet.

**Guardians (optional): a quorum must agree before the heir can claim.** `set_guardians(token_id, [up to 5 accounts], threshold)` adds a check between the silence and the claim. Once the holder has been silent for the heir's period, guardians call `approve_release`; at `threshold` approvals a last waiting period starts (10 minutes on testnet, 7 days on mainnet), during which anything the holder signs, a gas-free `still_here` included, voids every approval. Approvals count only for the silence they were given in. Guardians can release the Pusaka to the named heir and to no one else, and can never take it. `guardians_of` shows them, the threshold, the approvals that still count, the release time and the backstop. In the web app the heir section names guardians, shows the quorum and gives each guardian an *Approve the release* button (gas-free through the relayer, one per guardian at a time); over MCP, `pusaka_set_guardians` (needs `PUSAKA_ALLOW_OUTFLOWS` and the person's yes) and `pusaka_approve_release`. Tests `gd1`–`gd10`.

**When things go wrong:**

| Case | What happens |
|---|---|
| Holder is alive but offline (travel, hospital) | Nothing moves until the full silence has passed; one gas-free `still_here` from any device, or any action on the Pusaka, restarts it. Pick a silence longer than any planned absence. |
| Holder loses their NEAR key | The heir is their recovery: after the silence, the heir claims the Pusaka and everything it holds. Without an heir, it is lost like any NEAR account. |
| Heir loses their key, or dies | Nothing breaks: the holder names a new heir (`set_heir`) or removes them; until the silence passes, an heir can do nothing. |
| Hostile heir | They can only claim after the holder's silence; before that every claim is refused (`h1_heir_claims_only_after_the_silence`; someone else never can: `h3_nobody_else_claims`). The holder can replace or remove them at any time. |
| Heir's key is stolen | The thief is in the heir's place: they can claim only after the silence. The holder replaces the heir (`set_heir`) and the stolen key is useless. |
| Holder sells or lends | A sale clears the will; a funded loan blocks the claim, so the lender is paid or takes the collateral first. |
| Relayer is down or refuses | `still_here` and `claim_inheritance` are ordinary contract calls: the app falls back to the wallet paying the gas. |
| Our servers disappear | The rules are in the contract (`heir_of`, `claim_inheritance`); any NEAR wallet or CLI can call them, no app needed. |
| A guardian loses their key | The others still make the quorum when `threshold` < number of guardians (pick 2 of 3, not 3 of 3); the holder can replace guardians any time. If too many are lost and the holder is gone, the **backstop** applies: the heir claims alone after three silences (`gd9_backstop_when_the_guardians_never_answer`). The will is slower, never stuck. |
| A hostile guardian | They can't take anything: an approval only releases the Pusaka to the heir the holder named. They can't approve while the holder is around (`gd4`), a stranger can't approve at all (`gd5`), and a hostile minority can't release it (the threshold); refusing to approve only delays the heir until the backstop. |
| Guardians collude with the heir while the holder is alive but away | They still have to wait out the full silence first, then the release waits another `RELEASE_WAIT_MS`, and one sign of life from the holder in that time voids every approval (`gd8_the_holder_showing_up_voids_every_approval`); a claim inside the waiting period is refused (`gd7`). |

**Verified live (4 Nov 2026, `node scripts/heir.mjs pusaka-buyer.testnet pusaka-seller.testnet 2 --give-back`):** the holder named an heir with a 10-minute silence; the heir's early claim was refused; the holder [checked in gas-free](https://testnet.near.rocks/tx/BvrzBTo5Ej9bVaw7MhDi3LWx2WYSXJkD9MLD13gmSxa), restarting the clock; after 10 minutes of silence a claim by anyone else was refused and the heir [claimed Pusaka #2 gas-free](https://testnet.near.rocks/tx/DzHQ4456hRkbJxTBRHDJCJ2C8PhXto5T7AgF33zSD3Dn) (history: `HeirSet → StillHere → Inherited`, the Mintbase approval cleared). Deployed at the time: CI's reproducible build of `d90dd3c` (sha256 `fd640732…`, [Ab5153Lm…](https://testnet.near.rocks/tx/Ab5153LmmM4gztjdRqqA1ccwAorCpVTm4k288nXdsb9g)). **Through the web app with a real wallet** (Intear, driven by Playwright: `web/e2e/wallet-qa.mjs`): the holder named an heir, checked in [gas-free](https://testnet.near.rocks/tx/4e2eVr3xLfCrEatxVnYEBcAw9FxxwXXCf4aJKcew2rrQ), checked in again inside the relayer's window with one paid prompt, removed and re-named the heir; after 10 minutes of silence the heir connected and pressed *Claim inheritance*, [relayed gas-free](https://testnet.near.rocks/tx/9ky2ifykN8BppSFr2mEahEXExpZqVveADWeDc1wfBQS7). This run found and fixed three UI bugs: a double wallet prompt when the free check-in was used up, the free/paid choice being made at page load instead of at click, and the result message appearing before the page refreshed. Re-run on the current build (`da6e39f`, where any holder action counts as proof of life): the relayer refused a second free check-in within a tenth of the silence, then [relayed one](https://testnet.near.rocks/tx/6gcNCKkSP9XZpurWXsxoqSX882v9YB8WjSRAAhRwxfcV) a minute later, and the heir [claimed again](https://testnet.near.rocks/tx/4JXv66X9jJ735QyVQSywV8JCeRMKUihnnYJyJXvNF6bu).

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

## One NFT, many wallets: how control passes on transfer

| Inside a Pusaka | Key (NEAR MPC) | Withdraw method | What a buyer counts as safe |
|---|---|---|---|
| Bitcoin (P2WPKH) | secp256k1, domain 0, path `pusaka-N` | `withdraw` | proven by the light client and never signed for (`verified_sats`) |
| ETH + USDC on Ethereum, Base, Arbitrum (Sepolia testnets here) | same secp256k1 key | `withdraw_eth` (`erc20` for USDC) | balance once the chain's nonce reached `eth_nonce_floor` |
| SOL (devnet here) | Ed25519, domain 1, same path | `withdraw_sol` | balance 3 minutes after the last SOL signature (a signature dies with its blockhash) |
| Its own NEAR account (implicit account = hex of the Ed25519 key) | same Ed25519 key | `withdraw_near` | balance once the access-key nonce reached `near_nonce_floor` |
| A sealed letter for the next holder (first version; the CKD letter below needs no server key) | AES-256-GCM, server key | `set_letter` + `/api/holder` | travels in `metadata.extra`; opens for the current holder only |

**How control passes.** None of these keys exists anywhere as a private key. The MPC network signs for path `pusaka-N`
only when *this contract* asks, and the contract asks only when the *current NFT owner* calls a withdraw method. So the
moment `nft_transfer`, `buy`, `nft_transfer_payout` or `claim_collateral` changes the owner, every asset above answers
to the new owner and the old one has nothing left to sign with.

**What stops the old owner from keeping access.** Signatures made before the sale are the only thing a seller could
keep, so each asset tracks them and a buyer's view leaves them out (BTC: outpoint registry; EVM: nonce floor per chain;
NEAR: nonce floor; SOL: blockhash expiry). Any signature requested after a buyer looked fails the purchase
(`expected_sign_epoch`). For the NEAR account the contract signs **only `Transfer` actions**: never `AddKey`,
`DeleteKey` or a function call, so no second key can be planted. The holder room checks ownership on every request,
so a seller's signed-in session stops working the moment the NFT moves. The full list is in the threat model below.

## Pusaka v2: the NFT owns an account, has a name, and can be locked with a post-quantum key

The contract above (`pusaka-btc.testnet`) is final: no keys, upgrades renounced, nobody can change it. The next
features need new contract code, so they run in a second deployment, **[`pusaka-v2.testnet`](https://testnet.near.rocks/account/pusaka-v2.testnet)**.
It is the same contract plus `contract/src/v2.rs`. Upgrades go through the DAO (`pusaka-council.sputnikv2.testnet`,
2 of 3 votes, our own accounts) and a 10-minute timelock (`deployments/testnet-v2.json`). **Until 13 Nov the account
also still has its deploy key**, so until then the team could change v2 directly; it is deleted on 13 Nov, after the
last fix, and `verify.mjs` reports it until then.

**The NFT owns an account (NEP-616 deterministic accounts + NEP-591 global contracts).**
- Every v2 token has its own NEAR account, `0s…`, whose address is fixed by its content: the
  [`token-account`](token-account/src/lib.rs) contract plus `{nft: pusaka-v2.testnet, token_id}`.
- `account_of(token_id)` gives the address before the account exists, so anyone can fund it early. `open_account` creates it.
- The account has **no access keys**. It runs `token-account`, which was published once as a global contract **by hash**, so
  its code can't change. It obeys only Pusaka, and Pusaka forwards a call (`account_call`) only from the current holder.
- `account_call` also requires the token to be free: not listed, pledged, approved or signing. So a seller can't empty
  the account between listing and sale, the known weakness of ERC-6551 token-bound accounts.
- Each call bumps the sign epoch, so a buyer who looked before must look again.
- When the NFT changes hands, the same account answers to the new holder.

**A name (F7).** `name_account` gives the same NFT a readable alias, `t<id>.pusaka-v2.testnet`. It runs the same
global contract under the same rules. A real top-level name (no dot) is impossible on NEAR: only the `registrar`
account can create names under 65 characters.

**Post-quantum lock (NEP-645, ML-DSA-65).**
- The holder can register an ML-DSA-65 public key with `set_pq_key`.
- From then on, every owner action (transfer, approve, list, withdraw, account calls…) needs a fresh `pq_unlock`. That is a
  signature over `pusaka-pq-unlock:<contract>:<id>:<holder>:<nonce>`, verified **on-chain by `env::ml_dsa_verify`**
  (3.5 TGas), and it opens owner actions for about 2 minutes.
- Nonces only go up, so an unlock can't be replayed. The key is cleared when the NFT changes hands.
- So a NEAR key broken by a quantum computer alone can't move or drain a Pusaka.
- What it does **not** cover: the Bitcoin, EVM and Solana keys are NEAR MPC keys (secp256k1/Ed25519), and the letter keys come
  from CKD (BLS). NEAR's MPC network has no post-quantum scheme yet, and Bitcoin's BIP-360 (P2MR) is still a draft.

**Live on testnet (`node scripts/v2-live.mjs`, Pusaka v2 #4, 9 Nov):**

| Step | Transaction |
|---|---|
| `open_account` created `0s19e851e4c54d38d9b35f1d6714fa4826d89b4919` (global code `3xLVdgZA…`, no keys) | [8Saz4ANr…](https://testnet.near.rocks/tx/8Saz4ANrd6EdAvPBDAhmGSHXF3gRswFuAfK8WrqiHGEK) |
| The holder had the NFT's account send 0.05 NEAR | [Cm27BpRs…](https://testnet.near.rocks/tx/Cm27BpRs25Gf9wRwCDVeeu4WKCd5N4Wuek8eLGifEH18) |
| A stranger tried the same: `NotOwner` | [FFhaXCx2…](https://testnet.near.rocks/tx/FFhaXCx2hJGo6m4QFmdWsWqvXCa6ETQr66ZrMEGzb4LQ) |
| `name_account` created `t4.pusaka-v2.testnet`, then it sent NEAR | [GNhGKvA4…](https://testnet.near.rocks/tx/GNhGKvA4CV46U3h8npEpNEVH2t9qbH7jK6bqVTM7WzNp), [GAa1owK5…](https://testnet.near.rocks/tx/GAa1owK5dZ79Dw3nroR9ToGRpXNbn4aJJjS3Vt7xGGKi) |
| ML-DSA-65 key registered | [3dSmxLeD…](https://testnet.near.rocks/tx/3dSmxLeDLbcuXUF5RbszHRkp7iR2uxudHGFbHnEdHDQ7) |
| The holder's own call without an unlock: `PqLocked` | [E9G6YzUz…](https://testnet.near.rocks/tx/E9G6YzUzhwzVPFaQ1RZRwCJDnttsDuyK3yd3kVnhex7d) |
| An unlock signed with another ML-DSA key: `PqBadSignature` | [6zipnudy…](https://testnet.near.rocks/tx/6zipnudyTvxpAWbfLoommKs4TYVJnDT9trSKzib8ENFv) |
| A valid unlock, verified on-chain | [H2WfjSoV…](https://testnet.near.rocks/tx/H2WfjSoVhqzA3EHyHg35Ljk88wWX3KAjxVf8ASavLdmv) |
| The holder's call now passes | [7w6zdtPZ…](https://testnet.near.rocks/tx/7w6zdtPZ4XVmA3VXQq2fYy6JUpbtapFwKZaHv5bqunAs) |
| The same unlock replayed: refused | [BXM1HqBG…](https://testnet.near.rocks/tx/BXM1HqBGMBRT4zv8KMYcsQskid51uYpKbxwX8r8QEMh) |
| NFT transferred (PQ key cleared) | [AUe4rAaW…](https://testnet.near.rocks/tx/AUe4rAaW9S5dbWxACtjLWvUwEv2garpsynUwNGjYnA3C) |
| The new holder uses the same account | [36RLmrAL…](https://testnet.near.rocks/tx/36RLmrALsb8NYmPJqeNNh5BucVb1Ud6tkCjQtWeF3y9y) |
| The old holder tries: `NotOwner` | [FF9c2dPy…](https://testnet.near.rocks/tx/FF9c2dPyjZtXKja7VfgeGGeoee9LiwaBYE5aDezYqT8K) |

Tests: 84 v2 unit tests in `contract/src/tests.rs` (`v2_tests`, `v2_review_fixes`, `f8_agent`, `f9_sign_in`, `v2_11_nested`, `f10_f13`), with real ML-DSA-65 keys and signatures from
`@noble/post-quantum` (`scripts/pq-fixture.mjs`), and 3 in `token-account/`.

**Upgraded through the DAO, as designed (9 Nov).** A security review of v2 found three holes, fixed with tests:
- a reverted `nft_transfer_call` cleared the holder's PQ key (now it stays);
- approvals made before the PQ key could still move the token (now `set_pq_key` requires no approvals);
- `account_call` is async, so the token could be listed while a call was in flight (now it holds the sign lock until its callback).

The fixed build (sha256 `4dd2473b…fab849`) went through the upgrade path: proposal 8 on `pusaka-council.sputnikv2.testnet`
(2 of 3 votes) announced it, and after the 10-minute timelock `apply_upgrade` deployed it
([C2Dgr5iW…](https://testnet.near.rocks/tx/C2Dgr5iW4wX41XfXFMagCgn3Jzj5jE1ji4RfYKaWC1v3)); the account's code hash is now
`6EnN75u5…`, the base58 of that sha256.

A second automated review then caught a narrower race: a callback arriving after `unlock_stale` could free a newer
lock. `on_account_call` now frees only the lock its own call set (tagged with the block height; regression test
`a_late_callback_leaves_a_newer_lock_alone`), and the web page no longer keeps the ML-DSA seed in browser storage.
Same path again: proposal 9 (2 of 3), timelock, `apply_upgrade`
([DbaTmJfi…](https://testnet.near.rocks/tx/DbaTmJfisAmDZWUd4NeUZfG4LvchNLUP6FRbLeXDMzv5)), sha256 `d6c183da…788741`.

**Through the web app with a real wallet** (Intear, `web/e2e/wallet-qa.mjs v2`, 9 Nov): Pusaka v2 #6 was minted on
[`#/v2`](https://pusaka-two.vercel.app/#/v2), its account created and funded, NEAR sent from it, an ML-DSA-65 key
generated in the browser, downloaded and registered, then an unlock signed in the page and verified on-chain
([5s1ew31N…](https://testnet.near.rocks/tx/5s1ew31NnoG3rrrVoak4v5StTZEAhgS571AxyhyRQoVW)). A second run (#7) pasted the key back from the file (the page keeps no copy), unlocked, and turned the lock off
([BhhLV72u…](https://testnet.near.rocks/tx/BhhLV72uQVs4Cn4B6RJSCxFfmwvohnYwGeDzGwREeE9C)), which itself needs a fresh unlock.

**The whole app runs on v2 too.** [`?contract=pusaka-v2.testnet`](https://pusaka-two.vercel.app/?contract=pusaka-v2.testnet#/market)
opens every page (Bitcoin address, sale, loans, heir) on the v2 contract; only that allowlisted sibling is accepted. Free
relayed gas and the holder room serve the original contract, so they are off there. A v2 sale, live: #7 listed
([4k352mCY…](https://testnet.near.rocks/tx/4k352mCYEqzNbG7LfNQsrrXiPhiCmzKAonC52oHNJSv9)) and bought
([DFTiRPwq…](https://testnet.near.rocks/tx/DFTiRPwq7NnQSTKitpF2kLxsmYfsQuh1tWBDKezHKHTH)); its `0s…` account now answers to the buyer.

**An AI agent with a budget the contract enforces (F8).** Agents that spend for you usually get a key, or a cap kept in
their own software; either way a hacked agent can spend everything. Here the holder sets the cap on-chain:
- `set_agent(token_id, agent, daily, to)` lets one account send NEAR from the NFT's `0s…` account, at most `daily` per UTC
  day, only to the accounts in `to` (up to 5; empty = anyone). `daily: null` revokes.
- `agent_send` is checked by the contract: within today's budget, to a listed account, only while the Pusaka is free
  (not listed, pledged, approved or signing), and it bumps the sign epoch like any outflow.
- Revoking and re-granting can't reset today's spending, and the budget ends when the NFT changes hands. `agent_of` shows
  what is left today.
- Over MCP: `pusaka_set_agent` (holder) and `pusaka_agent_send` (agent); on [`#/v2/7`](https://pusaka-two.vercel.app/#/v2/7) an
  *Agent budget* section, with a send form for the named agent.

Live (`node mcp/v2-budget-agent.mjs pusaka-seller.testnet 7 pusaka-buyer.testnet pusaka-admin.testnet pusaka-s-mw5sfoai.testnet`,
10 Nov), two MCP agents on Pusaka v2 #7:

| Step | Transaction |
|---|---|
| The holder gave the agent 0.02 NEAR a day, payable only to `pusaka-admin.testnet` | [Bw72BKuv…](https://testnet.near.rocks/tx/Bw72BKuv66YMKZrdNKGUyHFcPtCGQssQUiKGD5o3X4De) |
| The agent paid 0.01 NEAR from the NFT's account | [AFXNLUEp…](https://testnet.near.rocks/tx/AFXNLUEp6mCgyqTAyFQHHT2ev1qwMtjnPELSzUWPk5rr) |
| 0.02 more: `AgentBudget: 0.01 NEAR left today` | [2BCCn66q…](https://testnet.near.rocks/tx/2BCCn66qkUs3DekKoKXEs5mwRX6vrtQwYTGkRtibbgiv) |
| To an account not on the list: `AgentReceiver` | [D1UJy78q…](https://testnet.near.rocks/tx/D1UJy78qUwm5eL1qU2cP7FJ2GuD1x9E2WFA1zM1x3CZ2) |
| A stranger posing as the agent: `NotAgent` | [D9p7ALS3…](https://testnet.near.rocks/tx/D9p7ALS3XJim5Jt7HhDTdrDXhJhuHwRfkNb4gcmbhSKm) |
| The holder revoked it | [8HwxFhzR…](https://testnet.near.rocks/tx/8HwxFhzRFEEqBfi5wQRaTksNNFsdzNAcywhrQVpGL9z1) |
| The agent tried again: `NoAgent` | [7fyVPGUs…](https://testnet.near.rocks/tx/7fyVPGUskcnXnAE3Kmj2EVUg31DVTwtfXuucEpxGDuqo) |

It went in the same way as the fixes: DAO proposal 10 (2 of 3), the 10-minute timelock, `apply_upgrade`
([GLiiH86J…](https://testnet.near.rocks/tx/GLiiH86JNick5MPpyh4sHudQJPsQDuKQABvnUM2pS92c)), sha256 `86180591…777d12`. Tests
`f8_*` (9), one of which caught a bug before deploy: revoking and re-granting used to reset the day's budget.
`PUSAKA_CONTRACT=pusaka-v2.testnet node scripts/v2-refusals.mjs pusaka-seller.testnet 7 pusaka-buyer.testnet pusaka-s-mw5sfoai.testnet`
lists #7 and has the seller and its agent try to empty the NFT's account (both `Listed`:
[HWZUy4y3…](https://testnet.near.rocks/tx/HWZUy4y3KyXmLzMZ4KCG5wyJmM8LDrnFhaLaMVt9gmnz),
[CTzsoRZf…](https://testnet.near.rocks/tx/CTzsoRZfZDc3KPxYstgrY8PfVy4YvkabCjDVVsmF1hVd)), the drain-before-sale that
ERC-6551 accounts allow.

**Sign in as the NFT (F9).** `sign_in(token_id, domain, uri, chain_id, nonce)` has the NFT's own EVM key, the NEAR MPC
secp256k1 key that also holds its Bitcoin, sign a standard [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)
"Sign-In with Ethereum" message: *"Sign in as Pusaka #7 (pusaka-v2.testnet), held by pusaka-seller.testnet"*, valid for an
hour. Any SIWE site checks it with its usual library and sees the NFT's address as the user. So whatever that address
holds, or whatever a site lets it into, goes to the next holder with the NFT. Only the current holder can ask for one.
The contract writes the text from checked fields, so it can only ever be a sign-in, never a transaction or a NEAR Intents
payload. On [`#/v2/7`](https://pusaka-two.vercel.app/#/v2/7) the holder clicks *Sign in to pusaka-two.vercel.app as
Pusaka v2 #7*; over MCP, `pusaka_sign_in`. Live (`node scripts/v2-sign-in.mjs pusaka-seller.testnet 7 pusaka-s-mw5sfoai.testnet`,
10 Nov): signed in as `0x2814…580a`, checked by viem's `parseSiweMessage`, `validateSiweMessage` and signature
recovery ([BBN85r1K…](https://testnet.near.rocks/tx/BBN85r1KGr4A7kxgzQGgrDbHWs8CSDuPBrwCjDmWFVaU)); a stranger
refused, `NotOwner` ([3Xfwhfud…](https://testnet.near.rocks/tx/3XfwhfudVHo2kzYDV6xv5fkpV9rr1W69hFdp7LFb784p)).
A sign-in *message* can't outlive a sale: it is refused while the Pusaka is listed, pledged or approved to a market, and while
one is valid (`signed_in_until`) nothing a counterparty pays for can start: no listing, market approval,
`nft_transfer_call` (markets, NEAR Intents) or loan (`SignedIn`, live: a listing
[2Bc5HUNU…](https://testnet.near.rocks/tx/2Bc5HUNUrbNkT4fux6nBJ3BzG7wZxu1qMbeL51DrSZGT) and a deposit into the Intents
verifier [65pQSqHL…](https://testnet.near.rocks/tx/65pQSqHLy1HTJ5KNRHS9sh2w88Wvocka51mCJMc5VVq8)). The record outlives a transfer,
so handing the NFT to a second account first doesn't clear it. Automated security reviews of proposals 11 and 12 each
found a way around the earlier version; the fixes went in as DAO proposals 12 and 13. **What this doesn't cover:** a
site that accepts the message may give the old holder a session that lasts longer than the hour, and the contract can't
see or end it. So treat a sign-in as a login for sites that check it each time, not as a lasting right that changes hands.
V2-9/V2-11 below are now an allowlist of methods, so no method name can slip through; the cost is that the NFT's
account only moves assets and no longer calls arbitrary contracts.

**The NFT holds a NEAR Intents balance.** Anyone can deposit into NEAR Intents for the NFT's `0s…` account
(`ft_transfer_call` to the verifier with `msg` = the account). That balance belongs to whoever holds the NFT: the holder
moves it through `account_call` (`ft_withdraw`, `mt_transfer`), and after a transfer only the new holder can. Live
(`node scripts/v2-intents-balance.mjs pusaka-s-mw5sfoai.testnet 5 pusaka-buyer.testnet 1`, 10 Nov), on Tidepool's
unmodified `defuse` verifier:

| Step | Transaction |
|---|---|
| Pusaka v2 #5's account holds 5 USDC in NEAR Intents | [2bh6iEj8…](https://testnet.near.rocks/tx/2bh6iEj8N3A6zjuZ9kskQn8DKFVv98djhXPp7DyCHSdU) |
| The holder transferred the NFT (after a post-quantum unlock: #5 is locked) | [8kdA8CDT…](https://testnet.near.rocks/tx/8kdA8CDTnTUknerNrGTsn8a95rYe8oRFLDCiyhk2s2oW) |
| The previous holder tried to move the balance: `NotOwner` | [Pjvg5Uxa…](https://testnet.near.rocks/tx/Pjvg5Uxab6mjouQtkShBzxWzeheQJ4FrF6cRMB6fBGu) |
| The new holder withdrew 2.5 USDC of it; 2.5 stay with the NFT | [FvuNSTaZ…](https://testnet.near.rocks/tx/FvuNSTaZ7sq12Nw5MTu8B5Dt8YVx3BJUPYXLyVACWsG) |
| Through the web app with a real wallet (Intear, `web/e2e/wallet-qa.mjs <profile> v2-signin pusaka-buyer.testnet 5`): the new holder signed in as #5 | [E9KrdiX8…](https://testnet.near.rocks/tx/E9KrdiX8D2jWrkyupoYk5hCvRd1RzaJ6Cusj7CqWo2f1) |
| …and clicked *Withdraw its Intents USDC to me*: the other 2.5 USDC | [BVCLTuf9…](https://testnet.near.rocks/tx/BVCLTuf9VJF22x7S1P1BYN8pPTS9EnDHxH3eCetKXy9Z) |

**A hole this closed (V2-9).** A right the NFT's account grants somewhere else would outlive a sale. Example: the holder
has the account register *their own* signing key on the Intents verifier (`add_public_key`), sells, and later signs
intents that empty the balance the buyer paid for. NFT approvals and allowances work the same way. `account_call`
refuses it (`AccountGrant`, [5VxydhLQ…](https://testnet.near.rocks/tx/5VxydhLQSPDmQXjAyiGV5Lu2RvK1dLmuMQC9RxV7HVMR)).
It started as a list of refused method names; since proposal 15 it is an allowlist (below).
F9 and this fix went in through DAO proposal 11 and the timelock, `apply_upgrade`
([Eqimmrz6…](https://testnet.near.rocks/tx/Eqimmrz6sg31CBsCr1Y4wjut96y3yHawx71UZ3uNhogN)), sha256 `c786e1e6…d4f838`;
tests `f9_*`, `v2_9_*` and `v2_10_*` (15). Proposal 12 ([FcFuQZVq…](https://testnet.near.rocks/tx/FcFuQZVqV7zKuSJvBsUwLcFcXxE2YGZ6J9rhFa9gAp3q),
sha256 `0c66a94f…b4eaf6`) and 13 (sha256 `8c66134f…6f573b`) added the sign-in gate above.

**A hole an adversarial review found (V2-11).** The NFT's account can hold *another* Pusaka, so a buyer of A also
buys B and its Bitcoin. Before the fix, the seller could have A's account put a standing order on B (a gift link, a
listing, a loan request, an heir, an agent budget) through `account_call`, sell A, and then take B with that order.
None of those method names matched V2-9's list. Now the NFT's account can only `nft_transfer` a Pusaka it holds,
never commit it (`AccountGrant`, live [FC3P4S5y…](https://testnet.near.rocks/tx/FC3P4S5yFgkJgDy8Kt4qZaSAzfJmVpRqsEspzgLxssb5)).
The same review also led to: `auth` methods refused (switching off the Intents verifier's predecessor auth would
freeze the NFT's Intents balance), no transfer of a Pusaka into its own account (it could never move again), the
agent budget cleared on `nft_transfer_call`, and no underflow after lowering a budget. DAO proposal 14
([8ufh43d1…](https://testnet.near.rocks/tx/8ufh43d13htBmG1MzfCfRzQ3SHYGFeGgLU79uP6fyGi4), sha256 `d3972d98…775edf`),
tests `v2_11_*` (12).

An automated review of proposal 14 found two ways around it, both closed by DAO proposal 15 ([HegurWNt…](https://testnet.near.rocks/tx/HegurWNt3j2z2mGBoZpwu3tBeYPNKDPXo7q1KC81RQh9), sha256 `5f9bb600…3124c5`; live: a gift link on a v1 Pusaka through #7's account refused, [86Mib8Do…](https://testnet.near.rocks/tx/86Mib8DoggMZUchWQGdRsraT79qhSyjxixt15G7CizfN)):
- The NFT's account could hold a Pusaka from *another* contract (v1, or any NFT) and put an order on it there. Now
  `account_call` takes an **allowlist** of methods, whatever the receiver: plain NEAR, `ft_transfer(_call)`,
  `nft_transfer`, `mt_(batch_)transfer`, the Intents withdrawals (`ft_/nft_/mt_withdraw`), `storage_deposit`, wNEAR
  and staking (`deposit_and_stake`, `unstake`, `withdraw_all`). It moves assets, at once; it can't leave anything behind.
- A Pusaka with a live sign-in could be tucked into another Pusaka's account and sold with it. `nft_transfer` into any
  `0s…` or `t<id>.` account now waits until the sign-in expires.

**Prove the NFT's Bitcoin address (F10, BIP-322).** `sign_btc_message(token_id, message)` has the NFT's Bitcoin key
sign a [BIP-322](https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki) "simple" proof that it controls the
Pusaka's address, over the message prefixed by the contract with the token, the holder and the NEAR block. The contract
builds the virtual `to_spend`/`to_sign` transactions itself (their input is the null outpoint, so the signature can't
move coins), and both its Rust and an independent JS implementation (`shared/bip322.mjs`) match the BIP's test vectors
and verify the BIP's own signatures. Live on v2 #7 (`node scripts/v2-bitcoin.mjs proof …`): address
`tb1qcdht6dpuqn432r6f299hpgydk9nmnu6yggr6gp`, signature `smpAkcwRAIgF7WJIc7…`, verified [HQxhbrsH…](https://testnet.near.rocks/tx/HQxhbrsHtBd9FmR8kuBNcCwt8KJKjyqcGjihcLMuVwdJ);
a stranger refused [GarJPgkm…](https://testnet.near.rocks/tx/GarJPgkmv8yRJDRXkfeayPAFBYucije11aCzdaQA5SPE). On `#/v2/<id>`: *Sign a BIP-322 proof*; over MCP: `pusaka_prove_btc_address`.

**Rent its use (F11, ERC-4907's "user").** `set_user(token_id, user, expires_ms)` lets a renter sign in as the NFT
(F9) until the rental ends, without being able to move it or anything it holds; it ends when the NFT changes hands.
Live: rented [3HHrfrMG…](https://testnet.near.rocks/tx/3HHrfrMGGQvWkXAPDseJ1LLZtJ5b5UDHHk2yzTobAzjc), the renter signed in, "held by pusaka-seller.testnet, used by
pusaka-buyer.testnet (rented)" [EL3EAuYc…](https://testnet.near.rocks/tx/EL3EAuYcfbb1Gkjx659mY2E7aZJ1d3NwNdJZMP7GLNDm); a stranger refused [AFL1aSPJ…](https://testnet.near.rocks/tx/AFL1aSPJCJRNPHAS92TfHx1PLw2B9wXgixUUMScEsX3f); the
renter's attempt to list it refused [DpkwLCoP…](https://testnet.near.rocks/tx/DpkwLCoPfPq3eTZmLcCf1siZ8sRqgtnPwpzTrXGvoxmK); rental ended [ALKpE13X…](https://testnet.near.rocks/tx/ALKpE13XdFaR3YbYiVFT9CP8FWadkWNvu7Riwm1doThW).

**Buy a Pusaka with native Bitcoin (F12).** A Bitcoiner shouldn't need NEAR tokens to buy one. `list_for_btc(token_id,
price_sats, pay_to_script)` locks the Pusaka like a listing. A buyer calls `reserve_btc_purchase` (0.1 NEAR bond, back on
purchase; 6 h to pay, then 6 more for the payment to be proven, during which nobody else can reserve and the seller can't
cancel), so two buyers can never pay for the same sale, and gets the OP_RETURN their payment must carry:
`sha256("pusaka-buy:<contract>:<token>:<buyer>:<nonce>")[..20]`, where the nonce never repeats for a token, so an old
payment can't buy it again after a resale. They pay on Bitcoin; anyone then calls
`prove_btc_purchase` with the transaction and its merkle proof; the contract checks the output to the seller and the
OP_RETURN, asks NEAR's Bitcoin light client to confirm inclusion, and hands the NFT to the buyer. An heir's claim waits
while a reserved buyer may already have paid. Live on v2 #5, 5,000 sats paid to the seller's own Pusaka #1 address:
listed [5opmjDCS…](https://testnet.near.rocks/tx/5opmjDCSBv7TgLYyF3NJVjw2WSCJsRKQCrqxA5T486D1) (relisting refused, `Listed` [2EJXR7nx…](https://testnet.near.rocks/tx/2EJXR7nxbyTmCYwMzUeyHnHtdMeaGKeQNPzpwViiSdmo)), reserved
[88dqPFrR…](https://testnet.near.rocks/tx/88dqPFrRYTjhd8yKahC5rYF7mW7jqdx2EHUiQTmstVQu), and a payment carrying another reservation's OP_RETURN refused before any light-client
call [CVmWWhPF…](https://testnet.near.rocks/tx/CVmWWhPFKMtsjuaj8aPMYxRZdx7D2pjZ8UiRSrM2QSXq). **Not yet done live:** the Bitcoin payment itself. Our ISP hijacks DNS for
blockstream.info and times out mempool.space, so from here we can neither broadcast nor fetch the merkle proof; the
proof path is the same light-client call as `prove_deposit` (live since 3 Nov) and is covered by tests `f12_*` (17).
Anyone with testnet3 BTC can finish it: reserve on `#/v2/5`, pay, prove.

**Proof of reserves as a contract view (F13).** `reserves(from_index, limit)` returns every Pusaka's verified sats and
the total, for other contracts and dashboards; the web app's [`#/reserves`](https://pusaka-two.vercel.app/#/reserves)
lists every address with an in-browser re-check of each one.

F10–F13 went in through DAO proposal 16 ([3DovJDZi…](https://testnet.near.rocks/tx/3DovJDZiNTC9Ydt27dTkJzQ9BH6JdWdZ9tb3ksPRpdDk), sha256 `56895764…0c2df6`), tests `f10_*`–`f13_*` (28).
An automated security review of proposal 16 found two holes in F12, both closed by proposal 17 ([AtRLSQVr…](https://testnet.near.rocks/tx/AtRLSQVrss2iXNe78KxiZQfxgy1k9MYXXey3AzjHujYM), sha256 `ddf231e3…fcaf4`):
the reservation nonce restarted with each listing, so a buyer could replay an old payment after a resale to the same
address; and a buyer who had paid but whose proof came after the 6 hours could lose the sale to a new reservation.
A review of proposal 17 added proposal 18 ([5PTEL1TR…](https://testnet.near.rocks/tx/5PTEL1TRmP64pzBLTx9wqLcjXbNsWPYkRQSuMJVzpzNk), sha256 `fec63dcf…a733d6`): a Bitcoin txid that bought a Pusaka is spent for
good (a reservation made before the per-token counter could otherwise see its nonce come round again), and the
hand-over checks the seller still holds the NFT, returning the bond instead of failing halfway.

Costs on testnet:
- Publishing `token-account` (43,453 bytes) burned 4.35 NEAR, once.
- A token's `0s` account is a zero-balance account (203 bytes).
- The alias needs 0.02 NEAR.

## Bids per verified sat, and loans with no due date (a second market contract)

[`pusaka-market.testnet`](https://testnet.near.rocks/account/pusaka-market.testnet) (`market/`, 40 tests) works with
any Pusaka through the NFT standards, so the original contract, whose code is final, needed no change. Open
[`#/bids`](https://pusaka-two.vercel.app/#/bids).
- **Standing bids priced per verified sat** (the pattern of Blur's collection bids). A bidder escrows NEAR for "any
  Pusaka holding 1,000–20,000 sats at 0.3 NEAR per 10,000". A holder sells into it with `nft_approve(market, {bid_id})`.
  The market then reads the token's `verified_sats` on-chain and pays exactly sats × price through NEP-199 payouts
  (royalties included). An approved Pusaka can't withdraw, so its sats can't drop between that read and the sale.
  Every Pusaka gets an instant exit priced by what is provably inside.
- **Perpetual callable loans** (the design of Paradigm and Blur's Blend). There is no due date. A lender who wants out
  calls the loan, and a rate auction rises from 0% for 30 minutes; another lender takes it over at the rate they accept,
  paying the first in full. If nobody does, the first lender takes the Pusaka. The market holds the NFT meanwhile and
  never asks for a signature, so its Bitcoin can't move.

Live (`node scripts/market-live.mjs …`, 10 Nov):

| Step | Transaction |
|---|---|
| Deployed (the account's key goes on 13 Nov, with v2's) | [6uG46TDQ…](https://testnet.near.rocks/tx/6uG46TDQgFwFEPdh9VrJMsDQ4Q3fhuQ1cMHZzJQV87rJ) |
| A bid for more sats than #15 holds: the market read 10,000 and refused it (`SatsOutOfRange`); the NFT stayed | [Bv3LX3M5…](https://testnet.near.rocks/tx/Bv3LX3M5xmpy7DESrQTHdstJgfBHTZqUVYZPxpm3wjjg) |
| #15 (10,000 verified sats) sold into a 0.3 NEAR-per-10k bid | [5rApe8UQ…](https://testnet.near.rocks/tx/5rApe8UQKNdLxYV6TSdES93jxJHyZ92hG8KmvaPPsF6G) |
| A perpetual loan: 0.2 NEAR at 20 %/yr against #15, which the market now holds | [BnPTxN47…](https://testnet.near.rocks/tx/BnPTxN47k5niWYF5h7xrUThoCtGSZWnR7sZh3fhDHnGs) |
| The lender called it; the rate auction started at 0 % | [6ZdEwDEX…](https://testnet.near.rocks/tx/6ZdEwDEXHbvSyiVi1jg6qKwwRttxXiqqfccQhsKFmByU) |
| Five minutes in, a second lender took it over at 173.53 %/yr, paying the first in full | [5HdNhE6M…](https://testnet.near.rocks/tx/5HdNhE6MGyWe5ARJNNMDPCNobpFgjwTnUPgzGH6MR5Zr) |
| The borrower repaid; #15 came back | [Ana4Ex2w…](https://testnet.near.rocks/tx/Ana4Ex2wbZrnxw6W1eHb11q4TQgEnUHGfkLzZpfRmQvT) |

A standing bid and a loan offer are kept open for judges on `#/bids`. Over MCP: `pusaka_market_book` (read-only) and
`pusaka_sell_into_bid` (behind the outflow gate).

## Holder room: gated by the NFT

Each Pusaka page has a holder room. Opening it asks the wallet to sign a [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md)
message (no transaction, no gas). `/api/holder` checks that the signature is valid for the message, the nonce and this
site; that the key is a **full-access key** of the claimed account right now; that the message is at most 5 minutes
old; and that the account is the token's **current owner** (`nft_token`, on every request). Then it opens the token's
sealed letter.

The holder can write a letter for the next holder, sealed with a key **no server ever sees**: NEAR MPC's confidential key
derivation (CKD, domain 2 on `v1.signer-prod.testnet`, BLS12-381).

> docs.near.org's Chain Signatures page still lists only the two signing domains. The MPC contract itself runs four:
> `near view v1.signer-prod.testnet state` shows `0 CaitSith Sign`, `1 Frost Sign`, `2 ConfidentialKeyDerivation CKD`,
> `3 CaitSith ForeignTx` (source: [near/mpc](https://github.com/near/mpc)). Pusaka uses all four.

1. The browser makes a one-time BLS12-381 key and calls `letter_key(token_id, app_public_key, write_nonce)`. The contract
   checks the caller owns the token and forwards `request_app_private_key` to the MPC under the path
   `letter:<id>:<owner>:<nonce>`, a path only it builds.
2. The MPC answers with the key encrypted to the one-time key. The browser decrypts it and **verifies it against the
   MPC's public key** with a pairing check before using it (`shared/ckd.mjs`, checked against near/mpc's own test vectors
   in `shared/ckd.test.mjs`). It then seals the letter (AES-256-GCM, the token id bound as associated data) and stores it
   with `set_letter(sealed, path)`. The contract only accepts a path containing the caller's own account.
3. The next holder calls `letter_key` without a nonce. The contract asks for the key of the letter stored now, so the new
   holder gets the same key and opens it in the browser. A seller gets no key once the NFT moves (`NotOwner`), and never
   the key of a letter written after the sale, because new paths contain the new owner.

The letter lives in the token's `metadata.extra` and moves with the NFT. Writing is locked while the token is listed,
approved or collateral, so a buyer gets the letter they saw. Letters written before CKD (`v1:`) are still opened by the
server after the NEP-413 check above. **Verified live (4 Nov 2026)** with `node scripts/ckd-letter.mjs`: the writer got
its key in 6.0 s ([CoYjpGRS…](https://testnet.near.rocks/tx/CoYjpGRSmDcCaKsM35WkZ7Ts2b7oMAjVmksZGX259xW6)), the next
holder got the same key ([waBYg2Hr…](https://testnet.near.rocks/tx/waBYg2HrY5fSQWDXRig8tga59rNbqCxFYPKnd5E1nGe)) and
read the letter, and the writer was refused. Limit: CKD trusts the MPC threshold like signing does; Trail of Bits'
[review](https://new.trailofbits.com/library/near-one-confidential-key-derivation/) of NEAR's CKD applies.

**Sealed files, from the same key.** The holder room also seals any file (a seed backup, a deed, instructions for an
heir, up to 10 MB) with the Pusaka's MPC key, which only its current holder can ask the contract for. Limit, shown on
the page: that key belongs to the current letter's path (`letter:<id>:<who sealed it>:<nonce>`), and anyone who held
the Pusaka while that letter was current could have kept it. So a new holder seals a new letter first (one wallet
call, a new key from NEAR MPC); files sealed after that are closed to every earlier holder. The file key is the same MPC secret under a
second HKDF purpose (`pusaka-file-v1`), AES-256-GCM with the token id bound; the sealed file is downloaded and kept
anywhere, since nothing in it is useful without the NFT (`sealFileCkd` / `openFileCkd` in `shared/ckd.mjs`, tested in
`shared/ckd.test.mjs`). **Verified live (9 Nov 2026)** with `node scripts/ckd-file.mjs 2`: two key requests by #2's
holder ([hJtpsCeL…](https://testnet.near.rocks/tx/hJtpsCeLVEGYVH4vYn6XeEtmYgRaktT3TMhS4cnyZ7H),
[7m3knUv9…](https://testnet.near.rocks/tx/7m3knUv9T1vFgjVHNsKQUVoNEKPLPooqmbyf9DQG9qbu)) gave the same file key; a
file sealed with one opened with the other; another token, the letter key and a flipped bit were refused; a
non-holder was refused the key (`NotOwner`). Sealing a new letter changes the key, so earlier files stop opening (the
page says so).

Try it: `node scripts/holder-test.mjs` (creates two faucet accounts and mints a Pusaka, then signs NEP-413 messages: the holder gets in; a non-holder, a
stale or non-numeric timestamp, a signature made for another site, and a key presented for the wrong account are refused).
`node scripts/handover.mjs` mints a Pusaka from a fresh account, seals a letter, sells it twice and checks the 2.5% royalty and the room changing hands. Both run from a clean clone with no keys of yours: they create throwaway faucet accounts and send testnet transactions.

## Per-NFT history

The contract keeps the latest 32 events per token (`token_info.history`); the app turns them into a ledger: who held
it, what it sold for, the creator's royalties, every withdrawal the MPC signed (BTC, ETH, USDC, SOL, NEAR), and loans.
Every event is also a NEAR transaction, so the full history is on any explorer.

## Proof of reserves, badges, install

- `GET /api/reserves`: every Pusaka with its BTC address, proven deposits and `verified_sats`, read from the contract (CORS open, for agents and auditors).
- `GET /api/badge?id=N`: an SVG badge with the BTC verified inside Pusaka N, for READMEs and posts; the detail page has a *Copy badge* button.
- The app has a web manifest and icons, so it installs as an app on phones and desktops.

## Trustless balance: NEAR's Bitcoin light client

Anyone can call `prove_deposit(token_id, tx_hex, vout, block_hash, tx_index, merkle_proof, coinbase_txid, coinbase_merkle_proof)`:

1. The contract hashes `tx_hex` (non-witness serialization) to get the txid, parses output `vout` and requires it to pay this Pusaka's P2WPKH address.
2. It calls `verify_transaction_inclusion_v2` on Near-One's light client with the merkle proofs (borsh, internal byte order) and the required confirmations.
3. On `true`, the deposit is recorded. `verified_sats` = proven deposits never signed for.

Deposits under 10,000 sats aren't provable, so nobody can fill a Pusaka's registry with dust. The one exception is a withdrawal's change coming back to the Pusaka: `withdraw` records the txid of the transaction it builds (a segwit txid doesn't depend on the signatures), and output 1 of exactly that transaction counts down to 1,000 sats; the same amount from any other transaction, even one the holder's own wallet builds from the same coins, is still dust (tests `ch1`–`ch4`). The relayer proves it for free. Before this, withdrawing 1,000 of a Pusaka's 10,000 sats left the other ~8,700 unprovable forever.

The web app shows this verified amount first, offers *Prove deposit* for confirmed deposits that aren't proven yet, and the medallion's ring fills with verified BTC only.

## The NFT itself is alive

- **On-chain dynamic image.** `nft_token(s)` returns `media` as an SVG drawn by the contract (`contract/src/art.rs`) from the token's Bitcoin key: the brass ring fills with BTC *verified by the light client*, and a red seal appears while it's listed, collateral, or signing. Any NEAR wallet shows the current state, no server involved.
- **Live description:** "Holds 0.00174946 BTC verified on NEAR by the Bitcoin light client."
- **NEP-297 events:** mints emit `nft_mint` (the standard helper we first used didn't, so indexers missed the collection; `emit_mint_events` re-emitted for older tokens). Transfers, sales and loan defaults emit `nft_transfer`. Because the image and description are computed live from the verified BTC and the lock state, every change to them (a proven deposit, a listing, a loan, a signature, a sale) emits NEP-171 1.2.0 `nft_metadata_update`, so wallets and indexers know to re-fetch (`n1_mint_emits_nep297_event`, `n4_metadata_update_when_the_art_changes`). Indexed: FastNear's NFT API lists the collection for its holders, e.g. `curl https://test.api.fastnear.com/v1/account/pusaka-buyer.testnet/nft` → `pusaka-btc.testnet`. (NearBlocks' testnet indexer has not processed new blocks since 27 Sep 2026.)

## For AI agents: Pusaka over MCP

`mcp/server.mjs` is a Model Context Protocol server, so an agent (Claude, any MCP host) can do due diligence and trade on the live contract:

```json
{ "mcpServers": { "pusaka": { "command": "node", "args": ["<repo>/mcp/server.mjs"],
  "env": { "PUSAKA_ACCOUNT_ID": "agent.testnet", "PUSAKA_PRIVATE_KEY": "ed25519:…", "PUSAKA_MAX_SPEND_NEAR": "5" } } } }
```

Tools: `pusaka_overview`, `pusaka_inspect` (verified BTC, USD value, ETH safe/at-risk, listing premium, loan LTV/APR, sign epoch), `pusaka_buy`, `pusaka_fund_loan`, `pusaka_repay_loan`, `pusaka_claim_collateral`, `pusaka_list`, `pusaka_cancel_listing`, `pusaka_request_loan`, the loan market (`pusaka_loan_offers`, `pusaka_offer_loan` with a max-LTV guard, `pusaka_cancel_loan_offer`, `pusaka_accept_loan_offer`, which also refinances a funded loan with a capped top-up, `pusaka_repay_partial`, `pusaka_propose_extension`, `pusaka_accept_extension`), gift links (`pusaka_gift_link`, `pusaka_claim_gift` signed with the link's own key, `pusaka_cancel_gift`; live: `node mcp/gift-agents.mjs pusaka-buyer.testnet pusaka-seller.testnet 2`), `pusaka_prove_deposits`, `pusaka_withdraw_btc`, `pusaka_withdraw_eth` (ETH or USDC on any of its EVM chains), `pusaka_withdraw_sol`, `pusaka_withdraw_near` (its own NEAR account), `pusaka_withdraw_nbtc`, `pusaka_stake_near` (stake, unstake or withdraw at a factory validator), `pusaka_swap_to_usdc` and `pusaka_swap_status` (sell the Pusaka's BTC for USDC on NEAR through NEAR Intents, executed; testnet via Tidepool), Pusaka v2 (`PUSAKA_CONTRACT=pusaka-v2.testnet`): `pusaka_token_account` (the NFT's own account, alias and post-quantum lock), `pusaka_account_send` (NEAR out of the NFT's account), `pusaka_set_agent` / `pusaka_agent_send` (an agent's daily budget from the NFT's account, enforced by the contract; live: `node mcp/v2-budget-agent.mjs`) and `pusaka_pq_unlock` (signs the ML-DSA-65 unlock with a key from the server's environment, never the conversation; live: `node mcp/v2-agent.mjs`, the agent's send was refused until its on-chain unlock, then [7VLy5ew6…](https://testnet.near.rocks/tx/7VLy5ew65YEtB3d2aUbXuwm3Aw6YdD82QTxbGPBjAxyN)), `pusaka_sign_in` (signs in to a website as the NFT, only for domains in `PUSAKA_SIGN_IN_DOMAINS` and with the person's yes), `pusaka_give`, `pusaka_mint`, `pusaka_set_heir`, `pusaka_still_here`, `pusaka_claim_inheritance`, `pusaka_set_guardians`, `pusaka_approve_release`. An agent can move everything a Pusaka holds. **Due diligence an agent can run before trusting it with money** (read-only, also on the remote server): `pusaka_contract_trust` (deployed code sha256 and its reproducible-build source, every key on the contract account, the DAO council and threshold that can change the code, the timelock and any pending upgrade), `pusaka_audit` (an independent proof-of-reserves of one Pusaka: asks NEAR's MPC signer which key it derives for this token, recomputes the verified sats, and looks every counted deposit up on Bitcoin, including whether it is still unspent), `pusaka_history` (provenance: holders, sale prices, loans), `pusaka_credit_record` (a borrower's repaid / refinanced / defaulted loans across every Pusaka, from the contract's own history), `pusaka_loan_watch` (every funded loan with hours left, live LTV and this agent's next move), and `pusaka_gift_preview` (what a gift link holds, without claiming it). **Market and portfolio:** `pusaka_deals` scans every listing against a live, solver-signed NEAR Intents quote for selling the BTC inside, so an agent can buy Bitcoin below its exit value (on testnet every listing priced 75% under, since testnet BTC is valued at mainnet prices); `pusaka_portfolio` sums what an account holds, owes, lent, escrowed and stands to inherit. **A letter only the holder can read, written by an agent:** `pusaka_write_letter` has the contract ask NEAR's MPC network for a confidential key (CKD) and seals the text into the NFT; `pusaka_read_letter` gets the same key for the current holder only and opens it, all inside the agent's process (live: an agent sealed a letter into #2 [44aR6Y1g…](https://testnet.near.rocks/tx/44aR6Y1gpwN5fXnMCPUrbyNnSNqmiDkGcf6kTAM8oeHX) and read it back). **Not only tools:** the server also speaks MCP resources (`pusaka://contract`, `pusaka://token/{id}` for every Pusaka) and prompts (`due_diligence`, `lender_round`, `buy_btc_below_exit`), ready-made routines an MCP host can offer its user. 54 tools in all. **The person stays in charge (MCP elicitation):** when the host supports it, every NEAR spend and every outflow is put to the person first ("The agent wants to offer loan, spending 0.02 NEAR…") and nothing is signed without their yes, so a sealed letter or a listing an agent reads can't spend for them (letters come back marked `untrusted_letter`); `PUSAKA_CONFIRM=off` runs autonomous under the caps. Live: `node mcp/elicit-qa.mjs`: declined, nothing signed and the spend cap restored; approved, the offer posted and was cancelled. Every tool carries MCP annotations (`readOnlyHint` for the 14 read tools, `destructiveHint` for the 17 that can move a Pusaka or its assets away: sold, pledged, given, inherited or withdrawn) so hosts can auto-allow reads and warn before outflows. The web app's [For AI agents](https://pusaka-two.vercel.app/#/agents) page lists the endpoint's tools, prompts and resources live and asks it `pusaka_contract_trust` on load. Live: `node mcp/due-diligence.mjs 1`; a lender agent funded #13 and both agents' `pusaka_loan_watch` showed 72 h left, LTV 0.25 and each one's next move, then the borrower repaid and `pusaka_credit_record` read 9 loans, 7 repaid, 2 refinanced, 0 defaulted. **Verified live through an MCP client (4 Nov):** [ETH on Sepolia](https://sepolia.etherscan.io/tx/0xd514c72366e9aa13de1223433544563848e00f020e2b1bef0e98388b35c4e9ed), [SOL on devnet](https://explorer.solana.com/tx/4oNMntvxmefB9L2jEdcmR3UNZC8xq2y2R4zFs18rbk5GhutjKCigezYfL6oLwFS27WnH6V1Uji3CuQi7Dp7ffuqE?cluster=devnet), [NEAR from #5's own account](https://testnet.near.rocks/tx/3YxDKPdAdp9Uy3J4dCojGechY1sXygXHCawwQtTEyk1D), and `pusaka_give` moved #7; it refused a nonexistent receiver, a malformed EVM address and more SOL than the Pusaka holds.
Guard rails the agent can't talk its way around: tools that move a Pusaka or its assets out (`pusaka_give`, `pusaka_withdraw_*`) are off unless the operator sets `PUSAKA_ALLOW_OUTFLOWS=1`, optionally limited to `PUSAKA_ALLOWED_RECIPIENTS`; a per-session NEAR spend cap, `max_price_near` on buys, `max_ltv` on loans (it refuses collateral with no verified BTC), and the same sign-epoch / loan-terms binding as the web app.
**Remote, no install:** point any MCP client at `https://pusaka-two.vercel.app/api/mcp` (Streamable HTTP) for the read-only tools (`pusaka_overview`, `pusaka_inspect`, `pusaka_loan_offers`, `pusaka_deals`, `pusaka_portfolio` and the due-diligence tools above), the resources and the prompts; check it with `node mcp/remote-smoke.mjs`. Trading tools stay local so the agent's key never leaves its machine.
**Try:** `npm run smoke -w mcp` (read tools and guards) and `node mcp/trade.mjs <seller> <buyer> <id> <price>`. On testnet one agent listed Pusaka #1 for 0.3 NEAR and another bought it under a 0.35 NEAR cap.

## Gas-free actions: NEP-366 relayer

`api/relay.mjs` (Vercel function) accepts a borsh `SignedDelegate` and submits it from a relayer account that pays the gas. It only relays calls to the Pusaka contract, only `list`, `cancel_listing`, `request_loan`, `cancel_loan_request`, `claim_collateral`, `still_here`, `claim_inheritance` and `accept_loan_offer`, never with a deposit. `api/prove.mjs` proves a token's confirmed deposits through the light client with the relayer paying, which is what the web app's *Prove for free* button calls, so a visitor with no wallet can still make a deposit count.
**Can't be farmed:** the relayer only pays for calls that will succeed and can't be looped: `claim_collateral` only once the loan is overdue; `accept_loan_offer` only when the contract would take it (owner, offer fits the token and its sign epoch, nothing listed, approved or in flight, a refinance only when the offer alone pays it off), for offers of at least 0.01 NEAR, once a minute per Pusaka (`api/_relayer.test.mjs`); `list`/`cancel_listing`/`request_loan`/`cancel_loan_request` at most once a minute per Pusaka (read from its on-chain history; sooner, the app asks the wallet to pay); the same signed delegate posted twice in parallel is relayed once (409 for the copy); `still_here` once an hour; relayer-paid USDC proofs stop at 4 per Pusaka (each leaves 0.002 NEAR of storage), after which the holder proves and pays. Verified live 6 Nov: early `claim_collateral` 403, parallel duplicate 409, relist 3 s after a cancel 429.
**Borrow with no NEAR at all:** a Bitcoin holder's first NEAR can be a loan. The home page lists the standing offers (escrowed principal, yearly rate, which Pusakas qualify; `restock.mjs` keeps one open), and taking one is gas-free. **Verified with a real wallet** (Intear, `node web/e2e/wallet-qa.mjs <profile> accept pusaka-buyer.testnet 15`): one approval, the relayer signed the transaction and the 0.05 NEAR principal arrived [8Pt8bY1b…](https://testnet.near.rocks/tx/8Pt8bY1bzhHJKjiKPG3EmRtPF2dgGZQgp4WXZN3G5iBC) (signer `pusaka-relayer.testnet`, delegate from `pusaka-buyer.testnet`).
**The relayer signs with a gas key (NEP-611, live on testnet since protocol 88).** `RELAYER_PRIVATE_KEY` is a full-access gas key on `pusaka-relayer.testnet` with its own 2 NEAR gas balance and 16 independent nonce lanes (`node scripts/gas-key.mjs setup|status|burst|fund`). Gas comes out of the key's balance, not the account's, so the relayer's gas budget is a separate, visible number, and parallel relays from separate Vercel instances don't fight over one nonce: each instance starts on a random lane and near-api-js rotates through them. **Verified 6 Nov:** 12 transactions signed at the same moment all landed, one per lane; a relayed `cancel_listing` went out as a `TransactionV1` on lane 3 [4v5BwU8o…](https://testnet.near.rocks/tx/4v5BwU8o2KzS2ME6Gxqnd2iwaZ97FyFBTNn9o5U2Wi1t), and the deployed `/api/relay` relayed a `list` on lane 8 [66Gi31T5…](https://testnet.near.rocks/tx/66Gi31T5sqcT1TPP4upzxXxtrTTLaXPCGkZ9e4BBggFX) (signer key `Cz8EbYC5…`, the gas key).
**Verified on testnet** (`node scripts/relay-test.mjs <owner> <id>`): the owner signed `list` and `cancel_listing` as meta-transactions, the relayer submitted them, and the owner's balance changed by 0.000000 NEAR; a signed `buy` was refused.
The deployment needs `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` set in Vercel; without them the functions answer 503 and the app falls back to proving from the user's wallet.
In the web app, *List*, *Cancel listing*, *Ask for a loan*, *Cancel loan request* and *Take the Pusaka* go through this relayer when the connected wallet supports NEP-366 (`signDelegateActions` in near-connect); otherwise they are normal transactions. **Verified on testnet with Meteor Wallet:** listing Pusaka #2 from the web app opened Meteor's *Sign Delegate Action* screen, the relayer submitted it, and the owner's balance changed by 0.000000 NEAR. A Vercel Firewall rate-limit rule on `/api/prove` and `/api/relay` (20 POSTs per minute per IP) is staged in log mode.

## nBTC: the Pusaka's Bitcoin, also as a NEAR token

A Pusaka can turn some of its native BTC into **nBTC**, Omni Bridge's NEP-141 Bitcoin on NEAR, without it ever leaving
the NFT's control:

1. Its BTC is withdrawn (contract-built, MPC-signed, `OP_RETURN pusaka:<id>`) to the Omni BTC connector's deposit address
   for the **Pusaka's own NEAR account** (`nbtcDepositAddress`, registered with Near-One's relayer API).
2. Near-One's relayer verifies the deposit against the same Bitcoin light client Pusaka uses (`btc-client-v4.testnet`)
   and `btc-connector.n-bridge.testnet` mints nBTC to that account. It now moves with the NFT.
3. Only the holder can spend it: `withdraw_nbtc` is the one other transaction shape the contract will sign from that
   account, a single `ft_transfer` on `nbtc.n-bridge.testnet` with 1 yoctoNEAR (test `b1` pins the bytes).

**Verified live (4 Nov 2026):** Pusaka #5 sent 3,500 sats to the connector ([236e5f21…](https://mempool.space/testnet/tx/236e5f21cf6b5816ac494a42eead18f4fd12df3b1e7c1502fa49a1c72ec15998));
3,300 nBTC sats (after the 200-sat bridge fee) arrived in its NEAR account `0065858e…b2db`; then the holder sent 1,000 of them
out with an MPC-signed `ft_transfer` ([FbT94gnj…](https://testnet.near.rocks/tx/FbT94gnj4G5RqqrrhHMJQ9Fh1SNoeXeyChfUU3m3tivi)).
Try: `node scripts/withdraw-nbtc.mjs <owner> <token_id> <receiver> <sats>`. Verifying a deposit on the connector
yourself needs a staked trusted relayer (1,000 NEAR); Near-One's relayer does it for you.

## Staking: the NFT earns

A Pusaka's own NEAR account (its Ed25519 MPC key) can delegate to a validator. `stake_near(token_id, pool, action, amount, nonce, block_hash)` has the contract build one FunctionCall from that account to a staking pool (`deposit_and_stake`, `unstake` or `withdraw_all`) and NEAR's MPC network sign it, like every other transaction the Pusaka makes. The stake and its rewards belong to the account, so **they move with the NFT**: a buyer gets the staked NEAR and the rewards still accruing, and only the current holder can unstake.

- **Only real validators:** the pool must come from NEAR's official staking-pool factory (`*.pool.f863973.m0` on testnet, `*.poolv1.near` on mainnet; the factory account itself is refused), so a holder can't route a "stake" to a contract of their own. Only the three pool calls, only the holder, never while listed or locked; each one bumps the sign epoch and the NEAR nonce floor like a withdrawal, so a buyer who looked before must look again (tests `sk1`–`sk8`).
- **A buyer can see it:** the contract remembers the pools a token used (`staking_pools_of`, up to 3), and the token page, `pusaka_inspect` and `node scripts/stake.mjs <owner> <id> status` ask each pool for the staked, unstaked and withdrawable balance (pool rounding dust below 0.001 NEAR is ignored).
- **Where:** the token page's *Staked NEAR* section (validator picker of the factory pools validating now, lowest fee first), MCP `pusaka_stake_near` (`pool: "best"` picks the lowest fee), and `scripts/stake.mjs`.
- **Live (7 Nov):** #2's NEAR account staked 1 NEAR with `dev10011101.pool.f863973.m0` [4yQWgGG4…](https://testnet.near.rocks/tx/4yQWgGG4G1v3tQnQePba8j94t49fg1iHqpDQpzqWsedM), then unstaked 0.3 [EQyUsGqa…](https://testnet.near.rocks/tx/EQyUsGqatVY6j29n1TvEzkwaPWzK5jkWp4yU4mLZc6j1); both signed by NEAR MPC for the implicit account `743d1eed…31f3`.

## Verified USDC: NEAR MPC reads Base and Arbitrum

BTC deposits are trusted through NEAR's Bitcoin light client. USDC deposits get the same treatment through NEAR MPC's
**foreign-transaction verification** (domain 3 on `v1.signer-prod.testnet`):

1. Anyone calls `prove_usdc_deposit` with a USDC `Transfer` log as the chain's RPC returns it. The contract checks that it
   is Circle's USDC paying this Pusaka's EVM address (recorded from the MPC's own key) and is at least 0.01 USDC.
2. The contract computes `sha256(borsh(ForeignTxSignPayload::V1{request, values}))` for exactly that log in that tx on a
   finalized block (`contract/src/usdc.rs`), then asks the MPC network to `verify_foreign_transaction` with that
   `expected_payload_hash`. The MPC nodes read the chain themselves.
3. The callback counts the deposit only if the MPC's signed `payload_hash` matches. `withdraw_eth` records every USDC
   amount it signs before signing, so `usdc_info.verified` = proven deposits − everything ever signed out: a lower bound a
   buyer or lender can rely on without any EVM RPC.

**Verified live (4 Nov 2026):** 0.01 USDC sent to Pusaka #5 on Base Sepolia ([0xbdf0f548…](https://sepolia.basescan.org/tx/0xbdf0f54808b9950544750853392c6b83913c3dad59e240c0c057acc3164b84b7)) was proven with `node scripts/prove-usdc.mjs`, once Base finalized the block (~70 min): [FkQwHG2Z…](https://testnet.near.rocks/tx/FkQwHG2ZQ3EN7B1JD8jeVPqwGDHkqhaJ3iD8W4Pqd71m) runs `prove_usdc_deposit` → `v1.signer-prod.testnet.verify_foreign_transaction` → `on_usdc_proven` = `true`, and `usdc_info(5)` shows 0.01 USDC verified on Base.
**Second chain (9 Nov 2026):** 20 USDC from Circle's faucet to the same Pusaka on Arbitrum Sepolia
([0x3875b06d…](https://sepolia.arbiscan.io/tx/0x3875b06dcbcc206f402020110dc751d6e71946f5c80a9551fbdee9d7a44a7983), log 4)
was attested by the MPC in 7.3 s once the block was final:
[89W2pDYE…](https://testnet.near.rocks/tx/89W2pDYEx6M1kGBZMfMgm5MhHauEQNAoQN48k5PCruzo). `usdc_info(5)` now shows
0.01 USDC verified on Base and 20 USDC on Arbitrum.

Only chains the MPC verifies count (Base and Arbitrum; Ethereum L1 isn't among them). The encoding is pinned to a live
answer: the MPC verified a Base Sepolia USDC transfer ([BKeg9y2v…](https://testnet.near.rocks/tx/BKeg9y2vhjfYKggRj7Y5PLiFgPTsxHmE7havcxaKchk4))
and test `u1` reproduces its `payload_hash` byte for byte. Hardening: one marker per deposit with no list cap (dust can't
crowd out deposits), a 0.01 USDC minimum, and proofs are refused for a token that signed on that chain before the counter
existed. Try: `node scripts/prove-usdc.mjs <payer.testnet> <token_id>`; the relayer's *Prove for free* also proves USDC.

## Deposit prover in a TEE (Phala TDX)

`shade/agent.mjs` is the relayer's prover run in a Phala Cloud TDX enclave, built on the [Shade Agent framework](https://github.com/NearDeFi/shade-agent-framework) (which [NEAR deprecated as standalone tooling after 19 Apr 2026](https://docs.near.org/ai/shade-agents/getting-started/introduction); what matters here, the on-chain TDX attestation check, is plain contract code in `shade/agent-contract`). On boot it registers on the agent contract `pusaka-agent.testnet` (the framework's reference contract, `requires_tee: true`). The contract verifies the TDX quote and accepts the agent only if its measurements (OS image, firmware, KMS, and the hash of `shade/docker-compose.yaml`, which pins the image by digest) and its hardware PPID are on the approved list. After that, a key generated inside the enclave proves every Pusaka's confirmed BTC deposits through the same `proveToken()` as `api/prove.mjs`. Nobody, including us, ever holds that key.
**Verified on testnet (4 Nov 2026):** [register_agent](https://testnet.near.rocks/tx/4Pxmp4gyPBe4tnmMqJA1GkrdiCr1ZHVjfh8UvtEjhNtA) from `eaf0205d…2fbc` (`get_agent` on `pusaka-agent.testnet` returns `"validity": "Valid"`, PPID `62d54040…`). The same account then proved [#1's 153,946 sats](https://testnet.near.rocks/tx/GrSm25nCftxzjPREtaMKzgqryU3QNMpzuq4P51nt1Mys) and [#5's 10,000 sats](https://testnet.near.rocks/tx/92rQg2ceP4iwg62CPBkERhUaWPacTNSiAPzaVHLCQAhM), both from BTC tx [c6c1dd60…](https://mempool.space/testnet/tx/c6c1dd60deb538f3a5007f4239643534b8ba7428d472d70e2002ac15330ca9b0). The CVM (tdx.small) ran for about 3 minutes and was deleted afterwards. The Vercel relayer still proves deposits day to day.
**How it was deployed:** CI builds the image (`.github/workflows/shade-image.yml`, actions pinned by SHA) and the agent-contract wasm. `shade deploy` (CLI 2.4.0) deployed the contract and approved the PPIDs. The CLI only knows how to measure dstack 0.5.7/0.5.8, and Phala has disabled both images, so `node shade/deploy-tee.mjs` deploys on dstack 0.5.12 instead. It computes the app-compose hash locally, as the CLI does, and checks it against the enclave's event log; it reads only the OS/firmware RTMRs from the running enclave's quote, then approves the result.
**Limits:** taking the RTMRs from the quote trusts Phala's 0.5.12 image on first use rather than recomputing it from a reproducible build. The image is built non-reproducibly. The agent contract's owner key (`pusaka-shade.testnet`) is not deleted.

## Private AI appraisal (NEAR AI Cloud, verified TEE)

A Pusaka page can ask a model running in a NEAR AI Cloud TEE for a short appraisal written only from the token's
on-chain facts (verified sats, listing, loan, approvals, history), and it shows the evidence instead of asking for
trust (`api/_nearai.mjs`, `api/appraise.mjs`), following NEAR AI's verification guide:

1. **Before the request**, the server fetches the gateway's and the model's attestation for a fresh 32-byte nonce and
   verifies each Intel TDX quote with Phala's `dcap-qvl` against Intel's collateral (TCB status accepted, not a debug TD).
   Its report data must be the signing address followed by our nonce. MRCONFIGID must be the sha256 of the measured
   app config, and the event log must replay to the quote's RTMR3. NVIDIA's NRAS must pass the model's GPU evidence.
2. **After it**, the model TEE's signature (`/v1/signature`) must be of kind `provider_tee`, over
   `model:sha256(our exact request bytes):sha256(the exact response bytes)`, and must recover (EIP-191) to exactly one
   of the model keys verified in step 1. Anything less is shown as *not verified*, with the failing check.
   A model counts only when both its TDX quote and its GPU evidence pass; a quote that isn't a verified TD report
   yields no signer at all (fail closed).

**Limits, shown on the page.** Provenance of the container images (were these digests built from published source?)
is not checked: the page lists any image in the measured config that isn't a fixed `@sha256` digest. Today the model's
config lets an environment variable replace one image (`${COMPOSE_MANAGER_IMAGE:-nearaidev/compose-manager@sha256:…}`),
so that line appears as a provenance note. NVIDIA's GPU evidence is tied to our request by the same nonce, not by the
TDX report data.

**Verified on every CI run (no key needed):** `node api/_nearai.test.mjs` verifies the live gateway and
`Qwen/Qwen3.8-27B` attestations end to end (quote, nonce and signer binding, config, RTMR3, GPU) and checks that the
response-signature rules reject another key, other bytes, a gateway-only signature, a mismatched signer, a missing or
an ambiguous one. The appraisal itself needs a NEAR AI Cloud key on the deployment (`NEARAI_API_KEY`, set since
9 Nov), and `live.spec` runs one verified appraisal on every CI run. Spend is capped at 60 appraisals an hour per
instance, unknown ids are refused before the model is called, and answers are cached for 15 minutes. Percentages and
loan-to-value are computed on the server and only quoted by the model (an early run had it miscompute a discount).

**Try it:** open [#/pusaka/10](https://pusaka-two.vercel.app/#/pusaka/10) and click *Appraise this Pusaka*. **See:**
six short lines from the facts, "Verified: N of N checks passed", and under *Evidence* each check (TDX quote, nonce
and signer binding, config, RTMR3, GPU, the model TEE's signature over our exact bytes).

## Prices: what a lender or buyer is actually getting

The web app values collateral and listings with live market data: BTC/USD from mempool.space, NEAR (and ETH) from Rhea/Ref, i.e. NEAR DEX prices. A loan shows its loan-to-value and annualised interest; a listing shows how far above or below the BTC's value it is priced. NEAR's on-chain oracles (`pyth-oracle.near`, `pyth-oracle.testnet`, `priceoracle.near`) were all stale when we checked, so the contract doesn't depend on a price; the numbers are labelled as mainnet prices. (Re-checked 4 Nov 2026: `pyth-oracle.testnet` last published in June, `priceoracle.near` returns no prices, and Pyth's Hermes now needs a paid API key.) Each price is cross-checked against CoinGecko: if BTC, NEAR or ETH differ by more than 5% the API answers an error, and the MCP agent's `pusaka_fund_loan` refuses to fund on a single source.

**Exit value through NEAR Intents.** A price feed says what BTC is worth; a lender wants to know what *this* collateral
sells for. Every Pusaka page (and `pusaka_inspect` over MCP) asks [NEAR Intents](https://docs.near-intents.org) 1Click for a
live, solver-signed quote to swap its verified BTC into USDC on Base, paid to the Pusaka's own EVM address, and shows the
amount, the minimum after 1% slippage and the time (about 13 minutes). On a loan it adds how many times that covers the
loan. The request is `dry: true`: the solvers quote, but no deposit address is opened, so nothing can be sent.
1Click only quotes mainnet liquidity, so on testnet it prices the same amount of real BTC; below about 6,400 sats it
answers "amount too low" and the page says so. Code: `shared/intents.mjs`, test `shared/intents.test.mjs`.
Try: `curl -s -X POST https://1click.chaindefuser.com/v0/quote -H 'content-type: application/json' -d '{"dry":true,"swapType":"EXACT_INPUT","slippageTolerance":100,"originAsset":"nep141:btc.omft.near","depositType":"ORIGIN_CHAIN","destinationAsset":"nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near","amount":"10000","refundTo":"0x578c38a22c2bb08b07b45451f65a7cd4dac50ba8","refundType":"INTENTS","recipient":"0x578C38A22c2BB08b07b45451f65A7CD4daC50Ba8","recipientType":"DESTINATION_CHAIN","deadline":"2030-01-01T00:00:00Z"}'` (Pusaka #12's EVM address).

**The exit, executed: a Pusaka's BTC swapped to USDC through NEAR Intents (testnet).** The quote above is a dry
run. On testnet the swap also runs for real, with one caveat up front: it spends **testnet4** coins at the Pusaka's
address (Tidepool's Bitcoin side), which NEAR's light client (testnet3) never counted in `verified_sats`. The holder picks an amount in the *Swap to USDC (NEAR Intents)* form,
the app asks for a live quote (`dry: false`), the contract builds a spend from the Pusaka's own address to the quote's
deposit address, NEAR MPC signs it, and the USDC lands in the holder's NEAR account. Refunds go back to the Pusaka's
own Bitcoin address, not to a person. 1Click has no testnet, so testnet uses [Tidepool](https://www.usetidepool.tech):
the same `/quote`, `/deposit/submit` and `/status` API, with settlement by NEAR's unmodified `defuse` verifier
(`verifier.tidepool-sandbox.testnet`). Live (9 Nov): Pusaka #21 swapped 20,000 sats for **14.752486 USDC** paid to
its holder `pusaka-s-mw5sfoai.testnet`; NEAR MPC signed in 7.2 s.
- Bitcoin testnet4 tx: [52a0adcd…](https://mempool.space/testnet4/tx/52a0adcd39318ffc9137a598f8c99d3a3d126914ab58fa92d04c5fd5e8cf4fe0)
- NEAR settlement: [6jQR6fwB…](https://testnet.near.rocks/tx/6jQR6fwBoni25o3c21hp6aYLqsQYAiyPpkLzXherQqpK), [FtkHZMPT…](https://testnet.near.rocks/tx/FtkHZMPTErzygAvHNFRbBYevWwf5bHz7S1nky94cytaS) and [2i7QK2ze…](https://testnet.near.rocks/tx/2i7QK2ze4Z7SQ2vyrLTTB7U9CQ2c6L5AJgsHZSVuwCSs)

Then the same swap again **through the web app's form**, with a real wallet (Intear, approved by `web/e2e/wallet-qa.mjs swap`):
20,000 sats for 14.79 USDC, 1,234 s from click to settled (most of it waiting for one testnet4 block).
- Bitcoin testnet4 tx: [69509159…](https://mempool.space/testnet4/tx/69509159f4b47d12b963409373cfaa9bde5df339a88c1e4596f15ccb7797683e)
- NEAR settlement: [AaUXakFN…](https://testnet.near.rocks/tx/AaUXakFNoBj8oyNsK1d1mKzVWMfZd2QX527oPTLjVdpa), [Hma9CFKV…](https://testnet.near.rocks/tx/Hma9CFKVQMK9Kfp2CVWKEvbCSqY1UjMZUokGYoHEb85j) and [HUWEnGY7…](https://testnet.near.rocks/tx/HUWEnGY7Q2Vcr9zEJsDzY7gBr9qtYPP46Hh2L3p48c3f)
- The holder's balance on `usdc.tidepool-sandbox.testnet` afterwards: 29.541855 USDC, the sum of both swaps.

And a third time **by an AI agent over MCP** (`node mcp/swap-agent.mjs pusaka-s-mw5sfoai.testnet 21 <funding_txid>`).
- With outflows off, `pusaka_swap_to_usdc` refused before any quote was opened or anything was signed.
- With outflows on, it swapped 20,000 sats in testnet4 tx [be9987e9…](https://mempool.space/testnet4/tx/be9987e9557419a565769daa9d0453b3a7ebea1ebaea6219374a31eea025b3b4).
- `pusaka_swap_status` followed it to `SUCCESS` and read the holder's balance: 44.31897 USDC, i.e. 14.777115 more.

Run it yourself: `node scripts/intents-exit.mjs <holder> <id> <testnet4_funding_txid>`.

**The NFT itself, sold through NEAR Intents.** Above, the Bitcoin leaves the NFT. Here the whole Pusaka changes hands,
Bitcoin inside, for USDC, settled by the Intents verifier. Seller and buyer each sign a NEP-413 `token_diff`
(`-1 nep171:pusaka-btc.testnet:15, +5 USDC` and the reverse). The seller's `nft_transfer_call` deposits the NFT into the
verifier, and its `msg` executes both intents in the same transaction with `refund_if_fails`: either the swap settles or
the NFT comes straight back. The verifier charges no fee on NFTs, and no contract change was needed: the original
contract, whose code is final, already speaks NEP-171 the way `defuse` expects. Live (`node scripts/intents-nft-sale.mjs
pusaka-buyer.testnet 15 pusaka-s-mw5sfoai.testnet 5`, 10 Nov):

| Step | Transaction |
|---|---|
| The buyer deposited 5 USDC into NEAR Intents | [463sWhVC…](https://testnet.near.rocks/tx/463sWhVCa8iSSVQ2NdP6eFHWPJ2TVEEgijmg4ESFhhJD) |
| The seller asked 1 USDC more than the buyer signed: the verifier refused (`unmatched_deltas`) and the NFT came back in the same transaction | [2T1G6XTf…](https://testnet.near.rocks/tx/2T1G6XTffpQ357tpm53VFmgrq1RF9Fjj6K7EjfXyYNVh) |
| Matching intents: Pusaka #15, with its 10,000 verified sats, sold for 5 USDC in one transaction | [ALQN3eLY…](https://testnet.near.rocks/tx/ALQN3eLYP3ukMqxV5XceUBroYQH5hnvwhvommZjrn1sa) |
| The buyer withdrew the NFT from the verifier; its `verified_sats` unchanged | [4gEWku5x…](https://testnet.near.rocks/tx/4gEWku5xFeZe1pdvCLVcE3eEESKv75s59QT6xrCtYN58) |
| The seller withdrew the USDC | [8vKUMWQA…](https://testnet.near.rocks/tx/8vKUMWQAjJpBwHCC82vsW3NHqYVVZpCxgggsFmxqgxc5) |

Both sides here are our own testnet accounts, each signing its own intent with its own key. On mainnet the same
signed intents work against `intents.near`, but there is no market maker quoting NFTs: a buyer has to sign the other side.

Limits, stated plainly:
- Tidepool is a community sandbox. Its Bitcoin side is **testnet4 with a custodial test relayer**, which is Tidepool's trust model, not Pusaka's.
- The Pusaka's address and MPC key hold coins on testnet3 and testnet4 alike. NEAR's light client follows testnet3, so testnet4 coins are spendable but never count as `verified_sats`.
- The app has no testnet4 address index, so the holder names the testnet4 transaction that funded the Pusaka.
- On mainnet the same requests would go to 1Click. That path isn't wired up here, because Pusaka isn't on mainnet.

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
| T22 | Accept a lender's sats-floor offer, then sign the BTC away before the loan starts; or take one offer twice | `accept_loan_offer` runs `request_loan`'s and `fund_loan`'s checks (owner, nothing in flight or listed, no NEP-178 approval, `expected_sign_epoch`) and checks the floor against light-client-proven, never-signed sats; the offer is deleted before any transfer, so it can't be accepted again or cancelled afterwards | `o3`–`o9` |
| T23 | Refinance a loan out from under its lender without paying them, or refinance someone else's loan | only the borrower, as owner, refinances, by taking an offer; the offer's principal plus the borrower's deposit must cover the full current repay, which goes to the old lender in the same call; an unfunded loan request isn't refinanced (`Collateralised`) | `o10_*` |
| T24 | Pay off "part" of a loan with its whole remainder (leaving a zero-repay loan locked), or take a stale or underpaid extension | `repay_partial` only takes less than what is left; an extension is bound to the lender and due date it was proposed for, must be taken before the due date with exactly its fee, and only the lender proposes one | `o11_*`, `o12_*` |
| T12 | Get an EVM signature on a chain buyers don't look at | `withdraw_eth` only signs for chains in `EVM_CHAINS`, the same list the UI shows (Sepolia, Base Sepolia, Arbitrum Sepolia on testnet) | `r3_unlisted_chain_rejected` |
| T13 | List on another market (NEP-178), then withdraw the BTC before the buyer pays there | While any approval exists, `withdraw`, `withdraw_eth`, `request_loan` and `list` refuse (`Approved: call nft_revoke_all first`); `nft_approve` refuses while a signature, sale or loan is open; a revoked approval's id never works again; and after any signature, `nft_approve` waits 1 h (24 h on mainnet), so *revoke, withdraw, re-approve* can't catch a buyer who looked a moment ago | `m1_withdraw_while_approved_fails`, `m1_loan_request_while_approved_fails`, `m4_stale_approval_id_fails`, `m5_approve_while_signing_fails`, `m6_approve_right_after_a_withdrawal_fails` |
| T5 | Anyone else requests a signature | Owner check; the MPC path can only be used by the contract account | `t5_non_owner_withdraw_fails`, `seller_cannot_withdraw_after_sale` |
| T6 | Mint a token whose "address" is really yours | The key comes from the MPC contract via an on-chain call, not from the caller | `key_is_compressed_from_mpc_format` |
| T7 | Fund the token with an unconfirmed (RBF) transaction, sell, then double-spend the deposit back | The safe balance only counts **confirmed** coins; unconfirmed ones are shown separately and not counted | client logic in `shared/btc.mjs` (`balances`) |
| T8 | `nft_transfer_call` gives the receiver the token mid-call; it withdraws the BTC, then returns an empty token | `nft_transfer_call` works as NEP-171 specifies, but the token is locked from the call until `nft_resolve_transfer`: the receiver owns it meanwhile, yet nobody can withdraw, sign, list, lend, approve or move it, and the sign epoch moves so a buyer who looked before must look again. If the receiver asks for it back (or fails), it returns to the sender with every asset in it | `x1_…`–`x5_…` |
| T10 | Get an EVM transaction signed, keep it, sell, broadcast later | The contract records a per-chain **nonce floor** (highest signed nonce + 1) before signing. A buyer only counts the ETH once the account's on-chain nonce reaches the floor; until then it shows as at risk | `e1_nonce_floor_recorded_before_signing`, `e1_floor_never_goes_down` |
| T14 | Sign a NEAR transfer from the Pusaka's own account, keep it, sell, broadcast later | The contract records a **nonce floor** before signing; a buyer counts that NEAR only once the account's access-key nonce reached it | `a2_near_floor_recorded_before_signing_and_never_drops` |
| T15 | Plant a second key on the Pusaka's NEAR account before selling | The contract builds the transaction itself and only ever signs a single `Transfer` action: no `AddKey`, `DeleteKey` or calls | `a1_near_tx_layout` |
| T16 | Sign a SOL transfer, keep it, sell, broadcast later | The contract builds a plain System transfer with no durable-nonce instruction, so the signature expires with its blockhash (~1 min); the app shows SOL as at risk for 3 minutes after any SOL signature | `s1_solana_message_layout`, `s2_sol_withdrawal_locks_and_bumps_epoch` |
| T17 | Keep reading the holder room after selling | Ownership is checked on every request; signatures expire after 5 minutes and are bound to this site and a full-access key | `scripts/holder-test.mjs`, `scripts/handover.mjs` |
| T18 | Swap or wipe the sealed letter just before a sale | `set_letter` is owner-only and refused while listed, approved, collateral or signing | `h2_old_owner_cannot_rewrite_the_letter`, `h3_letter_frozen_while_listed` |
| T19 | Start a payout, then sell in the middle of it | A signature in flight locks the token (`SignPending`), and a buyer whose view predates the payout fails (`StateChanged`) | `a5_sale_during_payout_is_impossible`, `a5_buyer_with_pre_payout_view_cannot_buy` |
| T21 | Inherit a Pusaka early, as someone other than the heir, or through a will a previous holder left | `claim_inheritance` needs the named heir, a silence of `after_ms` since the last check-in, and an heir set by the current holder; every transfer clears it; a funded loan blocks it | `h1`–`h10` |
| T20 | Use the Pusaka's NEAR account to call some other contract (or approve one) before selling | From that account the contract signs only a `Transfer`, one `ft_transfer` on the nBTC contract with 1 yocto, or one of `deposit_and_stake` / `unstake` / `withdraw_all` on a pool deployed by the official staking-pool factory (`*.pool.f863973.m0`, `*.poolv1.near`); it never signs `AddKey`, other calls or approvals | `a1_near_tx_layout`, `b1_nbtc_tx_is_one_ft_transfer_on_the_nbtc_contract_with_one_yocto`, `sk1_…`–`sk4_…` |
| T26 | Stake the Pusaka's NEAR, sell, then take the stake | The stake is held by the Pusaka's own account at the pool, so it moves with the NFT; only the current owner can ask for `unstake` or `withdraw_all`, the pool pays back only to the delegator (that account), and a listed, approved, collateral or signing token can't stake at all | `sk5_…`, `sk8_…` |
| T27 | Use the free change-proof to have the relayer prove someone else's dust | Below 10,000 sats the contract proves only output 1 of a transaction it built itself for this same token (`ch:<txid>` recorded at signing) | `ch1_…`–`ch4_…` |
| T25 | Swap in new contract code that drains the Pusakas, with no warning | The contract account needs no key: code only changes through `apply_upgrade`, which deploys only bytes whose sha256 the admin announced at least `UPGRADE_DELAY_MS` earlier (10 min testnet, 7 days mainnet), and only the contract itself can name the admin | `up1_*`–`up8_*` |
| T9 | A failed callback leaves the token locked forever | After ~600 blocks the owner can `unlock_stale`; safe because outpoints were recorded before signing | `unlock_stale_waits_for_timeout`, `unlock_stale_releases_after_timeout` |

`nft_transfer_call` locks the token until it resolves (T8), and NEP-178 approvals freeze every asset (T13), so no marketplace or third party can move a Pusaka around these locks.

T3 (late signatures), T7–T9 and T11–T12, and the ETH part of T4, were found by independent review passes during QA and fixed with the tests above.

**Limits, stated plainly**

- **What is trustless:** the *verified* balance. A deposit counts only after `btc-client-v4.testnet` (a Bitcoin SPV light client on NEAR) has verified its merkle proof and the contract has checked the output pays this Pusaka. Only this contract can get signatures for the address and it records each one, so a proven, never-signed UTXO can't have been spent. A buyer or lender needs nothing but the contract's `verified_sats`.
- **What isn't:** mempool.space is still used to *find* deposits and build proofs, failing over to Blockstream's Esplora on timeouts and 5xx (any Esplora works; a lying API can only make a proof fail). Light-client security assumptions apply: it follows the most-work chain it is fed by relayers, so a deep reorg attack is bounded by the confirmations required (1 on testnet, 6 on mainnet).
- Security rests on the NEAR MPC network's threshold assumption.
- **The code is final (since 8 Nov); before that, changes were voted, public and delayed.** From 6 Nov the upgrade role belonged to the Sputnik DAO `pusaka-council.sputnikv2.testnet`: a council member proposes a `propose_upgrade(sha256)` call, a majority must approve it ([proposal 0](https://testnet.near.rocks/account/pusaka-council.sputnikv2.testnet): 2 of 3 votes, then deployed after the timelock, [BP2TS4ta…](https://testnet.near.rocks/tx/BP2TS4taKJqMqqHJ88YuM5ZSRdHWyqo7RanUyJKAYrBv)), and only then does the timelock start. Stated plainly: the three council members are still our own demo accounts, so this shows the mechanism, not independence; a production council would be holders or auditors, or the DAO calls `renounce_upgrades` once the code is final. **Done on 8 Nov: the code is final.** The DAO approved `renounce_upgrades` (proposal 7: [ZFTaEndt…](https://testnet.near.rocks/tx/ZFTaEndtQQe9rvP43sJpefXtZuCqRtQGn8Gitj5Tzvi), votes [G9Mpn7NV…](https://testnet.near.rocks/tx/G9Mpn7NVMUdJAytgXht37zES8HRvUiZurdWKs2fKrfuP) and [GdASfxh5…](https://testnet.near.rocks/tx/GdASfxh5Xr6UCGeg5LPTXsH3SCn4aWvCLGUqPWNDGa6N), which logs `upgrades renounced: this code is final`). With no access key and no upgrade path left, nobody, including us and the council, can change `pusaka-btc.testnet` again; `upgrade_status` reports `renounced: true` and `verify.mjs` checks it. Before that, a single admin announced code: The contract only takes new code through a timelock (`contract/src/upgrade.rs`): the admin account `pusaka-admin.testnet` can only announce a wasm's sha256; anyone can deploy those exact bytes, but no earlier than 10 minutes later (7 days on mainnet), so holders see it coming (`upgrade_status`, an `upgrade_proposed` event) and can withdraw or sell first. `renounce_upgrades` makes the code final. Exercised live on 6 Nov: announcement, an early deploy refused on-chain (`TooEarly`, [EHX5b1cp…](https://testnet.near.rocks/tx/EHX5b1cpU4pzpfu4DA5TEZL3db95dQ5NqSRRdgtQuqoh)), other bytes refused (`CodeMismatch`, [25pi2EER…](https://testnet.near.rocks/tx/25pi2EER5uaAZ93Ph5eCnwboPiTmi1ocd8SEr5gD5ZEX)), and after the delay the announced build deployed by a third account [EAw1ppZ5…](https://testnet.near.rocks/tx/EAw1ppZ53hzsQ3CRTQYnAVGxFnEvdnhCAdyd44P9XKqh). **The contract account holds no key:** its last full-access key was deleted on 6 Nov ([3mNiGWfH…](https://testnet.near.rocks/tx/3mNiGWfH1VvtFZiYXDP9WdPVfM7fZApd639vzneyY1K7), `node scripts/upgrade.mjs lock`), so nobody, including us, can sign as `pusaka-btc.testnet`; the timelock was the only way code changed, and since the renounce there is none. `node scripts/verify.mjs` checks this live.
- Testnet only. No mainnet funds were used.

## Measured on testnet (2–5 Nov 2026)

| What | Result |
|---|---|
| Ownership transfer of the BTC (`buy`, until the transaction and its refunds are final) | **3.0 s**, one NEAR transaction, 0 Bitcoin fees |
| MPC signature for a 1-input withdrawal (request to signed tx) | 6.8 s – 13.7 s across 5 runs |
| Bitcoin transactions built by the contract and accepted by testnet4 (2 Nov, before Pusaka moved to testnet3, the network NEAR's light client tracks) | [bfdcdcf2…](https://mempool.space/testnet4/tx/bfdcdcf22ea5e1816d995dc27166737a11e25d30c7950a881754526d532bb9e7), [1b6a8926…](https://mempool.space/testnet4/tx/1b6a8926a1b46a0f057bbe30c5eaf1de854f749bad098998d741ea1314817349), [79fd2311…](https://mempool.space/testnet4/tx/79fd2311787dddada2079f75721e1648e6c7d8e7bdf1487aa1b75dde45979e77) (Pusaka #1 funding Pusaka #2), [e5272011…](https://mempool.space/testnet4/tx/e527201185af46e04dddb57411a31790ebfaacb42ff06ea273ea04ff112eef90) (demo with fresh accounts), [7232cac5…](https://mempool.space/testnet4/tx/7232cac5c77f2aebd6e07a7f264531550d033a55b80a754d2d2e63face5962ef), [e2553636…](https://mempool.space/testnet4/tx/e2553636a332080c4b0c1d2417971a8ba362c71f41a7b1aecbfeb4ebcb57d5ce) |
| Full flow through the web app with Meteor Wallet (mint, list, buy, withdraw; 2 Nov, on testnet4) | passed; withdrawal [edbf984c…](https://mempool.space/testnet4/tx/edbf984cd4bfc9db49a8305cee4cfd642b14d3c25246167decc8790f45c4caa6) was built in the contract, signed by MPC, assembled and broadcast by the browser |
| Same key on Ethereum: contract-built EIP-1559 tx for Sepolia, MPC-signed, broadcast | [0x85a7466d…](https://sepolia.etherscan.io/tx/0x85a7466d06d1af540315b8b1fa2b33956a773784742c4352d095f8909478eecb): 0.002 ETH out of Pusaka #1. Before it, the 0.01 ETH deposit showed as **at risk** (an earlier nonce-0 signature existed); once nonce 0 was used on-chain, the rest showed as safe |
| Trustless deposit proof: testnet3 tx [2caf27f4…](https://mempool.space/testnet/tx/2caf27f4151b0399cb8cc3d89a9b4f9e8dff6d5affe3612be41310a968c035a0) proven by `btc-client-v4.testnet` via `prove_deposit` | `true` in 3.4 s; 176,246 sats verified on NEAR |
| Gas-free listing from the web app (Meteor *Sign Delegate Action*, NEP-366) | [EN69gz4r…](https://testnet.near.rocks/tx/EN69gz4rrqPk8qyTYJFsNtY5kSZaFHNoXxCKTfrSbdsn): signer `pusaka-relayer.testnet`, a `Delegate` action from `pusaka-w-mvzhtaw8.testnet`; the owner's balance changed by 0 NEAR |
| Deposit proven by the relayer ("Prove for free", no wallet) | [EYLPHJGX…](https://testnet.near.rocks/tx/EYLPHJGX6rQNDyD6eTMVwmSMR4enPwb75ATDfW4TMWiS): `prove_deposit` signed by `pusaka-relayer.testnet`, returned `true` |
| Sold on an outside market: Pusaka #2 listed on Mintbase's testnet market (`nft_approve` with a price), bought there by `pusaka-buyer.testnet`; Mintbase called `nft_transfer_payout` | approve [HK7ski1J…](https://testnet.near.rocks/tx/HK7ski1JBYfEKdZoEFkQSHtJuwGts6ZCcUPhwcZ1hMGS), buy [CCxgRJ7i…](https://testnet.near.rocks/tx/CCxgRJ7iwKccnTEwpToZNC9hg3BW17tqqD5oj2X9VXcB); seller received 0.196 NEAR; a withdrawal attempted while approved was refused |
| The Pusaka's own NEAR account: Pusaka #5 funded its implicit account `0065858e…b2db`, then the contract built a Transfer, the MPC signed it with Ed25519, and NEAR accepted it | [3npsdnYo…](https://testnet.near.rocks/tx/3npsdnYooNieWN5Lc3g7pUGVF6vLZfypj5njZpYnFcjJ): 0.05 NEAR out, signed in 8.4 s |
| Solana: contract-built System transfer for Pusaka #5's Solana address, signed by the MPC's Ed25519 key | signature verified for `12Ync8r3…t8vN` (8.9 s), then broadcast: 0.1 SOL sent to Pusaka #1's Solana address, [finalized](https://explorer.solana.com/tx/Pz1o8vTdtViK5Vd9YdbsWPRjwHuwLk6aUmaWvj3ik7UVycmyJEhepWBX5E5UFmLNFm6UmwUjXv31dMe8VT3Qmwb?cluster=devnet) (#5 went 1 → 0.899995 SOL; #1 went 0 → 0.1) |
| Holder room on the deployed API, sealed letter on-chain | letter stored with `set_letter` ([EZdhBpqg…](https://testnet.near.rocks/tx/EZdhBpqgrzjKGEaVDpGXt8JCBTovTQkdgRHRWRofdHh2)); the holder read it, a non-holder got 403 |
| Two resales of Pusaka #5 (`scripts/handover.mjs`) | creator `pusaka-seller.testnet` received exactly 0.005 NEAR (2.5% of 0.2); each previous holder was locked out of the room and the new one read the letter |
| Deposits proven from inside a TDX enclave (Phala TDX, attestation checked on-chain) | [register_agent](https://testnet.near.rocks/tx/4Pxmp4gyPBe4tnmMqJA1GkrdiCr1ZHVjfh8UvtEjhNtA), then `prove_deposit` [GrSm25nC…](https://testnet.near.rocks/tx/GrSm25nCftxzjPREtaMKzgqryU3QNMpzuq4P51nt1Mys) and [92rQg2ce…](https://testnet.near.rocks/tx/92rQg2ceP4iwg62CPBkERhUaWPacTNSiAPzaVHLCQAhM) from the enclave's own key, 6 s after registering |
| Verifiable build (NEP-330): `contract_source_metadata` names the repo, NEP-171/177/178/181/199/297/330 and `build_info` (image `sourcescan/cargo-near:0.21.1-rust-1.96.1@sha256:86bd…`, commit `4bf36b2`); the deployed wasm is the one CI's `reproducible-wasm` job built | sha256 `ac16e80e928ba6a2f1e67fc358a8f5d8db7de83779a70514aaffdceb1bceac60`, approved by the DAO (proposal 6: 2 of 3 votes) and deployed through the timelock [67hUwJuA…](https://testnet.near.rocks/tx/67hUwJuAe98wKNAyjQeMkjD8vYe4SJHeEzzUc188x3Jf) |
| Provenance on Bitcoin: every contract-built withdrawal ends with `OP_RETURN pusaka:<id>` | [1a22075f…](https://mempool.space/testnet/tx/1a22075fb9c04bcef4e413ba01c2c91fe1b658665a32807f24261e9dcb68e5e1): 5,000 sats from #5 to #2, change back, `OP_RETURN 707573616b613a35` = `pusaka:5` |
| USDC attested by NEAR MPC foreign-transaction verification (Base Sepolia, finalized block) | [FkQwHG2Z…](https://testnet.near.rocks/tx/FkQwHG2ZQ3EN7B1JD8jeVPqwGDHkqhaJ3iD8W4Pqd71m): `on_usdc_proven` true; `usdc_info(5)` verified 0.01 USDC |
| Same, on a second chain (Arbitrum Sepolia, 20 USDC) | [89W2pDYE…](https://testnet.near.rocks/tx/89W2pDYEx6M1kGBZMfMgm5MhHauEQNAoQN48k5PCruzo): attested in 7.3 s; `usdc_info(5)` verified 20 USDC on Arbitrum |
| Native BTC to nBTC (Omni Bridge) held by the NFT, sent with an MPC-signed `ft_transfer` | deposit [236e5f21…](https://mempool.space/testnet/tx/236e5f21cf6b5816ac494a42eead18f4fd12df3b1e7c1502fa49a1c72ec15998), 3,300 nBTC minted to #5's NEAR account, [FbT94gnj…](https://testnet.near.rocks/tx/FbT94gnj4G5RqqrrhHMJQ9Fh1SNoeXeyChfUU3m3tivi) sent 1,000 |
| A withdrawal's change below 10,000 sats, proven for free (proposal 5) | #10 held 8,700 sats it could never count again (change of an earlier withdrawal); after the deploy its holder withdrew 1,000 ([22997ae1…](https://mempool.space/testnet/tx/22997ae13f07e4da75e7de3c89c99ae81f2f86d2d90e5380e62df3a8d67629f7)), and the public `/api/prove` proved output 1 (7,400 sats): `verified_sats` 0 → 7,400 |
| Unit tests | 330 / 330 passing, on the testnet and the mainnet build, including proptest fuzz and invariant tests (`fz…`, `inv1_…`); line coverage 96% (`cargo llvm-cov`, in CI) |
| Demo stock refilled from a Pusaka's own BTC (`scripts/restock.mjs`): #1 funded five new Pusakas with 10,000 sats each, all proven by the light client and listed | [8bfd559a…](https://mempool.space/testnet/tx/8bfd559ab7c7dd3241ae54a7669a192990b28d40235fad3e98d2bfb4932829bf) and four more chained withdrawals; #1's change ([92a51d2a…](https://mempool.space/testnet/tx/92a51d2a7a328692cee0c286f837f5e339dee2ac4bf297a37988db93d421d57b)) re-proven, 101,446 sats |
| The README's try-it path through the web app with a real wallet (Intear, driven by Playwright: `node web/e2e/wallet-qa.mjs <profile> judge 10 12`, then `repay pusaka-buyer.testnet 12`), current build | *Buy* #10: one wallet approval, "You own Pusaka #10…" in 9 s; *Lend* on #12: "Loan funded. The NEAR went to the borrower." in 8 s; the borrower's *Repay*: "Loan repaid. The Pusaka is unlocked." in 7 s. It also showed the old demo terms as 1,217% a year, so the asks now repay 0.501 for 0.5 (about 24% a year) |
| The loan market's web forms with a real wallet (Intear, `node web/e2e/wallet-qa.mjs <profile> offer pusaka-seller.testnet 15`, then `refinance pusaka-buyer.testnet 15`) | a lender posted a standing offer through the form and cancelled it (8 s each); the borrower of a funded loan saw a cheaper-per-day offer "pays off the 0.102 NEAR owed to pusaka-seller.testnet; 0.008 NEAR comes to you" and clicked Refinance: one wallet approval, `LoanRefinanced` [4HiEGnAW…](https://testnet.near.rocks/tx/4HiEGnAWEvAj8bcZTYTtG2vdhd8pkMQQQxAnLZ11zfoe). This QA found the amount inputs refusing 0.501-style values (`step=0.01`), fixed |
| `nft_metadata_update` (NEP-171 1.2.0) on a live change of the art | listing #15: [8YW6UFg1…](https://testnet.near.rocks/tx/8YW6UFg1qzuE3X8EEv2sQ75fQeFMuFUsP7EsPYRJVQ3F) logs `{"event":"nft_metadata_update","data":[{"token_ids":["15"]}]}` |
| Loan market, live (`node scripts/loan-market.mjs pusaka-seller.testnet pusaka-buyer.testnet pusaka-w-mvzhtaw8.testnet 14`) | standing offer for any Pusaka with ≥ 10,000 verified sats [8rPVEg1g…](https://testnet.near.rocks/tx/8rPVEg1gg1av2NmYpxQnn72CcFSH4EC5iYga7uCxwMRs); #14 took it [GdKp2FB4…](https://testnet.near.rocks/tx/GdKp2FB4m3yFbTfYg5G3ZoL4ZGbUgLWXK2mZzYrUzTfU) (stale epoch and a second accept refused); a third party refinanced 0.31 → 0.305, one more day [YtcA29rE…](https://testnet.near.rocks/tx/YtcA29rELHpSZ1mRWJEG38XRrCVUmdJwERquEbMz2PV) (that `refinance_loan` paid the old lender the full repay and could only take the same back, so it never earned; it was replaced by refinancing through offers, row below); part repaid [2ouEs6je…](https://testnet.near.rocks/tx/2ouEs6je73GN3zJMLTrz7p6avd7SBwQKEtsKz9YfsEu1); extension proposed [592oPnhj…](https://testnet.near.rocks/tx/592oPnhjwBRNxtBLSVD9Y3qam6bAUZeePJEks4zpkEn2) and accepted [EuL5tvgE…](https://testnet.near.rocks/tx/EuL5tvgEcQBGp4nqNQVKoPVhDWYpyTFPw1DW3r8W42ur) (a changed one refused, `TermsChanged`); repaid [2C4FpMvH…](https://testnet.near.rocks/tx/2C4FpMvH3K5G4knhgDXJxo9kNKNVEjw9qFTQFrcxRfXX) |
| Three AI agents run the loan market over MCP (`node mcp/agent-market.mjs pusaka-seller.testnet pusaka-buyer.testnet pusaka-b-mw1h09c7.testnet 15`), each through its own Pusaka MCP server and keys | the lender agent's standing offer taken by the holder's agent [8uFttLyy…](https://testnet.near.rocks/tx/8uFttLyy4hMLFxmVkV3rKQCTq1fEFxL8QRBDPGieR6CJ) (a stranger's accept refused, `NotOwner`); a third agent offered cheaper, longer terms and the holder refinanced into them, topping up 0.002 so the first lender got its full 0.102 (`LoanRefinanced`) [FspSKdP7…](https://testnet.near.rocks/tx/FspSKdP7Qrr8YCJ3QZvNi7QBRBHwdFr57jPu9Jx3fxbA) (without the top-up the agent refused: `0.002 NEAR short`); part repaid [2vrrkBMb…](https://testnet.near.rocks/tx/2vrrkBMbjrSYJq1GKzuxomD472sZ45YntopSvfXFe84e); extension taken [EzbpV3zo…](https://testnet.near.rocks/tx/EzbpV3zoK37FBTnpxJvrUo69tAyeX1GEit2sPttJv8dB); repaid [2JQLbau8…](https://testnet.near.rocks/tx/2JQLbau8qQzRnY5V2RQsEecawnENnueHPoDpdcepSsfN) and relisted |
| `nft_transfer_call` with the lock (T8) to an account that isn't a contract | [FDjBKZdF…](https://testnet.near.rocks/tx/FDjBKZdFS5CH4uUbLxpdYEzFwJuLftqvCyYBWtm34SBt): `nft_transfer` buyer → seller, the receiver call fails, `nft_resolve_transfer` returns it (seller → buyer) and clears the lock |
| Loan on testnet: request, fund, collateral locked, default, lender claims Pusaka + BTC; and request, fund, repay | passed (`npm run demo` steps 7–8) |

## What NEAR makes possible here

- **Chain Signatures**: a smart contract owns a native Bitcoin key. On Ethereum or Solana the same product needs a bridge or a custodian.
- **Cross-contract calls with callbacks**: `derived_public_key` and `sign` are called from the contract; `on_key` and `on_signed` finish the job and release locks.
- **Account model**: the MPC derives keys from *(account, path)*, so the contract account is the only one that can use `pusaka-N`.
- **Implicit accounts**: an Ed25519 public key is already a NEAR account, so the MPC's Ed25519 key gives every NFT its own account with no creation step.
- **NEP-413 signed messages**: wallets prove who holds a Pusaka without a transaction, which is what gates the holder room.

### Every NEAR primitive Pusaka uses, and where to see it live

Mapped to the primitives in [docs.near.org](https://docs.near.org/primitives/what-is) and its chain-abstraction and protocol sections.

| NEAR primitive | What Pusaka does with it | Live on testnet |
|---|---|---|
| **NFT** (NEP-171/177/178/181/199/297, 1.2.0 metadata updates) | The Pusaka itself; approvals let any market sell it, payouts carry the royalty, `nft_transfer_call` is locked while the receiver decides | Mintbase sale and transfer_call rows in [Measured](#measured-on-testnet-25-nov-2026) |
| **Chain Signatures** (secp256k1, Ed25519) | One MPC key per token controls a Bitcoin address and an address on every EVM chain; a second controls a Solana address and the token's own NEAR account | `node scripts/verify.mjs` asks the MPC signer for every token's key |
| **MPC foreign-transaction verification** (domain 3) and **confidential key derivation** (CKD) | USDC deposits counted only once the MPC network reads the finalized chain itself; the sealed holder letter's key | [Verified USDC](#verified-usdc-near-mpc-reads-base-and-arbitrum), [Holder room](#holder-room-gated-by-the-nft) |
| **Bitcoin light client** | A deposit counts only when NEAR's on-chain SPV client verifies its merkle proof | `verified_sats`; `verify.mjs` re-checks every proven UTXO on Bitcoin |
| **FT** (NEP-141) and **Omni Bridge** | nBTC minted to the token's own NEAR account from its native BTC | [nBTC](#nbtc-the-pusakas-bitcoin-also-as-a-near-token) |
| **NEAR Intents** (1Click) | Solver-signed quote for what the BTC inside would sell for (dry run on 1Click's mainnet liquidity), and an executed swap of a Pusaka's BTC to USDC on NEAR (testnet, through Tidepool) | exit value on every token page and in `pusaka_inspect`; [the exit, executed](#prices-what-a-lender-or-buyer-is-actually-getting) |
| **Meta transactions** (NEP-366) | Gas-free listing, loan requests, check-ins and borrowing (a BTC holder's first NEAR can be a loan) | [Gas-free actions](#gas-free-actions-nep-366-relayer) |
| **Gas keys** (NEP-611, protocol 88) | The relayer pays gas from a gas key's own balance and sends in parallel over 16 nonce lanes | relayed `list` from the deployed API on lane 8 [66Gi31T5…](https://testnet.near.rocks/tx/66Gi31T5sqcT1TPP4upzxXxtrTTLaXPCGkZ9e4BBggFX) |
| **Linkdrop** (NEP-452 `claim` / `create_account_and_claim`) | Gift a Pusaka as a link: the recipient needs no account and no wallet; claiming creates and funds one, then the NFT moves to it | Pusaka #2 gifted and claimed by a brand-new account [FixcqhB7…](https://testnet.near.rocks/tx/FixcqhB73hQefMX4SmbwG81Ux2PdRTxJDH6wWgHp6o3v); again from a browser with no wallet (`web/e2e/gift-qa.mjs`): a name typed, the account created and given the Pusaka in 8 s [4haA1JXo…](https://testnet.near.rocks/tx/4haA1JXo52kJsVvYTts1Pj2JUuUfDrH5xkkb7VNkaYVM), and its 0.13 NEAR paid a default 100 TGas transfer right after [BovGdcY2…](https://testnet.near.rocks/tx/BovGdcY2yK6yae5tfnudGtLBstww4Q9bibcTfPyGPoYD) |
| **Access keys** (function-call keys, allowances) | The contract account holds no key; each open gift link is a function-call key limited to the two claim methods, deleted on claim | `verify.mjs` lists the keys |
| **DAO** (Sputnik v2) | Held the upgrade role: new code needed a council proposal, a majority vote, then the contract's timelock. Its last act renounced upgrades (proposal 7), so the code is final | [pusaka-council.sputnikv2.testnet](https://testnet.near.rocks/account/pusaka-council.sputnikv2.testnet) proposals 0, 1 and 7 [GdASfxh5…](https://testnet.near.rocks/tx/GdASfxh5Xr6UCGeg5LPTXsH3SCn4aWvCLGUqPWNDGa6N) |
| **Social** (SocialDB `index.notify`) | A sale, a transfer, a funded loan, a taken offer, a repaid loan or a named heir writes a NEAR Social notification for the account concerned | heir named → notification for `pusaka-seller.testnet` [FpDsAtZa…](https://testnet.near.rocks/tx/FpDsAtZaQdRSZ6LiRKkkVDMwm9zXw6wtQ2FVGDXW3AB4) |
| **Off-chain compute in a TEE** (Phala TDX, on-chain attestation) | The deposit prover ran in a Phala TDX enclave, registered with an on-chain attestation check | [Deposit prover in a TEE](#deposit-prover-in-a-tee-phala-tdx) |
| **Reproducible builds** (NEP-330) and **contract events** (NEP-297) | Deployed code = CI's pinned-image build; every state change is an event indexers read | `verify.mjs` |
| **Yield/resume** (through the MPC) and **cross-contract callbacks** | Signatures and key derivations are requested by the contract and finished in callbacks that release the locks | every withdrawal |
| **Data APIs** (FastNear) | Activity feed, receipt monitor, NFT holdings on `#/mine` | home page, `scripts/receipt-monitor.mjs` |

Not used, on purpose: tokenized vaults, lockups and liquid staking don't fit an NFT that holds BTC; NEAR's on-chain price oracles were stale on testnet when checked, so prices are cross-checked across two APIs instead.

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
