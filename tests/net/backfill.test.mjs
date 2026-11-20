// A replay kept for a match that ended before replays (tools/backfill-replay.mjs): made
// from a room's records (a synthetic match, recorded the way the room records one),
// played through the engine from its first snapshot, and written the way `keep` writes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiJson, LIMITS } from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import { Engine } from "../../src/engine/index.js";
import "./room-engine.mjs";
import { isReplay } from "../../src/net/lobby.js";
import {
  checkReplay,
  keepBackfill,
  replayFromMatch,
  roomReplays,
} from "../../tools/backfill-replay.mjs";
import { matchesOf } from "../../tools/games.mjs";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeEngineTree } from "../engine/engine-fixture.mjs";

const sources = await bundleLua();
const ROOM = "abcdefgh";
const START = { year: 2026, month: 11, day: 15, hour: 10, min: 0 };

// A short computer-against-computer match as a room's records, from before replays:
// the document carries no setup, h0, log or over.
async function records() {
  const actor = await Engine.create({ sources });
  actor.newMatch({
    seed: 11,
    cpu: "both",
    start: START,
    maxTurns: 3,
    teams: {
      A: { name: "Home", players: [{ name: "P1" }] },
      B: { name: "Away", players: [{ name: "P2" }] },
    },
  });
  let t = 1_700_000_000_000;
  let v = 0;
  const out = [];
  const players = { A: [{ id: "m1", name: "P1" }], B: [] };
  const doc = (seq) => ({
    v: 1,
    teams: { A: ["m1"], B: [] },
    started: true,
    n: 1,
    match: {
      n: 1,
      seq,
      snap: actor.snapshot(),
      hash: actor.hash().hash,
      players,
      cpu: "B",
    },
  });
  const keep = (d, rider) =>
    out.push({
      room: ROOM,
      v: ++v,
      t: (t += 4000),
      by: "m1",
      doc: d,
      with: rider,
    });
  keep({ v: 1, teams: { A: ["m1"], B: [] }, started: false, n: 0 }, null);
  keep(doc(0), null);
  let seq = 0;
  for (let guard = 0; guard < 400 && actor.need().kind !== "over"; guard++) {
    const n = actor.need();
    let action;
    if (n.kind === "raise") action = { type: "raise", choice: n.default };
    else if (n.kind === "punish")
      action = { type: "punish", x: n.cursor.x, y: n.cursor.y };
    if (action) actor.apply(action);
    else {
      let o;
      for (let i = 0; i < 600 && !o?.action; i++)
        o = actor.frame({ dt: 1 / 60 });
      action = o.action;
    }
    seq++;
    keep(doc(seq), { n: 1, seq, a: JSON.parse(JSON.stringify(action)) });
  }
  assert.equal(actor.need().kind, "over");
  return { out, last: doc(seq), v };
}

test("a match from before replays makes a replay from its records, from its first snapshot", async () => {
  const { out, last } = await records();
  const [m] = matchesOf(out);
  const { replay, at } = replayFromMatch(m);
  assert.ok(isReplay(replay), "a replay the player takes");
  assert.equal(replay.setup, undefined);
  assert.equal(typeof replay.start, "string");
  assert.equal(replay.log.length, m.steps.length);
  assert.equal(replay.snap, last.match.snap);
  assert.equal(at, out.at(-1).t);
  const engine = await Engine.create({ sources });
  const c = checkReplay(engine, replay);
  assert.deepEqual(c, {
    actions: m.steps.length,
    same: m.steps.length,
    firstDiffers: null,
    over: true,
    end: true,
  });
  // the engine is free again: a replay no longer holds it
  engine.newMatch({ seed: 1, start: START });
  assert.equal(engine.apply({ type: "resign", side: "A" }).ok, true);
});

test("a hash the engine no longer reaches is the first that differs; a gap makes no replay", async () => {
  const { out } = await records();
  const [m] = matchesOf(out);
  m.steps[3].doc.match.hash = "00000000";
  const engine = await Engine.create({ sources });
  const c = checkReplay(engine, replayFromMatch(m).replay);
  assert.equal(c.firstDiffers, 4);
  assert.equal(c.same, m.steps.length - 1);
  const gap = matchesOf(out.filter((_, i) => i !== 6));
  assert.match(replayFromMatch(gap[0]).why, /gap/);
  const noAction = matchesOf(
    out.map((r, i) => (i === 6 ? { ...r, with: null } : r)),
  );
  assert.match(replayFromMatch(noAction[0]).why, /not recorded/);
  const { best } = roomReplays(
    engine,
    out.filter((_, i) => i !== 6),
  );
  assert.equal(best, null);
  // a match still in play as recorded is never kept, though its replay is whole
  const playing = roomReplays(engine, out.slice(0, -3));
  assert.ok(playing.found[0].replay);
  assert.equal(playing.found[0].finished, false);
  assert.equal(playing.best, null);
  assert.equal(roomReplays(engine, out).best.finished, true);
});

