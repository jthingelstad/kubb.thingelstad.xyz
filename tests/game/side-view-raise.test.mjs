// A raise by hand made for the other side (a host standing in for a player who left) is
// seen from the raiser's side (engine 1.4.1's held raise camera stands over the lying
// group from the raiser's side; the iPhone app's PR 65): Game.applySideView turns the
// engine's view to that side for the raise, as it does for a stand-in's throw, and a
// browser that only watches the raise keeps its own side. The real engine, on a stand-in
// Game with no canvas.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { Game } from "../../src/game/game.js";

// A raise of four kubbs by hand for Team A (Team B the computer).
const RAISE = fs.readFileSync("tests/fixtures/snap-raise.json", "utf8");
const sources = bundleLua();

async function gameAs(local, mayAct) {
  const engine = await Engine.create({ sources });
  engine.call("useTune", { name: "pointer" });
  engine.restore(RAISE);
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    engine,
    mode: "match",
    seat: { sides: [local], mayAct: () => mayAct },
    _localSide: local,
    sideKey: null,
    W: 844,
    H: 390,
    L: { safe: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  return g;
}

test("a stand-in's raise for the other side is seen from that side; a watcher keeps its own", async () => {
  // Team B's browser raising Team A's kubbs for it
  const host = await gameAs("B", true);
  const n = host.engine.need();
  assert.equal(n.kind, "raise");
  assert.equal(n.side, "A");
  host.applySideView(n, { refetch: false });
  const v = host.engine.view();
  assert.equal(v.need.frame, "A", "the raiser's frame");
  assert.equal(v.need.camera?.kind, "raise", "the held raise camera");
  // Team B's browser only watching the raise: its own side
  const watcher = await gameAs("B", false);
  watcher.applySideView(watcher.engine.need(), { refetch: false });
  assert.equal(watcher.engine.view().need.frame, "B");
  // and Team A's own browser: its own side, as before
  const own = await gameAs("A", true);
  own.applySideView(own.engine.need(), { refetch: false });
  assert.equal(own.engine.view().need.frame, "A");
});
