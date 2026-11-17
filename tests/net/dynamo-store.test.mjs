// backend/rooms/dynamo-store.mjs against a fake DynamoDB document client that evaluates
// exactly the condition expressions the store uses, so the conditional write paths
// (compare-and-set, fresh-or-expired, the one-winner chunk claim) are exercised.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import {
  asciiJson,
  createRooms,
  parseOrigins,
  toFrames,
} from "../../backend/rooms/core.mjs";
import { dynamoStore } from "../../backend/rooms/dynamo-store.mjs";
import { gatewayAdapters, makeHandler } from "../../backend/rooms/handler.mjs";

class ConditionalCheckFailedException extends Error {
  name = "ConditionalCheckFailedException";
}

function fakeClient() {
  const items = new Map(); // "pk|sk" -> item
  const calls = [];
  const key = ({ pk, sk }) => `${pk}|${sk}`;
  const tick = () => new Promise((r) => setImmediate(r)); // let parallel calls interleave

  function check(item, input) {
    const expr = input.ConditionExpression;
    if (!expr) return;
    const names = input.ExpressionAttributeNames ?? {};
    const values = input.ExpressionAttributeValues ?? {};
    let ok;
    if (expr === "attribute_exists(pk)") ok = Boolean(item);
    else if (expr === "attribute_not_exists(pk) OR #exp < :now")
      ok = !item || item[names["#exp"]] < values[":now"];
    else if (expr === "attribute_not_exists(pk) OR #rev < :rev")
      ok = !item || item[names["#rev"]] < values[":rev"];
    else if (expr === "attribute_not_exists(pk) OR #exp < :now OR #v < :v")
      ok =
        !item ||
        item[names["#exp"]] < values[":now"] ||
        item[names["#v"]] < values[":v"];
    else if (expr === "#attr = :expected")
      ok = Boolean(item) && item[names["#attr"]] === values[":expected"];
    else throw new Error(`fake does not know ${expr}`);
    if (!ok)
      throw new ConditionalCheckFailedException(
        "The conditional request failed",
      );
  }

  return {
    items,
    calls,
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push(name);
      await tick();
      switch (name) {
        case "GetCommand":
          return { Item: structuredClone(items.get(key(input.Key))) };
        case "PutCommand":
          check(items.get(key(input.Item)), input);
          items.set(key(input.Item), structuredClone(input.Item));
          return {};
        case "DeleteCommand":
          check(items.get(key(input.Key)), input);
          items.delete(key(input.Key));
          return {};
        case "UpdateCommand": {
          const item = items.get(key(input.Key));
          check(item, input);
          item.exp = input.ExpressionAttributeValues[":exp"];
          return {};
        }
        case "QueryCommand": {
          const v = input.ExpressionAttributeValues;
          const pk = v[":pk"];
          if (input.KeyConditionExpression === "pk = :pk AND sk >= :since") {
            // the open games list: newest first, Limit before the filter
            assert.equal(
              input.FilterExpression,
              "#exp > :now AND listed = :yes",
            );
            assert.equal(input.ScanIndexForward, false);
            const Items = [...items.values()]
              .filter((i) => i.pk === pk && i.sk >= v[":since"])
              .sort((a, b) => (a.sk < b.sk ? 1 : -1))
              .slice(0, input.Limit)
              .filter((i) => i.exp > v[":now"] && i.listed === v[":yes"])
              .map((i) => structuredClone(i));
            return { Items };
          }
          assert.equal(
            input.KeyConditionExpression,
            "pk = :pk AND begins_with(sk, :sk)",
          );
          const prefix = v[":sk"];
          const Items = [...items.values()]
            .filter((i) => i.pk === pk && i.sk.startsWith(prefix))
            .map((i) => structuredClone(i));
          return { Items };
        }
        case "BatchWriteCommand":
          for (const reqs of Object.values(input.RequestItems)) {
            for (const r of reqs) items.delete(key(r.DeleteRequest.Key));
          }
          return {};
        default:
          throw new Error(`fake does not know ${name}`);
      }
    },
  };
}

const T0 = 1_700_000_000_000;

