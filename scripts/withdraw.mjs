import { account, call, view, btcAddress, scriptHex, balances, finalize, broadcast, WITHDRAW_DEPOSIT, MINT_DEPOSIT } from "./lib.mjs";
const owner = account(process.argv[2] ?? "pusaka-seller.testnet");
const id = process.argv[3] ?? "1";
const to = process.argv[4] ?? "tb1qerzrlxcfu24davlur5sqmgzzgsal6wusda40er";
const info = await view("token_info", { token_id: id });
const addr = btcAddress(info.btc_pubkey);
const { safe, spendable: utxos } = await balances(addr, info.signed_outpoints);
console.log(addr, "safe", safe, "utxos", utxos.length);
const ins = utxos.slice(0, 8);
const t0 = Date.now();
const signed = await call(owner, "withdraw", {
  token_id: id,
  utxos: ins.map(u => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
  to_script_hex: scriptHex(to), amount_sat: "10000", fee_sat: "500",
}, { deposit: WITHDRAW_DEPOSIT, tgas: 300 });
console.log("MPC signed in", ((Date.now() - t0) / 1000).toFixed(1), "s;", signed.signatures.map(s => !!s));
const tx = finalize(signed, ins.map(u => u.value));
console.log("txid", await broadcast(tx.toHex()));
