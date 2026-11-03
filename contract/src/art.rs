//! On-chain, dynamic NFT image: the same medallion the web app draws, generated from the
//! token's Bitcoin key. The brass ring fills with the BTC verified by the light client and a
//! red seal appears while the token is locked (listed, collateral, or signing).
//! Integer math only, so the output is identical on every node.

use base64::Engine;

const C_TENTHS: u64 = 5780; // circumference of r=92, in tenths (2π·92 ≈ 578.05)

fn tenths(v: u64) -> String {
    format!("{}.{}", v / 10, v % 10)
}

pub fn emblem_svg(pubkey: &[u8], sats: u64, locked: bool) -> String {
    let b = |i: usize| pubkey.get(i).copied().unwrap_or(0) as u64;
    let petals = 5 + b(1) % 8;
    let turn = b(2) * 360 / 255;
    let inner_tenths = 280 + b(3) * 140 / 255; // core radius = 28.0 + up to 14.0
    let depth_milli = 550 + b(4) * 250 / 255;
    // Ring fill: log2-ish scale, full at ~2^20 sats (~0.01 BTC).
    let fill_milli = if sats == 0 { 0 } else { ((64 - (1 + sats).leading_zeros()) as u64 * 1000 / 20).min(1000) };

    let mut s = String::with_capacity(3000);
    s.push_str(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#eceef1"/><circle cx="100" cy="100" r="98" fill="#14213d"/><circle cx="100" cy="100" r="92" fill="none" stroke="#2a3757" stroke-width="5"/>"##);
    s.push_str(&format!(
        r##"<circle cx="100" cy="100" r="92" fill="none" stroke="#b08d3c" stroke-width="5" stroke-linecap="round" stroke-dasharray="{} {}" transform="rotate(-90 100 100)"/>"##,
        tenths(C_TENTHS * fill_milli / 1000),
        tenths(C_TENTHS)
    ));
    for i in 0..petals * 2 {
        let a = i * 180 / petals + turn;
        let r = if b(10 + (i as usize % 20)) % 2 == 1 { "2.4" } else { "1.4" };
        s.push_str(&format!(r##"<circle cx="100" cy="24" r="{r}" fill="#b08d3c" opacity=".75" transform="rotate({a} 100 100)"/>"##));
    }
    let cy = 1000 - 460 * depth_milli / 1000; // tenths: 100 - 46·depth
    let ry = 340 * depth_milli / 1000; // tenths: 34·depth
    for i in 0..petals {
        let a = i * 360 / petals + turn;
        let w = 7 + b(5 + (i as usize % 20)) % 9;
        s.push_str(&format!(
            r##"<ellipse cx="100" cy="{}" rx="{w}" ry="{}" fill="none" stroke="#e6d7ae" stroke-width="1.4" transform="rotate({a} 100 100)"/>"##,
            tenths(cy),
            tenths(ry)
        ));
    }
    s.push_str(&format!(r##"<circle cx="100" cy="100" r="{}" fill="#b08d3c"/>"##, tenths(inner_tenths)));
    s.push_str(&format!(r##"<circle cx="100" cy="100" r="{}" fill="#14213d"/>"##, tenths(inner_tenths * 45 / 100)));
    if locked {
        s.push_str(r##"<circle cx="160" cy="40" r="11" fill="#8e2c2c" stroke="#eceef1" stroke-width="3"/>"##);
    }
    s.push_str("</svg>");
    s
}

pub fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg))
}

/// Collection icon: a plain medallion.
pub fn icon() -> String {
    data_uri(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#14213D"/><circle cx="16" cy="16" r="12" fill="none" stroke="#B08D3C" stroke-width="2.5"/><circle cx="16" cy="16" r="4.5" fill="#B08D3C"/></svg>"##)
}
