# Pusaka as a Telegram Mini App

The web app already works as a Mini App (`web/src/telegram.js`): when Telegram opens it, it loads
`telegram-web-app.js`, calls `ready()` and `expand()`, takes Telegram's theme colours, drives Telegram's
Back button from the app's hash history, and opens the page named by a `startapp` deep link. In a normal
browser the file does nothing and loads nothing.

Creating the bot needs a human Telegram account, so these steps are yours.

## 1. Create the bot (BotFather)

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Name: `Pusaka`. Username: must end in `bot`, e.g. `PusakaBtcBot`.
3. BotFather replies with a bot token. Keep it private. Nothing in this repo needs it: the Mini App only reads public data and signs with the user's own NEAR wallet.

## 2. Create the Mini App

1. Send `/newapp` to BotFather and pick the bot.
2. Title `Pusaka`, short description e.g. `NFTs that hold real Bitcoin (NEAR testnet)`.
3. Photo: upload a 640x360 image (cropping `web/public/og.png` works). GIF: send `/empty`.
4. Web App URL: `https://pusaka-two.vercel.app/`
5. Short name: `app` (letters, digits and underscores). The app now opens at `https://t.me/<bot_username>/app`.

Optional:

- `/mybots` → the bot → Bot Settings → Menu Button → set the URL to `https://pusaka-two.vercel.app/` and the text to `Open Pusaka`, so the chat has a button that opens it.
- `/mybots` → the bot → Bot Settings → Configure Mini App → Enable Mini App: this makes it the bot's main Mini App, so it opens from the bot's profile and from `https://t.me/<bot_username>?startapp`.

## 3. Deep links (`startapp`)

Telegram allows only `A-Z a-z 0-9 _ -` in the parameter, so `-` stands in for `/`:

| Link | Opens |
| --- | --- |
| `https://t.me/<bot>/app` | `#/` (home) |
| `https://t.me/<bot>/app?startapp=token-5` (or `pusaka-5`) | `#/pusaka/5` |
| `https://t.me/<bot>/app?startapp=market` | `#/market` (also `mine`, `agents`, `refused`, `bids`, `reserves`, `v2`) |
| `https://t.me/<bot>/app?startapp=v2-3` | `#/v2/3` |
| `https://t.me/<bot>/app?startapp=gift-<base58 key>` | `#/gift/ed25519:<base58 key>` |

Anything else opens home. The mapping is checked by `node web/src/telegram.test.mjs`.

A gift link in `startapp` carries the gift's secret key, exactly like the web gift link: whoever has the link can claim the gift.

## 4. Check it

Open `https://t.me/<bot>/app?startapp=token-5` on a phone: the page for Pusaka #5 opens in Telegram's colours,
and Telegram's Back button goes back through pages (to home from a deep-linked first page).

## Known limit: Telegram Web

`vercel.json` sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` on every page.
Telegram's phone and desktop apps open Mini Apps in their own webview, so they are fine. Telegram Web
(`web.telegram.org`) loads Mini Apps in an iframe, which those headers block. To allow it, change the CSP value
to `frame-ancestors https://web.telegram.org` and drop the `X-Frame-Options` header; that is a deliberate
loosening of the clickjacking protection, so it is left as your call.
