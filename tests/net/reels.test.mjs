// Highlight reels on the room server (backend/rooms/core.mjs `reel`, docs/ROOMS.md
// section 12) over the in-memory store, and the DynamoDB store's reel writes against
// a fake that evaluates their condition expressions.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, asciiJson, createRooms } from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import { dynamoStore } from "../../backend/rooms/dynamo-store.mjs";
import { lambdaReelStarter } from "../../backend/rooms/handler.mjs";
import { reelStore } from "../../backend/reels/aws.mjs";
import { runReel } from "../../backend/reels/job.mjs";
import { REEL_TRIES } from "../../backend/reels/tag.mjs";
import { gzipSync } from "node:zlib";

const ROOM = "abcdefgh23";
const T0 = 1_700_000_000_000;
const REPLAY = {
  v: 1,
  n: 1,
  engine: "0.7.1",
  log: [{ a: { type: "throw", how: "baton" } }],
  snap: "{}",
};

function harness({
  limits = LIMITS,
  engines = ["0.7"],
  starter = true,
  failStart = false,
  clock = null,
  store: given = null,
} = {}) {
  let t = T0;
  const now = clock?.now ?? (() => t);
  const store = given ?? memoryStore({ now });
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
  const ask = async (conn, room = ROOM, id = 1, more = {}) => {
    await rooms.message(conn, asciiJson({ t: "reel", id, room, ...more }));
    const got = inbox.get(conn) ?? [];
    inbox.set(conn, []);
    return got.at(-1);
  };
  const keep = (v = 4, replay = REPLAY) =>
    store.putReplay(ROOM, {
      v,
      t: now(),
      data: JSON.stringify(replay),
      exp: Math.floor(now() / 1000) + 30 * 86400,
    });
  return {
    rooms,
    store,
    started,
    ask,
    keep,
    advance: clock?.advance ?? ((ms) => (t += ms)),
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

test("reel: a `v` that is the kept replay's behaves as without it", async () => {
  const h = harness();
  await h.keep(4);
  const first = await h.ask("c1", ROOM, 1, { v: 4 });
  assert.equal(first.v, 4);
  assert.equal(first.reel.state, "rendering");
  assert.deepEqual(h.started, [{ room: ROOM, v: 4, tag: "r1-0.7" }]);
  const poll = await h.ask("c1", ROOM, 2, { v: 4 });
  assert.equal(poll.reel.state, "rendering");
  assert.equal(h.started.length, 1);
});

test("reel: a `v` the room no longer keeps is moved, and starts and counts nothing", async () => {
  // one render a day and one a connection: a moved answer must use neither
  const h = harness({
    limits: { ...LIMITS, reelsPerDay: 1, reelsPerConn: 1 },
  });
  await h.keep(9);
  for (const v of [4, 4, 12]) {
    const a = await h.ask("c1", ROOM, 1, { v });
    assert.deepEqual(
      { t: a.t, id: a.id, room: a.room, v: a.v, reel: a.reel, why: a.why },
      { t: "reel", id: 1, room: ROOM, v: 9, reel: null, why: "moved" },
    );
  }
  assert.equal(h.started.length, 0);
  assert.equal(await h.store.getReel(ROOM), null);
  // the same connection may still start the one render of the day
  const real = await h.ask("c1", ROOM, 1, { v: 9 });
  assert.equal(real.reel.state, "rendering");
  assert.equal(h.started.length, 1);
});

test("reel: without `v` a rematch's replay is rendered as before; a bad `v` is refused", async () => {
  const h = harness();
  await h.keep(9);
  const a = await h.ask("c1");
  assert.equal(a.v, 9);
  assert.equal(a.reel.state, "rendering");
  for (const v of [0, -1, 1.5, "4", null, true]) {
    const bad = await h.ask("c2", ROOM, 1, { v });
    assert.equal(bad.t, "error", JSON.stringify(v));
    assert.equal(bad.code, "bad-message");
  }
  assert.equal(h.started.length, 1);
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
        assert.match(
          i.ConditionExpression,
          /#tries = :had AND #tries < :tries/,
        );
        const ok =
          !had ||
          at(had, "#exp") < v[":now"] ||
          at(had, "#v") < v[":v"] ||
          (at(had, "#v") === v[":v"] && at(had, "#tag") !== v[":tag"]) ||
          (at(had, "#job") === v[":job"] &&
            at(had, "#state") === v[":rendering"] &&
            at(had, "#at") < v[":stale"] &&
            at(had, "#tries") === v[":had"] &&
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
      if (name === "UpdateCommand" && i.Key.sk === "reel") {
        // the reel item: the reel function's try and outcome, the rooms' undo
        const had = items.get(key(i.Key));
        if (!had || at(had, "#job") !== v[":job"]) fail();
        if (/#state = :rendering/.test(i.ConditionExpression ?? ""))
          if (at(had, "#state") !== v[":rendering"]) fail();
        if (i.UpdateExpression === "ADD #tries :one") {
          had.tries = (had.tries ?? 0) + 1;
          return { Attributes: { tries: had.tries } };
        }
        const sets = i.UpdateExpression.replace(/^SET /, "").split(", ");
        for (const set of sets) {
          const [alias, value] = set.split(" = ");
          had[n[alias]] = v[value];
        }
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

// ---------- the bound: a job renders at most REEL_TRIES times ----------

// Drives one job the worst way: every invoke reaches the reel function, which starts
// rendering and dies without a word (a Lambda timeout), Lambda retries it once, which
// dies the same way; then a viewer asks after the 25 minutes and takes the render
// over. Until the job is shown failed, and then a while longer.
async function driveStaleTakeovers({ h, jobStore }) {
  let renders = 0;
  const render = () => {
    renders++;
    return new Promise(() => {}); // never ends: the function is stopped at its timeout
  };
  const invoke = (input) =>
    runReel({
      input,
      store: jobStore,
      render,
      upload: async () => {},
      engine: "0.7.1",
      engines: ["0.7"],
      now: h.now,
      log: () => {},
    });
  const results = [];
  let shown = null;
  for (let round = 0; round < 8; round++) {
    const a = await h.ask(`c${round}`);
    shown = a.reel?.state ?? null;
    results.push(shown);
    // every invoke the rooms made since, and Lambda's one retry of each
    for (const input of h.started.splice(0)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await Promise.race([
          invoke(input),
          new Promise((r) => setImmediate(() => r("running"))),
        ]);
        if (out !== "running" && out.state === "failed") break;
      }
    }
    h.advance(LIMITS.reelStaleMs + 1000);
  }
  return { renders, results, shown };
}

test("memory store: stale takeovers keep the tries; a job renders twice at most, then is failed", async () => {
  const h = harness();
  h.started.length = 0;
  await h.keep(4);
  const { renders, results, shown } = await driveStaleTakeovers({
    h,
    jobStore: h.store,
  });
  assert.equal(renders, REEL_TRIES);
  assert.equal(shown, "failed");
  // once failed, no request starts it again
  const firstFailed = results.indexOf("failed");
  assert.ok(firstFailed > 0);
  for (const r of results.slice(firstFailed)) assert.equal(r, "failed");
});

test("dynamo store: stale takeovers keep the tries; a job renders twice at most, then is failed", async () => {
  let t = T0;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: clock.now });
  const h = harness({ clock, store });
  // the kept replay, as the rooms store writes it (gzipped)
  client.items.set(`room#${ROOM}|replay`, {
    pk: `room#${ROOM}`,
    sk: "replay",
    v: 4,
    z: gzipSync(JSON.stringify(REPLAY)),
    exp: Math.floor(T0 / 1000) + 30 * 86400,
  });
  const jobStore = reelStore({ client, table: "rooms", now: clock.now });
  const { renders, results, shown } = await driveStaleTakeovers({
    h,
    jobStore,
  });
  assert.equal(renders, REEL_TRIES);
  assert.equal(shown, "failed");
  const firstFailed = results.indexOf("failed");
  assert.ok(firstFailed > 0);
  for (const r of results.slice(firstFailed)) assert.equal(r, "failed");
  assert.ok(client.items.get(`room#${ROOM}|reel`).tries >= REEL_TRIES);
});

test("a takeover the day's cap refuses gives the item back stale, its tries kept", async () => {
  for (const kind of ["memory", "dynamo"]) {
    let t = T0;
    const clock = { now: () => t, advance: (ms) => (t += ms) };
    const client = fakeClient();
    const store =
      kind === "memory"
        ? memoryStore({ now: clock.now })
        : dynamoStore({ client, table: "rooms", now: clock.now });
    // the reel function's side: the memory store has it, DynamoDB is aws.mjs's
    const jobStore =
      kind === "memory"
        ? store
        : reelStore({ client, table: "rooms", now: clock.now });
    const h = harness({
      clock,
      store,
      limits: { ...LIMITS, reelsPerDay: 1 },
    });
    if (kind === "memory") await h.keep(4);
    else
      client.items.set(`room#${ROOM}|replay`, {
        pk: `room#${ROOM}`,
        sk: "replay",
        v: 4,
        z: gzipSync(JSON.stringify(REPLAY)),
        exp: Math.floor(T0 / 1000) + 30 * 86400,
      });
    assert.equal((await h.ask("c1")).reel.state, "rendering", kind); // the day's one
    await jobStore.attemptReel(ROOM, "4-r1-0.7"); // one try, then silence
    const before = await store.getReel(ROOM);
    h.advance(LIMITS.reelStaleMs + 1000);
    const busy = await h.ask("c2"); // a takeover the cap refuses
    assert.equal(busy.why, "busy", kind);
    const after = await store.getReel(ROOM);
    assert.equal(after.tries, 1, kind);
    assert.equal(after.at, before.at, kind);
    // the next day it is taken over once more, still with its one try
    h.advance(24 * 3600 * 1000);
    assert.equal((await h.ask("c3")).reel.state, "rendering", kind);
    assert.equal((await store.getReel(ROOM)).tries, 1, kind);
  }
});

test("reel: a match with nothing to show is answered failed, why empty, and not started again", async () => {
  const h = harness();
  await h.keep(4);
  await h.ask("c1");
  await h.store.attemptReel(ROOM, "4-r1-0.7");
  await h.store.finishReel(ROOM, "4-r1-0.7", { state: "failed", why: "empty" });
  h.advance(LIMITS.reelStaleMs + 1000);
  const a = await h.ask("c2");
  assert.deepEqual(a.reel, {
    state: "failed",
    tag: "r1-0.7",
    at: T0,
    why: "empty",
  });
  assert.equal(h.started.length, 1);
});
