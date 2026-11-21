// The observer's free camera (docs/OBSERVER.md): a watcher flies round the pitch.
//
// The renderer (world.js) draws through any core camera (camera.js): a pinhole with a
// position, a level right vector and a lens. The wide view's camera (the engine's
// session/wide.lua) is one of them, made with core/camera's lookAt. So the free camera
// is the same kind of camera, made here in JavaScript from an orbit round a point on the
// pitch:
//
//   orbit = { yaw, pitch, dist, tx, ty, tz }
//     tx, ty, tz  the point it turns about and looks at (m, the world frame)
//     yaw         where the eye stands round it, radians from +x (0: the +x sideline,
//                 -pi/2: behind Team A's baseline)
//     pitch       how high it looks down, radians above the ground (never straight down:
//                 lookAt keeps the horizon level and needs a direction to call right)
//     dist        m from the point to the eye
//
// The lens (f, cx, cy) stays the wide camera's: it is fitted to the window's box, so a
// turned phone or a resized window keeps the pitch the size the window gives it, and the
// point turned about stays where the wide view put it on the screen. Moving closer is
// the eye moving (a dolly), not a longer lens.
//
// Everything here is pure: no DOM, no engine. src/game/free-camera.js turns the mouse,
// fingers and keys into calls on it.

const D = Math.PI / 180;

