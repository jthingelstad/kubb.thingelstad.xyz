// The night scene (a prototype, ?scene=night only; src/render/scenes.js):
// a pitch in a moonlit clearing under the stars. Its lines and stakes glow,
// it plays with the glowing set (kubbs pale aqua, the king gold), the batons
// stay plain wood lit by the moon, and the throws leave stardust
// (src/render/stardust.js).
//
// Everything here is data plus the hooks drawWorld calls (src/render/world.js):
//   groundOf, setOf, light, paint, clearing   data
//   sky        the night sky over the whole frame, before the ground
//   rough      the clearing round the pitch (the ground ends at its rim, so
//              the sky shows past it: the cameras look down and never see a
//              true horizon)
//   lightGround the moon's pool on the ground, before the lines
//   lines      the lines' glow, then their core
//   beforePieces the glowing pieces' light on the ground and round them
//   baton      a plain baton by moonlight
//   afterPieces the stardust (scene.fx), additive, over the pieces
// scene.time (s) drives the twinkle; the scene's `reduced` drops it.
import { project, projectPoly } from "./camera.js";
import { NIGHT } from "./palette.js";
import { drawGlow, newCanvas } from "./glow.js";

// ---------- numbers ----------

export const tune = {
  // the clearing: the ground ends this far round the pitch (m)
  clearing: { x0: -6.5, x1: 6.5, y0: -7, y1: 10.6 },
  rimStep: 0.22, // m between the rim's silhouette points
  rimLow: 0.03, // m, the rim's tufts
  rimHigh: 0.13,
  rimClump: 0.3, // the occasional bush
  // the moon as seen (its direction: from down the pitch, a little left,
  // low enough to be in the aiming view's sky) and as a light (higher, so
  // shadows fall toward the thrower and a little right)
  moonAz: -4.5, // degrees from +y toward -x
  moonEl: -12.4, // degrees (the sky is drawn past the clearing's rim)
  moonR: 0.011, // radians
  lightX: -0.1, // the light's direction, toward the moon: x, y per metre up
  lightY: 0.62,
  stars: 5200,
  milky: 0.38, // the share of stars in the milky band
  twinkleShare: 0.025,
  skyLowAt: -3, // deg: where the sky's gradient ends
  vignette: false,
  // the lines' bloom: the core drawn with a blur of its own colour round it
  // (CSS px; canvas shadows are a true soft blur, so no hard-edged bands)
  // the bloom bands: [width on the ground m, alpha, least CSS px]
  lineBands: [
    [0.2, 0.05, 7],
    [0.12, 0.08, 4.5],
    [0.07, 0.12, 2.6],
  ],
  lineBlur: 0, // CSS px, the core's own soft edge
  lineCore: 0.016,
  lineCoreMin: 0.65,
};

// ---------- helpers ----------

