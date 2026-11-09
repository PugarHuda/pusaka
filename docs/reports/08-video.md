# 08 — Video demo: naskah, shot list, dan cara merekam

Acuan: `02-strategy.md` (bagian "Setelah menonton semua video demo"), `07-submission.md`.

## Kenapa video ini penentu
Ada 81 video pesaing yang sudah ditonton (9 Nov). Nilai Demo 9 hanya didapat video yang memperlihatkan **layar nyata dan tx di explorer**: Handover, Sealed Exploit, Warrant, Unpair. Video yang isinya hanya animasi atau slide turun nilainya: setllend, Loca, TheRascalsDotFun, Aegis. Nilai Demo Pusaka sekarang 7 karena belum ada video. Video setara Handover menaikkan Demo ke 9 dan Polish ke 9, jadi total jadi **±8,7–9,0**.

## Batasan teknis
- **Durasi maksimal 2:20.** Itu batas upload video untuk akun X non-Premium. Target 2:15.
- **1920×1080, 30 fps, MP4 (H.264 + AAC).**
- **Subtitle ditanam di video.** X memutar video tanpa suara secara default, jadi juri harus bisa paham tanpa audio.
- **Suara sendiri, bahasa Inggris.** Juri internasional, dan video ber-voiceover AI dinilai lebih rendah oleh agen penilai. Kalau tidak nyaman bicara, cukup subtitle plus musik pelan tanpa lirik.
- **Jangan menyembunyikan jeda.** Potong saat menunggu, tapi beri label, misalnya "⏩ 40 s waiting for NEAR MPC". Workcell dan Sealed Exploit dipuji agen penilai karena jujur soal jeda.

## Persiapan (H-1, ±20 menit)
| # | Langkah | Status / perintah |
|---|---|---|
| 1 | Wallet perekam `pusaka-w-mvzhtaw8.testnet` punya cukup NEAR | **Sudah**: dikirim 2 NEAR testnet dari `pusaka-seller` (tx `2ZnUKG6JdgHQssGPgub8xPGz9sPR8nUo8w5u2NNAH2hp`); saldo ±2,5 NEAR |
| 2 | Pusaka yang akan dibeli masih dijual | Utama **#11** (10.000 sats terverifikasi, 0,5 NEAR). Cadangan **#15** dan **#4** (Dutch auction 0,6 → 0,45 NEAR). Cek di https://pusaka-two.vercel.app/#/market. Kalau semua sudah terjual: `node scripts/restock.mjs` |
| 3 | Alamat tujuan withdraw | `tb1q4jyg3kjgre5r59fukjsrxmf5fjgcxq9pxfw3vj`: alamat Bitcoin **Pusaka #3, milikmu sendiri**, jadi BTC-nya tetap di tanganmu |
| 4 | Browser | Chrome profil bersih, zoom 110 %, bookmark bar disembunyikan (Ctrl+Shift+B), ekstensi lain disembunyikan kecuali wallet, notifikasi Windows dimatikan (Focus assist) |
| 5 | Tab yang dibuka dulu (urut) | ① https://pusaka-two.vercel.app ② `…/#/pusaka/11` ③ https://mempool.space/testnet/address/tb1q09m27tfxggpl2au9dgum9wk7v9dksjeg79sx46 (alamat #11) ④ `…/#/refused` |
| 6 | Wallet | Login ke wallet NEAR yang memegang `pusaka-w-mvzhtaw8.testnet` (Meteor/Intear) |
| 7 | Terminal | Windows Terminal, font 18–20 pt, tema gelap, folder `pusaka`. Jalankan `node scripts/verify.mjs` sekali untuk pemanasan, lalu `cls` |
| 8 | Perekam | OBS Studio (1080p30, mic dengan noise suppression), atau Win+Alt+R (Xbox Game Bar). Edit di **Clipchamp** (bawaan Windows 11), lalu tambahkan auto-captions |

## Naskah per detik
Narasi dalam bahasa Inggris (±290 kata, tempo santai). Kolom **Caption** berisi teks besar di layar, terpisah dari subtitle.

