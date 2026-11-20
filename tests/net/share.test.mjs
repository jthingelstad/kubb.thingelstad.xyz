// Sharing a match against the computer on the room server (backend/rooms/core.mjs
// `share`, docs/ROOMS.md section 13) over the in-memory store with a stand-in check, the
// DynamoDB store's share writes and the Lambda check adapter against fakes, and one
// match end to end through the real check: shared, read as a pitch, then a reel.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIMITS,
  ShareBusy,
  asciiJson,
  createRooms,
  shareHash,
  toFrames,
} from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import { dynamoStore } from "../../backend/rooms/dynamo-store.mjs";
import { lambdaShareChecker } from "../../backend/rooms/handler.mjs";
import { checkShare as realCheck } from "../../backend/reels/check.mjs";
import { pitchState, previewOf } from "../../backend/pages/pitch.mjs";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { playSolo, soloSetup } from "../../tools/reel/solo.mjs";
import engineInfo from "../../vendor/engine.json" with { type: "json" };

const T0 = Date.UTC(2026, 10, 19, 18, 0, 0);
const ENGINE = engineInfo.tag.replace(/^v/, "");
const START = asciiJson({ v: 1, opts: { seed: 2 } }); // opaque to the room server
const G = {
  client: "web-1.2.3",
  engine: ENGINE,
  start: START,
  log: [{ a: { type: "throw" } }, { a: { type: "raise" } }],
  end: { winner: "A", throws: 1 },
};
const PASSED = {
  ok: true,
  engine: ENGINE,
  document: asciiJson({ v: 1, started: true, match: { over: true } }),
  replay: asciiJson({ v: 1, n: 1, engine: ENGINE, log: [], snap: "{}" }),
  actions: 2,
  throws: 1,
};

function harness({
  limits = LIMITS,
  engines = ["0.7"],
  check = async () => PASSED,
  store: given = null,
  startReel = null,
} = {}) {
  let t = T0;
  const now = () => t;
  const store = given ?? memoryStore({ now });
  const inbox = new Map();
  const checked = [];
  const rooms = createRooms({
    store,
    now,
    limits,
    reelEngines: engines,
    startReel,
    checkShare: check
      ? async (g) => {
          checked.push(g);
          return check(g);
        }
      : null,
    async send(conn, text) {
      if (!inbox.has(conn)) inbox.set(conn, []);
      inbox.get(conn).push(JSON.parse(text));
      return true;
    },
  });
  const say = (conn, msg) =>
    rooms.message(conn, typeof msg === "string" ? msg : asciiJson(msg));
  const take = (conn) => {
    const got = inbox.get(conn) ?? [];
    inbox.set(conn, []);
    return got;
  };
  const share = async (conn, g = G, id = 1) => {
    await say(conn, { t: "share", id, g });
    return take(conn).at(-1);
  };
  return {
    rooms,
    store,
    checked,
    say,
    take,
    share,
    advance: (ms) => (t += ms),
    now,
  };
}

test("share: a match that passes is kept as a sealed room, a year, under a fresh code", async () => {
  const h = harness();
  const got = await h.share("c1");
  assert.equal(got.t, "shared");
  assert.equal(got.id, 1);
  assert.equal(got.v, 1);
  assert.equal(got.why, undefined);
  assert.match(got.code, /^[2-9a-hjkmnp-z]{10}$/);
  const year = Math.floor(T0 / 1000) + LIMITS.keepTtl;
  const room = await h.store.getRoom(got.code);
  assert.equal(room.sealed, true);
  assert.equal(room.host, null);
  assert.deepEqual(room.members, {});
  assert.deepEqual(room.keep, { v: 1, until: year });
  assert.equal(room.exp, year);
  const doc = await h.store.getDoc(got.code);
  assert.equal(doc.v, 1);
  assert.equal(doc.doc, PASSED.document);
  assert.equal(doc.by, null);
  const kept = await h.store.getReplay(got.code);
  assert.equal(kept.v, 1);
  assert.equal(kept.data, PASSED.replay);
  assert.deepEqual(await h.store.getShare(shareHash(G)), {
    code: got.code,
    exp: year,
  });
  // the check is given the match without `client`, and nothing keeps it
  assert.deepEqual(Object.keys(h.checked[0]).sort(), [
    "end",
    "engine",
    "log",
    "start",
  ]);
  assert.ok(
    !JSON.stringify([...h.store.shares, room, doc, kept]).includes("web-1.2.3"),
  );
});

