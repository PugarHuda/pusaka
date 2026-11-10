# 05 — Security (Web3 Security Auditor)

Acuan: `03-contracts.md`, `04-dapp.md`. Threat model lengkap (T1–T27, tiap baris punya tes): README "Why the seller can't keep the Bitcoin".
Putaran 2 (9 Nov) mengaudit permukaan baru sejak putaran 1:
- NEAR AI appraisal (`api/appraise.mjs`, `api/_nearai.mjs`);
- sealed files;
- "Check it yourself";
- `deployments/testnet.json`;
- dependensi baru `@phala/dcap-qvl`.

Scanner dijalankan ulang di semua komponen.

## Tabel temuan (putaran 2, 9 Nov)
| ID | Komponen | Severity | Dampak | PoC / bukti | Status |
|---|---|---|---|---|---|
| R5-1 | Verifikasi TEE NEAR AI (`api/_nearai.mjs`) | **Tinggi** | Quote yang ternyata bukan laporan TDX hanya mencatat cek TCB; kalau cek itu lulus, laporan dianggap `ok` dan penandatangannya diterima. Akibatnya jawaban AI bisa ditandai "Verified" tanpa bukti TEE | `api/_nearai.test.mjs`: quote sampah → `ok=false`, `signer=null` | **Fixed** `34b723e`: fail closed (tanpa TD report, tidak ada cek yang lolos), signer hanya dikembalikan kalau report data mengikatnya |
| R5-2 | Verifikasi TEE NEAR AI | Sedang | Bukti GPU (NVIDIA NRAS) diperiksa tapi tidak ikut menentukan status "verified" | review kode | **Fixed** `34b723e`: model dihitung hanya kalau TDX **dan** GPU lulus |
| R5-3 | Holder room (`api/_holder.mjs`, padanan SIWE) | Sedang | Nonce NEP-413 tidak sekali pakai. Tanda tangan yang tersadap (XSS di tab lain, ekstensi jahat, log proxy) bisa membuka holder room lagi selama ≤ 5 menit | `api/_holder.test.mjs`: nonce yang sama ditolak di dalam jendela | **Fixed** (putaran ini): nonce dicatat setelah tanda tangan terverifikasi, berlaku sampai tanda tangan kedaluwarsa. Sisa: per instance serverless (lihat known issues) |
| R5-3b | Holder room (perbaikan R5-3) | Sedang | Decoder base64 Node longgar: ejaan lain dari nonce yang sama (spasi, tanpa padding, huruf url-safe) lolos dari pengecekan berbasis string | `api/_holder.test.mjs` (varian ejaan) | **Fixed** `e282809`: hanya base64 kanonik yang diterima, dan catatan replay memakai byte nonce |
| R5-4 | Sealed files (CKD) | Sedang | Kunci file mengikuti *path* surat yang sedang berlaku; pemegang lama yang pernah membuka room bisa menyimpan kunci itu dan membuka file yang disegel setelah NFT dijual | review keamanan otomatis | **Fixed (UI)** `204f1cb`: halaman menyebut pembuat kunci, memperingatkan kalau bukan pemegang sekarang, dan meminta segel surat baru (memutar kunci MPC). Kontrak final, jadi pemutaran otomatis saat transfer tidak mungkin |
| R5-5 | Appraisal AI (integritas tampilan) | Rendah | LLM salah hitung ("21.5% discount" padahal 78.5% di bawah nilai) | appraisal live #4 | **Fixed** `7ef6ffe`: persentase dan LTV dihitung server, model hanya mengutip; live #10 benar ("67.7% below") |
| R5-6 | `/api/appraise` (biaya) | Rendah | Pemanggilan berulang menghabiskan kredit NEAR AI | `live.spec` "refuses bad ids before spending anything" | **Mitigated**: id divalidasi (400) dan dicek ada (404) sebelum model dipanggil; cache 15 menit per status token; maks 60/jam per instance; ±$0,0002 per appraisal |
| R5-7 | Header HTTP | Rendah | Tidak ada `Permissions-Policy` | `curl -I` | **Fixed**: `camera=(), microphone=(), geolocation=(), payment=(), usb=()`; diuji `live.spec` "security headers" |
| R5-8 | Dependensi npm | Rendah | `elliptic` (GHSA-848j-6mx2-7j84): tanda tangan ECDSA salah kalau `k` berawalan nol. Ini soal **pembuatan** tanda tangan, sedangkan kita hanya **memverifikasi** quote | `npm audit` | **Known issue, tidak berlaku.** Pengganti WASM (`@phala/dcap-qvl-node` 0.3.3) dicoba lalu **ditolak**: terkena GHSA-796p-j2gh-9m2q (**critical**, identitas QE tidak diverifikasi, belum ada perbaikan). `@phala/dcap-qvl` 0.7.1 sudah di atas versi yang diperbaiki |
| R5-9 | Kontrak agen TEE (`shade/agent-contract`) | Info | Lockfile memuat 17 crate dengan advisory | `cargo audit` + `cargo tree --target wasm32-unknown-unknown -e normal -i <crate>` | Hanya `anyhow` (*unsound* di `downcast_mut`, tidak dipanggil) dan `wee_alloc` (unmaintained) yang masuk wasm; sisanya tooling host/test. `dcap-qvl` 0.4.0 ≥ 0.3.9, jadi tidak terkena GHSA-796p |
| R5-10 | Provenance image NEAR AI | Info (eksternal) | Konfigurasi terukur model mengizinkan `${COMPOSE_MANAGER_IMAGE:-…}` diganti env var | `node api/_nearai.test.mjs` mencetak peringatannya | **Ditampilkan** di halaman sebagai provenance note; verifikasi Sigstore tidak dikerjakan (known issue) |

