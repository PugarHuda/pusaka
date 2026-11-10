// Passkey onboarding, end to end on testnet, in Chromium with a CDP virtual authenticator that supports PRF:
// make a passkey in the app -> its NEAR implicit account -> fund it (0.05 NEAR) -> receive a Pusaka -> list and
// cancel it gas-free through the relayer (signed by the passkey) -> hand the Pusaka back (signed by the passkey).
//   npm run dev -w web   then   node web/e2e/passkey-qa.mjs <owner-with-key-in-.keys> <token_id>
// /api/relay is served by api/_relayer.mjs in this process (vite has no functions), paid by .keys/pusaka-relayer.testnet.
// No private key is printed: the passkey's key exists only inside the page, re-derived for each signature.
import fs from "node:fs";
import { chromium } from "playwright";
import { actions, teraToGas } from "near-api-js";
import { account, view } from "../../scripts/lib.mjs";

const [ownerId, tokenId] = process.argv.slice(2);
const URL_ = process.env.E2E_URL ?? "http://localhost:5173/";
process.env.RELAYER_ACCOUNT_ID ??= "pusaka-relayer.testnet";
process.env.RELAYER_PRIVATE_KEY ??= JSON.parse(fs.readFileSync(new URL("../../.keys/pusaka-relayer.testnet.json", import.meta.url))).private_key;
const { relay } = await import("../../api/_relayer.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cooldown = async () => { // the relayer allows one gas-free state change per token per minute
  const last = Number((await view("token_info", { token_id: tokenId })).history.at(-1).at_ms);
  const wait = last + 62_000 - Date.now();
  if (wait > 0) { console.log(`waiting ${Math.ceil(wait / 1000)} s for the relayer's per-token cooldown`); await sleep(wait); }
};

const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const p = await b.newPage();
p.on("pageerror", (e) => console.log("pageerror:", e.message));
const cdp = await p.context().newCDPSession(p);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
  protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true,
} });
await p.route("**/api/relay", async (route) => {
  try { route.fulfill({ json: await relay(JSON.parse(route.request().postData()).signed_delegate) }); }
  catch (e) { route.fulfill({ status: e.status ?? 500, json: { error: e.message } }); }
});
const inPage = (fn, arg) => p.evaluate(fn, arg);
try {
  await p.goto(URL_);
  await p.getByRole("button", { name: "Use a passkey" }).click();
  const who = p.getByRole("button", { name: /\(passkey\)/ });
  await who.waitFor({ timeout: 20_000 });
  const id = await inPage(() => localStorage.getItem("pusaka-passkey"));
  console.log("passkey account:", id, "| header:", await who.innerText(), "| toast:", await p.locator(".toast").innerText().catch(() => ""));
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("not an implicit account id");

  // same passkey, same account: sign out and back in
  await who.click();
  await p.getByRole("button", { name: "Use a passkey" }).click();
  await who.waitFor();
  if (await inPage(() => localStorage.getItem("pusaka-passkey")) !== id) throw new Error("the passkey derived a different account");
  console.log("signed in again with the same passkey: same account");

  // open the account (0.05 NEAR) and give it a Pusaka to act on
  const owner = account(ownerId);
  const fund = await account("pusaka-admin.testnet").signAndSendTransaction({ receiverId: id, actions: [actions.transfer(5n * 10n ** 22n)] });
  console.log("funded 0.05 NEAR:", fund.transaction.hash);
  const give = await owner.callFunctionRaw({ contractId: "pusaka-btc.testnet", methodName: "nft_transfer", args: { receiver_id: id, token_id: tokenId }, deposit: 1n, gas: teraToGas(100) });
  console.log(`gave Pusaka #${tokenId}:`, give.transaction.hash);
  await cooldown();

  const gasless = (method, args) => inPage(([m, a]) => import("/src/near.js").then((n) => n.callGasless(m, a)), [method, args]);
  const listed = await gasless("list", { token_id: tokenId, price: "700000000000000000000000" });
  console.log("RELAYED list (signed by the passkey, gas paid by the relayer):", JSON.stringify(listed));
  console.log("listing on chain:", (await view("token_info", { token_id: tokenId })).listing?.price);
  await cooldown();
  console.log("RELAYED cancel_listing:", JSON.stringify(await gasless("cancel_listing", { token_id: tokenId })));

  // hand it back: a normal transaction (1 yocto deposit, so not relayable) signed with the passkey's key
  const back = await inPage(async ([to, t]) => {
    const [{ passkeyAccount }, { provider }] = await Promise.all([import("/src/passkey.js"), import("/src/near.js")]);
    const a = await passkeyAccount(provider);
    const r = await a.callFunctionRaw({ contractId: "pusaka-btc.testnet", methodName: "nft_transfer", args: { receiver_id: to, token_id: t }, deposit: 1n, gas: 30n * 10n ** 12n });
    return r.transaction.hash;
  }, [ownerId, tokenId]);
  console.log(`returned Pusaka #${tokenId} to ${ownerId} (signed by the passkey):`, back, "| owner now:", (await view("token_info", { token_id: tokenId })).token.owner_id);
} finally { await b.close(); }
