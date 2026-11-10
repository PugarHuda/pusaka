# Pusaka market (draft)

A separate contract that trades and lends against Pusakas, priced off the BTC the v1 contract has
proven on-chain (`token_info(token_id).verified_sats`). It never trusts a `msg` beyond an id: every
fill and every loan reads `token_info` from the NFT contract first.

## Bids per verified sat

A bidder escrows enough NEAR for `max_sats` at `price_per_sat` and waits. Any holder whose Pusaka has
between `min_sats` and `max_sats` proven sats can sell into it in one call:

```
near call pusaka-market.testnet place_bid '{"price_per_sat_yocto":"1000000000000000","min_sats":"10000","max_sats":"100000","nft":"pusaka-btc.testnet"}' \
  --deposit <max_sats * price + 0.01> --accountId bob.testnet
near call pusaka-btc.testnet nft_approve '{"token_id":"1","account_id":"pusaka-market.testnet","msg":"{\"bid_id\":1}"}' \
  --deposit 0.001 --gas 300000000000000 --accountId alice.testnet
```

The market reads `token_info`, checks owner, sat range, no loan, listing or pending signature, then
calls `nft_transfer_payout` for exactly `verified_sats * price_per_sat`. The seller and the creator
royalty are paid from the escrow and the bidder gets the rest back. Any failure along the way puts
the bid back as it was and pays nothing. Once a Pusaka has an approval, the v1 contract refuses
BTC withdrawals, so its sats can't drop between the check and the sale.

## Perpetual callable loans (Blend-style)

A lender escrows `principal` (`offer_loan`). A holder takes it with
`nft_transfer_call(market, token, msg = {"accept_offer": N})`. The market checks `verified_sats >= min_sats`,
keeps the NFT and sends the principal. The market never asks for a signature, so the BTC stays put.
The loan has no due date. Interest is simple and accrues per ms. `repay` (by anyone) returns the NFT first, then pays the lender.

The lender can `call_loan` at any time. That opens a refinancing auction of `AUCTION_MS` (30 min on testnet,
24 h with `--features mainnet`). During it, the rate cap rises linearly from 0 to 1000 %/yr.
A new lender can `refinance` at any rate up to the current cap: they pay the old lender principal plus
interest and take over. If nobody does, the lender can `seize` the NFT once the auction ends. The
borrower can repay at any time until then.

`reserves()` sums open bid escrow, offer escrow, loans outstanding and storage deposits, and shows them
next to the contract balance. Every state change logs a NEP-297 `EVENT_JSON` with standard `pusaka-market`.

## Build and test

```
cd market
AWS_LC_SYS_PREBUILT_NASM=1 cargo test        # 40 unit tests, each named after the attack it stops
cargo near build non-reproducible-wasm --no-abi
```

## Limits (by design)

- Each bid, offer and loan carries a flat 0.01 NEAR storage deposit, refunded when the record is removed.
- `bids()` pages in insertion order and sorts each page by price. A UI builds the depth ladder from all pages.
- Payout entries that don't add up to the price, or that have more than 10 entries, are replaced by paying the seller the full price.
- A payment to an account that doesn't exist bounces back and stays in the market.
- The market pays the 1 yoctoNEAR each NFT transfer needs.