// docs/ENGINES.md: each match on the engine engineOf gives it (the match's own where
// the checkout carries it); a second engine made from a fixture, playing alike.
test("each match plays on the engine it is given, and says which", async (t) => {
  const { out } = await records();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-older-engine-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeEngineTree(dir, "0.6.9");
  const older = await Engine.create({ sources: bundleLua(dir) });
  const newest = await Engine.create({ sources });
  const own = roomReplays(newest, out, { engineOf: () => older });
  assert.equal(own.found[0].engine, "0.6.9");
  assert.equal(own.best.check.same, own.best.check.actions);
  assert.equal(roomReplays(newest, out).found[0].engine, newest.version);
});

test("the write keeps the replay and the room a year from the match's end, once, and only for the match the pitch shows", async () => {
  const { out, last, v } = await records();
  const engine = await Engine.create({ sources });
  const { best } = roomReplays(engine, out);
  let clock = best.at + 3600 * 1000;
  const store = memoryStore({ now: () => clock });
  const exp = Math.floor(clock / 1000) + LIMITS.roomTtl;
  await store.putRoom(ROOM, { rev: 5, exp, host: "m1", members: [] }, 0);
  await store.putDoc(
    ROOM,
    { v, doc: asciiJson(last), by: "m1", sid: null, exp },
    0,
  );

  // a pitch that shows another match is left alone
  const other = { ...best, replay: { ...best.replay, n: 2 } };
  await assert.rejects(keepBackfill(store, ROOM, other), /no longer shows/);
  await assert.rejects(keepBackfill(store, "zzzzzzzz", best), /gone/);

  const said = await keepBackfill(store, ROOM, best);
  assert.match(said, /kept match 1/);
  const until = Math.floor(best.at / 1000) + LIMITS.keepTtl;
  const room = await store.getRoom(ROOM);
  assert.deepEqual(room.keep, { v, until });
  assert.equal(room.rev, 6);
  assert.equal(room.exp, until);
  assert.equal((await store.getDoc(ROOM)).exp, until);
  const kept = await store.getReplay(ROOM);
  assert.equal(kept.v, v);
  assert.deepEqual(JSON.parse(kept.data), best.replay);
  // a run that wrote the replay and stopped before the room: a second run finishes it
  const store2 = memoryStore({ now: () => clock });
  await store2.putRoom(ROOM, { rev: 5, exp, host: "m1", members: [] }, 0);
  await store2.putDoc(
    ROOM,
    { v, doc: asciiJson(last), by: "m1", sid: null, exp },
    0,
  );
  await store2.putReplay(ROOM, {
    v,
    t: best.at,
    data: asciiJson(best.replay),
    exp: until,
  });
  // and a visitor writes the room while it runs: the room is read again
  const putRoom = store2.putRoom.bind(store2);
  let raced = false;
  store2.putRoom = async (code, r, prev) => {
    if (!raced) {
      raced = true;
      const cur = await store2.getRoom(code);
      await putRoom(code, { ...cur, rev: cur.rev + 1 }, cur.rev);
    }
    return putRoom(code, r, prev);
  };
  assert.match(await keepBackfill(store2, ROOM, best), /kept match 1/);
  assert.deepEqual((await store2.getRoom(ROOM)).keep, { v, until });
  assert.equal((await store2.getDoc(ROOM)).exp, until);
  // another replay already kept is never replaced
  const store3 = memoryStore({ now: () => clock });
  await store3.putRoom(ROOM, { rev: 5, exp, host: "m1", members: [] }, 0);
  await store3.putDoc(
    ROOM,
    { v, doc: asciiJson(last), by: "m1", sid: null, exp },
    0,
  );
  await store3.putReplay(ROOM, { v, t: 1, data: "{}", exp: until });
  assert.match(await keepBackfill(store3, ROOM, best), /already/);
  assert.equal((await store3.getRoom(ROOM)).keep, undefined);
  // run again: nothing written
  clock += 1000;
  assert.match(await keepBackfill(store, ROOM, best), /already/);
  assert.equal((await store.getRoom(ROOM)).rev, 6);
});