test("room and document: fresh writes, compare-and-set on rev and v", async () => {
  let t = T0;
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: () => t });
  const exp = T0 / 1000 + 100;
  assert.equal(await store.getRoom("room1234"), null);
  assert.equal(
    await store.putRoom("room1234", { rev: 1, exp, host: "m", members: {} }, 0),
    true,
  );
  assert.equal(
    await store.putRoom("room1234", { rev: 1, exp, host: "x", members: {} }, 0),
    false,
  ); // exists
  assert.equal(
    await store.putRoom(
      "room1234",
      { rev: 2, exp, host: "m", members: { m: {} } },
      1,
    ),
    true,
  );
  assert.equal(
    await store.putRoom("room1234", { rev: 2, exp, host: "z", members: {} }, 1),
    false,
  ); // lost race
  assert.deepEqual(await store.getRoom("room1234"), {
    rev: 2,
    exp,
    host: "m",
    members: { m: {} },
  });

  assert.equal(
    await store.putDoc(
      "room1234",
      { v: 1, doc: "{}", by: "m", sid: "1", exp },
      0,
    ),
    true,
  );
  assert.equal(
    await store.putDoc(
      "room1234",
      { v: 1, doc: "[]", by: "n", sid: "2", exp },
      0,
    ),
    false,
  );
  assert.equal(
    await store.putDoc(
      "room1234",
      { v: 2, doc: "[1]", by: "n", sid: "3", exp },
      1,
    ),
    true,
  );
  assert.equal((await store.getDoc("room1234")).doc, "[1]");

  await store.touchDoc("room1234", exp + 50);
  assert.equal((await store.getDoc("room1234")).exp, exp + 50);
  await store.touchDoc("nothere1", exp); // no document: no error, nothing written
  assert.equal(client.items.has("room#nothere1|doc"), false);

  // Past exp (TTL not yet swept): reads as absent and a fresh write may replace it.
  t = (exp + 51) * 1000;
  assert.equal(await store.getRoom("room1234"), null);
  assert.equal(await store.getDoc("room1234"), null);
  assert.equal(
    await store.putRoom(
      "room1234",
      { rev: 1, exp: exp + 500, host: "q", members: {} },
      0,
    ),
    true,
  );
  assert.equal(
    await store.putDoc(
      "room1234",
      { v: 1, doc: "null", by: "q", sid: null, exp: exp + 500 },
      0,
    ),
    true,
  );
});

test("connections: cached per container, deleted for good", async () => {
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: () => T0 });
  await store.putConn("c1", {
    room: "room1234",
    member: "m",
    exp: T0 / 1000 + 10,
  });
  const before = client.calls.length;
  assert.deepEqual(await store.getConn("c1"), {
    room: "room1234",
    member: "m",
    exp: T0 / 1000 + 10,
  });
  assert.equal(client.calls.length, before); // from the cache
  const other = dynamoStore({ client, table: "rooms", now: () => T0 }); // another container
  assert.equal((await other.getConn("c1")).member, "m");
  await store.delConn("c1");
  assert.equal(await store.getConn("c1"), null);
  assert.equal(client.items.size, 0);
});

test("chunks arriving in parallel invocations: exactly one gets the whole message", async () => {
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: () => T0 });
  const parts = ["aaa", "bbb", "ccc", "ddd", "eee"];
  const results = await Promise.all(
    parts
      .map((text, i) =>
        store.addChunk("c1", "msg1", i, parts.length, text, T0 / 1000 + 600),
      )
      .reverse(),
  );
  const whole = results.filter((r) => r !== null);
  assert.deepEqual(whole, ["aaabbbcccdddeee"]);
  assert.equal(
    [...client.items.keys()].filter((k) => k.includes("part#")).length,
    0,
  ); // cleaned up
});

