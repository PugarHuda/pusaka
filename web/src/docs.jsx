import { useEffect, useState } from "react";

// #/docs: how Pusaka works. The product pages stay short; the explanations live here. Loaded on demand.
const REPO = "https://github.com/PugarHuda/pusaka/blob/main";

// Terms used across the app, in plain words.
const TERMS = [
  ["NFT (NEP-171)", "A unique token on NEAR. Each Pusaka is one; whoever holds it controls what's inside."],
  ["Chain Signatures", "NEAR's way for a contract to sign transactions on other chains (Bitcoin, Ethereum, Solana) with keys held by NEAR's MPC network."],
  ["MPC network", "A group of independent NEAR nodes that hold a key between them; no single node can sign alone. They sign only what the Pusaka contract asks for."],
  ["Bitcoin light client", "A NEAR contract (btc-client-v4.testnet; btc-client.bridge.near on mainnet) that follows Bitcoin's block headers, so a contract can check a Bitcoin transaction really happened."],
  ["Proving a deposit", "Showing the light client a deposit's merkle proof. Once it accepts, the sats count as verified on NEAR."],
  ["verified_sats", "The Bitcoin inside a Pusaka as NEAR knows it: every proven deposit minus every output the contract ever signed away. Prices, loans and badges use this number."],
  ["sats / UTXO", "1 BTC = 100,000,000 sats. A UTXO is one unspent Bitcoin output: a coin the Pusaka's address can spend."],
  ["testnet3", "Bitcoin's public test network, the one NEAR's testnet light client tracks. Its coins have no value."],
  ["Sign epoch", "A counter that goes up every time a Pusaka signs something. A buy or a loan names the epoch the buyer saw and fails if it moved."],
  ["Clean to buy / proof of clean", "A check that nothing the seller already signed could still move what's inside, on every chain the Pusaka holds funds; also a JSON format and a badge."],
  ["Heir and silence period", "The person who inherits a Pusaka, and how long the holder must stay silent before they can claim it."],
  ["Guardians", "Optional accounts that must approve an heir's claim; protects against a lost or hostile heir."],
  ["Dutch auction", "A sale whose price falls over time from a start price to a floor; the first buyer pays the price at that moment."],
  ["LTV (loan-to-value)", "A loan's size compared with the value of the Bitcoin pledged for it. The pool liquidates from 80% on testnet."],
  ["Liquidation", "When a pool loan's LTV gets too high, anyone can repay it and take the Pusaka at a discount; any surplus goes to the borrower."],
  ["Circle USDC", "Circle's official testnet dollar token, lent by the pool. pUSD was the earlier test token, no longer used by the pool."],
  ["nBTC", "Bitcoin bridged to NEAR by the Omni bridge. A Smart Pusaka can hold it and redeem it to native Bitcoin; it is counted apart from native sats."],
  ["NEAR Intents", "A way to swap between chains by stating what you want; solvers fill it. Used for the exit quote and swaps."],
  ["Smart Pusaka", "A Pusaka on pusaka-v2.testnet with its own keyless NEAR account, bundles, vault, options and more."],
  ["Keyless contract", "A contract account with no access keys: nobody can sign as it, so its code changes only by its own rules (a DAO vote and timelock, or never)."],
  ["DAO and timelock", "The Smart Pusaka contract changes only after 2 of 3 council members vote, and then only 10 minutes after the new code is announced."],
  ["Reproducible build (NEP-330)", "Anyone can rebuild the contract from the source and get the exact bytes deployed on-chain."],
  ["TEE / Shade Agent", "Code running in attested hardware (Phala TDX). Its key never leaves the enclave; it proves deposits and can claim for an heir."],
  ["Relayer / gas-free", "Our account that pays NEAR gas for some actions (NEP-366 meta-transactions), so you can act without holding NEAR."],
  ["MCP", "Model Context Protocol: lets an AI agent use Pusaka through tools, with spend caps."],
  ["x402", "Pay-per-call over HTTP: an agent pays a few cents in NEAR for a proof-of-reserves audit."],
  ["BIP-322 / SIWE", "Standard signed messages proving a Pusaka controls a Bitcoin address (BIP-322) or signing in to a website as the Pusaka (SIWE)."],
  ["OP_RETURN", "A data field in a Bitcoin transaction. Withdrawals carry pusaka:<id>; a Bitcoin purchase carries its reservation code."],
];

