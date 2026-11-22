// The room's engine through the web's wrappers (src/net/lobby.js, sync.js), with the
// four engines this checkout carries registered: 0.13 the newest, 0.9, 0.8 and 0.7 beside
// it. The rules are kubb-engine's (pitch/engines.lua, room/ before 0.13, and its tests);
// what these pin is that the web asks the newest for them and runs START, a commit,
// `decide` and a rider on the match's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  optionsOf,
  setOptions,
  lineup,
  matchOptions,
  engineConstants,
} from "../../src/net/lobby.js";
import { decide, rider } from "../../src/net/sync.js";
import { roomMinor } from "../../src/net/room-engine.js";

const [newest, nine, middle, older] = await Promise.all(
  carriedEngines().map(({ dir }) => Engine.create({ sources: bundleLua(dir) })),
);
useRoomEngine(newest);
useOlderEngine(nine);
useOlderEngine(middle);
useOlderEngine(older);

const APP_VERSION = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url)),
).version;
const doc = { v: 1, teams: { A: ["a"], B: ["b"] } };
const both = {
  engine: "0.13+engines",
  engines: ["0.13", "0.9", "0.8", "0.7"],
};
// the iPhone app on engine 0.9, carrying 0.8 and 0.7 beside it
// (throwingwood-ios scripts/vendor-engine.sh: TAG v0.9.0, OLDER v0.8.2 v0.7.4)
const iphone09 = { engine: "0.9+engines", engines: ["0.9", "0.8", "0.7"] };
// an iPhone build that carries 0.8 and 0.7 (TestFlight build 121)
const iphone08 = { engine: "0.8+engines", engines: ["0.8", "0.7"] };
const member = (id, me) => ({ id, connected: true, me });

test("this checkout carries 0.13, 0.9, 0.8 and 0.7", () => {
  assert.equal(ENGINE, "0.13");
  assert.deepEqual(
    [newest.version, nine.version, middle.version, older.version],
    ["0.13.1", "0.9.0", "0.8.2", "0.7.4"],
  );
  assert.equal(roomMinor("0.9.0"), "0.9");
  assert.equal(roomMinor("0.8.1"), "0.8");
  assert.equal(roomMinor("0.7.4"), "0.7");
  assert.equal(roomMinor("0.6"), "0.13");
  assert.equal(roomMinor(null), "0.13");
});

test("what a page carrying both says, and how a member is read", () => {
  // what a page says of itself is its engines only: no app version
  assert.deepEqual(announce(["0.13", "0.9", "0.8", "0.7"]), both);
  assert.deepEqual(announce(["0.13", "0.9", "0.8", "0.7"], "0.9"), {
    engine: "0.9+engines",
    engines: ["0.13", "0.9", "0.8", "0.7"],
  });
  assert.deepEqual(carriedBy(both), ["0.13", "0.9", "0.8", "0.7"]);
  assert.deepEqual(carriedBy(iphone09), ["0.9", "0.8", "0.7"]);
  assert.deepEqual(carriedBy(iphone08), ["0.8", "0.7"]);
  // an older tab under the same member id: its lone engine, not the stale list
  assert.deepEqual(carriedBy({ ...both, engine: "0.7" }), ["0.7"]);
  assert.deepEqual(carriedBy({ engine: "0.7.4" }), ["0.7"]);
  assert.deepEqual(carriedBy({}), []);
  assert.deepEqual(carriedBy(null), []);
  assert.equal(compareEngines("0.7", "0.8"), -1);
  assert.equal(compareEngines("0.10", "0.9"), 1);
  assert.equal(compareEngines("0.13", "0.9"), 1);
});

test("the room's engine: the newest the host and every player carry", () => {
  const two = [member("a", both), member("b", both)];
  assert.equal(roomEngineFor(doc, two, "a").engine, "0.13");
  // the iPhone app still on 0.9 (with 0.8 and 0.7): the pitch plays 0.9, whoever hosts
  const phone = [member("a", both), member("b", iphone09)];
  assert.equal(roomEngineFor(doc, phone, "a").engine, "0.9");
  assert.equal(roomEngineFor(doc, phone, "b").engine, "0.9");
  // and a client that names 0.9 alone (no +engines)
  const lone = [member("a", both), member("b", { engine: "0.9.0" })];
  assert.equal(roomEngineFor(doc, lone, "a").engine, "0.9");
  // an iPhone tester's build that carries 0.8 and 0.7: the pitch falls to 0.8
  const mixed = [member("a", both), member("b", iphone08)];
  assert.equal(roomEngineFor(doc, mixed, "a").engine, "0.8");
  // and the iPhone as host
  assert.equal(roomEngineFor(doc, mixed, "b").engine, "0.8");
  const iphone = [member("a", both), member("b", { engine: "0.7" })];
  assert.equal(roomEngineFor(doc, iphone, "a").engine, "0.7");
  // a watcher on 0.7 does not count
  const watched = [...two, member("w", { engine: "0.7" })];
  assert.equal(roomEngineFor(doc, watched, "a").engine, "0.13");
  // this browser's own presence still on its way: what it carries counts
  const early = [member("a", both), member("b", {})];
  assert.equal(roomEngineFor(doc, early, "a").engine, null);
  assert.equal(
    roomEngineFor(doc, early, "a", "b", ["0.13", "0.9", "0.8", "0.7"]).engine,
    "0.13",
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
    "0.13",
  );
  assert.equal(startMatch({ ...doc }, start), undefined);
  assert.equal(mayPlay("0.7", d.match, "0.7").ok, true);
  assert.equal(mayPlay("0.13", d.match).why, "differs");

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
    // the rider names the client and the engine, never the app's version: web and
    // iPhone players are alike on the wire (src/site/release.js)
    assert.equal(w.c, "web");
    assert.ok(!JSON.stringify(w).includes(APP_VERSION));
    assert.deepEqual(asked, ["room.commitAction", "room.decide", "room.rider"]);
  } finally {
    older.call = call;
  }
});

