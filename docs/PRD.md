# PRD — Pusaka

> **NFT yang memegang Bitcoin asli. Wariskan NFT-nya, BTC-nya ikut.**
> *Pusaka: NFTs that hold real Bitcoin. Pass it on, and the BTC goes with it.*

| | |
|---|---|
| Status | Draft v1 — 2 Nov 2026 |
| Event | NEAR HACKATHON (nearhackathon.com), deadline **14 Nov 2026 23:59 UTC** |
| Track submit | `nfts` (utama), `defi`, `open` |
| Jaringan | NEAR testnet + Bitcoin testnet4 |


> **Catatan implementasi (2 Nov 2026, setelah spike):**
> - Spike hari 1 **berhasil**: kontrak memanggil `sign` di `v1.signer-prod.testnet` lintas kontrak (deposit 1 yocto/panggilan) dan tx hasilnya diterima Bitcoin testnet4.
> - Alamat diganti dari P2PKH ke **P2WPKH (BIP143)** — `omni-transaction` 0.5 mendukung sighash SegWit, dan nilai input ikut ditandatangani.
> - Kunci BTC diambil kontrak sendiri via `derived_public_key` di kontrak MPC (callback `on_key`), bukan dari input user (T6).
> - Tambahan dari review keamanan: txid dikanonisasi + outpoint duplikat ditolak (T3b); minter/penarik membayar storage; history dibatasi 32 entri.
> - Hasil ukur: buy ≈ 3.0 s sampai final; tanda tangan MPC 6.8–13.7 s. Status terkini ada di README.

---

## 1. Ringkasan

Pusaka adalah koleksi NFT (NEP-171) di NEAR di mana **setiap token memiliki alamat Bitcoin asli** yang diturunkan lewat **NEAR Chain Signatures**. Alamat itu dikendalikan oleh kontrak Pusaka, dan kontrak hanya mau meminta tanda tangan MPC atas perintah **pemilik NFT saat ini**. Akibatnya, kepemilikan BTC berpindah bersama NFT, dalam satu transaksi NEAR (~1 detik), tanpa bridge, tanpa wrapped token, tanpa kustodian, dan tanpa private key yang bisa disimpan diam-diam oleh pemilik lama.

---

## 2. Latar belakang & masalah

Memindahkan kepemilikan BTC hari ini selalu mengorbankan sesuatu:

| Cara | Masalah |
|---|---|
| Transaksi on-chain Bitcoin | 10–60 menit konfirmasi, fee, dan butuh saling percaya selama proses (siapa kirim duluan?) |
| Wrapped BTC (WBTC, dll.) | Bergantung kustodian/bridge — titik retas dan sensor |
| Serahkan private key / seed | Pemilik lama bisa menyimpan salinan; tidak ada jaminan |
| NFT-wallet di Ethereum (ERC-6551) | Hanya bisa memegang aset di chain-nya sendiri, bukan BTC asli |

**Insight:** Chain Signatures membuat sebuah *kontrak* NEAR bisa memiliki alamat Bitcoin asli. Jika kontrak itu juga kontrak NFT, maka "siapa pemilik BTC ini" cukup ditentukan oleh "siapa pemilik NFT ini" — state yang berpindah atomik di NEAR.

---

## 3. Tujuan & non-goals

### Tujuan (hackathon)
1. Membuktikan end-to-end di testnet: mint → isi BTC → jual atomik → pembeli tarik BTC.
2. Menegakkan bahwa **pemilik lama tidak bisa mengambil BTC setelah NFT berpindah** (lihat §8), dengan test untuk tiap skenario.
3. Dapat direproduksi juri (Claude Code / Codex + manusia) dalam **≤ 10 menit** tanpa mencari faucet BTC.

### Non-goals (MVP)
- Mainnet / dana sungguhan.
- Light client Bitcoin on-chain (verifikasi UTXO dilakukan klien, lihat §8.3).
- Integrasi marketplace eksternal (NEP-178 approvals sengaja tidak diimplementasi).
- Alamat SegWit/Taproot (MVP memakai P2PKH, lihat §7.4).
- Aset selain BTC (EVM/SOL bisa nanti dengan mekanisme yang sama).

