// The recorded games played back (tools/games.mjs): a match recorded the way the room
// records it (backend/rooms/recorder.mjs) replays action for action with the same hashes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { asciiJson } from "../../backend/rooms/core.mjs";
import { recordText } from "../../backend/rooms/recorder.mjs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import {
  browserMatch,
  clientsOf,
  enginesOf,
  engineNote,
  matchesOf,
  parseRecord,
  replayMatch,
} from "../../tools/games.mjs";

const sources = await bundleLua();
const ROOM = "abcdefgh";

// A short computer-against-computer match as the records a room would keep of it.
async function recordedMatch() {
  const actor = await Engine.create({ sources });
  actor.newMatch({
    seed: 7,
    cpu: "both",
    start: { year: 2026, month: 11, day: 15, hour: 10, min: 0 },
    maxTurns: 3,
    teams: {
      A: { name: "Home", players: [{ name: "Åsa" }] },
      B: { name: "Away", players: [{ name: "Bo" }] },
    },
  });
  let t = 1_700_000_000_000;
  let v = 0;
  const records = [];
  const keep = (doc, rider) =>
    records.push(
      parseRecord(
        gzipSync(
          recordText({
            room: ROOM,
            v: ++v,
            t: (t += 4000),
            by: "member-a-1",
            doc: asciiJson(doc),
            with: rider ? asciiJson(rider) : null,
          }),
        ),
      ),
    );
  const lobby = {
    v: 1,
    teams: { A: ["member-a-1"], B: [] },
    started: false,
    n: 0,
  };
  keep(lobby);
  const match = (seq) => ({
    ...lobby,
    started: true,
    n: 1,
    match: { n: 1, seq, snap: actor.snapshot(), hash: actor.hash().hash },
  });
  keep(match(0));
  let seq = 0;
  for (let guard = 0; guard < 400 && actor.need().kind !== "over"; guard++) {
    const n = actor.need();
    let action;
    if (n.kind === "raise") {
      action = { type: "raise", choice: n.default };
      actor.apply(action);
    } else if (n.kind === "punish") {
      action = { type: "punish", x: n.cursor.x, y: n.cursor.y };
      actor.apply(action);
    } else {
      let out;
      for (let i = 0; i < 600 && !out?.action; i++)
        out = actor.frame({ dt: 1 / 60 });
      action = out.action;
    }
    seq++;
    keep(match(seq), { n: 1, seq, a: action });
  }
  assert.equal(actor.need().kind, "over");
  keep({ ...lobby, n: 1 }); // REMATCH: back to the lobby
  return records;
}

test("a recorded match replays with the hashes its players committed", async () => {
  const records = await recordedMatch();
  const matches = matchesOf([...records].reverse());
  assert.equal(matches.length, 1);
  const [m] = matches;
  assert.equal(m.room, ROOM);
  assert.equal(m.n, 1);
  assert.ok(m.start, "the version that started it");
  assert.equal(m.steps.length, records.length - 3);
  assert.ok(m.steps.length > 12);

  const engine = await Engine.create({ sources });
  const r = replayMatch(engine, m);
  assert.equal(r.same, m.steps.length);
  assert.equal(r.differs + r.refused + r.adopted, 0);
  assert.equal(engine.need().kind, "over");
  const throws = r.steps.filter((s) => s.type === "throw");
  assert.ok(throws.length > 10);
  assert.ok(throws.every((s) => typeof s.how === "string"));
  assert.ok(throws.some((s) => typeof s.flag === "string"));
});

test("a replay says which actions differ and carries on from what was played", async () => {
  const records = await recordedMatch();
  const [m] = matchesOf(records);
  m.steps[2].doc.match.hash = "00000000"; // as if this engine threw it differently
  delete m.steps[5].with; // an action too big to ride along
  m.steps.splice(8, 1); // a version that was never recorded
  const engine = await Engine.create({ sources });
  const r = replayMatch(engine, m);
  assert.equal(r.steps[2].outcome, "differs");
  assert.equal(r.steps[5].outcome, "adopted");
  assert.equal(r.steps[5].why, "no action");
  assert.equal(r.steps[8].outcome, "adopted");
  assert.equal(r.steps[8].why, "gap");
  assert.equal(r.differs, 1);
  assert.equal(r.adopted, 2);
  assert.equal(r.same, m.steps.length - 3);
  assert.equal(engine.need().kind, "over");
});

