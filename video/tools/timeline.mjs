// Resolves script.mjs + the recorded clips' marks + voice-over timings into src/timeline.json (all in frames), which
// the Remotion components render as-is. Generates missing voice-over first (tools/vo.py).
//   node tools/timeline.mjs
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scenes, compositions, voice, limits } from "../script.mjs";

const FPS = 30, W = 1920, H = 1080;
const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const F = (s) => Math.round(s * FPS);
const probe = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

// Playwright records VP8/VP9 webm with sparse keyframes; Remotion seeks H.264 with a keyframe every second far faster.
const mp4 = (webm) => {
  const out = webm.replace(/\.webm$/, ".mp4");
  if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(webm).mtimeMs) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", webm, "-r", String(FPS), "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-g", String(FPS), "-pix_fmt", "yuv420p", "-an", out]);
  }
  return out;
};

// ---------- voice-over ----------
const voPath = (text) => `vo/${crypto.createHash("sha1").update(`${voice.voice}|${voice.rate}|${text}`).digest("hex").slice(0, 12)}.mp3`;
const variant = (s, comp) => (comp === "X" && s.x ? { ...s, ...s.x } : s);
const jobs = new Map();
for (const [comp, ids] of Object.entries(compositions)) for (const id of ids) for (const l of variant(scenes[id], comp).vo ?? []) {
  const f = voPath(l.text);
  if (!fs.existsSync(path.join(PUB, f))) jobs.set(f, { file: path.join(PUB, f), text: l.text, ...voice });
}
if (jobs.size) {
  fs.mkdirSync(path.join(PUB, "vo"), { recursive: true });
  const jf = path.join(PUB, "vo", "jobs.json");
  fs.writeFileSync(jf, JSON.stringify([...jobs.values()]));
  execFileSync("python", [path.join(ROOT, "tools", "vo.py"), jf], { stdio: "inherit" });
  fs.rmSync(jf);
}
const voInfo = new Map();
const vo = (text) => {
  const f = voPath(text);
  if (!voInfo.has(f)) voInfo.set(f, { src: f, dur: probe(path.join(PUB, f)), words: JSON.parse(fs.readFileSync(path.join(PUB, f.replace(/\.mp3$/, ".json")), "utf8")) });
  return voInfo.get(f);
};