---

## 4. Persona & use case

| Persona | Kebutuhan | Use case di Pusaka |
|---|---|---|
| **Trader OTC** | Jual posisi BTC besar tanpa saling percaya | Listing NFT berisi 0.5 BTC, pembeli bayar → NFT pindah atomik |
| **Pemberi hadiah / warisan** | Memberi BTC yang bisa diwariskan tanpa membocorkan seed | Mint Pusaka, isi BTC, transfer NFT ke penerima |
| **Peminjam (P2)** | Menjaminkan BTC asli tanpa bridge | Pusaka sebagai kolateral di protokol lending NEAR |

**Use case utama untuk demo:** OTC — penjual dan pembeli yang tidak saling kenal.

---

## 5. Ruang lingkup fitur

### P0 — wajib ada untuk submit
| ID | Fitur |
|---|---|
| F1 | Mint NFT Pusaka (NEP-171 core + metadata) |
| F2 | Derivasi alamat BTC per token (path = `pusaka-{token_id}`), ditampilkan di UI |
| F3 | Baca saldo & UTXO alamat token dari Bitcoin testnet4 (mempool.space API) |
| F4 | **Tarik (withdraw):** kontrak menyusun tx BTC, cek pemilik, minta tanda tangan MPC per UTXO, kembalikan tx siap broadcast |
| F5 | **Listing** dengan harga NEAR; listing mengunci withdraw |
| F6 | **Beli atomik:** bayar NEAR → penjual dibayar + NFT pindah dalam satu transaksi |
| F7 | **Pending lock:** saat tanda tangan sedang diproses, transfer/listing ditolak |
| F8 | **Signed-outpoint registry:** kontrak mencatat setiap UTXO yang pernah ditandatangani |
| F9 | **Safe balance:** UI menghitung saldo aman = UTXO belum terpakai yang *tidak pernah* ditandatangani |
| F10 | Riwayat per token: pemilik, penjualan, penarikan |
| F11 | `npm run demo` + NFT demo yang sudah berisi BTC testnet |

### P1 — jika waktu cukup
| ID | Fitur |
|---|---|
| F12 | Transfer hadiah (`nft_transfer`) dengan halaman "terima Pusaka" yang menampilkan safe balance |
| F13 | Hosted demo di Vercel (tetap online s.d. 25 Nov) |
| F14 | Visual NFT dinamis: gambar berubah sesuai jumlah BTC di dalamnya |

### P2 — roadmap (ditulis di README, tidak dibangun)
- Bayar dengan aset dari chain mana pun via **NEAR Intents**
- Light client Bitcoin on-chain untuk verifikasi UTXO trustless
- SegWit/Taproot, multi-aset (ETH/SOL), Pusaka sebagai kolateral lending

---

## 6. User stories & acceptance criteria

**US1 — Mint**
Sebagai user, saya mint Pusaka dan langsung melihat alamat BTC-nya.
- AC: `nft_mint` sukses → `btc_address(token_id)` mengembalikan alamat P2PKH testnet yang sama dengan hasil derivasi off-chain (chainsig.js).
- AC: Dua token berbeda selalu punya alamat berbeda; token yang sama selalu alamat yang sama.

**US2 — Isi saldo**
Sebagai pemilik, saya kirim BTC testnet ke alamat token dan saldo muncul di UI.
- AC: Saldo dan daftar UTXO tampil ≤ 30 detik setelah tx masuk mempool.

**US3 — Tarik**
Sebagai pemilik, saya menarik BTC ke alamat mana pun.
- AC: Hanya `owner_of(token)` yang bisa memanggil; akun lain → panic `NotOwner`.
- AC: Tx hasil kontrak valid dan diterima jaringan testnet4 (txid bisa dicek di mempool.space).
- AC: Setiap outpoint input tercatat di signed-outpoint registry.

