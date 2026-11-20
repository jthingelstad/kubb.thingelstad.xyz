// The neon scene (src/render/scenes.js, docs/SCENES.md): a
// black world on a floor of light. A grid runs to the horizon, the pitch is
// brighter lines on it, and the pieces are dark solids edged in light: each
// side in its own colour, the king in his, the stakes and batons white. A
// kubb that lies is dimmed and lights up again when it is raised. A thrown
// piece leaves a ribbon of light; a hit flashes.
//
// The surface is shown by the grid alone: grass a cyan grid every metre,
// sand an amber one every two, snow a pale blue one every half metre. The
// throws are the same on every surface and in every scene.
//
// Data plus the hooks drawWorld calls (src/render/world.js; night.js says
// what each one is):
//   groundOf, setOf, light, paint (with litOf, each piece's light), clearing
//   rough        the floor: the horizon's glow and the grid
//   lines        the pitch's lines: their bloom, then their core
//   beforePieces each piece's light on the floor and round it
//   baton        a plain baton: dark, edged in white
//   afterPieces  the effects (makeFx: the ribbon and the sparks)
// reduced (prefers-reduced-motion): no ribbon, no hit flash, few sparks; the
// glow stays, still.
import { NEON } from "./palette.js";
import { drawGlow } from "./glow.js";
import { Stardust } from "./stardust.js";

export const tune = {
  near: 0.15, // m, in front of the camera
  // the long grid, to the horizon: every `major` m out to `far`
  major: 4,
  far: 88, // a multiple of major, so the lines fall on whole metres
  majorChunk: 6, // m a piece, each faded by its distance
  // the surface's grid (its spacing) round the pitch, fading out by `minorTo`
  minorFrom: 9, // m from the pitch's middle: full
  minorTo: 16, // m: gone
  minorChunk: 2,
  // alpha by distance from the camera (m): [to, alpha]
  fade: [
    [5, 0.7],
    [10, 0.5],
    [18, 0.32],
    [32, 0.18],
    [Infinity, 0.08],
  ],
  minorAlpha: 0.55,
  majorPx: 1.1, // CSS px
  minorPx: 0.8,
  // the horizon's glow, as shares of the frame's height above and below it
  hazeUp: 0.1,
  hazeDown: 0.16,
  hazeAlpha: 0.4,
  // the pitch's lines: bloom bands [m wide, alpha, min CSS px], then the core
  lineBands: [
    [0.18, 0.07, 7],
    [0.09, 0.14, 3.5],
    [0.045, 0.28, 2],
  ],
  lineCore: 0.018,
  lineCoreMin: 1.1,
  // a piece that lies: its long axis this far from upright, on the floor
  lyingBelow: 0.6, // |up's z|
  lyingUnder: 0.2, // m high
  dim: 0.35, // its halo's share
  // the ribbon
  ribbonN: 40, // poses kept
  ribbonLife: 0.35, // s
  ribbonAlpha: 0.26,
  ribbonCore: 0.012, // m
};

// ---------- the floor ----------

// The grid as short pieces along each line, made once per spacing; each
// piece is faded on its own by its distance from the camera.
const grids = new Map();
function gridOf(every) {
  let g = grids.get(every);
  if (g) return g;
  const major = [],
    minor = [];
  const F = tune.far,
    M = tune.major,
    MC = tune.majorChunk;
  const cy = 4; // the pitch's middle
  for (let x = -F; x <= F + 1e-9; x += M)
    for (let y = cy - F; y < cy + F - 1e-9; y += MC)
      major.push(x, y, x, y + MC);
  for (let y = cy - F; y <= cy + F + 1e-9; y += M)
    for (let x = -F; x < F - 1e-9; x += MC) major.push(x, y, x + MC, y);
  // the fine grid: skip what falls on a major line
  const R = tune.minorTo,
    C = tune.minorChunk;
  const on = (v) => Math.abs(v / M - Math.round(v / M)) < 1e-6;
  const n = Math.ceil(R / every);
  for (let i = -n; i <= n; i++) {
    const v = i * every;
    for (let u = -R; u < R - 1e-9; u += C) {
      if (!on(v)) minor.push(v, cy + u, v, cy + u + C);
      if (!on(v + cy)) minor.push(u, cy + v, u + C, cy + v);
    }
  }
  g = { major: new Float64Array(major), minor: new Float64Array(minor) };
  grids.set(every, g);
  return g;
}

