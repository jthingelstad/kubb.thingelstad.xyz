// drawWorld(ctx, view, camera, scene): the pitch and its pieces through a
// core camera, in the Woodcut-in-colour look (DESIGN 4.1 and 6, docs/RENDER.md).
//
// A pure function of its inputs. It sets its own transform (the 400 x 240
// frame scaled by k and centred, times the device pixel ratio) inside
// save/restore, so the caller's transform is left as it was. Its only
// module state is a cache of the rough's texture points per surface.
//
// Order, back to front: sky and ground, the pitch's mown stripes and lines,
// the marks on the ground (keep-out circles, footprints, the arc's trace, the
// thrower, the target circle), every hard shadow (one fill; none for the
// stakes, as on the Playdate), the pieces in depth order, the planned arc in
// the air.
import {
  viewFit,
  frameBounds,
  project,
  projectPoly,
  depth as depthOf,
  NEAR,
} from "./camera.js";
import {
  INK,
  WOOD,
  STAKE,
  KING_MARK,
  AIM,
  TEAM,
  groundOf,
  setOf,
} from "./palette.js";

// ---------- numbers ----------

export const tune = {
  // one light, the Playdate's (render/world shadowX, shadowY): from the far
  // left, so shadows fall right and toward the thrower
  shadowX: 0.55,
  shadowY: -0.3,
  awayBelow: -0.35, // a face whose n.L is at or below this faces away from the light (shade)
  topAbove: 0.75, // at or above this, the brightest tone (a lit top)
  // The field lines. A Kubb pitch has no painted lines: at most a string
  // between the stakes (Jamie, 2026-11-16: "there really is no line. The line
  // is just a visual indicator ... much, much thinner").
  lineWidth: 0.012, // m on the ground
  lineMinPx: 0.6, // frame px: never thinner
  dash: 0.24, // m, the centerline: 6 on 4 off
  dashGap: 0.16,
  advDash: 0.1, // m, the advantage line: 2 on 2 off
  stakeMinPx: 3, // frame px, the thinnest a stake is drawn
  roughFar: 200, // m, how far the ground goes along the view
  // detail by size: a piece's length on screen in CSS px
  grainFrom: 26,
  ringsFrom: 34,
  bevelFrom: 46,
  setDetailFrom: 34,
  kingDetailFrom: 40,
  // outline width in CSS px: tall / outlineDiv, between outlineMin and outlineMax
  outlineDiv: 20,
  outlineMin: 1,
  outlineMax: 3.4,
  // the king's drawing, fractions of its height (render/world.lua)
  kingCrown: 0.11,
  kingCollar: 0.66,
  kingCollarTop: 0.73,
  kingRing: 0.6,
  kingDiamond: 0.47,
  kingDiamondH: 0.07,
  // a team's mark: a painted ring round the foot of its kubbs
  teamFrom: 0.05,
  teamTo: 0.13,
  // marks in CSS px
  markWidth: 2.5,
  arcDash: [7, 6],
  arcStopShort: 0.45, // m: the arc in the air ends this far (along the ground) before it lands
};

// Sizes (DESIGN 4.1; core/body.lua): half extents along local x, y, z.
export const SIZES = {
  kubb: [0.035, 0.035, 0.075],
  king: [0.045, 0.045, 0.15],
  baton: [0.022, 0.022, 0.15],
  stake: [0.0095, 0.0095, 0.075],
};

// The six stakes (core/pitch): drawn when the scene gives no stake items.
const DEFAULT_STAKES = [
  [-2.5, 0],
  [2.5, 0],
  [-2.5, 4],
  [2.5, 4],
  [-2.5, 8],
  [2.5, 8],
].map(([x, y], i) => ({
  id: "stake" + (i + 1),
  kind: "stake",
  x,
  y,
  z: 0.075,
  qw: 1,
  qx: 0,
  qy: 0,
  qz: 0,
}));

const L = (() => {
  const lx = -tune.shadowX,
    ly = -tune.shadowY,
    lz = 1;
  const n = Math.hypot(lx, ly, lz);
  return [lx / n, ly / n, lz / n];
})();

// Faces of a box: corner indices (bit 0: +x, bit 1: +y, bit 2: +z), the
// first two at the local -z end for the sides (a, b; c above b, d above a),
// then the axis and sign of the outward normal.
const FACES = [
  [0, 2, 6, 4, 0, -1],
  [1, 3, 7, 5, 0, 1],
  [0, 1, 5, 4, 1, -1],
  [2, 3, 7, 6, 1, 1],
  [0, 1, 3, 2, 2, -1],
  [4, 5, 7, 6, 2, 1],
];

// ---------- small helpers ----------

function hash(n) {
  n = n ^ 61 ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
const shadeCache = new Map();
function shaded(color) {
  // a paint on the face away from the light
  let s = shadeCache.get(color);
  if (!s) {
    s = mix(color, INK, 0.42);
    shadeCache.set(color, s);
  }
  return s;
}

function matrix(qw, qx, qy, qz) {
  // core/quat.toMatrix: columns are the local axes in the world
  return [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy - qw * qz),
    2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qw * qx),
    2 * (qx * qz - qw * qy),
    2 * (qy * qz + qw * qx),
    1 - 2 * (qx * qx + qy * qy),
  ];
}