## Putaran 3 (9 Nov): Pusaka v2 (`pusaka-v2.testnet`, `contract/src/v2.rs`)
| ID | Komponen | Severity | Dampak | PoC / bukti | Status |
|---|---|---|---|---|---|
| V2-1 | Kunci PQ vs `nft_transfer_call` | Sedang | `nft_transfer_call` yang di-revert penerimanya tetap menghapus kunci ML-DSA pemegang, jadi kunci PQ bisa dilepas tanpa unlock | tes `v2_review_fixes` | **Fixed**, DAO proposal 8, `apply_upgrade` `C2Dgr5iW…` |
| V2-2 | Kunci PQ vs approval lama | Sedang | Approval yang dibuat sebelum kunci PQ didaftarkan tetap bisa memindahkan token tanpa unlock | tes `pq_key_needs_no_standing_approvals` | **Fixed**, proposal 8: `set_pq_key` menolak (`Approved`) selama masih ada approval |
| V2-3 | `account_call` (async) | Sedang | Token bisa di-list saat panggilan dari akunnya masih berjalan, sehingga NEAR bisa keluar setelah pembeli membayar | tes `account_call_locks_the_token_until_its_callback` | **Fixed**, proposal 8: kunci `pending` dipegang sampai callback |
| V2-4 | Callback `on_account_call` | Rendah | Callback yang datang terlambat (setelah `unlock_stale`, >600 blok) bisa melepas kunci operasi yang lebih baru | tes `a_late_callback_leaves_a_newer_lock_alone` | **Fixed**, proposal 9 (`DbaTmJfi…`): kunci ditandai block height, callback hanya melepas kuncinya sendiri |
| V2-5 | Web `#/v2` | Rendah | Seed ML-DSA disimpan di `sessionStorage`, jadi terbaca oleh XSS di origin yang sama | review keamanan otomatis | **Fixed** `5f1b0a4`: seed hanya di memori komponen; pemegang menempel dari file kunci |
| V2-6 | Cakupan PQ | Info | Kunci BTC/EVM/SOL (MPC secp256k1/Ed25519) dan kunci surat (CKD/BLS) belum post-quantum | dokumentasi | **Known issue**: MPC NEAR belum punya skema PQ; BIP-360 masih draft |
| V2-7 | Kunci akses penuh `pusaka-v2.testnet` | Sedang | Selama kunci masih ada, pemiliknya bisa deploy kode tanpa DAO/timelock | `viewAccessKeyList` | **Dijadwalkan 13 Nov** (keputusan user; tidak bisa dibatalkan) |
| V2-8 | F8: agen menghabiskan isi akun NFT, atau reset budget dengan revoke lalu grant ulang | Sedang | Kontrak membatasi per hari UTC + daftar penerima + token harus bebas; revoke menyimpan catatan pengeluaran hari itu (bug ini ditemukan tes `f8_regranting_does_not_reset_todays_spending` sebelum deploy); budget hilang saat NFT pindah tangan | 9 tes `f8_*` + 4 tolakan live di `#/refused` | **Fixed** (proposal 10) |
| V2-9 | `account_call` memberi hak yang bertahan setelah NFT dijual | Tinggi (kalau akun NFT punya saldo di NEAR Intents atau memegang NFT lain) | Pemegang lama bisa menyuruh akun `0s…` mendaftarkan kunci miliknya di verifier Intents (`add_public_key`) atau memberi approval, lalu memakainya setelah pembeli membayar | tes `v2_9_*` + tolakan live `AccountGrant` | **Fixed**, proposal 11: `account_call` menolak nama method yang memuat approve/key/allow/grant/delegate. Batas: dicocokkan lewat nama method; kontrak lain yang memberi hak lewat nama lain tidak tertangkap |
| V2-10 | F9 sign-in sebagai NFT bertahan setelah penjualan | Sedang | Penjual membuat sign-in (berlaku 1 jam) tepat sebelum listing, lalu memakainya setelah pembeli membayar; pesan yang diserahkan ke pihak yang salah bisa dipakai login sebagai NFT di domain itu | review keamanan otomatis atas proposal 11; tes `v2_10_*`; tolakan live `SignedIn` `2Bc5HUNU…` | **Fixed**, proposal 12 + 13: `sign_in` hanya saat token bebas; selama sign-in berlaku (siapa pun pemegangnya sekarang), `list`, `nft_approve`, `nft_transfer_call` (market, NEAR Intents), `request_loan` dan `accept_loan_offer` ditolak (`SignedIn`); catatan tidak dihapus saat transfer, jadi memindahkan NFT ke akun kedua tidak menghapusnya (celah ini ditemukan review otomatis atas proposal 12); teks dibangun kontrak dari field yang divalidasi sehingga tidak bisa jadi transaksi atau payload Intents (JSON); MCP hanya untuk domain di `PUSAKA_SIGN_IN_DOMAINS` plus konfirmasi manusia. Sisa: (1) transfer biasa dan gift link tetap boleh (penerimanya tidak membayar); (2) **sesi yang diberikan situs** setelah memverifikasi pesan bisa lebih lama dari 1 jam, dan kontrak tidak bisa melihat atau mengakhirinya (review otomatis ke-3). Opsi lanjutan, belum dibangun: catat domain sign-in on-chain dan tampilkan ke pembeli, lockout lebih panjang |
| V2-11 | Pusaka B diparkir di akun milik NFT A; lewat `account_call` penjual memasang gift link / listing / pinjaman / ahli waris / budget agen atas B, menjual A, lalu mengambil B | **Tinggi** | Pembeli A membayar B beserta BTC-nya, lalu kehilangan B | review adversarial 10 Nov (PoC 9 tes di scratchpad), tes `v2_11_*`, tolakan live `FC3P4S5y…` | **Fixed**, proposal 14: akun NFT hanya boleh `nft_transfer` Pusaka yang dipegangnya. Sekalian: `auth` masuk denylist (mematikan auth predecessor di verifier Intents akan membekukan saldo), transfer ke akun milik token itu sendiri ditolak (`OwnAccount`), budget agen dihapus pada `nft_transfer_call`, `saturating_sub` setelah budget diturunkan, gate sign-in di `gift` |
| V2-11b | Jalan pintas V2-11: akun NFT v2 memegang Pusaka v1 (atau NFT kontrak lain) dan memasang perintah di sana; Pusaka yang sedang sign-in dititipkan ke akun NFT lain lalu ikut terjual | Tinggi / Sedang | Sama seperti V2-11 | review keamanan otomatis atas proposal 14; tes `v2_11_no_standing_order_on_a_pusaka_held_from_another_contract`, `v2_11_a_signed_in_pusaka_cant_be_tucked_into_another_pusakas_account` | **Fixed**, proposal 15: `account_call` memakai **allowlist** method (transfer NEAR/FT/NFT/MT, penarikan Intents, storage, wNEAR, staking) untuk semua receiver; ini juga menutup batas "dicocokkan lewat nama" di V2-9. `nft_transfer` ke akun `0s…`/`t<id>.` menunggu sign-in habis |
| V2-12 | Callback MPC lama (`on_signed`, `on_eth_signed`, `on_near_*`, `on_sol_*`) melepas kunci `pending` tanpa cek siapa yang memasangnya | Rendah | Hanya bila callback MPC terlambat >600 blok lalu ada operasi baru | review adversarial | **Known**: hanya `on_account_call` yang memakai `since`; v1 final jadi tidak bisa diubah |
| V2-13 | `name_account` kedua kali kehilangan 0,02 NEAR (refund ke kontrak) | Rendah | Kesalahan pengguna sendiri | review adversarial | **Known** |
| V2-14 | F12 beli dengan BTC: dua pembeli membayar untuk penjualan yang sama; pembayaran lama dipakai untuk reservasi baru; ahli waris mengambil NFT saat pembeli sedang membayar; penjual membatalkan saat pembeli membayar | Tinggi | Pembeli kehilangan BTC | tes `f12_*` (11), tolakan live `CVmWWhPF…`, `2EJXR7nx…`; pembelian live dengan BTC asli `n6DRSP8j…` (bukti ulang ditolak) | **Fixed by design**: reservasi + bond 0,1 NEAR (satu pembeli per kali), OP_RETURN mengikat kontrak/token/pembeli/nonce, callback hanya menyerahkan NFT bila nonce dan pembeli masih sama, `cancel_btc_listing` dan klaim ahli waris menunggu reservasi habis. Review otomatis atas proposal 16 menemukan dua celah, ditutup proposal 17: nonce reservasi dulu mulai ulang di setiap listing (pembayaran lama bisa diputar ulang setelah dijual kembali ke alamat yang sama), sekarang nonce per token tidak pernah berulang; pembeli yang sudah bayar tapi buktinya terlambat bisa digeser, sekarang ada masa tenggang bukti 6 jam setelah batas bayar. Proposal 18 (review atas 17): txid Bitcoin yang sudah membeli Pusaka ditolak selamanya (celah migrasi: reservasi lama tanpa penghitung nonce), dan serah-terima mengecek penjual masih pemiliknya (kalau tidak, bond kembali ke pembeli, tanpa panic). Sisa: pembeli yang membayar setelah batas bayar + tenggang kehilangan pembayaran |
| V2-15 | F10 BIP-322: tanda tangan yang bisa dipakai sebagai transaksi nyata | Tinggi bila salah | Kontrak membangun sendiri `to_spend`/`to_sign` (input outpoint nol, tidak bisa ditambang); caller hanya memberi teks pesan satu baris, diawali token/pemegang/blok NEAR | tes vektor resmi BIP-322 (Rust dan JS) | **By design** |
| V2-16 | F14 vault: kunci NEAR curian langsung memindahkan/menguras Pusaka; vault dimatikan oleh pencuri; recovery = akun milik NFT sendiri | Tinggi | Pusaka + BTC | tes `f14_*` (14) | **Fixed by design** (proposal 19): gate vault ada di `assert_pq`, jadi semua aksi owner menunggu delay; mematikan vault juga aksi owner; recovery bisa clawback selama delay; vault hanya bisa dipasang pada Pusaka bebas (tanpa listing/pinjaman/gift/approval); recovery tidak boleh akun NFT itu sendiri. Review adversarial sebelum deploy menemukan dua celah, ditutup sebelum proposal 19: (a) delay vault ≥ jam ahli waris membuat ahli waris bisa mengklaim Pusaka pemegang yang masih hidup → delay + 10 menit wajib ≤ setengah `after_ms`, dicek dua arah; (b) market yang mengembalikan agunan lewat `nft_transfer` menghapus vault dan kunci PQ → dipertahankan bila kembali ke pemilik yang memasangnya. Sisa (desain): recovery dipercaya penuh (bisa menarik Pusaka kapan pun selama bebas); anggaran agent yang dipasang sebelum vault tetap berjalan sebatas plafon hariannya |
| V2-17 | F15 covered call: penulis menguras BTC/akun NFT saat opsi terbuka; pembeli opsi membeli terhadap BTC yang sudah berubah; ahli waris mengambil Pusaka saat opsi dibeli | Tinggi | Pembeli opsi | tes `f15_*` (11) | **Fixed by design**: opsi terbuka mengunci Pusaka lewat `lock_reason` (withdraw, account_call, jual, pinjam, transfer, sign-in); `buy_call` terikat sign epoch; `write_call` menaikkan epoch; exercise membayar seperti penjualan (royalti); klaim ahli waris menunggu opsi yang sudah dibeli kedaluwarsa |
| X-1 | x402 (`pusaka_paid_audit`): server menjawab 402 kedua dengan harga/penerima lain dan klien membayarnya; regex aset `wrap.` tidak ketat; URL dari prompt mengarahkan bayaran ke server lain | Sedang | Saldo wNEAR agen | review keamanan otomatis | **Fixed**: syarat yang dicek dikunci pada percobaan berbayar, aset harus persis `wrap.testnet`/`wrap.near`, origin endpoint harus sama dengan `PUSAKA_AUDIT_URL`, redirect ditolak, `payTo` dikunci; tetap di bawah spend cap + konfirmasi |
| M-1 | Market (`pusaka-market.testnet`): isi bid ganda, payout palsu dari kontrak NFT, peminjam/pihak ketiga menaruh Pusaka orang lain, seize sebelum lelang selesai, refinance saat repay berjalan | Tinggi | Dana escrow bidder/lender | 45 tes di `market/src/tests.rs`, tolakan live `SatsOutOfRange` `Bv3LX3M5…` | **Fixed by design**: bid ditandai `filling` sebelum panggilan async; harga dihitung ulang dari `verified_sats` on-chain; payout tidak pernah melebihi harga; `sender_id == previous_owner_id`; flag `busy` per loan. Kunci akun market dihapus 13 Nov bersama v2 |
| M-3 | Market pool (kurva linear): escrow kurang untuk fill berikutnya; fill ganda; bid lama rusak setelah upgrade | Sedang | Escrow bidder | tes `pool_*` (5), review adversarial | **Fixed by design**: escrow = fills × max_sats × harga (harga hanya turun), `filling` mengunci; kurva di raw storage per bid sehingga layout bid lama tidak berubah (bid #5 tetap terbaca setelah redeploy); live: #15 dijual ke pool `44Uqfe1X…`, pool tetap terbuka satu langkah lebih rendah |
| M-2 | Market: callback kehabisan gas meninggalkan bid dalam status `filling` | Rendah | Bid tidak bisa dibatalkan | review kode | **Known**: gas statis disetel untuk seluruh rantai (≈105 TGas); tidak ada pintu darurat |

## Scanner: sebelum vs sesudah
| Alat | Putaran 1 (8 Nov) | Putaran 2 (9 Nov) |
|---|---|---|
| Slither / Aderyn | tidak berlaku (khusus Solidity) | tidak berlaku. Padanan Rust/NEAR: `cargo audit`, `clippy`, fuzz/invariant (`03-contracts.md`), review manual |
| `cargo audit` kontrak (300 crate) | 0 vuln (1 di-ignore beralasan, host-only) | **0 vuln**; 2 peringatan unmaintained (`wee_alloc`, `unsafe-libyaml`), host/test saja |
| `cargo audit` kontrak agen TEE (549 crate) | tidak dijalankan | 17 crate ber-advisory, hanya 2 di wasm (R5-9) |
| `cargo clippy --all-targets` | tidak dijalankan | 6 peringatan gaya (borrow tak perlu, `assert_eq!` bool, indentasi doc), 0 terkait keamanan. Tidak diubah: kode kontrak final dan harus sama dengan yang ter-deploy |
| `npm audit` | 0 | 2 low (R5-8, tidak berlaku); critical dari paket alternatif dihindari |
| Secret di git history (218 commit) | 0 | **0**. Pola: private key NEAR ed25519/secp256k1, `sk-…` (NEAR AI), PEM, `ghp_`, hex 32-byte (semua yang ketemu = hash tx publik), mnemonic. `.keys/` tidak pernah ter-commit; key NEAR AI hanya ada di env Vercel (Secret) |
| Secret di bundle client | 0 | **0**. Hex 32-byte di bundle = konstanta kurva publik (generator secp256k1, prima medan) |
| Header live | HSTS, CSP frame-ancestors, XFO, nosniff, Referrer-Policy | + Permissions-Policy (R5-7) |

## Putaran 1 (8 Nov, tetap berlaku)

## Review manual kontrak
| Kelas | Status di Pusaka | Tes / bukti |
|---|---|---|
| Reentrancy (async NEAR) | state dicatat sebelum promise; token dikunci `SignPending`; callback gagal → pulih | `a3_…`, `s3_…`, `x2_…`, T2, T9 |
| Access control | `assert_owner` + `assert_free` di setiap jalur keluar; upgrade di-renounce (dulu DAO+timelock); 0 access key | `t5_…`, `sk5_…`, `up…`, `verify.mjs` |
| Integer | u128/checked; lelang tanpa overflow | `m…` |
| Oracle / harga | kontrak tidak memakai harga; harga hanya di klien/MCP dengan cross-check 2 sumber (>5 % selisih → tolak) | `shared/prices.test.mjs` |
| Front-running | pembeli/pemberi pinjaman mengikat `expected_sign_epoch` dan syarat pinjaman | T4, T11, T22 |
| Replay tanda tangan | outpoint BTC dicatat sebelum signing; nonce floor EVM/NEAR; Solana tanpa durable nonce | T3, T10, T14, T16 |
| DoS loop/gas | daftar dibatasi (maks 3 pool, 4 bukti USDC, history 32) | `sk7_…` |
| Upgradeability | hanya bytes yang sha256-nya disetujui DAO, setelah timelock; `renounce_upgrades` | `up…`, tx `EHX5b1cp…` (TooEarly), `25pi2EER…` (CodeMismatch) |
| Sentralisasi | upgrade **di-renounce** 8 Nov (DAO proposal 7, tx `GdASfxh5…`); kontrak 0 key → tidak ada pihak yang bisa mengubah kode | `verify.mjs`: "upgrades renounced: final" |

PoC exploit: setiap baris threat model punya tes yang mencoba serangannya dan memastikan gagal (355 tes, termasuk fuzz dan invariant).

## Frontend / backend
| Pemeriksaan | Hasil |
|---|---|
| Header | HSTS (preload), CSP `frame-ancestors 'none'`, X-Frame-Options DENY, nosniff, Referrer-Policy — diuji `live.spec` "security headers" |
| CORS | `relay`, `prove`, `holder`: preflight lintas-origin 405 (tidak dibuka); `/api/mcp` `*` karena read-only |
| Validasi input server | `/api/relay` menolak non-borsh (400 "not a borsh SignedDelegate"), memverifikasi tanda tangan NEP-366, hanya method whitelist tanpa deposit; `live.spec` "APIs answer bad input with 4xx, never 500" |
| Padanan SIWE | holder room: NEP-413, pesan terikat situs, maks 5 menit, harus full-access key akun pemilik, kepemilikan dicek tiap permintaan (T17) |
| Rate limiting | relayer: 1 bukti/menit/token, dedupe in-flight, still_here 1/jam, 429 → klien membayar gas sendiri. Vercel Firewall (live 8 Nov): 20 POST/menit/IP ke `/api/prove` + `/api/relay`, lalu 429 — diuji: 20× 400 lalu 5× 429 |
| Approval tersembunyi | tidak ada ERC-20 approve; transaksi EVM dibangun kontrak (transfer saja), detail ditampilkan sebelum tanda tangan |
| MCP agen | batas belanja per sesi, outflow mati default, allowlist penerima, elicitation (persetujuan manusia) sebelum belanja |

## Catatan verifikasi
Run GitHub Actions untuk commit putaran ini tidak dimulai karena kuota menit Actions repo private habis atau batas belanja tercapai, jadi bukan karena kegagalan kode. Verifikasinya dijalankan lokal:
- `cargo test` (355) dan unit Node;
- `node api/_nearai.test.mjs` dan `node api/_holder.test.mjs`;
- 11 tes `live.spec` yang relevan, terhadap produksi.

CI kembali jalan otomatis setelah repo dibuka public (menit Actions gratis) atau batas belanja dinaikkan.

## Known issues (belum di-fix, dengan alasan)
1. **CSP `script-src` penuh tidak dipasang.** `@hot-labs/near-connect` menjalankan kode wallet di iframe `srcdoc`, yang mewarisi CSP halaman induk, sehingga CSP ketat mematikan semua wallet. Yang terpasang: `frame-ancestors 'none'` + XFO DENY. Permukaan XSS-nya kecil: React tanpa `dangerouslySetInnerHTML` dari input pengguna (QR SVG dibuat dari alamat turunan kontrak).
2. **Nonce holder room sekali pakai per instance (R5-3).** Replay yang mendarat di instance serverless lain dalam ≤ 5 menit masih bisa lolos. Perbaikan berikutnya: store bersama (Upstash Redis `SET NX` TTL 5 menit).
3. **Batas biaya appraisal per instance (R5-6).** Bisa ditambah aturan Vercel Firewall untuk `/api/appraise`, seperti untuk `/api/prove` dan `/api/relay`.
4. **Provenance image NEAR AI (R5-10)** tidak diverifikasi lewat Sigstore; digest dan image yang tidak dipatok ditampilkan.
5. **`elliptic` low (R5-8)**: tidak berlaku untuk verifikasi; tidak ada pengganti tanpa advisory yang lebih berat.
6. **Peringatan gaya clippy**: dibiarkan agar source kontrak tetap sama dengan build yang ter-deploy.
