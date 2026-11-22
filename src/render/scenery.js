// What stands round a pitch in the outdoor scenes (src/render/beach.js, minnesota.js,
// tournament.js): a sky with a horizon, ground beyond the rough (the sea), and flat
// cartoon things on the ground (trees, umbrellas, scoreboards, cones), each
// drawn as a picture standing upright at its place and scaled by its distance, with
// the game's ink line. A look only: none of it is in the physics.
//
// Every helper works in the 400 x 240 frame drawWorld draws in (src/render/world.js),
// with `kx` its scale (frame px to CSS px), so a line `w` CSS px wide is `w / kx`.
import { project, projectPoly } from "./camera.js";

export const tune = {
  ink: 3, // CSS px, the ink line of a thing seen up close (the 1.0 system's line)
  inkMin: 1, // CSS px, never thinner
  inkPerM: 0.045, // its line, CSS px for every CSS px a metre of it is tall
};

// ---------- small helpers ----------

export function hash(n) {
  n = n ^ 61 ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

export function polyPath(ctx, flat) {
  ctx.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) ctx.lineTo(flat[i], flat[i + 1]);
  ctx.closePath();
}

// A rectangle of ground, filled.
export function groundRect(ctx, cam, x0, y0, x1, y1, color) {
  const p = projectPoly(cam, [x0, x1, x1, x0], [y0, y0, y1, y1], null, 4);
  if (p.length < 6) return false;
  ctx.fillStyle = color;
  ctx.beginPath();
  polyPath(ctx, p);
  ctx.fill();
  return true;
}

// Thin lines on the ground: [[x0, y0, x1, y1], ...], each cut into pieces a metre
// long so the near plane clips them right.
export function groundLines(ctx, cam, segs, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segs) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
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

// Where the ground meets the sky on the screen: { y, slope } in frame px (a line
// through x = cam.cx), or null when the camera looks straight down.
export function horizon(cam) {
  const hl = Math.hypot(cam.fx, cam.fy);
  if (hl < 0.05) return null;
  const far = 2000;
  const hx = cam.fx / hl,
    hy = cam.fy / hl;
  const cx = cam.px + hx * far,
    cy = cam.py + hy * far;
  const a = project(cam, cx + hy * far, cy - hx * far, 0);
  const b = project(cam, cx - hy * far, cy + hx * far, 0);
  if (!a || !b || Math.abs(b[0] - a[0]) < 1) return null;
  const slope = (b[1] - a[1]) / (b[0] - a[0]);
  return { y: a[1] + (cam.cx - a[0]) * slope, slope };
}

// A sky from `top` at the frame's top to `low` at the horizon, over the whole frame.
export function skyGradient(ctx, cam, B, top, low) {
  const hz = horizon(cam);
  const y1 = hz ? Math.max(B.top + 1, hz.y) : B.bottom;
  const g = ctx.createLinearGradient(0, B.top, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, low);
  ctx.fillStyle = g;
  ctx.fillRect(
    B.left - 2,
    B.top - 2,
    B.right - B.left + 4,
    B.bottom - B.top + 4,
  );
  return hz;
}

// The depth along the camera of the pitch's middle: things nearer the camera than
// it are left out (in the wide view they would stand between the camera and the
// pitch), so whatever is drawn is behind what the pitch shows.
export function middleDepth(cam) {
  return (0 - cam.px) * cam.fx + (4 - cam.py) * cam.fy + (0 - cam.pz) * cam.fz;
}

// A thing standing at (x, y) on the ground: its foot on the screen and the frame px a
// metre is there ({ x, y, s, d }), or null when it is behind the camera, nearer than
// `nearest` along it, or wholly off the frame for a thing `size` metres across.
export function standAt(cam, x, y, B, nearest = 0, size = 4) {
  const p = project(cam, x, y, 0);
  if (!p || p[2] < nearest) return null;
  const s = cam.f / p[2];
  const r = size * s;
  if (
    p[0] + r < B.left ||
    p[0] - r > B.right ||
    p[1] - r * 2 > B.bottom ||
    p[1] + r < B.top
  )
    return null;
  return { x: p[0], y: p[1], s, d: p[2] };
}

// The ink line for a thing `tall` frame px high at scale kx, in frame px.
export function inkFor(tall, kx) {
  const css = Math.min(
    tune.ink,
    Math.max(tune.inkMin, tall * kx * tune.inkPerM),
  );
  return css / kx;
}

// Fill then ink a path made by `path()`.
export function inked(ctx, path, fill, ink, w) {
  ctx.beginPath();
  path();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (ink && w > 0) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = ink;
    ctx.lineWidth = w;
    ctx.stroke();
  }
}

