# 03 — Smart contracts (Smart Contract Engineer)

Acuan: `01-tech-lead.md` (temuan B1–B9), `02-strategy.md` (fitur BANGUN: F2 halaman Refused, F3 framing TEE).
Putaran terakhir: 9 Nov 2026. Putaran sebelumnya (7 Nov: A1, A2, staking) ada di git history file ini.

## Ringkasan
- **Kode kontrak yang live tidak berubah, dan memang tidak perlu berubah.** Temuan B1–B9 tidak ada yang menyangkut kontrak,
  dan F2/F3 dikerjakan di frontend saja. Upgrade sudah di-renounce lewat DAO pada 8 Nov, jadi kode
  `pusaka-btc.testnet` final. Kalau ada perbaikan kontrak, itu harus jadi kontrak baru, dan keputusan itu ada di tim.
- Putaran ini menutup celah kualitas yang tercatat di laporan sebelumnya:
  - fuzz test dan invariant test (dulu "tidak ada");
  - coverage (dulu "tidak diukur"), sekarang **96,5 % baris**;
  - dokumentasi untuk setiap fungsi publik;
  - `deployments/testnet.json`;
  - laporan gas dari tx nyata.

## Standar kualitas → keadaan kontrak
| Diminta | Di Pusaka |
|---|---|
| Library teruji (padanan OpenZeppelin di NEAR) | `near-sdk` 5 dan `near-contract-standards` (NEP-171/177/178/181/199/297); transaksi BTC/EVM/NEAR dibangun dengan `omni-transaction` (Near-One) |
| Custom error | Panic dengan kode tetap (`NotOwner`, `Listed`, `SignPending`, `TooEarly`, `CodeMismatch`, `KeyAlreadySet`, `EvmAddressKnown`, …), masing-masing diuji dengan `should_panic(expected = …)`. Frontend menerjemahkannya jadi kalimat (`web/src/errors.js`) |
| Event untuk setiap perubahan state penting | Event NEP-297 (`nft_mint`, `nft_transfer`, `nft_metadata_update`) plus enum `Event` milik Pusaka (30 jenis, termasuk listing, sale, withdraw di semua chain, loan, heir, gift, staking, approval). Semua tercatat di history per NFT, dan upgrade punya event `upgrade_proposed` |
| NatSpec di setiap fungsi publik | Padanannya di Rust adalah rustdoc `///`. **80/80 fungsi `pub fn` sekarang terdokumentasi**; 21 yang tadinya belum (kebanyakan callback `#[private]` dan method NEP-178) ditambahkan di putaran ini |
| Access control | `assert_owner` dan `assert_free` di setiap jalur keluar aset; callback `#[private]`; admin upgrade dulu DAO + timelock, sekarang di-renounce; akun kontrak tanpa access key |
| Pausable / emergency stop | **Sengaja tidak ada.** Fungsi pause milik admin sama saja dengan kustodian yang bisa membekukan BTC orang. Penggantinya: `unlock_stale` (pemilik bisa membuka lock MPC yang macet), dulu timelock upgrade supaya pemegang sempat keluar, sekarang renounce |
| Checks-effects-interactions, tanpa reentrancy | NEAR itu asinkron. State dicatat **sebelum** promise: outpoint dan nonce floor dicatat sebelum MPC diminta menandatangani, dan token dikunci `SignPending`. Callback memulihkan state kalau gagal (`a3_…`, `s3_…`, `x2_…`); `inv1_…` menguji properti ini secara acak |
| Gas dan storage | Loop dibatasi: `MAX_PROVEN` 64 UTXO, history 32 entri, maksimal 3 staking pool, kembalian ≥ 1.000 sats. Storage dibayar pemanggil (`CHANGE_BYTES`, `POOLS_BYTES`) dan diuji tidak bisa dibebankan ke kontrak |