test("core over the DynamoDB store: two members race a set, one wins, the other gets the doc", async () => {
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: () => T0 });
  const inbox = new Map();
  const rooms = createRooms({
    store,
    now: () => T0,
    async send(conn, text) {
      if (!inbox.has(conn)) inbox.set(conn, []);
      inbox.get(conn).push(text);
      return true;
    },
  });
  const say = (conn, msg) => rooms.message(conn, asciiJson(msg));
  await Promise.all([
    say("c1", { t: "join", room: "rqqm2345", member: "member-one" }),
    say("c2", { t: "join", room: "rqqm2345", member: "member-two" }),
  ]);
  const room = await store.getRoom("rqqm2345");
  assert.deepEqual(Object.keys(room.members).sort(), [
    "member-one",
    "member-two",
  ]); // neither join lost
  await Promise.all([
    say("c1", { t: "set", id: 1, base: 0, doc: { by: 1 } }),
    say("c2", { t: "set", id: 1, base: 0, doc: { by: 2 } }),
  ]);
  const replies = [...inbox.values()]
    .flat()
    .map((t) => JSON.parse(t))
    .filter((m) => m.t === "ok" || m.t === "no");
  assert.deepEqual(replies.map((m) => m.t).sort(), ["no", "ok"]);
  assert.equal((await store.getDoc("rqqm2345")).v, 1);

  // A large document is uploaded in parts that land in parallel.
  inbox.clear();
  const big = { s: "x".repeat(100_000) };
  await Promise.all(
    toFrames(asciiJson({ t: "set", id: 2, base: 1, doc: big })).map((f) =>
      rooms.message("c1", f),
    ),
  );
  assert.equal((await store.getDoc("rqqm2345")).v, 2);
});

