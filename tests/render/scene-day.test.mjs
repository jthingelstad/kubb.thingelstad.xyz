// The day scene is pinned: without the address switch the pitch is drawn
// exactly as before scenes existed (src/render/scenes.js). Every call
// drawWorld makes on the canvas, with its arguments, is written down by a
// recording context and hashed, for a spread of pictures: three surfaces, two
// sets, a crowded field, a baton in the air, the aim's marks and the wide view.
//
// A deliberate change to the day look re-pins it: KUBB_PIN=print node --test
// tests/render/scene-day.test.mjs prints the new hash. A change that was not
// meant to touch the day look must leave it alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { drawWorld } from "../../src/render/world.js";
import {
  sceneOf,
  sceneFromQuery,
  lookOf,
  Stage,
  SCENES,
} from "../../src/render/scenes.js";

// Re-pinned on 2026-11-21 for the Throwing Wood 1.0 system's one ink (#16130f, it was
// #17140f in src/render/palette.js INK): the same picture a shade warmer.
const PINNED =
  "798a384b737d8a8758752695132fc0d89a3b83347867886393a3a20f726654e4";

// A context that writes every call and every property set as a line.
function recorder() {
  const log = [];
  const num = (v) =>
    typeof v === "number" ? (Math.round(v * 1e4) / 1e4).toString() : v;
  const fmt = (args) =>
    args
      .map((a) =>
        Array.isArray(a)
          ? "[" + a.map(num).join(",") + "]"
          : a && typeof a === "object"
            ? "{obj}"
            : String(num(a)),
      )
      .join(",");
  const gradient = (name, args) => {
    log.push(`${name}(${fmt(args)})`);
    return {
      addColorStop: (...a) => log.push(`stop(${fmt(a)})`),
    };
  };
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (key === "createLinearGradient" || key === "createRadialGradient")
          return (...a) => gradient(key, a);
        return (...a) => {
          log.push(`${String(key)}(${fmt(a)})`);
        };
      },
      set(_, key, value) {
        log.push(`${String(key)}=${num(value)}`);
        return true;
      },
    },
  );
  return { ctx, log };
}

function lookAt(px, py, pz, tx, ty, tz, f = 1000) {
  let fx = tx - px,
    fy = ty - py,
    fz = tz - pz;
  const l = Math.hypot(fx, fy, fz);
  fx /= l;
  fy /= l;
  fz /= l;
  let rx = fy,
    ry = -fx;
  const rl = Math.hypot(rx, ry);
  rx /= rl;
  ry /= rl;
  const rz = 0;
  const ux = ry * fz - rz * fy,
    uy = rz * fx - rx * fz,
    uz = rx * fy - ry * fx;
  return {
    px,
    py,
    pz,
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
    cx: 200,
    cy: 120,
  };
}

const piece = (id, kind, x, y, z, q = [1, 0, 0, 0], extra = {}) => ({
  id,
  kind,
  x,
  y,
  z,
  qw: q[0],
  qx: q[1],
  qy: q[2],
  qz: q[3],
  ...extra,
});
const tipX = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0, 0]; // lying, about x
const odd = [0.9, 0.2, 0.3, 0.24]; // tumbling (normalised below)
const n = Math.hypot(...odd);
const tumbling = odd.map((v) => v / n);

const FIELD = [
  ...[-2, -1, 0, 1, 2].map((x, i) =>
    piece("kubbB" + i, "kubb", x, 8, 0.075, [1, 0, 0, 0], { team: "B" }),
  ),
  piece("kubbA1", "kubb", -0.4, 6.1, 0.035, tipX, { team: "A" }),
  piece("kubbA2", "kubb", -0.3, 6.2, 0.075, [1, 0, 0, 0], { team: "A" }),
  piece("king", "king", 0, 4, 0.15),
  piece("baton1", "baton", 0.3, 5.2, 0.9, tumbling),
  piece("baton2", "baton", 1.1, 7.4, 0.022, tipX),
];

const PICTURES = [
  {
    view: { width: 1280, height: 768, dpr: 1 },
    cam: lookAt(0, -3.7, 3.4, 0, 8, 0),
    scene: {
      surface: "grass",
      set: "classic",
      items: FIELD,
      advantageY: 6,
      marker: { x: 0, y: 8, r: 0.3 },
      arc: [
        [0, 0.5, 1.2],
        [0, 3, 2.6],
        [0, 6, 1.8],
        [0, 8, 0.1],
      ],
      thrower: { x: 0, y: -0.2, facing: 1 },
    },
  },
  {
    view: { width: 540, height: 900, dpr: 2 },
    cam: lookAt(0.4, 3.2, 1.6, -0.2, 6.2, 0, 700),
    scene: { surface: "sand", set: "usa", items: FIELD },
  },
  {
    view: { width: 844, height: 390, dpr: 2 },
    cam: lookAt(1.5, 5, 1.2, -0.3, 6.1, 0.1, 900),
    scene: {
      surface: "snow",
      set: "sweden",
      items: FIELD,
      keepOut: [{ x: 0, y: 4, r: 1 }],
      footprints: [{ x: -0.3, y: 6.2, angle: 0, chosen: true, allowed: true }],
    },
  },
  {
    view: { width: 1280, height: 768, dpr: 1 },
    cam: lookAt(6.5, 4, 7, 0, 4, 0.2, 305),
    scene: { surface: "grass", set: "minnesota", items: FIELD },
  },
];

