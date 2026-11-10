// The demo video, scene by scene. Everything the video shows comes from here plus the recorded clips.
//
// A scene is either a card ({ card }) or a clip recorded from the live app ({ clip }: public/clips/<clip>.webm, made by
// `node web/e2e/record-scenes.mjs <clip>`, with <clip>.json holding the recorder's timed marks).
// Times are clip seconds: a number, or "@mark" / "@mark+1.5" (when the recorder noted that mark).
// Regions are video pixels [x, y, w, h], or "@mark" (where that element was). Marks taken in a wallet popup are drawn
// on the popup.
//   vo:       [{ at, text }]  voice-over lines; each starts at `at` (or after the previous line ends)
//   zoom:     [{ at, region?, scale?, for? }]  zoom onto region (default: the at-mark's box); `for` seconds, then back out
//   box:      [{ at, region?, for?, label? }]  highlight box around region
//   callout:  [{ at, region?, for?, text }]    a note pointing at region
//   cuts:     [{ from, to, label }]            remove a wait from the clip; label says so ("{s}" = seconds cut; "" = no label, for scrolling)
//   start/end: trim the clip; hold: seconds the scene stays after its voice-over; caption: the scene's headline on screen
//   x:        overrides for the X cut (shorter vo, other cuts...)
// Compositions at the bottom list the scenes of each video. Scenes whose clip isn't recorded yet are skipped.

export const voice = { voice: "en-US-AndrewMultilingualNeural", rate: "+10%" };
const OK = "⏩ {s} s cut: approve + confirm"; // a wallet approval and the transaction confirming, cut short