const fadeOf = (d) => {
  const f = tune.fade;
  for (let i = 0; i < f.length; i++) if (d < f[i][0]) return i;
  return f.length - 1;
};

// One piece's ends on the screen into buckets[bucket], clipped at the near
// plane. w: 1 or the fine grid's fall-off.
function gridPieces(cam, segs, out, minor) {
  const { px, py, pz, fx, fy, fz, rx, ry, rz, ux, uy, uz, f, cx, cy } = cam;
  const near = tune.near;
  for (let i = 0; i < segs.length; i += 4) {
    let x0 = segs[i],
      y0 = segs[i + 1],
      x1 = segs[i + 2],
      y1 = segs[i + 3];
    let d0 = (x0 - px) * fx + (y0 - py) * fy - pz * fz;
    let d1 = (x1 - px) * fx + (y1 - py) * fy - pz * fz;
    if (d0 < near && d1 < near) continue;
    if (d0 < near || d1 < near) {
      const t = (near - d0) / (d1 - d0);
      const xm = x0 + (x1 - x0) * t,
        ym = y0 + (y1 - y0) * t;
      if (d0 < near) {
        x0 = xm;
        y0 = ym;
        d0 = near;
      } else {
        x1 = xm;
        y1 = ym;
        d1 = near;
      }
    }
    let b = fadeOf((d0 + d1) / 2);
    if (minor) {
      // the fine grid fades out away from the pitch
      const mx = (x0 + x1) / 2,
        my = (y0 + y1) / 2 - 4;
      const r = Math.hypot(mx, my);
      if (r > tune.minorTo) continue;
      if (r > tune.minorFrom)
        b = Math.min(
          out.length - 1,
          b +
            Math.ceil(
              ((r - tune.minorFrom) / (tune.minorTo - tune.minorFrom)) * 2,
            ),
        );
    }
    const s0 = f / d0,
      s1 = f / d1;
    const X0 = x0 - px,
      Y0 = y0 - py,
      X1 = x1 - px,
      Y1 = y1 - py,
      Z = -pz;
    out[b].push(
      cx + s0 * (X0 * rx + Y0 * ry + Z * rz),
      cy - s0 * (X0 * ux + Y0 * uy + Z * uz),
      cx + s1 * (X1 * rx + Y1 * ry + Z * rz),
      cy - s1 * (X1 * ux + Y1 * uy + Z * uz),
    );
  }
}

const buckets = tune.fade.map(() => []);
function strokeBuckets(ctx, color, alphaScale, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let b = 0; b < buckets.length; b++) {
    const L = buckets[b];
    if (!L.length) continue;
    ctx.globalAlpha = tune.fade[b][1] * alphaScale;
    ctx.beginPath();
    for (let i = 0; i < L.length; i += 4) {
      ctx.moveTo(L[i], L[i + 1]);
      ctx.lineTo(L[i + 2], L[i + 3]);
    }
    ctx.stroke();
    L.length = 0;
  }
  ctx.globalAlpha = 1;
}