function drawAll(extra) {
  const all = [];
  for (const p of PICTURES) {
    const { ctx, log } = recorder();
    drawWorld(ctx, p.view, p.cam, { ...p.scene, ...extra });
    all.push(log.join("\n"));
  }
  return crypto.createHash("sha256").update(all.join("\n--\n")).digest("hex");
}

test("without a scene the pitch is drawn as it was (the day scene, pinned)", () => {
  const h = drawAll({});
  if (process.env.KUBB_PIN === "print") console.log("day pin:", h);
  assert.equal(h, PINNED);
});

test("the day scene named is the same picture as no scene", () => {
  assert.equal(drawAll({ look: sceneOf("day") }), drawAll({}));
  assert.equal(drawAll({ look: null }), drawAll({}));
});

test("the address switch: ?scene=night, neon or day, nothing else", () => {
  assert.equal(sceneFromQuery("?scene=night"), "night");
  assert.equal(sceneFromQuery("?scene=neon"), "neon");
  assert.equal(sceneFromQuery("?scene=NEON"), null);
  assert.equal(sceneFromQuery("?scene=neon2"), null);
  assert.equal(sceneFromQuery("?nohowto=1&scene=night"), "night");
  assert.equal(sceneFromQuery(""), null);
  assert.equal(
    sceneFromQuery("?scene=day"),
    "day",
    "the day, over a saved scene",
  );
  assert.equal(sceneFromQuery("?scene=NIGHT"), null);
  assert.equal(sceneFromQuery("?scene=park"), null);
  assert.equal(sceneFromQuery("?scene="), null);
  assert.equal(sceneFromQuery("?night=1"), null);
  assert.equal(sceneOf("day").id, "day");
  assert.equal(sceneOf("nope"), sceneOf("day"));
});

test("the controls' skin: the day's tokens are the palette's, and come back", async () => {
  const P = await import("../../src/render/palette.js");
  const before = JSON.stringify([P.UI, P.HUD, P.BURST, P.AIM]);
  assert.deepEqual(P.UI, { ink: P.INK, paper: P.PAPER, drop: P.INK });
  assert.equal(P.HUD.face, P.PAPER);
  assert.equal(P.BURST.ink, P.INK);
  P.useSkin(P.NIGHT.skin);
  assert.notEqual(P.UI.ink, P.INK);
  P.useSkin(P.NEON.skin);
  assert.equal(P.UI.ink, P.NEON.skin.ui.ink);
  assert.equal(
    P.HUD.mapGround.grass.pitch,
    P.NEON.skin.hud.mapGround.grass.pitch,
  );
  P.useSkin(null);
  assert.equal(JSON.stringify([P.UI, P.HUD, P.BURST, P.AIM]), before);
  // the day pin holds after a night and a neon have been and gone
  assert.equal(drawAll({}), PINNED);
});

test("the night and the neon draw without failing, and differ from the day", () => {
  for (const id of ["night", "neon"]) {
    const h = drawAll({ look: sceneOf(id), time: 1.5 });
    assert.notEqual(h, PINNED);
  }
});

// Every surface draws a match through one Stage: the scene id is all it is
// given, and an id this client does not know is the day.
function drawStaged(id) {
  const all = [];
  const stage = new Stage({ reduced: false });
  stage.use(id);
  for (const p of PICTURES) {
    const { ctx, log } = recorder();
    stage.draw(ctx, p.view, p.cam, p.scene, 1.5);
    all.push(log.join("\n"));
  }
  return crypto.createHash("sha256").update(all.join("\n--\n")).digest("hex");
}

test("a Stage draws the match's scene; the day and an unknown id are the day", () => {
  for (const id of [undefined, null, "", "day", "dusk", "NIGHT", "night2", 7])
    assert.equal(drawStaged(id), PINNED, String(id));
  assert.deepEqual(SCENES, ["night", "neon"]);
  for (const id of SCENES) {
    assert.equal(lookOf(id).id, id);
    assert.equal(drawStaged(id), drawAll({ look: sceneOf(id), time: 1.5 }));
  }
  assert.equal(lookOf("day"), null);
  assert.equal(lookOf("dusk"), null);
  const stage = new Stage({ reduced: false });
  assert.equal(stage.use("night"), true);
  assert.equal(stage.use("night"), false);
  assert.equal(stage.id, "night");
  assert.equal(stage.use("dusk"), true);
  assert.equal(stage.id, "day");
  assert.equal(stage.fx, null);
});

// WCAG contrast of two #rrggbb colours
function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("a scene's type is 7:1 or better on its paper and on its accent plates", async () => {
  const P = await import("../../src/render/palette.js");
  for (const skin of [P.NIGHT.skin, P.NEON.skin]) {
    const c = skin.css;
    assert.ok(contrast(c["--ink"], c["--paper"]) >= 7, "ink on paper");
    assert.ok(contrast(c["--muted"], c["--paper"]) >= 7, "muted on paper");
    assert.ok(contrast(c["--on-accent"], c["--accent"]) >= 7, "on the accent");
    assert.ok(contrast(skin.ui.ink, skin.ui.paper) >= 7, "canvas type");
  }
});