/** Subtitle cues from word timings: short lines, broken at punctuation. Times relative to the line's start. */
export function cues(words) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push({ s: cur[0].s, e: cur.at(-1).e, text: cur.map((w) => w.w).join(" ") }); cur = []; };
  for (const w of words) {
    const len = cur.map((x) => x.w).join(" ").length;
    if (cur.length && (len + w.w.length > 42 || cur.length >= 8)) flush();
    cur.push(w);
    if (/[.,:;?!]$/.test(w.w) && cur.length >= 3) flush();
  }
  flush();
  for (let i = 0; i < out.length; i++) out[i].e = Math.min(out[i].e + 0.4, out[i + 1]?.s ?? out[i].e + 0.4); // hold briefly
  return out;
}
// edge-tts word boundaries drop punctuation; put it back from the text so cues can break at it
const withPunct = (words, text) => {
  let pos = 0;
  return words.map((w) => {
    const i = text.indexOf(w.w, pos);
    if (i < 0) return w;
    let j = i + w.w.length;
    while (j < text.length && /[.,:;?!'’")]/.test(text[j])) j++;
    pos = j;
    return { ...w, w: text.slice(i, j) };
  });
};

// ---------- scenes ----------
function resolveScene(id, comp) {
  const s = variant(scenes[id], comp);
  if (!s) throw new Error(`script: no scene ${id}`);
  let clip = null, marks = {}, popups = [], clipDur = 0;
  if (s.clip) {
    const file = path.join(PUB, "clips", `${s.clip}.webm`);
    if (!fs.existsSync(file)) return null;
    const meta = JSON.parse(fs.readFileSync(path.join(PUB, "clips", `${s.clip}.json`), "utf8"));
    if (meta.error) console.warn(`  ! ${s.clip} was recorded with an error: ${meta.error}`);
    marks = meta.marks; popups = meta.popups; clipDur = probe(file); clip = `clips/${path.basename(mp4(file))}`;
  }
  const mark = (ref) => {
    const m = /^@([\w-]+?)([+-][\d.]+)?$/.exec(ref);
    if (!m || !marks[m[1]]) throw new Error(`${id}: no mark ${ref} in clip ${s.clip} (marks: ${Object.keys(marks).join(", ")})`);
    return { m: marks[m[1]], off: Number(m[2] ?? 0) };
  };
  const t = (ref) => (typeof ref === "number" ? ref : (({ m, off }) => m.t + off)(mark(ref)));
  const region = (ref) => {
    if (Array.isArray(ref)) return { box: ref };
    const { m } = mark(ref);
    if (!m.box) throw new Error(`${id}: mark ${ref} has no box`);
    return { box: m.box, popup: m.popup };
  };

  // kept segments of the clip, and clip time -> scene time
  const start = s.start != null ? t(s.start) : 0, end = Math.min(s.end != null ? t(s.end) : clipDur, clipDur);
  const cuts = (s.cuts ?? []).map((c) => ({ a: t(c.from), b: t(c.to), label: c.label })).filter((c) => c.b > c.a).sort((x, y) => x.a - y.a);
  const segs = [];
  let a = start;
  for (const c of cuts) { if (c.a > a) segs.push([a, Math.min(c.a, end)]); a = Math.max(a, c.b); }
  if (end > a) segs.push([a, end]);
  const map = (tc) => {
    let out = 0;
    for (const [x, y] of segs) { if (tc >= y) out += y - x; else { if (tc > x) out += tc - x; break; } }
    return out;
  };
  const clipOut = segs.reduce((n, [x, y]) => n + y - x, 0);

  // voice-over, one line after another
  let prevEnd = 0;
  const lines = [], subs = [];
  for (const l of s.vo ?? []) {
    const v = vo(l.text);
    const at = Math.max(s.clip ? map(t(l.at)) : l.at, prevEnd + (lines.length ? 0.25 : 0));
    lines.push({ src: v.src, f: F(at) });
    for (const c of cues(withPunct(v.words, l.text))) subs.push({ f0: F(at + c.s), f1: F(at + c.e), text: c.text });
    prevEnd = at + v.dur;
  }
  // a clip scene ends shortly after its voice-over (`hold` seconds), unless `end` pins it to the clip
  const dur = s.card ? Math.max(s.dur ?? 3, prevEnd + 0.7) + 0.3
    : s.end == null && lines.length ? prevEnd + (s.hold ?? 1.2) : Math.max(clipOut, prevEnd + 0.7) + 0.3;

  const timed = (list, fallback) => (list ?? []).flatMap((z) => {
    try {
      if (t(z.at) < start - 0.05 || t(z.at) > end) return []; // trimmed away in this cut
      const at = map(t(z.at));
      const r = z.region === null ? null : region(z.region ?? z.at);
      if (r && r.popup == null && (r.box[1] > H || r.box[1] + r.box[3] < 0)) throw new Error(`${id}: ${z.region ?? z.at} is off screen at that moment`);
      return [{ ...z, f0: F(at), f1: F(z.to != null ? map(t(z.to)) : at + (z.for ?? fallback)), r }];
    } catch (e) { console.warn(`  ! ${e.message}`); return []; }
  });
  const zooms = timed(s.zoom, 4).filter((z) => z.r && z.r.popup == null).map((z) => {
    const [x, y, w, h] = z.r.box;
    const sc = z.scale ?? Math.max(1, Math.min(2.2, 0.7 * Math.min(W / w, H / h)));
    return { f0: z.f0, f1: z.f1, s: sc, cx: x + w / 2, cy: y + h / 2 };
  });
  return {
    id, dur: F(dur),
    card: s.card ?? null,
    caption: s.caption ?? null,
    clip,
    segs: segs.map(([x, y]) => ({ out: F(map(x)), len: F(y - x), src: F(x) })),
    freeze: clip && dur > clipOut ? { out: F(clipOut), src: Math.max(0, F(end) - 2) } : null,
    // a wallet window plays in pieces too, wherever the main clip was cut
    popups: popups.filter((p) => p.wallet !== false).map((p) => ({
      src: `clips/${path.basename(mp4(path.join(PUB, "clips", p.file)))}`, f0: F(map(p.start)), f1: F(map(p.end)), size: p.size ?? [400, 700],
      pieces: segs.map(([x, y]) => [Math.max(x, p.start), Math.min(y, p.end)]).filter(([x, y]) => y > x)
        .map(([x, y]) => ({ out: F(map(x)), len: F(y - x), src: F(x - p.start) })),
    })).filter((p) => p.f1 > p.f0),
    zooms,
    boxes: timed(s.box, 3).filter((b) => b.r).map((b) => ({ f0: b.f0, f1: b.f1, box: b.r.box, popup: b.r.popup ?? null, label: b.label ?? null })),
    callouts: timed(s.callout, 4).filter((c) => c.r).map((c) => ({ f0: c.f0, f1: c.f1, box: c.r.box, popup: c.r.popup ?? null, text: c.text })),
    waits: cuts.map((c) => ({ f0: F(map(c.a)), f1: F(map(c.a) + 2.8), text: c.label.replace("{s}", Math.round(c.b - c.a)) })),
    vo: lines,
    subs,
  };
}

const timeline = {};
for (const [comp, ids] of Object.entries(compositions)) {
  let from = 0;
  const list = [];
  for (const id of ids) {
    const sc = resolveScene(id, comp);
    if (!sc) { console.warn(`  - ${comp}: skipping ${id} (clip ${scenes[id].clip} not recorded yet)`); continue; }
    list.push({ ...sc, from });
    from += sc.dur;
  }
  timeline[comp] = { fps: FPS, width: W, height: H, durationInFrames: Math.max(from, 1), scenes: list };
  const secs = from / FPS;
  console.log(`${comp}: ${list.length} scenes, ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}${limits[comp] && secs > limits[comp] ? `  !! over the ${limits[comp]} s limit` : ""}`);
}
fs.writeFileSync(path.join(ROOT, "src", "timeline.json"), JSON.stringify(timeline));
