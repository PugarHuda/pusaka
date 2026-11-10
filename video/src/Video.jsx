// The video's building blocks. Everything is driven by src/timeline.json (built from script.mjs by tools/timeline.mjs),
// in frames relative to the scene.
import React from "react";
import { AbsoluteFill, Audio, Easing, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";

const W = 1920, H = 1080, RAMP = 20;
const ORANGE = "#f7931a";
const FONT = '"Segoe UI", "Inter", system-ui, sans-serif';
const ease = Easing.bezier(0.45, 0, 0.2, 1);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const fadeIn = (f, f0, n = 8) => clamp01((f - f0) / n);
const envelope = (f, f0, f1, n = 8) => Math.min(fadeIn(f, f0, n), clamp01((f1 - f) / n));

/** Zoom state {s, cx, cy} at frame f: each zoom glides in, holds, glides out (or straight on to the next zoom). */
export function zoomAt(zooms, f) {
  const base = { s: 1, cx: W / 2, cy: H / 2 };
  const targets = [];
  zooms.forEach((z, i) => {
    targets.push({ f: z.f0, s: z.s, cx: z.cx, cy: z.cy });
    const next = zooms[i + 1];
    if (!next || next.f0 > z.f1 + 15) targets.push({ f: z.f1, ...base });
  });
  const at = (frame, n) => {
    let i = -1;
    for (let k = 0; k < n; k++) if (targets[k].f <= frame) i = k;
    if (i < 0) return base;
    const from = at(targets[i].f, i), to = targets[i];
    const p = ease(clamp01((frame - to.f) / RAMP));
    return { s: from.s + (to.s - from.s) * p, cx: from.cx + (to.cx - from.cx) * p, cy: from.cy + (to.cy - from.cy) * p };
  };
  const z = at(f, targets.length);
  const hw = W / 2 / z.s, hh = H / 2 / z.s; // keep the frame filled
  return { s: z.s, cx: Math.min(Math.max(z.cx, hw), W - hw), cy: Math.min(Math.max(z.cy, hh), H - hh) };
}
const toScreen = (z, [x, y, w, h]) => [(x - z.cx) * z.s + W / 2, (y - z.cy) * z.s + H / 2, w * z.s, h * z.s];

export const Highlight = ({ box, f, f0, f1, label, scale = 1 }) => {
  const o = envelope(f, f0, f1, 6);
  if (o <= 0) return null;
  const pad = 10 / scale, [x, y, w, h] = box;
  const pop = 1 + 0.06 * (1 - ease(fadeIn(f, f0, 10)));
  return (
    <div style={{ position: "absolute", left: x - pad, top: y - pad, width: w + 2 * pad, height: h + 2 * pad, opacity: o, transform: `scale(${pop})`,
      border: `${4 / scale}px solid ${ORANGE}`, borderRadius: 12 / scale, boxShadow: `0 0 0 ${6 / scale}px rgba(247,147,26,.22), 0 0 ${30 / scale}px rgba(247,147,26,.45)` }}>
      {label && <div style={{ position: "absolute", left: -4 / scale, top: -44 / scale, background: ORANGE, color: "#111", font: `700 ${22 / scale}px ${FONT}`,
        padding: `${4 / scale}px ${12 / scale}px`, borderRadius: 8 / scale, whiteSpace: "nowrap" }}>{label}</div>}
    </div>
  );
};

/** A note beside a region, in screen space (stays readable at any zoom). */
export const Callout = ({ box, f, f0, f1, text }) => {
  const o = envelope(f, f0, f1, 8);
  if (o <= 0) return null;
  const [x, y, w, h] = box;
  const right = x + w + 40 + 520 < W;
  const left = right ? x + w + 40 : Math.max(24, x - 40 - 520);
  return (
    <div style={{ position: "absolute", left, top: Math.min(Math.max(24, y + h / 2 - 50), H - 220), width: 520, opacity: o, transform: `translateY(${(1 - o) * 12}px)`,
      background: "rgba(17,17,17,.92)", color: "#fff", font: `500 30px/1.3 ${FONT}`, padding: "18px 24px", borderRadius: 16, borderLeft: `6px solid ${ORANGE}` }}>
      {text}
    </div>
  );
};

export const Caption = ({ text, f, dur }) => {
  const o = envelope(f, 4, dur - 4, 10);
  return (
    <div style={{ position: "absolute", left: 48, top: 40, maxWidth: 1300, opacity: o, transform: `translateX(${(1 - ease(fadeIn(f, 4, 14))) * -30}px)`,
      background: "rgba(17,17,17,.88)", color: "#fff", font: `700 40px/1.2 ${FONT}`, padding: "16px 28px", borderRadius: 18, borderLeft: `8px solid ${ORANGE}`,
      boxShadow: "0 10px 40px rgba(0,0,0,.25)" }}>{text}</div>
  );
};

/** An honest label where a wait was cut. */
export const WaitLabel = ({ text, f, f0, f1 }) => {
  const o = envelope(f, f0, f1, 6);
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", right: 48, top: 44, opacity: o, background: "#fff", color: "#111", font: `700 34px ${FONT}`, padding: "14px 26px",
      borderRadius: 999, border: `4px solid ${ORANGE}`, boxShadow: "0 10px 40px rgba(0,0,0,.3)" }}>{text}</div>
  );
};

