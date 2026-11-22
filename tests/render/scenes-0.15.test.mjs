// What engine 0.14 and 0.15 brought to the drawing (src/render/scenes.js,
// docs/SCENES.md): the seven scenes and their fallback, the Kid line, the spin
// drawing, the rings and puffs timed from the engine's ground impacts, the Kid
// rulings' flags and words, and the options card's rows from the engine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  drawWorld,
  lineSegments,
  tune as worldTune,
} from "../../src/render/world.js";
import {
  DAY,
  SCENES,
  SCENE_NAMES,
  Stage,
  lookOf,
  sceneId,
  sceneOf,
  spinAmount,
  spinTune,
} from "../../src/render/scenes.js";
import { Impacts, tune as impactTune } from "../../src/render/impacts.js";
import { NEIGHBOURS } from "../../src/render/tournament.js";
import { flagFor } from "../../src/game/rulings.js";
import { verdictSpeech } from "../../src/game/hud.js";
import { handoffKid, KID_LINES } from "../../src/ui/handoff-words.js";
import { standCaption, standText } from "../../src/game/stand-pad.js";
import { soloOptions } from "../../src/game/throw-level.js";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { useRoomEngine, optionRows } from "../../src/net/lobby.js";
import { throughScene, ROW_ORDER } from "../../src/ui/cards.js";

let engine;
before(async () => {
  engine = await Engine.create({ sources: bundleLua() });
  useRoomEngine(engine);
});
after(() => {
  try {
    engine.lua.global.close();
  } catch {
    // closed
  }
});

// ---------- drawing ----------

function recorder() {
  const log = [];
  const num = (v) =>
    typeof v === "number" ? (Math.round(v * 1e4) / 1e4).toString() : v;
  const fmt = (args) =>
    args
      .map((a) => (a && typeof a === "object" ? "{obj}" : String(num(a))))
      .join(",");
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (key === "createLinearGradient" || key === "createRadialGradient")
          return (...a) => {
            log.push(`${String(key)}(${fmt(a)})`);
            return { addColorStop: (...b) => log.push(`stop(${fmt(b)})`) };
          };
        return (...a) => log.push(`${String(key)}(${fmt(a)})`);
      },
      set(_, key, value) {
        log.push(`${String(key)}=${num(value)}`);
        return true;
      },
    },
  );
  return { ctx, log };
}

// The thrower's aim camera of a match on a wide screen (a session's own numbers)
const CAM = {
  cx: 200,
  cy: 110,
  f: 1000,
  fx: 0,
  fy: 0.951366440234242,
  fz: -0.30806151398061166,
  px: 0,
  py: -3,
  pz: 3.4,
  rx: 1,
  ry: 0,
  rz: 0,
  ux: 0,
  uy: 0.30806151398061166,
  uz: 0.951366440234242,
};
const VIEW = { width: 800, height: 600, dpr: 1 };
const KUBB = (id, x, y) => ({
  id,
  kind: "kubb",
  team: id[0] === "a" ? "A" : "B",
  x,
  y,
  z: 0.075,
  qw: 1,
  qx: 0,
  qy: 0,
  qz: 0,
});
const ITEMS = [KUBB("b1", -2, 8), KUBB("b2", 0, 8), KUBB("a1", 1, 0)];
const hashOf = (scene) => {
  const { ctx, log } = recorder();
  drawWorld(ctx, VIEW, CAM, scene);
  return crypto.createHash("sha256").update(log.join("\n")).digest("hex");
};

test("seven scenes: each the engine's id, each drawn its own way, an unknown id the day", () => {
  assert.deepEqual(Object.keys(SCENE_NAMES), ["day", ...SCENES]);
  const day = hashOf({ surface: "grass", items: ITEMS });
  const seen = new Set([day]);
  for (const id of SCENES) {
    const look = sceneOf(id);
    assert.equal(look.id, id);
    const h = hashOf({ surface: "grass", items: ITEMS, look, time: 1 });
    assert.ok(!seen.has(h), `${id} draws its own picture`);
    seen.add(h);
  }
  for (const id of ["dusk", "", null, undefined, "NEON", 7, "mars"]) {
    assert.equal(sceneId(id), "day", String(id));
    assert.equal(lookOf(id), null);
    assert.equal(sceneOf(id), DAY);
    const stage = new Stage({ reduced: true });
    stage.use(id);
    assert.equal(stage.id, "day");
  }
});

