// src/render/camera.js against the Lua camera (vendor/engine/core/camera.lua)
// running under wasmoon: the same projection for a grid of points under
// several cameras, the scale rule, near-plane clipping, and un-projection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, JSON_LUA, runJSON } from "../../dev/fixtures/core.mjs";
import * as cam from "../../src/render/camera.js";

const lua = await loadCore(["core/camera"]);
await lua.doString(JSON_LUA);

// Cameras made by the core itself: first person at two stances, the plan
// view, the impact camera mid half circle, a blend, and a near fitNear.
const cameras = await runJSON(
  lua,
  `
  local C = tw.camera
  CAMS = {}
  local out = CAMS
  local a = C.new(); C.aim(a, 0, 0, 0, {{x=0,y=8}}, 0, C.lookDistAt(0, 0, 0, 8)); out[#out+1] = a
  local b = C.new(); C.aim(b, 1.2, 2.4, -0.2, {{x=-1,y=6}}, 0, 4.0); C.fitNear(b, -0.6, 3.1); out[#out+1] = b
  local s = C.new(); C.shoulder(s, 0.3, 0, 0.05, 0, 2, {0.3, 0.6}, {1.5, 5.0}, {1.6, 2.2}, 1); out[#out+1] = s
  local i = C.new(); C.impact(i, 1.0, 7.6, 0.1, 0.99, nil, 1.2, 0.5); out[#out+1] = i
  local m = C.new(); C.blend(m, a, s, 0.4); out[#out+1] = m
  return json.encode(out)
`,
);

// a grid over the pitch and round it, at three heights
const points = [];
for (let x = -4; x <= 4; x += 0.8)
  for (let y = -2; y <= 10; y += 0.75)
    for (const z of [0, 0.15, 1.1]) points.push([x, y, z]);

function luaProject(i) {
  return runJSON(
    lua,
    `
    local c = CAMS[${i + 1}]
    local out = {}
    for k, p in ipairs(PTS) do
      local sx, sy, d = tw.camera.project(c, p[1], p[2], p[3])
      out[k] = sx and { sx, sy, d } or false
    end
    return json.encode(out)
  `,
  );
}

const luaPts = "{" + points.map((p) => `{${p.join(",")}}`).join(",") + "}";
await lua.doString(`PTS = ${luaPts}`);

test("project matches camera.project for every camera and point", async () => {
  for (let i = 0; i < cameras.length; i++) {
    const want = await luaProject(i);
    let compared = 0;
    for (let k = 0; k < points.length; k++) {
      const got = cam.project(cameras[i], ...points[k]);
      if (want[k] === false) {
        assert.equal(got, null, `camera ${i} point ${k} should be behind`);
        continue;
      }
      for (let j = 0; j < 3; j++)
        assert.ok(
          Math.abs(got[j] - want[k][j]) <= 1e-6,
          `camera ${i} point ${k}`,
        );
      compared++;
    }
    assert.ok(compared > 100, `camera ${i}: only ${compared} points in front`);
  }
});

test("the scale rule: view px = offset + k * frame px, within 1e-6", async () => {
  const want = await luaProject(0);
  const views = [
    { width: 1280, height: 768 }, // exactly 5:3
    { width: 390, height: 844 }, // portrait phone: taller, more world above and below
    { width: 2560, height: 720 }, // very wide: more world either side
  ];
  for (const view of views) {
    const { k, ox, oy } = cam.frameScale(view.width, view.height);
    assert.ok(
      Math.abs(k - Math.min(view.width / 400, view.height / 240)) < 1e-12,
    );
    // the 400 x 240 frame is centred and fits: one pair of edges touches
    assert.ok(Math.abs(ox) < 1e-9 || Math.abs(oy) < 1e-9);
    for (let n = 0; n < points.length; n += 7) {
      if (!want[n]) continue;
      const v = cam.projectView(view, cameras[0], ...points[n]);
      assert.ok(Math.abs(v[0] - (ox + k * want[n][0])) <= 1e-6);
      assert.ok(Math.abs(v[1] - (oy + k * want[n][1])) <= 1e-6);
    }
  }
  const b = cam.frameBounds(390, 844);
  assert.ok(
    Math.abs(b.left) < 1e-9 &&
      Math.abs(b.right - 400) < 1e-9 &&
      b.top < -200 &&
      b.bottom > 440,
  );
});

test("projectPoly and projectSegment clip at the near plane as the Lua does", async () => {
  const xs = [-3, 3, 3, -3],
    ys = [-5, -5, 9, 9];
  for (let i = 0; i < cameras.length; i++) {
    const want = await runJSON(
      lua,
      `
      local out = {}
      local n = tw.camera.projectPoly(CAMS[${i + 1}], 4, {-3, 3, 3, -3}, {-5, -5, 9, 9}, nil, out)
      local r = {}
      for k = 1, 2 * n do r[k] = out[k] end
      local a, b, c, d = tw.camera.projectSegment(CAMS[${i + 1}], -2.5, -4, 0, 2.5, 9, 0.3)
      return json.encode({ poly = r, seg = a and { a, b, c, d } or false })
    `,
    );
    const got = cam.projectPoly(cameras[i], xs, ys, null);
    assert.equal(got.length, want.poly.length, `camera ${i} poly length`);
    for (let k = 0; k < got.length; k++)
      assert.ok(
        Math.abs(got[k] - want.poly[k]) <=
          1e-6 * Math.max(1, Math.abs(want.poly[k])),
      );
    const seg = cam.projectSegment(cameras[i], -2.5, -4, 0, 2.5, 9, 0.3);
    if (!want.seg) assert.equal(seg, null);
    else
      for (let k = 0; k < 4; k++)
        assert.ok(
          Math.abs(seg[k] - want.seg[k]) <=
            1e-6 * Math.max(1, Math.abs(want.seg[k])),
        );
  }
});

test("unproject round trips ground points through the frame and the view", () => {
  for (const c of cameras) {
    let n = 0;
    for (let x = -2.5; x <= 2.5; x += 0.5) {
      for (let y = 0; y <= 8; y += 0.5) {
        const p = cam.project(c, x, y, 0);
        if (!p) continue;
        const g = cam.unproject(c, p[0], p[1]);
        assert.ok(g, "a projected ground point un-projects");
        assert.ok(Math.abs(g.x - x) < 1e-9 && Math.abs(g.y - y) < 1e-9);
        const view = { width: 390, height: 844 };
        const v = cam.projectView(view, c, x, y, 0);
        const h = cam.unprojectView(view, c, v[0], v[1]);
        assert.ok(Math.abs(h.x - x) < 1e-9 && Math.abs(h.y - y) < 1e-9);
        n++;
      }
    }
    assert.ok(n > 20);
  }
  // above the horizon: no ground
  const a = cameras[0];
  assert.equal(cam.unproject(a, 200, -2000), null);
});
