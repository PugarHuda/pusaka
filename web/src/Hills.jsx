// Rolling hills under a summer sky, drawn in SVG from a seed: the landscape behind the home page's live cards.
// Deterministic (same seed, same hills), no image files, and it scales to any card shape.

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A ridge line across the width: a few soft sine swells around `base`, closed down to the bottom. */
function ridge(r, w, h, base, amp, swells) {
  const waves = Array.from({ length: 3 }, (_, i) => ({ a: amp * (0.55 + r()) / (i + 1), f: (swells * (i + 1) * Math.PI * 2) / w, p: r() * 7 }));
  const y = (x) => base - waves.reduce((s, v) => s + v.a * Math.sin(v.f * x + v.p), 0);
  const pts = Array.from({ length: 41 }, (_, i) => (i / 40) * w);
  return { d: `M0 ${h} L${pts.map((x) => `${x.toFixed(1)} ${y(x).toFixed(1)}`).join(" L")} L${w} ${h} Z`, y };
}

const LAYERS = [
  // [base as share of height, amplitude, swells, light, dark]
  [0.46, 0.07, 1.2, "#d9edb8", "#b9da93"],
  [0.55, 0.11, 0.95, "#cfe58f", "#a4cb62"],
  [0.66, 0.13, 0.8, "#bfdc6c", "#86b34b"],
  [0.8, 0.1, 0.7, "#a6cf5a", "#6c9c3e"],
];
const WARM = ["#f5d98e", "#ec9f66"]; // a poppy-and-marigold meadow on one of the hills
const BLOOMS = ["#9b7be0", "#b394ee", "#8a6ad6", "#f4e27a", "#ffffff", "#f2a65a"];

export default function Hills({ seed = 1, width = 400, height = 300, className, flowers = 1 }) {
  const r = rng(seed);
  const w = width, h = height;
  const warm = 1 + Math.floor(r() * 3); // which hill wears the warm meadow
  const layers = LAYERS.map(([b, a, s, light, dark], i) => ({ ...ridge(r, w, h, b * h, a * h, s), ...(i === warm && r() < 0.6 ? { light: WARM[0], dark: WARM[1] } : { light, dark }) }));
  const front = layers[layers.length - 1];
  // blooms in drifts on the two nearest hills, bigger and denser toward the bottom edge
  const blooms = [];
  const drifts = Array.from({ length: 4 + Math.floor((r() * w) / 200) }, () => ({ x: r() * w, c: BLOOMS[Math.floor(r() * 3)] }));
  const n = Math.round(380 * flowers * (w / 400));
  for (let i = 0; i < n; i++) {
    const d = drifts[i % drifts.length];
    const x = Math.min(w, Math.max(0, d.x + (r() - 0.5) * w * 0.45));
    const top = Math.min(layers[2].y(x), front.y(x)) + 4;
    const t = r() ** 0.7;
    const y = top + t * (h - top);
    const size = 0.7 + t * 3.4 * (h / 300);
    const lav = r() < 0.7;
    const c = lav ? d.c : BLOOMS[3 + Math.floor(r() * 3)];
    // lavender stands as tall spikes, the rest as round blossoms
    blooms.push(<ellipse key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} rx={(size * (lav ? 0.45 : 0.75)).toFixed(2)} ry={(size * (lav ? 1.9 : 0.75)).toFixed(2)} fill={c} opacity={0.9} />);
  }
  const id = `h${seed}`;
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#62b8ec" />
          <stop offset="0.55" stopColor="#b9e2f6" />
          <stop offset="1" stopColor="#eef8f1" />
        </linearGradient>
        {layers.map((l, i) => (
          <linearGradient key={i} id={`${id}l${i}`} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor={l.light} />
            <stop offset="1" stopColor={l.dark} />
          </linearGradient>
        ))}
        <filter id={`${id}b`}><feGaussianBlur stdDeviation={w / 260} /></filter>
      </defs>
      <rect width={w} height={h} fill={`url(#${id}s)`} />
      {[0.2, 0.62, 0.86].map((cx, i) => (
        <ellipse key={i} cx={cx * w} cy={h * (0.12 + i * 0.07)} rx={w * (0.16 + r() * 0.1)} ry={h * 0.035} fill="#fff" opacity="0.7" filter={`url(#${id}b)`} />
      ))}
      {layers.map((l, i) => <path key={i} d={l.d} fill={`url(#${id}l${i})`} filter={i === 0 ? `url(#${id}b)` : undefined} />)}
      <g>{blooms}</g>
    </svg>
  );
}
