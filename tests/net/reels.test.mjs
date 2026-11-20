// Highlight reels on the room server (backend/rooms/core.mjs `reel`, docs/ROOMS.md
// section 12) over the in-memory store, and the DynamoDB store's reel writes against
// a fake that evaluates their condition expressions.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, asciiJson, createRooms } from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import { dynamoStore } from "../../backend/rooms/dynamo-store.mjs";
import { lambdaReelStarter } from "../../backend/rooms/handler.mjs";

const ROOM = "abcdefgh23";
const T0 = 1_700_000_000_000;
const REPLAY = { v: 1, n: 1, engine: "0.7.1", log: [], snap: "{}" };

function harness({
  limits = LIMITS,
  engines = ["0.7"],
  starter = true,
  failStart = false,
} = {}) {
  let t = T0;
  const now = () => t;
  const store = memoryStore({ now });
  const started = [];
  const inbox = new Map();
  const rooms = createRooms({
    store,
    now,
    limits,
    reelEngines: engines,
    startReel: starter
      ? async (job) => {
          if (failStart) throw new Error("invoke failed");
          started.push(job);
        }
      : null,
    async send(conn, text) {
      if (!inbox.has(conn)) inbox.set(conn, []);
      inbox.get(conn).push(JSON.parse(text));
      return true;
    },
  });
  const ask = async (conn, room = ROOM, id = 1) => {
    await rooms.message(conn, asciiJson({ t: "reel", id, room }));
    const got = inbox.get(conn) ?? [];
    inbox.set(conn, []);
    return got.at(-1);
  };
  const keep = (v = 4, replay = REPLAY) =>
    store.putReplay(ROOM, {
      v,
      t: now(),
      data: JSON.stringify(replay),
      exp: Math.floor(now() / 1000) + 3600,
    });
  return {
    rooms,
    store,
    started,
    ask,
    keep,
    advance: (ms) => (t += ms),
    now,
  };
}

test("reel: no renderer configured answers reel null, unavailable", async () => {
  const h = harness({ starter: false });
  await h.keep();
  const a = await h.ask("c1");
  assert.equal(a.t, "reel");
  assert.equal(a.reel, null);
  assert.equal(a.why, "unavailable");
});

test("reel: a bad room code is an error; no kept replay is reel null, replay", async () => {
  const h = harness();
  const bad = await h.ask("c1", "not a code");
  assert.equal(bad.t, "error");
  assert.equal(bad.code, "bad-room");
  const none = await h.ask("c1");
  assert.deepEqual(
    { reel: none.reel, why: none.why, v: none.v },
    { reel: null, why: "replay", v: 0 },
  );
  assert.equal(h.started.length, 0);
});

test("reel: a match from another engine, or none named, is never rendered", async () => {
  for (const engine of ["0.8.0", undefined, "junk"]) {
    const h = harness();
    await h.keep(4, { ...REPLAY, engine });
    const a = await h.ask("c1");
    assert.equal(a.reel, null);
    assert.equal(a.why, "engine");
    assert.equal(a.v, 4);
    assert.equal(h.started.length, 0);
  }
});

test("reel: the first request starts the render; the next is told how it stands", async () => {
  const h = harness();
  await h.keep(4);
  const first = await h.ask("c1");
  assert.equal(first.v, 4);
  assert.equal(first.reel.state, "rendering");
  assert.equal(first.reel.tag, "r1-0.7");
  assert.deepEqual(h.started, [{ room: ROOM, v: 4, tag: "r1-0.7" }]);
  const second = await h.ask("c2");
  assert.equal(second.reel.state, "rendering");
  assert.equal(h.started.length, 1);
  // done: the paths and duration, no member ids
  const job = "4-r1-0.7";
  assert.equal(await h.store.attemptReel(ROOM, job).then((x) => x.tries), 1);
  await h.store.finishReel(ROOM, job, {
    state: "done",
    tall: `/reels/${ROOM}/4-r1-0.7/tall.mp4`,
    wide: `/reels/${ROOM}/4-r1-0.7/wide.mp4`,
    edit: `/reels/${ROOM}/4-r1-0.7/edit.json`,
    seconds: 39.3,
    done: h.now(),
  });
  const done = await h.ask("c3");
  assert.deepEqual(done.reel, {
    state: "done",
    tag: "r1-0.7",
    at: T0,
    tall: `/reels/${ROOM}/4-r1-0.7/tall.mp4`,
    wide: `/reels/${ROOM}/4-r1-0.7/wide.mp4`,
    edit: `/reels/${ROOM}/4-r1-0.7/edit.json`,
    seconds: 39.3,
  });
  // failed is final for that version and look
  await h.store.finishReel(ROOM, job, { state: "failed", why: "render" });
  const failed = await h.ask("c4");
  assert.equal(failed.reel.state, "failed");
  assert.equal(h.started.length, 1);
});

