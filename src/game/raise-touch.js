// Touch the kubb to raise it (Jamie, 2026-11-19: "similar to on the Playdate where you can
// use the crank to raise the kubbs, on touch, you should be able to just touch the kubb and
// raise it"). Pure geometry for the raise screen (src/game/game.js "raise and
// punishment"): where the lying kubb is drawn on the screen, which end a tap or a drag
// means, and the kubb's pose part way up while it is dragged. Nothing here talks to the
// engine: the game sends the same `raise` action with a choice as the END buttons do.
//
//   const g = raiseGeometry(view, cam, need);  // the kubb's outline and its end caps, CSS px
//   onKubb(g, x, y, tune.margin)                 // a tap on the drawn kubb (or beside it)
//   nearerEnd(g, x, y)                           // the end nearer the tap: 0 or 1
//   dragOf(g, x0, y0, x, y)                      // { i, t }: toward end i, t of the way up
//   tiltItem(need, i, t)                         // the kubb as a renderer item, tipped up
import { projectView } from "../render/camera.js";
import { solid } from "../render/world.js";
import { poseItem } from "./scenes.js";

export const tune = {
  margin: 24, // px round the drawn kubb a tap still takes it (a finger's width)
  labelR: 40, // px round an end's numbered label a tap takes that end
  labelR0: 17, // px, the numbered label's drawn radius
  labelGap: 4, // px between the footprint's outer edge and the label's circle
  travelMin: 90, // px: the shortest drag that tips the kubb all the way up
  travelK: 1.1, // the drag that tips it all the way: this times the kubb's drawn length
  stand: 0.5, // let go past this part of the way up and it stands
  hintMs: 1000, // ms the allowed end is lit after a tap on a refused one
};

const HALF_SIDE = 0.035; // a kubb: half its side and half its length (render/world SIZES)
const HALF_LEN = 0.075;

// The lying kubb's long axis, a unit vector from its middle toward end i (an index into
// need.ends), in the view frame on the ground.
function axisTo(need, i) {
  const e = need.ends?.[i];
  const a = need.pose.angle || 0;
  let ux = Math.cos(a),
    uy = Math.sin(a);
  if (e?.pose) {
    const dx = e.pose.x - need.pose.x,
      dy = e.pose.y - need.pose.y;
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) return [dx / l, dy / l];
  }
  // no footprint to go by (the engine's own raises, lift.js settledClips): end 1 is
  // the +axis end and end 2 the -axis end, as core/raising has them
  if (i === 1) [ux, uy] = [-ux, -uy];
  return [ux, uy];
}

// Convex hull of [x, y] points (monotone chain), anticlockwise.
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [],
    upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0)
      lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0)
      upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// The lying kubb on the screen: its outline (the hull of its eight projected corners) and
// the middles of its two end faces, in CSS px. null when it is not a two-ended raise or
// a corner is behind the camera.
export function raiseGeometry(view, cam, need) {
  if (!need?.pose || (need.ends || []).length !== 2) return null;
  const s = solid(poseItem(need.kubb, "kubb", need.pose), cam);
  const outline = [];
  for (let k = 0; k < 8; k++) {
    const p = projectView(
      view,
      cam,
      s.W[3 * k],
      s.W[3 * k + 1],
      s.W[3 * k + 2],
    );
    if (!p) return null;
    outline.push([p[0], p[1]]);
  }
  const caps = [0, 1].map((i) => {
    const [ux, uy] = axisTo(need, i);
    const p = projectView(
      view,
      cam,
      need.pose.x + ux * HALF_LEN,
      need.pose.y + uy * HALF_LEN,
      HALF_SIDE,
    );
    return p ? { x: p[0], y: p[1] } : null;
  });
  if (!caps[0] || !caps[1]) return null;
  return { outline: hull(outline), caps };
}