// 2D convex hull (monotone chain) of flat points [x0, y0, x1, y1, ...].
function hull(pts) {
  const n = pts.length / 2;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort(
    (a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1],
  );
  const out = [];
  const cross = (o, a, b) =>
    (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) -
    (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  for (const i of idx) {
    while (
      out.length >= 2 &&
      cross(out[out.length - 2], out[out.length - 1], i) <= 0
    )
      out.pop();
    out.push(i);
  }
  const lower = out.length + 1;
  for (let s = n - 2; s >= 0; s--) {
    const i = idx[s];
    while (
      out.length >= lower &&
      cross(out[out.length - 2], out[out.length - 1], i) <= 0
    )
      out.pop();
    out.push(i);
  }
  out.pop();
  return out;
}

function polyPath(ctx, flat) {
  ctx.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  ctx.closePath();
}

// ---------- a piece's geometry ----------

// Everything about a piece that its pose and kind decide: half extents,
// the rotation, the eight world corners, its shadow outline on the ground.
export function solid(item, cam) {
  let [hx, hy, hz] = SIZES[item.kind] || SIZES.kubb;
  if (item.kind === "stake" && cam) {
    // never thinner than stakeMinPx frame px at its distance
    const d = depthOf(cam, item.x, item.y, item.z);
    if (d > NEAR) {
      const minH = (tune.stakeMinPx * d) / (2 * cam.f);
      if (hx < minH) hx = hy = minH;
    }
  }
  const R = matrix(item.qw ?? 1, item.qx ?? 0, item.qy ?? 0, item.qz ?? 0);
  const ax = [R[0], R[3], R[6]],
    ay = [R[1], R[4], R[7]],
    az = [R[2], R[5], R[8]];
  const W = new Float64Array(24);
  for (let k = 0; k < 8; k++) {
    const sx = k & 1 ? 1 : -1,
      sy = k & 2 ? 1 : -1,
      sz = k & 4 ? 1 : -1;
    for (let j = 0; j < 3; j++)
      W[3 * k + j] =
        [item.x, item.y, item.z][j] +
        sx * hx * ax[j] +
        sy * hy * ay[j] +
        sz * hz * az[j];
  }
  return {
    item,
    h: [hx, hy, hz],
    axes: [ax, ay, az],
    c: [item.x, item.y, item.z],
    W,
  };
}

function shadowOutline(s) {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    let z = s.W[3 * k + 2];
    if (!(z > 0)) z = 0;
    pts.push(s.W[3 * k] + tune.shadowX * z, s.W[3 * k + 1] + tune.shadowY * z);
  }
  const h = hull(pts);
  return { xs: h.map((i) => pts[2 * i]), ys: h.map((i) => pts[2 * i + 1]) };
}

// ---------- depth order ----------

// Which of two separated boxes is nearer the camera: +1 when b is in front
// of a (draw a first), -1 when a is in front, by the separating axis that
// parts them most (or, for boxes that touch or overlap, the one that
// overlaps least: pieces in contact). Pure geometry: exact for convex boxes
// that do not interpenetrate.
export function frontOf(a, b, cam) {
  const axes = [...a.axes, ...b.axes];
  for (const u of a.axes)
    for (const v of b.axes) {
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l > 1e-6) axes.push([n[0] / l, n[1] / l, n[2] / l]);
    }
  let best = null,
    bestGap = -Infinity;
  for (const n of axes) {
    const ra =
      a.h[0] * Math.abs(dot(a.axes[0], n)) +
      a.h[1] * Math.abs(dot(a.axes[1], n)) +
      a.h[2] * Math.abs(dot(a.axes[2], n));
    const rb =
      b.h[0] * Math.abs(dot(b.axes[0], n)) +
      b.h[1] * Math.abs(dot(b.axes[1], n)) +
      b.h[2] * Math.abs(dot(b.axes[2], n));
    const ca = dot(a.c, n),
      cb = dot(b.c, n);
    const gap = Math.abs(cb - ca) - ra - rb;
    if (gap > bestGap) {
      bestGap = gap;
      best = { n, ra, rb, ca, cb };
    }
  }
  const { n, ra, rb, ca, cb } = best;
  const camS = cam.px * n[0] + cam.py * n[1] + cam.pz * n[2];
  // the plane between them along n
  const plane =
    cb >= ca ? (ca + ra + (cb - rb)) / 2 : (ca - ra + (cb + rb)) / 2;
  const bSide = cb >= ca ? camS > plane : camS < plane;
  return bSide ? 1 : -1;
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// The draw order of solids: far to near by centre depth, then corrected
// for every pair whose screen boxes overlap by frontOf (a topological sort;
// a cycle, which convex pieces cannot make unless they interpenetrate, falls
// back to the depth order). Returns indices into `solids`.
export function depthOrder(solids, cam, boxes) {
  const n = solids.length;
  const d = solids.map((s) => depthOf(cam, s.c[0], s.c[1], s.c[2]));
  const base = [...Array(n).keys()].sort((i, j) => d[j] - d[i]);
  const rank = new Array(n);
  base.forEach((i, r) => (rank[i] = r));
  const after = Array.from({ length: n }, () => []); // after[i]: drawn after i
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const A = boxes ? boxes[i] : null,
        B = boxes ? boxes[j] : null;
      if (A && B && (A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]))
        continue;
      const f = frontOf(solids[i], solids[j], cam);
      if (f > 0) {
        after[i].push(j);
        indeg[j]++;
      } else {
        after[j].push(i);
        indeg[i]++;
      }
    }
  }
  const out = [];
  const ready = base.filter((i) => indeg[i] === 0);
  const done = new Array(n).fill(false);
  while (out.length < n) {
    if (ready.length === 0) {
      // a cycle: take the farthest not yet drawn
      const i = base.find((x) => !done[x]);
      ready.push(i);
      indeg[i] = 0;
    }
    ready.sort((a, b) => rank[a] - rank[b]);
    const i = ready.shift();
    if (done[i]) continue;
    done[i] = true;
    out.push(i);
    for (const j of after[i]) {
      if (done[j]) continue;
      if (--indeg[j] === 0) ready.push(j);
    }
  }
  return out;
}

// ---------- the ground ----------

const roughCache = new Map();
function roughPoints(surface) {
  let pts = roughCache.get(surface);
  if (pts) return pts;
  pts = [];
  const step = surface === "grass" ? 0.42 : 0.36;
  let n = 0;
  for (let x = -12; x <= 12; x += step) {
    for (let y = -6; y <= 22; y += step) {
      n++;
      const jx = x + (hash(n * 7 + 1) - 0.5) * step;
      const jy = y + (hash(n * 13 + 5) - 0.5) * step;
      if (jx > -2.62 && jx < 2.62 && jy > -0.12 && jy < 8.12) continue;
      pts.push(jx, jy, hash(n * 31 + 11));
    }
  }
  roughCache.set(surface, pts);
  return pts;
}

function groundQuad(cam, x0, y0, x1, y1) {
  return projectPoly(cam, [x0, x1, x1, x0], [y0, y0, y1, y1], null, 4);
}

function fillGround(ctx, cam, xs, ys, color) {
  const p = projectPoly(cam, xs, ys, null, xs.length);
  if (p.length < 6) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  polyPath(ctx, p);
  ctx.fill();
}