test("share: the same match shared twice gets the same code, checked once and free", async () => {
  const h = harness();
  const one = await h.share("c1");
  const two = await h.share("c1", { ...G, client: "ios-9" }, 2);
  const three = await h.share("c2", G, 3);
  assert.equal(two.code, one.code);
  assert.equal(three.code, one.code);
  assert.equal(h.checked.length, 1);
  // a repeat does not count against the connection: two new matches still go
  const a = await h.share("c1", {
    ...G,
    end: { winner: "A", throws: 2 },
    log: [{ a: { x: 1 } }],
  });
  assert.ok(a.code);
  // the end is not part of the key: the same start and log is the same match
  assert.equal(
    shareHash({ ...G, end: { winner: "B", throws: 9 } }),
    shareHash(G),
  );
});

test("share: a room under an old share key that is gone gets a new code", async () => {
  const h = harness();
  const one = await h.share("c1");
  h.store.rooms.delete(one.code);
  const two = await h.share("c2");
  assert.notEqual(two.code, one.code);
  assert.equal((await h.store.getShare(shareHash(G))).code, two.code);
});

test("share: what the check says comes back as why, with code null", async () => {
  for (const [said, why] of [
    [
      { ok: false, why: "does-not-replay", step: "computer" },
      "does-not-replay",
    ],
    [{ ok: false, why: "too-long", step: "log" }, "too-long"],
    [{ ok: false, why: "engine", step: "engine" }, "engine"],
    [{ ok: false, why: "something new" }, "does-not-replay"],
    [null, "does-not-replay"],
  ]) {
    const h = harness({ check: async () => said });
    assert.deepEqual(await h.share("c1"), {
      t: "shared",
      id: 1,
      code: null,
      v: 0,
      why,
    });
    assert.equal(h.store.shares.size, 0);
    assert.equal(h.store.rooms.size, 0);
  }
});

test("share: busy when the renderer cannot take it, failed when the check breaks", async () => {
  const busy = harness({
    check: async () => {
      throw new ShareBusy("throttled");
    },
  });
  assert.equal((await busy.share("c1")).why, "busy");
  const broken = harness({
    check: async () => {
      throw new Error("Lambda said no");
    },
  });
  const e = await broken.share("c1");
  assert.equal(e.t, "error");
  assert.equal(e.code, "failed");
  assert.equal(e.re, "share");
  assert.equal(e.id, 1);
});

test("share: unavailable without a check, without engines, or without the store's share methods", async () => {
  for (const h of [
    harness({ check: null }),
    harness({ engines: [] }),
    harness({
      store: { ...memoryStore({ now: () => T0 }), getShare: undefined },
    }),
  ])
    assert.deepEqual(await h.share("c1"), {
      t: "shared",
      id: 1,
      code: null,
      v: 0,
      why: "unavailable",
    });
});

test("share: another engine is refused before the check", async () => {
  const h = harness();
  for (const engine of ["0.6.9", "0.8.0", "x"])
    assert.equal((await h.share("c1", { ...G, engine })).why, "engine");
  assert.equal(h.checked.length, 0);
});

test("share: too-long on cheap signals first, before any read or check", async () => {
  const h = harness({
    limits: { ...LIMITS, shareActions: 3, shareStartBytes: 64 },
  });
  const many = { ...G, log: Array.from({ length: 4 }, () => ({ a: {} })) };
  assert.equal((await h.share("c1", many)).why, "too-long");
  assert.equal(
    (await h.share("c1", { ...G, start: "x".repeat(65) })).why,
    "too-long",
  );
  const small = harness({ limits: { ...LIMITS, shareBytes: 200 } });
  const big = {
    ...G,
    log: Array.from({ length: 3 }, () => ({ a: { pad: "x".repeat(40) } })),
  };
  assert.equal((await small.share("c1", big)).why, "too-long");
  assert.equal(h.checked.length + small.checked.length, 0);
  assert.equal(h.store.shareDays.size, 0);
});