| Waktu | Layar (apa yang diklik) | Narasi (VO) | Caption |
|---|---|---|---|
| 0:00–0:10 | Tab ① landing. Kursor diam di hero, lalu pelan ke angka total BTC terverifikasi | "This NFT holds real Bitcoin. Not wrapped, not bridged: its own Bitcoin address. Whoever holds the NFT controls the Bitcoin." | **An NFT that holds native Bitcoin** |
| 0:10–0:30 | Tab ② `#/pusaka/11`: arahkan ke "verified" 10,000 sats, alamat `tb1q09m…`, lalu History ("proven"). Pindah ke tab ③ mempool: UTXO di alamat yang sama | "Pusaka number 11 has its own Bitcoin address. NEAR's MPC network derives the key for this contract only. And the 10,000 sats inside aren't a claim: NEAR's on-chain Bitcoin light client verified the deposit, so the contract itself knows what's inside." | **Deposit proven on NEAR by a Bitcoin light client** |
| 0:30–0:55 | Kembali ke ②. Klik **Connect NEAR wallet** → pilih wallet → akun `pusaka-w-mvzhtaw8.testnet`. Klik **Buy for 0.5 NEAR** → setujui di wallet → konfeti, pemilik berganti. Klik link tx → explorer NEAR Rocks | "I buy it in one NEAR transaction. The seller gets paid, and control of the Bitcoin moves to me. No bridge, no custodian, and the seller kept no key." | **One NEAR tx: NFT + its Bitcoin change hands** |
| 0:55–1:20 | Di ②, form **Withdraw**: tempel alamat #3 `tb1q4jyg…`, amount `0.00003`, klik **Withdraw** ("Signing with NEAR MPC… about 15 s"). Potong jeda dengan label. Buka link tx Bitcoin dari pesan sukses/History, atau tab ③ (alamat #11) lalu refresh → mempool.space menampilkan tx baru dari alamat #11 | "Now only I can move it. The contract asks NEAR's MPC network to sign a real Bitcoin transaction. Here it is on Bitcoin testnet. The change goes back into the Pusaka, and can be proven again for free." | **NEAR MPC signs a real Bitcoin tx** · label: ⏩ waiting for MPC |
| 1:20–1:42 | Tab ④ `#/refused`: gulir pelan; zoom ke kartu "seller_cannot_withdraw_after_sale" (NotOwner), klik link explorer (status Failure) | "And the old owner? These are real failed transactions on chain: a seller trying to withdraw after the sale, a buy after a secret signature, a lender claiming collateral early, new code the contract refused. Every one is guarded by a named test." | **Real attacks, refused on-chain** |
| 1:42–1:58 | Kembali ke ②, gulir cepat: Ethereum / Base / Arbitrum (ETH + USDC), Solana, akun NEAR + staking, Heir, Ask for a loan | "The same MPC keys give every Pusaka an address on Ethereum, Base, Arbitrum and Solana, and its own NEAR account. Borrow against the Bitcoin, name an heir, stake. Everything moves with the NFT." | **One NFT, many chains: all move together** |
| 1:58–2:12 | Terminal: `node scripts/verify.mjs`, dipercepat 2× (label), berhenti di "all checks passed" | "The contract has no access key, and its code is final: a DAO vote renounced upgrades. One command re-checks every claim against NEAR and Bitcoin, no wallet needed." | **0 keys · code final · `verify.mjs`: all checks passed** |
| 2:12–2:18 | End card: logo/hero, `pusaka-two.vercel.app`, `github.com/PugarHuda/pusaka`, "Built at NEAR HACKATHON · NFTs · DeFi · Open Innovation" | "Pusaka: an heirloom that carries its own Bitcoin." | URL + repo |

## Hal yang harus terlihat di layar (checklist editor)
- [ ] Angka `verified_sats` dan alamat `tb1…` yang sama, di app dan di mempool.space
- [ ] Popup wallet saat Buy, sebagai bukti tx-nya sungguhan
- [ ] Pemilik #11 berganti ke `pusaka-w-mvzhtaw8.testnet`
- [ ] Link explorer NEAR dari tx beli
- [ ] tx Bitcoin di mempool.space dari alamat #11
- [ ] Minimal satu kartu `#/refused` dibuka ke explorer (status gagal)
- [ ] Output terminal `all checks passed`
- [ ] Setiap jeda yang dipotong diberi label

## Kalau ada yang meleset saat merekam
| Masalah | Solusi |
|---|---|
| #11 sudah dibeli orang lain (juri bisa membeli juga) | Pakai #15, atau #4 (harga Dutch auction turun, malah menarik di video). Ganti angka di narasi |
| Wallet menolak/timeout | Rekam ulang potongan itu saja; urutannya sengaja per segmen |
| Withdraw lama (MPC > 1 menit) | Potong, beri label "⏩ 1 min, NEAR MPC signing" |
| Mempool belum menampilkan tx | Refresh tab ③ beberapa detik kemudian; tx yang baru disiarkan muncul sebagai unconfirmed |
| `verify.mjs` lambat (RPC rate limit di jaringanmu) | Rekam saat sepi, atau tampilkan run hijau di GitHub Actions (workflow CI, langkah yang menjalankan `verify.mjs`) |

## Setelah rekaman
1. Ekspor MP4 ≤ 2:20, cek tanpa suara (subtitle terbaca?) dan di layar HP.
2. **Thumbnail/frame pertama**: hero + "An NFT that holds native Bitcoin". Frame pertama ini yang dilihat orang di timeline.
3. Unggah ke X dengan teks `media/x-post.txt`. Mention @NEARProtocol, tagar #NEARHackathon. Yang memposting kamu sendiri; aku tidak memposting.
4. Unggah juga ke YouTube (unlisted) sebagai cadangan, lalu beri tahu aku link X dan YouTube-nya. Aku yang menambahkan link itu ke README, JUDGES.md, dan form submission. Link tidak kutulis sebelum ada, sesuai aturan tanpa placeholder.
5. Setelah video terbit, BTC di #3 (dari withdraw) bisa dibuktikan dengan "Prove for free" begitu light client mengejar blok tx tersebut, tapi hanya jika ≥ 10.000 sats. Withdraw 3.000 sats tetap aman di alamat #3, hanya tidak dihitung `verified_sats`. Kembalian di #11 dibuktikan otomatis oleh relayer (batas minimum kembalian 1.000 sats).

## Pitch deck (opsional, 8 slide)
Outline ada di `07-submission.md`. Slide 4 (pembeda) sekarang memakai tabel "How this differs from other 'the NFT is a wallet' designs" di README.
