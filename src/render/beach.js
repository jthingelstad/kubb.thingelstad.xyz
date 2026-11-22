// The Beach scene (engine id `beach`, sand; docs/SCENES.md): a sand pitch by the sea.
// A hot clear sky with the sun low over the water, the sea from a line of foam past
// the far baseline to the horizon, wet sand where the waves reach, umbrellas, towels
// and dune grass round the pitch, a sail far out. The pieces and the controls are the
// day's; a hard strike throws up a puff of sand (src/render/impacts.js).
//
// The sea lies past the far baseline in the frame the pitch is drawn in: the thrower
// always faces it (the thrower's view frame), and the wide view (the world frame) has
// it behind Team B's end.
import { project } from "./camera.js";
import { BEACH, setOf as daySetOf } from "./palette.js";
import { DAYLIGHT, DAY_PAINT } from "./world.js";
import { Impacts } from "./impacts.js";
import {
  farToNear,
  groundRect,
  hash,
  horizon,
  inked,
  inkFor,
  middleDepth,
  skyGradient,
  standAt,
} from "./scenery.js";

export const tune = {
  sunAz: -18, // degrees from +y toward -x: the sun over the water, left of the pitch
  sunEl: 7, // degrees up
  sunR: 0.02, // radians
  waves: [0.0, 1.5, 3.8, 8], // m past the shore: the lines of foam
  waveAmp: 0.18, // m
  waveLen: 3.1, // m
  // near the pitch: the cameras look down at it, so the far baseline's few metres
  // and the sidelines' are what most views show of the world round it
  umbrellas: [
    { x: -4.6, y: 9.7, h: 2.1, r: 1.0, c: 0 },
    { x: 5.0, y: 10.1, h: 2.2, r: 1.05, c: 2 },
    { x: -6.4, y: 3.2, h: 2.0, r: 1.0, c: 2 },
    { x: 6.8, y: 1.0, h: 2.0, r: 1.0, c: 0 },
  ],
  towels: [
    { x: -3.7, y: 9.1, w: 0.8, l: 1.6, c: 0 },
    { x: 4.1, y: 9.4, w: 0.8, l: 1.6, c: 2 },
    { x: -5.4, y: 2.6, w: 0.8, l: 1.6, c: 2 },
  ],
  sail: { x: -14, y: 42, h: 4 },
  grassFrom: 3.4, // m from the middle, either side: the dune grass
};

const deg = Math.PI / 180;

function drawSky(ctx, cam, kx, B) {
  skyGradient(ctx, cam, B, BEACH.sky.top, BEACH.sky.low);
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
  ctx.fillStyle = BEACH.sun.halo;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BEACH.sun.face;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fill();
  void kx;
}

// The sea, the wet sand and the foam: on the ground past the shore, before the rough's
// texture and the pitch.
function drawSea(ctx, cam, kx, B) {
  const S = BEACH.shore;
  groundRect(ctx, cam, -400, S - 1.6, 400, S + 0.3, BEACH.wet);
  groundRect(ctx, cam, -400, S, 400, S + 30, BEACH.sea.near);
  groundRect(ctx, cam, -400, S + 30, 400, 2000, BEACH.sea.far);
  const hz = horizon(cam);
  if (hz && hz.y > B.top && hz.y < B.bottom) {
    const band = (B.bottom - B.top) * 0.05;
    const g = ctx.createLinearGradient(0, hz.y, 0, hz.y + band);
    g.addColorStop(0, BEACH.sea.haze);
    g.addColorStop(1, "rgba(191, 230, 241, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(B.left - 2, hz.y - 0.5, B.right - B.left + 4, band);
  }
  // the foam: wavy lines across, each a little out to sea
  ctx.strokeStyle = BEACH.sea.foam;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let w = 0; w < tune.waves.length; w++) {
    const y0 = S + tune.waves[w];
    ctx.lineWidth = (w === 0 ? 2.6 : 1.6) / kx;
    ctx.beginPath();
    let pen = false;
    for (let x = -60; x <= 60; x += 0.5) {
      const y =
        y0 +
        Math.sin((x / tune.waveLen) * Math.PI * 2 + w * 1.7) *
          tune.waveAmp *
          (w === 0 ? 1 : 0.6);
      const p = project(cam, x, y, 0);
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    ctx.stroke();
  }
}

// An umbrella: a pole and a canopy in gores of two colours.
function umbrella(ctx, at, u, kx) {
  const s = at.s;
  const h = u.h * s,
    r = u.r * s;
  if (h * kx < 4) return;
  const w = inkFor(h, kx);
  const { x, y } = at;
  inked(
    ctx,
    () => ctx.rect(x - s * 0.025, y - h, s * 0.05, h),
    BEACH.pole,
    "#16130f",
    w,
  );
  const top = y - h - r * 0.42,
    rim = y - h + r * 0.06;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = x - r + (2 * r * i) / n,
      b = x - r + (2 * r * (i + 1)) / n;
    ctx.fillStyle = BEACH.umbrella[(u.c + (i % 2)) % BEACH.umbrella.length];
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(a, rim);
    ctx.quadraticCurveTo((a + b) / 2, rim + r * 0.1, b, rim);
    ctx.closePath();
    ctx.fill();
  }
  inked(
    ctx,
    () => {
      ctx.moveTo(x - r, rim);
      ctx.quadraticCurveTo(x - r * 0.75, top - r * 0.05, x, top);
      ctx.quadraticCurveTo(x + r * 0.75, top - r * 0.05, x + r, rim);
      for (let i = n; i > 0; i--) {
        const a = x - r + (2 * r * i) / n,
          b = x - r + (2 * r * (i - 1)) / n;
        ctx.quadraticCurveTo((a + b) / 2, rim + r * 0.1, b, rim);
      }
      ctx.closePath();
    },
    null,
    "#16130f",
    w,
  );
}

