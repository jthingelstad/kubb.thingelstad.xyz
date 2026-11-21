import test from "node:test";
import assert from "node:assert/strict";
import { watcherBases } from "../../src/ui/handoff-words.js";

const need = { teams: { A: "North", B: "South" } };

test("a watcher's bases name both teams, the far team first", () => {
  // to B, from A: the map is B's view frame, A's base at the far end (the top)
  const c = {
    to: "B",
    toName: "South",
    from: "A",
    fromName: "North",
    base: [3, 5],
    baseText: ["YOUR BASE 5", "THEIRS 3"],
  };
  assert.deepEqual(watcherBases(c, need), ["NORTH BASE 3", "SOUTH BASE 5"]);
  // to A: South is the far team
  assert.deepEqual(
    watcherBases({ ...c, to: "A", from: "B", base: [4, 2] }, need),
    ["SOUTH BASE 4", "NORTH BASE 2"],
  );
});

test("the first turn has no `from`: the other team, named from the need", () => {
  const c = { to: "A", toName: "North", turn: 1, base: [5, 5] };
  assert.deepEqual(watcherBases(c, need), ["SOUTH BASE 5", "NORTH BASE 5"]);
  // and with no team names at all, the engine's own fallback
  assert.deepEqual(watcherBases(c, null), ["TEAM B BASE 5", "NORTH BASE 5"]);
});

test("never the engine's YOUR or THEIRS, and nothing without the counts", () => {
  const c = { to: "A", from: "B", base: [5, 5], baseText: ["YOUR BASE 5"] };
  for (const t of watcherBases(c, need)) assert.doesNotMatch(t, /YOUR|THEIRS/);
  assert.deepEqual(watcherBases({ to: "A" }, need), []);
  assert.deepEqual(watcherBases(null, need), []);
});
