// The page's half of the Tournament's live neighbours (src/game/neighbours.js), with no
// browser: when a field may be live (the scene gating), the layout, and a worker that
// never answers, fails or cannot be made: the page goes on, draws the still pitches,
// and ends the worker; no people on any pitch, and pieces rise rather than pop up.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Neighbours,
  neighboursWanted,
  Field,
  fieldFor,
  riseOf,
  tune,
} from "../../src/game/neighbours.js";

test("live only in the Tournament, in a match or practice, without reduced motion", () => {
  const base = { scene: "tournament", mode: "match" };
  assert.equal(neighboursWanted(base), true);
  assert.equal(neighboursWanted({ ...base, mode: "practice" }), true);
  for (const scene of [
    "day",
    "beach",
    "night",
    "neon",
    "minnesota",
    "bw",
    null,
  ])
    assert.equal(neighboursWanted({ ...base, scene }), false, scene);
  assert.equal(neighboursWanted({ ...base, mode: null }), false);
  assert.equal(neighboursWanted({ ...base, reduced: true }), false);
  assert.equal(neighboursWanted({ ...base, available: false }), false);
  assert.equal(neighboursWanted({ ...base, failed: true }), false);
  // never started under a card; a card over an open field keeps it (its clock stops)
  assert.equal(neighboursWanted({ ...base, modal: true }), false);
  assert.equal(neighboursWanted({ ...base, modal: true, open: true }), true);
  assert.equal(
    neighboursWanted({ ...base, reduced: true, open: true }),
    false,
    "reduced motion closes an open field",
  );
});

test("the ring of 8 in every layout; no pitch has people", () => {
  assert.equal(tune.layout, "grid");
  const teams = {
    A: { name: "Brave Birch", players: 3 },
    B: { name: "Lucky Larch", players: 3 },
  };
  const pitch = (id, x, y) => ({
    id,
    offset: { x, y },
    teams,
    items: [],
    phase: "aim",
    at: 0,
  });
  const field = new Field({
    stakes: [],
    pitches: [
      pitch(1, -8, 0),
      pitch(3, 0, -12),
      pitch(4, 0, 12),
      pitch(6, -8, 12),
    ],
  });
  for (const turned of [false, true]) {
    const drawn = fieldFor(field, 1, turned);
    assert.equal(drawn.length, 4);
    for (const p of drawn) assert.equal("people" in p, false, `pitch ${p.id}`);
  }
});

// A stand-in worker: records what it is sent, answers only when told.
function fakeWorker(log) {
  return {
    posted: [],
    terminated: false,
    postMessage(m) {
      this.posted.push(m);
      log?.push(m.type);
    },
    terminate() {
      this.terminated = true;
    },
  };
}

test("a worker that never answers: no field, nothing waits, ended after openWaitMs", () => {
  let wall = 0;
  let w;
  const nb = new Neighbours({
    workerUrl: "/assets/neighbours-x.js",
    makeWorker: () => (w = fakeWorker()),
    now: () => wall,
  });
  nb.open({ seed: 4, layout: "grid" }, "4:grid");
  assert.equal(w.posted[0].type, "open");
  assert.equal(w.posted[0].args.seed, 4);
  assert.equal(w.posted[0].args.scene, "tournament");
  for (let i = 0; i < 600; i++) {
    nb.tick(1 / 60);
    assert.equal(nb.field(), null, "the still pitches meanwhile");
    wall += 1000 / 60;
  }
  assert.equal(w.posted.length, 1, "no advance before the field opens");
  wall = tune.openWaitMs + 1;
  nb.tick(1 / 60);
  assert.equal(nb.failed, true);
  assert.equal(w.terminated, true);
  assert.equal(nb.field(), null);
});

test("an advance is never queued behind one unanswered; a slow answer ends the worker", () => {
  let wall = 0;
  let w;
  const nb = new Neighbours({
    workerUrl: "x",
    makeWorker: () => (w = fakeWorker()),
    now: () => wall,
  });
  nb.open({ seed: 1 }, "1:grid");
  const open = {
    stakes: [{ x: -2.5, y: 0 }],
    pitches: [
      {
        id: 1,
        offset: { x: -8, y: 0 },
        teams: {
          A: { name: "Brave Birch", players: 3 },
          B: { name: "Lucky Larch", players: 4 },
        },
        items: [
          {
            id: "k",
            kind: "king",
            x: 0,
            y: 4,
            z: 0.15,
            qw: 1,
            qx: 0,
            qy: 0,
            qz: 0,
            toppled: false,
          },
        ],
        phase: "setup",
        at: 0,
      },
    ],
  };
  nb.onMessage({ type: "opened", gen: 1, text: JSON.stringify(open) });
  assert.ok(nb.field());
  nb.tick(0.5);
  nb.tick(0.5);
  nb.tick(0.5);
  const advances = w.posted.filter((m) => m.type === "advance");
  assert.equal(advances.length, 1, "one at a time");
  assert.equal(advances[0].now, 0.5);
  assert.equal(advances[0].budgetMs, 2);
  // the clock keeps going meanwhile; the next ask carries it
  nb.onMessage({ type: "events", gen: 1, text: '{"events":[],"late":0}' });
  nb.tick(0.5);
  assert.equal(w.posted.at(-1).now, 2);
  // an answer for an older opening is dropped
  nb.onMessage({ type: "events", gen: 0, text: "not json" });
  assert.equal(nb.failed, false);
  wall += tune.answerWaitMs + 1;
  nb.tick(0.1);
  assert.equal(nb.failed, true);
  assert.equal(w.terminated, true);
});

