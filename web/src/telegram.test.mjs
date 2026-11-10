// node web/src/telegram.test.mjs: a t.me/...?startapp=<param> deep link opens the right hash route.
import assert from "node:assert/strict";
import { routeOf } from "./telegram.js";

assert.equal(routeOf("token-5"), "#/pusaka/5");
assert.equal(routeOf("pusaka-007"), "#/pusaka/7");
assert.equal(routeOf("v2-3"), "#/v2/3");
assert.equal(routeOf("market"), "#/market");
assert.equal(routeOf("v2"), "#/v2");
const key = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy3J98t1WpEZ73CNmQvi";
assert.equal(routeOf(`gift-${key}`), `#/gift/ed25519:${key}`);
for (const junk of [undefined, null, "", "token-", "token-1a", "token--1", "x", "market-1", "../mine"]) assert.equal(routeOf(junk), "#/", String(junk));
console.log("telegram ok");
