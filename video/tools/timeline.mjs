// Resolves script.mjs + the recorded clips' marks + voice-over timings into src/timeline.json (all in frames), which
// the Remotion components render as-is. Generates missing voice-over first (tools/vo.py).
//   node tools/timeline.mjs
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scenes, compositions, voice, limits } from "../script.mjs";

const FPS = 30, W = 1920, H = 1080;
// Seconds. The voice never pauses longer than GAP between lines, or LEAD/TAIL at a scene's edges; the clip is retimed
// to it, played up to MAXR times faster (beyond that, the middle of the wait is jumped over).
const LEAD = 0.15, GAP = 0.2, TAIL = 0.15, MAXR = 4;
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

/** `box` clipped to a w×h frame, or null if nothing of it is on screen. */
const clampBox = ([x, y, w, h], [fw, fh]) => {
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(fw, x + w), y1 = Math.min(fh, y + h);
  return x1 - x0 >= 4 && y1 - y0 >= 4 ? [x0, y0, x1 - x0, y1 - y0] : null;
};

/** [from, to] clip seconds, starting at or after `from`, during which `box` in the video looks as it did at `ref`
 *  (the moment the recorder measured it). A box drawn only then can't drift off its element when the page scrolls. */
const SR = 10, CELLS = 24;
export function steady(file, box, from, ref, horizon = 15) {
  const [x, y, w, h] = box.map(Math.round);
  const t0 = Math.max(0, Math.min(from, ref));
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t0), "-i", file, "-t", String(horizon + Math.abs(ref - from)),
    "-vf", `crop=${w}:${h}:${x}:${y},scale=${CELLS}:${CELLS},format=gray,fps=${SR}`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
  const N = CELLS * CELLS, frames = Math.floor(raw.length / N);
  if (!frames) return null;
  const fr = (i) => raw.subarray(i * N, (i + 1) * N);
  const R = fr(Math.min(frames - 1, Math.round((ref - t0) * SR)));
  // ponytail: "changed" = over a third of the cells moved by more than 40 grey levels: a scroll or a new page trips it,
  // the cursor or a hover tint doesn't. Tune here if a box ends too early or too late.
  const same = (i) => { const q = fr(i); let n = 0; for (let k = 0; k < N; k++) if (Math.abs(q[k] - R[k]) > 40) n++; return n < N / 3; };
  let i = Math.max(0, Math.round((from - t0) * SR));
  while (i < frames && !same(i)) i++;
  if (i >= frames) return null;
  let j = i;
  while (j < frames && same(j)) j++;
  return [t0 + i / SR, t0 + j / SR];
}

