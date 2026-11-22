// The Minnesota scene (engine id `minnesota`, snow, the Minnesota set; docs/SCENES.md):
// a winter park. A pale cold sky with a low sun, snow to the horizon, banks of it round
// the park, dark pines with snow on their tiers and bare white birches, snow falling.
// The light is low and cold: long shadows of slate blue. The Minnesota set is the
// engine's (navy heads, an ice-blue wave, the north star on the king: palette.js
// SETS.minnesota). A hard strike sprays snow (src/render/impacts.js).
//
// With prefers-reduced-motion no snow falls.
import { project } from "./camera.js";
import { MINNESOTA, setOf as daySetOf } from "./palette.js";
import { DAY_PAINT } from "./world.js";
import { Impacts } from "./impacts.js";
import {
  birch,
  farToNear,
  hash,
  middleDepth,
  pine,
  skyGradient,
  standAt,
} from "./scenery.js";

export const tune = {
  sunAz: 32, // degrees from +y toward -x
  sunEl: 6,
  sunR: 0.018,
  // the low sun: shadows fall long, right and toward the thrower (m per m of height)
  shadowX: -0.78,
  shadowY: -0.52,
  trees: 64, // round the park
  flakes: 90, // falling at once, on the screen
  flakeFall: 0.09, // of the frame's height a second
};

const deg = Math.PI / 180;

// The trees: a ring of pines and birches past the rough, made once.
const TREES = (() => {
  const out = [];
  for (let i = 0; i < tune.trees; i++) {
    const a = hash(i * 11 + 5);
    let x, y;
    if (i % 3 === 0) {
      // behind the far end, past the snowbanks (a tall screen's aim view and the
      // wide view see them; a wide screen's aim view sees about 6 m past the far
      // baseline, the banks)
      x = -10 + a * 20;
      y = 14 + hash(i * 7 + 1) * 9;
    } else {
      const side = i % 2 ? 1 : -1;
      x = side * (5.5 + hash(i * 5 + 2) * 8);
      y = -8 + a * 26;
    }
    out.push({
      x,
      y,
      kind: hash(i * 23 + 9) < 0.62 ? "pine" : "birch",
      h: 4.2 + hash(i * 31 + 4) * 3.4,
      seed: i + 1,
    });
  }
  return out;
})();

// Snowbanks: along each sideline, a metre off it, and across past the far baseline.
const BANKS = (() => {
  const out = [];
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1;
    out.push({
      x: side * (3.7 + hash(i * 3) * 0.5),
      y: -3 + (i >> 1) * 1.25,
      r: 0.55 + hash(i * 19) * 0.5,
    });
  }
  for (let i = 0; i < 9; i++)
    out.push({
      x: -4 + i * 1.0,
      y: 9.9 + hash(i * 5) * 0.4,
      r: 0.6 + hash(i) * 0.4,
    });
  return out;
})();

function drawSky(ctx, cam, kx, B) {
  skyGradient(ctx, cam, B, MINNESOTA.sky.top, MINNESOTA.sky.low);
  const az = tune.sunAz * deg,
    el = tune.sunEl * deg;
  const far = 5000;
  const p = project(
    cam,
    cam.px - Math.sin(az) * Math.cos(el) * far,
    cam.py + Math.cos(az) * Math.cos(el) * far,
    cam.pz + Math.sin(el) * far,
  );
  if (!p) return;
  const r = tune.sunR * cam.f;
  ctx.fillStyle = MINNESOTA.sun.halo;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MINNESOTA.sun.face;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fill();
  void kx;
}

// A snowbank: a low white mound, its shaded underside.
function bank(ctx, at, r, kx) {
  const w = r * at.s,
    h = w * 0.32;
  if (w * kx < 3) return;
  ctx.fillStyle = MINNESOTA.bankShade;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, w, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MINNESOTA.bank;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y - h * 0.25, w * 0.96, h * 0.7, 0, Math.PI, 0);
  ctx.fill();
}

function drawThings(ctx, cam, kx, B) {
  const nearest = middleDepth(cam);
  for (const t of farToNear(cam, [
    ...TREES,
    ...BANKS.map((b) => ({ ...b, kind: "bank" })),
  ])) {
    const at = standAt(cam, t.x, t.y, B, nearest, t.kind === "bank" ? 2 : 4);
    if (!at) continue;
    if (t.kind === "pine") pine(ctx, at, t.h, kx, MINNESOTA.pine);
    else if (t.kind === "birch")
      birch(ctx, at, t.h * 0.95, kx, MINNESOTA.birch, t.seed);
    else bank(ctx, at, t.r, kx);
  }
}

// Falling snow: flakes on the screen, drifting down, over everything in the world.
class Snowfall {
  constructor(reduced) {
    this.reduced = reduced;
    this.t = 0;
  }
  advance(dt) {
    if (dt > 0 && dt < 0.5) this.t += dt;
  }
  draw(ctx, B, kx) {
    if (this.reduced) return;
    const W = B.right - B.left,
      H = B.bottom - B.top;
    ctx.fillStyle = MINNESOTA.flake;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < tune.flakes; i++) {
      const sp = 0.6 + hash(i * 13) * 0.8;
      const y = (hash(i * 7 + 3) + this.t * tune.flakeFall * sp) % 1;
      const x = (hash(i * 3 + 1) + Math.sin(this.t * 0.9 + i) * 0.01 + 1) % 1;
      const r = (0.9 + sp * 1.1) / kx;
      const px = B.left + x * W,
        py = B.top + y * H;
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class MinnesotaFx {
  constructor(reduced) {
    this.spray = new Impacts({
      style: "puff",
      reduced,
      colors: { puff: MINNESOTA.puff },
    });
    this.snow = new Snowfall(reduced);
    this.lastT = null;
  }
  clear() {
    this.spray.clear();
  }
  watch(rec) {
    this.spray.watch(rec);
    this.lastT = null;
  }
  observe(items, t) {
    this.spray.observe(items, t);
    // the snow keeps falling in real time while a throw plays
    this.snow.advance(1 / 60);
    this.lastT = t;
  }
  tick(dt) {
    this.spray.tick(dt);
    this.snow.advance(dt);
  }
  draw(ctx, cam, kx, B) {
    this.spray.draw(ctx, cam, kx);
    if (B) this.snow.draw(ctx, B, kx);
  }
}

const GROUNDS = { snow: MINNESOTA.ground };
const L = (() => {
  const lx = -tune.shadowX,
    ly = -tune.shadowY,
    lz = 1;
  const n = Math.hypot(lx, ly, lz);
  return [lx / n, ly / n, lz / n];
})();

export function makeMinnesota({ reduced = false } = {}) {
  return {
    id: "minnesota",
    skin: null, // the day's controls
    reduced,
    groundOf: (surface) => GROUNDS[surface] || GROUNDS.snow,
    setOf: daySetOf,
    light: {
      shadowX: tune.shadowX,
      shadowY: tune.shadowY,
      L,
      awayBelow: -0.35,
      topAbove: 0.75,
      shadowFill: MINNESOTA.shadow,
    },
    paint: DAY_PAINT,
    clearing: null,
    cone: MINNESOTA.cone,
    sky: drawSky,
    scenery: drawThings,
    makeFx: () => new MinnesotaFx(reduced),
    afterPieces: (ctx, cam, kx, B, scene) => scene.fx?.draw(ctx, cam, kx, B),
  };
}