export const freeTune = {
  minDist: 2.5, // m: the closest the eye comes to the point it looks at
  maxDist: 24, // m: the farthest (the wide view's own is 9 to 16)
  minPitch: 4 * D, // nearly level, looking along the grass
  maxPitch: 86 * D, // nearly straight down
  minEyeZ: 0.35, // m: never lower than a kubb's top and a bit
  // where the point turned about may go: the pitch (5 x 8 m) and a margin round it,
  // inside the night scene's clearing (render/night.js, x -6.5..6.5, y -7..10.6)
  box: { x0: -4, x1: 4, y0: -2.5, y1: 10.5 },
  // a drag: radians a CSS px
  turnPerPx: 0.006,
  tiltPerPx: 0.004,
  // the wheel: the distance is multiplied by exp(wheelRate * pixels scrolled)
  wheelRate: 0.0015,
  // keys held, a second
  keyTurn: 1.4, // rad
  keyTilt: 0.8, // rad
  keyMove: 0.45, // of the distance (m) a second: slower close in, faster far out
  keyZoom: 1.2, // the distance changes by exp(this) a second
  resetTime: 0.45, // s: RESET VIEW eases back over this (at once with Reduce Motion)
  pitchMinSin: 0.3, // the ground under a vertical drag never moves faster than 1/this
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The orbit a core camera stands on: the eye and the point it looks at (lx, ly, lz,
// which core/camera's lookAt keeps), so cameraOf(orbitOf(c), c) is c again.
export function orbitOf(c) {
  const tx = c.lx ?? c.px + c.fx,
    ty = c.ly ?? c.py + c.fy,
    tz = c.lz ?? c.pz + c.fz;
  const dx = c.px - tx,
    dy = c.py - ty,
    dz = c.pz - tz;
  const flat = Math.hypot(dx, dy);
  return {
    yaw: Math.atan2(dy, dx),
    pitch: Math.atan2(dz, flat),
    dist: Math.hypot(flat, dz),
    tx,
    ty,
    tz,
  };
}

// The same orbit held inside the limits: a new object.
export function clampOrbit(o, t = freeTune) {
  const tx = clamp(o.tx, t.box.x0, t.box.x1);
  const ty = clamp(o.ty, t.box.y0, t.box.y1);
  const tz = o.tz;
  let pitch = clamp(o.pitch, t.minPitch, t.maxPitch);
  const dist = clamp(o.dist, t.minDist, t.maxDist);
  // the eye stays over the grass: a low pitch close in is lifted
  if (tz + dist * Math.sin(pitch) < t.minEyeZ)
    pitch = Math.min(
      t.maxPitch,
      Math.asin(clamp((t.minEyeZ - tz) / dist, -1, 1)),
    );
  return { yaw: wrap(o.yaw), pitch, dist, tx, ty, tz };
}

// An angle in (-pi, pi].
export function wrap(a) {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

// The eye of an orbit, [x, y, z].
export function eyeOf(o) {
  const c = Math.cos(o.pitch);
  return [
    o.tx + o.dist * c * Math.cos(o.yaw),
    o.ty + o.dist * c * Math.sin(o.yaw),
    o.tz + o.dist * Math.sin(o.pitch),
  ];
}

// core/camera's lookAt, the same arithmetic: the right vector level, up = right x forward.
export function lookAt(c, px, py, pz, tx, ty, tz) {
  c.px = px;
  c.py = py;
  c.pz = pz;
  c.lx = tx;
  c.ly = ty;
  c.lz = tz;
  let fx = tx - px,
    fy = ty - py,
    fz = tz - pz;
  const n = Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx /= n;
  fy /= n;
  fz /= n;
  let rx = fy,
    ry = -fx;
  const rn = Math.sqrt(rx * rx + ry * ry);
  rx /= rn;
  ry /= rn;
  c.fx = fx;
  c.fy = fy;
  c.fz = fz;
  c.rx = rx;
  c.ry = ry;
  c.rz = 0;
  c.ux = ry * fz;
  c.uy = -rx * fz;
  c.uz = rx * fy - ry * fx;
  return c;
}

// The camera an orbit gives, with `lens`'s f, cx and cy (the wide camera's): a new
// table of camera.new()'s shape, which the renderer draws through as it does any.
export function cameraOf(o, lens) {
  const [px, py, pz] = eyeOf(o);
  const c = lookAt({}, px, py, pz, o.tx, o.ty, o.tz);
  c.f = lens.f;
  c.cx = lens.cx;
  c.cy = lens.cy;
  return c;
}

// ---------- moves (each returns a new orbit, clamped) ----------

// Turn round the point (yaw) and raise or lower the eye over it (pitch).
export function turn(o, dyaw, dpitch) {
  return clampOrbit({ ...o, yaw: o.yaw + dyaw, pitch: o.pitch + dpitch });
}

// Closer (factor < 1) or farther (factor > 1).
export function zoom(o, factor) {
  if (!(factor > 0)) return o;
  return clampOrbit({ ...o, dist: o.dist * factor });
}

// Move the point it looks at over the ground: `right` m to the screen's right and
// `ahead` m away from the eye, both level.
export function move(o, right, ahead) {
  const s = Math.sin(o.yaw),
    c = Math.cos(o.yaw);
  // right is (-sin yaw, cos yaw); ahead, from the eye to the point, is (-cos, -sin)
  return clampOrbit({
    ...o,
    tx: o.tx - s * right - c * ahead,
    ty: o.ty + c * right - s * ahead,
  });
}

// A drag of the pitch by (dx, dy) frame px with lens length f: the ground under the
// finger goes with it, as near as one point turned about allows (the scale at that
// point's depth; a vertical drag spread by the view's slant).
export function drag(o, dx, dy, f) {
  const perPx = o.dist / Math.max(1, f);
  const sin = Math.max(freeTune.pitchMinSin, Math.sin(o.pitch));
  return move(o, -dx * perPx, (dy * perPx) / sin);
}

// The way between two orbits at t (0..1), turning the short way round.
export function mixOrbit(a, b, t) {
  const m = (x, y) => x + (y - x) * t;
  return {
    yaw: wrap(a.yaw + wrap(b.yaw - a.yaw) * t),
    pitch: m(a.pitch, b.pitch),
    dist: m(a.dist, b.dist),
    tx: m(a.tx, b.tx),
    ty: m(a.ty, b.ty),
    tz: m(a.tz, b.tz),
  };
}

// Two orbits the same to within a hair (the eye within a millimetre).
export function sameOrbit(a, b) {
  if (!a || !b) return a === b;
  const ea = eyeOf(a),
    eb = eyeOf(b);
  return (
    Math.hypot(ea[0] - eb[0], ea[1] - eb[1], ea[2] - eb[2]) < 1e-3 &&
    Math.hypot(a.tx - b.tx, a.ty - b.ty, a.tz - b.tz) < 1e-3
  );
}

// Two fingers from (a0, b0) to (a1, b1), CSS px [x, y] each: how far apart they spread
// (scale, > 1 apart), how much they turned (radians, clockwise on the screen positive)
// and how far their middle moved.
export function twoFingers(a0, b0, a1, b1) {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const t0 = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
  const t1 = Math.atan2(b1[1] - a1[1], b1[0] - a1[0]);
  return {
    scale: d0 > 1 && d1 > 1 ? d1 / d0 : 1,
    angle: wrap(t1 - t0),
    dx: (a1[0] + b1[0] - a0[0] - b0[0]) / 2,
    dy: (a1[1] + b1[1] - a0[1] - b0[1]) / 2,
  };
}