test("share: a bad shape is an error, never a check", async () => {
  const h = harness();
  for (const g of [
    null,
    "match",
    { ...G, engine: 7 },
    { ...G, start: "" },
    { ...G, log: {} },
    { ...G, log: [{ b: 1 }] },
    { ...G, log: [7] },
    { ...G, end: null },
    { ...G, end: { winner: "C", throws: 1 } },
    { ...G, end: { winner: "A", throws: -1 } },
    { ...G, end: { winner: "A", throws: 1.5 } },
  ]) {
    const e = await h.share("c1", g);
    assert.equal(e.t, "error", JSON.stringify(g));
    assert.equal(e.code, "bad-message");
    assert.equal(e.re, "share");
  }
  assert.equal(h.checked.length, 0);
});

test("share: two checked a connection, then too-many; a new connection may share again", async () => {
  const h = harness({
    check: async () => ({ ok: false, why: "does-not-replay" }),
  });
  const g = (n) => ({ ...G, log: [{ a: { n } }] });
  assert.equal((await h.share("c1", g(1))).why, "does-not-replay");
  assert.equal((await h.share("c1", g(2))).why, "does-not-replay");
  const e = await h.share("c1", g(3));
  assert.equal(e.t, "error");
  assert.equal(e.code, "too-many");
  assert.equal(h.checked.length, 2);
  await h.rooms.disconnect("c1");
  assert.equal((await h.share("c1", g(4))).why, "does-not-replay");
});

test("share: the day's cap answers busy without a check, and lifts the next UTC day", async () => {
  const h = harness({ limits: { ...LIMITS, sharesPerDay: 1 } });
  const g = (n) => ({ ...G, log: [{ a: { n } }] });
  assert.ok((await h.share("c1", g(1))).code);
  assert.equal((await h.share("c2", g(2))).why, "busy");
  assert.equal(h.checked.length, 1);
  assert.equal(h.store.shareDays.get("2026-11-19").n, 1);
  h.advance(24 * 3600 * 1000);
  assert.ok((await h.share("c3", g(2))).code);
});

test("share: half a message is never handled; parts in any order make it; bad parts are errors", async () => {
  const h = harness();
  const pad = "x".repeat(70_000);
  const g = { ...G, log: [{ a: { type: "throw", pad } }, ...G.log] };
  const frames = toFrames(asciiJson({ t: "share", id: 5, g }), LIMITS.frame);
  assert.ok(frames.length >= 3);
  // missing: no answer, no check, no count
  for (const f of frames.slice(0, -1)) await h.rooms.message("c1", f);
  assert.deepEqual(h.take("c1"), []);
  assert.equal(h.checked.length, 0);
  assert.equal(h.store.shareDays.size, 0);
  // out of order and repeated: one answer
  const shuffled = [
    frames.at(-1),
    frames[1],
    frames[0],
    frames[1],
    ...frames.slice(2, -1),
  ];
  for (const f of shuffled) await h.rooms.message("c2", f);
  const got = h.take("c2").filter((m) => m.t === "shared");
  assert.equal(got.length, 1);
  assert.ok(got[0].code);
  assert.equal(h.checked.length, 1);
  // too many parts, a part too large
  await h.rooms.message("c3", `~abc123.0.${LIMITS.parts + 1}~{}`);
  assert.equal(h.take("c3").at(-1).code, "bad-message");
  await h.rooms.message("c3", `~abc124.0.2~${"x".repeat(LIMITS.frame)}`);
  assert.equal(h.take("c3").at(-1).code, "bad-message");
  // a whole message too large for the room server: too-big before any share check
  const huge = { ...G, log: [{ a: { pad: "x".repeat(LIMITS.messageBytes) } }] };
  for (const f of toFrames(
    asciiJson({ t: "share", id: 6, g: huge }),
    LIMITS.frame,
  ).slice(0, LIMITS.parts))
    await h.rooms.message("c4", f);
  const big = h.take("c4").at(-1);
  assert.ok(
    big === undefined || big.code === "too-big" || big.code === "bad-message",
  );
  assert.equal(h.checked.length, 1);
});

