// The web's adaptation of room.*: JSON arguments/results, reducer no-ops and
// caching. The room rules themselves are covered by kubb-engine's vectors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine } from "./room-engine.mjs";
import {
  ENGINE,
  LENIENT_ENGINES,
  TEAM_MAX,
  SEATS,
  MATCH_OPTIONS,
  LEVELS,
  lobbyOf,
  joinTeam,
  setOptions,
  setAccess,
  pruneTeams,
  lineup,
  matchOptions,
  startCheck,
  startMatch,
  commitAction,
  backToLobby,
  replayOf,
  isReplay,
  mayPlay,
  cleanName,
  cleanOptions,
  optionLabel,
  sideOf,
  openListing,
} from "../../src/net/lobby.js";
import {
  actorsFor,
  mayAct,
  shownActor,
  controlFor,
  sameControl,
  playingSide,
  nextHost,
} from "../../src/net/seats.js";
import { decide, rider, asciiSize, aimKey } from "../../src/net/sync.js";
import { roomCallCount } from "../../src/net/room-engine.js";

const members = [
  {
    id: "a",
    connected: true,
    me: { name: "Ann", level: "pro", engine: ENGINE },
  },
  {
    id: "b",
    connected: true,
    me: { name: "Bo", level: "club", engine: ENGINE },
  },
];
const snap = '{"n":3.0}';
const players = { A: [{ id: "a", name: "Ann" }], B: [{ id: "b", name: "Bo" }] };
const start = {
  snap,
  hash: "h0",
  players,
  cpu: null,
  host: "a",
  members,
  setup: { seed: 7 },
};

test("the bridge unwraps values and every document reducer preserves unknown keys", () => {
  const extra = {
    empty: {},
    list: [],
    nil: null,
    nested: { label: "next 🪵" },
  };
  let doc = { future: extra, error: "a document key, not a bridge failure" };
  const keep = (next) => {
    assert.ok(next, "a reducer wrote a document");
    assert.deepEqual(next.future, extra);
    assert.equal(next.error, doc.error);
    doc = next;
  };
  keep(lobbyOf(doc));
  keep(joinTeam(doc, "a", "A"));
  keep(joinTeam(doc, "gone", "B"));
  keep(setOptions(doc, { surface: "snow" }));
  keep(setAccess(doc, true));
  keep(pruneTeams(doc, ["a"]));
  keep(startMatch(doc, start));
  assert.equal(doc.match.snap, snap, "snapshot text stays opaque");
  assert.equal(doc.match.engine, ENGINE);
  keep(
    commitAction(doc, {
      n: 1,
      seq: 1,
      snap,
      hash: "h1",
      action: { type: "resign", side: "A" },
      over: true,
    }),
  );
  const replay = replayOf(doc.match);
  assert.equal(replay.engine, ENGINE);
  assert.ok(isReplay(replay));
  keep(backToLobby(doc, 1));
  assert.equal(doc.started, false);
});

test("reducer nulls become undefined for room.update's no-write contract", () => {
  const doc = joinTeam(null, "a", "A");
  assert.equal(joinTeam(doc, "a", "A"), undefined);
  assert.equal(setOptions(doc, doc.options), undefined);
  assert.equal(setAccess(doc, false), undefined);
  assert.equal(pruneTeams(doc, ["a"]), undefined);
  assert.equal(commitAction(doc, { n: 1, seq: 1, snap, hash: "h" }), undefined);
  assert.equal(backToLobby(doc, 1), undefined);
});

test("constants, lobby arguments and values come from the engine", () => {
  assert.equal(ENGINE, engine.version.split(".").slice(0, 2).join("."));
  assert.equal(TEAM_MAX, 6);
  assert.equal(SEATS, 12);
  assert.equal(MATCH_OPTIONS.length, 5);
  assert.deepEqual(LEVELS, ["beginner", "club", "pro"]);
  const doc = joinTeam(joinTeam(null, "a", "A"), "b", "B");
  const lu = lineup(doc, members);
  const opts = matchOptions(doc, lu, { seed: 42, start: { year: 2026 } });
  assert.equal(opts.seed, 42);
  assert.equal(opts.start.year, 2026);
  assert.equal(opts.teams.B.players[0].key, "b");
  assert.equal(sideOf(doc, "b"), "B");
  assert.equal(cleanName("  Bo   B  "), "Bo B");
  assert.equal(cleanName("x".repeat(15) + "🪵"), "x".repeat(15));
  assert.equal(cleanOptions({ surface: "sand" }).surface, "sand");
  assert.equal(optionLabel("surface", "sand"), "Sand");
  assert.deepEqual(openListing(setAccess(doc, true), members), {
    players: 2,
    seats: 12,
    state: "waiting",
  });
});

test("START stamps the engine and refuses untagged and differing engines", () => {
  assert.equal(LENIENT_ENGINES, false);
  const legacy = members.map((m) => ({ ...m, me: { name: m.me.name } }));
  assert.equal(startCheck(players, legacy, "a").ok, false);
  assert.equal(startMatch(null, { ...start, members: legacy }), undefined);
  const different = [members[0], { ...members[1], me: { engine: "0.3" } }];
  assert.deepEqual(startCheck(players, different, "a").differ, ["b"]);
  assert.equal(startMatch(null, { ...start, members: different }), undefined);
  assert.equal(mayPlay(ENGINE, {}).ok, false);
  assert.equal(mayPlay(ENGINE, { engine: ENGINE + ".9" }).ok, true);
  assert.equal(mayPlay(ENGINE, { engine: "0.3" }).ok, false);
});

test("seat checks pass connected ids as arrays and cache between state changes", () => {
  const ctx = { players, cpu: null, host: "a", connected: ["a", "b"] };
  const need = { kind: "throw", side: "B", setup: { thrower: { key: "b" } } };
  assert.deepEqual(actorsFor(need, ctx), ["b"]);
  assert.equal(mayAct(need, ctx, "b"), true);
  assert.equal(shownActor(need, ctx), "b");
  assert.equal(playingSide(ctx, "b"), "B");
  const control = controlFor(ctx, "b");
  assert.ok(sameControl(control, { sides: ["B"], cpu: false }));
  const before = roomCallCount();
  for (let frame = 0; frame < 120; frame++) {
    mayAct(need, ctx, "b");
    shownActor(need, ctx);
    playingSide(ctx, "b");
    controlFor(ctx, "b");
    sameControl(control, control);
  }
  assert.equal(
    roomCallCount(),
    before,
    "no room bridge calls on unchanged frames",
  );
  const away = { ...ctx, connected: ["a"] };
  assert.equal(mayAct(need, away, "b"), false);
  assert.equal(shownActor(need, away), "a");
  assert.equal(nextHost([{ id: "a", connected: false }, members[1]], "a"), "b");
});

test("sync wrappers retain opaque snapshots and rider fields; aim pacing stays in JS", () => {
  const doc = startMatch(null, start);
  assert.equal(decide({ n: null, seq: 0 }, doc).match.snap, snap);
  const action = { type: "raise", choice: 1 };
  assert.deepEqual(rider(1, 2, action, { engine: "0.3.0" }), {
    n: 1,
    seq: 2,
    a: action,
    c: "web",
    e: "0.3.0",
  });
  assert.equal(rider(1, 2, action, { bytes: 64 }), undefined);
  assert.equal(asciiSize({ word: "é" }), 17);
  assert.equal(aimKey(null), "");
  assert.equal(aimKey({ x: 1 }), '{"x":1}');
});