test("the shown names are the engine's catalogue, in its order", () => {
  const cat = engine.call("scenes", {});
  assert.deepEqual(
    cat.scenes.map((s) => [s.id, s.name]),
    Object.entries(SCENE_NAMES),
  );
  // Black & White is the only one with a choice (its surface), Techno the only ring
  assert.deepEqual(
    cat.scenes.filter((s) => s.choices.length).map((s) => s.id),
    ["bw"],
  );
  assert.deepEqual(
    cat.scenes.filter((s) => s.ring).map((s) => s.id),
    ["neon"],
  );
});

test("every scene draws each of its surfaces, its fx and the Kid line without throwing", () => {
  const cat = engine.call("scenes", {});
  for (const s of cat.scenes) {
    const stage = new Stage({ reduced: false });
    stage.use(s.id);
    for (const surface of s.surfaces) {
      const { ctx } = recorder();
      stage.draw(
        ctx,
        VIEW,
        CAM,
        { surface, set: s.set, items: ITEMS, kidY: 2 },
        1,
      );
    }
  }
});

test("the Kid line: dots across the pitch at kidY, told from the advantage line; cones at its ends", () => {
  const plain = lineSegments({});
  const kid = lineSegments({ kidY: 2 });
  const dots = kid.slice(plain.length);
  assert.ok(dots.length > 20);
  for (const [x0, y0, x1, y1] of dots) {
    assert.equal(y0, 2);
    assert.equal(y1, 2);
    assert.ok(x1 - x0 <= worldTune.kidDot + 1e-9);
  }
  // the advantage line where the Kid line is too: drawn once, as the advantage line
  assert.equal(
    lineSegments({ kidY: 3, advantageY: 3 }).length,
    lineSegments({ advantageY: 3 }).length,
  );
  const withKid = hashOf({ surface: "grass", items: ITEMS, kidY: 2 });
  assert.notEqual(withKid, hashOf({ surface: "grass", items: ITEMS }));
});

// ---------- the spin ----------

const turnZ = (deg) => {
  const h = (deg * Math.PI) / 360;
  return { qw: Math.cos(h), qx: 0, qy: 0, qz: Math.sin(h) };
};
const turnX = (deg) => {
  const h = (deg * Math.PI) / 360;
  return { qw: Math.cos(h), qx: Math.sin(h), qy: 0, qz: 0 };
};

test("the spin threshold: a kubb's twist past 30 degrees a frame blurs, past 50 it is all spin", () => {
  const still = { qw: 1, qx: 0, qy: 0, qz: 0 };
  assert.equal(spinAmount(still, turnZ(20)), 0);
  assert.equal(spinAmount(still, turnZ(spinTune.twistFrom)), 0);
  const mid = spinAmount(still, turnZ(40));
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  // full SPIN: about 69 rad/s, 66 degrees a frame at 60 fps
  assert.equal(spinAmount(still, turnZ((69 / 60) * (180 / Math.PI))), 1);
  // a baton is round about its long axis: its twist never blurs
  assert.equal(spinAmount(still, turnZ(66), "baton"), 0);
  // end over end looks the same each half turn: twice the angle before it blurs
  assert.equal(spinAmount(still, turnX(50)), 0);
  assert.ok(spinAmount(still, turnX(80)) > 0);
  assert.equal(spinAmount(still, turnX(110)), 1);
});

