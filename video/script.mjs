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
//   cuts:     [{ from, to, label }]            remove a wait from the clip; label says so ("{s}" = seconds cut)
//   start/end: trim the clip; caption: the scene's headline on screen
//   x:        overrides for the X cut (shorter vo, other cuts...)
// Compositions at the bottom list the scenes of each video. Scenes whose clip isn't recorded yet are skipped.

export const voice = { voice: "en-US-AndrewMultilingualNeural", rate: "+4%" };

export const scenes = {
  title: {
    card: { kicker: "NEAR testnet · live app", title: "Pusaka", sub: "An NFT that holds native Bitcoin, proven on NEAR" },
    vo: [{ at: 0.4, text: "Pusaka is an NFT on NEAR that controls its own Bitcoin address. Everything here is the live testnet app: real wallets, real transactions." }],
    x: { vo: [{ at: 0.3, text: "This NFT holds real Bitcoin. Not wrapped, not bridged: its own Bitcoin address." }] },
  },

  landing: {
    clip: "landing",
    start: "@hero-1.5",
    caption: "Every Pusaka holds native Bitcoin",
    vo: [
      { at: "@hero", text: "This is the home page." },
      { at: "@total", text: "This total is Bitcoin that NEAR's own Bitcoin light client has verified. It is read from the contract, not from our server." },
      { at: "@market", text: "The market shows each one with the Bitcoin proven inside it, and its price." },
    ],
    zoom: [{ at: "@total", for: 5 }, { at: "@gallery", for: 4, scale: 1.6 }],
    box: [{ at: "@total", for: 5 }, { at: "@market", for: 1.5 }, { at: "@stats", for: 3 }, { at: "@gallery", for: 4 }],
  },

  token: {
    clip: "token",
    start: "@amount-2.5",
    caption: "Deposit proven on NEAR by a Bitcoin light client",
    vo: [
      { at: "@amount-1", text: "This is Pusaka eleven. The ten thousand sats inside are proven on NEAR, not claimed." },
      { at: "@address", text: "It has its own Bitcoin address. NEAR's MPC network derives the key for this contract only, so there is no private key anyone could keep." },
      { at: "@proof", text: "The proof trail shows the Bitcoin transaction, the merkle proof NEAR's light client checked, and the amount the contract now counts." },
    ],
    zoom: [{ at: "@amount-0.5", for: 3.5, scale: 1.6 }, { at: "@address", for: 5, scale: 2 }, { at: "@proof", for: 6, scale: 1.6 }],
    box: [{ at: "@amount", for: 3 }, { at: "@address", for: 5, label: "its own tb1 address" }, { at: "@proof", for: 6 }],
    x: {
      vo: [
        { at: "@amount-1", text: "Pusaka eleven has its own Bitcoin address, with a key held by NEAR's MPC network." },
        { at: "@proof", text: "The ten thousand sats inside are proven on NEAR by its Bitcoin light client, not claimed." },
      ],
    },
  },

  buy: {
    clip: "buy",
    caption: "One NEAR transaction: the NFT and its Bitcoin change hands",
    vo: [
      { at: "@connect", text: "To buy it, I connect a NEAR testnet wallet." },
      { at: "@price", text: "The price is half a NEAR. One click." },
      { at: "@buy-wallet", text: "The wallet shows what I'm signing: a call to buy, on the Pusaka contract." },
      { at: "@owned", text: "Done, in one NEAR transaction. I own Pusaka eleven now, and the Bitcoin inside moved with it. No bridge, no custodian." },
      { at: "@explorer", text: "Here is that transaction on the NEAR explorer." },
    ],
    cuts: [{ from: "@owner+4", to: "@explorer-1", label: "⏩ {s} s cut: the explorer indexing the tx" }],
    zoom: [{ at: "@price", for: 3 }, { at: "@owned", for: 4, scale: 1.7 }, { at: "@owner", for: 3, scale: 2 }, { at: "@explorer+1", region: [240, 120, 1440, 420], for: 6, scale: 1.3 }],
    callout: [{ at: "@buy-approve-2", region: "@buy-approve", for: 2.5, text: "The real wallet: call buy on pusaka-btc.testnet, deposit 0.5 NEAR" }],
    box: [{ at: "@connect", for: 2 }, { at: "@price", for: 3 }, { at: "@buy-approve-1", region: "@buy-approve", for: 2.5 }, { at: "@owned", for: 4 }, { at: "@owner", for: 3 }],
    x: {
      vo: [
        { at: "@price", text: "I buy it with one NEAR transaction, from a real wallet." },
        { at: "@owned", text: "The NFT and its Bitcoin are mine. No bridge, no custodian, and the seller kept no key." },
        { at: "@explorer", text: "On the explorer." },
      ],
      start: "@price-2",
    },
  },

  withdraw: {
    clip: "withdraw",
    caption: "NEAR MPC signs a real Bitcoin transaction",
    vo: [
      { at: "@form", text: "Only the current holder can move that Bitcoin. I send three thousand sats to another address." },
      { at: "@withdraw-wallet", text: "I approve one NEAR call. The contract builds the Bitcoin transaction itself and asks NEAR's MPC network to sign it." },
      { at: "@sent", text: "Signed, and broadcast to Bitcoin." },
      { at: "@mempool", text: "Here it is on Bitcoin testnet, spent from Pusaka eleven's address. The change goes back into the Pusaka." },
    ],
    cuts: [{ from: "@signing+2", to: "@sent-1", label: "⏩ {s} s cut: NEAR MPC signing" }],
    zoom: [{ at: "@form", for: 6, scale: 1.5 }, { at: "@sent", for: 3, scale: 1.8 }],
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
    caption: "Real attacks, refused on-chain",
    vo: [
      { at: 0.5, text: "And the previous owner? This page lists real transactions that the contracts refused." },
      { at: "@first", text: "The seller withdrawing after the sale, a front-run signature, a lender taking collateral early, an old holder spending from the NFT's own account. Each one names the test that guards it." },
      { at: "@explorer", text: "On the explorer: failed, with the contract's own error." },
    ],
    zoom: [{ at: "@first", for: 4, scale: 1.6 }],
    box: [{ at: "@first", for: 4 }],
    x: {
      vo: [
        { at: 0.5, text: "The old owner can't. These are real attacks the contracts refused, each guarded by a named test." },
        { at: "@explorer", text: "Failed on-chain." },
      ],
      cuts: [{ from: "@first+4", to: "@open-1", label: "⏩ {s} s cut: scrolling the list" }],
    },
  },

  check: {
    clip: "check",
    caption: "Check it yourself: answers from the chains, not from us",
    vo: [
      { at: "@click-1", text: "You don't have to trust this page. Check it yourself makes your browser ask NEAR, its MPC signer, its Bitcoin light client and Bitcoin directly." },
      { at: "@done", text: "No key on the contract, code that can't change, an address that really is the MPC's, and every proven sat really on Bitcoin." },
    ],
    cuts: [{ from: "@click+3", to: "@done-1", label: "⏩ {s} s cut: your browser asking the chains" }],
    zoom: [{ at: "@list", for: 6, scale: 1.5 }],
    box: [{ at: "@click", for: 2 }, { at: "@done", for: 4 }],
    x: { vo: [{ at: "@click-1", text: "Don't trust us. One click and your browser checks NEAR, the MPC signer, the light client and Bitcoin itself." }] },
  },

  chains: {
    clip: "chains",
    caption: "One NFT, many chains: all of it moves together",
    vo: [{ at: 0.5, text: "The same MPC keys give each Pusaka an address on Ethereum, Base and Arbitrum for ETH and USDC, a Solana address, and its own NEAR account. A sale moves all of it at once." }],
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
    start: "@offer-2",
    caption: "Borrow against the proven Bitcoin, gas-free",
    cuts: [{ from: "@accept-approve+1.5", to: "@taken-1", label: "⏩ {s} s cut: relayer submitting" }],
    vo: [
      { at: "@offer", text: "A Pusaka is collateral. This lender's standing offer is open to any Pusaka with ten thousand proven sats." },
      { at: "@accept-wallet", text: "I accept it. I only sign: a relayer pays the gas, so a Bitcoin holder with no NEAR can still borrow." },
      { at: "@taken", text: "The NEAR comes to me." },
    ],
    box: [{ at: "@offer", for: 3 }, { at: "@accept", for: 2 }],
    zoom: [{ at: "@offer", for: 3, scale: 1.5 }],
  },

  repay: {
    clip: "repay",
    start: "@locked-2",
    caption: "Collateral until repaid",
    cuts: [{ from: "@repay-approve+1.5", to: "@repaid-1", label: "⏩ {s} s cut: transaction confirming" }],
    vo: [
      { at: "@locked", text: "Until the loan is repaid, the Pusaka is collateral: no withdrawal, sale or transfer. If I don't repay in time, the lender takes it, with the Bitcoin inside." },
      { at: "@repaid", text: "I repay, and it's unlocked." },
    ],
    box: [{ at: "@locked", for: 4 }, { at: "@repay", for: 2 }, { at: "@repaid", for: 3 }],
    zoom: [{ at: "@locked", for: 4, scale: 1.3 }, { at: "@repaid", for: 3, scale: 1.8 }],
  },

  heir: {
    clip: "heir",
    start: "@section-2",
    caption: "Inheritance: if the holder goes silent, the heir claims",
    vo: [
      { at: "@section", text: "Pusaka means heirloom. On Pusaka three, I name an heir and a silence period: ten minutes here, to show it." },
      { at: "@name-wallet", text: "One transaction writes the will into the contract." },
      { at: "@will", text: "If I stay silent that long, the heir can claim the Pusaka with everything it holds." },
      { at: "@still", text: "Anything I do restarts the clock. I'm still here is one click, and the relayer pays for it." },
    ],
    cuts: [
      { from: "@name-approve+1.5", to: "@named-1", label: "⏩ {s} s cut: transaction confirming" },
      { from: "@will+4", to: "@later-1", label: "⏩ {s} s cut: waiting for the next free check-in" },
      { from: "@still-approve+1.5", to: "@checked-1", label: "⏩ {s} s cut: relayer submitting" },
    ],
    box: [{ at: "@heir-to", for: 3 }, { at: "@after", for: 2.5 }, { at: "@will", for: 4 }, { at: "@still", for: 2 }, { at: "@will2", for: 4 }],
    zoom: [{ at: "@will", for: 4, scale: 1.6 }, { at: "@will2", for: 4, scale: 1.6 }],
  },

  claim: {
    clip: "claim",
    caption: "Ten minutes of silence later, the heir claims",
    cuts: [
      { from: "@connect-0.5", to: "@connected", label: "⏩ {s} s cut: the heir connects a wallet" },
      { from: "@claim-approve+2", to: "@claimed-1", label: "⏩ {s} s cut: relayer submitting the claim" },
    ],
    vo: [
      { at: 0.5, text: "Ten minutes later, with no check-in, the heir opens the same page and connects." },
      { at: "@claim", text: "Claim inheritance. Gas-free again." },
      { at: "@owner", text: "Pusaka three now belongs to the heir. No lawyer, and no seed phrase handed over." },
    ],
    box: [{ at: "@owner-before", for: 3 }, { at: "@claim", for: 2 }, { at: "@claimed", for: 3 }, { at: "@owner", for: 4 }],
    zoom: [{ at: "@owner", for: 4, scale: 2 }],
  },

  letter: {
    clip: "letter",
    caption: "A sealed letter only the current holder can open",
    cuts: [
      { from: "@seal-approve+1.5", to: "@seal-wallet2-2", label: "⏩ {s} s cut: NEAR MPC deriving the letter key" },
      { from: "@seal-approve2+1.5", to: "@sealed-1", label: "⏩ {s} s cut: sealing" },
      { from: "@sealed+3", to: "@reopen-1.5", label: "⏩ {s} s cut: reloading the page" },
      { from: "@reopen-approve+1.5", to: "@letter-1", label: "⏩ {s} s cut: NEAR MPC deriving the key again" },
    ],
    vo: [
      { at: "@section", text: "The holder room is gated by the NFT." },
      { at: "@write", text: "I write a letter for whoever holds this Pusaka next." },
      { at: "@seal", text: "It's sealed with a key that NEAR's MPC network derives for this Pusaka alone." },
      { at: "@letter", text: "Only the current holder can open it. When the Pusaka is sold, the letter goes to the buyer." },
    ],
    box: [{ at: "@write", for: 4 }, { at: "@letter", for: 4 }],
    zoom: [{ at: "@letter", for: 4, scale: 1.6 }],
  },

  gift: {
    clip: "gift",
    caption: "Give a Pusaka as a link",
    cuts: [{ from: "@make-approve+1.5", to: "@link-2", label: "⏩ {s} s cut: transaction confirming" }],
    vo: [
      { at: "@section", text: "A Pusaka can also be given as a link." },
      { at: "@make-wallet", text: "One transaction holds it in the contract behind a one-time key." },
      { at: "@link", text: "The link carries that key, so it's blurred here." },
    ],
    callout: [{ at: "@link", for: 4, text: "Blurred on purpose: the link carries the one-time key" }],
  },

  "gift-claim": {
    clip: "gift-claim",
    caption: "The recipient needs no wallet",
    vo: [
      { at: "@gift", text: "Whoever opens the link needs no wallet." },
      { at: "@name", text: "They pick a name." },
      { at: "@claimed", text: "A new NEAR account is created, and the Pusaka is theirs. The page shows the new account's key once; it's blurred here." },
    ],
    box: [{ at: "@gift", for: 3 }, { at: "@claimed", for: 3 }],
    callout: [{ at: "@key", for: 4, text: "Blurred on purpose: the new account's private key" }],
  },

  passkey: {
    clip: "passkey",
    caption: "No wallet at all? A passkey",
    vo: [
      { at: "@passkey", text: "No wallet at all? A passkey works too." },
      { at: "@account", text: "Its key becomes a NEAR account, and listings, loans and check-ins are gas-free through the relayer." },
    ],
    box: [{ at: "@passkey", for: 2 }, { at: "@account", for: 4 }],
  },

  v2: {
    clip: "v2",
    caption: "Smart Pusakas: the NFT has its own account",
    vo: [
      { at: 0.5, text: "Smart Pusakas run on a second contract. Each one has its own NEAR account with no keys, which only the current holder can use." },
      { at: "@pq", text: "The holder can add a post-quantum lock: every owner action then needs an ML-DSA signature, verified on-chain." },
      { at: "@agent", text: "An AI agent can get a daily budget that the contract enforces, payable only to listed accounts." },
      { at: "@history", text: "It can also be rented out, sold for native Bitcoin proven by the light client, put in a vault with a clawback, or held under a covered call." },
    ],
    box: [{ at: "@account", for: 3 }, { at: "@pq", for: 3 }, { at: "@agent", for: 3 }],
  },

  "v2-act": {
    clip: "v2-act",
    caption: "Sign in as the NFT · prove its Bitcoin address",
    cuts: [
      { from: "@connect-0.5", to: "@connected", label: "⏩ {s} s cut: the holder connects a wallet" },
      { from: "@signin-approve+1.5", to: "@signedin-1", label: "⏩ {s} s cut: NEAR MPC signing" },
      { from: "@bip322-approve+1.5", to: "@proof-1", label: "⏩ {s} s cut: NEAR MPC signing" },
    ],
    vo: [
      { at: "@signin", text: "As the holder of Smart Pusaka seven, I sign in to this site as the NFT." },
      { at: "@signin-wallet", text: "The NFT's own key, held by NEAR's MPC network, signs a standard Sign-In with Ethereum message." },
      { at: "@signedin", text: "Whoever holds the NFT next gets that identity." },
      { at: "@bip322", text: "It also signs a BIP-322 proof that it controls its Bitcoin address." },
    ],
    box: [{ at: "@signin", for: 2 }, { at: "@signedin", for: 4 }, { at: "@proof", for: 4 }],
    zoom: [{ at: "@signedin", for: 4, scale: 1.5 }, { at: "@proof", for: 4, scale: 1.5 }],
  },

  bids: {
    clip: "bids",
    caption: "A market that prices Bitcoin per verified sat",
    vo: [
      { at: 0.5, text: "A second market contract works with any Pusaka." },
      { at: "@bids", text: "Standing bids are priced per verified sat. A holder sells into one, and the market reads the proven sats on-chain and pays exactly that. A bid can also be a buy pool that stays open for several fills." },
      { at: "@offers", text: "Loans here have no due date. A lender who wants out calls the loan, and a rate auction starts: another lender can take it over, or the first one takes the Pusaka." },
    ],
    box: [{ at: "@bids", for: 3 }, { at: "@offers", for: 3 }, { at: "@loans", for: 3 }],
  },

  agents: {
    clip: "agents",
    caption: "Tools for AI agents, and an audit paid over x402",
    vo: [
      { at: "@top", text: "For AI agents there is an MCP server with fifty-five tools, with spending caps and outflow gates an agent can't talk its way around." },
      { at: "@tools", text: "This remote endpoint serves the read-only ones." },
      { at: "@x402", text: "The audit endpoint is paid per call over x402. It answers 402, Payment Required, until a gasless wNEAR payment settles on NEAR." },
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
  Full: ["title", "landing", "token", "buy", "withdraw", "refused", "check", "chains", "loan", "repay", "heir", "claim", "letter", "gift", "gift-claim", "passkey", "v2", "v2-act", "bids", "agents", "end"],
  X: ["title", "token", "buy", "withdraw", "refused", "check", "rest", "end"],
};
export const limits = { X: 135 }; // seconds: X allows 2:20 without Premium
