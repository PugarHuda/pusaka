// A Pusaka's face: a medallion generated from its Bitcoin public key. The brass ring
// fills with the BTC held inside (log scale, full at 0.01 BTC).

const FULL_SATS = 1_000_000;

function bytes(hex) {
  return hex ? hex.match(/../g).map((b) => parseInt(b, 16)) : Array(33).fill(0);
}

export default function Emblem({ pubkey, sats = 0, locked = false, size = 220, label }) {
  const b = bytes(pubkey);
  const petals = 5 + (b[1] % 8); // 5–12
  const turn = (b[2] / 255) * 360;
  const inner = 0.28 + (b[3] / 255) * 0.14;
  const depth = 0.55 + (b[4] / 255) * 0.25;
  const fill = sats > 0 ? Math.min(1, Math.log10(1 + sats) / Math.log10(1 + FULL_SATS)) : 0;

  const R = 100, ring = 92, C = 2 * Math.PI * ring;
  const petal = Array.from({ length: petals }, (_, i) => {
    const a = (i * 360) / petals + turn;
    const w = 7 + (b[5 + (i % 20)] % 9);
    return (
      <ellipse key={i} cx="100" cy={100 - 46 * depth} rx={w} ry={34 * depth}
        transform={`rotate(${a} 100 100)`} className="em-petal" />
    );
  });
  const dots = Array.from({ length: petals * 2 }, (_, i) => {
    const a = ((i * 180) / petals + turn) * (Math.PI / 180);
    return <circle key={i} cx={100 + 76 * Math.sin(a)} cy={100 - 76 * Math.cos(a)} r={b[10 + (i % 20)] % 2 ? 2.4 : 1.4} className="em-dot" />;
  });

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" className={`emblem${locked ? " is-locked" : ""}`}
      aria-label={label ?? `Pusaka medallion holding ${sats.toLocaleString()} sats`}>
      <circle cx="100" cy="100" r={R - 2} className="em-face" />
      <circle cx="100" cy="100" r={ring} className="em-track" />
      <circle cx="100" cy="100" r={ring} className="em-fill"
        strokeDasharray={`${C * fill} ${C}`} transform="rotate(-90 100 100)" />
      {dots}
      <g>{petal}</g>
      <circle cx="100" cy="100" r={100 * inner} className="em-core" />
      <circle cx="100" cy="100" r={100 * inner * 0.45} className="em-pip" />
      {locked && <circle cx="160" cy="40" r="11" className="em-seal" />}
    </svg>
  );
}
