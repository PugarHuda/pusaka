// Telegram Mini App glue (https://core.telegram.org/bots/webapps). In a normal browser this does nothing
// and loads nothing: the SDK is fetched only when Telegram launched us (it puts tgWebApp* params in the hash).

/** t.me/<bot>/<app>?startapp=<param> → our hash route. Telegram allows only [A-Za-z0-9_-] in it, so "-" stands in for "/". */
export function routeOf(param) {
  const p = String(param ?? "");
  let m;
  if ((m = p.match(/^(?:token|pusaka)-(\d{1,30})$/))) return `#/pusaka/${BigInt(m[1])}`;
  if ((m = p.match(/^v2-(\d{1,30})$/))) return `#/v2/${BigInt(m[1])}`;
  if ((m = p.match(/^gift-([1-9A-HJ-NP-Za-km-z]{40,100})$/))) return `#/gift/ed25519:${m[1]}`; // ":" isn't allowed in startapp
  if (/^(market|mine|agents|refused|bids|reserves|v2)$/.test(p)) return `#/${p}`;
  return "#/";
}

const SDK = "https://telegram.org/js/telegram-web-app.js";
const launched = typeof location !== "undefined" && /(^|[#&?])tgWebApp(Data|Version|Platform)=/.test(location.hash + location.search);

if (launched) {
  // top-level await: the app renders after this, so the first paint already has the right route
  await new Promise((done) => {
    const s = Object.assign(document.createElement("script"), { src: SDK, onload: done, onerror: done });
    document.head.append(s);
    setTimeout(done, 4000); // ponytail: telegram.org down → the app still opens, just without the Telegram chrome
  });
  const tg = window.Telegram?.WebApp;
  const start = new URLSearchParams(location.search).get("tgWebAppStartParam") ?? tg?.initDataUnsafe?.start_param;
  // the SDK has read its launch params from the hash (and keeps them in sessionStorage); the hash is the router again
  history.replaceState({ tgDepth: 0 }, "", location.pathname + location.search + routeOf(start));
  if (tg) {
    tg.ready();
    tg.expand();

    const theme = () => {
      // colours only: the params come from the launch link, so a crafted one mustn't inject url(...) or anything else
      const p = Object.fromEntries(Object.entries(tg.themeParams ?? {}).filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(String(v)))), root = document.documentElement;
      root.dataset.theme = tg.colorScheme === "dark" ? "dark" : "light";
      for (const [v, k] of [["--paper", "bg_color"], ["--card", "bg_color"], ["--panel", "secondary_bg_color"],
        ["--ink", "text_color"], ["--ink-soft", "hint_color"], ["--lav-ink", "link_color"]]) {
        p[k] ? root.style.setProperty(v, p[k]) : root.style.removeProperty(v);
      }
      document.body.style.background = p.secondary_bg_color ?? p.bg_color ?? "";
      tg.setHeaderColor?.("bg_color");
    };
    theme();
    tg.onEvent("themeChanged", theme);

    // BackButton walks our hash history; a deep-linked first page (nothing behind it) goes home instead
    const sync = () => {
      if (history.state?.tgDepth == null) history.replaceState({ tgDepth: (sync.depth ?? 0) + 1 }, "");
      sync.depth = history.state.tgDepth;
      /^#?\/?$/.test(location.hash) ? tg.BackButton.hide() : tg.BackButton.show();
    };
    tg.BackButton.onClick(() => (sync.depth > 0 ? history.back() : (location.hash = "#/")));
    addEventListener("hashchange", sync);
    sync();
  }
}