**US4 — Listing**
Sebagai pemilik, saya listing Pusaka dengan harga N NEAR.
- AC: Saat listed, `withdraw` dan `nft_transfer` ditolak (`Listed`).
- AC: `cancel_listing` membuka kembali withdraw.
- AC: Listing ditolak jika token sedang `SignPending`.

**US5 — Beli**
Sebagai pembeli, saya melihat safe balance lalu membeli.
- AC: `buy` dengan deposit ≥ harga → penjual menerima NEAR, NFT pindah ke pembeli, listing terhapus — dalam satu transaksi.
- AC: `buy` menerima parameter `expected_signed_count`; jika registry berubah sejak pembeli memeriksa → gagal (`StateChanged`).
- AC: Setelah beli, penjual lama memanggil `withdraw` → `NotOwner`.

**US6 — Verifikasi pembeli**
Sebagai pembeli, saya tahu berapa BTC yang benar-benar aman.
- AC: UI menampilkan **Safe balance** dan **At-risk balance** (UTXO yang pernah ditandatangani tapi belum terpakai) secara terpisah, dengan penjelasan.

---

## 7. Spesifikasi teknis

### 7.1 Arsitektur

```
┌──────────────┐      ┌────────────────────────────┐      ┌─────────────────────────┐
│ Frontend     │─────▶│ Kontrak pusaka.testnet      │─────▶│ MPC signer              │
│ Next.js      │      │ (Rust, near-sdk)            │◀─────│ v1.signer-prod.testnet  │
│ wallet-      │      │ - NEP-171                   │ sig  │ (Chain Signatures)      │
│ selector     │      │ - listing & buy atomik      │      └─────────────────────────┘
│              │      │ - susun tx BTC (omni-tx)    │
│              │      │ - locks + outpoint registry │
│              │      └────────────────────────────┘
│              │── saldo/UTXO/broadcast ──▶ Bitcoin testnet4 (mempool.space/testnet4/api)
└──────────────┘
```

### 7.2 State kontrak

```rust
struct Pusaka {
    tokens: NonFungibleToken,                    // near-contract-standards NEP-171
    listings: LookupMap<TokenId, Listing>,       // { price: NearToken, seller: AccountId }
    pending: LookupSet<TokenId>,                 // token yang sedang menunggu tanda tangan MPC
    signed_outpoints: LookupMap<TokenId, Vector<OutPoint>>, // { txid: [u8;32], vout: u32 }
    history: LookupMap<TokenId, Vector<Event>>,  // Mint | Sale | Withdraw | Transfer
    mpc_contract: AccountId,                     // v1.signer-prod.testnet
}
```

### 7.3 Method

| Method | Akses | Deskripsi |
|---|---|---|
| `nft_mint(receiver_id)` | publik, deposit storage | Mint token baru |
| `btc_path(token_id) -> String` | view | `"pusaka-{token_id}"` |
| `listing(token_id)` / `signed_outpoints(token_id)` / `history(token_id)` | view | Data untuk UI & verifikasi |
| `withdraw(token_id, utxos: Vec<Utxo>, to: String, amount, fee)` | pemilik | Cek lock → susun tx → tandai `pending` → panggil MPC `sign` per input → callback |
| `on_signed(token_id, ...)` | private callback | Hapus `pending`, catat outpoint, kembalikan signature/raw tx; jika MPC gagal → hapus `pending` saja |
| `list(token_id, price)` | pemilik | Tolak jika `pending` |
| `cancel_listing(token_id)` | pemilik | |
| `buy(token_id, expected_signed_count)` | publik, deposit = harga | Bayar penjual + transfer NFT + hapus listing, atomik |
| `nft_transfer(...)` | NEP-171 | Ditolak jika `pending` atau listed |

**Aturan inti:** kontrak **tidak pernah** menandatangani hash yang diberikan user. Hash selalu dihitung kontrak dari tx yang ia susun sendiri, sehingga setiap tanda tangan terikat ke outpoint yang tercatat.

### 7.4 Bitcoin

