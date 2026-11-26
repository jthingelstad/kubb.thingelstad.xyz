// The room's engine through the web's wrappers (src/net/lobby.js, sync.js) with the two
// engines this checkout carries: 1.4 the newest and 1.0 beside it, for the iPhone app's
// App Store and TestFlight builds (docs/ENGINES.md). The rules are kubb-engine's
// (pitch/engines.lua and its tests); what these pin is the web's side of the rule: a
// page announces both, a pitch with a 1.0 player plays 1.0 (with none of 1.4's
// options), a player on an older client (an iPhone build on 0.9) leaves the pitch with
// no engine in common, so START cannot run, and a match on an engine this page does not
// carry is never this page's to play.
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
  startCheck,
  startMatch,
  commitAction,
  mayPlay,
  optionsOf,
  optionRows,
  setOptions,
  lineup,
  matchOptions,
  engineConstants,
  setTeamName,
  lobbyOf,
  joinTeam,
} from "../../src/net/lobby.js";
import { decide, rider } from "../../src/net/sync.js";
import { roomMinor } from "../../src/net/room-engine.js";

const engines = carriedEngines();
const [newest, one] = await Promise.all(
  engines.map(({ dir }) => Engine.create({ sources: bundleLua(dir) })),
);
useRoomEngine(newest);
useOlderEngine(one);

const APP_VERSION = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url)),
).version;
const doc = { v: 1, teams: { A: ["a"], B: ["b"] } };
const page = announce(engines.map((e) => e.mm));
// the iPhone app's App Store build 260 and its TestFlight builds: engine 1.0 alone
const iphone10 = { engine: "1.0+engines", engines: ["1.0"] };
// the iPhone app on engine 0.9, carrying 0.8 and 0.7 beside it
const iphone09 = { engine: "0.9+engines", engines: ["0.9", "0.8", "0.7"] };
const member = (id, me) => ({ id, connected: true, me });

test("this checkout carries 1.4 and 1.0", () => {
  assert.equal(ENGINE, "1.4");
  assert.deepEqual(
    engines.map((e) => e.mm),
    ["1.4", "1.0"],
  );
  assert.equal(newest.version, engines[0].version);
  assert.equal(one.version, "1.0.0");
  assert.equal(roomMinor("1.0.0"), "1.0");
  // a match of any other engine is looked up on the newest (and refused to play)
  assert.equal(roomMinor("0.9.0"), ENGINE);
  assert.equal(roomMinor(null), ENGINE);
  // what a page says of itself: both, and no app version
  assert.deepEqual(page, { engine: "1.4+engines", engines: ["1.4", "1.0"] });
  assert.deepEqual(carriedBy(page), ["1.4", "1.0"]);
});

test("a pitch with the iPhone app on 1.0 plays 1.0, whoever hosts; 1.4's options are not there", () => {
  const two = [member("a", page), member("b", page)];
  assert.equal(roomEngineFor(doc, two, "a").engine, "1.4");
  const phone = [member("a", page), member("b", iphone10)];
  assert.equal(roomEngineFor(doc, phone, "a").engine, "1.0");
  assert.equal(roomEngineFor(doc, phone, "b").engine, "1.0");
  // a watcher on 1.0 does not count: the pitch plays 1.4
  assert.equal(
    roomEngineFor(doc, [...two, member("w", iphone10)], "a").engine,
    "1.4",
  );
  // the throw to go: a row and a setting on 1.4, neither on 1.0
  const rows = (mm) => optionRows("day", mm).rows.map(([k]) => k);
  assert.ok(rows("1.4").includes("togo"), JSON.stringify(rows("1.4")));
  assert.ok(!rows("1.0").includes("togo"));
  const on = setOptions({ ...doc }, { togo: "on" });
  assert.equal(optionsOf(on, "1.4").togo, "on");
  // a 1.0 client's rewrite drops it (its reducers do not know it)
  const rewritten = setOptions(on, { wind: "light" }, "1.0");
  assert.equal(rewritten.settings?.togo, undefined);
  // and a 1.0 match never throws to go, whatever the document says
  const lu = lineup(on, phone);
  const start = { year: 2026, month: 11, day: 26, hour: 12, min: 0 };
  assert.ok(!("togo" in matchOptions(on, lu, { seed: 7, start }, "1.0")));
  assert.equal(matchOptions(on, lu, { seed: 7, start }, "1.4").togo, "on");
  // a person's throw level: 1.4 has the levels, 1.0 has none
  assert.deepEqual(engineConstants("1.4").THROW_LEVELS, [
    "easy",
    "standard",
    "hard",
  ]);
  assert.equal(engineConstants("1.0").THROW_LEVELS, undefined);
});