function hash(n) {
  n = n ^ 61 ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
const deg = Math.PI / 180;
function dirOf(azDeg, elDeg) {
  const az = azDeg * deg,
    el = elDeg * deg;
  return [
    Math.sin(az) * Math.cos(el),
    Math.cos(az) * Math.cos(el),
    Math.sin(el),
  ];
}
// A direction (at infinity) in frame px, or null when behind.
function projectDir(cam, dx, dy, dz, out) {
  const d = dx * cam.fx + dy * cam.fy + dz * cam.fz;
  if (d < 0.05) return false;
  const s = cam.f / d;
  out[0] = cam.cx + s * (dx * cam.rx + dy * cam.ry + dz * cam.rz);
  out[1] = cam.cy - s * (dx * cam.ux + dy * cam.uy + dz * cam.uz);
  return true;
}
function polyPath(ctx, flat) {
  ctx.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  ctx.closePath();
}

// ---------- the sky ----------

// The stars: directions on the sphere (a band below the horizon too: the sky
// shows past the clearing's rim), brightness, colour and twinkle, made once.
let STARS = null;
function stars() {
  if (STARS) return STARS;
  const n = tune.stars;
  const dir = new Float32Array(3 * n),
    mag = new Float32Array(n),
    col = new Uint8Array(n),
    tw = new Float32Array(n); // 0: steady, else the twinkle's rate (rad/s)
  // the milky band: a great circle through the aiming view's sky and the
  // wide view's
  const a = [0, 1, -0.21],
    b = [-1, 0.25, -0.46];
  let nx = a[1] * b[2] - a[2] * b[1],
    ny = a[2] * b[0] - a[0] * b[2],
    nz = a[0] * b[1] - a[1] * b[0];
  const nl = Math.hypot(nx, ny, nz);
  nx /= nl;
  ny /= nl;
  nz /= nl;
  // two axes in the band's plane
  const al = Math.hypot(...a);
  const u = [a[0] / al, a[1] / al, a[2] / al];
  const v = [
    ny * u[2] - nz * u[1],
    nz * u[0] - nx * u[2],
    nx * u[1] - ny * u[0],
  ];
  for (let i = 0; i < n; i++) {
    let x, y, z;
    if (hash(i * 7 + 3) < tune.milky) {
      const t = hash(i * 11 + 1) * Math.PI * 2;
      // gaussian-ish spread off the band
      const off =
        (hash(i * 13 + 2) + hash(i * 17 + 5) + hash(i * 19 + 7) - 1.5) * 0.22;
      x = u[0] * Math.cos(t) + v[0] * Math.sin(t) + nx * off;
      y = u[1] * Math.cos(t) + v[1] * Math.sin(t) + ny * off;
      z = u[2] * Math.cos(t) + v[2] * Math.sin(t) + nz * off;
      mag[i] = 0.15 + 0.5 * Math.pow(hash(i * 23 + 9), 3);
    } else {
      z = -0.75 + hash(i * 29 + 4) * 1.7;
      if (z > 1) z = 1;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const t = hash(i * 31 + 6) * Math.PI * 2;
      x = r * Math.cos(t);
      y = r * Math.sin(t);
      mag[i] = 0.12 + 0.88 * Math.pow(hash(i * 37 + 8), 5);
    }
    const l = Math.hypot(x, y, z);
    dir[3 * i] = x / l;
    dir[3 * i + 1] = y / l;
    dir[3 * i + 2] = z / l;
    col[i] = (hash(i * 41 + 3) * 4) | 0;
    tw[i] =
      hash(i * 43 + 1) < tune.twinkleShare
        ? (Math.PI * 2) / (3 + hash(i * 47 + 2) * 4)
        : 0;
  }
  STARS = { n, dir, mag, col, tw, band: [u, v] };
  return STARS;
}

const pt = [0, 0];
let VIS = null;
function visible(n) {
  if (!VIS || VIS.i.length < n)
    VIS = {
      i: new Int32Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
    };
  return VIS;
}
const MOON = dirOf(tune.moonAz, tune.moonEl);

function skyBody(ctx, cam, kx, B, scene, part) {
  if (part === TWINKLE)
    return twinklers(ctx, cam, kx, B, stars(), scene.time || 0, part);
  const S = NIGHT.sky;
  // the gradient: deep overhead, a little lighter down at the rim
  // (a direction a little under the horizon, so the sky is the same wherever
  // the eye stands: only where it looks moves the stars)
  const hl = Math.hypot(cam.fx, cam.fy) || 1;
  const dip = tune.skyLowAt * deg;
  const low = projectDir(
    cam,
    (cam.fx / hl) * Math.cos(dip),
    (cam.fy / hl) * Math.cos(dip),
    Math.sin(dip),
    pt,
  );
  const y1 = low ? Math.min(B.bottom, Math.max(B.top + 20, pt[1])) : B.bottom;
  const grd = ctx.createLinearGradient(0, B.top, 0, y1);
  grd.addColorStop(0, S.top);
  grd.addColorStop(0.6, S.mid);
  grd.addColorStop(1, S.low);
  ctx.fillStyle = grd;
  ctx.fillRect(
    B.left - 2,
    B.top - 2,
    B.right - B.left + 4,
    B.bottom - B.top + 4,
  );

  const st = stars();
  const t = scene.time || 0;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // the milky band's haze, a row of faint glows along it
  const [u, v] = st.band;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const dx = u[0] * Math.cos(a) + v[0] * Math.sin(a),
      dy = u[1] * Math.cos(a) + v[1] * Math.sin(a),
      dz = u[2] * Math.cos(a) + v[2] * Math.sin(a);
    if (!projectDir(cam, dx, dy, dz, pt)) continue;
    const r = 0.12 * cam.f;
    if (pt[0] + r < B.left || pt[0] - r > B.right) continue;
    if (pt[1] + r < B.top || pt[1] - r > B.bottom) continue;
    drawGlow(ctx, pt[0], pt[1], r * 1.3, r * 0.7, NIGHT.milky, 0.075);
  }
  // the stars: those in view found once, then the steady ones in a few
  // batches (colour by brightness), twinklers and bright ones alone
  const cols = NIGHT.star;
  const minR = 0.45 / kx;
  let nv = 0;
  const V = visible(st.n);
  for (let i = 0; i < st.n; i++) {
    if (
      !projectDir(cam, st.dir[3 * i], st.dir[3 * i + 1], st.dir[3 * i + 2], pt)
    )
      continue;
    if (pt[0] < B.left || pt[0] > B.right || pt[1] < B.top || pt[1] > B.bottom)
      continue;
    V.i[nv] = i;
    V.x[nv] = pt[0];
    V.y[nv] = pt[1];
    nv++;
  }
  for (let c = 0; c < 4; c++) {
    for (let band = 0; band < 3; band++) {
      ctx.fillStyle = cols[c];
      ctx.globalAlpha = [0.38, 0.65, 0.95][band];
      ctx.beginPath();
      let any = false;
      for (let v = 0; v < nv; v++) {
        const i = V.i[v];
        if (st.col[i] !== c || st.tw[i]) continue;
        const m = st.mag[i];
        if ((m < 0.3 ? 0 : m < 0.6 ? 1 : 2) !== band) continue;
        const r = Math.max(minR, (0.35 + 1.3 * m * m) / kx);
        ctx.rect(V.x[v] - r, V.y[v] - r, r * 2, r * 2);
        any = true;
      }
      if (any) ctx.fill();
    }
  }
  twinklers(ctx, cam, kx, B, st, t, part, nv);
  // the full moon, its halo, then the disc
  if (projectDir(cam, MOON[0], MOON[1], MOON[2], pt)) {
    const R = tune.moonR * cam.f;
    const M = NIGHT.moon;
    drawGlow(ctx, pt[0], pt[1], R * 9, R * 9, M.halo, 0.22);
    drawGlow(ctx, pt[0], pt[1], R * 3.2, R * 3.2, M.halo, 0.35);
    ctx.globalCompositeOperation = "source-over";
    const g = ctx.createRadialGradient(
      pt[0] - R * 0.2,
      pt[1] - R * 0.2,
      R * 0.1,
      pt[0],
      pt[1],
      R,
    );
    g.addColorStop(0, M.face);
    g.addColorStop(0.8, M.face);
    g.addColorStop(1, M.limb);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pt[0], pt[1], R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = M.mare;
    ctx.globalAlpha = 0.55;
    for (const [ox, oy, rx, ry] of [
      [-0.3, -0.25, 0.28, 0.22],
      [0.18, -0.35, 0.2, 0.16],
      [0.05, 0.1, 0.32, 0.2],
      [-0.25, 0.38, 0.16, 0.12],
      [0.42, 0.2, 0.12, 0.1],
    ]) {
      ctx.beginPath();
      ctx.ellipse(
        pt[0] + ox * R,
        pt[1] + oy * R,
        rx * R,
        ry * R,
        0.4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// The stars drawn alone: the bright ones (part STEADY or ALL) and those that
// twinkle (TWINKLE or ALL). nv: the stars in view already found, or recount.
function twinklers(ctx, cam, kx, B, st, t, part, nv = -1) {
  const V = visible(st.n);
  if (nv < 0) {
    if (part === TWINKLE) ctx.save();
    if (part === TWINKLE) ctx.globalCompositeOperation = "lighter";
    nv = 0;
    for (let i = 0; i < st.n; i++) {
      if (!st.tw[i]) continue;
      const d = 3 * i;
      if (!projectDir(cam, st.dir[d], st.dir[d + 1], st.dir[d + 2], pt))
        continue;
      if (
        pt[0] < B.left ||
        pt[0] > B.right ||
        pt[1] < B.top ||
        pt[1] > B.bottom
      )
        continue;
      V.i[nv] = i;
      V.x[nv] = pt[0];
      V.y[nv] = pt[1];
      nv++;
    }
  }
  const cols = NIGHT.star;
  ctx.globalAlpha = 1;
  for (let v = 0; v < nv; v++) {
    const i = V.i[v];
    const m = st.mag[i];
    if (!st.tw[i] && m < 0.7) continue;
    if (part !== ALL && !st.tw[i] !== (part === STEADY)) continue;
    const tw = st.tw[i] ? 0.55 + 0.45 * Math.sin(t * st.tw[i] + i) : 1;
    const r = (0.6 + 1.8 * m) / kx;
    drawGlow(
      ctx,
      V.x[v],
      V.y[v],
      r * 2.6,
      r * 2.6,
      cols[st.col[i]],
      0.55 * tw,
      true,
    );
  }
  if (part === TWINKLE) ctx.restore();
}

// The sky. Still, it is drawn once into a canvas of its own and stamped each
// frame, with only the twinkling stars drawn live: a frame of the aim, the
// pitch at rest and most of the wide view's are the same sky. The camera
// moving draws it straight.
const ALL = 0,
  STEADY = 1,
  TWINKLE = 2;
const SKY = { key: "", seen: 0, canvas: null, rows: 0 };
function skyRows(cam, t, H) {
  let low = -Infinity;
  for (const [x, y] of [
    [C.x0, C.y0],
    [C.x1, C.y0],
    [C.x0, C.y1],
    [C.x1, C.y1],
  ]) {
    const p = project(cam, x, y, 0);
    if (!p) return H; // a corner behind the eye: the whole frame
    low = Math.max(low, p[1]);
  }
  return Math.max(0, Math.min(H, Math.ceil(t.d * low + t.f + 8)));
}

function drawSky(ctx, cam, kx, B, G, scene, reduced) {
  const look = reduced ? { ...scene, time: 0 } : scene;
  const t = ctx.getTransform ? ctx.getTransform() : null;
  const cv = ctx.canvas;
  if (!t || !cv || !cv.width) return skyBody(ctx, cam, kx, B, look, ALL);
  // stars and moon are at infinity: the eye's place is not in the key
  const key = [
    cam.fx,
    cam.fy,
    cam.fz,
    cam.ux,
    cam.uy,
    cam.uz,
    cam.f,
    cam.cx,
    cam.cy,
    B.left,
    B.top,
    B.right,
    B.bottom,
    t.a,
    t.b,
    t.c,
    t.d,
    t.e,
    t.f,
    cv.width,
    cv.height,
  ].join();
  if (key !== SKY.key) {
    SKY.key = key;
    SKY.seen = 0;
    return skyBody(ctx, cam, kx, B, look, ALL);
  }
  if (SKY.seen++ === 0) {
    if (
      !SKY.canvas ||
      SKY.canvas.width !== cv.width ||
      SKY.canvas.height !== cv.height
    )
      SKY.canvas = newCanvas(cv.width, cv.height);
    const g = SKY.canvas?.getContext("2d");
    if (!g) return skyBody(ctx, cam, kx, B, look, ALL);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(t);
    skyBody(g, cam, kx, B, look, STEADY);
  }
  // only the rows the sky can show: down to the clearing's lowest corner
  if (SKY.seen === 1) SKY.rows = skyRows(cam, t, cv.height);
  if (SKY.rows > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const w = cv.width,
      h = SKY.rows;
    ctx.drawImage(SKY.canvas, 0, 0, w, h, 0, 0, w, h);
    ctx.restore();
  }
  if (!reduced) skyBody(ctx, cam, kx, B, look, TWINKLE);
}

// ---------- the clearing ----------

const C = tune.clearing;
function rectPoly(cam, x0, y0, x1, y1) {
  return projectPoly(cam, [x0, x1, x1, x0], [y0, y0, y1, y1], null, 4);
}
// the rim's silhouette, one strip per side: along the side on the ground,
// back along its tufts (made once)
let RIM = null;
function rim() {
  if (RIM) return RIM;
  const sides = [
    [C.x0, C.y1, C.x1, C.y1],
    [C.x1, C.y1, C.x1, C.y0],
    [C.x1, C.y0, C.x0, C.y0],
    [C.x0, C.y0, C.x0, C.y1],
  ];
  RIM = sides.map(([x0, y0, x1, y1], si) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(len / tune.rimStep);
    const xs = [],
      ys = [],
      zs = [];
    for (let i = 0; i <= n; i++) {
      xs.push(x0 + ((x1 - x0) * i) / n);
      ys.push(y0 + ((y1 - y0) * i) / n);
      zs.push(0);
    }
    for (let i = n; i >= 0; i--) {
      const h0 = hash(si * 997 + i * 13);
      const clump = hash(si * 991 + ((i / 5) | 0) * 7) > 0.8;
      const h = clump
        ? tune.rimHigh +
          (tune.rimClump - tune.rimHigh) *
            Math.sin(((i % 5) / 4) * Math.PI) *
            (0.6 + 0.4 * h0)
        : tune.rimLow + (tune.rimHigh - tune.rimLow) * h0 * h0;
      xs.push(x0 + ((x1 - x0) * i) / n);
      ys.push(y0 + ((y1 - y0) * i) / n);
      zs.push(h);
    }
    return { xs, ys, zs };
  });
  return RIM;
}

const tones = new Map();
function edgeTones(G) {
  let t = tones.get(G);
  if (!t) {
    t = [0, 0.3, 0.52, 0.7, 0.84, 0.94, 1].map((u) => mix(G.edge, G.rough, u));
    tones.set(G, t);
  }
  return t;
}

function drawRough(ctx, cam, kx, B, G) {
  const T = edgeTones(G);
  const insets = [0, 0.25, 0.55, 0.9, 1.35, 1.9, 2.6];
  for (let i = 0; i < insets.length; i++) {
    const d = insets[i];
    const p = rectPoly(cam, C.x0 + d, C.y0 + d, C.x1 - d, C.y1 - d);
    if (p.length < 6) continue;
    ctx.fillStyle = T[i];
    ctx.beginPath();
    polyPath(ctx, p);
    ctx.fill();
  }
  ctx.fillStyle = G.rim;
  ctx.beginPath();
  for (const r of rim()) {
    const p = projectPoly(cam, r.xs, r.ys, r.zs, r.xs.length);
    if (p.length >= 6) polyPath(ctx, p);
  }
  ctx.fill();
}

// The moon's pool: the frame's middle lit, its edges falling into the dark.
let VIGNETTE = null;
function drawLightGround(ctx, cam, kx, B) {
  // a small canvas of the gradient, stretched: a smooth fall scales cleanly
  // and costs a stamp, not a full-frame gradient
  if (VIGNETTE === null) {
    const N = 128;
    VIGNETTE = newCanvas(N, N) || false;
    const g = VIGNETTE && VIGNETTE.getContext("2d");
    if (g) {
      const r = N * 0.62 * Math.SQRT2;
      const grd = g.createRadialGradient(
        N / 2,
        N * 0.6,
        r * 0.25,
        N / 2,
        N * 0.6,
        r,
      );
      grd.addColorStop(0, "rgba(0, 0, 0, 0)");
      grd.addColorStop(1, NIGHT.vignette);
      g.fillStyle = grd;
      g.fillRect(0, 0, N, N);
    } else VIGNETTE = false;
  }
  const x = B.left - 2,
    y = B.top - 2,
    w = B.right - B.left + 4,
    h = B.bottom - B.top + 4;
  if (VIGNETTE) return ctx.drawImage(VIGNETTE, x, y, w, h);
  const cx = (B.left + B.right) / 2,
    cy = (B.top + B.bottom) / 2 + (B.bottom - B.top) * 0.1;
  const r = Math.hypot(B.right - B.left, B.bottom - B.top) * 0.62;
  const g = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
  g.addColorStop(0, "rgba(0, 0, 0, 0)");
  g.addColorStop(1, NIGHT.vignette);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// ---------- the lines ----------

function drawLines(ctx, cam, kx, segs, G, paintLines) {
  // the bloom: a few wider bands on the ground, added (a glow on the grass,
  // wider near the thrower as the line is), then the core with one small
  // blurred shadow. A canvas shadow costs by its radius: one wide blur over
  // every line doubled a frame's time on a software canvas, so the wide part
  // is the bands.
  const t = ctx.getTransform ? ctx.getTransform() : null;
  const dev = t ? Math.hypot(t.a, t.b) / kx : 1;
  ctx.save();
  if (G.glowMode !== "source-over") ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < tune.lineBands.length; i++) {
    const [w, a, px] = tune.lineBands[i];
    ctx.globalAlpha = a;
    paintLines(ctx, cam, segs, G.glow, w, px / kx);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.shadowColor = G.glow;
  ctx.shadowBlur = tune.lineBlur * dev;
  paintLines(ctx, cam, segs, G.line, tune.lineCore, tune.lineCoreMin);
  ctx.restore();
}

// ---------- the pieces' light ----------

const HALO = {
  kubb: { foot: 0.26, body: 0.17, a: 0.5, b: 0.24 },
  king: { foot: 0.38, body: 0.28, a: 0.6, b: 0.3 },
  stake: { foot: 0.18, body: 0.12, a: 0.55, b: 0.3 },
};
function drawHalos(ctx, cam, kx, shown, projs, set) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const s of shown) {
    const it = s.item;
    const h = HALO[it.kind];
    if (!h) continue;
    const color =
      it.kind === "stake"
        ? NIGHT.stake.halo
        : it.kind === "king"
          ? (set?.kingWood || set?.wood)?.halo
          : set?.wood?.halo;
    if (!color) continue;
    const dx = it.x - cam.px,
      dy = it.y - cam.py,
      dz = -cam.pz;
    const d = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (d < 0.1) continue;
    const foot = project(cam, it.x, it.y, 0);
    if (foot) {
      const sc = cam.f / d;
      const dist = Math.hypot(dx, dy, dz);
      const squash = Math.max(0.18, Math.min(1, cam.pz / dist));
      const r = h.foot * sc;
      drawGlow(ctx, foot[0], foot[1], r, r * squash, color, h.a);
    }
    const c = project(cam, it.x, it.y, it.z);
    if (c) {
      const r = (h.body * cam.f) / c[2];
      drawGlow(ctx, c[0], c[1], r, r, color, h.b);
    }
  }
  ctx.restore();
}

// ---------- a baton by moonlight ----------

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
const LIGHT = (() => {
  const l = Math.hypot(tune.lightX, tune.lightY, 1);
  return [tune.lightX / l, tune.lightY / l, 1 / l];
})();

// Plain wood (no bands, as every baton): the body in moonlit wood, its side
// away from the moon in shade, a cold rim of moonlight on the lit side and
// the end that faces the camera showing its grain.
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
  const dc = (p1[2] + p2[2]) / 2;
  const tall = ((cam.f * 0.3) / dc) * kx;
  const ow = Math.min(3.4, Math.max(1, tall / 20)) / kx;
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
    return (sign * dot(a, v)) / Math.hypot(...v);
  };
  const c1 = cosEnd(E1, -1),
    c2 = cosEnd(E2, 1);
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
  const W = NIGHT.wood;
  ctx.lineJoin = "round";
  ctx.strokeStyle = NIGHT.ink;
  ctx.lineWidth = ow * 2;
  ctx.beginPath();
  body(r1, r2);
  cap(p1, r1, c1);
  cap(p2, r2, c2);
  ctx.stroke();
  ctx.fillStyle = W.light;
  ctx.beginPath();
  body(r1, r2);
  cap(p1, r1, c1);
  cap(p2, r2, c2);
  ctx.fill();
  // which screen side faces away from the moon
  const ld = dot(LIGHT, a);
  const nx = LIGHT[0] - a[0] * ld,
    ny = LIGHT[1] - a[1] * ld,
    nz = LIGHT[2] - a[2] * ld;
  const q = project(cam, it.x - nx * r, it.y - ny * r, it.z - nz * r);
  const m = project(cam, it.x, it.y, it.z);
  const side = q && m && (q[0] - m[0]) * px + (q[1] - m[1]) * py > 0 ? 1 : -1;
  ctx.fillStyle = W.shade;
  ctx.beginPath();
  ctx.moveTo(p1[0] + px * side * r1 * 0.1, p1[1] + py * side * r1 * 0.1);
  ctx.lineTo(p2[0] + px * side * r2 * 0.1, p2[1] + py * side * r2 * 0.1);
  ctx.lineTo(p2[0] + px * side * r2, p2[1] + py * side * r2);
  ctx.lineTo(p1[0] + px * side * r1, p1[1] + py * side * r1);
  ctx.closePath();
  ctx.fill();
  // the moon's rim on the lit side
  ctx.strokeStyle = W.rim;
  ctx.lineWidth = Math.max(ow * 0.5, r1 * 0.14);
  ctx.globalAlpha = 0.55;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p1[0] - px * side * r1 * 0.62, p1[1] - py * side * r1 * 0.62);
  ctx.lineTo(p2[0] - px * side * r2 * 0.62, p2[1] - py * side * r2 * 0.62);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const [p, rr, c] = c2 > c1 ? [p2, r2, c2] : [p1, r1, c1];
  if (c > 0.02) {
    ctx.fillStyle = W.end;
    ctx.beginPath();
    cap(p, rr, c);
    ctx.fill();
    ctx.strokeStyle = NIGHT.ink;
    ctx.lineWidth = ow * 0.7;
    ctx.stroke();
    if (rr * kx > 6) {
      ctx.strokeStyle = W.ring;
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
    }
  }
}