// Things sorted far to near, so nearer ones are drawn over farther ones.
export function farToNear(cam, things) {
  return things
    .map((t) => ({
      t,
      d: (t.x - cam.px) * cam.fx + (t.y - cam.py) * cam.fy - cam.pz * cam.fz,
    }))
    .sort((a, b) => b.d - a.d)
    .map((e) => e.t);
}

// ---------- things ----------

// A pine: a trunk and three stacked tiers, snow on each tier's top when `snow`.
export function pine(ctx, at, h, kx, c) {
  const s = at.s * h; // its height in frame px
  if (s * kx < 3) return;
  const w = inkFor(s, kx);
  const { x, y } = at;
  const tw = s * 0.07;
  inked(
    ctx,
    () => ctx.rect(x - tw, y - s * 0.16, tw * 2, s * 0.16),
    c.trunk,
    c.ink,
    w,
  );
  for (let i = 0; i < 3; i++) {
    const base = y - s * (0.12 + i * 0.26);
    const top = base - s * 0.42;
    const half = s * (0.3 - i * 0.07);
    inked(
      ctx,
      () => {
        ctx.moveTo(x - half, base);
        ctx.lineTo(x, top);
        ctx.lineTo(x + half, base);
        ctx.closePath();
      },
      c.leaf,
      c.ink,
      w,
    );
    if (c.snow) {
      inked(
        ctx,
        () => {
          ctx.moveTo(x - half * 0.48, top + (base - top) * 0.48);
          ctx.lineTo(x, top);
          ctx.lineTo(x + half * 0.48, top + (base - top) * 0.48);
          ctx.lineTo(x + half * 0.2, top + (base - top) * 0.4);
          ctx.lineTo(x, top + (base - top) * 0.52);
          ctx.lineTo(x - half * 0.2, top + (base - top) * 0.4);
          ctx.closePath();
        },
        c.snow,
        null,
        0,
      );
    }
  }
}

// A bare birch: a pale trunk with dark marks and a few bare branches.
export function birch(ctx, at, h, kx, c, seed = 1) {
  const s = at.s * h;
  if (s * kx < 3) return;
  const w = inkFor(s, kx);
  const { x, y } = at;
  const tw = s * 0.035;
  ctx.lineCap = "round";
  // the branches, in ink, under the trunk
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = Math.max(w * 0.8, s * 0.012);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const v = 0.45 + i * 0.11;
    const side = i % 2 ? 1 : -1;
    const len = s * (0.22 - i * 0.03) * (0.8 + hash(seed * 7 + i) * 0.4);
    const bx = x,
      by = y - s * v;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + side * len, by - len * 0.75);
    ctx.moveTo(bx + side * len * 0.55, by - len * 0.4);
    ctx.lineTo(bx + side * len * 0.75, by - len * 0.85);
  }
  ctx.stroke();
  inked(ctx, () => ctx.rect(x - tw, y - s, tw * 2, s), c.bark, c.ink, w);
  ctx.fillStyle = c.ink;
  for (let i = 0; i < 6; i++) {
    const v = 0.1 + i * 0.14 + hash(seed * 13 + i) * 0.05;
    ctx.fillRect(
      x - tw * (hash(seed + i) > 0.5 ? 1 : 0.2),
      y - s * v,
      tw * 0.9,
      s * 0.012,
    );
  }
}

// A traffic cone (the Kid line's ends): orange with a white band.
export function cone(ctx, at, kx, c) {
  const s = at.s * 0.3;
  if (s * kx < 3) return;
  const w = inkFor(s * 3, kx);
  const { x, y } = at;
  inked(
    ctx,
    () => ctx.ellipse(x, y, s * 0.42, s * 0.12, 0, 0, Math.PI * 2),
    c.cone,
    c.ink,
    w,
  );
  inked(
    ctx,
    () => {
      ctx.moveTo(x - s * 0.3, y);
      ctx.lineTo(x - s * 0.06, y - s);
      ctx.lineTo(x + s * 0.06, y - s);
      ctx.lineTo(x + s * 0.3, y);
      ctx.closePath();
    },
    c.cone,
    c.ink,
    w,
  );
  ctx.fillStyle = c.band;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.21, y - s * 0.38);
  ctx.lineTo(x - s * 0.15, y - s * 0.6);
  ctx.lineTo(x + s * 0.15, y - s * 0.6);
  ctx.lineTo(x + s * 0.21, y - s * 0.38);
  ctx.closePath();
  ctx.fill();
}