test("share: a sealed room refuses join, set and keep", async () => {
  const h = harness();
  const { code } = await h.share("c1");
  await h.say("c2", {
    t: "join",
    room: code,
    member: "member-two",
    name: "Bo",
  });
  const e = h.take("c2").at(-1);
  assert.equal(e.t, "error");
  assert.equal(e.code, "sealed");
  assert.equal(e.re, "join");
  assert.deepEqual((await h.store.getRoom(code)).members, {});
  // a connection that somehow holds a place there still cannot write
  await h.store.putConn("c3", { room: code, member: "member-three", exp: 9e9 });
  await h.say("c3", { t: "set", id: 2, base: 1, doc: { lobby: true } });
  const set = h.take("c3").at(-1);
  assert.equal(set.code, "sealed");
  assert.equal(set.id, 2);
  await h.say("c3", { t: "keep", v: 1, replay: { v: 1 } });
  assert.equal(h.take("c3").at(-1).code, "sealed");
  assert.equal((await h.store.getDoc(code)).doc, PASSED.document);
  assert.equal((await h.store.getReplay(code)).data, PASSED.replay);
});

test("share: a lost race for the share key answers the winner's code", async () => {
  const store = memoryStore({ now: () => T0 });
  const h = harness({
    store: {
      ...store,
      async keepShare(hash, code, items, opts) {
        await store.keepShare(hash, "zzzzzzzzzz", items);
        return store.keepShare(hash, code, items, opts);
      },
    },
  });
  assert.equal((await h.share("c1")).code, "zzzzzzzzzz");
  assert.equal(store.rooms.size, 1, "the loser left nothing");
});

test("share: a key naming an incomplete share is never answered; it is replaced", async () => {
  for (const missing of ["room", "doc", "replay", "unsealed"]) {
    const h = harness();
    const first = await h.share("c1");
    if (missing === "room") h.store.rooms.delete(first.code);
    if (missing === "doc") h.store.docs.delete(first.code);
    if (missing === "replay") h.store.replays.delete(first.code);
    if (missing === "unsealed") h.store.rooms.get(first.code).sealed = false;
    const again = await h.share("c2");
    assert.ok(again.code, missing);
    assert.notEqual(again.code, first.code, missing);
    assert.equal(h.store.shares.get(shareHash(G)).code, again.code);
    assert.equal(h.checked.length, 2, `${missing}: checked again`);
  }
});

// ---------- the DynamoDB store's share items ----------

class ConditionalCheckFailedException extends Error {
  name = "ConditionalCheckFailedException";
}
class TransactionCanceledException extends Error {
  name = "TransactionCanceledException";
  constructor(reasons) {
    super("Transaction cancelled");
    this.CancellationReasons = reasons;
  }
}