test("reel: requests at once start one render", async () => {
  const h = harness();
  await h.keep(4);
  const all = await Promise.all(["c1", "c2", "c3", "c4"].map((c) => h.ask(c)));
  assert.equal(h.started.length, 1);
  for (const a of all) assert.equal(a.reel.state, "rendering");
});

test("reel: a rematch's newer replay is a new render", async () => {
  const h = harness();
  await h.keep(4);
  await h.ask("c1");
  await h.keep(9);
  const a = await h.ask("c2");
  assert.equal(a.v, 9);
  assert.equal(h.started.length, 2);
  assert.equal(h.started[1].v, 9);
});

test("reel: the daily cap answers busy, and a new UTC day starts again", async () => {
  const h = harness({ limits: { ...LIMITS, reelsPerDay: 2 } });
  for (let i = 0; i < 2; i++) {
    await h.keep(4 + i * 10);
    const a = await h.ask(`c${i}`);
    assert.equal(a.reel.state, "rendering");
  }
  await h.keep(40);
  const busy = await h.ask("c9");
  assert.equal(busy.reel, null);
  assert.equal(busy.why, "busy");
  assert.equal(h.started.length, 2);
  h.advance(24 * 3600 * 1000);
  await h.keep(41);
  const next = await h.ask("c9");
  assert.equal(next.reel.state, "rendering");
});

test("reel: a connection may start three; asking how one stands is free", async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    await h.keep(10 + i);
    assert.equal((await h.ask("c1")).reel.state, "rendering");
    assert.equal((await h.ask("c1")).reel.state, "rendering"); // a poll
  }
  await h.keep(20);
  const refused = await h.ask("c1");
  assert.equal(refused.t, "error");
  assert.equal(refused.code, "too-many");
  // another connection may
  assert.equal((await h.ask("c2")).reel.state, "rendering");
  // a closed connection's count goes with it
  await h.rooms.disconnect("c1");
});

test("reel: a render that died without a word is started again once stale", async () => {
  const h = harness();
  await h.keep(4);
  await h.ask("c1");
  h.advance(LIMITS.reelStaleMs - 1000);
  assert.equal((await h.ask("c2")).reel.state, "rendering");
  assert.equal(h.started.length, 1);
  h.advance(2000);
  const again = await h.ask("c2");
  assert.equal(again.reel.state, "rendering");
  assert.equal(again.reel.at, h.now());
  assert.equal(h.started.length, 2);
});

test("reel: a render that timed out on every try is shown failed, not started again", async () => {
  const h = harness();
  await h.keep(4);
  await h.ask("c1");
  await h.store.attemptReel(ROOM, "4-r1-0.7");
  await h.store.attemptReel(ROOM, "4-r1-0.7");
  h.advance(LIMITS.reelStaleMs + 1000);
  const a = await h.ask("c2");
  assert.equal(a.reel.state, "failed");
  assert.equal(h.started.length, 1);
});

test("reel: a renderer that cannot be asked undoes the request", async () => {
  const h = harness({ failStart: true });
  await h.keep(4);
  const a = await h.ask("c1");
  assert.equal(a.t, "error");
  assert.equal(a.code, "failed");
  assert.equal(await h.store.getReel(ROOM), null);
});

// ---------- the DynamoDB store's reel writes ----------

class ConditionalCheckFailedException extends Error {
  name = "ConditionalCheckFailedException";
}