// How far (x, y) is outside a convex polygon, in px: 0 inside.
function outside(poly, x, y) {
  let inside = true;
  let best = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const [ax, ay] = poly[k];
    const [bx, by] = poly[(k + 1) % poly.length];
    const ex = bx - ax,
      ey = by - ay;
    if (ex * (y - ay) - ey * (x - ax) < 0) inside = false;
    const l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
    best = Math.min(best, Math.hypot(x - (ax + t * ex), y - (ay + t * ey)));
  }
  return inside ? 0 : best;
}

// A press at (x, y) on the drawn kubb, or within `margin` px of it.
export function onKubb(g, x, y, margin = tune.margin) {
  return !!g && outside(g.outline, x, y) <= margin;
}

// Where (x, y) lies along the kubb from end 0's face (0) to end 1's (1), on the screen.
function along(g, x, y) {
  const [a, b] = g.caps;
  const ex = b.x - a.x,
    ey = b.y - a.y;
  return ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey || 1);
}

// The end nearer a tap on the kubb: 0 or 1.
export function nearerEnd(g, x, y) {
  return along(g, x, y) < 0.5 ? 0 : 1;
}

// A drag from (x0, y0) to (x, y): toward which end, and how far up (0 to 1). The finger
// moves toward the end the kubb will stand on, along the kubb as it is drawn; the drag that
// tips it all the way is the kubb's drawn length (tune.travelK), never under travelMin.
export function dragOf(g, x0, y0, x, y) {
  const [a, b] = g.caps;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const d = ((x - x0) * (b.x - a.x) + (y - y0) * (b.y - a.y)) / len;
  const travel = Math.max(tune.travelMin, len * tune.travelK);
  return { i: d < 0 ? 0 : 1, t: Math.min(1, Math.abs(d) / travel) };
}

// The end to stand it on, or the one the rules allow when `i` is refused (null when
// neither is).
export function allowedEnd(need, i) {
  const ends = need.ends || [];
  if (ends[i] && ends[i].ok !== false) return { i, ok: true };
  const other = ends.findIndex((e) => e && e.ok !== false);
  return { i: other >= 0 ? other : null, ok: false };
}

// Quaternions [w, x, y, z].
function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

// The kubb tipped `t` of the way up onto end i, as a hand lifts it: the other end rises,
// pivoting on the bottom edge of end i's face, until at t = 1 it stands on that end's
// footprint (on end 1 upside down, as the engine's tip has it: a kubb looks the same
// either way up, and the engine's view stands it after). The same motion as the engine's own crank
// raise (core/raising.lua tipPose, which the session does not hand out), here in the view
// frame and for drawing only. A renderer item (poseItem's shape).
export function tiltItem(need, i, t) {
  const lying = poseItem(need.kubb, "kubb", need.pose);
  if (!(t > 0)) return lying;
  const [ux, uy] = axisTo(need, i);
  const th = (t * Math.PI) / 2;
  // turn about the horizontal axis (-u) x up = (-uy, ux, 0): -u, the far end, goes up
  const kx = -uy,
    ky = ux;
  const s = Math.sin(th / 2);
  const q = qmul(
    [Math.cos(th / 2), kx * s, ky * s, 0],
    [lying.qw, lying.qx, lying.qy, lying.qz],
  );
  // the middle about the pivot, in the plane of u and up: (-len, side) turned by th
  const px = need.pose.x + ux * HALF_LEN,
    py = need.pose.y + uy * HALF_LEN;
  const a = -HALF_LEN * Math.cos(th) + HALF_SIDE * Math.sin(th);
  const z = HALF_LEN * Math.sin(th) + HALF_SIDE * Math.cos(th);
  // at t = 1 the middle is side + len out from the kubb's: the end's footprint
  const x = px + ux * a,
    y = py + uy * a;
  return {
    ...lying,
    x,
    y,
    z,
    qw: q[0],
    qx: q[1],
    qy: q[2],
    qz: q[3],
    toppled: false,
  };
}
