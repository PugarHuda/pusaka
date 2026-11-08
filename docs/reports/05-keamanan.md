# 05 — Keamanan (Web3 Security Auditor)

Acuan: `03-kontrak.md`, `04-dapp.md`. Threat model lengkap (T1–T27, tiap baris → tes): README "Why the seller can't keep the Bitcoin".

## Scanner
| Alat | Sebelum | Sesudah |
|---|---|---|
| Slither / Aderyn | tidak berlaku (khusus Solidity) | padanan untuk Rust/NEAR: `cargo audit` (di bawah) + review manual + tes serangan |
| `cargo audit` (RustSec, 287 crate) | tidak dijalankan | di CI. 1 advisory: `crypto-bigint` 0.5.5 RUSTSEC-2026-0387 (timing). Hanya lewat `near-vm-runner` (VM unit-test near-sdk); `cargo tree --target wasm32-unknown-unknown -e normal` kosong → tidak ada di wasm. Di-ignore dengan alasan di `contract/.cargo/audit.toml`. 2 peringatan unmaintained (`wee_alloc`, `unsafe-libyaml`) juga hanya di dependensi host/test |
| `npm audit` | 0 | 0 kerentanan |
| Pemindaian secret di git history (semua commit, pola key NEAR ed25519/secp256k1 privat, PEM, `ghp_`, token Phala) | — | 0 temuan (`MPC_KEY` yang muncul adalah public key) |
| Secret di bundle client (`web/dist`) | — | 0 |

## Review manual kontrak
| Kelas | Status di Pusaka | Tes / bukti |
|---|---|---|
| Reentrancy (async NEAR) | state dicatat sebelum promise; token dikunci `SignPending`; callback gagal → pulih | `a3_…`, `s3_…`, `x2_…`, T2, T9 |
| Access control | `assert_owner` + `assert_free` di setiap jalur keluar; upgrade DAO+timelock; 0 access key | `t5_…`, `sk5_…`, `up…`, `verify.mjs` |
| Integer | u128/checked; lelang tanpa overflow | `m…` |
| Oracle / harga | kontrak tidak memakai harga; harga hanya di klien/MCP dengan cross-check 2 sumber (>5 % selisih → tolak) | `shared/prices.test.mjs` |
| Front-running | pembeli/pemberi pinjaman mengikat `expected_sign_epoch` dan syarat pinjaman | T4, T11, T22 |
| Replay tanda tangan | outpoint BTC dicatat sebelum signing; nonce floor EVM/NEAR; Solana tanpa durable nonce | T3, T10, T14, T16 |
| DoS loop/gas | daftar dibatasi (maks 3 pool, 4 bukti USDC, history 32) | `sk7_…` |
| Upgradeability | hanya bytes yang sha256-nya disetujui DAO, setelah timelock; `renounce_upgrades` | `up…`, tx `EHX5b1cp…` (TooEarly), `25pi2EER…` (CodeMismatch) |
| Sentralisasi | council DAO masih 3 akun demo sendiri — dinyatakan jujur di README; rencana renounce setelah deploy terakhir | known issue, butuh keputusan user |

PoC exploit: setiap baris threat model punya tes yang mencoba serangannya dan memastikan gagal (225 tes).

## Frontend / backend
| Pemeriksaan | Hasil |
|---|---|
| Header | HSTS (preload), CSP `frame-ancestors 'none'`, X-Frame-Options DENY, nosniff, Referrer-Policy — diuji `live.spec` "security headers" |
| CORS | `relay`, `prove`, `holder`: preflight lintas-origin 405 (tidak dibuka); `/api/mcp` `*` karena read-only |
| Validasi input server | `/api/relay` menolak non-borsh (400 "not a borsh SignedDelegate"), memverifikasi tanda tangan NEP-366, hanya method whitelist tanpa deposit; `live.spec` "APIs answer bad input with 4xx, never 500" |
| Padanan SIWE | holder room: NEP-413, pesan terikat situs, maks 5 menit, harus full-access key akun pemilik, kepemilikan dicek tiap permintaan (T17) |
| Rate limiting | relayer: 1 bukti/menit/token, dedupe in-flight, still_here 1/jam, 429 → klien membayar gas sendiri. Aturan Vercel Firewall disiapkan dalam mode LOG (publish butuh user) |
| Approval tersembunyi | tidak ada ERC-20 approve; transaksi EVM dibangun kontrak (transfer saja), detail ditampilkan sebelum tanda tangan |
| MCP agen | batas belanja per sesi, outflow mati default, allowlist penerima, elicitation (persetujuan manusia) sebelum belanja |

## Known issues
1. Council DAO = akun demo sendiri sampai `renounce_upgrades` (~13 Nov, butuh OK user).
2. Vercel Firewall rate-limit masih LOG mode (user: `vercel firewall publish --yes`).
3. Coverage kontrak tidak diukur.