- **Jenis alamat:** P2PKH testnet (legacy). Alasan: `omni-transaction-rs` (v0.3) menyediakan `build_for_signing_legacy(EcdsaSighashType::All)` dengan contoh P2PKH; SegWit belum terdokumentasi jelas → ditunda ke P2.
- **Kunci:** public key turunan dari MPC master key + (akun kontrak, path) → di-hash ke alamat P2PKH. Derivasi dicek silang dengan chainsig.js di test.
- **Tanda tangan:** ECDSA secp256k1, **satu panggilan `sign` per UTXO input** (sesuai contoh resmi).
- **Input UTXO:** disuplai frontend (dari mempool.space). Kontrak tidak bisa memverifikasi keberadaannya; jika user berbohong, tx sekadar tidak valid di Bitcoin dan yang rugi hanya pemanggil.
- **Broadcast:** frontend merakit signature ke tx lalu `POST /tx` ke mempool.space testnet4.

### 7.5 State machine token

```
          list()                    buy()
  Idle ────────────▶ Listed ───────────────▶ Idle (pemilik baru)
   │  ▲              │
   │  │ on_signed()  │ cancel_listing()
   │  │              ▼
   │  └──────── SignPending ◀── withdraw()  (hanya dari Idle)
   └──── nft_transfer() ──▶ Idle (pemilik baru)   (hanya dari Idle)
```

---

## 8. Threat model

Pertanyaan utama: **bagaimana pemilik lama bisa mencoba tetap mengambil BTC setelah NFT berpindah?**

| # | Serangan | Mitigasi | Ditegakkan oleh | Test |
|---|---|---|---|---|
| T1 | Tarik BTC tepat sebelum NFT terjual | Listing mengunci withdraw | Kontrak | `withdraw_while_listed_fails` |
| T2 | Minta tanda tangan, langsung transfer/jual NFT sebelum MPC menjawab | Status `SignPending` memblokir transfer/listing/buy | Kontrak | `transfer_while_pending_fails` |
| T3 | **Pre-signed tx:** minta tanda tangan, tidak broadcast, jual NFT, broadcast belakangan | Semua outpoint bertanda tangan dicatat on-chain; pembeli hanya menghitung UTXO yang **tidak pernah** ditandatangani sebagai *safe balance* | Kontrak (registry) + klien (perhitungan) | `outpoints_recorded_on_sign`, test UI safe balance |
| T4 | Mengubah keadaan antara pembeli memeriksa dan membeli | `buy(expected_signed_count)` gagal jika registry berubah | Kontrak | `buy_with_stale_count_fails` |
| T5 | Akun lain meminta tanda tangan untuk token orang | Cek `predecessor == owner_of(token)`; path hanya bisa dipakai oleh akun kontrak Pusaka | Kontrak + MPC | `non_owner_withdraw_fails` |
| T6 | Menandatangani hash sembarang lewat kontrak | Kontrak hanya menandatangani sighash dari tx yang ia susun | Kontrak | review kode + `no_raw_hash_entrypoint` |
| T7 | Pengirim BTC tak dikenal "mengotori" token | Tidak berbahaya: UTXO tambahan hanya menambah saldo | — | — |

### 8.3 Batasan yang ditulis jujur di README
- Kontrak NEAR tidak bisa membaca state Bitcoin. Status "UTXO sudah terpakai" diverifikasi **klien** lewat indexer (siapa pun bisa memverifikasi ulang dengan node Bitcoin sendiri). Upgrade: light client Bitcoin on-chain (P2).
- Keamanan bergantung pada jaringan MPC NEAR (asumsi threshold).
- Kontrak di testnet dideploy dengan full access key milik tim; untuk produksi, key harus dihapus/di-lock agar kode tidak bisa diganti diam-diam.

---

## 9. Spesifikasi frontend

| Halaman | Isi |
|---|---|
| `/` Galeri | Kartu tiap Pusaka: gambar, safe balance BTC, harga jika listed, badge `Listed` / `Pending` |
| `/pusaka/[id]` Detail | Alamat BTC (+ QR), safe vs at-risk balance, daftar UTXO, riwayat; tombol sesuai peran: **Isi**, **Tarik**, **Listing/Batal** (pemilik) atau **Beli** (orang lain) |
| `/mint` | Tombol mint + instruksi mengisi BTC testnet4 |
| Modal Beli | Rincian safe balance, peringatan jika ada at-risk, konfirmasi harga |

