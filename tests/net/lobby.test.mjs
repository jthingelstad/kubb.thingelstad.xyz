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
  LOG_BUDGET,
  replayOf,
  isReplay,
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

// ---------- the replay's log (docs/MULTIPLAYER.md "The document") ----------

const P1 = { A: [{ id: "a", name: "Ann", level: "pro" }], B: [] };
const SETUP = { seed: 7, teams: { A: { name: "A" } }, cpu: "B" };
const throwOf = (i) => ({ type: "throw", arm: i });

function played(actions, { over = true } = {}) {
  let d = startMatch(joinTeam(null, "a", "A"), {
    snap: "s0",
    hash: "h0",
    players: P1,
    cpu: "B",
    host: "a",
    setup: SETUP,
  });
  actions.forEach((a, i) => {
    d = commitAction(d, {
      n: 1,
      seq: i + 1,
      snap: `s${i + 1}`,
      hash: `h${i + 1}`,
      action: a,
      over: over && i === actions.length - 1,
    });
  });
  return d;
}

test("each action is logged with its hash; the last marks the match over", () => {
  const d = played([throwOf(1), { type: "raise", choice: 1 }, throwOf(2)]);
  assert.deepEqual(d.match.setup, SETUP);
  assert.equal(d.match.h0, "h0");
  assert.deepEqual(d.match.log, [
    { a: throwOf(1), h: "h1" },
    { a: { type: "raise", choice: 1 }, h: "h2" },
    { a: throwOf(2), h: "h3" },
  ]);
  assert.equal(d.match.over, true);
  const r = replayOf(d.match);
  assert.deepEqual(r, {
    v: 1,
    n: 1,
    setup: SETUP,
    h0: "h0",
    log: d.match.log,
    snap: "s3",
    hash: "h3",
    players: d.match.players,
    cpu: "B",
  });
  assert.ok(isReplay(JSON.parse(JSON.stringify(r))));
  assert.equal(
    replayOf(played([throwOf(1)], { over: false }).match),
    null,
    "not over",
  );
});

test("a match with no whole log has no replay", () => {
  // from before replays: no setup, no log
  let d = startMatch(null, {
    snap: "s0",
    hash: "h0",
    players: P1,
    cpu: "B",
    host: "a",
  });
  d = commitAction(d, {
    n: 1,
    seq: 1,
    snap: "s1",
    hash: "h1",
    action: throwOf(1),
    over: true,
  });
  assert.equal(d.match.log, undefined);
  assert.equal(replayOf(d.match), null);
  // an older browser's commit (no action) breaks the log for good
  d = played([throwOf(1)], { over: false });
  d = commitAction(d, { n: 1, seq: 2, snap: "s2", hash: "h2" });
  assert.equal(d.match.log, null);
  d = commitAction(d, {
    n: 1,
    seq: 3,
    snap: "s3",
    hash: "h3",
    action: throwOf(3),
    over: true,
  });
  assert.equal(d.match.log, null);
  assert.equal(replayOf(d.match), null);
  // and garbage is not a replay
  for (const x of [
    null,
    {},
    { v: 2, setup: {}, log: [], snap: "" },
    { v: 1, setup: {}, log: [null], snap: "" },
  ])
    assert.equal(isReplay(x), false);
});

test("a log that would outgrow the document is dropped: no replay for that match", () => {
  const big = { type: "throw", pad: "x".repeat(4000) };
  const n = Math.ceil(LOG_BUDGET / 4000) + 2;
  const d = played(Array.from({ length: n }, () => big));
  assert.equal(d.match.log, null);
  assert.equal(d.match.seq, n);
  assert.equal(replayOf(d.match), null);
});

test("a rematch drops the match; its replay was the room's to keep", () => {
  const d = backToLobby(played([throwOf(1)]), 1);
  assert.equal(d.match, null);
});
