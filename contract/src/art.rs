//! On-chain, dynamic NFT image: the same glass vessel the web app draws (web/src/Emblem.jsx), generated from the
//! token's Bitcoin key and redrawn from what the token holds every time it is read:
//! - orange rises with the BTC verified by NEAR's Bitcoin light client,
//! - a blue layer above it with the USDC NEAR's MPC network verified on Base and Arbitrum,
//! - a sealed envelope floats inside while it carries a letter for its next holder,
//! - a green sprout seal on the rim once the holder has named an heir,
//! - a lock seal while the BTC is locked (listed, collateral, approved to a market, or signing).
//! The glass takes its tint from the key. Integer math only, so every node draws the same image.

use base64::Engine;

/// Pastel glass tints [light, mid, deep], picked by the key's second byte (same table as the web app).
const GLASS: [[&str; 3]; 6] = [
    ["#eef6ff", "#a9cdf7", "#7a8ff0"],
    ["#f3fbf6", "#a6e3cf", "#6fb6c9"],
    ["#fff4ee", "#f6c2b4", "#b48cf0"],
    ["#f6f1ff", "#cbb6f7", "#8f7be8"],
    ["#effbff", "#9fdcef", "#86a8f2"],
    ["#fffbe9", "#f4dc9c", "#e99fb7"],
];

/// tenths as a decimal string, signed: 1234 -> "123.4", -15 -> "-1.5"
fn t(v: i64) -> String {
    let sign = if v < 0 { "-" } else { "" };
    format!("{sign}{}.{}", v.abs() / 10, v.abs() % 10)
}

/// How full the vessel is, per mille: the bit length of (1 + sats) over 20, so it is full at ~2^20 sats (~0.01 BTC),
/// and never under 120 once anything is proven, so a small deposit still shows.
pub fn fill_milli(sats: u64) -> i64 {
    if sats == 0 {
        return 0;
    }
    (((64 - (1 + sats).leading_zeros()) as i64) * 1000 / 20).clamp(120, 1000)
}

/// What a Pusaka holds, as far as its picture is concerned.
#[derive(Default)]
pub struct Contents {
    pub sats: u64,
    /// verified USDC in base units (6 decimals), all chains
    pub usdc: u128,
    pub letter: bool,
    pub heir: bool,
    pub locked: bool,
}

/// The USDC layer's height, per mille of the vessel: bit length of 1 + whole cents over 20, at most half the vessel,
/// at least 60 once anything is verified.
pub fn usdc_milli(usdc: u128) -> i64 {
    if usdc == 0 {
        return 0;
    }
    let cents = usdc / 10_000 + 1;
    (((128 - cents.leading_zeros()) as i64) * 500 / 20).clamp(60, 500)
}

