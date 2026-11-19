// Touch the kubb to raise it (src/game/raise-touch.js): the pure geometry, against the
// raise camera the game draws with.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  raiseGeometry,
  onKubb,
  nearerEnd,
  dragOf,
  allowedEnd,
  tiltItem,
  tune,
} from "../../src/game/raise-touch.js";
import { raiseCamera, poseItem } from "../../src/game/scenes.js";

const pose = { x: 0.7, y: 2.3, angle: 0.35, standing: false };
const foot = (k) => ({
  x: pose.x + k * Math.cos(pose.angle) * 0.11,
  y: pose.y + k * Math.sin(pose.angle) * 0.11,
  standing: true,
  angle: pose.angle,
});
const need = {
  kind: "raise",
  kubb: "a3",
  pose,
  ends: [
    { which: 1, ok: true, pose: foot(1) },
    { which: 2, ok: false, pose: foot(-1) },
  ],
};
const view = { width: 390, height: 844, dpr: 2, fit: { ox: 0, oy: 200, k: 2 } };

test("the kubb's outline takes taps on it and a finger's width round it, and says the nearer end", () => {
  const g = raiseGeometry(view, raiseCamera(need), need);
  assert.ok(g, "drawn");
  const [a, b] = g.caps;
  const mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2;
  assert.ok(onKubb(g, mx, my));
  const ys = g.outline.map((p) => p[1]);
  const top = Math.min(...ys);
  assert.ok(onKubb(g, mx, top - 20), "20 px above the kubb");
  assert.ok(!onKubb(g, mx, top - tune.margin - 4), "but not far above it");
  assert.equal(nearerEnd(g, a.x * 0.8 + b.x * 0.2, a.y * 0.8 + b.y * 0.2), 0);
  assert.equal(nearerEnd(g, a.x * 0.2 + b.x * 0.8, a.y * 0.2 + b.y * 0.8), 1);
  assert.equal(
    raiseGeometry(view, raiseCamera(need), { ...need, ends: [] }),
    null,
  );
});

test("a drag says the end it moves toward and how far up", () => {
  const g = raiseGeometry(view, raiseCamera(need), need);
  const [a, b] = g.caps;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const travel = Math.max(tune.travelMin, L * tune.travelK);
  const ux = (a.x - b.x) / L,
    uy = (a.y - b.y) / L;
  const d = dragOf(g, 0, 0, ux * travel * 0.5, uy * travel * 0.5);
  assert.equal(d.i, 0);
  assert.ok(Math.abs(d.t - 0.5) < 1e-9);
  assert.equal(dragOf(g, 0, 0, -ux * travel * 3, -uy * travel * 3).t, 1);
  assert.equal(dragOf(g, 0, 0, -ux, -uy).i, 1);
});

test("a refused end gives the allowed one", () => {
  assert.deepEqual(allowedEnd(need, 0), { i: 0, ok: true });
  assert.deepEqual(allowedEnd(need, 1), { i: 0, ok: false });
  const none = { ends: [{ ok: false }, { ok: false }] };
  assert.deepEqual(allowedEnd(none, 0), { i: null, ok: false });
});

test("tipped up: lying at 0, on the end's footprint at 1, pivoting on that end's edge", () => {
  const lying = poseItem("a3", "kubb", pose);
  const t0 = tiltItem(need, 0, 0);
  assert.deepEqual(t0, lying);
  // at the top it stands on end 1's footprint, its long axis upright
  const top = tiltItem(need, 0, 1);
  const f = need.ends[0].pose;
  assert.ok(Math.hypot(top.x - f.x, top.y - f.y) < 1e-9, "on the footprint");
  assert.ok(Math.abs(top.z - 0.075) < 1e-9, "its middle at half its length");
  // the body's long axis (local z) turned by the item's quaternion: upright
  const { qw: w, qx: x, qy: y } = top;
  const zz = 1 - 2 * (x * x + y * y);
  assert.ok(Math.abs(Math.abs(zz) - 1) < 1e-9, "upright");
  // half way: the middle has risen and moved toward end 1
  const half = tiltItem(need, 0, 0.5);
  assert.ok(half.z > lying.z);
  const toward = (it) =>
    (it.x - pose.x) * Math.cos(pose.angle) +
    (it.y - pose.y) * Math.sin(pose.angle);
  assert.ok(toward(half) > toward(lying));
  assert.ok(
    toward(tiltItem(need, 1, 0.5)) < toward(lying),
    "end 2 the other way",
  );
});