// The horizon's glow: a soft band of the surface's light where the floor
// meets the black (level cameras only show it; most look down past it).
function drawHaze(ctx, cam, B, G) {
  const hl = Math.hypot(cam.fx, cam.fy);
  if (hl < 0.05) return;
  const hx = cam.fx / hl,
    hy = cam.fy / hl;
  const df = hx * cam.fx + hy * cam.fy;
  if (df <= 0.01) return;
  const y = cam.cy - (cam.f * (hx * cam.ux + hy * cam.uy)) / df;
  const H = B.bottom - B.top;
  const up = H * tune.hazeUp,
    down = H * tune.hazeDown;
  if (y + down < B.top || y - up > B.bottom) return;
  const g = ctx.createLinearGradient(0, y - up, 0, y + down);
  const a = tune.hazeAlpha;
  g.addColorStop(0, "rgba(0, 0, 0, 0)");
  g.addColorStop(up / (up + down), withAlpha(G.glow, a));
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.fillRect(B.left - 2, y - up, B.right - B.left + 4, up + down);
  ctx.restore();
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawFloor(ctx, cam, kx, B, G) {
  drawHaze(ctx, cam, B, G);
  const g = gridOf(G.gridEvery);
  ctx.save();
  ctx.lineCap = "butt";
  gridPieces(cam, g.minor, buckets, true);
  strokeBuckets(ctx, G.grid, tune.minorAlpha, tune.minorPx / kx);
  gridPieces(cam, g.major, buckets, false);
  strokeBuckets(ctx, G.grid, 1, tune.majorPx / kx);
  ctx.restore();
}

// ---------- the lines ----------

function drawLines(ctx, cam, kx, segs, G, paintLines) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const [w, a, px] of tune.lineBands) {
    ctx.globalAlpha = a;
    paintLines(ctx, cam, segs, G.glow, w, px / kx);
  }
  ctx.globalAlpha = 1;
  paintLines(ctx, cam, segs, G.line, tune.lineCore, tune.lineCoreMin / kx);
  ctx.restore();
}

// ---------- each piece's light ----------

function lying(it) {
  const qx = it.qx ?? 0,
    qy = it.qy ?? 0;
  const az = 1 - 2 * (qx * qx + qy * qy);
  return Math.abs(az) < tune.lyingBelow && (it.z ?? 0) < tune.lyingUnder;
}

const LIT = (() => {
  const of = (c, deep, band) => ({ ink: c, bevel: deep, band, bandDeep: deep });
  const T = NEON.team;
  return {
    A: of(T.A.lit, T.A.deep, T.A.lit),
    Adim: of(T.A.dim, T.A.dimDeep, T.A.dim),
    B: of(T.B.lit, T.B.deep, T.B.lit),
    Bdim: of(T.B.dim, T.B.dimDeep, T.B.dim),
    king: of(NEON.king.lit, NEON.king.dim, null),
    kingDim: of(NEON.king.dim, NEON.king.dim, null),
    stake: of(NEON.stake.lit, NEON.stake.lit, null),
    none: of(NEON.stake.lit, NEON.solid.bevel, null),
  };
})();

// What lights a piece: its side's colour (the king his own), dimmed while
// it lies on the floor.
export function litOf(it) {
  if (it.kind === "stake") return LIT.stake;
  const down = lying(it);
  if (it.kind === "king") return down ? LIT.kingDim : LIT.king;
  if (it.team === "A" || it.team === "B")
    return down ? LIT[it.team + "dim"] : LIT[it.team];
  return LIT.none;
}

const HALO = {
  kubb: { foot: 0.24, body: 0.16, a: 0.5, b: 0.22 },
  king: { foot: 0.36, body: 0.26, a: 0.6, b: 0.3 },
  stake: { foot: 0.14, body: 0.1, a: 0.45, b: 0.25 },
};
function drawHalos(ctx, cam, kx, shown) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of shown) {
    const it = s.item;
    const h = HALO[it.kind];
    if (!h) continue;
    const dim = it.kind !== "stake" && lying(it) ? tune.dim : 1;
    const color = litOf(it).ink;
    const dx = it.x - cam.px,
      dy = it.y - cam.py,
      dz = -cam.pz;
    const d = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (d < 0.1) continue;
    const sc = cam.f / d;
    const fx = cam.cx + sc * (dx * cam.rx + dy * cam.ry + dz * cam.rz),
      fy = cam.cy - sc * (dx * cam.ux + dy * cam.uy + dz * cam.uz);
    const dist = Math.hypot(dx, dy, dz);
    const squash = Math.max(0.18, Math.min(1, cam.pz / dist));
    const r = h.foot * sc;
    drawGlow(ctx, fx, fy, r, r * squash, color, h.a * dim);
    const bz = it.z - cam.pz;
    const db = dx * cam.fx + dy * cam.fy + bz * cam.fz;
    if (db > 0.1) {
      const sb = cam.f / db;
      const rb = h.body * sb;
      drawGlow(
        ctx,
        cam.cx + sb * (dx * cam.rx + dy * cam.ry + bz * cam.rz),
        cam.cy - sb * (dx * cam.ux + dy * cam.uy + bz * cam.uz),
        rb,
        rb,
        color,
        h.b * dim,
      );
    }
  }
  ctx.restore();
}