test("a worker that cannot be made, or errors, leaves the still pitches", () => {
  const nb = new Neighbours({
    workerUrl: "x",
    makeWorker: () => {
      throw new Error("no workers here");
    },
  });
  nb.open({ seed: 1 }, "k");
  nb.tick(1 / 60);
  assert.equal(nb.failed, true);
  assert.equal(nb.field(), null);
  let w;
  const nb2 = new Neighbours({
    workerUrl: "x",
    makeWorker: () => (w = fakeWorker()),
  });
  nb2.open({ seed: 1 }, "k");
  nb2.onMessage({ type: "error", gen: 1, message: "boom" });
  assert.equal(nb2.failed, true);
  assert.equal(w.terminated, true);
});

test("destroy closes the field, then ends the worker", async () => {
  let w;
  const nb = new Neighbours({
    workerUrl: "x",
    makeWorker: () => (w = fakeWorker()),
  });
  nb.open({ seed: 1 }, "k");
  nb.destroy();
  assert.equal(w.posted.at(-1).type, "close");
  nb.onMessage({ type: "closed", gen: 1 });
  assert.equal(w.terminated, true);
});

// The long axis's upward part of a drawn piece.
const upOf = (it) => 1 - 2 * (it.qx ** 2 + it.qy ** 2);
const lyingKubb = {
  id: "a1",
  kind: "kubb",
  team: "A",
  x: 0.4,
  y: 5,
  z: 0.035,
  qw: Math.SQRT1_2,
  qx: -Math.SQRT1_2,
  qy: 0,
  qz: 0,
  toppled: true,
};
const standingKubb = {
  ...lyingKubb,
  x: 0.45,
  y: 5.08,
  z: 0.075,
  qw: 1,
  qx: 0,
  toppled: false,
};

test("a raised kubb rises over tune.rise rather than appearing standing", () => {
  const field = new Field({
    stakes: [],
    pitches: [
      {
        id: 1,
        offset: { x: 8, y: 0 },
        teams: {},
        items: [lyingKubb],
        phase: "walk",
        at: 0,
      },
    ],
  });
  field.apply([{ id: 1, phase: "raise", at: 10, items: [standingKubb] }]);
  const p = field.pitches[0];
  // the engine's model stands it at once; the drawing rises
  assert.equal(field.itemsAt(p, 10.1)[0].toppled, false);
  const at = (t) => field.shownAt(p, t)[0];
  assert.ok(upOf(at(10)) < 0.1, "lying at the raise");
  const mid = at(10 + tune.rise / 2);
  assert.ok(upOf(mid) > 0.2 && upOf(mid) < 0.9, "part way up");
  assert.ok(mid.z > lyingKubb.z && mid.z < standingKubb.z);
  assert.deepEqual(at(10 + tune.rise + 0.01), standingKubb, "then standing");
  assert.equal(p.rise, null, "done");
});

test("a fresh pitch's pieces rise one after another on setup", () => {
  const king = { ...standingKubb, id: "king", kind: "king", x: 0, y: 4 };
  const b1 = { ...standingKubb, id: "b1", team: "B", x: -2, y: 8 };
  const field = new Field({
    stakes: [],
    pitches: [{ id: 2, offset: { x: -8, y: 0 }, teams: {}, items: [], at: 0 }],
  });
  field.apply([
    { id: 2, phase: "setup", at: 50, items: [standingKubb, king, b1] },
  ]);
  const p = field.pitches[0];
  const shown = (t) => field.shownAt(p, t);
  // the first is half up while the last has yet to start
  const s = shown(50 + tune.setupRise / 2);
  assert.ok(upOf(s[0]) > upOf(s[2]));
  // every piece stays where it will stand while it rises
  for (const it of s) {
    const to = [standingKubb, king, b1].find((q) => q.id === it.id);
    assert.ok(Math.hypot(it.x - to.x, it.y - to.y) < 1e-9);
  }
  const end = 50 + tune.setupRise + 2 * tune.setupEvery + 0.01;
  assert.deepEqual(shown(end), [standingKubb, king, b1]);
});

test("riseOf turns from lying to standing, eased", () => {
  assert.ok(upOf(riseOf(lyingKubb, standingKubb, 0)) < 0.01);
  assert.ok(upOf(riseOf(lyingKubb, standingKubb, 1)) > 0.999);
});
