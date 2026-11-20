// The room's engine through the web's wrappers (src/net/lobby.js, sync.js), with both
// engines this checkout carries registered: 0.8 the newest and 0.7 beside it. The rules
// are kubb-engine's (room/engines.lua, its tests); what these pin is that the web asks
// the newest for them and runs START, a commit, `decide` and a rider on the match's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../src/engine/index.js";
import { bundleLua, carriedEngines } from "../../tools/lua-bundle.mjs";
import {
  ENGINE,
  useRoomEngine,
  useOlderEngine,
  roomEngineFor,
  carriedBy,
  announce,
  speakAs,
  compareEngines,
  startCheck,
  startMatch,
  commitAction,
  mayPlay,
} from "../../src/net/lobby.js";
import { decide, rider } from "../../src/net/sync.js";
import { roomMinor } from "../../src/net/room-engine.js";

const [newest, older] = await Promise.all(
  carriedEngines().map(({ dir }) => Engine.create({ sources: bundleLua(dir) })),
);
useRoomEngine(newest);
useOlderEngine(older);

const doc = { v: 1, teams: { A: ["a"], B: ["b"] } };
const both = { engine: "0.8+engines", engines: ["0.8", "0.7"] };
const member = (id, me) => ({ id, connected: true, me });

test("this checkout carries 0.8 and 0.7", () => {
  assert.equal(ENGINE, "0.8");
  assert.deepEqual([newest.version, older.version], ["0.8.1", "0.7.4"]);
  assert.equal(roomMinor("0.7.4"), "0.7");
  assert.equal(roomMinor("0.6"), "0.8");
  assert.equal(roomMinor(null), "0.8");
});

test("what a page carrying both says, and how a member is read", () => {
  assert.deepEqual(announce(["0.8", "0.7"]), both);
  assert.deepEqual(announce(["0.8", "0.7"], "0.7"), {
    engine: "0.7+engines",
    engines: ["0.8", "0.7"],
  });
  assert.deepEqual(carriedBy(both), ["0.8", "0.7"]);
  // an older tab under the same member id: its lone engine, not the stale list
  assert.deepEqual(carriedBy({ ...both, engine: "0.7" }), ["0.7"]);
  assert.deepEqual(carriedBy({ engine: "0.7.4" }), ["0.7"]);
  assert.deepEqual(carriedBy({}), []);
  assert.deepEqual(carriedBy(null), []);
  assert.equal(compareEngines("0.7", "0.8"), -1);
  assert.equal(compareEngines("0.10", "0.9"), 1);
});

test("the room's engine: the newest the host and every player carry", () => {
  const two = [member("a", both), member("b", both)];
  assert.equal(roomEngineFor(doc, two, "a").engine, "0.8");
  const iphone = [member("a", both), member("b", { engine: "0.7" })];
  assert.equal(roomEngineFor(doc, iphone, "a").engine, "0.7");
  // a watcher on 0.7 does not count
  const watched = [...two, member("w", { engine: "0.7" })];
  assert.equal(roomEngineFor(doc, watched, "a").engine, "0.8");
  // this browser's own presence still on its way: what it carries counts
  const early = [member("a", both), member("b", {})];
  assert.equal(roomEngineFor(doc, early, "a").engine, null);
  assert.equal(
    roomEngineFor(doc, early, "a", "b", ["0.8", "0.7"]).engine,
    "0.8",
  );
  const none = [member("a", both), member("b", { engine: "0.3" })];
  assert.deepEqual(roomEngineFor(doc, none, "a"), {
    engine: null,
    missing: ["b"],
    unknown: [],
  });
});

test("START on 0.7 stamps 0.7; the match's commit, decide and rider run on 0.7", () => {
  // the guest's new announcement has not come back: speakAs lets it in on 0.7
  const members = [member("a", both), member("b", both)];
  const players = { A: [{ id: "a", name: "A" }], B: [{ id: "b", name: "B" }] };
  assert.equal(startCheck(players, members, "a", "0.7").ok, false);
  const spoken = speakAs(members, "0.7");
  assert.equal(spoken[1].me.engine, "0.7");
  assert.equal(startCheck(players, spoken, "a", "0.7").ok, true);
  older.newMatch({ seed: 6, cpu: null });
  const snap = older.snapshot();
  const hash = older.hash().hash;
  const start = { snap, hash, players, cpu: null, host: "a", members: spoken };
  const d = startMatch({ ...doc }, start, "0.7");
  assert.equal(d.match.engine, "0.7");
  // the newest stamps its own, and refuses players spoken down to 0.7
  assert.equal(
    startMatch({ ...doc }, { ...start, members }).match.engine,
    "0.8",
  );
  assert.equal(startMatch({ ...doc }, start), undefined);
  assert.equal(mayPlay("0.7", d.match, "0.7").ok, true);
  assert.equal(mayPlay("0.8", d.match).why, "differs");

  // every call a 0.7 match makes goes to the 0.7 engine
  const asked = [];
  const call = older.call.bind(older);
  older.call = (name, args) => (asked.push(name), call(name, args));
  try {
    const next = commitAction(
      { ...d },
      { n: 1, seq: 1, snap, hash, action: { type: "x" }, over: false },
      "0.7",
    );
    assert.equal(next.match.seq, 1);
    assert.equal(
      decide({ n: 1, seq: 0 }, next, undefined, false).kind,
      "adopt",
    );
    const w = rider(1, 1, { type: "x" }, { engine: older.version });
    assert.equal(w.e, "0.7.4");
    assert.deepEqual(asked, ["room.commitAction", "room.decide", "room.rider"]);
  } finally {
    older.call = call;
  }
});