// ---------- a baton ----------

function pt(cam, x, y, z) {
  const dx = x - cam.px,
    dy = y - cam.py,
    dz = z - cam.pz;
  const d = dx * cam.fx + dy * cam.fy + dz * cam.fz;
  if (d < tune.near) return null;
  const s = cam.f / d;
  return [
    cam.cx + s * (dx * cam.rx + dy * cam.ry + dz * cam.rz),
    cam.cy - s * (dx * cam.ux + dy * cam.uy + dz * cam.uz),
    d,
  ];
}

// Plain (no bands, as every baton): a dark body, its outline in white light
// and a faint core of light along it.
function drawBaton(ctx, cam, kx, s) {
  const it = s.item;
  const a = s.axes[2];
  const hl = 0.15,
    r = 0.022;
  const E1 = [it.x - a[0] * hl, it.y - a[1] * hl, it.z - a[2] * hl];
  const E2 = [it.x + a[0] * hl, it.y + a[1] * hl, it.z + a[2] * hl];
  const p1 = pt(cam, ...E1),
    p2 = pt(cam, ...E2);
  if (!p1 || !p2) return;
  const r1 = (r * cam.f) / p1[2],
    r2 = (r * cam.f) / p2[2];
  const dc = (p1[2] + p2[2]) / 2;
  const tall = ((cam.f * 0.3) / dc) * kx;
  const ow = Math.min(2.6, Math.max(0.9, tall / 26)) / kx;
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
    return (
      (sign * (a[0] * v[0] + a[1] * v[1] + a[2] * v[2])) / Math.hypot(...v)
    );
  };
  const c1 = cosEnd(E1, -1),
    c2 = cosEnd(E2, 1);
  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(p1[0] - px * r1, p1[1] - py * r1);
    ctx.lineTo(p2[0] - px * r2, p2[1] - py * r2);
    ctx.lineTo(p2[0] + px * r2, p2[1] + py * r2);
    ctx.lineTo(p1[0] + px * r1, p1[1] + py * r1);
    ctx.closePath();
    for (const [p, rr, c] of [
      [p1, r1, c1],
      [p2, r2, c2],
    ]) {
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
    }
  };
  const B = NEON.baton;
  ctx.lineJoin = "round";
  ctx.strokeStyle = B.edge;
  ctx.lineWidth = ow * 2;
  shape();
  ctx.stroke();
  ctx.fillStyle = B.body;
  shape();
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = B.core;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(ow * 0.6, (r1 + r2) * 0.22);
  ctx.beginPath();
  ctx.moveTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.stroke();
  ctx.restore();
}

// ---------- the effects: the ribbon, the sparks ----------

// Sparks where pieces meet, a flash where the baton hits, and the king's
// fall (src/render/stardust.js's pool, with no trail and no spin dust).
export function sparkConfig(reduced = false) {
  const base = {
    cap: 600,
    colors: [...NEON.spark, ...NEON.kingSpark],
    dust: [0, 1, 2, 3],
    king: [4, 5, 6, 7],
    gravity: 2.4,
    drag: 2.6,
    trailFrom: 1.2,
    trailEvery: 0, // the ribbon is the trail
    trailMax: 0,
    trailLife: 0,
    trailSize: 0,
    spinFrom: 4,
    spinRate: 0, // no spin dust
    spinMax: 0,
    spinLife: 0,
    spinSize: 0,
    hitCount: 8,
    hitExtra: 18,
    knockCount: 3,
    knockExtra: 8,
    groundCount: 3,
    puffLife: 0.5,
    puffSize: 0.009,
    kingRing: 64,
    kingFountain: 28,
    kingLife: 1.3,
    flashFor: 0.35,
    flashSize: 0.9,
    flashAlpha: 0.7,
    flashColor: NEON.king.lit, // the king's fall
    hitFlashColor: "#c8fdff",
    hitFlash: 0.45, // a hit's flash, as a share of the king's
  };
  if (!reduced) return base;
  return {
    ...base,
    hitCount: 4,
    hitExtra: 4,
    knockCount: 1,
    knockExtra: 2,
    groundCount: 1,
    puffLife: 0.3,
    kingRing: 16,
    kingFountain: 0,
    kingLife: 0.7,
    flashAlpha: 0.25,
    hitFlash: 0,
  };
}

