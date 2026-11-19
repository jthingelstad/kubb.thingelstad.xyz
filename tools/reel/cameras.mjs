// The reel's cameras: the angles a highlight is filmed from, in the core camera's table
// (src/render/camera.js) through `lookAt` (src/game/scenes.js), so drawWorld draws them
// like any of the game's. Pure: a camera is a function of the throw's facts, the
// format's frame and how far through its shot the reel is. All in the world frame
// (Team A's baseline at y = 0, Team B's at y = 8; tools/reel/scan.mjs).
//
// The game's own cameras are the thrower's (the aim, the follow and the impact cuts of
// playdate-kubb's DESIGN "Follow camera") and the wide view's fixed broadcast camera
// (the engine's session/wide.lua). The reel adds its own:
//
//   overview  the whole pitch, for the title and the end cards
//   arc       the throw from the side, low, so the arc reads (a tall frame: from high
//             behind the thrower, the throw running up the screen); it leans a little
//             after the baton
//   impact    close and low on the group that is hit, pushing in slowly through the
//             slow motion and the beat on what fell
//   king      low on the king, looking up at it
//   land      a miss: where the baton came down
import { lookAt } from "../../src/game/scenes.js";

export const tune = {
  overview: {
    wide: { eye: [7.4, 4, 5.2], at: [0, 4, 0], span: 6.1 },
    tall: { eye: [0, -4.6, 6.4], at: [0, 4.6, 0], span: 3.3 },
  },
  arc: {
    wide: { back: 4.6, up: 1.7, lookUp: 0.45, margin: 0.9, lean: 0.3 },
    tall: {
      behind: 1.4,
      side: 2.6,
      up: 1.9,
      spread: 0.36,
      cy: 0.52,
      fMax: 1100,
      lean: 0.35,
    },
  },
  impact: {
    wide: {
      back: 1.9,
      side: 1.5,
      up: 0.95,
      ahead: 0.3,
      span: 1.25,
      push: 0.14,
    },
    tall: { back: 1.6, side: 1.3, up: 1.0, ahead: 0.3, span: 0.85, push: 0.14 },
  },
  king: {
    wide: {
      back: 1.5,
      side: 0.8,
      up: 0.18,
      lookUp: 0.24,
      span: 1.25,
      push: 0.1,
    },
    tall: {
      back: 1.5,
      side: 0.7,
      up: 0.2,
      lookUp: 0.26,
      span: 0.85,
      push: 0.1,
    },
  },
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const ease = (u) => u * u * (3 - 2 * u);

// The throw's line on the ground: from the release to the first hit (the landing
// when nothing was hit); dir along it, side across it toward the nearer sideline.
export function throwLine(fact) {
  const from = fact.from || { x: 0, y: fact.side === "B" ? 8 : 0 };
  const to =
    fact.firstHit && fact.firstHit.x != null
      ? { x: fact.firstHit.x, y: fact.firstHit.y }
      : fact.land?.x != null
        ? fact.land
        : { x: from.x, y: fact.side === "B" ? 0 : 8 };
  let d = sub(to, from);
  const L = len(d) || 1;
  d = { x: d.x / L, y: d.y / L };
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  let n = { x: d.y, y: -d.x };
  // the camera stands on the side of the nearer sideline
  const s = Math.sign(mid.x) || 1;
  if (Math.sign(n.x) !== s) n = { x: -n.x, y: -n.y };
  return { from, to, dir: d, side: n, mid, L };
}

// frame: { w, h } in frame units (400 wide; the height follows the format) and
// cy, the fraction of the height the action is centred on.
function cam(eye, at, f, frame) {
  return lookAt(eye, at, f, frame.w / 2, frame.h * (frame.cy ?? 0.5));
}

export function overview(format, frame) {
  const o = tune.overview[format];
  const d = Math.hypot(
    o.eye[0] - o.at[0],
    o.eye[1] - o.at[1],
    o.eye[2] - o.at[2],
  );
  return cam(o.eye, o.at, ((frame.w / 2) * d) / o.span, frame);
}

// baton: the baton's (or thrown kubb's) place now, or null.
export function arc(fact, format, frame, baton = null) {
  const g = throwLine(fact);
  if (format === "wide") {
    const o = tune.arc.wide;
    const along = baton
      ? ((baton.x - g.mid.x) * g.dir.x + (baton.y - g.mid.y) * g.dir.y) * o.lean
      : 0;
    const at = [g.mid.x + g.dir.x * along, g.mid.y + g.dir.y * along, o.lookUp];
    const eye = [
      g.mid.x + g.side.x * o.back,
      g.mid.y + g.side.y * o.back,
      o.up,
    ];
    const f = ((frame.w / 2) * o.back) / (g.L / 2 + o.margin);
    return cam(eye, at, f, frame);
  }
  // tall: from high behind the thrower, framed so the release sits low in the
  // picture (above the caption) and the target high (below the score line)
  const o = tune.arc.tall;
  const lean = baton
    ? ((baton.x - g.from.x) * g.dir.x + (baton.y - g.from.y) * g.dir.y) * o.lean
    : 0;
  const eye = [
    g.from.x - g.dir.x * o.behind + g.side.x * o.side,
    g.from.y - g.dir.y * o.behind + g.side.y * o.side,
    o.up,
  ];
  const p0 = [g.from.x + g.dir.x * lean, g.from.y + g.dir.y * lean, 0.3];
  const p1 = [g.to.x + g.dir.x * 0.4, g.to.y + g.dir.y * 0.4, 0.1];
  const unit = (p) => {
    const v = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const a = unit(p0),
    b = unit(p1);
  const ang = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const m = unit([
    eye[0] + a[0] + b[0],
    eye[1] + a[1] + b[1],
    eye[2] + a[2] + b[2],
  ]);
  const at = [eye[0] + m[0] * 5, eye[1] + m[1] * 5, eye[2] + m[2] * 5];
  const f = (o.spread * frame.h) / (2 * Math.tan(ang / 2));
  return lookAt(eye, at, Math.min(o.fMax, f), frame.w / 2, frame.h * o.cy);
}

// center: the ground point to look at ({ x, y }), u: 0..1 through the shot.
function closeOn(center, g, o, frame, u, lookUp = 0.1) {
  const push = 1 - o.push * ease(Math.min(1, Math.max(0, u)));
  const ex = -g.dir.x * o.back + g.side.x * o.side;
  const ey = -g.dir.y * o.back + g.side.y * o.side;
  const at = [
    center.x + g.dir.x * (o.ahead ?? 0),
    center.y + g.dir.y * (o.ahead ?? 0),
    o.lookUp ?? lookUp,
  ];
  const eye = [at[0] + ex * push, at[1] + ey * push, o.up * push + 0.05];
  const d = Math.hypot(eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]);
  return cam(eye, at, ((frame.w / 2) * d) / (o.span * push), frame);
}

export function impact(fact, format, frame, u = 0) {
  const g = throwLine(fact);
  return closeOn(g.to, g, tune.impact[format], frame, u);
}

export function king(fact, format, frame, u = 0, kingAt = { x: 0, y: 4 }) {
  const g = throwLine(fact);
  return closeOn(kingAt, g, tune.king[format], frame, u);
}

export function land(fact, format, frame, u = 0) {
  const g = throwLine(fact);
  const at = fact.land?.x != null ? fact.land : g.to;
  return closeOn(
    at,
    g,
    { ...tune.impact[format], span: tune.impact[format].span * 1.6 },
    frame,
    u,
  );
}
