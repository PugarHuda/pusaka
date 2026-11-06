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

One NFT is a whole set of wallets: the same MPC key that holds its Bitcoin also controls one address on every EVM
chain (ETH and USDC on Ethereum, Base and Arbitrum), and a second, Ed25519 MPC key is both a **Solana address** and the
Pusaka's **own NEAR account**. Sell the NFT and all of it moves at once, with a sealed letter only the current holder
can read and a 2.5% royalty for the creator on every resale.

It is a standard NEAR NFT, so it trades outside our app too: NEP-178 approvals and NEP-199 payouts let any NEAR
market sell it (tested live on Mintbase's market), and the contract freezes the BTC for as long as a market may sell it.

**Judges and screeners:** [JUDGES.md](JUDGES.md) is a five-minute path; `node scripts/verify.mjs` checks every claim below against NEAR, its MPC signer, its Bitcoin light client and Bitcoin, with no wallet.

*Pusaka* is Indonesian for an heirloom: a valued object passed from hand to hand.

Built at NEAR HACKATHON (Nov 2026). Tracks: NFTs That Do Something, Unstoppable DeFi, Open Innovation.

| | |
|---|---|
| Contract | [`pusaka-btc.testnet`](https://testnet.near.rocks/account/pusaka-btc.testnet) (NEAR testnet) |
| MPC signer | `v1.signer-prod.testnet` (NEAR Chain Signatures) |
| Bitcoin network | testnet3 ([mempool.space/testnet](https://mempool.space/testnet)), the network NEAR's Bitcoin light client tracks |
| Bitcoin light client | [`btc-client-v4.testnet`](https://testnet.near.rocks/account/btc-client-v4.testnet) (Near-One / Omni Bridge), verifies every deposit on-chain |
| Live demo | **https://pusaka-two.vercel.app** (or run locally, below) |

## Try it in two minutes (testnet wallet only)

1. Open **https://pusaka-two.vercel.app**, click *Connect NEAR wallet* and pick Meteor (testnet; new accounts get faucet NEAR).
2. **Buy:** Pusaka #4 is for sale at 0.5 NEAR with 10,000 sats verified on NEAR (#10, #11 and #15 are listed the same way, in case a judge before you bought it). Click *Buy*. **See:** "You own Pusaka #4", and you can now *Withdraw* its BTC to any `tb1…` address.
3. **Lend:** Pusaka #1 asks to borrow 0.5 NEAR, repaying 0.501 within 3 days (about 24% a year), backed by 90,946 verified sats (loan-to-value about 3%); #12, #13 and #14 ask the same, backed by 10,000 sats each. The page also shows what the collateral would sell for right now through NEAR Intents. Click *Lend*. **See:** the loan funded, the Pusaka locked as collateral, and *Take the Pusaka* once it's overdue.
   Stock runs out? `node scripts/restock.mjs` mints new demo Pusakas, funds each with 10,000 sats from #1's own BTC (a real withdrawal), proves them through the light client and lists them; re-run it after a Bitcoin confirmation (it needs the demo account's key, so it is for us, not for judges).
4. **No wallet at all?** Any Pusaka with a confirmed, unproven deposit proves itself when you open it; the relayer pays.

## Try it

Requirements: Node 22+, and Rust + `cargo-near` only if you want to rebuild the contract.

### 1. Run the unit tests (offline; ~4 min on a cold build, ~10 s after) — Rust

```sh
cd contract && cargo test
```

See: `181 passed`. They cover every attack in the [threat model](#why-the-seller-cant-keep-the-bitcoin) (tests named `t1_…` to `t5_…`, `m…` for markets, `l…` loans, `p…` proofs, `s…` Solana, `a…` the NEAR account, `h1_letter…`–`h4_…` the sealed letter, `h1_heir…`–`h10_…` the heir, `x…` `nft_transfer_call`, `o…` the loan market, `up…` timelocked upgrades) plus storage and input validation.

### 2. Run the full flow against the deployed contract (~3 min)

```sh
npm install
npm run demo
```

What happens, step by step (all on NEAR testnet + Bitcoin testnet3, against the deployed contract; the numbers match what the script prints):

0. Two fresh NEAR accounts are created through the public NEAR testnet faucet. **See:** `created pusaka-s-….testnet`.
1. The seller mints a Pusaka. The contract fetches its Bitcoin key from the MPC contract on-chain. **See:** a `tb1q…` address.
2. **The one manual step:** send testnet3 BTC to that address, e.g. one click at [coinfaucet.eu/en/btc-testnet](https://coinfaucet.eu/en/btc-testnet/) (one request per IP per 12 h; any testnet3 faucet works). The script waits for **1 Bitcoin confirmation**, then calls `prove_deposit`: the contract parses the transaction, checks it pays this Pusaka, and the on-chain light client verifies the merkle proof. **See:** `proven by btc-client-v4.testnet: true` and `verified on NEAR: … sats`.
3. The seller lists it for 1 NEAR, then tries to withdraw. **See:** `rejected (Listed)`.
4. The buyer checks the safe balance and buys. **See:** `sold in ~3s — new owner: pusaka-b-…`. Nothing happened on Bitcoin.
5. The old owner tries to withdraw. **See:** `rejected (NotOwner)`.
6. The new owner withdraws 1000 sats. The contract builds the Bitcoin transaction, the MPC network signs it, the script verifies each signature locally and broadcasts. **See:** a `mempool.space/testnet/tx/…` link that the Bitcoin network accepted.
7. The buyer borrows 0.5 NEAR against the Pusaka and the seller lends it. **See:** the borrower's withdrawal rejected with `Collateralised`.
8. The loan isn't repaid in time and the lender takes the Pusaka with its BTC. **See:** the lender as the new owner.

Already have accounts in `.keys/` and a funded token? `npm run demo -- --token 1 --seller a.testnet --buyer b.testnet` skips steps 0–2.

### 2b. End-to-end checks against the live app (~3 min)

```sh
npx playwright install chromium   # once, on a fresh machine
npm run e2e -w web                # Playwright, against https://pusaka-two.vercel.app
```

See: `28 passed` (home, first paint without the bundle, loan offer book, detail, not-found recovery, keyboard skip link and focus on navigation, phone layout, no-wallet actions, relayer and API input checks, on-chain NFT image, outside-market listings, EVM/SOL/NEAR accounts, holder room, reserves and badges, nBTC, heir section, security headers, the NEAR Intents exit quote, the Your Pusakas page, and that the demo stock and the relayer's balance are there). Read-only: no wallet, no transactions. CI runs it on every push and once a day.

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
| A sealed letter for the next holder | AES-256-GCM, server key | `set_letter` + `/api/holder` | travels in `metadata.extra`; opens for the current holder only |

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

Try it: `node scripts/holder-test.mjs` (creates two faucet accounts and mints a Pusaka, then signs NEP-413 messages: the holder gets in; a non-holder, a
stale or non-numeric timestamp, a signature made for another site, and a key presented for the wrong account are refused).
`node scripts/handover.mjs` mints a Pusaka from a fresh account, seals a letter, sells it twice and checks the 2.5% royalty and the room changing hands. Both run from a clean clone (no keys needed).

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

Tools: `pusaka_overview`, `pusaka_inspect` (verified BTC, USD value, ETH safe/at-risk, listing premium, loan LTV/APR, sign epoch), `pusaka_buy`, `pusaka_fund_loan`, `pusaka_repay_loan`, `pusaka_claim_collateral`, `pusaka_list`, `pusaka_cancel_listing`, `pusaka_request_loan`, the loan market (`pusaka_loan_offers`, `pusaka_offer_loan` with a max-LTV guard, `pusaka_cancel_loan_offer`, `pusaka_accept_loan_offer`, which also refinances a funded loan with a capped top-up, `pusaka_repay_partial`, `pusaka_propose_extension`, `pusaka_accept_extension`), `pusaka_prove_deposits`, `pusaka_withdraw_btc`, `pusaka_withdraw_eth` (ETH or USDC on any of its EVM chains), `pusaka_withdraw_sol`, `pusaka_withdraw_near` (its own NEAR account), `pusaka_withdraw_nbtc`, `pusaka_give`, `pusaka_mint`, `pusaka_set_heir`, `pusaka_still_here`, `pusaka_claim_inheritance`. An agent can move everything a Pusaka holds. **Verified live through an MCP client (4 Nov):** [ETH on Sepolia](https://sepolia.etherscan.io/tx/0xd514c72366e9aa13de1223433544563848e00f020e2b1bef0e98388b35c4e9ed), [SOL on devnet](https://explorer.solana.com/tx/4oNMntvxmefB9L2jEdcmR3UNZC8xq2y2R4zFs18rbk5GhutjKCigezYfL6oLwFS27WnH6V1Uji3CuQi7Dp7ffuqE?cluster=devnet), [NEAR from #5's own account](https://testnet.near.rocks/tx/3YxDKPdAdp9Uy3J4dCojGechY1sXygXHCawwQtTEyk1D), and `pusaka_give` moved #7; it refused a nonexistent receiver, a malformed EVM address and more SOL than the Pusaka holds.
Guard rails the agent can't talk its way around: tools that move a Pusaka or its assets out (`pusaka_give`, `pusaka_withdraw_*`) are off unless the operator sets `PUSAKA_ALLOW_OUTFLOWS=1`, optionally limited to `PUSAKA_ALLOWED_RECIPIENTS`; a per-session NEAR spend cap, `max_price_near` on buys, `max_ltv` on loans (it refuses collateral with no verified BTC), and the same sign-epoch / loan-terms binding as the web app.
**Remote, no install:** point any MCP client at `https://pusaka-two.vercel.app/api/mcp` (Streamable HTTP) for the read-only tools (`pusaka_overview`, `pusaka_inspect`, `pusaka_loan_offers`); check it with `node mcp/remote-smoke.mjs`. Trading tools stay local so the agent's key never leaves its machine.
**Try:** `npm run smoke -w mcp` (read tools and guards) and `node mcp/trade.mjs <seller> <buyer> <id> <price>`. On testnet one agent listed Pusaka #1 for 0.3 NEAR and another bought it under a 0.35 NEAR cap.

## Gas-free actions: NEP-366 relayer

`api/relay.mjs` (Vercel function) accepts a borsh `SignedDelegate` and submits it from a relayer account that pays the gas. It only relays calls to the Pusaka contract, only `list`, `cancel_listing`, `request_loan`, `cancel_loan_request`, `claim_collateral`, `still_here`, `claim_inheritance` and `accept_loan_offer`, never with a deposit. `api/prove.mjs` proves a token's confirmed deposits through the light client with the relayer paying, which is what the web app's *Prove for free* button calls, so a visitor with no wallet can still make a deposit count.
**Can't be farmed:** the relayer only pays for calls that will succeed and can't be looped: `claim_collateral` only once the loan is overdue; `accept_loan_offer` only when the contract would take it (owner, offer fits the token and its sign epoch, nothing listed, approved or in flight, a refinance only when the offer alone pays it off), for offers of at least 0.01 NEAR, once a minute per Pusaka (`api/_relayer.test.mjs`); `list`/`cancel_listing`/`request_loan`/`cancel_loan_request` at most once a minute per Pusaka (read from its on-chain history; sooner, the app asks the wallet to pay); the same signed delegate posted twice in parallel is relayed once (409 for the copy); `still_here` once an hour; relayer-paid USDC proofs stop at 4 per Pusaka (each leaves 0.002 NEAR of storage), after which the holder proves and pays. Verified live 6 Nov: early `claim_collateral` 403, parallel duplicate 409, relist 3 s after a cancel 429.
**Borrow with no NEAR at all:** a Bitcoin holder's first NEAR can be a loan. The home page lists the standing offers (escrowed principal, yearly rate, which Pusakas qualify; `restock.mjs` keeps one open), and taking one is gas-free. **Verified with a real wallet** (Intear, `node web/e2e/wallet-qa.mjs <profile> accept pusaka-buyer.testnet 15`): one approval, the relayer signed the transaction and the 0.05 NEAR principal arrived [8Pt8bY1b…](https://testnet.near.rocks/tx/8Pt8bY1bzhHJKjiKPG3EmRtPF2dgGZQgp4WXZN3G5iBC) (signer `pusaka-relayer.testnet`, delegate from `pusaka-buyer.testnet`).
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

Only chains the MPC verifies count (Base and Arbitrum; Ethereum L1 isn't among them). The encoding is pinned to a live
answer: the MPC verified a Base Sepolia USDC transfer ([BKeg9y2v…](https://testnet.near.rocks/tx/BKeg9y2vhjfYKggRj7Y5PLiFgPTsxHmE7havcxaKchk4))
and test `u1` reproduces its `payload_hash` byte for byte. Hardening: one marker per deposit with no list cap (dust can't
crowd out deposits), a 0.01 USDC minimum, and proofs are refused for a token that signed on that chain before the counter
existed. Try: `node scripts/prove-usdc.mjs <payer.testnet> <token_id>`; the relayer's *Prove for free* also proves USDC.

## Deposit prover in a TEE: Shade Agent

`shade/agent.mjs` is the relayer's prover run as a [Shade Agent](https://github.com/NearDeFi/shade-agent-framework) in a Phala Cloud TDX enclave. On boot it registers on the agent contract `pusaka-agent.testnet` (the framework's reference contract, `requires_tee: true`). The contract verifies the TDX quote and accepts the agent only if its measurements (OS image, firmware, KMS, and the hash of `shade/docker-compose.yaml`, which pins the image by digest) and its hardware PPID are on the approved list. After that, a key generated inside the enclave proves every Pusaka's confirmed BTC deposits through the same `proveToken()` as `api/prove.mjs`. Nobody, including us, ever holds that key.
**Verified on testnet (4 Nov 2026):** [register_agent](https://testnet.near.rocks/tx/4Pxmp4gyPBe4tnmMqJA1GkrdiCr1ZHVjfh8UvtEjhNtA) from `eaf0205d…2fbc` (`get_agent` on `pusaka-agent.testnet` returns `"validity": "Valid"`, PPID `62d54040…`). The same account then proved [#1's 153,946 sats](https://testnet.near.rocks/tx/GrSm25nCftxzjPREtaMKzgqryU3QNMpzuq4P51nt1Mys) and [#5's 10,000 sats](https://testnet.near.rocks/tx/92rQg2ceP4iwg62CPBkERhUaWPacTNSiAPzaVHLCQAhM), both from BTC tx [c6c1dd60…](https://mempool.space/testnet/tx/c6c1dd60deb538f3a5007f4239643534b8ba7428d472d70e2002ac15330ca9b0). The CVM (tdx.small) ran for about 3 minutes and was deleted afterwards. The Vercel relayer still proves deposits day to day.
**How it was deployed:** CI builds the image (`.github/workflows/shade-image.yml`, actions pinned by SHA) and the agent-contract wasm. `shade deploy` (CLI 2.4.0) deployed the contract and approved the PPIDs. The CLI only knows how to measure dstack 0.5.7/0.5.8, and Phala has disabled both images, so `node shade/deploy-tee.mjs` deploys on dstack 0.5.12 instead. It computes the app-compose hash locally, as the CLI does, and checks it against the enclave's event log; it reads only the OS/firmware RTMRs from the running enclave's quote, then approves the result.
**Limits:** taking the RTMRs from the quote trusts Phala's 0.5.12 image on first use rather than recomputing it from a reproducible build. The image is built non-reproducibly. The agent contract's owner key (`pusaka-shade.testnet`) is not deleted.

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
| T20 | Use the Pusaka's NEAR account to call some other contract (or approve one) before selling | From that account the contract signs only a `Transfer` or one `ft_transfer` on the nBTC contract with 1 yocto; it never signs `AddKey`, other calls or approvals | `a1_near_tx_layout`, `b1_nbtc_tx_is_one_ft_transfer_on_the_nbtc_contract_with_one_yocto` |
| T25 | Swap in new contract code that drains the Pusakas, with no warning | The contract account needs no key: code only changes through `apply_upgrade`, which deploys only bytes whose sha256 the admin announced at least `UPGRADE_DELAY_MS` earlier (10 min testnet, 7 days mainnet), and only the contract itself can name the admin | `up1_*`–`up8_*` |
| T9 | A failed callback leaves the token locked forever | After ~600 blocks the owner can `unlock_stale`; safe because outpoints were recorded before signing | `unlock_stale_waits_for_timeout`, `unlock_stale_releases_after_timeout` |

`nft_transfer_call` locks the token until it resolves (T8), and NEP-178 approvals freeze every asset (T13), so no marketplace or third party can move a Pusaka around these locks.

T3 (late signatures), T7–T9 and T11–T12, and the ETH part of T4, were found by independent review passes during QA and fixed with the tests above.

**Limits, stated plainly**

- **What is trustless:** the *verified* balance. A deposit counts only after `btc-client-v4.testnet` (a Bitcoin SPV light client on NEAR) has verified its merkle proof and the contract has checked the output pays this Pusaka. Only this contract can get signatures for the address and it records each one, so a proven, never-signed UTXO can't have been spent. A buyer or lender needs nothing but the contract's `verified_sats`.
- **What isn't:** mempool.space is still used to *find* deposits and build proofs, failing over to Blockstream's Esplora on timeouts and 5xx (any Esplora works; a lying API can only make a proof fail). Light-client security assumptions apply: it follows the most-work chain it is fed by relayers, so a deep reorg attack is bounded by the confirmations required (1 on testnet, 6 on mainnet).
- Security rests on the NEAR MPC network's threshold assumption.
- **Code changes are public and delayed.** The contract only takes new code through a timelock (`contract/src/upgrade.rs`): the admin account `pusaka-admin.testnet` can only announce a wasm's sha256; anyone can deploy those exact bytes, but no earlier than 10 minutes later (7 days on mainnet), so holders see it coming (`upgrade_status`, an `upgrade_proposed` event) and can withdraw or sell first. `renounce_upgrades` makes the code final. Exercised live on 6 Nov: announcement, an early deploy refused on-chain (`TooEarly`, [EHX5b1cp…](https://testnet.near.rocks/tx/EHX5b1cpU4pzpfu4DA5TEZL3db95dQ5NqSRRdgtQuqoh)), other bytes refused (`CodeMismatch`, [25pi2EER…](https://testnet.near.rocks/tx/25pi2EER5uaAZ93Ph5eCnwboPiTmi1ocd8SEr5gD5ZEX)), and after the delay the announced build deployed by a third account [EAw1ppZ5…](https://testnet.near.rocks/tx/EAw1ppZ53hzsQ3CRTQYnAVGxFnEvdnhCAdyd44P9XKqh). The contract account's own full-access key is the last way around the timelock; `node scripts/upgrade.mjs lock` deletes it, and `node scripts/verify.mjs` reports whether any key is left.
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
| Deposits proven from inside a TDX enclave (Shade Agent on Phala, attestation checked on-chain) | [register_agent](https://testnet.near.rocks/tx/4Pxmp4gyPBe4tnmMqJA1GkrdiCr1ZHVjfh8UvtEjhNtA), then `prove_deposit` [GrSm25nC…](https://testnet.near.rocks/tx/GrSm25nCftxzjPREtaMKzgqryU3QNMpzuq4P51nt1Mys) and [92rQg2ce…](https://testnet.near.rocks/tx/92rQg2ceP4iwg62CPBkERhUaWPacTNSiAPzaVHLCQAhM) from the enclave's own key, 6 s after registering |
| Verifiable build (NEP-330): `contract_source_metadata` names the repo, NEP-171/177/178/181/199/297/330 and `build_info` (image `sourcescan/cargo-near:0.21.1-rust-1.96.1@sha256:86bd…`, commit `2f3c8ac`); the deployed wasm is the one CI's `reproducible-wasm` job built | sha256 `d30f2964a0a2c423a3aef8781f6c71da0dfb89d90de8453324969f64385052bd`, deployed in [HAYZb6un…](https://testnet.near.rocks/tx/HAYZb6unixW6giBy8cBekwPTtmKXrZNdjPCWb9LeqcSt), redeployed through the timelock [EAw1ppZ5…](https://testnet.near.rocks/tx/EAw1ppZ53hzsQ3CRTQYnAVGxFnEvdnhCAdyd44P9XKqh) |
| Provenance on Bitcoin: every contract-built withdrawal ends with `OP_RETURN pusaka:<id>` | [1a22075f…](https://mempool.space/testnet/tx/1a22075fb9c04bcef4e413ba01c2c91fe1b658665a32807f24261e9dcb68e5e1): 5,000 sats from #5 to #2, change back, `OP_RETURN 707573616b613a35` = `pusaka:5` |
| USDC attested by NEAR MPC foreign-transaction verification (Base Sepolia, finalized block) | [FkQwHG2Z…](https://testnet.near.rocks/tx/FkQwHG2ZQ3EN7B1JD8jeVPqwGDHkqhaJ3iD8W4Pqd71m): `on_usdc_proven` true; `usdc_info(5)` verified 0.01 USDC |
| Native BTC to nBTC (Omni Bridge) held by the NFT, sent with an MPC-signed `ft_transfer` | deposit [236e5f21…](https://mempool.space/testnet/tx/236e5f21cf6b5816ac494a42eead18f4fd12df3b1e7c1502fa49a1c72ec15998), 3,300 nBTC minted to #5's NEAR account, [FbT94gnj…](https://testnet.near.rocks/tx/FbT94gnj4G5RqqrrhHMJQ9Fh1SNoeXeyChfUU3m3tivi) sent 1,000 |
| Unit tests | 181 / 181 passing, on the testnet and the mainnet build |
| Demo stock refilled from a Pusaka's own BTC (`scripts/restock.mjs`): #1 funded five new Pusakas with 10,000 sats each, all proven by the light client and listed | [8bfd559a…](https://mempool.space/testnet/tx/8bfd559ab7c7dd3241ae54a7669a192840b28d40235fad3e98d2bfb4932829bf) and four more chained withdrawals; #1's change ([92a51d2a…](https://mempool.space/testnet/tx/92a51d2a7a328692cee0c286f837f5e339dee2ac4bf297a37988db93d421d57b)) re-proven, 101,446 sats |
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
shade/      Shade Agent: TEE deposit prover, agent contract, compose/deploy config
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