Prinsip: satu momen jelas per layar; istilah teknis disembunyikan, penjelasan keamanan tersedia di tooltip "Kenapa aman?".

---

## 10. Kebutuhan non-fungsional

| Area | Target |
|---|---|
| Reproduksibilitas | Clone → `npm install` → `npm run demo` → melihat alur jual-beli lengkap, ≤ 10 menit, tanpa API key dan tanpa faucet BTC (memakai token demo yang sudah berisi) |
| Test | `cargo test` / `npm test` satu perintah; semua skenario §8 tercakup |
| Keamanan repo | Tidak ada secret di repo; key di `.env` (contoh di `.env.example`) |
| Lisensi | MIT, file `LICENSE` |
| Ketersediaan demo | Hosted demo online s.d. 25 Nov 2026 |

---

## 11. Metrik keberhasilan (untuk README & demo)

Juri hackathon NEAR sebelumnya menuntut angka. Yang akan kita ukur dan laporkan:

| Metrik | Target |
|---|---|
| Waktu transfer kepemilikan BTC (buy → NFT pindah) | ≤ 2 detik (1 tx NEAR) vs ±10–60 menit on-chain Bitcoin |
| Biaya transfer kepemilikan | < $0.01 gas NEAR, 0 fee Bitcoin |
| Latensi tanda tangan MPC per UTXO | diukur & dilaporkan |
| Cakupan threat model | 7/7 skenario punya test, semua lulus |
| Waktu reproduksi juri | ≤ 10 menit |

---

## 12. Pemetaan ke kriteria juri

| Kriteria | Bukti di Pusaka |
|---|---|
| Screening AI (jalan & sesuai README) | `npm run demo`, test satu perintah, README format "do X → see Y" |
| Implementasi teknis | Tx BTC disusun on-chain, locks, outpoint registry, test threat model |
| Orisinalitas | NFT yang memegang BTC asli — tidak ada di 62 submission per 2 Nov |
| Dampak | OTC BTC trustless, hadiah/warisan, kolateral |
| NEAR leverage | Chain Signatures + kontrak sebagai penjaga + transfer atomik — mustahil tanpa kustodian di chain lain |
| Desain / kejelasan | "Saya menjual 0.01 BTC asli dalam 1 detik dengan mentransfer sebuah NFT" |
| Track NFT ("ownership with behavior", threat model transfer) | §8 dijawab lengkap dengan test |

---

## 13. Rencana demo & submission

### Video demo (≤ 90 detik)
1. **(0–10s)** Masalah: "Memindahkan BTC = menunggu konfirmasi atau percaya kustodian."
2. **(10–25s)** Pusaka #1 berisi 0.01 BTC testnet — tunjukkan alamatnya di mempool.space.
3. **(25–45s)** Penjual listing → pembeli (browser kedua) lihat safe balance → klik Beli → NFT pindah ~1 detik.
4. **(45–60s)** Penjual lama coba tarik → ditolak `NotOwner`.
5. **(60–80s)** Pembeli tarik BTC → txid muncul di mempool.space.
6. **(80–90s)** "Hanya mungkin di NEAR: Chain Signatures." + link repo.

### Draft post X
> Selling Bitcoin usually means waiting for confirmations or trusting a custodian.
> Pusaka: NFTs that hold real BTC (not wrapped). Sell the NFT → the Bitcoin moves with it, in ~1 second.
> Built at NEAR HACKATHON with Chain Signatures. Repo + demo 👇 What would you put inside one?
> @NEARProtocol @NearBuilders @NearLegion #NEARHackathon

### Kerangka README
1. Apa itu Pusaka (2 kalimat) · 2. Coba dalam 5 menit (do X → see Y) · 3. Cara kerja + diagram · 4. Threat model & batasan · 5. Fitur NEAR yang dipakai · 6. Metrik · 7. Struktur repo & cara test · 8. Library & AI yang dipakai (aturan Q-005) · 9. Lisensi