test("versions order a room's records; time only parts one life of a code from the next", () => {
  const rec = (v, t, seq) => ({
    room: ROOM,
    v,
    t,
    by: "m",
    with: null,
    doc: { started: true, n: 1, match: { n: 1, seq, snap: "{}", hash: "x" } },
  });
  const DAY = 24 * 3600 * 1000;
  // v 2 was stamped before v 1 (its invocation finished first); the code is used again
  // three days later and starts at v 1.
  const matches = matchesOf([
    rec(2, 1000, 1),
    rec(1, 1004, 0),
    rec(3, 1010, 2),
    rec(1, 1000 + 3 * DAY, 0),
    rec(2, 1005 + 3 * DAY, 1),
  ]);
  assert.deepEqual(
    matches.map((m) => [Boolean(m.start), m.steps.map((s) => s.doc.match.seq)]),
    [
      [true, [1, 2]],
      [true, [1]],
    ],
  );
});

test("two matches in one room, and a match whose start was missed", () => {
  const rec = (v, doc) => ({
    room: ROOM,
    v,
    t: 1000 + v,
    by: "m",
    with: null,
    doc,
  });
  const at = (n, seq) => ({
    started: true,
    n,
    match: { n, seq, snap: "{}", hash: "x" },
  });
  const matches = matchesOf([
    rec(1, { started: false }),
    rec(2, at(1, 3)),
    rec(3, at(1, 4)),
    rec(4, { started: false }),
    rec(5, at(2, 0)),
    rec(6, at(2, 1)),
    { ...rec(1, at(1, 0)), room: "zzzzzzzz" },
  ]);
  assert.deepEqual(
    matches.map((m) => [m.room, m.n, Boolean(m.start), m.steps.length]),
    [
      [ROOM, 1, false, 2],
      [ROOM, 2, true, 1],
      ["zzzzzzzz", 1, true, 0],
    ],
  );
});

test("the client tags a match's records carry are read for the listing", () => {
  const rec = (v, rider) => ({
    room: ROOM,
    v,
    t: 1000 + v,
    by: "m",
    with: rider,
    doc: {
      started: true,
      n: 1,
      match: { n: 1, seq: v - 1, snap: "{}", hash: "x" },
    },
  });
  const [match] = matchesOf([
    rec(1, null),
    rec(2, { n: 1, seq: 1, a: {}, c: "web" }),
    rec(3, { n: 1, seq: 2, a: {}, c: "ios", e: "1.2.0" }),
    rec(4, { n: 1, seq: 3, a: {}, c: "web" }),
  ]);
  assert.deepEqual(clientsOf(match), ["web", "ios"]);
  const [old] = matchesOf([rec(1, null), rec(2, { n: 1, seq: 1, a: {} })]);
  assert.deepEqual(clientsOf(old), [], "records from before clients said");

  const g = { mode: "solo", start: "{}", actions: [] };
  assert.equal(
    browserMatch({ t: 1, game: { ...g, client: "ios" } }).client,
    "ios",
  );
  assert.equal(browserMatch({ t: 1, game: g }).client, null);

  // the engine each record names, and the note when it is not this checkout's
  assert.deepEqual(enginesOf(match), ["1.2.0"]);
  assert.deepEqual(enginesOf(old), []);
  assert.equal(
    browserMatch({ t: 1, game: { ...g, engine: "0.2.0" } }).engine,
    "0.2.0",
  );
  assert.equal(browserMatch({ t: 1, game: g }).engine, null);
  assert.equal(engineNote(["0.2.0"], "0.2.0"), "");
  assert.equal(engineNote([], "0.2.0"), "");
  assert.equal(
    engineNote(["0.2.0", "0.3.0"], "0.3.0"),
    "; played on engine 0.2.0, 0.3.0, this checkout runs 0.3.0",
  );
});