test("Stage.observe marks the pieces spinning too fast, and draws their in-between poses", () => {
  const stage = new Stage({ reduced: false });
  stage.use("day");
  stage.watch({ timeline: {} });
  const a = { ...KUBB("a1", 0, 7), ...turnZ(0) };
  const fast = { ...a, ...turnZ(66) };
  const slow = { ...a, ...turnZ(76) }; // 10 degrees on from `fast`
  stage.observe([a], 0);
  stage.observe([fast], 1 / 60);
  // the game names the scene again every frame: that keeps the spin
  stage.use("day");
  const items = stage.spun([fast]);
  assert.equal(items[0].spin, 1);
  assert.deepEqual(
    [items[0].from.qw, items[0].from.qz],
    [a.qw, a.qz],
    "the pose the frame before",
  );
  // the drawing has more pieces in it than the plain one
  const { ctx: c1, log: l1 } = recorder();
  stage.draw(c1, VIEW, CAM, { surface: "grass", items: [fast] });
  const { ctx: c2, log: l2 } = recorder();
  drawWorld(c2, VIEW, CAM, { surface: "grass", items: [fast] });
  assert.ok(l1.length > l2.length + 300, `${l1.length} > ${l2.length}`);
  // faded in-between poses, and the piece's own pose faded under them
  assert.ok(l1.includes("globalAlpha=0.45"));
  assert.equal(
    l2.some((l) => l.startsWith("globalAlpha=0.4")),
    false,
  );
  // a slow turn is drawn plain; between throws nothing spins
  stage.observe([slow], 2 / 60);
  assert.equal(stage.spun([slow])[0].spin, undefined);
  stage.observe([fast], 3 / 60);
  stage.tick(1 / 60);
  assert.equal(stage.spun([fast])[0].spin, undefined);
});

// ---------- rings and puffs ----------

const REC = {
  timeline: {
    impacts: [
      {
        t: 0.954,
        x: -2.02,
        y: 8.22,
        id: "b1",
        with: "kubb",
        thrown: false,
        speed: 1.41,
        strength: 0.25,
      },
      {
        t: 1.3,
        x: -2.35,
        y: 9.87,
        id: "baton1",
        with: "baton",
        thrown: true,
        speed: 2.86,
        strength: 0.37,
      },
      {
        t: 1.533,
        x: -2.64,
        y: 10.72,
        id: "baton1",
        with: "baton",
        thrown: true,
        speed: 3.8,
        strength: 0.24,
      },
    ],
  },
};

test("rings start when playback reaches each impact's t, grow by the throw's clock and fade", () => {
  const fx = new Impacts({
    style: "ring",
    colors: { A: "#f00", B: "#00f", king: "#f0f", baton: "#0ff" },
  });
  fx.watch(REC);
  fx.observe([], 0.5);
  assert.equal(fx.state().length, 0);
  fx.observe([], 0.96);
  assert.deepEqual(
    fx.state().map((r) => r.id),
    ["b1"],
  );
  const r0 = fx.state()[0].r;
  // slow motion: shown time creeps, the ring grows a little
  fx.observe([], 1.0);
  const r1 = fx.state()[0].r;
  assert.ok(r1 > r0);
  fx.observe([], 1.31);
  assert.deepEqual(
    fx.state().map((r) => r.id),
    ["b1", "baton1"],
  );
  fx.observe([], 1.6);
  assert.equal(fx.state().length, 3);
  fx.tick(1);
  assert.equal(fx.state().length, 0, "gone after its life");
  // a faster strike rings wider: the last radius goes by the speed
  const two = new Impacts({ style: "ring", colors: {} });
  two.watch({
    timeline: {
      impacts: [
        { t: 0.5, x: 0, y: 5, id: "b1", with: "kubb", speed: 1 },
        { t: 0.5, x: 1, y: 5, id: "baton1", with: "baton", speed: 3.8 },
      ],
    },
  });
  two.observe([], 0.9);
  const [slow, fast] = two.state();
  assert.ok(fast.r > slow.r, "3.8 m/s rings wider than 1");
});

