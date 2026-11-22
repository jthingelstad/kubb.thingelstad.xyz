// A shared pitch's raises arriving together while one is watched (src/net/pitch.js
// drain over the Game's watched raise, src/game/lift.js): the pitch holds its queue while
// the Game's phase is `lift`, as it does during a playback, so every action is applied by
// the Game itself and checked against its committed hash: no resync, the same hashes as
// the browser that raised, every raise watched, and the ones behind hurrying it.
//
// The Pitch is the real one; the Game is the real one's raise-watching methods
// (applyRemote, showAction, startLifts, liftFrame, finishLifts) on a stand-in with no
// canvas: entering a view only notes the need, and drawing does nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { Pitch } from "../../src/net/pitch.js";
import { Game } from "../../src/game/game.js";
import { liftPace, tune as liftTune } from "../../src/game/lift.js";

// A raise of four kubbs by hand for Team A (Team B the computer).
const RAISE = fs.readFileSync("tests/fixtures/snap-raise.json", "utf8");
const sources = bundleLua();

async function engineAt() {
  const e = await Engine.create({ sources });
  e.call("useTune", { name: "pointer" });
  e.restore(RAISE);
  return e;
}

// The hashes after each of n raises on the engine's own choice, as the raising browser
// commits them.
async function committed(n) {
  const e = await engineAt();
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = e.apply({ type: "raise" });
    assert.notEqual(r.ok, false);
    out.push(e.hash().hash);
  }
  return out;
}

// A watcher's Game (Team B's browser, which does not raise) over the real methods.
async function watcherGame() {
  const engine = await engineAt();
  engine.setControl({ sides: ["B"], cpu: false });
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    engine,
    mode: "match",
    queue: [],
    quiet: false,
    liftSkip: false,
    liftState: null,
    reducedMotion: null,
    backlog: null,
    trail: null,
    cards: null,
    lifts: 0,
  });
  g.enter = function (view) {
    this.liftState = null;
    this.viewData = view;
    this.need = view.need;
    this.phase = view.need.kind === "raise" ? "wait" : "aim";
  };
  g.drawLift = () => {};
  const start = g.startLifts;
  g.startLifts = function (...a) {
    this.lifts += 1;
    return start.apply(this, a);
  };
  g.enter(engine.view());
  return g;
}

function pitchFor(game) {
  const p = new Pitch({ game });
  p.mode = "match";
  p.local = { n: 1, seq: 0 };
  p.resyncs = 0;
  p.room = { resync: () => (p.resyncs += 1) };
  return p;
}

for (const n of [2, 3]) {
  test(`${n} raises delivered together on a shared pitch: no resync, the same hashes, each watched and hurried`, async () => {
    const hashes = await committed(n);
    const game = await watcherGame();
    assert.equal(game.need.kind, "raise");
    const pitch = pitchFor(game);
    const now = Date.now();
    pitch.onActs(
      hashes.map((h, i) => ({
        n: 1,
        seq: i + 1,
        a: { type: "raise" },
        h,
        ts: now,
      })),
    );
    // the first is applied and watched; the rest wait in the pitch's queue, held, and
    // count as waiting for the watched raise
    assert.equal(game.phase, "lift");
    assert.equal(pitch.resyncs, 0);
    assert.equal(pitch.queue.length, n - 1);
    assert.equal(game.queue.length, 0, "never handed to the Game during lift");
    assert.equal(game.backlog(), n - 1);
    pitch.drain();
    assert.equal(pitch.queue.length, n - 1, "drain holds during lift");

    // play the frames: each clip, then the pitch drains the next (as onNeed does)
    const beat = liftPace(4).beat;
    const firstWait = [];
    let t = 0;
    let clipT = 0;
    let lastLifts = game.lifts;
    for (
      let f = 0;
      f < 600 && (game.phase === "lift" || pitch.queue.length);
      f++
    ) {
      game.liftFrame(1 / 60);
      t += 1 / 60;
      clipT += 1 / 60;
      if (game.phase !== "lift") {
        firstWait.push(clipT);
        pitch.drain();
        clipT = 0;
      }
      if (game.lifts !== lastLifts) lastLifts = game.lifts;
    }
    assert.equal(pitch.resyncs, 0, "no resync");
    assert.equal(game.lifts, n, "every raise watched");
    assert.equal(game.engine.hash().hash, hashes.at(-1), "the same hash");
    assert.equal(pitch.local.seq, n);
    assert.deepEqual(
      pitch.log.filter((e) => e[1] === "apply").map((e) => e[3]),
      Array(n).fill("ok"),
    );
    // hurried: the first clip ran with n - 1 behind it, the last with none
    assert.ok(
      Math.abs(firstWait[0] - beat / (1 + liftTune.catchUp * (n - 1))) < 0.04,
      `first ${firstWait[0]}`,
    );
    assert.ok(
      Math.abs(firstWait.at(-1) - beat) < 0.04,
      `last ${firstWait.at(-1)}`,
    );
    assert.ok(t < n * beat, "faster than one beat each");
  });
}

test("a wrong hash still asks for the whole pitch, as before", async () => {
  const hashes = await committed(2);
  const game = await watcherGame();
  const pitch = pitchFor(game);
  pitch.onActs([
    { n: 1, seq: 1, a: { type: "raise" }, h: "not-the-hash", ts: Date.now() },
    { n: 1, seq: 2, a: { type: "raise" }, h: hashes[1], ts: Date.now() },
  ]);
  assert.equal(pitch.resyncs, 1);
  assert.equal(pitch.queue.length, 0);
});