// A fake document client for the share path: gets, the day's counter, and the
// share's transaction, all or nothing, its conditions evaluated as DynamoDB would.
// `failOn` (an item's sk: "room", "doc", "replay", "share") makes the next transaction
// that writes it fail as a fault would, writing nothing.
function shareClient({ now = () => T0 } = {}) {
  const items = new Map();
  const sent = [];
  const key = ({ pk, sk }) => `${pk}|${sk}`;
  const fail = new Set();
  const holds = (
    had,
    {
      ConditionExpression: expr,
      ExpressionAttributeNames: n = {},
      ExpressionAttributeValues: v = {},
    },
  ) => {
    if (!expr) return true;
    if (!had) return true; // every condition here starts "attribute_not_exists(pk) OR"
    if (had[n["#exp"]] < v[":now"]) return true;
    return expr.includes(":stale") && had[n["#code"]] === v[":stale"];
  };
  return {
    items,
    sent,
    failOn: (sk) => fail.add(sk),
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      sent.push({ name, input });
      const values = input.ExpressionAttributeValues ?? {};
      if (name === "GetCommand") return { Item: items.get(key(input.Key)) };
      if (name === "UpdateCommand") {
        const k = key(input.Key);
        const had = items.get(k) ?? {};
        if ((had.n ?? 0) >= values[":cap"])
          throw new ConditionalCheckFailedException("no");
        items.set(k, {
          ...input.Key,
          n: (had.n ?? 0) + 1,
          exp: values[":exp"],
        });
        return {};
      }
      if (name === "TransactWriteCommand") {
        const puts = input.TransactItems.map((t) => t.Put);
        const faulty = puts.find((p) => fail.has(p.Item.sk));
        if (faulty) {
          fail.delete(faulty.Item.sk);
          throw new TransactionCanceledException(
            puts.map((p) => ({
              Code: p === faulty ? "ValidationError" : "None",
            })),
          );
        }
        const ok = puts.map((p) => holds(items.get(key(p.Item)), p));
        if (!ok.every(Boolean))
          throw new TransactionCanceledException(
            ok.map((x) => ({ Code: x ? "None" : "ConditionalCheckFailed" })),
          );
        for (const p of puts) items.set(key(p.Item), { ...p.Item });
        return {};
      }
      throw new Error(`fake does not know ${name}`);
    },
  };
}

const ITEMS = (code, exp) => ({
  room: {
    host: null,
    members: {},
    sealed: true,
    shared: T0,
    keep: { v: 1, until: exp },
    rev: 1,
    exp,
  },
  doc: { v: 1, doc: "{}", by: null, sid: null, exp },
  replay: { v: 1, t: T0, data: '{"v":1}', exp },
});

test("dynamo store: a share is one transaction of four puts, refused whole on any condition", async () => {
  const client = shareClient();
  const store = dynamoStore({ client, table: "t", now: () => T0 });
  const exp = Math.floor(T0 / 1000) + 100;
  assert.equal(await store.getShare("h1"), null);
  assert.equal(
    await store.keepShare("h1", "aaaaaaaaaa", ITEMS("aaaaaaaaaa", exp)),
    true,
  );
  const tx = client.sent.find((c) => c.name === "TransactWriteCommand").input;
  assert.deepEqual(
    tx.TransactItems.map(
      (t) => Object.keys(t)[0] + " " + t.Put.Item.pk + " " + t.Put.Item.sk,
    ),
    [
      "Put room#aaaaaaaaaa room",
      "Put room#aaaaaaaaaa doc",
      "Put room#aaaaaaaaaa replay",
      "Put share#h1 share",
    ],
  );
  assert.deepEqual(await store.getShare("h1"), { code: "aaaaaaaaaa", exp });
  assert.equal((await store.getRoom("aaaaaaaaaa")).sealed, true);
  assert.equal((await store.getReplay("aaaaaaaaaa")).data, '{"v":1}');
  // the key taken: nothing of the second is written
  const size = client.items.size;
  assert.equal(
    await store.keepShare("h1", "bbbbbbbbbb", ITEMS("bbbbbbbbbb", exp)),
    false,
  );
  assert.equal(client.items.size, size);
  assert.equal(await store.getRoom("bbbbbbbbbb"), null);
  // a code in use: refused, the key untouched
  assert.equal(
    await store.keepShare("h2", "aaaaaaaaaa", ITEMS("aaaaaaaaaa", exp)),
    false,
  );
  assert.equal(await store.getShare("h2"), null);
  // replacing an incomplete share by naming its code
  assert.equal(
    await store.keepShare("h1", "cccccccccc", ITEMS("cccccccccc", exp), {
      stale: "aaaaaaaaaa",
    }),
    true,
  );
  assert.equal((await store.getShare("h1")).code, "cccccccccc");
  // a fault (not a condition) is thrown, and nothing is written
  client.failOn("replay");
  await assert.rejects(
    store.keepShare("h3", "dddddddddd", ITEMS("dddddddddd", exp)),
  );
  assert.equal(await store.getRoom("dddddddddd"), null);
  assert.equal(await store.getShare("h3"), null);
  // the day's count is its own item, beside the reels'
  assert.equal(await store.countShare("2026-11-19", 2, exp), true);
  assert.equal(await store.countShare("2026-11-19", 2, exp), true);
  assert.equal(await store.countShare("2026-11-19", 2, exp), false);
  assert.equal(await store.countReel("2026-11-19", 2, exp), true);
});