test("handler: origin filter on $connect, routes, and Gone sends", async () => {
  const seen = [];
  const handler = makeHandler({
    rooms: {
      message: async (c, b) => seen.push(["message", c, b]),
      disconnect: async (c) => seen.push(["bye", c]),
    },
    origins: ["https://kubb.thingelstad.xyz", "http://localhost"],
  });
  const ctx = (routeKey) => ({
    requestContext: {
      routeKey,
      connectionId: "c1",
      domainName: "x",
      stage: "prod",
    },
  });
  assert.equal(
    (
      await handler({
        ...ctx("$connect"),
        headers: { Origin: "https://kubb.thingelstad.xyz" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await handler({
        ...ctx("$connect"),
        headers: { origin: "http://localhost:5173" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await handler({
        ...ctx("$connect"),
        headers: { Origin: "https://other.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await handler({ ...ctx("$connect"), headers: {} })).statusCode,
    403,
  );
  await handler({ ...ctx("$default"), body: '{"t":"ping"}' });
  await handler(ctx("$disconnect"));
  assert.deepEqual(seen, [
    ["message", "c1", '{"t":"ping"}'],
    ["bye", "c1"],
  ]);

  const gone = Object.assign(new Error("gone"), {
    name: "GoneException",
    $metadata: { httpStatusCode: 410 },
  });
  const api = { send: async () => Promise.reject(gone) };
  const { send, close } = gatewayAdapters(api);
  assert.equal(await send("c1", "hi"), false);
  await close("c1"); // quiet
  const ok = gatewayAdapters({ send: async () => ({}) });
  assert.equal(await ok.send("c1", "hi"), true);
});

test("open games: listed in one partition, read newest first by one Query", async () => {
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: () => T0 });
  const entry = (made, extra = {}) => ({
    made,
    rev: 1,
    listed: true,
    players: 2,
    seats: 12,
    state: "waiting",
    exp: T0 / 1000 + 900,
    ...extra,
  });
  await store.putListing("aaaaaaaa", entry(T0 - 5000));
  await store.putListing("bbbbbbbb", entry(T0 - 1000, { state: "playing" }));
  await store.putListing("cccccccc", entry(T0 - 3000, { exp: T0 / 1000 - 1 }));
  await store.putListing("dddddddd", entry(T0 - 99_000_000));
  assert.ok(
    client.items.has(`open|${String(T0 - 5000).padStart(13, "0")}#aaaaaaaa`),
  );
  client.calls.length = 0;
  const rows = await store.listOpen({
    since: T0 - 60_000,
    limit: 10,
    now: T0 / 1000,
  });
  assert.deepEqual(client.calls, ["QueryCommand"], "one read, no scan");
  assert.deepEqual(
    rows.map((r) => [r.room, r.state]),
    [
      ["bbbbbbbb", "playing"],
      ["aaaaaaaa", "waiting"],
    ],
  );
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "made",
    "players",
    "room",
    "seats",
    "state",
  ]);
  // a stale write (same or older rev) is refused; a newer one replaces it
  assert.equal(
    await store.putListing("aaaaaaaa", entry(T0 - 5000, { state: "over" })),
    false,
  );
  assert.equal(
    (await store.listOpen({ since: 0, limit: 10, now: T0 / 1000 }))[1].state,
    "waiting",
  );
  // taken off: an unlisted entry with a newer rev, which an older put cannot undo
  assert.equal(
    await store.putListing("bbbbbbbb", {
      made: T0 - 1000,
      rev: 3,
      listed: false,
      exp: T0 / 1000 + 900,
    }),
    true,
  );
  assert.equal(
    await store.putListing("bbbbbbbb", entry(T0 - 1000, { rev: 2 })),
    false,
  );
  // Limit counts before the expiry filter: a short list, never a long one
  const one = await store.listOpen({ since: 0, limit: 1, now: T0 / 1000 });
  assert.deepEqual(one, []);
  const four = await store.listOpen({ since: 0, limit: 4, now: T0 / 1000 });
  assert.deepEqual(
    four.map((r) => r.room),
    ["aaaaaaaa", "dddddddd"],
  );
});

test("replays: gzipped beside the room, newer versions only, read back whole", async () => {
  let t = T0;
  const client = fakeClient();
  const store = dynamoStore({ client, table: "rooms", now: () => t });
  const exp = T0 / 1000 + 365 * 24 * 3600;
  assert.equal(await store.getReplay("room1234"), null);
  const data = asciiJson({
    v: 1,
    log: Array.from({ length: 400 }, () => ({
      a: { type: "throw" },
      h: "abcdef01",
    })),
  });
  assert.equal(
    await store.putReplay("room1234", { v: 5, t: T0, data, exp }),
    true,
  );
  const item = client.items.get("room#room1234|replay");
  assert.ok(
    item.z.length < data.length / 5,
    `gzipped: ${item.z.length} of ${data.length}`,
  );
  assert.equal(item.data, undefined);
  assert.deepEqual(await store.getReplay("room1234"), {
    v: 5,
    t: T0,
    data,
    exp,
  });
  // the same version or an older one is not kept over it
  assert.equal(
    await store.putReplay("room1234", { v: 5, t: T0 + 1, data: "{}", exp }),
    false,
  );
  assert.equal(
    await store.putReplay("room1234", { v: 4, t: T0 + 1, data: "{}", exp }),
    false,
  );
  assert.equal(
    await store.putReplay("room1234", { v: 6, t: T0 + 2, data: "{}", exp }),
    true,
  );
  assert.equal((await store.getReplay("room1234")).data, "{}");
  // past its year it reads as absent, and any version may take its place
  t = (exp + 1) * 1000;
  assert.equal(await store.getReplay("room1234"), null);
  assert.equal(
    await store.putReplay("room1234", { v: 1, t, data: "[]", exp: exp + 9 }),
    true,
  );
});

test("handler: the stack's default allow-list lets the iPhone app in, and no stranger", async () => {
  const template = JSON.parse(
    await fs.readFile(
      new URL("../../infra/rooms.json", import.meta.url),
      "utf8",
    ),
  );
  const origins = parseOrigins(template.Parameters.AllowedOrigins.Default);
  assert.deepEqual(origins, [
    "https://throwingwood.com",
    "https://kubb.thingelstad.xyz",
    "https://app.throwingwood.com",
    "http://localhost",
    "http://127.0.0.1",
  ]);
  const handler = makeHandler({ rooms: {}, origins });
  const connect = async (origin) =>
    (
      await handler({
        requestContext: {
          routeKey: "$connect",
          connectionId: "c1",
          domainName: "x",
          stage: "prod",
        },
        headers: origin ? { Origin: origin } : {},
      })
    ).statusCode;
  assert.equal(await connect("https://app.throwingwood.com"), 200);
  assert.equal(await connect("https://throwingwood.com"), 200);
  assert.equal(await connect("https://example.com"), 403);
  assert.equal(await connect("http://app.throwingwood.com"), 403);
  assert.equal(await connect("https://app.throwingwood.com.example.com"), 403);
  assert.equal(await connect("https://x.app.throwingwood.com"), 403);
  assert.equal(await connect(null), 403);
});