// Evaluates the reel conditions dynamo-store.mjs writes, by their text.
function fakeClient() {
  const items = new Map();
  const key = ({ pk, sk }) => `${pk}|${sk}`;
  const fail = () => {
    throw new ConditionalCheckFailedException("failed");
  };
  return {
    items,
    async send(command) {
      const name = command.constructor.name;
      const i = command.input;
      const n = i.ExpressionAttributeNames ?? {};
      const v = i.ExpressionAttributeValues ?? {};
      const at = (item, alias) => item?.[n[alias]];
      if (name === "GetCommand")
        return { Item: structuredClone(items.get(key(i.Key))) };
      if (name === "PutCommand") {
        const had = items.get(key(i.Item));
        assert.match(i.ConditionExpression, /#tries < :tries/);
        const ok =
          !had ||
          at(had, "#exp") < v[":now"] ||
          at(had, "#v") < v[":v"] ||
          (at(had, "#v") === v[":v"] && at(had, "#tag") !== v[":tag"]) ||
          (at(had, "#job") === v[":job"] &&
            at(had, "#state") === v[":rendering"] &&
            at(had, "#at") < v[":stale"] &&
            at(had, "#tries") < v[":tries"]);
        if (!ok) fail();
        items.set(key(i.Item), structuredClone(i.Item));
        return {};
      }
      if (name === "DeleteCommand") {
        const had = items.get(key(i.Key));
        if (!had || at(had, "#job") !== v[":job"]) fail();
        items.delete(key(i.Key));
        return {};
      }
      if (name === "UpdateCommand") {
        assert.equal(i.UpdateExpression, "ADD #n :one SET #exp = :exp");
        const had = items.get(key(i.Key)) ?? { ...i.Key };
        if (!(had.n === undefined || had.n < v[":cap"])) fail();
        had.n = (had.n ?? 0) + 1;
        had.exp = v[":exp"];
        items.set(key(i.Key), had);
        return {};
      }
      throw new Error(`fake does not know ${name}`);
    },
  };
}

test("dynamo store: putReel wins once, a stale render is taken over, countReel stops at the cap", async () => {
  let t = T0;
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: () => t });
  const exp = T0 / 1000 + 3600;
  const req = { v: 4, tag: "r1-0.7", job: "4-r1-0.7", at: t, exp };
  const staleBefore = t - LIMITS.reelStaleMs;
  assert.equal(await store.putReel(ROOM, req, { staleBefore }), true);
  assert.equal(await store.putReel(ROOM, req, { staleBefore }), false);
  const item = await store.getReel(ROOM);
  assert.equal(item.state, "rendering");
  assert.equal(item.pk, undefined);
  // another look of the same version may start
  assert.equal(
    await store.putReel(
      ROOM,
      { ...req, tag: "r2-0.7", job: "4-r2-0.7" },
      { staleBefore },
    ),
    true,
  );
  // stale: taken over
  t += LIMITS.reelStaleMs + 1;
  const later = { ...req, tag: "r2-0.7", job: "4-r2-0.7", at: t };
  assert.equal(
    await store.putReel(ROOM, later, {
      staleBefore: t - LIMITS.reelStaleMs,
    }),
    true,
  );
  // dropReel only drops its own job
  await store.dropReel(ROOM, "4-r1-0.7");
  assert.notEqual(await store.getReel(ROOM), null);
  await store.dropReel(ROOM, "4-r2-0.7");
  assert.equal(await store.getReel(ROOM), null);
  // the day's counter
  assert.equal(await store.countReel("2026-11-19", 2, exp), true);
  assert.equal(await store.countReel("2026-11-19", 2, exp), true);
  assert.equal(await store.countReel("2026-11-19", 2, exp), false);
  assert.equal(await store.countReel("2026-11-20", 2, exp), true);
});

test("the rooms function asks the reel function asynchronously", async () => {
  const sent = [];
  const start = lambdaReelStarter({
    client: {
      async send(cmd) {
        sent.push(cmd.input);
        return { StatusCode: 202 };
      },
    },
    functionName: "arn:aws:lambda:us-east-1:000000000000:function:x-reels",
  });
  await start({ room: ROOM, v: 4, tag: "r1-0.7" });
  assert.equal(sent[0].InvocationType, "Event");
  assert.deepEqual(JSON.parse(Buffer.from(sent[0].Payload)), {
    room: ROOM,
    v: 4,
    tag: "r1-0.7",
  });
  const refused = lambdaReelStarter({
    client: { send: async () => ({ StatusCode: 500 }) },
    functionName: "x",
  });
  await assert.rejects(refused({ room: ROOM, v: 4, tag: "r1-0.7" }));
});