// What a pitch code answers with: anything at all is a pitch someone could reach.
async function reachable(store, code) {
  const [room, doc, replay] = await Promise.all([
    store.getRoom(code),
    store.getDoc(code),
    store.getReplay(code),
  ]);
  return !!(room || doc || replay);
}

test("share: a write that fails on any item leaves nothing; the retry ends with one complete share", async () => {
  for (const kind of ["memory", "dynamo"])
    for (const item of ["doc", "replay", "room", "share"]) {
      const label = `${kind}, ${item}`;
      let store;
      let client = null;
      const codes = [];
      if (kind === "dynamo") {
        client = shareClient();
        client.failOn(item);
        store = dynamoStore({ client, table: "t", now: () => T0 });
      } else {
        // the memory store writes all four in one call: it fails before any of them
        const mem = memoryStore({ now: () => T0 });
        let failing = true;
        store = {
          ...mem,
          async keepShare(...args) {
            if (failing) {
              failing = false;
              throw new Error(`${item} write failed`);
            }
            return mem.keepShare(...args);
          },
        };
      }
      const wrap = {
        ...store,
        async keepShare(hash, code, ...rest) {
          codes.push(code);
          return store.keepShare(hash, code, ...rest);
        },
      };
      const h = harness({ store: wrap });
      const e = await h.share("c1");
      assert.equal(e.t, "error", label);
      assert.equal(e.code, "failed", label);
      assert.equal(await store.getShare(shareHash(G)), null, label);
      assert.equal(
        await reachable(store, codes[0]),
        false,
        `${label}: no orphan`,
      );
      // the same connection may try again: a store failure is not the device's
      const got = await h.share("c1", G, 2);
      assert.equal(got.t, "shared", `${label}: ${JSON.stringify(got)}`);
      assert.ok(got.code, label);
      assert.equal((await store.getShare(shareHash(G))).code, got.code, label);
      assert.equal((await store.getRoom(got.code)).sealed, true, label);
      assert.equal((await store.getDoc(got.code)).doc, PASSED.document, label);
      assert.equal(
        (await store.getReplay(got.code)).data,
        PASSED.replay,
        label,
      );
      assert.equal(
        await reachable(store, codes[0]),
        false,
        `${label}: the failed code`,
      );
      // and once more: the same code, free
      assert.equal((await h.share("c2", G, 3)).code, got.code, label);
      assert.equal(
        h.checked.length,
        2,
        `${label}: checked twice, the day counted twice`,
      );
    }
});

test("share: a store that keeps failing is still held to the day's cap", async () => {
  const mem = memoryStore({ now: () => T0 });
  const h = harness({
    limits: { ...LIMITS, sharesPerDay: 3 },
    store: {
      ...mem,
      keepShare: async () => {
        throw new Error("down");
      },
    },
  });
  for (let i = 0; i < 3; i++)
    assert.equal((await h.share("c1", G, i)).code, "failed");
  assert.equal((await h.share("c1", G, 9)).why, "busy");
  assert.equal(h.checked.length, 3);
});

// ---------- the Lambda check adapter ----------

class TooManyRequestsException extends Error {
  name = "TooManyRequestsException";
}