export const Subtitles = ({ subs, f }) => {
  const c = subs.find((s) => f >= s.f0 && f < s.f1);
  if (!c) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 1500, background: "rgba(0,0,0,.78)", color: "#fff", font: `600 46px/1.25 ${FONT}`, padding: "12px 30px", borderRadius: 14, textAlign: "center" }}>
        {c.text}
      </div>
    </div>
  );
};

/** A wallet popup, shown as its own window beside the app, with its own highlight boxes. */
const Popup = ({ p, f, boxes, callouts }) => {
  const [pw, ph] = p.size, bar = 40;
  const k = Math.min(1.4, (H - 120 - bar) / ph);
  const show = p.f0 + 24; // the window's first second is a blank page loading
  if (f < show - 1) return null;
  const o = envelope(f, show, p.f1, 7);
  const s = k * (0.94 + 0.06 * ease(fadeIn(f, show, 9)));
  const w = pw * s, h = ph * s + bar;
  return (
    <>
      <AbsoluteFill style={{ background: `rgba(10,10,20,${0.4 * o})` }} />
      <div style={{ position: "absolute", left: W - w - 150, top: (H - h) / 2, width: w, height: h, opacity: o,
        borderRadius: 16, overflow: "hidden", boxShadow: "0 30px 90px rgba(0,0,0,.6)", background: "#111", border: "1px solid #444" }}>
        <div style={{ height: bar, background: "#2a2a2e", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", font: `600 18px ${FONT}`, color: "#ddd" }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: "#ff5f57" }} />
          <span style={{ width: 12, height: 12, borderRadius: 99, background: "#febc2e" }} />
          <span style={{ width: 12, height: 12, borderRadius: 99, background: "#28c840" }} />
          <span style={{ marginLeft: 10 }}>wallet.intear.tech</span>
        </div>
        <div style={{ position: "relative", width: pw, height: ph, overflow: "hidden", transform: `scale(${s})`, transformOrigin: "0 0" }}>
          {p.pieces.map((g, i) => (
            <Sequence key={i} from={g.out} durationInFrames={g.len} layout="none">
              <OffthreadVideo src={staticFile(p.src)} trimBefore={g.src} muted style={{ width: W, height: H, position: "absolute", left: 0, top: 0 }} />
            </Sequence>
          ))}
          {boxes.map((b, i) => <Highlight key={i} {...b} f={f} scale={s} />)}
        </div>
      </div>
      {callouts.map((c, i) => <Callout key={i} {...c} box={[W - w - 150 + c.box[0] * s, (H - h) / 2 + bar + c.box[1] * s, c.box[2] * s, c.box[3] * s]} f={f} />)}
    </>
  );
};

const Card = ({ card, f, dur }) => {
  const o = envelope(f, 0, dur, 12);
  const rise = (d) => (1 - ease(fadeIn(f, d, 18))) * 30;
  return (
    <AbsoluteFill style={{ background: "radial-gradient(circle at 30% 20%, #ffe2b8 0%, #fff6ea 35%, #eef0ff 100%)", alignItems: "center", justifyContent: "center", opacity: o }}>
      <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", right: 180, top: 230, background: "radial-gradient(circle at 35% 30%, #fff8 0, #ffb347 40%, #f7931a 75%, #c96d00 100%)",
        boxShadow: "0 40px 120px rgba(247,147,26,.45)", transform: `translateY(${Math.sin(f / 30) * 8}px)` }} />
      <div style={{ position: "absolute", left: 180, top: 300, width: 1100 }}>
        <div style={{ font: `600 34px ${FONT}`, color: "#8a5a14", letterSpacing: 1, transform: `translateY(${rise(4)}px)`, opacity: fadeIn(f, 4, 14) }}>{card.kicker}</div>
        <div style={{ font: `700 ${card.title.length > 14 ? 92 : 150}px/1.05 Georgia, "Times New Roman", serif`, color: "#151515", margin: "18px 0 26px", transform: `translateY(${rise(8)}px)`, opacity: fadeIn(f, 8, 14) }}>{card.title}</div>
        <div style={{ font: `500 46px/1.3 ${FONT}`, color: "#333", transform: `translateY(${rise(14)}px)`, opacity: fadeIn(f, 14, 14) }}>{card.sub}</div>
      </div>
    </AbsoluteFill>
  );
};

/** One scene: the recorded clip (kept segments, frozen tail), zoom, boxes, popups, captions, voice and subtitles. */
export const Scene = ({ sc }) => {
  const f = useCurrentFrame();
  const z = zoomAt(sc.zooms, f);
  const main = (list) => list.filter((b) => b.popup == null);
  const fade = envelope(f, 0, sc.dur, 6);
  return (
    <AbsoluteFill style={{ background: "#f4f1ec" }}>
      {sc.card ? <Card card={sc.card} f={f} dur={sc.dur} /> : (
        <AbsoluteFill style={{ opacity: fade }}>
          <div style={{ position: "absolute", width: W, height: H, transformOrigin: "0 0", transform: `translate(${W / 2 - z.cx * z.s}px, ${H / 2 - z.cy * z.s}px) scale(${z.s})` }}>
            {sc.segs.map((g, i) => (
              <Sequence key={i} from={g.out} durationInFrames={g.len} layout="none">
                <OffthreadVideo src={staticFile(sc.clip)} trimBefore={g.src} muted style={{ width: W, height: H, position: "absolute" }} />
              </Sequence>
            ))}
            {sc.freeze && (
              <Sequence from={sc.freeze.out} layout="none">
                <Freeze frame={sc.freeze.src}><OffthreadVideo src={staticFile(sc.clip)} muted style={{ width: W, height: H, position: "absolute" }} /></Freeze>
              </Sequence>
            )}
            {main(sc.boxes).map((b, i) => <Highlight key={i} {...b} f={f} scale={z.s} />)}
          </div>
          {main(sc.callouts).map((c, i) => <Callout key={i} {...c} box={toScreen(z, c.box)} f={f} />)}
          {sc.popups.map((p, i) => f >= p.f0 - 2 && f < p.f1 + 8 && (
            <Popup key={i} p={p} f={f} boxes={sc.boxes.filter((b) => b.popup === i)} callouts={sc.callouts.filter((c) => c.popup === i)} />
          ))}
          {sc.caption && <Caption text={sc.caption} f={f} dur={sc.dur} />}
          {sc.waits.map((w, i) => <WaitLabel key={i} {...w} f={f} />)}
        </AbsoluteFill>
      )}
      {sc.vo.map((v, i) => <Sequence key={i} from={v.f} layout="none"><Audio src={staticFile(v.src)} /></Sequence>)}
      <Subtitles subs={sc.subs} f={f} />
    </AbsoluteFill>
  );
};

export const Video = ({ tl }) => (
  <AbsoluteFill style={{ background: "#f4f1ec" }}>
    {tl.scenes.map((sc) => (
      <Sequence key={sc.id + sc.from} from={sc.from} durationInFrames={sc.dur} name={sc.id}>
        <Scene sc={sc} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
