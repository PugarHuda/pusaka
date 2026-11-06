// A Pusaka's face: a glass vessel that holds its Bitcoin. The orange inside rises with the BTC proven on NEAR
// (log scale, full at ~0.01 BTC, same scale as the on-chain image); the glass takes its tint from the token's Bitcoin public key, so no two match;
// a seal on the rim means the BTC is locked (listed, lent against, approved or being signed for).

// pastel glass tints: [light, mid, deep] — picked by the key's first byte
const GLASS = [
  ["#eef6ff", "#a9cdf7", "#7a8ff0"],
  ["#f3fbf6", "#a6e3cf", "#6fb6c9"],
  ["#fff4ee", "#f6c2b4", "#b48cf0"],
  ["#f6f1ff", "#cbb6f7", "#8f7be8"],
  ["#effbff", "#9fdcef", "#86a8f2"],
  ["#fffbe9", "#f4dc9c", "#e99fb7"],
];

function bytes(hex) {
  return hex ? hex.match(/../g).map((b) => parseInt(b, 16)) : Array(33).fill(0);
}

export default function Emblem({ pubkey, sats = 0, locked = false, size = 220, label }) {
  const b = bytes(pubkey);
  const [light, mid, deep] = GLASS[b[1] % GLASS.length];
  // the contract's scale (art.rs fill_milli): bit length of 1 + sats over 20, at least 0.12 once anything is proven
  const fill = sats > 0 ? Math.min(1, Math.max(0.12, Math.floor(Math.log2(1 + sats) + 1) / 20)) : 0;
  const id = `v${(pubkey ?? "0").slice(2, 10)}${size}`;
  const level = 186 - fill * 168; // y of the liquid's surface inside the r=86 glass
  const tilt = ((b[2] / 255) - 0.5) * 10;
  const wave = `M8 ${level} C 50 ${level - 7 + tilt} 90 ${level + 7 - tilt} 130 ${level} S 180 ${level - 5} 200 ${level} L200 200 L0 200 Z`;
  const bubbles = fill ? Array.from({ length: 5 }, (_, i) => ({
    cx: 60 + (b[3 + i] / 255) * 80, cy: level + 14 + (b[8 + i] / 255) * (186 - level - 22), r: 1.6 + (b[13 + i] % 4),
  })).filter((x) => x.cy < 182) : [];

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" className={`emblem${locked ? " is-locked" : ""}`}
      aria-label={label ?? `Pusaka vessel holding ${sats.toLocaleString()} sats`}>
      <defs>
        <radialGradient id={`${id}g`} cx="0.36" cy="0.3" r="0.78">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor={light} />
          <stop offset="0.75" stopColor={mid} />
          <stop offset="1" stopColor={deep} />
        </radialGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd1ec" />
          <stop offset="0.3" stopColor="#a8d8ff" />
          <stop offset="0.6" stopColor="#c6f2d8" />
          <stop offset="1" stopColor="#fff0a8" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd77a" />
          <stop offset="0.45" stopColor="#f7931a" />
          <stop offset="1" stopColor="#d4690b" />
        </linearGradient>
        <clipPath id={`${id}c`}><circle cx="100" cy="100" r="86" /></clipPath>
        <filter id={`${id}b`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <circle cx="100" cy="100" r="92" fill={`url(#${id}g)`} />
      <g clipPath={`url(#${id}c)`}>
        {fill > 0 && <>
          <path d={wave} fill={`url(#${id}l)`} opacity="0.93" />
          <path d={wave.split(" L200 200")[0]} fill="none" stroke="#ffe3a3" strokeWidth="2.5" opacity="0.9" />
          {bubbles.map((x, i) => <circle key={i} cx={x.cx} cy={x.cy} r={x.r} fill="#fff3d0" opacity="0.55" />)}
        </>}
        {/* the glass's own glow from below, so an empty vessel still reads as glass */}
        <ellipse cx="118" cy="168" rx="58" ry="22" fill="#ffffff" opacity="0.35" filter={`url(#${id}b)`} />
      </g>
      <circle cx="100" cy="100" r="91" fill="none" stroke={`url(#${id}r)`} strokeWidth="3.5" opacity="0.95" />
      <circle cx="100" cy="100" r="86" fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.7" />
      <ellipse cx="70" cy="58" rx="30" ry="17" transform="rotate(-32 70 58)" fill="#ffffff" opacity="0.75" filter={`url(#${id}b)`} />
      <ellipse cx="62" cy="52" rx="9" ry="5" transform="rotate(-32 62 52)" fill="#ffffff" opacity="0.95" />
      <path d="M150 142 A 62 62 0 0 1 112 166" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
      {locked && (
        <g transform="translate(156 44)" className="em-seal">
          <circle r="17" fill="#ffffff" />
          <circle r="17" fill="none" stroke={deep} strokeWidth="1.5" opacity="0.5" />
          <rect x="-6.5" y="-2" width="13" height="10" rx="2.5" fill="#6d3fc4" />
          <path d="M-4 -2 V-5 a4 4 0 0 1 8 0 V-2" fill="none" stroke="#6d3fc4" strokeWidth="2.2" />
        </g>
      )}
    </svg>
  );
}