test("with reduced motion a ring does not grow: it fades where it struck", () => {
  const fx = new Impacts({ style: "ring", reduced: true, colors: {} });
  fx.watch(REC);
  fx.observe([], 1.0);
  const r0 = fx.state()[0].r;
  fx.observe([], 1.2);
  assert.equal(fx.state()[0].r, r0);
  assert.ok(fx.state()[0].alpha < 1);
});

test("puffs skip a soft strike", () => {
  const fx = new Impacts({ style: "puff", colors: { puff: ["#fff"] } });
  fx.watch({
    timeline: {
      impacts: [
        { t: 0.1, x: 0, y: 5, id: "b1", speed: impactTune.puffFrom - 0.1 },
        { t: 0.2, x: 0, y: 5, id: "b1", speed: 3 },
      ],
    },
  });
  fx.observe([], 0.3);
  assert.equal(fx.live.length, 1);
});

test("a Techno throw's recording carries impacts once asked, and asking changes no hash", async () => {
  const play = async (on) => {
    const e = await Engine.create({ sources: bundleLua() });
    e.setImpacts(on);
    e.newMatch({
      seed: 1016,
      cpu: "both",
      scene: "neon",
      first: "A",
      teams: {
        A: { name: "North", players: [{ name: "North" }] },
        B: { name: "South", players: [{ name: "South" }] },
      },
    });
    let rec = null;
    for (let i = 0; i < 4000 && !rec; i++)
      if (e.frame({ dt: 0.1 }).action) rec = e.recording();
    const out = {
      hash: e.hash().hash,
      impacts: rec?.timeline?.impacts,
      surface: e.view().surface,
    };
    e.lua.global.close();
    return out;
  };
  const on = await play(true);
  const off = await play(false);
  assert.equal(on.surface, "grid", "Techno's own floor");
  assert.equal(on.hash, off.hash);
  assert.equal(off.impacts, undefined);
  assert.ok(Array.isArray(on.impacts) && on.impacts.length > 0);
  // the Techno fx rings at each, in time order
  const stage = new Stage({ reduced: false });
  stage.use("neon");
  stage.watch({ timeline: { impacts: on.impacts } });
  stage.observe([], on.impacts.at(-1).t);
  assert.equal(stage.fx.rings.state().length, on.impacts.length);
});

test("the tournament's neighbours are data: pitches of pieces and people", () => {
  assert.ok(NEIGHBOURS.length >= 4);
  for (const p of NEIGHBOURS) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(p.pieces.some((q) => q.kind === "king"));
    for (const q of p.pieces)
      assert.ok(["kubb", "king", "baton"].includes(q.kind));
  }
});

// ---------- the Kid match's words ----------