function lambdaFake(answers) {
  const calls = [];
  return {
    calls,
    async send(command, opts) {
      calls.push({ input: command.input, opts });
      const next = answers.shift();
      if (typeof next === "function") return next(opts);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const answered = (out) => ({
  StatusCode: 200,
  Payload: Buffer.from(JSON.stringify(out)),
});

test("lambda check: a synchronous invoke with { check: g }, answered with its payload", async () => {
  const client = lambdaFake([answered({ ok: true, why: null })]);
  const check = lambdaShareChecker({ client, functionName: "reels" });
  assert.deepEqual(await check({ engine: "0.7.2" }), { ok: true, why: null });
  const [{ input, opts }] = client.calls;
  assert.equal(input.FunctionName, "reels");
  assert.equal(input.InvocationType, "RequestResponse");
  assert.deepEqual(JSON.parse(Buffer.from(input.Payload).toString()), {
    check: { engine: "0.7.2" },
  });
  assert.ok(opts.abortSignal);
});

test("lambda check: throttled, it tries again within the wait, then answers busy", async () => {
  let t = 0;
  const slept = [];
  const sleep = async (ms) => {
    slept.push(ms);
    t += ms;
  };
  const ok = lambdaFake([
    new TooManyRequestsException(),
    answered({ ok: true }),
  ]);
  const check = lambdaShareChecker({
    client: ok,
    functionName: "f",
    now: () => t,
    sleep,
  });
  assert.deepEqual(await check({}), { ok: true });
  assert.deepEqual(slept, [2000]);

  t = 0;
  const always = lambdaFake(
    Array.from({ length: 20 }, () => new TooManyRequestsException()),
  );
  const busy = lambdaShareChecker({
    client: always,
    functionName: "f",
    now: () => t,
    sleep,
  });
  await assert.rejects(busy({}), ShareBusy);
  assert.ok(always.calls.length <= 10, `${always.calls.length} tries in 20 s`);
});

test("lambda check: a check past the wait is busy; a function error is an error", async () => {
  const slow = lambdaFake([
    (opts) =>
      new Promise((_, reject) =>
        opts.abortSignal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        }),
      ),
  ]);
  const check = lambdaShareChecker({
    client: slow,
    functionName: "f",
    waitMs: 30,
  });
  await assert.rejects(check({}), ShareBusy);
  const failed = lambdaFake([
    { StatusCode: 200, FunctionError: "Unhandled", Payload: Buffer.from("{}") },
  ]);
  await assert.rejects(
    lambdaShareChecker({ client: failed, functionName: "f" })({}),
    (e) => !(e instanceof ShareBusy),
  );
});

// ---------- end to end: a real match through the real check ----------

test("share end to end: a real match is checked, reads as a finished pitch, and a reel starts", async () => {
  const sources = bundleLua();
  const played = await playSolo(soloSetup(2), sources);
  const started = [];
  const h = harness({
    check: (g) => realCheck({ g, sources, engine: ENGINE, engines: ["0.7"] }),
    startReel: async (job) => started.push(job),
  });
  const g = {
    client: "ios-1.0.90",
    engine: ENGINE,
    start: played.start,
    log: played.log,
    end: { winner: played.end.winner, throws: played.end.throws },
  };
  const text = asciiJson({ t: "share", id: 1, g });
  const frames = toFrames(text, LIMITS.frame);
  assert.ok(frames.length > 1, "a real match travels in parts");
  for (const f of frames) await h.rooms.message("c1", f);
  const got = h.take("c1").at(-1);
  assert.equal(got.t, "shared", JSON.stringify(got));
  assert.ok(got.code);

  // the pages function reads it as any finished pitch, with the computer's title form
  const doc = await h.store.getDoc(got.code);
  const kept = await h.store.getReplay(got.code);
  const s = pitchState({ doc: { v: doc.v, doc: doc.doc }, kept: kept.data });
  assert.equal(s.state, "over");
  assert.equal(s.replay, true);
  assert.deepEqual(s.computer, { side: "B", level: "club" });
  const p = previewOf(s);
  assert.equal(p.title, "Riverside vs Computer · Kubb: Throwing Wood");
  assert.equal(
    p.description,
    `Final: Riverside won, against the computer (club), in ${s.turn} turns. Watch the replay.`,
  );

  // and the shared code asks for a reel through the existing path
  await h.say("c2", { t: "reel", id: 2, room: got.code });
  const reel = h.take("c2").at(-1);
  assert.equal(reel.t, "reel");
  assert.equal(reel.v, 1);
  assert.equal(reel.reel?.state, "rendering", JSON.stringify(reel));
  assert.equal(started.length, 1);
  assert.equal(started[0].room, got.code);
});