// The ribbon: the thrown piece's two ends, kept for a moment, and the band
// of light between them (it twists as the piece turns).
export class NeonFx {
  constructor({ reduced = false } = {}) {
    this.dust = new Stardust(sparkConfig(reduced));
    this.reduced = reduced;
    const N = tune.ribbonN;
    this.pts = new Float64Array(N * 7); // e1, e2, t
    this.head = 0;
    this.n = 0;
    this.now = 0;
  }
  clear() {
    this.dust.clear();
    this.n = 0;
  }
  watch(rec) {
    this.dust.watch(rec);
    this.n = 0;
  }
  observe(items, t) {
    this.dust.observe(items, t);
    this.now = t;
    if (this.reduced) return;
    const d = this.dust;
    const p = d.pid != null ? d.byId.get(d.pid) : null;
    if (!p) return;
    const hz = d.pkind === "baton" ? 0.15 : 0.075;
    const qw = p.qw ?? 1,
      qx = p.qx ?? 0,
      qy = p.qy ?? 0,
      qz = p.qz ?? 0;
    const ax = 2 * (qx * qz + qw * qy),
      ay = 2 * (qy * qz - qw * qx),
      az = 1 - 2 * (qx * qx + qy * qy);
    const N = tune.ribbonN,
      P = this.pts;
    if (this.n) {
      // a piece at rest adds nothing: its ribbon fades out
      const j = ((this.head - 1 + N) % N) * 7;
      const mx = (P[j] + P[j + 3]) / 2 - p.x,
        my = (P[j + 1] + P[j + 4]) / 2 - p.y,
        mz = (P[j + 2] + P[j + 5]) / 2 - p.z;
      if (mx * mx + my * my + mz * mz < 1e-4) return;
    }
    const i = this.head * 7;
    P[i] = p.x + ax * hz;
    P[i + 1] = p.y + ay * hz;
    P[i + 2] = p.z + az * hz;
    P[i + 3] = p.x - ax * hz;
    P[i + 4] = p.y - ay * hz;
    P[i + 5] = p.z - az * hz;
    P[i + 6] = t;
    this.head = (this.head + 1) % N;
    this.n = Math.min(N, this.n + 1);
  }
  tick(dt) {
    this.dust.tick(dt);
    if (dt > 0) this.now += dt;
  }
  draw(ctx, cam, kx) {
    if (this.n > 1) this.ribbon(ctx, cam, kx);
    this.dust.draw(ctx, cam, kx);
  }
  // Each unbroken run of poses is one band and two edge lines, each drawn in
  // one call with a gradient for the fade, so no two pieces of it overlap
  // (drawn piece by piece, every joint was added twice: a bright seam).
  ribbon(ctx, cam, kx) {
    const N = tune.ribbonN,
      P = this.pts,
      life = tune.ribbonLife;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let run = [];
    for (let k = this.n - 1; k >= -1; k--) {
      let p = null;
      if (k >= 0) {
        const i = ((this.head - 1 - k + N * 2) % N) * 7;
        const age = this.now - P[i + 6];
        if (age <= life && age >= -0.05) {
          const a1 = pt(cam, P[i], P[i + 1], P[i + 2]),
            a2 = pt(cam, P[i + 3], P[i + 4], P[i + 5]);
          if (a1 && a2) p = { a1, a2, u: 1 - Math.max(0, age) / life };
        }
      }
      if (p) run.push(p);
      else {
        if (run.length > 1) this.band(ctx, cam, kx, run);
        run = [];
      }
    }
    ctx.restore();
  }
  // One run, oldest first: the band between the two ends' paths, then the
  // two paths bright. The fade follows the run from its oldest pose to its
  // newest, a stop at every pose.
  band(ctx, cam, kx, run) {
    const C = RIBBON;
    const o = run[0],
      h = run[run.length - 1];
    const ox = (o.a1[0] + o.a2[0]) / 2,
      oy = (o.a1[1] + o.a2[1]) / 2;
    const hx = (h.a1[0] + h.a2[0]) / 2,
      hy = (h.a1[1] + h.a2[1]) / 2;
    const vx = hx - ox,
      vy = hy - oy,
      vv = vx * vx + vy * vy;
    const grad = (rgb, k) => {
      if (vv < 1) return `rgba(${rgb},${Math.min(1, h.u * h.u * k)})`;
      const g = ctx.createLinearGradient(ox, oy, hx, hy);
      let last = -1;
      for (const p of run) {
        const mx = (p.a1[0] + p.a2[0]) / 2 - ox,
          my = (p.a1[1] + p.a2[1]) / 2 - oy;
        const f = Math.min(1, Math.max(last, (mx * vx + my * vy) / vv, 0));
        last = f;
        g.addColorStop(f, `rgba(${rgb},${Math.min(1, p.u * p.u * k)})`);
      }
      return g;
    };
    const A = tune.ribbonAlpha;
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad(C.band, A);
    ctx.beginPath();
    ctx.moveTo(o.a1[0], o.a1[1]);
    for (let j = 1; j < run.length; j++) ctx.lineTo(run[j].a1[0], run[j].a1[1]);
    for (let j = run.length - 1; j >= 0; j--)
      ctx.lineTo(run[j].a2[0], run[j].a2[1]);
    ctx.closePath();
    ctx.fill("nonzero");
    const d = (h.a1[2] + h.a2[2]) / 2;
    ctx.lineWidth = Math.max(0.8 / kx, (tune.ribbonCore * cam.f) / d);
    ctx.strokeStyle = grad(C.edge, A * 2.2);
    ctx.beginPath();
    for (const e of ["a1", "a2"]) {
      ctx.moveTo(o[e][0], o[e][1]);
      for (let j = 1; j < run.length; j++)
        ctx.lineTo(run[j][e][0], run[j][e][1]);
    }
    ctx.stroke();
  }
}

