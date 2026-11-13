# 08 — Demo video: script, shot list, and how to record

Reference: `02-strategy.md` (section "After watching all the demo videos"), `07-submission.md`.

## Why this video decides it
81 competitor videos have been watched (9 Nov). A Demo score of 9 only goes to videos that show **a real screen and tx in an explorer**: Handover, Sealed Exploit, Warrant, Unpair. Videos with only animation or slides score lower: setllend, Loca, TheRascalsDotFun, Aegis. Pusaka's Demo score is 7 right now because there is no video yet. A video on par with Handover raises Demo to 9 and Polish to 9, so the total becomes **±8.7–9.0**.

## Technical limits
- **Maximum length 2:20.** That is the video upload limit for non-Premium X accounts. Target 2:15.
- **1920×1080, 30 fps, MP4 (H.264 + AAC).**
- **Subtitles burned into the video.** X plays video muted by default, so judges must be able to follow it without audio.
- **Your own voice, in English.** The judges are international, and videos with AI voiceover are rated lower by the judging agents. If you are not comfortable speaking, subtitles plus quiet music without lyrics are enough.
- **Don't hide waits.** Cut while waiting, but label it, for example "⏩ 40 s waiting for NEAR MPC". Workcell and Sealed Exploit were praised by the judging agents for being honest about waits.

