// The pitch server's pure edges, in node: the open games list's rules, the push
// contract (signature, envelope, backoff) and the Worker's Origin filter. The Durable
// Objects themselves are tested in the Workers pool (backend/pitch-server/test/).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOBBY,
  cleanEntry,
  listing,
  report,
} from "../../backend/pitch-server/src/lobby.mjs";
import {
  PUSH,
  envelope,
  idempotencyKey,
  pushRequest,
  retryDelay,
  sign,
} from "../../backend/pitch-server/src/push.mjs";
import {
  corsHeaders,
  originAllowed,
  parseOrigins,
  sameKey,
  socketOriginOk,
} from "../../backend/pitch-server/src/http.mjs";

const entry = (made, extra = {}) => ({
  made,
  players: 2,
  watchers: 1,
  seats: 12,
  state: "waiting",
  ...extra,
});

test("the lobby keeps the newest report per pitch, tombstones included", () => {
  const store = new Map();
  const t = 1_000_000;
  assert.equal(
    report(store, { pitch: "k7mpq2rstw", entry: entry(t), at: t, seq: 0 }, t),
    true,
  );
  // an older report is ignored, the same revision too
  assert.equal(
    report(store, { pitch: "k7mpq2rstw", entry: null, at: t - 1, seq: 9 }, t),
    false,
  );
  assert.equal(
    report(store, { pitch: "k7mpq2rstw", entry: null, at: t, seq: 0 }, t),
    false,
  );
  // a newer take-off holds against a late listing
  assert.equal(
    report(store, { pitch: "k7mpq2rstw", entry: null, at: t, seq: 1 }, t),
    true,
  );
  assert.equal(
    report(store, { pitch: "k7mpq2rstw", entry: entry(t), at: t, seq: 0 }, t),
    false,
  );
  assert.deepEqual(listing([...store.values()], t), []);
  assert.equal(store.get("k7mpq2rstw").exp, t + LOBBY.ttlMs);
});

test("the lobby refuses junk", () => {
  const store = new Map();
  const t = 5;
  for (const bad of [
    { pitch: "ABC", entry: entry(t), at: t },
    { pitch: "k7mpq2rstw", entry: entry(t), at: "now" },
    { pitch: "k7mpq2rstw", entry: entry(t, { seats: 0 }), at: t },
    { pitch: "k7mpq2rstw", entry: entry(t, { seats: 13 }), at: t },
    { pitch: "k7mpq2rstw", entry: entry(t, { state: "over" }), at: t },
    { pitch: "k7mpq2rstw", entry: entry(t, { players: -1 }), at: t },
  ])
    assert.equal(report(store, bad, t), false, JSON.stringify(bad));
  assert.equal(store.size, 0);
  assert.deepEqual(cleanEntry({ ...entry(1), name: "Anna" }), entry(1));
});

test("the list: newest 20 live entries of the last day, no names", () => {
  const t = 100 * 24 * 3600 * 1000;
  const rows = [];
  for (let i = 0; i < 30; i++)
    rows.push({
      pitch: `k7mpq2rs${"abcdefghjkmnpqrstuvwxyz23456789"[i]}`,
      at: t,
      seq: 0,
      exp: t + 1,
      entry: entry(t - i * 1000),
    });
  rows.push({
    pitch: "oldpitch22",
    at: t,
    seq: 0,
    exp: t + 1,
    entry: entry(t - LOBBY.maxAgeMs - 1),
  });
  rows.push({
    pitch: "gonepitch2",
    at: t,
    seq: 0,
    exp: t,
    entry: entry(t + 5),
  });
  rows.push({ pitch: "tombstone2", at: t, seq: 0, exp: t + 1, entry: null });
  const out = listing(rows, t);
  assert.equal(out.length, LOBBY.listMax);
  assert.equal(out[0].made, t);
  assert.equal(out[19].made, t - 19_000);
  assert.deepEqual(Object.keys(out[1]).sort(), [
    "age",
    "made",
    "pitch",
    "players",
    "seats",
    "state",
    "watchers",
  ]);
  assert.equal(out[1].age, 1000);
});

test("pushes are signed with HMAC-SHA256 over the exact body", async () => {
  // RFC 4231, test case 2
  assert.equal(
    await sign("Jefe", "what do ya want for nothing?"),
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );
  const req = await pushRequest({
    url: "https://receiver.example/push",
    secret: "s3cret",
    pitch: "k7mpq2rstw",
    made: 123,
    k: "act:1:4",
    topic: "act",
    body: { n: 1, seq: 4 },
    sent: 999,
  });
  assert.equal(req.init.method, "POST");
  assert.equal(
    req.init.body,
    envelope({
      pitch: "k7mpq2rstw",
      made: 123,
      k: "act:1:4",
      topic: "act",
      body: { n: 1, seq: 4 },
      sent: 999,
    }),
  );
  assert.deepEqual(JSON.parse(req.init.body), {
    v: 1,
    pitch: "k7mpq2rstw",
    made: 123,
    k: "act:1:4",
    topic: "act",
    sent: 999,
    body: { n: 1, seq: 4 },
  });
  assert.equal(
    req.init.headers["x-pitch-signature"],
    `sha256=${await sign("s3cret", req.init.body)}`,
  );
  assert.equal(
    req.init.headers["idempotency-key"],
    idempotencyKey("k7mpq2rstw", 123, "act:1:4"),
  );
  assert.equal(req.init.headers["idempotency-key"], "k7mpq2rstw:123:act:1:4");
});

test("push retries back off, doubling to a cap, with jitter below the step", () => {
  assert.equal(
    retryDelay(1, () => 0),
    PUSH.firstRetryMs,
  );
  assert.equal(
    retryDelay(2, () => 0),
    2 * PUSH.firstRetryMs,
  );
  assert.equal(
    retryDelay(4, () => 0),
    8 * PUSH.firstRetryMs,
  );
  assert.equal(
    retryDelay(40, () => 0),
    PUSH.maxRetryMs,
  );
  assert.equal(
    retryDelay(1, () => 1),
    0.8 * PUSH.firstRetryMs,
  );
});

test("the Origin filter: listed browsers in, others out, no Origin (the app) in", () => {
  const allowed = parseOrigins("https://throwingwood.com, http://localhost,,");
  assert.deepEqual(allowed, ["https://throwingwood.com", "http://localhost"]);
  assert.equal(originAllowed("https://throwingwood.com", allowed), true);
  assert.equal(originAllowed("http://localhost:5173", allowed), true);
  assert.equal(originAllowed("http://throwingwood.com", allowed), false);
  assert.equal(
    originAllowed("https://throwingwood.com.evil.example", allowed),
    false,
  );
  assert.equal(originAllowed("null", allowed), false);
  assert.equal(socketOriginOk(null, allowed), true);
  assert.equal(socketOriginOk("https://evil.example", allowed), false);
  assert.equal(
    corsHeaders("https://evil.example", allowed)["access-control-allow-origin"],
    undefined,
  );
  assert.equal(
    corsHeaders("https://throwingwood.com", allowed)[
      "access-control-allow-origin"
    ],
    "https://throwingwood.com",
  );
  assert.equal(sameKey("abc", "abc"), true);
  assert.equal(sameKey("abd", "abc"), false);
  assert.equal(sameKey("", ""), false);
});
