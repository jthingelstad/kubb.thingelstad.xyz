// backend/rooms/dynamo-store.mjs against a fake DynamoDB document client that evaluates
// exactly the condition expressions the store uses, so the conditional write paths
// (compare-and-set, fresh-or-expired, the one-winner chunk claim) are exercised.
import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiJson, createRooms, toFrames } from "../../backend/rooms/core.mjs";
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
          const pk = input.ExpressionAttributeValues[":pk"];
          const prefix = input.ExpressionAttributeValues[":sk"];
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
