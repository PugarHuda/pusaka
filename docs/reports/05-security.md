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

PoC exploit: setiap baris threat model punya tes yang mencoba serangannya dan memastikan gagal (246 tes, termasuk fuzz dan invariant).

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
- `cargo test` (246) dan unit Node;
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
