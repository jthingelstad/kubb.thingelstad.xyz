// The pitch document's reducers (src/net/lobby.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lobbyOf,
  joinTeam,
  setOptions,
  pruneTeams,
  lineup,
  matchOptions,
  startMatch,
  commitAction,
  backToLobby,
  cleanOptions,
  cleanName,
  sideOf,
  OPTION_DEFAULTS,
  TEAM_MAX,
} from "../../src/net/lobby.js";

const members = (...ids) =>
  ids.map((id) => ({
    id,
    connected: true,
    me: { name: id.toUpperCase(), level: "pro" },
  }));

test("a fresh or expired room reads as an empty lobby", () => {
  for (const doc of [null, undefined, {}, "junk"]) {
    const l = lobbyOf(doc);
    assert.deepEqual(l.teams, { A: [], B: [] });
    assert.deepEqual(l.options, OPTION_DEFAULTS);
    assert.equal(l.started, false);
    assert.equal(l.n, 0);
    assert.equal(l.match, null);
  }
});

test("joining, switching and sitting out", () => {
  let d = joinTeam(null, "m1", "A");
  assert.deepEqual(d.teams, { A: ["m1"], B: [] });
  assert.equal(joinTeam(d, "m1", "A"), undefined, "no change, no write");
  d = joinTeam(d, "m2", "A");
  d = joinTeam(d, "m1", "B");
  assert.deepEqual(d.teams, { A: ["m2"], B: ["m1"] });
  assert.equal(sideOf(d, "m1"), "B");
  d = joinTeam(d, "m1", null);
  assert.deepEqual(d.teams, { A: ["m2"], B: [] });
  assert.equal(sideOf(d, "m1"), null);
  assert.equal(joinTeam(d, "m1", null), undefined);
  assert.equal(joinTeam(d, "m1", "C"), undefined);
});

test("a side holds six", () => {
  let d = null;
  for (let i = 0; i < TEAM_MAX; i++) d = joinTeam(d, `m${i}`, "A");
  assert.equal(d.teams.A.length, 6);
  assert.equal(joinTeam(d, "m9", "A"), undefined);
  assert.ok(joinTeam(d, "m9", "B"));
});

test("teams and options are fixed while a match runs", () => {
  let d = joinTeam(null, "m1", "A");
  d = startMatch(d, {
    snap: "s",
    hash: "h",
    players: { A: [{ id: "m1", name: "M1" }], B: [] },
    cpu: "B",
    host: "m1",
  });
  assert.equal(joinTeam(d, "m2", "B"), undefined);
  assert.equal(setOptions(d, { wind: "strong" }), undefined);
  assert.equal(pruneTeams(d, []), undefined);
});

test("options are cleaned and merged", () => {
  assert.deepEqual(cleanOptions({ surface: "lava", wind: "light", x: 1 }), {
    ...OPTION_DEFAULTS,
    wind: "light",
  });
  const d = setOptions(null, { surface: "snow" });
  assert.equal(d.options.surface, "snow");
  assert.equal(setOptions(d, { surface: "snow" }), undefined);
  assert.equal(setOptions(d, { surface: "lava" }), undefined);
});

test("pruning forgets members who left", () => {
  let d = joinTeam(null, "m1", "A");
  d = joinTeam(d, "m2", "B");
  assert.deepEqual(pruneTeams(d, ["m1"]).teams, { A: ["m1"], B: [] });
  assert.equal(pruneTeams(d, ["m1", "m2"]), undefined);
});

test("the lineup puts the computer on an empty side", () => {
  assert.equal(lineup(null, []), null);
  let d = joinTeam(null, "a", "A");
  d = joinTeam(d, "gone", "A");
  let lu = lineup(d, members("a"));
  assert.deepEqual(lu.players.A, [{ id: "a", name: "A", level: "pro" }]);
  assert.equal(lu.cpu, "B");
  d = joinTeam(d, "b", "B");
  lu = lineup(d, members("a", "b"));
  assert.equal(lu.cpu, null);
  const o = matchOptions(d, lu, { seed: 7, start: { year: 2026 } });
  assert.equal(o.seed, 7);
  assert.deepEqual(o.cpu, []);
  assert.equal(o.first, "A");
  assert.deepEqual(o.teams.A.players, [{ name: "A", key: "a", level: "pro" }]);
  assert.equal(o.surface, "grass");
  const solo = matchOptions(
    d,
    { players: { A: [], B: lu.players.B }, cpu: "A" },
    { seed: 1 },
  );
  assert.equal(solo.cpu, "A");
  assert.equal(solo.teams.A.name, "Computer");
});

test("names are trimmed and capped", () => {
  assert.equal(cleanName("  Jo   Ann  "), "Jo Ann");
  assert.equal(cleanName("x".repeat(40)).length, 16);
  assert.equal(cleanName(7), "");
});

test("actions commit in order; a stale one is refused", () => {
  let d = joinTeam(null, "a", "A");
  const players = { A: [{ id: "a", name: "A", level: "pro" }], B: [] };
  d = startMatch(d, { snap: "s0", hash: "h0", players, cpu: "B", host: "a" });
  assert.equal(d.started, true);
  assert.equal(d.n, 1);
  assert.deepEqual(
    d.match.players.A,
    [{ id: "a", name: "A" }],
    "level left out",
  );
  assert.equal(
    startMatch(d, { snap: "x", hash: "x", players, cpu: "B", host: "a" }),
    undefined,
  );
  d = commitAction(d, { n: 1, seq: 1, snap: "s1", hash: "h1" });
  assert.equal(d.match.seq, 1);
  assert.equal(d.match.snap, "s1");
  assert.equal(
    commitAction(d, { n: 1, seq: 1, snap: "s1b", hash: "h" }),
    undefined,
    "the loser",
  );
  assert.equal(
    commitAction(d, { n: 1, seq: 3, snap: "s3", hash: "h" }),
    undefined,
    "a gap",
  );
  assert.equal(
    commitAction(d, { n: 2, seq: 2, snap: "s", hash: "h" }),
    undefined,
    "another match",
  );
  assert.equal(backToLobby(d, 2), undefined);
  d = backToLobby(d, 1);
  assert.equal(d.started, false);
  assert.equal(d.match, null);
  assert.deepEqual(d.teams.A, ["a"], "same teams for the rematch");
  assert.equal(d.n, 1);
});

test("the snapshot text is kept as text", () => {
  const snap = '{"x":3.0}';
  const d = startMatch(null, {
    snap,
    hash: "h",
    players: { A: [], B: [] },
    cpu: null,
    host: "a",
  });
  assert.equal(JSON.parse(JSON.stringify(d)).match.snap, snap);
});