export const scenes = {
  title: {
    card: { kicker: "NEAR testnet · live app", title: "Pusaka", sub: "An NFT that holds native Bitcoin, proven on NEAR" },
    vo: [{ at: 0.4, text: "Pusaka is an NFT on NEAR with its own Bitcoin address, shown on the live testnet app." }],
    x: { vo: [{ at: 0.3, text: "This NFT holds real Bitcoin. Not wrapped, not bridged: its own Bitcoin address." }] },
  },

  landing: {
    clip: "landing",
    start: "@total-1",
    caption: "Every Pusaka holds native Bitcoin",
    vo: [
      { at: "@total-0.5", text: "This total is Bitcoin that NEAR's Bitcoin light client has verified, read from the contract." },
      { at: "@market", text: "The market lists each Pusaka with its proven Bitcoin and price." },
    ],
    cuts: [{ from: "@total+4", to: "@market-1", label: "" }],
    zoom: [{ at: "@total", for: 4 }],
    box: [{ at: "@total", for: 4 }, { at: "@stats", for: 3 }],
  },

  token: {
    clip: "token",
    start: "@amount-1",
    caption: "Deposit proven on NEAR by a Bitcoin light client",
    vo: [
      { at: "@amount-0.5", text: "Pusaka eleven holds ten thousand sats, proven on NEAR." },
      { at: "@address", text: "Its Bitcoin key is derived by NEAR's MPC network for this contract. No person holds it." },
      { at: "@proof", text: "Below, the Bitcoin transaction and the merkle proof the light client checked." },
    ],
    zoom: [{ at: "@amount-0.5", for: 3, scale: 1.6 }, { at: "@address", for: 4.5, scale: 2 }, { at: "@proof", for: 5, scale: 1.6 }],
    box: [{ at: "@amount", for: 3 }, { at: "@address", for: 4.5, label: "its own tb1 address" }, { at: "@proof", for: 5 }],
    x: {
      vo: [
        { at: "@amount-1", text: "Pusaka eleven has its own Bitcoin address, with a key held by NEAR's MPC network." },
        { at: "@proof", text: "The ten thousand sats inside are proven on NEAR by its Bitcoin light client, not claimed." },
      ],
    },
  },

  buy: {
    clip: "buy",
    start: "@price-1.5",
    end: "@explorer+4",
    caption: "One transaction: the NFT and its Bitcoin change hands",
    vo: [
      { at: "@price", text: "I buy it for half a NEAR, in one transaction from a real wallet." },
      { at: "@buy-wallet", text: "The wallet shows a call to buy, on the Pusaka contract." },
      { at: "@owned", text: "It's mine now, with the Bitcoin inside. No bridge, no custodian." },
      { at: "@explorer", text: "The transaction on the NEAR explorer." },
    ],
    cuts: [
      { from: "@buy-approve+1", to: "@owned-1", label: OK },
      { from: "@owned+3.5", to: "@explorer-1", label: "⏩ {s} s cut: explorer indexing" },
    ],
    zoom: [{ at: "@price", for: 3 }, { at: "@explorer+0.5", region: [240, 120, 1440, 420], for: 3.5, scale: 1.3 }],
    callout: [{ at: "@buy-approve-2", region: "@buy-approve", for: 2.5, text: "The real wallet: call buy on pusaka-btc.testnet, deposit 0.5 NEAR" }],
    box: [{ at: "@price", for: 3 }, { at: "@buy-approve-1", region: "@buy-approve", for: 2.5 }],
    x: {
      vo: [
        { at: "@price", text: "I buy it with one NEAR transaction, from a real wallet." },
        { at: "@owned", text: "The NFT and its Bitcoin are mine. No bridge, no custodian, and the seller kept no key." },
        { at: "@explorer", text: "On the explorer." },
      ],
    },
  },

  withdraw: {
    clip: "withdraw",
    start: "@form-0.5",
    caption: "NEAR MPC signs a real Bitcoin transaction",
    vo: [
      { at: "@form", text: "Only the holder can move that Bitcoin. I send three thousand sats to another address." },
      { at: "@withdraw-wallet", text: "One NEAR call: the contract builds the Bitcoin transaction and NEAR's MPC network signs it." },
      { at: "@sent", text: "Signed and broadcast." },
      { at: "@mempool", text: "Here it is on Bitcoin testnet, spent from Pusaka eleven's address, change back to it." },
    ],
    cuts: [
      { from: "@withdraw+0.5", to: "@withdraw-wallet-1.5", label: "⏩ {s} s cut: wallet opening" },
      { from: "@signing+2", to: "@sent-1", label: "⏩ {s} s cut: NEAR MPC signing" },
      { from: "@open-btc+1", to: "@mempool-1", label: "⏩ {s} s cut: page loading" },
    ],
    zoom: [{ at: "@form", for: 5, scale: 1.5 }, { at: "@sent", for: 3, scale: 1.8 }],
    box: [{ at: "@to", for: 3 }, { at: "@amount", for: 2 }, { at: "@withdraw-approve-1", region: "@withdraw-approve", for: 2.5 }, { at: "@sent", for: 3 }],
    x: {
      vo: [
        { at: "@form", text: "Now only I can move it. I send three thousand sats." },
        { at: "@withdraw-wallet", text: "NEAR's MPC network signs a real Bitcoin transaction." },
        { at: "@mempool", text: "There it is on Bitcoin testnet." },
      ],
    },
  },

  refused: {
    clip: "refused",
    start: 5,
    caption: "Real attacks, refused on-chain",
    cuts: [{ from: "@first+3.5", to: "@open-1", label: "" }],
    vo: [
      { at: 5.2, text: "The old owner can't take it back. These are real attacks the contracts refused." },
      { at: "@first", text: "A seller withdrawing after the sale, a front-run signature, a lender grabbing collateral early, each with its test." },
      { at: "@explorer", text: "On the explorer: failed, with the contract's error." },
    ],
    zoom: [{ at: "@first", for: 3.5, scale: 1.6 }],
    box: [{ at: "@first", for: 3.5 }],
    x: {
      vo: [
        { at: 5.2, text: "The old owner can't. These are real attacks the contracts refused, each guarded by a named test." },
        { at: "@explorer", text: "Failed on-chain." },
      ],
    },
  },

  check: {
    clip: "check",
    start: "@click-2.5",
    caption: "Check it yourself: answers from the chains",
    vo: [
      { at: "@click-1.5", text: "Check it yourself: your browser asks NEAR, the MPC signer, the light client and Bitcoin directly." },
      { at: "@done", text: "All five pass: no contract key, fixed code, the MPC's own address, and the sats on Bitcoin." },
    ],
    cuts: [{ from: "@click+3", to: "@done-1", label: "⏩ {s} s cut: your browser asking the chains" }],
    zoom: [{ at: "@list", for: 6, scale: 1.5 }],
    box: [{ at: "@click", for: 2 }, { at: "@done", for: 4 }],
    x: { vo: [{ at: "@click-1", text: "Don't trust us. One click and your browser checks NEAR, the MPC signer, the light client and Bitcoin itself." }] },
  },

  chains: {
    clip: "chains",
    start: 13,
    hold: 1.5,
    caption: "One NFT, many chains: all of it moves together",
    vo: [{ at: 13.3, text: "The same MPC keys give each Pusaka addresses on Ethereum, Base, Arbitrum and Solana, and its own NEAR account. A sale moves all of it." }],
    box: [{ at: "@eth", for: 2.5 }, { at: "@sol", for: 2.5 }, { at: "@near", for: 2.5 }],
  },

  rest: {
    clip: "chains",
    start: 4,
    caption: "Also: loans · inheritance · gift links · sealed letters · agents · Smart Pusakas",
    vo: [{ at: 0.3, text: "It also does loans, inheritance, gift links, sealed letters, ETH, USDC, Solana and NEAR addresses, tools for AI agents, and Smart Pusakas with their own accounts." }],
  },

  loan: {
    clip: "loan",
    start: "@offer-1",
    caption: "Borrow against the proven Bitcoin, gas-free",
    cuts: [{ from: "@accept+0.5", to: "@accept-wallet-1", label: "" }, { from: "@accept-approve+1.5", to: "@taken-1", label: "⏩ {s} s cut: relayer submitting" }],
    vo: [
      { at: "@offer", text: "This lender's standing offer takes any Pusaka with ten thousand proven sats as collateral." },
      { at: "@accept-wallet", text: "I only sign; a relayer pays the gas." },
      { at: "@taken", text: "The NEAR arrives." },
    ],
    box: [{ at: "@offer", for: 3 }, { at: "@accept", for: 1.5 }],
    zoom: [{ at: "@offer", for: 3, scale: 1.5 }],
  },

  repay: {
    clip: "repay",
    start: "@locked-1",
    end: "@repaid+2.5",
    caption: "Collateral until repaid",
    cuts: [{ from: "@repay+0.5", to: "@repay-wallet-1", label: "" }, { from: "@repay-approve+1.5", to: "@repaid-1", label: "⏩ {s} s cut: confirming" }],
    vo: [
      { at: "@locked", text: "Until repaid, it can't be withdrawn, sold or moved. Miss the deadline, and the lender takes it." },
      { at: "@repay-wallet", text: "I repay, and it unlocks." },
    ],
    box: [{ at: "@locked", for: 4 }, { at: "@repaid", for: 2.5 }],
    zoom: [{ at: "@locked", for: 4, scale: 1.3 }, { at: "@repaid", for: 2.5, scale: 1.8 }],
  },

  heir: {
    clip: "heir",
    start: "@section-1",
    end: "@will+4",
    caption: "Inheritance: if the holder goes silent, the heir claims",
    vo: [
      { at: "@section", text: "Pusaka means heirloom. I name an heir and a silence period, ten minutes here." },
      { at: "@name-wallet", text: "One transaction writes it into the contract." },
      { at: "@will", text: "Stay silent that long and the heir can claim it. Any action, even a free check-in, restarts the clock." },
    ],
    cuts: [
      { from: "@name+0.5", to: "@name-wallet-1", label: "" },
      { from: "@name-approve+1.5", to: "@named-1", label: "⏩ {s} s cut: confirming" },
    ],
    box: [{ at: "@heir-to", for: 2.5 }, { at: "@after", for: 2 }, { at: "@will", for: 4 }],
    zoom: [{ at: "@will", for: 4, scale: 1.6 }],
  },

  claim: {
    clip: "claim",
    start: "@section-1",
    end: "@owner+3",
    caption: "Ten minutes of silence later, the heir claims",
    cuts: [
      { from: "@claim+0.5", to: "@claim-wallet-1", label: "" },
      { from: "@claim-approve+1", to: "@claimed-1", label: "⏩ {s} s cut: relayer submitting" },
      { from: "@claimed+2", to: "@owner-1", label: "" },
    ],
    vo: [
      { at: "@section-0.5", text: "Ten minutes later, with no check-in, the heir claims it, gas-free." },
      { at: "@claimed", text: "Pusaka three is now the heir's. No lawyer, no seed phrase handed over." },
    ],
    box: [{ at: "@claim", for: 2 }, { at: "@claimed", for: 2 }, { at: "@owner", for: 3 }],
    zoom: [{ at: "@owner", for: 3, scale: 2 }],
  },

  letter: {
    clip: "letter",
    start: "@write-1",
    end: "@letter+4",
    caption: "A sealed letter only the holder can open",
    cuts: [
      { from: "@seal+0.5", to: "@seal-wallet-1", label: "" },
      { from: "@seal-approve+1.5", to: "@sealed-1", label: "⏩ {s} s cut: MPC key, 2nd approval" },
      { from: "@sealed+2", to: "@letter-1", label: "⏩ {s} s cut: reload, MPC key again" },
    ],
    vo: [
      { at: "@write", text: "In the holder room, I write a letter for whoever holds this Pusaka next." },
      { at: "@seal-wallet", text: "It's sealed with a key NEAR's MPC network derives for this Pusaka alone." },
      { at: "@letter", text: "Only the current holder can open it; a buyer gets it too." },
    ],
    box: [{ at: "@write", for: 4 }, { at: "@letter", for: 4 }],
    zoom: [{ at: "@letter", for: 4, scale: 1.6 }],
  },

  gift: {
    clip: "gift",
    start: "@section-1",
    end: "@link+3.5",
    caption: "Give a Pusaka as a link",
    cuts: [{ from: "@make+0.5", to: "@make-wallet-1", label: "" }, { from: "@make-approve+1.5", to: "@link-2", label: OK }],
    vo: [
      { at: "@section", text: "A Pusaka can be given as a link. One transaction holds it behind a one-time key." },
      { at: "@link", text: "The link carries that key, so it's blurred here." },
    ],
    callout: [{ at: "@link", for: 3.5, text: "Blurred on purpose: the link carries the one-time key" }],
  },

  "gift-claim": {
    clip: "gift-claim",
    start: "@gift-1",
    caption: "The recipient needs no wallet",
    cuts: [{ from: "@create+1.5", to: "@claimed-1", label: "⏩ {s} s cut: creating the account" }],
    vo: [
      { at: "@gift", text: "Whoever opens it needs no wallet. They pick a name." },
      { at: "@claimed", text: "A new NEAR account now holds the Pusaka. Its key is shown once; blurred here." },
    ],
    box: [{ at: "@gift", for: 3 }],
    callout: [{ at: "@key", for: 4, text: "Blurred on purpose: the new account's private key" }],
  },

  passkey: {
    clip: "passkey",
    start: "@passkey-1.5",
    hold: 1,
    caption: "No wallet at all? A passkey",
    vo: [{ at: "@passkey-0.5", text: "No wallet at all? A passkey becomes a NEAR account, with gas paid by the relayer." }],
    box: [{ at: "@passkey", for: 2 }, { at: "@account", for: 4 }],
  },

  v2: {
    clip: "v2",
    start: "@account-1.5",
    caption: "Smart Pusakas: the NFT has its own account",
    vo: [
      { at: "@account-1", text: "A Smart Pusaka has its own keyless NEAR account that only the holder controls." },
      { at: "@pq", text: "Optional: a post-quantum ML-DSA lock, checked on-chain." },
      { at: "@agent", text: "A daily budget for an AI agent." },
      { at: "@btcsale", text: "Rental, and sale for proven Bitcoin." },
    ],
    box: [{ at: "@account", for: 3 }, { at: "@pq", for: 3 }, { at: "@agent", for: 3 }, { at: "@btcsale", for: 3 }],
  },

  "v2-act": {
    clip: "v2-act",
    start: "@signin-1.5",
    end: "@proof+3.5",
    caption: "Sign in as the NFT · prove its Bitcoin address",
    cuts: [
      { from: "@signin-approve+1.5", to: "@signedin-1", label: "⏩ {s} s cut: NEAR MPC signing" },
      { from: "@signedin+3.5", to: "@bip322-1", label: "" },
      { from: "@bip322+0.5", to: "@proof-1", label: "⏩ {s} s cut: approve, MPC signing" },
    ],
    vo: [
      { at: "@signin", text: "As holder of Smart Pusaka seven, I sign in to this site as the NFT." },
      { at: "@signin-wallet", text: "Its MPC key signs a standard Sign-In with Ethereum message." },
      { at: "@signedin", text: "Whoever holds the NFT next gets that identity." },
      { at: "@bip322", text: "And a BIP-322 proof of its Bitcoin address." },
    ],
    box: [{ at: "@signin", for: 2 }, { at: "@signedin", for: 3.5 }, { at: "@proof", for: 3.5 }],
    zoom: [{ at: "@signedin", for: 3.5, scale: 1.5 }, { at: "@proof", for: 3.5, scale: 1.5 }],
  },

  vault: {
    clip: "vault",
    start: "@form-1",
    end: "@owner+3",
    caption: "Vault: a stolen key has to wait",
    cuts: [
      { from: "@vault+1", to: "@vaulted-1", label: OK },
      { from: "@locked+2", to: "@send-1", label: "" },
      { from: "@send+1", to: "@refused-1", label: OK },
      { from: "@refused+3", to: "@unlock-1", label: "" },
      { from: "@unlock+1", to: "@pending-1", label: OK },
      { from: "@pending+2.5", to: "@claw-1.5", label: "⏩ {s} s cut: switching wallets" },
      { from: "@claw+1", to: "@clawed-1", label: OK },
    ],
    vo: [
      { at: "@form", text: "A vault guards against a stolen key. I set a recovery account and a delay, one minute here." },
      { at: "@locked", text: "The holder's own key tries to move funds at once, as a thief would." },
      { at: "@refused", text: "Refused on-chain: VaultLocked." },
      { at: "@unlock", text: "An unlock must be requested and waited out." },
      { at: "@claw", text: "Meanwhile, the recovery account claws it back." },
      { at: "@owner", text: "It now holds the Pusaka." },
    ],
    box: [{ at: "@recovery", for: 2.5 }, { at: "@delay", for: 1.5 }, { at: "@locked", for: 2 }, { at: "@refused", for: 3 }, { at: "@pending", for: 2.5 }, { at: "@clawed", for: 2 }, { at: "@owner", for: 3 }],
    zoom: [{ at: "@refused", for: 3, scale: 1.8 }, { at: "@owner", for: 3, scale: 1.8 }],
  },

  call: {
    clip: "call",
    start: "@form-1",
    end: "@btc+4.5",
    caption: "Covered call, strike paid in native Bitcoin",
    cuts: [
      { from: "@payto+2.2", to: "@write-0.6", label: "" },
      { from: "@write+1", to: "@offer-1", label: OK },
      { from: "@offer+2.5", to: "@buy-1", label: "⏩ {s} s cut: switching wallets" },
      { from: "@buy+1", to: "@bought-1", label: OK },
      { from: "@reserve+1", to: "@reserved-1", label: OK },
      { from: "@opreturn+4", to: "@proof-0.5", label: "⏩ {s} s cut: page loading" },
      { from: "@proof+4", to: "@btc-0.5", label: "⏩ {s} s cut: page loading" },
    ],
    vo: [
      { at: "@form", text: "A covered call: the right to buy this Pusaka at a fixed price, here paid in Bitcoin to my address." },
      { at: "@offer", text: "I keep the premium either way." },
      { at: "@buy", text: "Another account buys the option." },
      { at: "@reserve", text: "To exercise, it reserves: the contract gives the output to pay and an OP_RETURN tag." },
      { at: "@proof", text: "On Smart Pusaka five we paid one; the light client checked it and the Pusaka changed hands." },
      { at: "@btc", text: "The payment on Bitcoin, with its OP_RETURN." },
    ],
    box: [{ at: "@inbtc", for: 2 }, { at: "@payto", for: 2 }, { at: "@offer", for: 2.5 }, { at: "@bought", for: 2 }, { at: "@opreturn", for: 5 }],
    zoom: [{ at: "@opreturn", for: 5, scale: 1.4 }, { at: "@proof+0.5", region: [240, 120, 1440, 700], for: 4, scale: 1.3 }],
  },

  bids: {
    clip: "bids",
    start: "@bids-1",
    caption: "A market that prices Bitcoin per verified sat",
    vo: [
      { at: "@bids", text: "A second market: bids priced per verified sat, including pools that fill several times." },
      { at: "@offers", text: "Loans with no due date: a lender who wants out starts a rate auction." },
    ],
    box: [{ at: "@bids", for: 3 }, { at: "@offers", for: 3 }, { at: "@loans", for: 3 }],
  },

  agents: {
    clip: "agents",
    start: "@top-1",
    caption: "Tools for AI agents, and an audit paid over x402",
    vo: [
      { at: "@top", text: "For AI agents: an MCP server with fifty-five tools and hard spending caps." },
      { at: "@x402", text: "The audit is paid per call over x402: 402 until a gasless wNEAR payment settles." },
    ],
    box: [{ at: "@tools", for: 3 }],
  },

  end: {
    card: { kicker: "Built at NEAR HACKATHON · Nov 2026", title: "pusaka-two.vercel.app", sub: "github.com/PugarHuda/pusaka" },
    vo: [{ at: 0.4, text: "Pusaka: an heirloom that carries its own Bitcoin." }],
    dur: 5,
  },
};

export const compositions = {
  Preview: ["title", "landing", "token", "buy"],
  Full: ["title", "landing", "token", "buy", "withdraw", "refused", "check", "chains", "loan", "repay", "heir", "claim", "letter", "gift", "gift-claim", "passkey", "v2", "v2-act", "vault", "call", "bids", "agents", "end"],
  X: ["title", "token", "buy", "withdraw", "refused", "check", "rest", "end"],
};
export const limits = { X: 135, Full: 360 }; // seconds: X allows 2:20 without Premium; the walkthrough aims for 6 min
