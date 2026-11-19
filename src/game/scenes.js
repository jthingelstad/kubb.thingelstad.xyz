// The pictures the engine has no camera or pieces for (ENGINE.md "Not carried
// over": the raise screen's camera is the web's own): a look-at camera in the
// core camera's table, a piece's pose as a renderer item, and the scenes for
// raising and placing a punishment kubb, all in the defender's view frame.

import { project } from "../render/camera.js";

// A core camera table looking from eye at target, focal length f for the
// 400 x 240 frame (principal point cx, cy).
export function lookAt(eye, target, f = 600, cx = 200, cy = 120) {
  let fx = target[0] - eye[0],
    fy = target[1] - eye[1],
    fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward x up(world z), normalised
  let rx = fy,
    ry = -fx,
    rz = 0;
  const rl = Math.hypot(rx, ry) || 1;
  rx /= rl;
  ry /= rl;
  // up = right x forward
  const ux = ry * fz - rz * fy,
    uy = rz * fx - rx * fz,
    uz = rx * fy - ry * fx;
  return {
    px: eye[0],
    py: eye[1],
    pz: eye[2],
    fx,
    fy,
    fz,
    rx,
    ry,
    rz,
    ux,
    uy,
    uz,
    f,
    cx,
    cy,
    lx: target[0],
    ly: target[1],
    lz: target[2],
  };
}

// Quaternion product a * b, [w, x, y, z].
function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
const qz = (a) => [Math.cos(a / 2), 0, 0, Math.sin(a / 2)];
const qx = (a) => [Math.cos(a / 2), Math.sin(a / 2), 0, 0];

const HALF = { kubb: [0.035, 0.075], king: [0.045, 0.15] }; // half side, half length

// A pose { x, y, standing, angle } (the session's viewPose: angle in radians;
// lying, the long axis points along (cos angle, sin angle)) as an item.
export function poseItem(id, kind, pose, extra = {}) {
  const [side, len] = HALF[kind] || HALF.kubb;
  let q, z;
  if (pose.standing !== false) {
    q = qz(pose.angle || 0);
    z = len;
  } else {
    // local z (the long axis) laid along +y, then turned to the angle
    q = qmul(qz((pose.angle || 0) - Math.PI / 2), qx(-Math.PI / 2));
    z = side;
  }
  return {
    id,
    kind,
    x: pose.x,
    y: pose.y,
    z,
    qw: q[0],
    qx: q[1],
    qy: q[2],
    qz: q[3],
    toppled: pose.standing === false,
    team: teamOf(id),
    ...extra,
  };
}

export function teamOf(id) {
  if (typeof id !== "string") return undefined;
  if (/^a\d/.test(id)) return "A";
  if (/^b\d/.test(id)) return "B";
  return undefined;
}

// The pieces round a raise or a punishment: the others, the king, the kubb.
// (A punishment need names the king only among its keep-out circles.)
export function settleItems(need, kubbPose = need.pose) {
  const items = [];
  for (const o of need.others || []) items.push(poseItem(o.id, "kubb", o.pose));
  let king = need.king;
  if (!king) {
    const k = (need.keepOut || []).find((c) => c.kind === "king");
    if (k) king = { x: k.x, y: k.y, standing: true, angle: 0 };
  }
  if (king) items.push(poseItem("king", "king", king));
  if (kubbPose) items.push(poseItem(need.kubb, "kubb", kubbPose));
  return items;
}

export const tune = {
  raiseBack: 1.15, // m from the kubb, across its length, the raise camera stands
  raiseUp: 1.05, // m up
  raiseF: 520,
  raiseLead: 0.12, // m the look point sits toward the camera (the kubb reads above the middle)
  punishEye: [0, -2.6, 5.4],
  punishAt: [0, 1.05, 0],
  punishF: 300,
};

// The raise: across the lying kubb from the defender's side, so both ends
// show, one each side.
export function raiseCamera(need) {
  const p = need.pose;
  const a = p.angle || 0;
  let nx = -Math.sin(a),
    ny = Math.cos(a);
  if (ny > 0.05 || (Math.abs(ny) <= 0.05 && nx * p.x > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const t = tune;
  return lookAt(
    [p.x + nx * t.raiseBack, p.y + ny * t.raiseBack, t.raiseUp],
    [p.x + nx * t.raiseLead, p.y + ny * t.raiseLead, 0],
    t.raiseF,
  );
}

// The punishment kubb: the defender's half from high over its baseline.
export function punishCamera() {
  return lookAt(tune.punishEye, tune.punishAt, tune.punishF);
}

// The frame y of the lowest ground a punishment kubb may go on: the front of
// a kubb on the near baseline (its centre at y = 0.035, half a side in).
// Lowest on the screen: the camera looks straight down the pitch.
export function punishNearY() {
  return project(punishCamera(), 0, 0, 0)[1];
}