function towel(ctx, cam, t) {
  const n = 4;
  for (let i = 0; i < n; i++) {
    const y0 = t.y - t.l / 2 + (t.l * i) / n,
      y1 = y0 + t.l / n;
    groundRect(
      ctx,
      cam,
      t.x - t.w / 2,
      y0,
      t.x + t.w / 2,
      y1,
      BEACH.towel[(t.c + (i % 2)) % BEACH.towel.length],
    );
  }
}

// Dune grass: a few blades in tufts beside the pitch.
function tufts(ctx, cam, kx, B, nearest) {
  ctx.strokeStyle = BEACH.grass;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (tune.grassFrom + hash(i * 17 + 3) * 6);
    const y = -6 + hash(i * 29 + 7) * 15;
    if (y > BEACH.shore - 2.4) continue;
    const at = standAt(cam, x, y, B, nearest, 0.5);
    if (!at) continue;
    const h = at.s * (0.28 + hash(i * 41) * 0.2);
    if (h * kx < 2) continue;
    ctx.lineWidth = Math.max(1, h * kx * 0.08) / kx;
    for (let b = -2; b <= 2; b++) {
      ctx.moveTo(at.x + b * h * 0.05, at.y);
      ctx.lineTo(at.x + b * h * 0.32, at.y - h * (1 - Math.abs(b) * 0.15));
    }
  }
  ctx.stroke();
}

function sail(ctx, cam, kx, B) {
  const t = tune.sail;
  const at = standAt(cam, t.x, t.y, B, 0, 8);
  if (!at) return;
  const s = at.s * t.h;
  if (s * kx < 4) return;
  const w = inkFor(s, kx) * 0.7;
  inked(
    ctx,
    () => {
      ctx.moveTo(at.x - s * 0.35, at.y - s * 0.1);
      ctx.lineTo(at.x + s * 0.35, at.y - s * 0.1);
      ctx.lineTo(at.x + s * 0.25, at.y + s * 0.02);
      ctx.lineTo(at.x - s * 0.25, at.y + s * 0.02);
      ctx.closePath();
    },
    BEACH.hull,
    "#16130f",
    w,
  );
  inked(
    ctx,
    () => {
      ctx.moveTo(at.x, at.y - s * 0.12);
      ctx.lineTo(at.x, at.y - s);
      ctx.lineTo(at.x + s * 0.32, at.y - s * 0.16);
      ctx.closePath();
    },
    BEACH.sail,
    "#16130f",
    w,
  );
}

function drawThings(ctx, cam, kx, B) {
  const nearest = middleDepth(cam);
  sail(ctx, cam, kx, B);
  for (const t of tune.towels) towel(ctx, cam, t);
  tufts(ctx, cam, kx, B, nearest);
  for (const u of farToNear(cam, tune.umbrellas)) {
    const at = standAt(cam, u.x, u.y, B, nearest, 3);
    if (at) umbrella(ctx, at, u, kx);
  }
}

const GROUNDS = { sand: BEACH.ground };

export function makeBeach({ reduced = false } = {}) {
  return {
    id: "beach",
    skin: null, // the day's controls
    reduced,
    // the engine decides the ground (sand); another one (a match from before 0.14)
    // keeps the day's paint for it under this sky
    groundOf: (surface) => GROUNDS[surface] || GROUNDS.sand,
    setOf: daySetOf,
    light: DAYLIGHT,
    paint: DAY_PAINT,
    clearing: null,
    cone: BEACH.cone,
    sky: drawSky,
    beyond: drawSea,
    scenery: drawThings,
    makeFx: () =>
      new Impacts({ style: "puff", reduced, colors: { puff: BEACH.puff } }),
    afterPieces: (ctx, cam, kx, B, scene) => scene.fx?.draw(ctx, cam, kx),
  };
}