test("a player on an older client: no engine in common, so START cannot run", () => {
  const two = [member("a", page), member("b", page)];
  assert.equal(roomEngineFor(doc, two, "a").engine, ENGINE);
  // the iPhone still on 0.9 as a player: no engine every player carries
  const phone = [member("a", page), member("b", iphone09)];
  assert.deepEqual(roomEngineFor(doc, phone, "a"), {
    engine: null,
    missing: ["b"],
    unknown: [],
  });
  // and as host: the same
  assert.equal(roomEngineFor(doc, phone, "b").engine, null);
  // a client too old to name its engine
  const silent = [member("a", page), member("b", {})];
  assert.deepEqual(roomEngineFor(doc, silent, "a").unknown, ["b"]);
  // a watcher on 0.9 does not count: the pitch plays the newest
  const watched = [...two, member("w", iphone09)];
  assert.equal(roomEngineFor(doc, watched, "a").engine, ENGINE);
  // START's own check refuses the 0.9 player on the newest
  const players = {
    A: [{ id: "a", name: "Mighty Maple" }],
    B: [{ id: "b", name: "Lucky Larch" }],
  };
  const ok = startCheck(players, speakAs(phone, ENGINE), "a", ENGINE);
  assert.equal(ok.ok, false);
  assert.deepEqual([...ok.differ, ...ok.unknown], ["b"]);
});

test("a match started on the newest plays there; one on 0.9 is never this page's", () => {
  const members = [member("a", page), member("b", page)];
  const players = {
    A: [{ id: "a", name: "Mighty Maple" }],
    B: [{ id: "b", name: "Lucky Larch" }],
  };
  newest.newMatch({ seed: 6, cpu: null });
  const snap = newest.snapshot();
  const hash = newest.hash().hash;
  const d = startMatch(
    { ...doc },
    { snap, hash, players, cpu: null, host: "a", members },
  );
  assert.equal(d.match.engine, ENGINE);
  assert.equal(mayPlay(ENGINE, d.match).ok, true);
  // a match an iPhone host started on 0.9: this page may not play it
  assert.equal(mayPlay(ENGINE, { ...d.match, engine: "0.9" }).ok, false);

  const asked = [];
  const call = newest.call.bind(newest);
  newest.call = (name, args) => (asked.push(name), call(name, args));
  try {
    const next = commitAction(
      { ...d },
      { n: 1, seq: 1, snap, hash, action: { type: "x" }, over: false },
    );
    assert.equal(next.match.seq, 1);
    assert.equal(
      decide({ n: 1, seq: 0 }, next, undefined, false).kind,
      "adopt",
    );
    const w = rider(1, 1, { type: "x" }, { engine: newest.version });
    assert.equal(w.e, newest.version);
    // the rider names the client and the engine, never the app's version
    assert.equal(w.c, "web");
    // (web 0.15.0 runs on engine 0.15.0: the engine's field may say the same number)
    const { e: engineField, ...rest } = w;
    assert.equal(engineField, newest.version);
    assert.ok(!JSON.stringify(rest).includes(APP_VERSION));
    // the bridge says pitch., the engine's own spelling since 0.13
    assert.deepEqual(asked, [
      "pitch.commitAction",
      "pitch.decide",
      "pitch.rider",
    ]);
  } finally {
    newest.call = call;
  }
});

test("the host sets the computer's level; the match starts with it", () => {
  const set = setOptions(
    { v: 1, teams: { A: ["a"], B: [] } },
    { wind: "light", computer: "pro" },
  );
  assert.deepEqual(set.settings, { computer: "pro" });
  const o = optionsOf(set);
  assert.equal(o.computer, "pro");
  assert.equal(o.scene, "day");
  assert.equal(o.wind, "light");
  assert.ok(engineConstants().MATCH_OPTIONS.some(([k]) => k === "computer"));
  const lu = lineup(set, [member("a", page)]);
  assert.equal(lu.cpu, "B");
  const start = { year: 2026, month: 11, day: 20, hour: 12, min: 0 };
  const m = matchOptions(set, lu, { seed: 7, start });
  assert.equal(m.computer, "pro");
  newest.newMatch(m);
  const opts = JSON.parse(newest.snapshot()).opts;
  assert.equal(opts.computer, "pro");
  assert.deepEqual(
    opts.teams.B.players.map((p) => p.level),
    ["pro"],
  );
});

test("a side's team name is the document's own key, kept by the engine's reducers", () => {
  const d0 = { v: 1, teams: { A: [], B: [] } };
  const d1 = setTeamName(d0, "A", "Wobbly Towers");
  assert.deepEqual(d1.teamNames, { A: "Wobbly Towers" });
  assert.equal(setTeamName(d1, "A", "Wobbly Towers"), undefined, "no change");
  assert.equal(setTeamName(d1, "C", "Wobbly Towers"), undefined);
  // the engine's reducers keep a key they do not know
  const d2 = joinTeam(d1, "a", "A");
  assert.deepEqual(d2.teamNames, { A: "Wobbly Towers" });
  const d3 = setOptions(d2, { wind: "light" });
  assert.deepEqual(d3.teamNames, { A: "Wobbly Towers" });
  assert.deepEqual(lobbyOf(d3).teams.A, ["a"]);
  // a side of one plays under its player's name; the host puts the team's name on a
  // side of several (src/net/pitch.js start)
  const lu = lineup(joinTeam(d3, "b", "A"), [
    member("a", { ...page, name: "Mighty Maple" }),
    member("b", { ...page, name: "Lucky Larch" }),
  ]);
  const start = { year: 2026, month: 11, day: 20, hour: 12, min: 0 };
  const m = matchOptions(d3, lu, { seed: 7, start });
  assert.equal(
    m.teams.A.name,
    "Team A",
    "the engine's default, renamed by the host",
  );
});