## Temuan yang di-fix / celah yang ditutup (9 Nov)
| ID | Apa | File |
|---|---|---|
| R3-1 | Fuzz test (proptest, 2.000 kasus): harga Dutch auction (`fz1`, `fz2`), pembagian royalti di seluruh rentang u128 (`fz3`), parser tx Bitcoin round-trip (`fz4`) dan byte jahat (`fz5`) | `contract/src/tests.rs` (`mod fuzz`), `Cargo.toml` (dev-dependency `proptest`, tidak masuk wasm) |
| R3-2 | Invariant test atas urutan acak bukti deposit, withdraw, dan jawaban MPC (sukses/gagal). Yang dijaga: `verified_sats` = jumlah UTXO terbukti yang tidak pernah ditandatangani; registry tanda tangan hanya bertambah dan tanpa duplikat; tidak ada token yang tertinggal `SignPending`; `sign_epoch` tidak pernah turun (`inv1`) | `contract/src/tests.rs` |
| R3-3 | 15 tes untuk jalur yang tidak tersentuh menurut laporan coverage: `evm_key`/`on_evm_key` (sukses, kunci beda, MPC gagal, dua kali, tanpa kunci BTC), `refresh_key`, view enumerasi NEP-181, `nft_revoke` per market, `cancel_upgrade`, `transfer_upgrade_admin`, validasi hash dan nama migrate (`cv1`–`cv7`) | `contract/src/tests.rs` |
| R3-4 | Dokumentasi `///` untuk 21 fungsi publik | `contract/src/lib.rs`, `contract/src/upgrade.rs` |
| R3-5 | Coverage diukur di CI setiap push (`cargo llvm-cov`, ringkasannya masuk ke summary run) | `.github/workflows/ci.yml` |
| R3-6 | `deployments/testnet.json`: kontrak, hash wasm, commit, tx deploy, tx renounce, akun DAO/relayer/TEE, dan semua kontrak sponsor yang dipakai. Dibaca `shared/btc.mjs`, jadi frontend, API, MCP, dan skrip memakai satu sumber | `deployments/testnet.json`, `shared/btc.mjs`, `.vercelignore` |

**Bukti bahwa kode kontrak tidak berubah:** `git diff 4bf36b2 -- contract/src ':!contract/src/tests.rs'` hanya berisi baris `///` baru, tanpa satu pun baris kode. Wasm yang dibangun dari HEAD punya hash berbeda, karena rustc menyimpan nomor baris untuk pesan panic dan dokumentasi menggeser nomor-nomor itu. Wasm yang di-deploy tetap build reproducible dari `4bf36b2` (sha256 `ac16e80e…`); `node scripts/verify.mjs` membuktikan ini terhadap chain.

## Kontrak dan akun
Semuanya ada di [`deployments/testnet.json`](../../deployments/testnet.json).