### Payload submit
`tracks: ["nfts","defi","open"]` — data pribadi (nama, email, alamat `.near`, link post X) diisi oleh tim, **tidak dikarang**.

---

## 14. Timeline

| Hari | Tanggal | Target | Exit criteria |
|---|---|---|---|
| 1 | 3 Nov | **Spike kelayakan** | Kontrak testnet memanggil MPC `sign` dan tx BTC testnet4 hasilnya diterima jaringan. **Gagal → pivot** ke ide cadangan (DAO treasury lintas chain) |
| 2–3 | 4–5 Nov | NEP-171, derivasi alamat, withdraw + cek pemilik | US1, US3 lulus |
| 4–5 | 6–7 Nov | Listing, buy atomik, pending lock | US4, US5 lulus |
| 6 | 8 Nov | Outpoint registry, `expected_signed_count` | T3, T4 lulus |
| 7 | 9 Nov | Lengkapi test threat model | 7/7 test lulus |
| 8–9 | 10–11 Nov | Frontend: galeri, detail, beli, tarik, safe balance | Alur demo jalan di browser |
| 10 | 12 Nov | Deploy, token demo berisi BTC, `npm run demo`, hosted demo | Reproduksi dari clone bersih ≤ 10 menit |
| 11 | 13 Nov | README, ukur metrik, rekam video, draft post X | Semua materi siap |
| 12 | 14 Nov | Buffer → repo public → post X → submit (target **< 18:00 UTC**) | Respon 201 dari API submit |

---

## 15. Risiko & pertanyaan terbuka

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Format API `sign` kontrak MPC (argumen, deposit, gas) berbeda dari dugaan | Blokir F4 | Dicek di spike hari 1 dari repo `near-examples/near-multichain` & kontrak MPC |
| `omni-transaction-rs` gagal compile ke WASM / sighash salah | Blokir F4 | Cadangan: frontend menyusun tx, kontrak memverifikasi & mencatat outpoint yang dideklarasikan (lebih lemah, ditulis di README) |
| Kontrak memanggil MPC lintas kontrak (bukan dari wallet user) belum ada contoh resmi | Blokir F4 | Prioritas #1 spike; cari contoh di repo NEAR examples |
| Latensi MPC lambat | Demo terasa lambat | Demo jual-beli tidak butuh MPC; MPC hanya di withdraw |
| Faucet BTC testnet4 sulit | Juri tak bisa coba | Token demo yang sudah diisi tim |
| Waktu habis | Tidak submit | P1/P2 dipotong duluan; submit hari 12 sebelum 18:00 UTC |

**Pertanyaan terbuka:**
1. Tim solo atau lebih? (menentukan apakah F13/F14 realistis)
2. Nama akun kontrak testnet (mis. `pusaka.testnet`) — perlu dibuat tim.
3. Harga listing dalam NEAR saja, atau juga USDC testnet?

---

## Lampiran A — Fakta teknis terverifikasi (2 Nov 2026)

- MPC signer: testnet `v1.signer-prod.testnet`, mainnet `v1.signer`.
- Alamat turunan = f(akun pemanggil, path, master key MPC); akun lain tidak bisa mengendalikan alamat yang sama.
- Bitcoin memakai `Ecdsa` (secp256k1); contoh resmi memakai mempool.space **testnet4** dan **satu `sign` per UTXO**.
- `omni-transaction = "0.3"`: `TransactionBuilder::new::<BITCOIN>()`, `build_for_signing_legacy(EcdsaSighashType::All)`, `build_with_signature(...)`. Catatan: contoh di README-nya memakai `hex.as_bytes()` untuk scriptPubKey (byte ASCII, bukan hasil decode) — jangan disalin mentah.

Sumber: docs.near.org/chain-abstraction/chain-signatures/implementation · github.com/near/omni-transaction-rs · github.com/near-examples/near-multichain · github.com/NearDeFi/chainsig.js · nearhackathon.com/HACKATHON.md