// ---------- the stardust's numbers ----------

// The particle counts and lives (src/render/stardust.js); reduced: for
// prefers-reduced-motion, no trail, a little spin dust, small short puffs.
export function dustConfig(reduced = false) {
  const colors = [...NIGHT.dust, ...NIGHT.kingDust];
  const base = {
    cap: 900,
    colors,
    dust: [0, 1, 2, 3],
    king: [4, 5, 6, 7],
    gravity: 0.9, // m/s², dust drifts down slowly
    drag: 1.6, // 1/s
    trailFrom: 1.2, // m/s: the trail while the piece flies
    trailEvery: 0.028, // m of flight per particle
    trailMax: 16, // a frame
    trailLife: 0.8,
    trailSize: 0.011, // m
    spinFrom: 4, // rad/s
    spinRate: 6.5, // particles per radian turned (both ends)
    spinMax: 16,
    spinLife: 0.75,
    spinSize: 0.011,
    hitCount: 10,
    hitExtra: 24,
    knockCount: 5,
    knockExtra: 12,
    groundCount: 6,
    puffLife: 0.9,
    puffSize: 0.012,
    kingRing: 56,
    kingFountain: 40,
    kingLife: 1.5,
    flashFor: 0.7,
    flashSize: 0.8, // m
    flashAlpha: 0.55,
    flashColor: NIGHT.kingDust[0],
  };
  if (!reduced) return base;
  return {
    ...base,
    trailEvery: 0, // no trail
    spinRate: 0.6,
    spinLife: 0.3,
    hitCount: 6,
    hitExtra: 6,
    knockCount: 2,
    knockExtra: 3,
    groundCount: 2,
    puffLife: 0.4,
    kingRing: 16,
    kingFountain: 0,
    kingLife: 0.7,
    flashAlpha: 0.25,
  };
}