| Nama | Akun | Network | Explorer | Status |
|---|---|---|---|---|
| Pusaka (NEP-171 + BTC/EVM/SOL/NEAR via MPC) | `pusaka-btc.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-btc.testnet) | 0 access key, upgrade di-renounce (`GdASfxh5…`), wasm sha256 `ac16e80e…` = build reproducible commit `4bf36b2`, deploy `67hUwJuA…` |
| DAO upgrade (dulu admin) | `pusaka-council.sputnikv2.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-council.sputnikv2.testnet) | Sputnik v2. Perannya selesai di proposal 7 (renounce) |
| Pusaka v2 (+ akun milik NFT NEP-616, alias, kunci PQ ML-DSA-65) | `pusaka-v2.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-v2.testnet) | Upgrade lewat DAO + timelock 10 menit; wasm sha256 `d6c183da…` (proposal 9, `DbaTmJfi…`); masih ada 1 full-access key (lihat 05 V2-7). Rincian di [`deployments/testnet-v2.json`](../../deployments/testnet-v2.json) |
| Kontrak akun token (global, by hash) | `3xLVdgZA…` | NEAR testnet | publish `7nerp9Z3…` | `token-account/`, 43 KB, tanpa key, hanya mematuhi `pusaka-v2.testnet` |
| Agen TEE (deposit prover) | `pusaka-agent.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-agent.testnet) | Kontrak Shade Agent; attestation Phala TDX dicek on-chain |
| Relayer (bukan kontrak) | `pusaka-relayer.testnet` | NEAR testnet | [near.rocks](https://testnet.near.rocks/account/pusaka-relayer.testnet) | Gas key NEP-611, hanya me-relay method yang aman |

**Verifikasi source di explorer.** NEAR tidak punya verifier gaya Etherscan. Padanannya:
1. **NEP-330**: metadata build (image Docker yang disematkan lewat digest, commit, perintah) tersimpan on-chain di `contract_source_metadata`.
2. `cargo near verify` / SourceScan membangun ulang dari GitHub lalu membandingkan hash-nya.
3. `scripts/verify.mjs` menjalankan pembandingan yang sama di setiap run CI.

SourceScan dan `cargo near verify` mengambil source dari repo GitHub, jadi **langkah ini baru bisa jalan setelah repo dibuka public**. Itu blocker di tangan user (lihat B9).

**Deploy yang bisa diulang:** jalurnya lewat CI (`reproducible-wasm`), lalu `scripts/dao-upgrade.mjs` dan `scripts/upgrade.mjs`. Jalur ini sudah ditutup permanen oleh renounce. Untuk kontrak baru (misalnya mainnet), runbook-nya ada di `docs/MAINNET.md`: build `--features mainnet`, deploy, set admin DAO, lalu renounce.

## Hasil test dan coverage
| Jenis | Hasil |
|---|---|
| Unit + jalur revert | **265 lulus** (`cargo test`) dan **265 lulus** (`cargo test --features mainnet`) |
| Fuzz (proptest) | 5 properti: 2.000 kasus untuk fungsi murni, 256 untuk yang membangun kontrak per kasus (bisa dinaikkan lewat `PROPTEST_CASES`). Run 2.000 kasus penuh untuk semuanya juga lulus (728 s, 9 Nov) |
| Invariant | `inv1` (urutan acak ≤ 24 operasi, 256 urutan per run) |
| Coverage (`cargo llvm-cov`, `tests.rs` dikecualikan) | **Baris 96,48 %, fungsi 94,38 %, region 91,47 %** (target ≥ 90 % ✓). Per file: `art` 100 %, `btc` 99,4 %, `gift` 97,7 %, `lib` 95,8 %, `upgrade` 98,6 %, `usdc` 95,4 % (baris) |
| Fork test | NEAR tidak punya fork node gaya Anvil. Penggantinya lebih kuat: integrasi diuji langsung ke protokol sponsor yang hidup di testnet (MPC `v1.signer-prod.testnet`, light client `btc-client-v4.testnet`, Mintbase, staking pool factory, Omni nBTC). Tx-nya tercatat di tabel di bawah, dan `verify.mjs` mengecek ulang di setiap run CI. `near-workspaces` sandbox tidak bisa dipakai: tidak berjalan di Windows, dan MPC serta light client butuh node atau state yang tidak bisa di-fork |
| Analisis dependensi | `cargo audit` di CI. 1 advisory di-ignore dengan alasan: hanya ada di VM unit-testing, tidak ada di wasm |

Yang belum tercakup (sisa 3,5 % baris): `migrate()` (migrasi sekali jalan dari layout lama, sudah dieksekusi on-chain), beberapa cabang `unwrap_or_else` untuk jawaban MPC yang rusak, dan dua view USDC.

## Gas dan tx bukti alur utama (semua tx sukses nyata di `pusaka-btc.testnet`)
Dihitung dari **442 tx** yang terindeks di FastNear (`tx.test.fastnear.com`). Gas adalah total gas terbakar per tx, termasuk semua receipt dan callback; median dan maksimum per method. Biaya memakai harga gas testnet. Kolom terakhir adalah contoh tx median.

| Alur | Method | n | Gas median (TGas) | Maks | Biaya median (NEAR) | Tx bukti |
|---|---|---|---|---|---|---|
| Mint (+ kunci BTC dari MPC) | `nft_mint` | 21 | 14,88 | 16,74 | 0,00140 | `G1uHYXWaByoBigcW19Mc3KnFGdbtWGN16q6UX1RdmUcX` |
| Bukti deposit (light client) | `prove_deposit` | 15 | 8,56 | 45,88 | 0,00077 | `GfUJuAddBTmnJmCQ54cqKrAyJtGfKNfLiMYEytNWuXW3` |
| Listing | `list` | 41 | 3,01 | 4,50 | 0,00028 | `7MtfmWAiQx4AhymtAnTMQayrABBnEDDpuCH2AyYf9pjg` |
| **Beli (NFT + BTC pindah)** | `buy` | 18 | 4,91 | 9,73 | 0,00045 | `777q3S4PoiMTZhEEKekpLYGuiv6Tu5knGLuBB3itDDJ6` |
| Withdraw BTC (tanda tangan MPC) | `withdraw` | 22 | 15,99 | 16,85 | 0,00149 | `AWvTeeYffCVj5nPryLCrTURCczrXMtG7wULSWz5Zu2pp` |
| Withdraw ETH (EIP-1559) | `withdraw_eth` | 3 | 15,11 | 15,60 | 0,00140 | `EkRK4bbBqH1zLzCdXGCkWFiWikV7oEaEq2AneZvHuL2P` |
| Withdraw SOL | `withdraw_sol` | 3 | 23,24 | 23,29 | 0,00219 | `7aDGADF83uJhvdLsi4zx5X6H1nQPguNxDgZKSJGT5LD1` |
| Withdraw NEAR (akun implicit) | `withdraw_near` | 2 | 23,88 | 23,88 | 0,00223 | `8Gd2gbPfiReegf8SFToRqvUVbqhXr91yKtP9tkipJ5BJ` |
| Withdraw nBTC (Omni) | `withdraw_nbtc` | 1 | 24,10 | 24,10 | 0,00225 | `4tBAw8h5kR6pQsRrhQ6c9TSBJ56tWaz2kMMzFZWqYwQK` |
| Bukti USDC (MPC foreign-tx) | `prove_usdc_deposit` | 1 | 14,49 | 14,49 | 0,00136 | `FkQwHG2ZQ3EN7B1JD8jeVPqwGDHkqhaJ3iD8W4Pqd71m` |
| Minta pinjaman | `request_loan` | 21 | 3,02 | 3,47 | 0,00028 | `AZh9rfFJPisXrkhs7ee9bGpjBFaC7mJHhi6Zx8xEHiga` |
| Danai pinjaman | `fund_loan` | 8 | 3,44 | 7,24 | 0,00030 | `8XF2KkZnvM9WCDt2QAjKNiwXUmoG7oSPmaSiKt1RAdk` |
| Lunasi | `repay_loan` | 8 | 3,57 | 6,96 | 0,00031 | `G79qZEbiKazqqzYtyWa2XGPrEW19waaeUbc33Rp9t7hb` |
| Sita agunan (lewat jatuh tempo) | `claim_collateral` | 5 | 3,99 | 4,66 | 0,00038 | `C7B3BtXcYy6aUT4vYkuNhZuowDY5mCABwWT3nXK7L9oJ` |
| Penawaran pinjaman | `offer_loan` / `accept_loan_offer` | 21 / 7 | 3,45 / 5,08 | 3,54 / 6,09 | 0,00030 / 0,00044 | `AoqkEoyDYabQb6HT8Z7Zu2SzGC7SoqUoqby1NQYaQDYM` / `8uFttLyy4hMLFxmVkV3rKQCTq1fEFxL8QRBDPGieR6CJ` |
| Ahli waris | `set_heir` / `still_here` / `claim_inheritance` | 18 / 13 / 3 | 3,60 / 3,76 / 5,60 | 7,61 / 3,88 / 5,60 | 0,00032 / 0,00033 / 0,00051 | `EbuPRZhBs5KL4fuUKF6pvDhYwZhprKLKDnXJtHNCTr4N` / `BvrzBTo5Ej9bVaw7MhDi3LWx2WYSXJkD9MLD13gmSxa` / `4JXv66X9jJ735QyVQSywV8JCeRMKUihnnYJyJXvNF6bu` |
| Surat MPC (CKD) | `letter_key` / `set_letter` | 6 / 6 | 11,31 / 3,63 | 11,45 / 3,91 | 0,00106 / 0,00032 | `HakDbnyJqEKftxmBoGiyqnrD6YTg7T2Q5LBTdEEwmWQJ` / `AzdwD8kG5a6WKSKv1T8qV4jPdYttj3nbxLPkgvRgS4Wv` |
| Gift link (NEP-452) | `gift` | 3 | 6,84 | 6,98 | 0,00062 | `ECr8JMYHVf58Actw2VjHKNMFzG3ndJeyj3X7UCH2KiuG` |
| Staking NEAR milik NFT | `stake_near` | 3 | 25,48 | 25,49 | 0,00239 | `H9hm7pKcsYBU5kj35DZPYCjsDohdt9U2CNbeQAyWyCxg` |
| Market luar (NEP-178/199, Mintbase) | `nft_approve` / `nft_transfer_payout` | 3 / 1 | 7,29 / 12,94 | 7,33 / 12,94 | 0,00066 / 0,00118 | `HK7ski1JBYfEKdZoEFkQSHtJuwGts6ZCcUPhwcZ1hMGS` / `CCxgRJ7iwKccnTEwpToZNC9hg3BW17tqqD5oj2X9VXcB` |
| Upgrade lewat timelock / renounce | `apply_upgrade` / `renounce_upgrades` | 9 / 1 | 95,99 / 9,24 | 101,28 / 9,24 | 0,00955 / 0,00083 | `HfGrfHNv22hEJABuSFUKZzhfADHMgBQeiDpxbczX3zbi` / `GdASfxh5Xr6UCGeg5LPTXsH3SCn4aWvCLGUqPWNDGa6N` |

Catatan gas:
- Method termahal memanggil MPC (withdraw di semua chain, `stake_near`, `letter_key`). Gas yang dibayar untuk MPC sudah termasuk di angka di atas; deposit MPC (1 yocto) bukan gas.
- `prove_deposit` maksimum 45,88 TGas terjadi pada tx Bitcoin dengan banyak input/output: parsing-nya linier terhadap ukuran tx dan dibatasi oleh gas yang disertakan pemanggil.
- `apply_upgrade` mahal (≈ 96 TGas) karena men-deploy ±628 KB wasm. Sekarang tidak bisa dipanggil lagi.
- **Transfer kepemilikan BTC lewat `buy` hanya 4,91 TGas (≈ 0,00045 NEAR), tanpa fee Bitcoin.** Inilah inti produknya.

Script yang menghasilkan tabel ini ada di run sesi 9 Nov dan memakai logika yang sama dengan `scripts/receipt-monitor.mjs`: daftar tx akun dari `/v0/account`, receipt dari `/v0/transactions`. Untuk mengecek satu hash, buka `https://testnet.near.rocks/tx/<hash>`.

## Tidak dikerjakan, dengan alasan
| Item | Alasan |
|---|---|
| Fungsi baru di kontrak | Tidak ada fitur BANGUN yang butuh kontrak, dan kode final setelah renounce. Kontrak baru = keputusan tim (mainnet F1) |
| Pausable | Lihat tabel standar: pause milik admin = kustodian |
| Verifikasi SourceScan | Butuh repo public (blocker user) |
| Fork test | Lihat tabel test: diganti uji live terhadap protokol sponsor yang sebenarnya |
