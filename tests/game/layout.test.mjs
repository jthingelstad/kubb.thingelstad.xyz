// src/game/layout.js and the pure parts of src/game/sound.js and
// src/game/scenes.js: where the dial and minimap go, the tall-canvas framing
// (its un-projection must match its projection), and the knock take choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutFor,
  worldFit,
  stillFit,
  panFor,
  isTall,
  tune,
} from "../../src/game/layout.js";
import { pickTake } from "../../src/game/sound.js";
import { lookAt, teamOf, raiseCamera } from "../../src/game/scenes.js";
import { projectView, unprojectView } from "../../src/render/camera.js";

const SIZES = [
  [1280, 768],
  [390, 844],
  [844, 390],
  [768, 1024],
  [360, 640],
];

test("tall canvases are the upright ones", () => {
  assert.equal(isTall(390, 844), true);
  assert.equal(isTall(1280, 768), false);
  assert.equal(isTall(844, 390), false);
  assert.equal(isTall(500, 500), false);
});

test("the dial sits inside the screen, lower right wide and lower centre tall", () => {
  for (const [W, H] of SIZES) {
    const L = layoutFor(W, H, { bottom: 20, right: 10 });
    const d = L.dial;
    assert.ok(d.x >= 0 && d.y >= 0, `${W}x${H} dial on screen`);
    assert.ok(d.x + d.width <= W && d.y + d.height <= H - 20 + 0.01);
    assert.ok(d.width >= 120, `${W}x${H} dial big enough to swing`);
    const mid = d.x + d.width / 2;
    if (isTall(W, H)) assert.ok(Math.abs(mid - W / 2) < 1, "centred");
    else assert.ok(mid > W / 2, "to the right");
    const m = L.minimap;
    assert.ok(
      m.x >= 0 && m.x + m.width <= W && m.y >= 0 && m.y + m.height <= H,
    );
  }
});

test("a wide canvas keeps the renderer's framing", () => {
  assert.equal(worldFit(1280, 768), null);
  assert.equal(stillFit(844, 390), null);
  assert.equal(panFor(1280, 768, 30), 200);
});

test("a tall canvas zooms in, keeps the frame's edges and pans to the target", () => {
  const W = 390,
    H = 844;
  const f = worldFit(W, H, 200);
  assert.ok(Math.abs(f.k - (W / 400) * tune.tallZoom) < 1e-9);
  // the frame's centre stays in the middle of the screen
  assert.ok(Math.abs(f.ox + 200 * f.k - W / 2) < 1e-9);
  // panned to an edge, the frame never leaves a gap
  const l = worldFit(W, H, -500),
    r = worldFit(W, H, 900);
  assert.ok(l.ox <= 1e-9 && l.ox + 400 * l.k >= W - 1e-9);
  assert.ok(r.ox <= 1e-9 && r.ox + 400 * r.k >= W - 1e-9);
  // a target near the frame's left edge pulls the pan left, never past it
  const p = panFor(W, H, 60);
  assert.ok(p < 200);
  const fp = worldFit(W, H, p);
  const sx = fp.ox + 60 * fp.k;
  assert.ok(sx > 0 && sx < W);
});

test("framed views un-project to the points they project", () => {
  const cam = lookAt([0.4, -1.5, 1.6], [0, 4, 0], 600);
  for (const [W, H] of SIZES) {
    for (const fit of [null, worldFit(W, H, 150), stillFit(W, H, 1.8)]) {
      const view = { width: W, height: H, fit };
      for (const [x, y] of [
        [0, 2],
        [-1.5, 6],
        [2, 7.5],
      ]) {
        const s = projectView(view, cam, x, y, 0);
        if (!s) continue;
        const back = unprojectView(view, cam, s[0], s[1]);
        assert.ok(back, `${W}x${H} un-projects`);
        assert.ok(Math.abs(back.x - x) < 1e-6 && Math.abs(back.y - y) < 1e-6);
      }
    }
  }
});

test("the raise camera sees the lying kubb from the defender's side", () => {
  const need = { pose: { x: 1.93, y: 3.26, angle: -1.559, standing: false } };
  const cam = raiseCamera(need);
  const view = { width: 1280, height: 768, fit: null };
  const s = projectView(view, cam, need.pose.x, need.pose.y, 0.035);
  assert.ok(s, "the kubb is in front of the camera");
  assert.ok(s[0] > 0 && s[0] < 1280 && s[1] > 0 && s[1] < 768 * 0.7);
});

test("pieces belong to a team by their id", () => {
  assert.equal(teamOf("a3"), "A");
  assert.equal(teamOf("b10"), "B");
  assert.equal(teamOf("king"), undefined);
});

test("a knock never repeats the last take and prefers a quiet one", () => {
  const seq = [0, 0.13, 0.5, 0.99, 0.42, 0.77];
  let last = null;
  for (const r of seq) {
    const t = pickTake(9, last, new Set(), () => r);
    assert.ok(t >= 0 && t < 9 && t !== last);
    last = t;
  }
  const busy = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(
    pickTake(9, null, busy, () => 0.5),
    8,
  );
  // all busy: still a take, still not the last
  assert.notEqual(
    pickTake(2, 1, new Set([0, 1]), () => 0.9),
    1,
  );
});