// ---------- the scene ----------

const GROUNDS = {
  grass: NIGHT.grounds.grass,
  sand: NIGHT.grounds.sand,
  snow: { ...NIGHT.grounds.snow, glowMode: "source-over" },
};
// The glowing set: a body paint, not bands (src/render/world.js drawBox).
export const GLOW_SET = {
  name: "Glowing",
  wood: NIGHT.glow,
  kingWood: NIGHT.glowKing,
  kingMark: NIGHT.glowKing.mark,
};

export function makeNight({ reduced = false } = {}) {
  const lx = tune.lightX,
    ly = tune.lightY;
  return {
    id: "night",
    skin: NIGHT.skin,
    reduced,
    set: "glow",
    groundOf: (surface) => GROUNDS[surface] || GROUNDS.grass,
    setOf: () => GLOW_SET,
    light: {
      shadowX: -lx * 0.9,
      shadowY: -ly * 0.9,
      L: LIGHT,
      awayBelow: -0.8,
      topAbove: 0.72,
      shadowFill: NIGHT.shadow,
      // soft shadows (a blurred canvas shadow, CSS px) cost a throttled
      // frame 10 ms: off, the shadows are the day's, fainter
      shadowBlur: 0,
    },
    paint: {
      wood: NIGHT.glow,
      stake: NIGHT.stake,
      ink: NIGHT.ink,
      kingMark: NIGHT.glowKing.mark,
    },
    clearing: tune.clearing,
    dust: dustConfig(reduced),
    sky: (ctx, cam, kx, B, G, scene) =>
      drawSky(ctx, cam, kx, B, G, scene, reduced),
    rough: drawRough,
    // the moon's pool: a full-frame stamp cost a throttled frame 8 ms; the
    // clearing's dark edge does most of its work, so it is off
    lightGround: tune.vignette ? drawLightGround : null,
    lines: drawLines,
    beforePieces: drawHalos,
    baton: drawBaton,
    afterPieces: (ctx, cam, kx, B, scene) => scene.fx?.draw(ctx, cam, kx),
  };
}