## Ready-to-use footage (10 Nov)
`node web/e2e/record-clips.mjs` records the scenes that need no wallet from the live app, 1080p, one file per scene, into `media/clips/`:
`01-landing`, `02-token`, `03-refused` (39 refused tx, then one opened in the explorer), `04-chains`, `05-check` ("Check it yourself" until done), `06-v2-agent` (on-chain agent budget on v2 #7).
You only need to record the scenes that need a wallet (buy and withdraw), then cut and add voice/subtitles.
**Note:** #11 has already been bought (`pusaka-buyer.testnet`); use another Pusaka still for sale on `#/market`, or `node scripts/restock.mjs`.

## Preparation (day before, ±20 minutes)
| # | Step | Status / command |
|---|---|---|
| 1 | Recording wallet `pusaka-w-mvzhtaw8.testnet` has enough NEAR | **Done**: sent 2 testnet NEAR from `pusaka-seller` (tx `2ZnUKG6JdgHQssGPgub8xPGz9sPR8nUo8w5u2NNAH2hp`); balance ±2.5 NEAR |
| 2 | The Pusaka to be bought is still for sale | Main **#11** (10,000 verified sats, 0.5 NEAR). Backups **#10** and **#4** (Dutch auction 0.6 → 0.45 NEAR). Check at https://pusaka-two.vercel.app/#/market. If all are sold: `node scripts/restock.mjs` |
| 3 | Withdraw destination address | `tb1q4jyg3kjgre5r59fukjsrxmf5fjgcxq9pxfw3vj`: the Bitcoin address of **Pusaka #3, which you own**, so the BTC stays in your hands |
| 4 | Browser | Clean Chrome profile, zoom 110 %, bookmark bar hidden (Ctrl+Shift+B), other extensions hidden except the wallet, Windows notifications off (Focus assist) |
| 5 | Tabs to open first (in order) | ① https://pusaka-two.vercel.app ② `…/#/pusaka/11` ③ https://mempool.space/testnet/address/tb1q09m27tfxggpl2au9dgum9wk7v9dksjeg79sx46 (address of #11) ④ `…/#/refused` |
| 6 | Wallet | Log in to the NEAR wallet that holds `pusaka-w-mvzhtaw8.testnet` (Meteor/Intear) |
| 7 | Terminal (optional) | Windows Terminal, font 18–20 pt, dark theme, folder `pusaka`. Run `node scripts/verify.mjs` once to warm up, then `cls`. The main scene is now the "Check it yourself" button in the browser |
| 8 | Recorder | OBS Studio (1080p30, mic with noise suppression), or Win+Alt+R (Xbox Game Bar). Edit in **Clipchamp** (built into Windows 11), then add auto-captions |

## Second-by-second script
Narration in English (±290 words, relaxed pace). The **Caption** column holds large on-screen text, separate from the subtitles.

| Time | Screen (what to click) | Narration (VO) | Caption |
|---|---|---|---|
| 0:00–0:10 | Tab ① landing. Cursor still on the hero, then slowly to the total verified BTC number | "This NFT holds real Bitcoin. Not wrapped, not bridged: its own Bitcoin address. Whoever holds the NFT controls the Bitcoin." | **An NFT that holds native Bitcoin** |
| 0:10–0:30 | Tab ② `#/pusaka/11`: point at "verified" 10,000 sats, the address `tb1q09m…`, then History ("proven"). Switch to tab ③ mempool: the UTXO at the same address | "Pusaka number 11 has its own Bitcoin address. NEAR's MPC network derives the key for this contract only. And the 10,000 sats inside aren't a claim: NEAR's on-chain Bitcoin light client verified the deposit, so the contract itself knows what's inside." | **Deposit proven on NEAR by a Bitcoin light client** |
| 0:30–0:55 | Back to ②. Click **Connect NEAR wallet** → choose wallet → account `pusaka-w-mvzhtaw8.testnet`. Click **Buy for 0.5 NEAR** → approve in the wallet → confetti, owner changes. Click the tx link → NEAR Rocks explorer | "I buy it in one NEAR transaction. The seller gets paid, and control of the Bitcoin moves to me. No bridge, no custodian, and the seller kept no key." | **One NEAR tx: NFT + its Bitcoin change hands** |
| 0:55–1:20 | On ②, the **Withdraw** form: paste the #3 address `tb1q4jyg…`, amount `0.00003`, click **Withdraw** ("Signing with NEAR MPC… about 15 s"). Cut the wait with a label. Open the Bitcoin tx link from the success message/History, or tab ③ (address of #11) then refresh → mempool.space shows a new tx from the #11 address | "Now only I can move it. The contract asks NEAR's MPC network to sign a real Bitcoin transaction. Here it is on Bitcoin testnet. The change goes back into the Pusaka, and can be proven again for free." | **NEAR MPC signs a real Bitcoin tx** · label: ⏩ waiting for MPC |
| 1:20–1:42 | Tab ④ `#/refused`: scroll slowly; zoom to the "seller_cannot_withdraw_after_sale" card (NotOwner), click the explorer link (status Failure) | "And the old owner? These are real failed transactions on chain: a seller trying to withdraw after the sale, a buy after a secret signature, a lender claiming collateral early, new code the contract refused. Every one is guarded by a named test." | **Real attacks, refused on-chain** |
| 1:42–1:58 | Back to ②, scroll quickly: Ethereum / Base / Arbitrum (ETH + USDC), Solana, NEAR account + staking, Heir, MPC letter, Ask for a loan | "The same MPC keys give every Pusaka an address on Ethereum, Base, Arbitrum and Solana, and its own NEAR account. Borrow against the Bitcoin, name an heir, seal a letter only the holder can open. Everything moves with the NFT." | **One NFT, many chains: all move together** · small in the corner: *only in Pusaka: light-client-proven BTC · MPC-sealed letter · MPC-verified USDC · final code* |
| 1:58–2:12 | Still on ②, scroll below the BTC card → click **Check it yourself** → the ✓ list appears one by one ("All N checks passed"). Cut the wait with a label. Optional 2 seconds: terminal `node scripts/verify.mjs` → "all checks passed" | "Don't trust this page. One click and your own browser asks NEAR, its MPC network, its Bitcoin light client and Bitcoin: no key on the contract, code final, the key really is the MPC's, every satoshi really is on Bitcoin." | **Check it yourself: ✓ from the chains, not from us** |
| 2:12–2:18 | End card: logo/hero, `pusaka-two.vercel.app`, `github.com/PugarHuda/pusaka`, "Built at NEAR HACKATHON · NFTs · DeFi · Open Innovation" | "Pusaka: an heirloom that carries its own Bitcoin." | URL + repo |

## What must be visible on screen (editor checklist)
- [ ] The same `verified_sats` number and `tb1…` address, in the app and on mempool.space
- [ ] The wallet popup on Buy, as proof the tx is real
- [ ] The owner of #11 changes to `pusaka-w-mvzhtaw8.testnet`
- [ ] The NEAR explorer link from the buy tx
- [ ] The Bitcoin tx on mempool.space from the #11 address
- [ ] At least one `#/refused` card opened in the explorer (failed status)
- [ ] "Check it yourself" through to "All N checks passed" (terminal `verify.mjs` optional)
- [ ] Every cut wait is labelled

## If something goes wrong while recording
| Problem | Solution |
|---|---|
| #11 was already bought by someone else (judges can buy too) | Use #10, or #4 (the Dutch auction price drops, which actually looks good on video). Change the numbers in the narration |
| Wallet rejects/times out | Re-record only that segment; the order is deliberately per segment |
| Withdraw is slow (MPC > 1 minute) | Cut it, label it "⏩ 1 min, NEAR MPC signing" |
| Mempool does not show the tx yet | Refresh tab ③ a few seconds later; a newly broadcast tx shows up as unconfirmed |
| "Check it yourself" shows "?" (the Bitcoin explorer does not answer) or `verify.mjs` is slow | Click **Check again**; your network sometimes blocks Blockstream and slows down mempool.space. If it still shows "?", turn on a VPN in Chrome. Backup: a green run in GitHub Actions (the `verify.mjs` step) |

## After recording
1. Export MP4 ≤ 2:20, check it muted (are the subtitles readable?) and on a phone screen.
2. **Thumbnail/first frame**: hero + "An NFT that holds native Bitcoin". This first frame is what people see in the timeline.
3. Upload to X with the text from `media/x-post.txt`. Mention @NEARProtocol, hashtag #NEARHackathon. You post it yourself; I do not post.
4. Also upload to YouTube (unlisted) as a backup, then tell me the X and YouTube links. I add those links to the README, JUDGES.md, and the submission form. I don't write a link before it exists, in line with the no-placeholder rule.
5. After the video is published, the BTC at #3 (from the withdraw) can be proven with "Prove for free" once the light client catches up to that tx's block, but only if it is ≥ 10,000 sats. A 3,000 sats withdraw stays safe at the #3 address, it just is not counted in `verified_sats`. The change at #11 is proven automatically by the relayer (minimum change threshold 1,000 sats).

## Pitch deck (optional, 8 slides)
The outline is in `07-submission.md`. Slide 4 (differentiators) now uses the README table "How this differs from other 'the NFT is a wallet' designs".