pub fn emblem_svg(pubkey: &[u8], c: &Contents) -> String {
    let b = |i: usize| pubkey.get(i).copied().unwrap_or(0) as i64;
    let [light, mid, deep] = GLASS[(b(1) % 6) as usize];
    let btc = fill_milli(c.sats);
    let fill = (btc + usdc_milli(c.usdc)).min(1000);
    let level = 1860 - fill * 1680 / 1000; // tenths: y of the top liquid's surface inside the r=86 glass
    let btc_level = 1860 - btc * 1680 / 1000;
    let tilt = b(2) * 100 / 255 - 50; // tenths, -5.0 to +5.0

    let mut s = String::with_capacity(4000);
    s.push_str(&format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" data-fill="{btc}" data-usdc="{}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eaf3fc"/><stop offset="1" stop-color="#f4ecfb"/></linearGradient><radialGradient id="g" cx=".36" cy=".3" r=".78"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="{light}"/><stop offset=".75" stop-color="{mid}"/><stop offset="1" stop-color="{deep}"/></radialGradient><linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd1ec"/><stop offset=".3" stop-color="#a8d8ff"/><stop offset=".6" stop-color="#c6f2d8"/><stop offset="1" stop-color="#fff0a8"/></linearGradient><linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd77a"/><stop offset=".45" stop-color="#f7931a"/><stop offset="1" stop-color="#d4690b"/></linearGradient><linearGradient id="u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0ff"/><stop offset="1" stop-color="#2775ca"/></linearGradient><clipPath id="c"><circle cx="100" cy="100" r="86"/></clipPath><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter></defs><rect width="200" height="200" fill="url(#bg)"/><circle cx="100" cy="100" r="92" fill="url(#g)"/><g clip-path="url(#c)">"##,
        usdc_milli(c.usdc)
    ));
    if fill > 0 {
        let level = if btc > 0 && fill == btc { btc_level } else { level };
        let surface = format!(
            "M8 {} C 50 {} 90 {} 130 {} S 180 {} 200 {}",
            t(level),
            t(level - 70 + tilt),
            t(level + 70 - tilt),
            t(level),
            t(level - 50),
            t(level)
        );
        if fill > btc {
            // USDC floats as a blue layer over the Bitcoin
            s.push_str(&format!(r##"<path d="{surface} L200 200 L0 200 Z" fill="url(#u)" opacity=".9"/><path d="{surface}" fill="none" stroke="#d6ecff" stroke-width="2.5" opacity=".9"/>"##));
        }
        if btc > 0 {
            let btc_surface = format!("M0 {} C 60 {} 120 {} 200 {}", t(btc_level), t(btc_level + 40 - tilt), t(btc_level - 40 + tilt), t(btc_level));
            s.push_str(&format!(r##"<path d="{btc_surface} L200 200 L0 200 Z" fill="url(#l)" opacity=".93"/><path d="{btc_surface}" fill="none" stroke="#ffe3a3" stroke-width="2.5" opacity=".9"/>"##));
        }
        for i in 0..5usize {
            let cx = 600 + b(3 + i) * 800 / 255;
            let cy = level + 140 + b(8 + i) * (1860 - level - 220).max(0) / 255;
            if cy < 1820 {
                s.push_str(&format!(r##"<circle cx="{}" cy="{}" r="{}" fill="#fff3d0" opacity=".55"/>"##, t(cx), t(cy), t(16 + (b(13 + i) % 4) * 10)));
            }
        }
    }
    s.push_str(r##"<ellipse cx="118" cy="168" rx="58" ry="22" fill="#fff" opacity=".35" filter="url(#b)"/></g><circle cx="100" cy="100" r="91" fill="none" stroke="url(#r)" stroke-width="3.5" opacity=".95"/><circle cx="100" cy="100" r="86" fill="none" stroke="#fff" stroke-width="1.2" opacity=".7"/><ellipse cx="70" cy="58" rx="30" ry="17" transform="rotate(-32 70 58)" fill="#fff" opacity=".75" filter="url(#b)"/><ellipse cx="62" cy="52" rx="9" ry="5" transform="rotate(-32 62 52)" fill="#fff" opacity=".95"/><path d="M150 142 A 62 62 0 0 1 112 166" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/>"##);
    if c.letter {
        // a sealed envelope floating in the glass, for whoever holds it next
        s.push_str(r##"<g id="letter" transform="translate(84 70) rotate(-8)"><rect width="34" height="23" rx="3" fill="#fff" stroke="#cbb6f7" stroke-width="1.2"/><path d="M1 2 L17 13 L33 2" fill="none" stroke="#cbb6f7" stroke-width="1.4"/><circle cx="17" cy="13" r="3.6" fill="#b48cf0"/></g>"##);
    }
    if c.heir {
        s.push_str(r##"<g id="heir" transform="translate(44 156)"><circle r="15" fill="#fff"/><circle r="15" fill="none" stroke="#a9c98b" stroke-width="1.5"/><path d="M0 8 V-2" stroke="#3f6b23" stroke-width="2.2" stroke-linecap="round"/><path d="M0 0 C -1 -7 -7 -9 -10 -8 C -9 -3 -5 0 0 0 Z M0 -2 C 1 -9 7 -11 10 -10 C 9 -5 5 -2 0 -2 Z" fill="#7cae55"/></g>"##);
    }
    if c.locked {
        s.push_str(&format!(
            r##"<g id="seal" transform="translate(156 44)"><circle r="17" fill="#fff"/><circle r="17" fill="none" stroke="{deep}" stroke-width="1.5" opacity=".5"/><rect x="-6.5" y="-2" width="13" height="10" rx="2.5" fill="#6d3fc4"/><path d="M-4 -2 V-5 a4 4 0 0 1 8 0 V-2" fill="none" stroke="#6d3fc4" stroke-width="2.2"/></g>"##
        ));
    }
    s.push_str("</svg>");
    s
}

pub fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg))
}

/// Collection icon: a small glass vessel, half full of Bitcoin.
pub fn icon() -> String {
    data_uri(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><radialGradient id="g" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#cbb6f7"/><stop offset="1" stop-color="#8f7be8"/></radialGradient><clipPath id="c"><circle cx="16" cy="16" r="13.5"/></clipPath></defs><circle cx="16" cy="16" r="15" fill="url(#g)"/><path clip-path="url(#c)" d="M0 17 C 8 15 14 19 22 17 S 30 16 32 17 V32 H0 Z" fill="#f7931a"/><circle cx="16" cy="16" r="14.7" fill="none" stroke="#a8d8ff" stroke-width="1"/><ellipse cx="11" cy="9" rx="4" ry="2.2" transform="rotate(-32 11 9)" fill="#fff" opacity=".85"/></svg>"##)
}