test("Kid rulings' flags: the king back up, a kubb placed, a helicopter that counts", () => {
  const r = (flag, short, ...codes) => ({
    flag,
    ruling: { short, parts: codes.map((code) => ({ code })) },
  });
  assert.equal(
    flagFor(r("MISS", "KING BACK UP", "miss", "kingUp")),
    "KING BACK UP",
  );
  assert.equal(
    flagFor(r(null, "OUT TWICE: PLACED", "placed")),
    "OUT TWICE: PLACED",
  );
  assert.equal(
    flagFor(r("HELICOPTER", "1 DOWN", "base", "helicopterCounts")),
    "1 DOWN",
  );
  assert.equal(
    flagFor(r("HELICOPTER", "MISS", "miss", "helicopterCounts")),
    "MISS",
  );
  // the standard game's own words stand
  assert.equal(
    flagFor(r("HELICOPTER", "HELICOPTER: DOESN'T COUNT", "helicopter")),
    "HELICOPTER",
  );
  assert.equal(flagFor(r("2 DOWN", "2 DOWN", "field")), "2 DOWN");
  for (const f of ["KING BACK UP", "OUT TWICE: PLACED", "1 DOWN", "MISS"])
    assert.doesNotMatch(f, /PUNISH|GAME OVER|LOSE|DOESN'T COUNT/);
});

test("the hand-off says Kid match, and never a punishment or a loss", () => {
  assert.equal(handoffKid({ kind: "throw", setup: {} }), null);
  assert.equal(
    handoffKid({ kind: "throw", kid: true, setup: { kingShot: false } }),
    KID_LINES.cones,
  );
  assert.equal(
    handoffKid({ kind: "throw", kid: true, setup: { kingShot: true } }),
    KID_LINES.king,
  );
  assert.equal(handoffKid({ kind: "raise", kid: true }), KID_LINES.plain);
  for (const w of Object.values(KID_LINES))
    assert.doesNotMatch(w, /punish|lose|lost|out/i);
});

test("STAND speaks of the Kid line in a Kid match", () => {
  const aim = {
    lineY: 0,
    forwardY: 2,
    kidY: 2,
    projectile: "baton",
    halfWidth: 2.5,
    backMax: 3,
  };
  assert.equal(standText({ x: 0, y: 2 }, aim), "MIDDLE, ON THE KID LINE");
  assert.match(standCaption({ x: 0, y: 2 }, aim).text, /up to the Kid line/);
  // a kubb is thrown from the Kid line too
  assert.match(
    standCaption({ x: 0, y: 1 }, { ...aim, projectile: "kubb" }).text,
    /Kid line/,
  );
});

test("the verdict's spoken line ends with where the throw came to rest", () => {
  assert.equal(
    verdictSpeech(
      "MISS",
      { power: "SHORT", release: "ON", steady: "STEADY" },
      "50 CM AWAY",
    ),
    verdictSpeech("MISS", { power: "SHORT", release: "ON", steady: "STEADY" }) +
      " 50 cm away.",
  );
  assert.equal(verdictSpeech(null, null, "1.2 M AWAY"), "1.2 m away.");
});

// ---------- the options card's rows ----------

test("the card's rows are the engine's for each scene: Surface only for Black & White, Kid first", () => {
  const cat = engine.call("scenes", {});
  for (const s of cat.scenes) {
    const card = optionRows(s.id);
    const keys = card.rows.map(([k]) => k);
    assert.equal(keys[0], "scene", s.id);
    assert.equal(keys.includes("set"), false, "no Kubbs row");
    assert.equal(keys.includes("surface"), s.id === "bw", s.id);
    const computer = card.rows.find(([k]) => k === "computer");
    assert.deepEqual(
      computer[2].map(([v]) => v),
      ["kid", "beginner", "club", "pro"],
    );
    for (const k of keys.filter((k) => k !== "scene"))
      assert.ok(ROW_ORDER.includes(k), `${k} is placed on the card`);
    assert.equal(card.defaults.surface, s.surface);
    assert.equal(card.defaults.set, s.set);
  }
});

test("kept options go through the scene; a kept Kid computer stays Kid", () => {
  // a sand surface kept from before 0.14 on Park comes back as grass; Black & White keeps it
  assert.deepEqual(
    throughScene({ surface: "sand", set: "usa" }, optionRows("day")),
    {
      surface: "grass",
      set: "classic",
    },
  );
  assert.deepEqual(throughScene({ surface: "sand" }, optionRows("bw")), {
    surface: "sand",
    set: "classic",
  });
  assert.deepEqual(
    throughScene({ surface: "grass" }, optionRows("minnesota")),
    {
      surface: "snow",
      set: "minnesota",
    },
  );
  assert.equal(soloOptions({ computer: "kid" }).computer, "kid");
  assert.equal(soloOptions({ computer: "toddler" }).computer, "club");
});

test("the Kid line is drawn on the thrower's side only (the wide view's Team B keeps an unturned kidY)", async () => {
  const { kidLineOf } = await import("../../src/game/game.js");
  assert.equal(kidLineOf({ kidY: 2, lineY: 0 }), 2);
  assert.equal(kidLineOf({ kidY: 6, lineY: 8 }), 6);
  assert.equal(kidLineOf({ kidY: 2, lineY: 8 }), null);
  assert.equal(kidLineOf({ lineY: 0 }), null);
  assert.equal(kidLineOf(null), null);
});
