// The core camera (vendor/core/camera.lua) in JavaScript, for drawing.
//
// A camera is the table of camera.new(): { px, py, pz, fx, fy, fz, rx, ry, rz,
// ux, uy, uz, f, cx, cy, lx, ly, lz }, made and moved by the Lua session. Its
// projection works in the Playdate's 400 x 240 frame. The web shows that
// frame scaled by k = min(W / 400, H / 240) and centred (DESIGN 4.1); a wider
// or taller canvas shows more of the same world round it, never bars.
//
// Frame coordinates (fx, fy) are the Lua's screen pixels; view coordinates
// are CSS pixels on the canvas: vx = ox + k fx, vy = oy + k fy.

export const SCREEN_W = 400;
export const SCREEN_H = 240;
export const NEAR = 0.05; // camera.tune.near

// The scale rule: { k, ox, oy } for a canvas of width x height CSS px.
export function frameScale(width, height) {
  const k = Math.min(width / SCREEN_W, height / SCREEN_H);
  return { k, ox: (width - SCREEN_W * k) / 2, oy: (height - SCREEN_H * k) / 2 };
}

// The part of the frame the canvas shows (frame coordinates; wider than
// 0..400 x 0..240 on a canvas of another shape).
export function frameBounds(width, height) {
  const { k, ox, oy } = frameScale(width, height);
  return {
    left: -ox / k,
    top: -oy / k,
    right: (width - ox) / k,
    bottom: (height - oy) / k,
  };
}

// camera.toView: right, up, depth.
export function toView(c, x, y, z) {
  const dx = x - c.px,
    dy = y - c.py,
    dz = z - c.pz;
  return [
    dx * c.rx + dy * c.ry + dz * c.rz,
    dx * c.ux + dy * c.uy + dz * c.uz,
    dx * c.fx + dy * c.fy + dz * c.fz,
  ];
}

// camera.project: [sx, sy, depth] in frame px, or null behind the near plane.
export function project(c, x, y, z) {
  const dx = x - c.px,
    dy = y - c.py,
    dz = z - c.pz;
  const d = dx * c.fx + dy * c.fy + dz * c.fz;
  if (d < NEAR) return null;
  const s = c.f / d;
  return [
    c.cx + s * (dx * c.rx + dy * c.ry + dz * c.rz),
    c.cy - s * (dx * c.ux + dy * c.uy + dz * c.uz),
    d,
  ];
}

// The same point in view (CSS) px: [vx, vy, depth], or null.
export function projectView(view, c, x, y, z) {
  const p = project(c, x, y, z);
  if (!p) return null;
  const { k, ox, oy } = frameScale(view.width, view.height);
  return [ox + k * p[0], oy + k * p[1], p[2]];
}

// A view (CSS px) point back to the frame.
export function viewToFrame(view, vx, vy) {
  const { k, ox, oy } = frameScale(view.width, view.height);
  return [(vx - ox) / k, (vy - oy) / k];
}

// Un-project a frame point onto the ground plane z = 0: { x, y } in metres,
// or null when the ray through it does not come down to the ground in front
// of the camera (at or above the horizon).
export function unproject(c, sx, sy) {
  const a = (sx - c.cx) / c.f;
  const b = -(sy - c.cy) / c.f;
  // the ray's direction: forward + a right + b up (depth 1 along the axis)
  const dx = c.fx + a * c.rx + b * c.ux;
  const dy = c.fy + a * c.ry + b * c.uy;
  const dz = c.fz + a * c.rz + b * c.uz;
  if (!(dz < -1e-9)) return null;
  const t = -c.pz / dz;
  if (t < NEAR) return null;
  return { x: c.px + dx * t, y: c.py + dy * t };
}

// The same from a view (CSS px) point: what the pitch drag needs.
export function unprojectView(view, c, vx, vy) {
  const [sx, sy] = viewToFrame(view, vx, vy);
  return unproject(c, sx, sy);
}

// camera.projectPoly: clip the polygon xs, ys, zs (n points; zs may be null
// for the ground) against the near plane and project it. Returns a flat
// array [x1, y1, x2, y2, ...] of frame px (empty when all behind).
export function projectPoly(c, xs, ys, zs, n = xs.length, out = []) {
  out.length = 0;
  const vx = new Array(n),
    vy = new Array(n),
    vd = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = toView(c, xs[i], ys[i], zs ? zs[i] : 0);
    vx[i] = v[0];
    vy[i] = v[1];
    vd[i] = v[2];
  }
  const { f, cx, cy } = c;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ai = vd[i] >= NEAR,
      aj = vd[j] >= NEAR;
    if (ai) out.push(cx + (f * vx[i]) / vd[i], cy - (f * vy[i]) / vd[i]);
    if (ai !== aj) {
      const t = (NEAR - vd[i]) / (vd[j] - vd[i]);
      out.push(
        cx + (f * (vx[i] + (vx[j] - vx[i]) * t)) / NEAR,
        cy - (f * (vy[i] + (vy[j] - vy[i]) * t)) / NEAR,
      );
    }
  }
  return out;
}

// camera.projectSegment: [x1, y1, x2, y2] in frame px, or null.
export function projectSegment(c, x1, y1, z1, x2, y2, z2) {
  let [ax, ay, ad] = toView(c, x1, y1, z1);
  let [bx, by, bd] = toView(c, x2, y2, z2);
  if (ad < NEAR && bd < NEAR) return null;
  if (ad < NEAR) {
    const t = (NEAR - ad) / (bd - ad);
    ax += (bx - ax) * t;
    ay += (by - ay) * t;
    ad = NEAR;
  } else if (bd < NEAR) {
    const t = (NEAR - bd) / (ad - bd);
    bx += (ax - bx) * t;
    by += (ay - by) * t;
    bd = NEAR;
  }
  const f = c.f;
  return [
    c.cx + (f * ax) / ad,
    c.cy - (f * ay) / ad,
    c.cx + (f * bx) / bd,
    c.cy - (f * by) / bd,
  ];
}

// Depth of a world point along the view axis.
export function depth(c, x, y, z) {
  return (x - c.px) * c.fx + (y - c.py) * c.fy + (z - c.pz) * c.fz;
}