function drawGround(ctx, cam, B, scene, G, kx) {
  // the sky, then everything below the far edge is rough
  ctx.fillStyle = G.sky;
  ctx.fillRect(
    B.left - 2,
    B.top - 2,
    B.right - B.left + 4,
    B.bottom - B.top + 4,
  );
  const hl = Math.hypot(cam.fx, cam.fy);
  let filled = false;
  if (hl > 0.05) {
    const hx = cam.fx / hl,
      hy = cam.fy / hl;
    const far = tune.roughFar,
      wide = 2000;
    const cx = cam.px + hx * far,
      cy = cam.py + hy * far;
    let a = project(cam, cx + hy * wide, cy - hx * wide, 0);
    let b = project(cam, cx - hy * wide, cy + hx * wide, 0);
    if (a && b && Math.abs(b[0] - a[0]) > 1) {
      if (b[0] < a[0]) [a, b] = [b, a];
      const kk = (b[1] - a[1]) / (b[0] - a[0]);
      const x0 = B.left - 4,
        x1 = B.right + 4;
      const y0 = a[1] + (x0 - a[0]) * kk,
        y1 = a[1] + (x1 - a[0]) * kk;
      ctx.fillStyle = G.rough;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1, Math.max(B.bottom + 4, y1 + 4));
      ctx.lineTo(x0, Math.max(B.bottom + 4, y0 + 4));
      ctx.closePath();
      ctx.fill();
      // haze at the horizon: a soft band where the ground meets the sky
      const mx = (x0 + x1) / 2,
        my = (y0 + y1) / 2;
      const nl = Math.hypot(kk, 1);
      const gx = -kk / nl,
        gy = 1 / nl;
      const band = 14;
      const grd = ctx.createLinearGradient(
        mx,
        my,
        mx + gx * band,
        my + gy * band,
      );
      grd.addColorStop(0, G.haze);
      grd.addColorStop(1, G.rough);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 + gx * band, y1 + gy * band);
      ctx.lineTo(x0 + gx * band, y0 + gy * band);
      ctx.closePath();
      ctx.fill();
      filled = true;
    }
  }
  if (!filled)
    fillGround(
      ctx,
      cam,
      [-400, 400, 400, -400],
      [-400, -400, 400, 400],
      G.rough,
    );

  // the rough's texture: tufts on grass, grains on sand, sparkle on snow
  const pts = roughPoints(scene.surface || "grass");
  ctx.strokeStyle = G.speck;
  ctx.fillStyle = G.speck;
  ctx.lineCap = "round";
  ctx.lineWidth = 1.1 / kx;
  ctx.beginPath();
  const grass = (scene.surface || "grass") === "grass";
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i],
      y = pts[i + 1],
      r = pts[i + 2];
    const d = (x - cam.px) * cam.fx + (y - cam.py) * cam.fy - cam.pz * cam.fz;
    if (d < 0.3 || d > 30) continue;
    const p = project(cam, x, y, 0);
    if (
      !p ||
      p[0] < B.left - 4 ||
      p[0] > B.right + 4 ||
      p[1] < B.top - 4 ||
      p[1] > B.bottom + 4
    )
      continue;
    const s = cam.f / d; // frame px per metre
    if (grass) {
      const h = (0.035 + r * 0.03) * s;
      if (h * kx < 1.2) continue;
      const w = h * 0.45;
      ctx.moveTo(p[0] - w, p[1] - h * 0.8);
      ctx.lineTo(p[0], p[1]);
      ctx.lineTo(p[0] + w * 0.6, p[1] - h);
      ctx.moveTo(p[0] - w * 0.1, p[1] - h * 1.1);
      ctx.lineTo(p[0], p[1]);
    } else {
      const w = (0.03 + r * 0.03) * s;
      if (w * kx < 1) continue;
      ctx.moveTo(p[0] - w / 2, p[1]);
      ctx.lineTo(p[0] + w / 2, p[1]);
    }
  }
  ctx.stroke();

  // the pitch: mown stripes along its length
  fillGround(ctx, cam, [-2.5, 2.5, 2.5, -2.5], [0, 0, 8, 8], G.pitch);
  for (let i = 0; i < 5; i += 2) {
    const x0 = -2.5 + i;
    fillGround(ctx, cam, [x0, x0 + 1, x0 + 1, x0], [0, 0, 8, 8], G.stripe);
  }

  // the lines: true width on the ground, never under lineMinPx
  const w = tune.lineWidth / 2;
  ctx.fillStyle = G.line;
  ctx.strokeStyle = G.line;
  ctx.lineWidth = tune.lineMinPx;
  ctx.lineCap = "butt";
  const quads = [];
  const segs = [];
  const line = (x0, y0, x1, y1) => {
    // an axis-aligned line from (x0, y0) to (x1, y1), w either side
    if (y0 === y1) quads.push([x0 - w, y0 - w, x1 + w, y0 + w]);
    else quads.push([x0 - w, y0 - w, x0 + w, y1 + w]);
    segs.push([x0, y0, x1, y1]);
  };
  line(-2.5, 0, -2.5, 8);
  line(2.5, 0, 2.5, 8);
  line(-2.5, 0, 2.5, 0);
  line(-2.5, 8, 2.5, 8);
  const dashed = (y, on, off) => {
    for (let x = -2.5; x < 2.5; x += on + off)
      line(x, y, Math.min(2.5, x + on), y);
  };
  dashed(4, tune.dash, tune.dashGap);
  if (scene.advantageY != null)
    dashed(scene.advantageY, tune.advDash, tune.advDash);
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of quads) {
    const p = groundQuad(cam, x0, y0, x1, y1);
    if (p.length >= 6) polyPath(ctx, p);
  }
  ctx.fill();
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segs) {
    // subdivide so near-plane clipping and the thin far part both hold
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1));
    for (let i = 0; i < n; i++) {
      const a = project(
        cam,
        x0 + ((x1 - x0) * i) / n,
        y0 + ((y1 - y0) * i) / n,
        0,
      );
      const b = project(
        cam,
        x0 + ((x1 - x0) * (i + 1)) / n,
        y0 + ((y1 - y0) * (i + 1)) / n,
        0,
      );
      if (!a || !b) continue;
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
  }
  ctx.stroke();
}

// ---------- marks on the ground and in the air ----------

function groundCircle(cam, x, y, r, n = 48) {
  const xs = [],
    ys = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    xs.push(x + r * Math.cos(a));
    ys.push(y + r * Math.sin(a));
  }
  return projectPoly(cam, xs, ys, null, n);
}

function strokeTwice(ctx, kx, path, edge, color, width) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = edge;
  ctx.lineWidth = (width + 2.2) / kx;
  path();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width / kx;
  path();
  ctx.stroke();
}