const SECTIONS = [
  ["why", "Why Pusaka", <>
    <p>Putting Bitcoin in an NFT usually means wrapped BTC or a custodian: someone else holds the coins and you hold an IOU.
      Pusaka gives each NFT its own real Bitcoin address. Whoever holds the NFT controls the Bitcoin, and NEAR itself checks
      how much is inside, so you can sell it, borrow against it or leave it to someone, and the Bitcoin moves with it.</p>
    <p><em>Pusaka</em> is Indonesian for an heirloom: something valuable passed from hand to hand.</p>
  </>],
  ["flow", "How it works, step by step", <>
    <ol>
      <li><strong>Mint.</strong> The contract asks NEAR's MPC network for the public key at path <code>pusaka-&lt;id&gt;</code> and
        stores it. That key's Bitcoin address belongs to this NFT; nobody can mint one pointing at an address they control.</li>
      <li><strong>Deposit.</strong> Anyone sends Bitcoin to the address shown on the Pusaka's page.</li>
      <li><strong>Prove.</strong> After a confirmation, the deposit is proven to NEAR's Bitcoin light client (free: our relayer or
        the TEE agent pays). <code>verified_sats</code> goes up.</li>
      <li><strong>Sell, lend or leave it.</strong> List it, take a loan against it or name an heir. Buying is one NEAR transaction
        that moves the NFT, and with it control of the Bitcoin. Nothing happens on Bitcoin.</li>
      <li><strong>Withdraw.</strong> The holder asks to send Bitcoin out. The contract builds the transaction itself, the MPC network
        signs it, and the contract records the spent coins so <code>verified_sats</code> stays right.</li>
    </ol>
  </>],
  ["clean", "Clean to buy", <>
    <p>A seller could sign a withdrawal and then sell the NFT before it lands. So before paying, the token page checks every chain
      the Pusaka holds funds on (Bitcoin, three EVM chains, Solana, its NEAR account) for anything already signed that could still
      move them. The purchase itself names the sign epoch the buyer saw and fails if anything was signed since. The same answer is
      published as a badge and as JSON (<a href={`${REPO}/docs/PROOF-OF-CLEAN.md`}>proof of clean</a>).</p>
  </>],
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
      changes only through a DAO vote (2 of 3) and a 10-minute timelock; its deploy key was deleted on 13 Nov, and
      <a href={`${REPO}/scripts/verify.mjs`}>verify.mjs</a> checks that the account has no key.</p>
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
    <p>A buyer reserves the sale on NEAR (0.1 NEAR bond, back on purchase; refused if anything was signed since they looked), pays on Bitcoin with the reservation's OP_RETURN, and
      anyone proves the payment with NEAR's Bitcoin light client; then the NFT moves. A payment can buy only once, and only for the
      reservation it names.</p>
  </>],
  ["market", "Bids, pools and loans", <>
    <p>The market contract holds bids priced per verified sat: sell any Pusaka into one in a single transaction. A pool is a bid that
      stays open for several Pusakas, its price dropping a step after each one. Loans have no due date: the lender can call one,
      which starts an auction where another lender can take it over or the borrower repays.</p>
  </>],
  ["pool", "Borrowing Circle USDC", <>
    <p>Besides loans from a person in NEAR, a Pusaka can back a loan in Circle's testnet USDC from a shared pool
      (<code>pusaka-lend.testnet</code>). Lenders deposit USDC and earn interest. The Bitcoin price comes from three reporters
      (mempool.space, CoinGecko, Rhea), and two of three must agree. Borrow up to 79.5% of the Bitcoin's value on testnet; from 80%
      anyone can liquidate, paying the debt and receiving the Pusaka at a discount, with any surplus paid to the borrower.
      On mainnet the limits would be 50% and 80%.</p>
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
  ["real", "What's real today", <>
    <p>Everything runs on NEAR testnet and Bitcoin testnet3, with real transactions you can look up; coins on test networks have no
      value. It isn't on mainnet yet, but NEAR's mainnet Bitcoin light client already accepts Pusaka's proofs
      (<code>node scripts/mainnet-proof.mjs</code>). The price reporters, the gas relayer and the three DAO members are run by us.
      NEAR Intents swaps run on a testnet sandbox; mainnet is shown as a live quote.</p>
  </>],
  ["terms", "Glossary", <dl className="glossary">{TERMS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}</dl>],
  ["verify", "Check it yourself", <>
    <p><code>node scripts/verify.mjs</code> checks the contract's code, keys, MPC derivation and Bitcoin reserves against the chains
      with no wallet. The <a href="#/refused">Refused</a> page lists real attacks the contracts turned down. More in the
      <a href={`${REPO}/README.md`}> README</a> and <a href={`${REPO}/docs/V2.md`}>docs/V2.md</a>.</p>
  </>],
];

export default function DocsPage() {
  const [here, setHere] = useState(SECTIONS[0][0]);
  useEffect(() => { // the contents mark the section being read: the topmost one in the upper third of the screen
    const io = new IntersectionObserver((es) => {
      const top = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setHere(top.target.id);
    }, { rootMargin: "0px 0px -66% 0px" });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  return (
    <section className="docs">
      <h1>Docs: how Pusaka works</h1>
      <div className="docs-body">
        <nav aria-label="On this page" className="toc">
          <p>On this page</p>
          <ul>{SECTIONS.map(([id, title]) => (
            <li key={id}><a href="#/docs" className={here === id ? "is-here" : undefined} aria-current={here === id ? "location" : undefined}
              onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); setHere(id); }}>{title}</a></li>
          ))}</ul>
        </nav>
        <div className="docs-text">{SECTIONS.map(([id, title, body]) => <article key={id} id={id}><h2>{title}</h2>{body}</article>)}</div>
      </div>
    </section>
  );
}