const rgbOf = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
const RIBBON = { edge: rgbOf(NEON.ribbon[0]), band: rgbOf(NEON.ribbon[2]) };

// ---------- the scene ----------

const GROUNDS = {};
for (const [k, g] of Object.entries(NEON.grounds))
  GROUNDS[k] = {
    ...g,
    sky: NEON.sky,
    rough: NEON.sky,
    stripe: "rgba(0, 0, 0, 0)",
    speck: "rgba(0, 0, 0, 0)",
    haze: NEON.sky,
  };

// The neon set: every body the dark solid, the king's collar his light.
export const NEON_SET = {
  name: "Neon",
  wood: NEON.solid,
  kingWood: NEON.solid,
  kingMark: NEON.king.lit,
};

const LIGHT = (() => {
  const x = 0.12,
    y = -0.2,
    l = Math.hypot(x, y, 1);
  return [x / l, y / l, 1 / l];
})();

// none of the rough's texture: a clearing with no room inside it
const NO_ROUGH = { x0: 0, x1: 0, y0: 0, y1: 0 };

export function makeNeon({ reduced = false } = {}) {
  return {
    id: "neon",
    skin: NEON.skin,
    reduced,
    set: "neon",
    groundOf: (surface) => GROUNDS[surface] || GROUNDS.grass,
    setOf: () => NEON_SET,
    light: {
      shadowX: -LIGHT[0] * 0.5,
      shadowY: -LIGHT[1] * 0.5,
      L: LIGHT,
      awayBelow: -0.8,
      topAbove: 0.72,
      shadowFill: NEON.shadow,
      shadowBlur: 0,
    },
    paint: {
      wood: NEON.solid,
      stake: NEON.solid,
      ink: NEON.stake.lit,
      kingMark: NEON.king.lit,
      litOf,
    },
    clearing: NO_ROUGH,
    makeFx: () => new NeonFx({ reduced }),
    sky: null,
    rough: drawFloor,
    lightGround: null,
    lines: drawLines,
    beforePieces: drawHalos,
    baton: drawBaton,
    afterPieces: (ctx, cam, kx, B, scene) => scene.fx?.draw(ctx, cam, kx),
  };
}
