// node web/src/ics.test.mjs: the reminder file is valid RFC 5545 that calendars accept.
import assert from "node:assert/strict";
import { ics, googleHref } from "./ics.js";

const at = Date.UTC(2026, 10, 8, 2, 28, 1);
const ev = { uid: "loan-15-1794104881000@pusaka", title: "Repay Pusaka #15: 0.0501 NEAR, or lose it; (BTC)", at, details: "Lender a.testnet, due now", url: "https://pusaka-two.vercel.app/#/pusaka/15" };
const s = ics({ ...ev, now: at - 1000 });
assert.ok(s.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
assert.ok(s.endsWith("END:VCALENDAR\r\n"));
assert.match(s, /\r\nDTSTART:20261108T022801Z\r\n/);
assert.match(s, /\r\nDTEND:20261108T024301Z\r\n/);
assert.match(s, /\r\nTRIGGER:-PT1440M\r\n/);
assert.ok(s.includes(String.raw`SUMMARY:Repay Pusaka #15: 0.0501 NEAR\, or lose it\; (BTC)`)); // escaped , and ;
assert.ok(s.split("\r\n").every((l) => l.length <= 75), "folded at 75");
assert.ok(!/[^\r]\n/.test(s), "CRLF only");
const unfolded = s.replace(/\r\n /g, "");
assert.ok(unfolded.includes(String.raw`DESCRIPTION:Lender a.testnet\, due now\nhttps://pusaka-two.vercel.app/#/pusaka/15`));
const g = new URL(googleHref(ev));
assert.equal(g.searchParams.get("dates"), "20261108T022801Z/20261108T024301Z");
console.log("ics ok");
