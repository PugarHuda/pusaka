// #/docs: how Pusaka works. The product pages stay short; the explanations live here. Loaded on demand.
const REPO = "https://github.com/PugarHuda/pusaka/blob/main";

const SECTIONS = [
  ["basics", "What a Pusaka is", <>
    <p>A Pusaka is a NEAR NFT that controls its own native Bitcoin address through NEAR Chain Signatures. The address's key is held
      by NEAR's MPC network and is used only when the contract asks, and the contract asks only for the NFT's current holder. Sell
      or give the NFT and control of the Bitcoin goes with it, in one NEAR transaction: no bridge, no wrapped BTC, no custodian.</p>
    <p>The Bitcoin inside is proven, not claimed: every deposit is checked against Bitcoin's own block headers by NEAR's on-chain
      Bitcoin light client, and the contract subtracts everything it ever signed away. That number, <code>verified_sats</code>,
      is what prices, loans and inheritance are set against.</p>
    <p>The same key also controls an address on every EVM chain, and a second key is a Solana address and the Pusaka's own NEAR account.</p>
  </>],
  ["collections", "Two collections", <>
    <p><strong>Pusaka</strong> (<code>pusaka-btc.testnet</code>) is final: its account has no keys and upgrades were renounced, so
      nobody, us included, can change its rules.</p>
    <p><strong>Smart Pusakas</strong> (<code>pusaka-v2.testnet</code>) are the same contract plus everything newer on this page. Its code
      changes only through a DAO vote (2 of 3) and a 10-minute timelock; until its deploy key is deleted on 13 Nov, the team can
      also change it directly, and <a href={`${REPO}/scripts/verify.mjs`}>verify.mjs</a> reports that key until then.</p>
  </>],
  ["sell", "Selling without a way back in", <>
    <p>A buyer checks the Bitcoin inside and buys against the token's <em>sign epoch</em>: if anything was signed since they looked,
      the purchase fails. Outside markets see the token frozen while it's approved to them, and wait an hour after its last signature.</p>
  </>],
  ["account", "Its own NEAR account", <>
    <p>Every Smart Pusaka has a NEAR account (NEP-616, <code>0s…</code>) whose address is fixed by its content, so anyone can send to it
      before it exists. It has no keys and obeys only the contract, which forwards calls from the current holder and only while the
      Pusaka isn't for sale, pledged or signing, so a seller can't empty it before a sale settles. A readable alias,
      <code> t&lt;id&gt;.pusaka-v2.testnet</code>, works the same way. When the NFT changes hands, the account goes with it.</p>
    <p>Its NEAR Intents balance changes hands too: the contract refuses to give the account a signing key on the verifier.</p>
  </>],
  ["pq", "Post-quantum lock", <>
    <p>The holder can register an ML-DSA-65 key. From then on every owner action needs a fresh unlock signed with it and checked
      on-chain (<code>ml_dsa_verify</code>), so a NEAR key broken by a quantum computer alone can't move or drain the Pusaka. It guards
      the NEAR side; the Bitcoin, EVM and Solana keys are NEAR MPC keys, which have no post-quantum scheme yet.</p>
  </>],
  ["vault", "Vault", <>
    <p>A Bitcoin covenant vault delays a withdrawal so its owner can claw it back if a key was stolen. Bitcoin can't do that yet
      (CTV and OP_CAT aren't active), so the contract does it: in a vault, every owner action (transfer, sale, withdrawal, account call)
      waits for an unlock requested a set delay earlier. The recovery account, your cold wallet or a guardian, is notified and can
      take the Pusaka back during the delay. Changing or removing the vault is itself an owner action, so a thief waits too.</p>
  </>],
  ["call", "Call options", <>
    <p>The holder can sell the right to buy their Pusaka at a fixed price until a date, and keeps the premium either way. While the
      option is open the Pusaka is held: its Bitcoin can't leave, and it can't be sold elsewhere. The option can be passed on;
      exercising pays the holder like a sale, royalty included. The price can also be set in Bitcoin: the option's holder reserves,
      pays on Bitcoin with the reservation's OP_RETURN, and NEAR's light client proves it before the Pusaka moves.</p>
  </>],
  ["agent", "An agent's budget", <>
    <p>The holder can let an AI agent spend from the NFT's account, up to a daily amount and only to listed accounts. The contract
      enforces it, not the agent's software: a hacked agent loses at most a day's budget, never while the Pusaka is for sale or
      pledged, and the budget ends when it changes hands.</p>
  </>],
  ["signin", "Signing in as the NFT", <>
    <p>Its own EVM key signs a standard Sign-In with Ethereum message naming the holder, valid for an hour, so a site sees the
      Pusaka's address as the user. While it's valid the Pusaka can't be listed or approved to a market, so it can't outlive a sale.
      A renter (ERC-4907 style) can sign in too, without being able to move it or what it holds.</p>
  </>],
  ["bip322", "Proving its Bitcoin address", <>
    <p>Its Bitcoin key signs a BIP-322 message naming the holder and the NEAR block. Any BIP-322 verifier accepts it: exchange
      whitelists, reserve audits.</p>
  </>],
  ["btc", "Buying with Bitcoin", <>
    <p>A buyer reserves the sale on NEAR (0.1 NEAR bond, back on purchase), pays on Bitcoin with the reservation's OP_RETURN, and
      anyone proves the payment with NEAR's Bitcoin light client; then the NFT moves. A payment can buy only once, and only for the
      reservation it names.</p>
  </>],
  ["market", "Bids, pools and loans", <>
    <p>The market contract holds bids priced per verified sat: sell any Pusaka into one in a single transaction. A pool is a bid that
      stays open for several Pusakas, its price dropping a step after each one. Loans have no due date: the lender can call one,
      which starts an auction where another lender can take it over or the borrower repays.</p>
  </>],
  ["heir", "Inheritance", <>
    <p>The holder names an heir and a silence period; anything they sign restarts the clock. After the silence, the heir claims it,
      optionally only once guardians approve. An open sale, loan request or gift ends; a lender's or a paying buyer's claim comes first.</p>
  </>],
  ["agents", "For AI agents", <>
    <p>An MCP server gives agents the whole app, with a spend cap and, where the host supports it, your approval before anything is
      signed. A proof-of-reserves audit can also be bought per call over x402 on NEAR. The agent's registration file is at
      <a href="/.well-known/agent-registration.json"> /.well-known/agent-registration.json</a>.</p>
  </>],
  ["onboarding", "Passkeys, gas-free actions, Telegram", <>
    <p>No wallet? A passkey gives you a NEAR account; listing, loan and inheritance actions are paid by our relayer. The app also
      opens inside Telegram as a Mini App.</p>
  </>],
  ["verify", "Check it yourself", <>
    <p><code>node scripts/verify.mjs</code> checks the contract's code, keys, MPC derivation and Bitcoin reserves against the chains
      with no wallet. The <a href="#/refused">Refused</a> page lists real attacks the contracts turned down. More in the
      <a href={`${REPO}/README.md`}> README</a> and <a href={`${REPO}/docs/V2.md`}>docs/V2.md</a>.</p>
  </>],
];

export default function DocsPage() {
  return (
    <section className="docs">
      <h1>How it works</h1>
      <nav aria-label="On this page"><ul className="row">{SECTIONS.map(([id, title]) => <li key={id}><a href="#/docs" onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView(); }}>{title}</a></li>)}</ul></nav>
      {SECTIONS.map(([id, title, body]) => <article key={id} id={id}><h2>{title}</h2>{body}</article>)}
    </section>
  );
}
