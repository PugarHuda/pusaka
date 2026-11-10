# Pusaka — laporan akhir (8 Nov 2026)

Rincian per fase: [`reports/01-tech-lead.md`](reports/01-tech-lead.md) · [`02-strategy`](reports/02-strategy.md) · [`03-contracts`](reports/03-contracts.md) · [`04-dapp`](reports/04-dapp.md) · [`05-security`](reports/05-security.md) · [`06-qa`](reports/06-qa.md) · [`07-submission`](reports/07-submission.md).

## 1. Scorecard & checklist
HACKATHON.md tidak memberi rubrik angka; kriteria diturunkan dari Q-012, Q-017 dan brief track (`02-strategy.md`).

| Kriteria | 2 Nov | 8 Nov |
|---|---|---|
| Reproduksibilitas dari clone bersih | 5 | 9 |
| Klaim terverifikasi on-chain | 6 | 10 |
| Kedalaman integrasi NEAR | 6 | 9 |
| Kesesuaian brief `nfts` | 7 | 9 |
| Keamanan / threat model | 6 | 9 |
| Demo & presentasi | 5 | 6 (video/X belum) |
| Polish UI/a11y/perf | 6 | 9 |

Tidak ada bounty sponsor terpisah di hackathon ini; "sponsor" = NEAR. Checklist submission: `07-submission.md`.

## 2. Temuan audit & keamanan
18 temuan putaran 7–8 Nov (A1–A18): 1 Kritis, 6 Tinggi, 8 Sedang, 3 Rendah. 16 fixed dan terverifikasi; A16 (typecheck) diputuskan tidak dipasang dengan alasan; A17 (source map) menunggu repo publik. Keamanan: `cargo audit` di CI (1 advisory dev-only, di-ignore dengan alasan), `npm audit` 0, git history & bundle bebas secret, header & CORS benar. Upgrade di-renounce 8 Nov; rate limit Firewall aktif (429). Known issue: coverage tak diukur.

## 3. Integrasi (sebelum → sesudah putaran ini)
Chain Signatures: Dalam → + FunctionCall staking · Light client: Sedang → Dalam (kembalian) · RPC: failover sederhana → per panggilan + cooldown + cache · 1Click: quote → + timeout benar & fallback teruji · Staking pool: — → Dalam · Error kontrak: kode mentah → kalimat. Lengkap: `04-dapp.md`, README "Every NEAR primitive".

## 4. Kompetitor & positioning
19 proyek di `nfts` (dari 266). "NFT yang membawa dompet" kini paritas (Handover, Deed, Torch, Logen, Outlive). Hanya Pusaka yang memegang **Bitcoin asli yang dibuktikan on-chain** dan memindahkan BTC + EVM + SOL + NEAR sekaligus. Positioning dan tabel 8 kompetitor: `02-strategy.md`.

## 5. Pembeda yang sulit ditiru (bukti on-chain)
1. Light client Bitcoin di kontrak: `prove_deposit` `EYLPHJGX…`; kembalian terbukti #10 (proposal 5).
2. Satu NFT banyak chain: Sepolia `0x85a7466d…`, Solana (finalized), akun NEAR `3npsdnYo…`, nBTC, stake `4yQWgGG4…`.
3. Kontrak tanpa key dan kode final: DeleteKey `3mNiGWfH…`; dulu DAO + timelock (TooEarly `EHX5b1cp…`, deploy `67hUwJuA…`), di-renounce `GdASfxh5…`.

## 6. Fitur baru putaran ini
Staking NEAR milik NFT (`#/pusaka/2`), bukti kembalian gratis (`#/pusaka/10`), judul halaman token sebelum JS (LCP 8,4 → 2,7 s), error kontrak manusiawi, `.env.example`, `cargo audit` di CI.

## 7. Testing
Kontrak 284 × 2 (termasuk fuzz + invariant) · unit Node 9 file · Playwright `ui.spec` 95 (5 proyek) + `live.spec` 40 · `verify.mjs` 8 cek · MCP smoke. Bug yang ditemukan tes: 10 (`06-qa.md`). Lighthouse mobile produksi: landing 88, token 87, a11y 100, SEO 100, best-practices 96.

## 8. Tautan
Demo: https://pusaka-two.vercel.app · Kontrak: https://testnet.near.rocks/account/pusaka-btc.testnet · Repo: https://github.com/PugarHuda/pusaka · Video & deck: belum ada (naskah + outline di `07-submission.md`).

## 9. Blocker (butuh user)
1. **Video demo + post X** (syarat wajib; naskah siap).
2. **Repo publik** sebelum 14 Nov 23:59 UTC (saran 13 Nov); lalu source map produksi (1 baris).
3. ~~Renounce upgrade~~ — **selesai 8 Nov** (proposal 7, `GdASfxh5…`).
4. **Akun payout mainnet** dan data form (nama, email, ukuran tim, persetujuan); submit setelah payload ditunjukkan.
5. **Dana mainnet** (~$35 minimum / ~$47 penuh, terukur 8 Nov, `docs/MAINNET.md`; di `pugarhuda.near`) bila ingin deploy mainnet / nama TLA.
6. ~~Firewall publish~~ — selesai 8 Nov (429 setelah 20 POST/menit/IP). Opsional: JWT 1Click dari partners.near-intents.org (tanpa fee 0,2 %).