// ---------- voice-over ----------
const voPath = (text) => `vo/${crypto.createHash("sha1").update(`${voice.voice}|${voice.rate}|${text}`).digest("hex").slice(0, 12)}.mp3`;
const variant = (s, comp) => (comp === "X" && s.x ? { ...s, ...s.x } : s);
function makeVoiceOver() {
  const jobs = new Map();
  for (const [comp, ids] of Object.entries(compositions)) for (const id of ids) for (const l of variant(scenes[id], comp).vo ?? []) {
    const f = voPath(l.text);
    if (!fs.existsSync(path.join(PUB, f))) jobs.set(f, { file: path.join(PUB, f), text: l.text, ...voice });
  }
  if (!jobs.size) return;
  fs.mkdirSync(path.join(PUB, "vo"), { recursive: true });
  const jf = path.join(PUB, "vo", "jobs.json");
  fs.writeFileSync(jf, JSON.stringify([...jobs.values()]));
  execFileSync("python", [path.join(ROOT, "tools", "vo.py"), jf], { stdio: "inherit" });
  fs.rmSync(jf);
}
const voInfo = new Map();
const vo = (text) => {
  const f = voPath(text);
  if (!voInfo.has(f)) {
    const words = JSON.parse(fs.readFileSync(path.join(PUB, f.replace(/\.mp3$/, ".json")), "utf8"));
    // edge-tts pads each mp3 with silence (~0.1 s before, 0.3-1.1 s after): lines are joined on the words, not the file
    voInfo.set(f, { src: f, words, lead: words[0]?.s ?? 0, end: (words.at(-1)?.e ?? probe(path.join(PUB, f))) + 0.1 });
  }
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

/** Retime a clip `clipOut` seconds long (u = seconds into it) to scene time. `play(u1, ds)` spends ds scene seconds
 *  getting to u1: faster when the clip is slower than the voice (beyond MAXR, its start and end at MAXR with a jump
 *  between), real time then held still when the voice needs longer. Returns pieces {u0, u1, s0, s1}. */
export function warper(clipOut) {
  const pieces = [];
  const w = { u: 0, s: 0, pieces };
  w.play = (to, ds) => {
    const u1 = Math.min(Math.max(to, w.u), clipOut), du = u1 - w.u, s = w.s;
    if (ds > 0) {
      if (du > MAXR * ds) { const h = (MAXR * ds) / 2; pieces.push({ u0: w.u, u1: w.u + h, s0: s, s1: s + ds / 2 }, { u0: u1 - h, u1, s0: s + ds / 2, s1: s + ds }); }
      else if (du >= ds) pieces.push({ u0: w.u, u1, s0: s, s1: s + ds });
      else pieces.push({ u0: w.u, u1, s0: s, s1: s + du }, { u0: u1, u1, s0: s + du, s1: s + ds });
    }
    w.u = u1; w.s += Math.max(0, ds);
  };
  /** scene time of u (in a jumped-over stretch: where the jump lands) */
  w.at = (u) => {
    for (const p of pieces) {
      if (p.s1 <= p.s0) continue;
      if (u <= p.u0) return p.s0;
      if (u < p.u1) return p.s0 + ((u - p.u0) * (p.s1 - p.s0)) / (p.u1 - p.u0);
    }
    return w.s;
  };
  return w;
}

// ---------- scenes ----------
function resolveScene(id, comp) {
  const s = variant(scenes[id], comp);
  if (!s) throw new Error(`script: no scene ${id}`);
  let clip = null, clipFile = null, marks = {}, popups = [], clipDur = 0;
  if (s.clip) {
    const file = path.join(PUB, "clips", `${s.clip}.webm`);
    if (!fs.existsSync(file)) return null;
    const meta = JSON.parse(fs.readFileSync(path.join(PUB, "clips", `${s.clip}.json`), "utf8"));
    if (meta.error) console.warn(`  ! ${s.clip} was recorded with an error: ${meta.error}`);
    marks = meta.marks; popups = meta.popups; clipDur = probe(file); clipFile = mp4(file); clip = `clips/${path.basename(clipFile)}`;
  }
  const mark = (ref) => {
    const m = /^@([\w-]+?)([+-][\d.]+)?$/.exec(ref);
    if (!m || !marks[m[1]]) throw new Error(`${id}: no mark ${ref} in clip ${s.clip} (marks: ${Object.keys(marks).join(", ")})`);
    return { m: marks[m[1]], off: Number(m[2] ?? 0) };
  };
  const t = (ref) => (typeof ref === "number" ? ref : (({ m, off }) => m.t + off)(mark(ref)));
  const region = (ref, at) => {
    if (Array.isArray(ref)) return { box: ref, ref: at };
    const { m } = mark(ref);
    if (!m.box) throw new Error(`${id}: mark ${ref} has no box`);
    return { box: m.box, popup: m.popup, ref: m.t };
  };

  // kept segments of the clip; u = seconds into the clip once cuts are taken out
  const start = s.start != null ? t(s.start) : 0, end = Math.min(s.end != null ? t(s.end) : clipDur, clipDur);
  const cuts = (s.cuts ?? []).map((c) => ({ a: t(c.from), b: t(c.to), label: c.label })).filter((c) => c.b > c.a).sort((x, y) => x.a - y.a);
  const segs = [];
  let a = start;
  for (const c of cuts) { if (c.a > a) segs.push([a, Math.min(c.a, end)]); a = Math.max(a, c.b); }
  if (end > a) segs.push([a, end]);
  const toU = (tc) => {
    let out = 0;
    for (const [x, y] of segs) { if (tc >= y) out += y - x; else { if (tc > x) out += tc - x; break; } }
    return out;
  };
  const fromU = (u) => { for (const [x, y] of segs) { if (u <= y - x) return x + u; u -= y - x; } return end; };
  const clipOut = segs.reduce((n, [x, y]) => n + y - x, 0);

  // voice-over: one line straight after another; a clip is retimed so each line's mark shows as the line starts
  const lines = [], subs = [];
  let prevEnd = 0;
  const say = (speech, l) => { // the line's first word at `speech`; returns when its last word ends
    const v = vo(l.text), at = Math.max(0, speech - v.lead);
    lines.push({ src: v.src, f: F(at) });
    for (const c of cues(withPunct(v.words, l.text))) subs.push({ f0: F(at + c.s), f1: F(at + c.e), text: c.text });
    return at + v.end;
  };
  const w = warper(clipOut);
  let dur;
  if (!s.clip) {
    (s.vo ?? []).forEach((l, i) => { prevEnd = say(i ? prevEnd + GAP : Math.min(l.at, LEAD), l); });
    dur = s.vo?.length ? prevEnd + TAIL : (s.dur ?? 3);
  } else {
    (s.vo ?? []).forEach((l, i) => {
      const u = toU(t(l.at));
      w.play(u, i ? prevEnd + GAP - w.s : Math.min(u, LEAD));
      prevEnd = say(w.s, l);
    });
    const rest = prevEnd + TAIL - w.s;
    if (s.vo?.length) w.play(s.end != null ? clipOut : w.u + rest, rest); // `end` pins the clip's last moment in
    else w.play(clipOut, clipOut);
    dur = w.s;
  }
  const map = (tc) => w.at(toU(tc));

  /** The clip's pieces as Remotion sequences {out, len, src, rate} (rate 0: a still frame), limited to [lo, hi] clip
   *  seconds, with src counted from `shift` (a wallet window's own video starts when the window opened). */
  const pieces = (lo = -Infinity, hi = Infinity, shift = 0, last = Infinity) => w.pieces.filter((p) => p.s1 > p.s0).flatMap((p) => {
    if (p.u1 === p.u0) {
      const tc = fromU(p.u0);
      return tc >= lo && tc <= hi ? [{ out: F(p.s0), len: F(p.s1) - F(p.s0), src: Math.min(F(tc - shift), last), rate: 0 }] : [];
    }
    const r = (p.u1 - p.u0) / (p.s1 - p.s0), sAt = (tc) => p.s0 + (toU(tc) - p.u0) / r;
    const c0 = Math.max(fromU(p.u0), lo), c1 = Math.min(fromU(p.u1), hi);
    const out = [];
    for (const [x, y] of segs) { // a piece can span a cut
      const a0 = Math.max(x, c0), a1 = Math.min(y, c1);
      if (a1 > a0) out.push({ out: F(sAt(a0)), len: F(sAt(a1)) - F(sAt(a0)), src: F(a0 - shift), rate: +r.toFixed(4) });
    }
    return out;
  }).filter((g) => g.len > 0);

  const timed = (list, fallback, check) => (list ?? []).flatMap((z) => {
    try {
      if (t(z.at) < start - 0.05 || t(z.at) > end) return []; // trimmed away in this cut
      const at = map(t(z.at));
      let f0 = F(at), f1 = F(z.to != null ? map(t(z.to)) : at + (z.for ?? fallback));
      let r = z.region === null ? null : region(z.region ?? z.at, t(z.at));
      if (r && check) {
        const pop = r.popup != null ? popups[r.popup] : null, shift = pop?.start ?? 0;
        const box = clampBox(r.box, pop?.size ?? [W, H]);
        if (!box) throw new Error(`${id}: ${z.region ?? z.at} is off screen at that moment`);
        const win = steady(pop ? mp4(path.join(PUB, "clips", pop.file)) : clipFile, box, t(z.at) - shift, r.ref - shift);
        if (!win) throw new Error(`${id}: ${z.region ?? z.at} never looks as it did when marked; box dropped`);
        f0 = Math.max(f0, F(map(win[0] + shift))); f1 = Math.min(f1, F(map(win[1] + shift)));
        if (f1 - f0 < 12) throw new Error(`${id}: ${z.region ?? z.at} stays put for under 0.4 s; box dropped`);
        r = { ...r, box };
      }
      return [{ ...z, f0, f1, r }];
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
    segs: clip ? pieces(-Infinity, Infinity, 0, F(clipDur) - 1) : [],
    // a wallet window plays in pieces too, retimed like the main clip
    popups: popups.filter((p) => p.wallet !== false).map((p) => ({
      src: `clips/${path.basename(mp4(path.join(PUB, "clips", p.file)))}`, f0: F(map(p.start)), f1: F(map(p.end)), size: p.size ?? [400, 700],
      pieces: pieces(p.start, p.end, p.start, F(p.end - p.start) - 1),
    })).filter((p) => p.f1 > p.f0),
    zooms,
    boxes: timed(s.box, 3, true).filter((b) => b.r).map((b) => ({ f0: b.f0, f1: b.f1, box: b.r.box, popup: b.r.popup ?? null, label: b.label ?? null })),
    callouts: timed(s.callout, 4, true).filter((c) => c.r).map((c) => ({ f0: c.f0, f1: c.f1, box: c.r.box, popup: c.r.popup ?? null, text: c.text })),
    waits: cuts.filter((c) => c.label).map((c) => ({ f0: F(map(c.a)), f1: F(map(c.a) + 2.8), text: c.label.replace("{s}", Math.round(c.b - c.a)) })),
    vo: lines,
    subs,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  makeVoiceOver();
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
}