// The web on 0.13 and the iPhone app still on 0.9: the web speaks down, START runs on
// 0.9 and stamps it, the iPhone's own checks pass, and the match's calls go to 0.9.
test("a pitch with an iPhone still on 0.9 starts on 0.9, and the match plays on 0.9", () => {
  const members = [member("a", both), member("b", iphone09)];
  const room = roomEngineFor(doc, members, "a");
  assert.equal(room.engine, "0.9");
  assert.deepEqual(room.missing, []);
  // what the web announces once it knows the pitch: the iPhone reads 0.9
  const said = announce(["0.13", "0.9", "0.8", "0.7"], room.engine);
  assert.equal(said.engine, "0.9+engines");
  const spoken = speakAs(
    [member("a", said), member("b", iphone09)],
    room.engine,
  );
  const players = { A: [{ id: "a", name: "A" }], B: [{ id: "b", name: "B" }] };
  assert.equal(startCheck(players, spoken, "a", "0.9").ok, true);
  nine.newMatch({ seed: 6, cpu: null });
  const snap = nine.snapshot();
  const hash = nine.hash().hash;
  const start = { snap, hash, players, cpu: null, host: "a", members: spoken };
  const d = startMatch({ ...doc }, start, "0.9");
  assert.equal(d.match.engine, "0.9");
  // the iPhone (one engine on the wire: 0.9) may play it, and so may this page on 0.9
  assert.equal(mayPlay("0.9.0", d.match, "0.9").ok, true);
  assert.equal(mayPlay("0.9", d.match, "0.9").ok, true);
  // the newest would refuse it: the match is 0.9's
  assert.equal(mayPlay("0.13", d.match).why, "differs");
  // the match's calls go to 0.9
  const asked = [];
  const call = nine.call.bind(nine);
  nine.call = (name, args) => (asked.push(name), call(name, args));
  try {
    commitAction(
      { ...d },
      { n: 1, seq: 1, snap, hash, action: { type: "x" }, over: false },
      "0.9",
    );
    const w = rider(1, 1, { type: "x" }, { engine: nine.version });
    assert.equal(w.e, "0.9.0");
    assert.deepEqual(asked, ["room.commitAction", "room.rider"]);
  } finally {
    nine.call = call;
  }
});

// The computer's level is a match option since 0.9, kept in the document's `settings`.
test("the host sets the computer's level: 0.9 on reads it and starts with it, 0.8 leaves it be", () => {
  const set = setOptions(
    { v: 1, teams: { A: ["a"], B: [] } },
    { wind: "light", computer: "pro" },
  );
  assert.deepEqual(set.settings, { computer: "pro" });
  for (const mm of ["0.13", "0.9"])
    assert.equal(optionsOf(set, mm).computer, "pro", mm);
  const o9 = optionsOf(set, "0.9");
  assert.equal(o9.computer, "pro");
  assert.equal(o9.scene, "day", "the scene is carried, its default filled in");
  assert.equal(o9.wind, "light");
  // an engine before 0.9 has no optionsOf: its lobby's five, asked again and again
  for (let i = 0; i < 2; i++) {
    const o8 = optionsOf(set, "0.8");
    assert.equal(o8.wind, "light");
    assert.equal(o8.computer, undefined);
  }
  // the rows: Computer on 0.9 only
  const keys = (mm) => engineConstants(mm).MATCH_OPTIONS.map(([k]) => k);
  assert.ok(keys("0.13").includes("computer"));
  assert.ok(keys("0.9").includes("computer"));
  assert.ok(!keys("0.8").includes("computer"));
  assert.ok(!keys("0.7").includes("computer"));

  const members = [member("a", both)];
  const lu = lineup(set, members);
  assert.equal(lu.cpu, "B");
  const start = { year: 2026, month: 11, day: 20, hour: 12, min: 0 };
  const m9 = matchOptions(set, lu, { seed: 7, start }, "0.9");
  assert.equal(m9.computer, "pro");
  // the match starts on 0.9 with the computer at Pro: its setup says so
  nine.newMatch(m9);
  const opts = JSON.parse(nine.snapshot()).opts;
  assert.equal(opts.computer, "pro");
  assert.deepEqual(
    opts.teams.B.players.map((p) => p.level),
    ["pro"],
    "the computer throws at Pro",
  );
  // on a 0.8 room the option is not passed: the match it always started
  const m8 = matchOptions(set, lu, { seed: 7, start }, "0.8");
  assert.equal(m8.computer, undefined);
  assert.equal(m8.wind, "light");
  // a 0.8 client's write keeps the host's settings (a top-level key it does not know)
  const kept = setOptions(set, { wind: "strong" });
  assert.deepEqual(kept.settings, { computer: "pro" });
});