function drawKeepOut(ctx, cam, kx, keepOut) {
  for (const c of keepOut) {
    const p = groundCircle(cam, c.x, c.y, c.r);
    if (p.length < 6) continue;
    ctx.fillStyle = AIM.keepOut;
    ctx.beginPath();
    polyPath(ctx, p);
    ctx.fill();
    ctx.setLineDash([5 / kx, 4 / kx]);
    ctx.strokeStyle = AIM.keepOutEdge;
    ctx.lineWidth = 2 / kx;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawFootprints(ctx, cam, kx, footprints) {
  const h = 0.035;
  for (const fp of footprints) {
    const c = Math.cos(fp.angle || 0),
      s = Math.sin(fp.angle || 0);
    const xs = [],
      ys = [];
    for (const [u, v] of [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ]) {
      xs.push(fp.x + u * c - v * s);
      ys.push(fp.y + u * s + v * c);
    }
    const p = projectPoly(cam, xs, ys, null, 4);
    if (p.length < 6) continue;
    const path = () => {
      ctx.beginPath();
      polyPath(ctx, p);
    };
    if (fp.allowed === false) {
      strokeTwice(ctx, kx, path, INK, AIM.footRefused, 2.5);
      // a cross through a refused end
      const cross = () => {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p[4], p[5]);
        ctx.moveTo(p[2], p[3]);
        ctx.lineTo(p[6], p[7]);
      };
      strokeTwice(ctx, kx, cross, INK, AIM.footRefused, 2);
    } else if (fp.chosen) {
      ctx.fillStyle = "rgba(255, 246, 200, 0.45)";
      path();
      ctx.fill();
      ctx.setLineDash([6 / kx, 4 / kx]);
      strokeTwice(ctx, kx, path, INK, AIM.footChosen, 3);
      ctx.setLineDash([]);
    } else {
      strokeTwice(ctx, kx, path, INK, AIM.footAllowed, 2.5);
    }
  }
}

function drawThrower(ctx, cam, kx, t) {
  // a ring where the thrower stands and an arrow down the pitch
  const ring = groundCircle(cam, t.x, t.y, 0.2, 32);
  if (ring.length >= 6) {
    strokeTwice(
      ctx,
      kx,
      () => {
        ctx.beginPath();
        polyPath(ctx, ring);
      },
      INK,
      AIM.thrower,
      2.5,
    );
  }
  // the arrow points down the pitch: toward +y in the thrower's frame;
  // t.facing -1 (the wide view's world frame, Team B throwing) toward -y
  const f = t.facing === -1 ? -1 : 1;
  const head = projectPoly(
    cam,
    [t.x, t.x - 0.12, t.x + 0.12],
    [t.y + 0.42 * f, t.y + 0.24 * f, t.y + 0.24 * f],
    null,
    3,
  );
  if (head.length >= 6) {
    ctx.fillStyle = AIM.thrower;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 / kx;
    ctx.lineJoin = "round";
    ctx.beginPath();
    polyPath(ctx, head);
    ctx.fill();
    ctx.stroke();
  }
}

function drawMarker(ctx, cam, kx, m) {
  const p = groundCircle(cam, m.x, m.y, m.r);
  if (p.length < 6) return;
  ctx.fillStyle = "rgba(255, 246, 200, 0.18)";
  ctx.beginPath();
  polyPath(ctx, p);
  ctx.fill();
  strokeTwice(
    ctx,
    kx,
    () => {
      ctx.beginPath();
      polyPath(ctx, p);
    },
    INK,
    AIM.marker,
    tune.markWidth + 0.5,
  );
  const r = m.r * 0.45;
  const a = project(cam, m.x - r, m.y, 0),
    b = project(cam, m.x + r, m.y, 0);
  const c = project(cam, m.x, m.y - r, 0),
    d = project(cam, m.x, m.y + r, 0);
  if (a && b && c && d) {
    strokeTwice(
      ctx,
      kx,
      () => {
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.moveTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
      },
      INK,
      AIM.marker,
      tune.markWidth,
    );
  }
}

function arcPath(ctx, cam, arc, ground) {
  ctx.beginPath();
  let pen = false;
  for (const q of arc) {
    const p = project(cam, q[0], q[1], ground ? 0 : q[2]);
    if (!p) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(p[0], p[1]);
    else ctx.moveTo(p[0], p[1]);
    pen = true;
  }
}

function drawArcTrack(ctx, cam, kx, arc) {
  ctx.setLineDash([3 / kx, 5 / kx]);
  ctx.strokeStyle = AIM.track;
  ctx.lineWidth = 2.5 / kx;
  ctx.lineCap = "round";
  arcPath(ctx, cam, arc, true);
  ctx.stroke();
  ctx.setLineDash([]);
}

// The arc in the air stops short of where it comes down (tune.arcStopShort
// metres along the ground from its last point), so the dashes drawn over the
// pieces never hide the kubb it is aimed at; the trace on the ground still
// runs to the end.
export function arcInAir(arc, stop = tune.arcStopShort) {
  const n = arc.length;
  if (n < 2 || !(stop > 0)) return arc;
  const [ex, ey] = arc[n - 1];
  const far = (q) => Math.hypot(q[0] - ex, q[1] - ey);
  let i = n - 1;
  while (i > 0 && far(arc[i - 1]) <= stop) i--;
  if (i === 0) return [];
  // arc[i - 1] is beyond the cut, arc[i] within it: end on the cut
  const a = arc[i - 1],
    b = arc[i];
  const da = far(a),
    db = far(b);
  const t = da - db > 1e-9 ? (da - stop) / (da - db) : 0;
  return arc
    .slice(0, i)
    .concat([
      [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ],
    ]);
}

function drawArc(ctx, cam, kx, arc) {
  const air = arcInAir(arc);
  if (air.length < 2) return;
  ctx.setLineDash(tune.arcDash.map((v) => v / kx));
  strokeTwice(
    ctx,
    kx,
    () => arcPath(ctx, cam, air, false),
    AIM.arcEdge,
    AIM.arc,
    2.5,
  );
  ctx.setLineDash([]);
}

// ---------- pieces ----------

function toneOf(n, end) {
  const lit = dot(n, L);
  if (lit <= tune.awayBelow) return end ? "endShade" : "shade";
  if (end) return "end";
  return lit >= tune.topAbove ? "top" : "light";
}

// A point on a side face: s across from a to b, u up from the foot (a, b)
// to the top (d, c), in projected corners S (flat frame px).
function faceAt(S, F, s, u) {
  const ax = S[2 * F[0]],
    ay = S[2 * F[0] + 1],
    bx = S[2 * F[1]],
    by = S[2 * F[1] + 1];
  const cx = S[2 * F[2]],
    cy = S[2 * F[2] + 1],
    dx = S[2 * F[3]],
    dy = S[2 * F[3] + 1];
  const lx = ax + (dx - ax) * u,
    ly = ay + (dy - ay) * u;
  const rx = bx + (cx - bx) * u,
    ry = by + (cy - by) * u;
  return [lx + (rx - lx) * s, ly + (ry - ly) * s];
}

function bandPath(ctx, S, F, u0, u1, s0 = 0, s1 = 1) {
  const a = faceAt(S, F, s0, u0),
    b = faceAt(S, F, s1, u0),
    c = faceAt(S, F, s1, u1),
    d = faceAt(S, F, s0, u1);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
  ctx.closePath();
}

function star(ctx, x, y, r, points = 5, inner = 0.45, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    if (i) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
}

// A set's detail on a side face's head band (near only).
function setDetail(ctx, S, F, set, band, ow, dark) {
  const um = (band.from + band.to) / 2;
  const color = dark ? shaded(set.detailPaint) : set.detailPaint;
  const hgt = Math.hypot(
    ...sub(faceAt(S, F, 0.5, band.to), faceAt(S, F, 0.5, band.from)),
  );
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (set.detail === "stars") {
    for (let i = 1; i <= 3; i++) {
      const [x, y] = faceAt(S, F, i / 4, um);
      star(ctx, x, y, hgt * 0.32);
      ctx.fill();
    }
  } else if (set.detail === "cross") {
    bandPath(ctx, S, F, set.bands[1].from, 1, 0.3, 0.4);
    ctx.fill();
  } else if (set.detail === "wave") {
    ctx.lineWidth = Math.max(ow * 0.7, hgt * 0.12);
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const s = 0.08 + (i / 12) * 0.84;
      const [x, y] = faceAt(
        S,
        F,
        s,
        um + Math.sin(i * 1.3) * (band.to - band.from) * 0.18,
      );
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  } else if (set.detail === "cheese") {
    const holes = [
      [0.2, 0.3, 0.09],
      [0.55, 0.62, 0.12],
      [0.8, 0.25, 0.07],
      [0.35, 0.8, 0.07],
      [0.72, 0.86, 0.06],
    ];
    for (const [s, v, r] of holes) {
      const [x, y] = faceAt(S, F, s, band.from + (band.to - band.from) * v);
      ctx.beginPath();
      ctx.ellipse(x, y, hgt * r * 1.4, hgt * r * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

// Wood grain on a side face: strokes along its length, placed by the
// piece's id so a piece keeps its own grain.
function grain(ctx, S, F, seed, n, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const s = 0.16 + (0.68 * (i + hash(seed + i * 17))) / n;
    const u0 = 0.06 + hash(seed + i * 29) * 0.18;
    const u1 = 0.62 + hash(seed + i * 41) * 0.32;
    const sway = (hash(seed + i * 53) - 0.5) * 0.12;
    const a = faceAt(S, F, s, u0),
      m = faceAt(S, F, s + sway, (u0 + u1) / 2),
      b = faceAt(S, F, s, u1);
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]);
  }
  ctx.stroke();
}

// End grain: rings round an off-centre pith, mapped onto the end face.
function rings(ctx, S, F, seed, color, width) {
  const pc = 0.42 + hash(seed) * 0.16,
    pv = 0.42 + hash(seed + 3) * 0.16;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const r of [0.14, 0.27, 0.4]) {
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const s = Math.min(0.94, Math.max(0.06, pc + r * Math.cos(a)));
      const u = Math.min(
        0.94,
        Math.max(
          0.06,
          pv + r * Math.sin(a) * (1 + 0.08 * Math.sin(3 * a + seed)),
        ),
      );
      const [x, y] = faceAt(S, F, s, u);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
  const [x, y] = faceAt(S, F, pc, pv);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, width * 0.9, 0, Math.PI * 2);
  ctx.fill();
}

// Project a solid's corners; null when any is behind the near plane.
function projectSolid(cam, s) {
  const S = new Float64Array(16);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let k = 0; k < 8; k++) {
    const p = project(cam, s.W[3 * k], s.W[3 * k + 1], s.W[3 * k + 2]);
    if (!p) return null;
    S[2 * k] = p[0];
    S[2 * k + 1] = p[1];
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { S, box: [x0, y0, x1, y1] };
}

function faceInfo(s, cam, fi) {
  const F = FACES[fi];
  const n = s.axes[F[4]].map((v) => v * F[5]);
  const h = s.h[F[4]];
  const fc = [s.c[0] + n[0] * h, s.c[1] + n[1] * h, s.c[2] + n[2] * h];
  const vis =
    (cam.px - fc[0]) * n[0] +
      (cam.py - fc[1]) * n[1] +
      (cam.pz - fc[2]) * n[2] >
    0;
  return { F, n, vis, end: F[4] === 2, fi };
}

function sizes(s, cam, kx) {
  const d = depthOf(cam, s.c[0], s.c[1], s.c[2]);
  const tall = d > NEAR ? ((cam.f * 2 * s.h[2]) / d) * kx : 0; // CSS px
  const ow = Math.min(
    tune.outlineMax,
    Math.max(tune.outlineMin, tall / tune.outlineDiv),
  );
  return { tall, ow: ow / kx };
}

function drawBox(ctx, cam, kx, s, P, set) {
  const { S } = P;
  const item = s.item;
  const stake = item.kind === "stake";
  const { tall, ow } = sizes(s, cam, kx);
  const seed = hashStr(item.id || "x");
  const pal = stake
    ? {
        top: STAKE.end,
        light: STAKE.light,
        shade: STAKE.shade,
        end: STAKE.end,
        endShade: STAKE.shade,
      }
    : WOOD;
  const faces = [];
  for (let fi = 0; fi < 6; fi++) {
    const f = faceInfo(s, cam, fi);
    if (f.vis) faces.push(f);
  }
  ctx.lineJoin = "round";
  for (const f of faces) {
    const tone = toneOf(f.n, f.end);
    const dark = tone === "shade" || tone === "endShade";
    const F = f.F;
    ctx.fillStyle = pal[tone];
    ctx.beginPath();
    ctx.moveTo(S[2 * F[0]], S[2 * F[0] + 1]);
    ctx.lineTo(S[2 * F[1]], S[2 * F[1] + 1]);
    ctx.lineTo(S[2 * F[2]], S[2 * F[2] + 1]);
    ctx.lineTo(S[2 * F[3]], S[2 * F[3] + 1]);
    ctx.closePath();
    ctx.fill();
    if (stake) continue;
    if (!f.end) {
      // the grain, then the paint over it
      if (tall >= tune.grainFrom) {
        grain(
          ctx,
          S,
          F,
          seed + f.fi * 101,
          tall >= tune.grainFrom * 2 ? 4 : 2,
          dark ? WOOD.grainShade : WOOD.grain,
          ow * 0.5,
        );
      }
      if (item.team && TEAM[item.team]) {
        ctx.fillStyle = dark ? TEAM[item.team].deep : TEAM[item.team].fill;
        bandPath(ctx, S, F, tune.teamFrom, tune.teamTo);
        ctx.fill();
      }
      if (set) {
        for (const b of set.bands) {
          ctx.fillStyle = dark ? shaded(b.paint) : b.paint;
          bandPath(ctx, S, F, b.from, b.to);
          ctx.fill();
        }
        if (tall >= tune.setDetailFrom)
          setDetail(ctx, S, F, set, set.bands[0], ow, dark);
      }
    } else {
      // an end: the head (+z) is painted in a set; rings when near
      const head = F[5] > 0;
      if (set && head) {
        ctx.fillStyle = dark ? shaded(set.bands[0].paint) : set.bands[0].paint;
        ctx.beginPath();
        polyPath(ctx, [
          S[2 * F[0]],
          S[2 * F[0] + 1],
          S[2 * F[1]],
          S[2 * F[1] + 1],
          S[2 * F[2]],
          S[2 * F[2] + 1],
          S[2 * F[3]],
          S[2 * F[3] + 1],
        ]);
        ctx.fill();
      } else if (tall >= tune.ringsFrom) {
        rings(
          ctx,
          S,
          F,
          seed + f.fi,
          dark ? WOOD.grainShade : WOOD.ring,
          ow * 0.45,
        );
      }
    }
    if (tall >= tune.bevelFrom && !dark) {
      // a bevelled edge: a light line just inside the face's edges
      const c = faceAt(S, F, 0.5, 0.5);
      ctx.strokeStyle = WOOD.bevel;
      ctx.lineWidth = ow * 0.55;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = S[2 * F[i]],
          y = S[2 * F[i] + 1];
        const ix = x + (c[0] - x) * 0.07,
          iy = y + (c[1] - y) * 0.07;
        if (i) ctx.lineTo(ix, iy);
        else ctx.moveTo(ix, iy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  // inner edges thin, the silhouette bold
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 0.55;
  ctx.beginPath();
  for (const f of faces) {
    const F = f.F;
    polyPath(ctx, [
      S[2 * F[0]],
      S[2 * F[0] + 1],
      S[2 * F[1]],
      S[2 * F[1] + 1],
      S[2 * F[2]],
      S[2 * F[2] + 1],
      S[2 * F[3]],
      S[2 * F[3] + 1],
    ]);
  }
  ctx.stroke();
  const h = hull(Array.from(S));
  ctx.lineWidth = ow;
  ctx.beginPath();
  polyPath(
    ctx,
    h.flatMap((i) => [S[2 * i], S[2 * i + 1]]),
  );
  ctx.stroke();
}

// The king: a straight body and a head whose top is a crown of points (two
// V cuts in each side), an ink collar, and near, a ring and a diamond.
function drawKing(ctx, cam, kx, s, P, set) {
  const { S } = P;
  const { tall, ow } = sizes(s, cam, kx);
  const W = s.W;
  // rings of points up the four vertical edges (bottom corners 0..3)
  const U = {
    ring: tune.kingRing,
    collar: tune.kingCollar,
    collarTop: tune.kingCollarTop,
    floor: 1 - tune.kingCrown,
  };
  const R = {};
  for (const key in U) {
    const u = U[key];
    const pts = [];
    for (let k = 0; k < 4; k++) {
      const p = project(
        cam,
        W[3 * k] + (W[3 * (k + 4)] - W[3 * k]) * u,
        W[3 * k + 1] + (W[3 * (k + 4) + 1] - W[3 * k + 1]) * u,
        W[3 * k + 2] + (W[3 * (k + 4) + 2] - W[3 * k + 2]) * u,
      );
      if (!p) return;
      pts.push(p[0], p[1]);
    }
    R[key] = pts;
  }
  const pt = (arr, k) => [arr[2 * k], arr[2 * k + 1]];
  const corner = (k) => [S[2 * k], S[2 * k + 1]];
  const seed = hashStr(s.item.id || "king");
  // the face's outline: from the foot (or a ring) up to the crown's teeth
  const sideOutline = (a, b, fromRing) => {
    const fa = pt(R.floor, a),
      fb = pt(R.floor, b);
    const ta = corner(a + 4),
      tb = corner(b + 4);
    const v1 = [fa[0] + (fb[0] - fa[0]) * 0.25, fa[1] + (fb[1] - fa[1]) * 0.25];
    const v2 = [fa[0] + (fb[0] - fa[0]) * 0.75, fa[1] + (fb[1] - fa[1]) * 0.75];
    const p = [(ta[0] + tb[0]) / 2, (ta[1] + tb[1]) / 2];
    const A = fromRing ? pt(fromRing, a) : corner(a),
      B = fromRing ? pt(fromRing, b) : corner(b);
    return [A, B, tb, v2, p, v1, ta];
  };
  const path = (pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  const up = s.axes[2];
  const above =
    (cam.px - s.c[0]) * up[0] +
      (cam.py - s.c[1]) * up[1] +
      (cam.pz - s.c[2]) * up[2] >
    0;
  const crown = set ? set.crown : null;
  if (above) {
    // through the cuts: the far sides' inner walls, then the crown's floor
    for (let fi = 0; fi < 4; fi++) {
      const f = faceInfo(s, cam, fi);
      if (f.vis) continue;
      const pts = sideOutline(f.F[0], f.F[1], R.collarTop);
      ctx.fillStyle = crown ? shaded(crown) : WOOD.shade;
      path(pts);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow * 0.55;
      ctx.stroke();
    }
    const F = FACES[5];
    const fl = [
      pt(R.floor, F[0]),
      pt(R.floor, F[1]),
      pt(R.floor, F[2] - 4),
      pt(R.floor, F[3] - 4),
    ];
    ctx.fillStyle = crown ? shaded(crown) : WOOD.endShade;
    path(fl);
    ctx.fill();
  } else {
    const f = faceInfo(s, cam, 4);
    if (f.vis) {
      const F = f.F;
      ctx.fillStyle = WOOD[toneOf(f.n, true)];
      path([corner(F[0]), corner(F[1]), corner(F[2]), corner(F[3])]);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = ow;
      ctx.stroke();
    }
  }
  for (let fi = 0; fi < 4; fi++) {
    const f = faceInfo(s, cam, fi);
    if (!f.vis) continue;
    const F = f.F;
    const a = F[0],
      b = F[1];
    const tone = toneOf(f.n, false);
    const dark = tone === "shade";
    const outline = sideOutline(a, b);
    ctx.fillStyle = WOOD[tone];
    path(outline);
    ctx.fill();
    // the body's grain, under the collar
    if (tall >= tune.grainFrom) {
      const G = [a, b, b + 4, a + 4];
      // grain only below the ring: use a face-shaped band of the lower body
      const Sb = new Float64Array(16);
      Sb.set(S);
      for (let k = 0; k < 4; k++) {
        Sb[2 * (k + 4)] = R.ring[2 * k];
        Sb[2 * (k + 4) + 1] = R.ring[2 * k + 1];
      }
      grain(
        ctx,
        Sb,
        G,
        seed + fi * 7,
        3,
        dark ? WOOD.grainShade : WOOD.grain,
        ow * 0.5,
      );
    }
    if (crown) {
      ctx.fillStyle = dark ? shaded(crown) : crown;
      path(sideOutline(a, b, R.collar));
      ctx.fill();
    }
    // the collar
    ctx.fillStyle = KING_MARK;
    path([
      pt(R.collar, a),
      pt(R.collar, b),
      pt(R.collarTop, b),
      pt(R.collarTop, a),
    ]);
    ctx.fill();
    if (tall >= tune.kingDetailFrom && !dark) {
      // the ring
      ctx.strokeStyle = KING_MARK;
      ctx.lineWidth = ow * 0.7;
      ctx.beginPath();
      ctx.moveTo(...pt(R.ring, a));
      ctx.lineTo(...pt(R.ring, b));
      ctx.stroke();
      // the diamond in the middle of the face
      const u = tune.kingDiamond,
        hh = tune.kingDiamondH;
      const A0 = corner(a),
        B0 = corner(b),
        A1 = corner(a + 4),
        B1 = corner(b + 4);
      const at = (s_, u_) => {
        const lx = A0[0] + (A1[0] - A0[0]) * u_,
          ly = A0[1] + (A1[1] - A0[1]) * u_;
        const rx = B0[0] + (B1[0] - B0[0]) * u_,
          ry = B0[1] + (B1[1] - B0[1]) * u_;
        return [lx + (rx - lx) * s_, ly + (ry - ly) * s_];
      };
      ctx.fillStyle = KING_MARK;
      path([at(0.5, u + hh), at(0.72, u), at(0.5, u - hh), at(0.28, u)]);
      ctx.fill();
      if (crown && set.emblem) {
        // the set's emblem on the painted head, between the collar and the floor
        const mid = (U.collarTop + U.floor) / 2;
        const [x, y] = at(0.5, mid);
        const hgt = Math.hypot(...sub(at(0.5, U.floor), at(0.5, U.collarTop)));
        ctx.fillStyle = set.emblemPaint;
        if (set.emblem === "star") {
          star(ctx, x, y, hgt * 0.38);
          ctx.fill();
        } else if (set.emblem === "northstar") {
          star(ctx, x, y, hgt * 0.42, 4, 0.28);
          ctx.fill();
        } else if (set.emblem === "cross") {
          path([
            at(0.06, mid + 0.02),
            at(0.94, mid + 0.02),
            at(0.94, mid - 0.02),
            at(0.06, mid - 0.02),
          ]);
          ctx.fill();
          path([
            at(0.32, U.floor - 0.01),
            at(0.42, U.floor - 0.01),
            at(0.42, U.collarTop + 0.01),
            at(0.32, U.collarTop + 0.01),
          ]);
          ctx.fill();
        } else if (set.emblem === "cheese") {
          for (const [ss, du, r] of [
            [0.3, 0.02, 0.16],
            [0.66, -0.01, 0.22],
          ]) {
            const [hx, hy] = at(ss, mid + du);
            ctx.beginPath();
            ctx.ellipse(hx, hy, hgt * r, hgt * r * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = ow;
    path(outline);
    ctx.stroke();
  }
}

// A baton: a cylinder 0.30 long and 0.044 across, plain pale wood, the end
// that faces the camera showing its end grain. Batons are always plain and
// the same in every kubb set, with no bands (Jamie, 2026-11-20).
function drawBaton(ctx, cam, kx, s) {
  const it = s.item;
  const a = s.axes[2];
  const hl = 0.15,
    r = 0.022;
  const E1 = [it.x - a[0] * hl, it.y - a[1] * hl, it.z - a[2] * hl];
  const E2 = [it.x + a[0] * hl, it.y + a[1] * hl, it.z + a[2] * hl];
  const p1 = project(cam, ...E1),
    p2 = project(cam, ...E2);
  if (!p1 || !p2) return;
  const r1 = (r * cam.f) / p1[2],
    r2 = (r * cam.f) / p2[2];
  const { ow } = sizes(s, cam, kx);
  let ux = p2[0] - p1[0],
    uy = p2[1] - p1[1];
  const ul = Math.hypot(ux, uy) || 1e-9;
  ux /= ul;
  uy /= ul;
  const px = -uy,
    py = ux;
  const ang = Math.atan2(py, px);
  const cosEnd = (E, sign) => {
    const v = [cam.px - E[0], cam.py - E[1], cam.pz - E[2]];
    const l = Math.hypot(...v);
    return (sign * dot(a, v)) / l;
  };
  const c1 = cosEnd(E1, -1),
    c2 = cosEnd(E2, 1);
  // Wound the same way as the caps' ellipses: under the nonzero rule an
  // opposite winding cancels where a cap overlaps the body and punches a
  // half-moon hole in the wood, showing the ink beneath.
  const body = (w1, w2) => {
    ctx.moveTo(p1[0] - px * w1, p1[1] - py * w1);
    ctx.lineTo(p2[0] - px * w2, p2[1] - py * w2);
    ctx.lineTo(p2[0] + px * w2, p2[1] + py * w2);
    ctx.lineTo(p1[0] + px * w1, p1[1] + py * w1);
    ctx.closePath();
  };
  const cap = (p, rr, c) => {
    ctx.moveTo(p[0] + px * rr, p[1] + py * rr);
    ctx.ellipse(
      p[0],
      p[1],
      rr,
      Math.max(0.01, rr * Math.abs(c)),
      ang,
      0,
      Math.PI * 2,
    );
  };
  // the silhouette in ink, then the wood over it
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = ow * 2;
  ctx.beginPath();
  body(r1, r2);
  cap(p1, r1, c1);
  cap(p2, r2, c2);
  ctx.stroke();
  ctx.fillStyle = WOOD.light;
  ctx.beginPath();
  body(r1, r2);
  cap(p1, r1, c1);
  cap(p2, r2, c2);
  ctx.fill();
  // the side away from the light: which screen side is it?
  const ld = dot(L, a);
  const nx = L[0] - a[0] * ld,
    ny = L[1] - a[1] * ld,
    nz = L[2] - a[2] * ld;
  const q = project(cam, it.x - nx * r, it.y - ny * r, it.z - nz * r);
  const m = project(cam, it.x, it.y, it.z);
  const sideSign =
    q && m && (q[0] - m[0]) * px + (q[1] - m[1]) * py > 0 ? 1 : -1;
  ctx.fillStyle = "rgba(23, 20, 15, 0.32)";
  ctx.beginPath();
  ctx.moveTo(
    p1[0] + px * sideSign * r1 * 0.25,
    p1[1] + py * sideSign * r1 * 0.25,
  );
  ctx.lineTo(
    p2[0] + px * sideSign * r2 * 0.25,
    p2[1] + py * sideSign * r2 * 0.25,
  );
  ctx.lineTo(p2[0] + px * sideSign * r2, p2[1] + py * sideSign * r2);
  ctx.lineTo(p1[0] + px * sideSign * r1, p1[1] + py * sideSign * r1);
  ctx.closePath();
  ctx.fill();
  if (r1 * kx > 3) {
    ctx.strokeStyle = WOOD.bevel;
    ctx.lineWidth = Math.max(ow * 0.6, r1 * 0.18);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(
      p1[0] - px * sideSign * r1 * 0.5,
      p1[1] - py * sideSign * r1 * 0.5,
    );
    ctx.lineTo(
      p2[0] - px * sideSign * r2 * 0.5,
      p2[1] - py * sideSign * r2 * 0.5,
    );
    ctx.stroke();
  }
  // the end facing the camera
  const [E, p, rr, c] = c2 > c1 ? [E2, p2, r2, c2] : [E1, p1, r1, c1];
  void E;
  if (c > 0.02) {
    ctx.fillStyle = WOOD.end;
    ctx.beginPath();
    cap(p, rr, c);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = ow * 0.7;
    ctx.stroke();
    if (rr * kx > 6) {
      ctx.strokeStyle = WOOD.ring;
      ctx.lineWidth = ow * 0.45;
      ctx.beginPath();
      for (const f of [0.35, 0.68]) {
        ctx.moveTo(p[0] + px * rr * f, p[1] + py * rr * f);
        ctx.ellipse(
          p[0],
          p[1],
          rr * f,
          rr * f * Math.abs(c),
          ang,
          0,
          Math.PI * 2,
        );
      }
      ctx.stroke();
      ctx.fillStyle = WOOD.ring;
      ctx.beginPath();
      ctx.arc(p[0], p[1], ow * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- the picture ----------

export function drawWorld(ctx, view, camera, scene) {
  const { width, height } = view;
  const dpr = view.dpr || 1;
  const fit = viewFit(view);
  const { k, ox, oy } = fit;
  const B = frameBounds(width, height, fit);
  const G = groundOf(scene.surface);
  const set = setOf(scene.set);
  const cam = camera;
  ctx.save();
  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);

  drawGround(ctx, cam, B, scene, G, k);

  // the pieces' solids, stakes from the scene or the pitch's six
  const items = scene.items || [];
  const hasStakes = items.some((it) => it.kind === "stake");
  const all = hasStakes ? items : items.concat(DEFAULT_STAKES);
  const solids = all.map((it) => solid(it, cam));

  if (scene.keepOut) drawKeepOut(ctx, cam, k, scene.keepOut);
  if (scene.footprints) drawFootprints(ctx, cam, k, scene.footprints);
  if (scene.arc) drawArcTrack(ctx, cam, k, scene.arc);
  if (scene.thrower) drawThrower(ctx, cam, k, scene.thrower);
  if (scene.marker) drawMarker(ctx, cam, k, scene.marker);

  // every shadow, one fill, over the marks (the Playdate casts none for
  // the stakes)
  ctx.fillStyle = INK;
  ctx.beginPath();
  for (const s of solids) {
    if (s.item.kind === "stake") continue;
    const o = shadowOutline(s);
    const p = projectPoly(cam, o.xs, o.ys, null, o.xs.length);
    if (p.length >= 6) polyPath(ctx, p);
  }
  ctx.fill("nonzero");

  // the pieces in depth order
  const shown = [],
    projs = [],
    boxes = [];
  for (const s of solids) {
    const P = projectSolid(cam, s);
    if (!P) continue;
    const b = P.box;
    if (
      b[2] < B.left - 4 ||
      b[0] > B.right + 4 ||
      b[3] < B.top - 4 ||
      b[1] > B.bottom + 4
    )
      continue;
    shown.push(s);
    projs.push(P);
    boxes.push([b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2]);
  }
  const order = depthOrder(shown, cam, boxes);
  for (const i of order) {
    const s = shown[i];
    const kind = s.item.kind;
    if (kind === "baton") drawBaton(ctx, cam, k, s);
    else if (kind === "king") drawKing(ctx, cam, k, s, projs[i], set);
    else drawBox(ctx, cam, k, s, projs[i], kind === "kubb" ? set : null);
  }

  if (scene.arc) drawArc(ctx, cam, k, scene.arc);
  ctx.restore();
}
