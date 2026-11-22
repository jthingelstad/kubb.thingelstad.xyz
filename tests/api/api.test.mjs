// The api function (backend/api): the pitch server's signed pushes and the plain HTTPS
// calls, over the memory store and over the DynamoDB store on a fake table (the same
// conditions as AWS evaluates them), and what the pitch pages and the reel function read
// of its records.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { LIMITS, asciiJson, originAllowed } from "../../backend/api/checks.mjs";
import { ShareBusy, createApi } from "../../backend/api/core.mjs";
import { dynamoStore } from "../../backend/api/dynamo-store.mjs";
import { memoryStore } from "../../backend/api/memory-store.mjs";
import {
  cachedSecret,
  fromEvent,
  makeHandler,
} from "../../backend/api/handler.mjs";
import {
  matchInfo,
  mergeState,
  pushKey,
  readPush,
  sign,
  signatureValid,
  withSnap,
} from "../../backend/api/push.mjs";
import { memoryRecords, s3Pushes } from "../../backend/api/records.mjs";
import {
  pitchState,
  previewOf,
  readPitch,
} from "../../backend/pages/pitch.mjs";
import { reelStore } from "../../backend/reels/aws.mjs";
import { checkShare as realCheck } from "../../backend/reels/check.mjs";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { playSolo, soloSetup } from "../../tools/reel/solo.mjs";
import engineInfo from "../../vendor/engine.json" with { type: "json" };
import { fakeDynamo } from "./fake-dynamo.mjs";

const SECRET = "a-test-secret-and-nothing-more";
const T0 = Date.UTC(2026, 10, 21, 18, 0, 0);
const MADE = T0 - 60_000;
const CODE = "abcdefgh23";
const ORIGIN = "https://throwingwood.com";
const ENGINE = engineInfo.tag.replace(/^v/, "");
const MINOR = ENGINE.split(".").slice(0, 2).join(".");

const REPLAY = JSON.parse(
  fs.readFileSync("tests/fixtures/replay-north-south.json", "utf8"),
);
// captured with typed names (North, South); a pitch's match now carries generated ones,
// so its sides are renamed here, in memory, as the replay fixture's are
const IN_PLAY = (() => {
  const s = JSON.parse(
    fs.readFileSync("tests/fixtures/snap-in-play.json", "utf8"),
  );
  s.save.game.teams.A.name = "Mighty Maple";
  s.save.game.teams.B.name = "Lucky Larch";
  return JSON.stringify(s);
})();
// the start info a host sends with a match (the replay's own fields, as the client will)
const META = {
  v: REPLAY.v,
  setup: REPLAY.setup,
  engine: REPLAY.engine,
  players: REPLAY.players,
  cpu: REPLAY.cpu,
};
const STORES = ["memory", "dynamo"];

function harness(kind = "memory", over = {}) {
  let t = T0;
  const now = () => t;
  const fake = kind === "dynamo" ? fakeDynamo() : null;
  const store = fake
    ? dynamoStore({ client: fake, table: "rooms", now })
    : memoryStore({ now });
  const records = memoryRecords();
  const logs = [];
  const started = [];
  const secrets = { value: SECRET, reads: 0 };
  const api = createApi({
    store,
    recordPush: records.recordPush,
    keepReport: records.keepReport,
    recordGame: records.recordGame,
    startReel: async (job) => started.push(job),
    reelEngines: [MINOR, "0.9"],
    secret: async (opts = {}) => {
      secrets.reads++;
      return typeof secrets.value === "function"
        ? secrets.value(opts)
        : secrets.value;
    },
    origins: [ORIGIN, "http://localhost"],
    now,
    log: (e) => logs.push(e),
    ...over,
  });
  const call = async (
    method,
    path,
    { body = "", headers = {}, query = "" } = {},
  ) => {
    const res = await api.handle({
      method,
      path,
      query: new URLSearchParams(query),
      headers,
      body: Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
    });
    return { ...res, json: res.body ? JSON.parse(res.body) : null };
  };
  const push = (env, headers = env.headers) =>
    call("POST", "/push", { body: env.raw, headers });
  const post = (path, body, headers = {}) =>
    call("POST", path, { body, headers });
  const replay = async (code = CODE) =>
    (await call("GET", "/replay", { query: `pitch=${code}` })).json;
  // what the pitch pages read: GetItem with the fields named, as backend/pages/main.mjs
  const item = async (pk, sk, fields) => {
    if (!fake) throw new Error("the pages read DynamoDB");
    const { Item } = await fake.send(
      new GetCommand({
        TableName: "rooms",
        Key: { pk, sk },
        ProjectionExpression: fields.map((_, i) => `#f${i}`).join(", "),
        ExpressionAttributeNames: Object.fromEntries(
          fields.map((f, i) => [`#f${i}`, f]),
        ),
      }),
    );
    return Item && Item.exp > t / 1000 ? Item : null;
  };
  return {
    api,
    store,
    fake,
    records,
    logs,
    started,
    secrets,
    call,
    push,
    post,
    replay,
    item,
    tick: (ms) => (t += ms),
    now,
  };
}

// ---------- what a pitch sends ----------

function envelope(
  topic,
  body,
  { pitch = CODE, made = MADE, secret = SECRET } = {},
) {
  const k =
    topic === "start"
      ? `start:${body.n}`
      : topic === "act"
        ? `act:${body.n}:${body.seq}`
        : `keep:${body.n}`;
  const raw = Buffer.from(
    JSON.stringify({
      v: 1,
      pitch,
      made,
      k,
      topic,
      sent: T0,
      body: { pitch, ...body },
    }),
  );
  return {
    raw,
    k,
    headers: {
      "content-type": "application/json",
      "x-pitch-signature": sign(raw, secret),
      "idempotency-key": `${pitch}:${made}:${k}`,
    },
  };
}

const start = (n = 1, opts = {}, meta = META) =>
  envelope(
    "start",
    { n, m: 1, ts: T0, v: 1, doc: {}, meta, h0: REPLAY.h0, snap: IN_PLAY },
    opts,
  );
const act = (
  n,
  seq,
  { over = false, snap = IN_PLAY, h = `h${seq}`, ...opts } = {},
) =>
  envelope(
    "act",
    {
      n,
      id: "m-x",
      seq,
      m: 1,
      a: { type: "throw" },
      h,
      s: 1,
      ts: T0,
      over,
      snap,
    },
    opts,
  );
const keep = (n, log = REPLAY.log, opts = {}, meta = META) =>
  envelope(
    "keep",
    {
      n,
      at: opts.at ?? T0,
      started: T0 - 1000,
      meta,
      h0: REPLAY.h0,
      log: log.map((e, i) => ({ a: e.a, h: e.h, ts: i })),
    },
    opts,
  );

// The whole fixture match as a pitch pushes it: its start, each action (the last one
// over, with the final snapshot), and its kept replay.
function matchPushes({ n = 1, ...opts } = {}) {
  const last = REPLAY.log.length;
  return {
    start: start(n, opts),
    acts: REPLAY.log.map((e, i) =>
      act(n, i + 1, {
        h: e.h,
        over: i + 1 === last,
        snap: i + 1 === last ? REPLAY.snap : IN_PLAY,
        ...opts,
      }),
    ),
    keep: keep(n, REPLAY.log, opts),
  };
}

// the fixture as served: the start info, the log with each action's ts, the final snapshot
const served = (r) => ({
  ...r,
  log: r.log.map(({ a, h }) => ({ a, h })),
});

// ---------- the signature ----------

test("the signature: HMAC-SHA256 of the raw bytes, compared in constant time, before parsing", async () => {
  const raw = Buffer.from('{"v":1}');
  const good = sign(raw, SECRET);
  assert.match(good, /^sha256=[0-9a-f]{64}$/);
  assert.equal(signatureValid(raw, good, SECRET), true);
  assert.equal(signatureValid(Buffer.from('{"v":2}'), good, SECRET), false);
  assert.equal(signatureValid(raw, good, "another secret"), false);
  assert.equal(signatureValid(raw, good.toUpperCase(), SECRET), false);
  assert.equal(signatureValid(raw, good.slice(0, -2), SECRET), false);
  assert.equal(
    signatureValid(raw, good.replace("sha256=", "sha1="), SECRET),
    false,
  );
  assert.equal(signatureValid(raw, undefined, SECRET), false);
  assert.equal(signatureValid(raw, good, ""), false);
  assert.equal(signatureValid(raw, good, null), false);
});

for (const kind of STORES)
  test(`${kind}: a push is taken only signed with the secret; a tampered body is refused and nothing is kept`, async () => {
    const h = harness(kind);
    const ok = start();
    // the same bytes with one changed, under the original signature
    const tampered = Buffer.from(ok.raw);
    const at = tampered.indexOf("Mighty");
    tampered[at] = "S".charCodeAt(0);
    const bad = await h.push({ ...ok, raw: tampered });
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error, "bad-signature");
    // no header, a header from another secret, a header of another shape
    for (const headers of [
      { "idempotency-key": ok.headers["idempotency-key"] },
      {
        ...ok.headers,
        "x-pitch-signature": start(1, { secret: "wrong" }).headers[
          "x-pitch-signature"
        ],
      },
      { ...ok.headers, "x-pitch-signature": "sha256=zz" },
    ])
      assert.equal((await h.push(ok, headers)).status, 401);
    // unsigned text that is not even JSON is refused for its signature, not parsed
    const junk = await h.push({ raw: Buffer.from("{not json"), headers: {} });
    assert.equal(junk.status, 401);
    assert.equal(h.records.kept.size, 0);
    assert.equal(await h.store.getState(CODE), null);
    // signed, it is taken
    const good = await h.push(ok);
    assert.equal(good.status, 200);
    assert.deepEqual(good.json, { ok: true });
    assert.equal(h.records.kept.size, 1);
  });

test("no secret configured: pushes are unavailable (503), so the pitch keeps them", async () => {
  const h = harness();
  h.secrets.value = null;
  const res = await h.push(start());
  assert.equal(res.status, 503);
  assert.equal(h.records.kept.size, 0);
});

test("a changed secret: a push that fails is checked once more against the secret read afresh", async () => {
  const h = harness();
  let current = "the old secret";
  h.secrets.value = ({ fresh }) => (fresh ? (current = SECRET) : current);
  assert.equal((await h.push(start())).status, 200);
  // a push under neither is still refused
  assert.equal((await h.push(act(1, 1, { secret: "neither" }))).status, 401);
});

test("the secret is cached, read afresh at most every 5 minutes, and a failed read keeps the last", async () => {
  let t = 0;
  let reads = 0;
  let value = "one";
  let fail = false;
  const secret = cachedSecret({
    now: () => t,
    read: async () => {
      reads++;
      if (fail) throw new Error("down");
      return value;
    },
  });
  assert.equal(await secret(), "one");
  assert.equal(await secret(), "one");
  value = "two";
  assert.equal(await secret({ fresh: true }), "one", "not yet five minutes");
  assert.equal(reads, 1);
  t = 5 * 60_000;
  assert.equal(await secret({ fresh: true }), "two");
  assert.equal(reads, 2);
  fail = true;
  t = 10 * 60_000;
  assert.equal(await secret({ fresh: true }), "two");
});

// ---------- what a push must be ----------

test("a signed push this function cannot read is a 400, so the pitch keeps it until fixed", async () => {
  const h = harness();
  const ok = start();
  const env = JSON.parse(ok.raw);
  const resign = (value, key = ok.headers["idempotency-key"]) => {
    const raw = Buffer.from(JSON.stringify(value));
    return {
      raw,
      headers: {
        "x-pitch-signature": sign(raw, SECRET),
        "idempotency-key": key,
      },
    };
  };
  const cases = [
    resign(env, `${CODE}:${MADE}:start:2`), // the header names another push
    resign({ ...env, k: "start:9" }, `${CODE}:${MADE}:start:9`), // the key is not the body's
    resign({ ...env, body: { ...env.body, pitch: "zzzzzzzz" } }), // another pitch's body
    resign({ ...env, v: 2 }),
    resign({ ...env, topic: "lobby" }),
    resign({ ...env, made: 0 }, `${CODE}:0:start:1`),
    resign({
      ...env,
      body: { ...env.body, snap: "x".repeat(LIMITS.snapBytes + 1) },
    }),
    resign({
      ...env,
      body: { ...env.body, meta: { big: "x".repeat(LIMITS.metaBytes) } },
    }),
  ];
  for (const c of cases) {
    const res = await h.push(c);
    assert.equal(res.status, 400, c.raw.toString().slice(0, 80));
    assert.equal(res.json.error, "bad-message");
  }
  const noCode = resign(
    { ...env, pitch: "NOT-A-CODE" },
    `NOT-A-CODE:${MADE}:start:1`,
  );
  assert.equal((await h.push(noCode)).status, 400);
  assert.equal(h.records.kept.size, 0);
  // a kept replay over the limit is never keepable: taken (200), so it stops coming
  const long = await h.push(keep(1, Array(LIMITS.logMax).fill(REPLAY.log[0])));
  assert.equal(long.status, 200);
  assert.deepEqual(long.json, { ok: true, kept: false, why: "too-long" });
});

test("a recorded push lands on one key per (pitch, made, n, seq), gzipped as it came", async () => {
  const h = harness();
  const s = start();
  const a = act(1, 7);
  await h.push(s);
  await h.push(a);
  const key = `games/pitch/${CODE}/${String(MADE).padStart(13, "0")}/0001-000007.json.gz`;
  assert.deepEqual(
    [...h.records.kept.keys()],
    [
      `games/pitch/${CODE}/${String(MADE).padStart(13, "0")}/0001-000000.json.gz`,
      key,
    ],
  );
  assert.deepEqual(h.records.kept.get(key), a.raw);
  assert.equal(
    pushKey({ pitch: CODE, made: MADE, topic: "act", body: { n: 1, seq: 7 } }),
    key,
  );
  // on S3: a conditional put, a 412 is "had", and only under games/pitch/
  const sent = [];
  const record = s3Pushes({
    bucket: "games",
    client: {
      async send(cmd) {
        sent.push(cmd.input);
        if (sent.length > 1) {
          const e = new Error("PreconditionFailed");
          e.$metadata = { httpStatusCode: 412 };
          throw e;
        }
        return {};
      },
    },
  });
  assert.equal(await record({ key, raw: a.raw }), "kept");
  assert.equal(await record({ key, raw: a.raw }), "had");
  assert.equal(sent[0].IfNoneMatch, "*");
  assert.equal(sent[0].Bucket, "games");
  assert.deepEqual(gunzipSync(sent[0].Body), a.raw);
  await assert.rejects(record({ key: "reports/x", raw: a.raw }));
});

// ---------- duplicates ----------

for (const kind of STORES)
  test(`${kind}: a push sent again is answered 200 and kept once`, async () => {
    const h = harness(kind);
    const { start: s, acts, keep: k } = matchPushes();
    assert.deepEqual((await h.push(s)).json, { ok: true });
    assert.deepEqual((await h.push(s)).json, { ok: true, duplicate: true });
    await h.push(acts[0]);
    const before = await h.store.getState(CODE);
    const again = await h.push(acts[0]);
    assert.equal(again.status, 200);
    assert.equal(again.json.duplicate, true);
    assert.equal(h.records.kept.size, 2);
    assert.deepEqual(
      await h.store.getState(CODE),
      before,
      "the state is not written again",
    );
    for (const a of acts.slice(1)) await h.push(a);
    assert.deepEqual((await h.push(k)).json, { ok: true });
    const kept = await h.replay();
    assert.deepEqual((await h.push(k)).json, { ok: true, duplicate: true });
    assert.deepEqual((await h.push(acts.at(-1))).json, {
      ok: true,
      duplicate: true,
    });
    assert.deepEqual(await h.replay(), kept);
    assert.equal(h.records.kept.size, 1 + acts.length);
    if (kind === "memory") {
      assert.equal(h.store.writes.state, 1 + acts.length);
      assert.equal(h.store.writes.replay, 2);
    }
  });

// ---------- out of order ----------

for (const kind of STORES)
  test(`${kind}: a whole match pushed in order is served as the engine's replay, final snapshot and all`, async () => {
    const h = harness(kind);
    const { start: s, acts, keep: k } = matchPushes();
    await h.push(s);
    for (const a of acts) assert.equal((await h.push(a)).status, 200);
    // over, not yet kept: no replay to serve
    assert.deepEqual(await h.replay(), {
      pitch: CODE,
      v: 0,
      at: null,
      sealed: false,
      replay: null,
    });
    await h.push(k);
    const got = await h.replay();
    assert.equal(got.v, T0);
    assert.equal(got.at, T0);
    assert.equal(got.sealed, false);
    assert.deepEqual(served(got.replay), served(REPLAY));
    assert.equal(got.replay.hash, REPLAY.log.at(-1).h);
    const state = await h.store.getState(CODE);
    assert.equal(state.over, true);
    assert.equal(state.seq, acts.length);
    assert.equal(state.snap, REPLAY.snap);
    assert.equal(
      state.exp,
      Math.floor(T0 / 1000) + LIMITS.keepTtl,
      "a finished pitch lives a year",
    );
  });

for (const kind of STORES)
  test(`${kind}: pushes in any order: the start after the first actions, the keep before the end`, async () => {
    const h = harness(kind);
    const { start: s, acts, keep: k } = matchPushes();
    // the keep first, then the actions backwards, then the start
    await h.push(k);
    assert.equal((await h.replay()).replay, null, "half a replay is none");
    for (const a of [...acts].reverse())
      assert.equal((await h.push(a)).status, 200);
    let state = await h.store.getState(CODE);
    assert.equal(
      state.seq,
      acts.length,
      "an earlier action never moves the state back",
    );
    assert.equal(state.over, true);
    assert.equal(state.names, null);
    await h.push(s);
    state = await h.store.getState(CODE);
    assert.deepEqual(
      state.names,
      { A: "Mighty Maple", B: "Lucky Larch" },
      "the late start adds the names",
    );
    assert.equal(state.seq, acts.length);
    assert.equal(state.snap, REPLAY.snap, "and moves nothing back");
    assert.deepEqual(served((await h.replay()).replay), served(REPLAY));
  });

for (const kind of STORES)
  test(`${kind}: a rematch moves the state on and keeps the last replay until its own is in`, async () => {
    const h = harness(kind);
    const one = matchPushes({ n: 1 });
    for (const p of [one.start, ...one.acts, one.keep]) await h.push(p);
    const first = await h.replay();
    // match 2 starts and is played a little
    await h.push(start(2));
    await h.push(act(2, 1));
    const state = await h.store.getState(CODE);
    assert.equal(state.n, 2);
    assert.equal(state.over, false);
    assert.equal(
      state.exp,
      Math.floor(T0 / 1000) + LIMITS.pitchTtl,
      "48 hours while in play",
    );
    assert.deepEqual(await h.replay(), first);
    // a late action of match 1 changes nothing
    assert.deepEqual((await h.push(act(1, 999))).json, { ok: true });
    assert.equal((await h.store.getState(CODE)).n, 2);
    // match 2 ends: its keep, then its last action
    h.tick(60_000);
    await h.push(keep(2, REPLAY.log.slice(0, 2), { at: T0 + 60_000 }));
    assert.deepEqual(
      await h.replay(),
      first,
      "its own replay is not whole yet",
    );
    await h.push(act(2, 2, { over: true, snap: REPLAY.snap }));
    const second = await h.replay();
    assert.equal(second.v, T0 + 60_000);
    assert.equal(second.replay.n, 2);
    assert.equal(second.replay.log.length, 2);
    // match 1's keep again, late: never over a later match's
    assert.deepEqual((await h.push(one.keep)).json, {
      ok: true,
      duplicate: true,
    });
    assert.deepEqual(await h.replay(), second);
  });

// Codex on PR #97: pushes of matches in a row cross. Match 1's last action, then match
// 2's, then match 1's late keep: match 1's replay is whole, and stays when match 2's keep
// is too long to keep. Then match 2 is never whole, and nothing of match 1 is left over.
for (const kind of STORES)
  test(`${kind}: halves of matches in a row may cross; each match's replay is made whole`, async () => {
    const h = harness(kind);
    const one = matchPushes({ n: 1 });
    await h.push(one.start);
    for (const p of one.acts) await h.push(p);
    await h.push(start(2));
    await h.push(act(2, 1, { over: true, snap: REPLAY.snap }));
    assert.equal((await h.replay()).replay, null, "neither match whole yet");
    assert.deepEqual((await h.push(one.keep)).json, { ok: true });
    const first = await h.replay();
    assert.equal(first.replay.n, 1);
    assert.deepEqual(served(first.replay), served({ ...REPLAY, n: 1 }));
    // match 2's keep is over the limit: taken, not kept, and match 1's replay stays
    const big = REPLAY.log[0];
    const long = keep(2, Array(LIMITS.logMax).fill(big), { at: T0 + 60_000 });
    assert.equal((await h.push(long)).json.kept, false);
    assert.deepEqual(await h.replay(), first);
    // match 1's half is gone once its replay was made; its pushes again change nothing
    const halves = [...(h.fake ?? h.store).items.keys()].filter((k) =>
      k.includes("|half#"),
    );
    assert.deepEqual(halves, [
      `pitch#${CODE}|half#${String(MADE).padStart(13, "0")}#0002`,
    ]);
    assert.deepEqual((await h.push(one.keep)).json, {
      ok: true,
      duplicate: true,
    });
    assert.deepEqual(await h.replay(), first);
  });

for (const kind of STORES)
  test(`${kind}: the code wiped and used again starts over; the old pitch's late pushes are ignored`, async () => {
    const h = harness(kind);
    const one = matchPushes();
    for (const p of [one.start, ...one.acts, one.keep]) await h.push(p);
    const made = MADE + 3_600_000;
    await h.push(start(1, { made }));
    let state = await h.store.getState(CODE);
    assert.equal(state.made, made);
    assert.equal(state.seq, 0);
    assert.equal(state.over, false);
    // the old pitch's push, retried late
    await h.push(act(1, 5));
    state = await h.store.getState(CODE);
    assert.equal(state.made, made);
    assert.equal(state.seq, 0);
    // the new pitch's first match ends and replaces the old replay
    await h.push(act(1, 1, { made, over: true, snap: REPLAY.snap }));
    await h.push(keep(1, REPLAY.log.slice(0, 1), { made, at: T0 + 5 }));
    const got = await h.replay();
    assert.equal(got.v, T0 + 5);
    assert.equal(got.replay.log.length, 1);
  });

test("mergeState: ordered by (made, n, seq), the start being seq 0", () => {
  const p = (topic, made, n, seq, extra = {}) => ({
    topic,
    made,
    n,
    seq,
    snap: `s${made}-${n}-${seq}`,
    hash: `h${seq}`,
    ...extra,
  });
  const s1 = mergeState(null, p("act", 2, 1, 4));
  assert.equal(s1.seq, 4);
  assert.equal(mergeState({ ...s1, rev: 1 }, p("act", 2, 1, 3)), null);
  assert.equal(mergeState({ ...s1, rev: 1 }, p("act", 1, 9, 9)), null);
  assert.equal(mergeState({ ...s1, rev: 1 }, p("act", 2, 0, 9)), null);
  assert.equal(mergeState({ ...s1, rev: 1 }, p("act", 2, 2, 1)).n, 2);
  assert.equal(mergeState({ ...s1, rev: 1 }, p("act", 3, 1, 1)).made, 3);
  const named = mergeState(
    { ...s1, rev: 1, exp: 9 },
    p("start", 2, 1, 0, { meta: META }),
  );
  assert.deepEqual(named.names, { A: "Mighty Maple", B: "Lucky Larch" });
  assert.equal(named.seq, 4);
  assert.equal("rev" in named || "exp" in named, false);
  // nothing new from a start already known
  assert.equal(
    mergeState({ ...named, rev: 2 }, p("start", 2, 1, 0, { meta: META })),
    null,
  );
  // a shared (sealed) state is never replaced
  assert.equal(mergeState({ ...s1, sealed: true }, p("act", 9, 9, 9)), null);
  // the computer's side and level come from the start info
  assert.deepEqual(
    matchInfo({
      cpu: ["B"],
      setup: {
        teams: {
          A: { name: "Oak" },
          B: { name: "Elm", players: [{ level: "pro" }] },
        },
      },
    }),
    { names: { A: "Oak", B: "Elm" }, cpu: "B", level: "pro" },
  );
  assert.deepEqual(matchInfo({ cpu: "both" }), {
    names: null,
    cpu: null,
    level: null,
  });
  assert.equal(withSnap('{"a":1}', "x"), '{"a":1,"snap":"x"}');
  assert.equal(withSnap("{}", "x"), '{"snap":"x"}');
});

// ---------- the HTTPS calls: routes, CORS, limits ----------

test("routes: the /api prefix, 404, 405, and JSON with no-store", async () => {
  const h = harness();
  assert.equal((await h.call("GET", "/elsewhere")).status, 404);
  assert.equal((await h.call("GET", "/report")).status, 405);
  assert.equal((await h.call("POST", "/replay")).status, 405);
  assert.equal((await h.call("GET", "/push")).status, 405);
  const res = await h.call("GET", "/api/replay", { query: `pitch=${CODE}` });
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(res.json, {
    pitch: CODE,
    v: 0,
    at: null,
    sealed: false,
    replay: null,
  });
  assert.equal(
    (await h.call("GET", "/replay", { query: "pitch=NOT-A-CODE" })).status,
    400,
  );
  assert.equal(
    (await h.call("POST", "/report", { body: "{not json" })).status,
    400,
  );
  assert.equal((await h.call("POST", "/report", { body: "[1]" })).status, 400);
});

test("CORS: the site's origins, any port for an origin listed without one, none for the iPhone", async () => {
  const h = harness();
  const ask = (origin, method = "GET") =>
    h.call(method, "/replay", {
      query: `pitch=${CODE}`,
      headers: origin ? { origin } : {},
    });
  const site = await ask(ORIGIN);
  assert.equal(site.status, 200);
  assert.equal(site.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(site.headers.vary, "origin");
  const dev = await ask("http://localhost:4322");
  assert.equal(
    dev.headers["access-control-allow-origin"],
    "http://localhost:4322",
  );
  const app = await ask(null);
  assert.equal(app.status, 200);
  assert.equal(app.headers["access-control-allow-origin"], undefined);
  for (const origin of [
    "https://evil.example",
    "http://throwingwood.com",
    "null",
  ]) {
    const res = await ask(origin);
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  }
  const pre = await h.call("OPTIONS", "/report", {
    headers: { origin: ORIGIN },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(pre.headers["access-control-allow-methods"], "POST, OPTIONS");
  assert.equal(pre.headers["access-control-allow-headers"], "content-type");
  assert.equal(
    (
      await h.call("OPTIONS", "/report", {
        headers: { origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  // a refusal still carries the header, so the page can read why
  const refused = await h.post(
    "/report",
    { r: { mode: "nope" } },
    { origin: ORIGIN },
  );
  assert.equal(refused.status, 400);
  assert.equal(refused.headers["access-control-allow-origin"], ORIGIN);
  // the push is no browser's: an Origin header is not looked at
  assert.equal(
    (
      await h.push(start(), {
        ...start().headers,
        origin: "https://evil.example",
      })
    ).status,
    200,
  );
  assert.equal(originAllowed("not a url", [ORIGIN]), false);
});

test("report: kept under reports/<day>/, with the old limits", async () => {
  const h = harness();
  const throwReport = {
    mode: "solo",
    happened: "It flew.",
    should: "It should not.",
    pitch: CODE,
  };
  const ok = await h.post("/report", { r: throwReport });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { ok: true });
  const [key] = [...h.records.kept.keys()];
  assert.match(key, /^reports\/2026-11-21\/\d{13}-[a-z0-9]+\.json\.gz$/);
  assert.equal(JSON.parse(h.records.kept.get(key)).report.kind, "throw");
  assert.equal(
    (
      await h.post("/report", {
        r: { mode: "pitch", kind: "feedback", text: "Fun!" },
      })
    ).status,
    200,
  );
  const refuse = async (r, status, body) => {
    const res = await h.post("/report", body ?? { r });
    assert.equal(res.status, status, JSON.stringify(r)?.slice(0, 80));
  };
  await refuse(
    { ...throwReport, happened: "x".repeat(LIMITS.reportChars + 1) },
    413,
  );
  await refuse(
    {
      mode: "solo",
      kind: "feedback",
      text: "x".repeat(LIMITS.feedbackChars + 1),
    },
    413,
  );
  await refuse({ ...throwReport, mode: "online" }, 400);
  await refuse({ ...throwReport, kind: "rant" }, 400);
  await refuse({ ...throwReport, happened: " ", should: "" }, 400);
  await refuse({ ...throwReport, pitch: "NOT-A-CODE" }, 400);
  await refuse(null, 413, {
    r: { ...throwReport, history: "x".repeat(LIMITS.reportBytes) },
  });
  assert.equal(h.records.kept.size, 2);
});

test("game: a one-device match kept under games/browser/<day>/, with the old limits", async () => {
  const h = harness();
  const g = {
    mode: "solo",
    start: IN_PLAY,
    actions: [{ type: "throw" }],
    hashes: [1],
    client: "web",
  };
  assert.equal((await h.post("/game", { g })).status, 200);
  const [key] = [...h.records.kept.keys()];
  assert.match(key, /^games\/browser\/2026-11-21\/\d{13}-[a-z0-9]+\.json\.gz$/);
  const refuse = async (g, status) =>
    assert.equal((await h.post("/game", { g })).status, status);
  await refuse({ ...g, mode: "pitch" }, 400);
  await refuse(
    {
      ...g,
      actions: Array(LIMITS.gameActions + 1).fill({}),
      hashes: undefined,
    },
    413,
  );
  await refuse({ ...g, hashes: [1, 2] }, 400);
  await refuse({ ...g, client: "Not A Tag" }, 400);
  await refuse({ ...g, start: "x".repeat(LIMITS.gameBytes) }, 413);
  assert.equal(h.records.kept.size, 1);
  // any player request over the body limit is refused before it is read
  const big = await h.call("POST", "/share", {
    body: Buffer.alloc(LIMITS.bodyBytes + 1, 32),
  });
  assert.equal(big.status, 413);
});

for (const kind of STORES)
  test(`${kind}: reel: one render a kept replay, the day's cap, and its answers`, async () => {
    const h = harness(kind, { limits: { ...LIMITS, reelsPerDay: 1 } });
    assert.equal((await h.post("/reel", { pitch: "NOT-A-CODE" })).status, 400);
    assert.equal((await h.post("/reel", { pitch: CODE, v: 0 })).status, 400);
    assert.deepEqual((await h.post("/reel", { pitch: CODE })).json, {
      pitch: CODE,
      v: 0,
      reel: null,
      why: "replay",
    });
    const m = matchPushes();
    for (const p of [m.start, ...m.acts, m.keep]) await h.push(p);
    const asked = await h.post("/reel", { pitch: CODE });
    assert.equal(asked.json.v, T0);
    assert.equal(asked.json.reel.state, "rendering");
    assert.deepEqual(h.started, [
      { room: CODE, v: T0, tag: asked.json.reel.tag },
    ]);
    // asked again: the same render, none more
    assert.equal(
      (await h.post("/reel", { pitch: CODE })).json.reel.state,
      "rendering",
    );
    assert.equal(h.started.length, 1);
    assert.equal(
      (await h.post("/reel", { pitch: CODE, v: T0 - 1 })).json.why,
      "moved",
    );
    // another pitch the same day: over the cap
    const other = "bcdefgh234";
    const o = matchPushes({ pitch: other });
    for (const p of [o.start, ...o.acts, o.keep]) await h.push(p);
    assert.deepEqual((await h.post("/reel", { pitch: other })).json, {
      pitch: other,
      v: T0,
      reel: null,
      why: "busy",
    });
    assert.equal(h.started.length, 1);
    // no renderer: unavailable
    const none = harness(kind, { startReel: null });
    assert.equal(
      (await none.post("/reel", { pitch: CODE })).json.why,
      "unavailable",
    );
  });

// A checked share as the renderer answers it: the fixture played against the computer.
function checkedShare() {
  const r = structuredClone(REPLAY);
  r.cpu = "B";
  r.setup.cpu = "B";
  r.setup.teams.B.players[0].level = "club";
  return { ok: true, engine: r.engine, document: "{}", replay: asciiJson(r) };
}
const SHARE = {
  client: "ios-1.0.90",
  engine: "0.9.0",
  start: IN_PLAY,
  log: REPLAY.log.slice(0, 3).map(({ a }) => ({ a })),
  end: { winner: "A", throws: 3 },
};

for (const kind of STORES)
  test(`${kind}: share: kept once under a fresh code, sealed, the day's cap and the old refusals`, async () => {
    const checked = [];
    const h = harness(kind, {
      limits: { ...LIMITS, sharesPerDay: 2 },
      checkShare: async (g) => {
        checked.push(g);
        return checkedShare();
      },
      random: (() => {
        let i = 0;
        return () => (i++ % 31) / 31;
      })(),
    });
    const first = await h.post("/share", { g: SHARE });
    assert.equal(first.status, 200);
    assert.match(first.json.code, /^[2-9a-hjkmnp-z]{10}$/);
    assert.equal(first.json.v, 1);
    assert.equal(checked[0].client, undefined, "the client tag is not sent on");
    // the same match again: the same code, not checked or counted again
    assert.deepEqual((await h.post("/share", { g: SHARE })).json, first.json);
    assert.equal(checked.length, 1);
    const kept = await h.replay(first.json.code);
    assert.equal(kept.sealed, true);
    assert.equal(kept.replay.cpu, "B");
    // a push to a shared pitch's code changes nothing
    await h.push(start(1, { pitch: first.json.code }));
    assert.equal((await h.store.getState(first.json.code)).sealed, true);
    assert.deepEqual(await h.replay(first.json.code), kept);
    // the refusals
    const why = async (g) => (await h.post("/share", { g })).json;
    assert.deepEqual(
      await why({
        ...SHARE,
        log: Array(LIMITS.shareActions + 1).fill({ a: {} }),
      }),
      {
        code: null,
        v: 0,
        why: "too-long",
      },
    );
    assert.equal((await why({ ...SHARE, engine: "0.5.0" })).why, "engine");
    assert.equal(
      (await h.post("/share", { g: { ...SHARE, end: { winner: "C" } } }))
        .status,
      400,
    );
    // a second match is counted; a third is over the day's cap
    assert.ok(
      (
        await why({
          ...SHARE,
          end: { winner: "B", throws: 3 },
          log: SHARE.log.slice(1),
        })
      ).code,
    );
    assert.equal(
      (await why({ ...SHARE, log: SHARE.log.slice(2) })).why,
      "busy",
    );
    // the renderer could not take it in time, or said no
    const busy = harness(kind, {
      checkShare: async () => {
        throw new ShareBusy("slow");
      },
    });
    assert.equal((await busy.post("/share", { g: SHARE })).json.why, "busy");
    const no = harness(kind, {
      checkShare: async () => ({ ok: false, why: "weird" }),
    });
    assert.equal(
      (await no.post("/share", { g: SHARE })).json.why,
      "does-not-replay",
    );
    const off = harness(kind, { checkShare: null });
    assert.equal(
      (await off.post("/share", { g: SHARE })).json.why,
      "unavailable",
    );
  });

// ---------- what the pitch pages and the reel function read ----------

test("the pitch pages read the api's records: in play, over with its replay and reel, a share against the computer", async () => {
  const h = harness("dynamo", {
    checkShare: async () => checkedShare(),
  });
  const page = async (code = CODE) => pitchState(await readPitch(h.item, code));
  assert.equal((await page()).state, "none");
  const m = matchPushes();
  await h.push(m.acts[0]); // before its start
  let s = await page();
  assert.equal(s.state, "playing");
  assert.deepEqual(s.teams, { A: "Mighty Maple", B: "Lucky Larch" });
  await h.push(m.start);
  for (const a of m.acts.slice(1, 5)) await h.push(a);
  s = await page();
  assert.equal(s.state, "playing");
  const rev = s.v;
  await h.push(m.acts[5]);
  assert.ok((await page()).v > rev, "every push is a new image version");
  for (const a of m.acts.slice(6)) await h.push(a);
  s = await page();
  assert.equal(s.state, "over");
  assert.equal(s.replay, false, "over, not yet kept");
  await h.push(m.keep);
  s = await page();
  assert.equal(s.replay, true);
  assert.deepEqual(s.match, { n: 1, hash: REPLAY.hash });
  assert.match(previewOf(s).description, /Watch the replay\.$/);

  // the reel: asked through the api, rendered by the reel function's adapters
  const reels = reelStore({ client: h.fake, table: "rooms", now: h.now });
  const kept = await reels.getReplay(CODE);
  assert.equal(kept.v, T0);
  assert.equal(kept.data, JSON.stringify((await h.replay()).replay));
  const { reel } = (await h.post("/reel", { pitch: CODE })).json;
  const job = `${T0}-${reel.tag}`;
  assert.deepEqual(await reels.attemptReel(CODE, job), { tries: 1 });
  const wide = `/reels/${CODE}/${job}/wide.mp4`;
  assert.equal(
    await reels.finishReel(CODE, job, {
      state: "done",
      wide,
      tall: "/t",
      edit: "/e",
    }),
    true,
  );
  s = await page();
  assert.deepEqual(s.reel, { wide });
  assert.match(previewOf(s).description, /Watch the highlights\.$/);
  // the api says so too
  assert.equal(
    (await h.post("/reel", { pitch: CODE })).json.reel.state,
    "done",
  );

  // a rematch in play shows the rematch
  await h.push(start(2));
  await h.push(act(2, 1));
  assert.equal((await page()).state, "playing");

  // a shared match against the computer: its own title form
  const { code } = (await h.post("/share", { g: SHARE })).json;
  s = await page(code);
  assert.equal(s.state, "over");
  assert.equal(s.replay, true);
  assert.deepEqual(s.computer, { side: "B", level: "club" });
  // the fixture's Lucky Larch won: the computer
  assert.match(
    previewOf(s).description,
    /^Final: Lucky Larch \(club\) won, against Mighty Maple,/,
  );
});

// The renderer's side over the api's records (backend/reels/aws.mjs on pitch# keys): a
// render that dies is taken over once stale, keeping its tries, and is failed after two;
// a takeover the day's cap refuses gives the item back as it was.
test("reels on the api's records: stale takeovers keep the tries, two at most, then failed", async () => {
  const h = harness("dynamo");
  const m = matchPushes();
  for (const p of [m.start, ...m.acts, m.keep]) await h.push(p);
  const reels = reelStore({ client: h.fake, table: "rooms", now: h.now });
  const first = (await h.post("/reel", { pitch: CODE })).json.reel;
  const job = `${T0}-${first.tag}`;
  assert.deepEqual(await reels.attemptReel(CODE, job), { tries: 1 });
  h.tick(LIMITS.reelStaleMs + 1000);
  assert.equal(
    (await h.post("/reel", { pitch: CODE })).json.reel.state,
    "rendering",
  );
  assert.equal(h.started.length, 2);
  assert.deepEqual(await reels.attemptReel(CODE, job), { tries: 2 });
  h.tick(LIMITS.reelStaleMs + 1000);
  assert.equal(
    (await h.post("/reel", { pitch: CODE })).json.reel.state,
    "failed",
  );
  assert.equal(h.started.length, 2);
  assert.equal(h.fake.items.get(`pitch#${CODE}|reel`).tries, 2);
});

test("reels on the api's records: a takeover the day's cap refuses keeps the item and its tries", async () => {
  const h = harness("dynamo", { limits: { ...LIMITS, reelsPerDay: 1 } });
  const m = matchPushes();
  for (const p of [m.start, ...m.acts, m.keep]) await h.push(p);
  const reels = reelStore({ client: h.fake, table: "rooms", now: h.now });
  const first = (await h.post("/reel", { pitch: CODE })).json.reel;
  await reels.attemptReel(CODE, `${T0}-${first.tag}`);
  const before = h.fake.items.get(`pitch#${CODE}|reel`);
  h.tick(LIMITS.reelStaleMs + 1000);
  assert.equal((await h.post("/reel", { pitch: CODE })).json.why, "busy");
  const after = h.fake.items.get(`pitch#${CODE}|reel`);
  assert.equal(after.tries, 1);
  assert.equal(after.at, before.at);
  assert.equal(h.started.length, 1);
});

test("the pages and reels are refused nothing the roles do not allow: they read only the fields they name", async () => {
  const h = harness("dynamo");
  const m = matchPushes();
  for (const p of [m.start, ...m.acts, m.keep]) await h.push(p);
  h.fake.calls.length = 0;
  await readPitch(h.item, CODE);
  const reels = reelStore({ client: h.fake, table: "rooms", now: h.now });
  await reels.getReplay(CODE);
  for (const { op, input } of h.fake.calls) {
    assert.equal(op, "GetCommand");
    assert.match(input.Key.pk, /^pitch#/);
    assert.ok(input.ProjectionExpression, "every read names its fields");
  }
  // what the reel function may read of the replay item (infra/site.json ReelsRole)
  const reelRead = h.fake.calls.at(-1).input;
  assert.deepEqual(Object.values(reelRead.ExpressionAttributeNames).sort(), [
    "exp",
    "s",
    "v",
    "z",
  ]);
});

test("share end to end: a real match through the real check, kept by the api, read by the pages", async () => {
  const sources = bundleLua();
  // seed 3: Mighty Maple (the person) wins on engine 0.13 (seed 2 did on 0.9)
  const played = await playSolo(soloSetup(3), sources);
  const h = harness("dynamo", {
    reelEngines: [MINOR],
    checkShare: (g) =>
      realCheck({ g, sources, engine: ENGINE, engines: [MINOR] }),
  });
  const g = {
    client: "ios-1.0.90",
    engine: ENGINE,
    start: played.start,
    log: played.log,
    end: { winner: played.end.winner, throws: played.end.throws },
  };
  const got = await h.post("/share", { g });
  assert.equal(got.status, 200);
  assert.ok(got.json.code, JSON.stringify(got.json));
  const s = pitchState(await readPitch(h.item, got.json.code));
  assert.equal(s.state, "over");
  assert.equal(s.replay, true);
  assert.deepEqual(s.computer, { side: "B", level: "club" });
  const p = previewOf(s);
  assert.equal(p.title, "Mighty Maple vs Computer · Kubb: Throwing Wood");
  assert.equal(
    p.description,
    `Final: Mighty Maple won, against the computer (club), in ${s.turn} turns. Watch the replay.`,
  );
  // the replay served is the checked one
  const kept = await h.replay(got.json.code);
  assert.equal(kept.sealed, true);
  assert.equal(kept.replay.log.length, played.log.length);
  // and the shared code asks for a reel
  const reel = (await h.post("/reel", { pitch: got.json.code })).json;
  assert.equal(reel.reel?.state, "rendering", JSON.stringify(reel));
  assert.equal(h.started[0].room, got.json.code);
});

// ---------- the Lambda entry ----------

test("the function URL's event: a base64 body, lower-case headers, the answer as the URL wants it", async () => {
  const h = harness();
  const handler = makeHandler(h.api);
  const env = start();
  const event = (body, isBase64Encoded, headers) => ({
    rawPath: "/push",
    rawQueryString: "",
    headers,
    isBase64Encoded,
    body,
    requestContext: { http: { method: "POST" } },
  });
  const upper = Object.fromEntries(
    Object.entries(env.headers).map(([k, v]) => [k.toUpperCase(), v]),
  );
  const res = await handler(event(env.raw.toString("base64"), true, upper));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(res.headers["content-type"], "application/json");
  const req = fromEvent({
    ...event("x", false, {}),
    rawQueryString: "pitch=abc",
  });
  assert.equal(req.query.get("pitch"), "abc");
  assert.deepEqual(req.body, Buffer.from("x"));
  assert.equal(fromEvent({}).body.length, 0);
});

test("readPush: the envelope against its own key and the header", () => {
  const env = act(1, 3);
  const p = readPush(env.raw.toString(), env.headers["idempotency-key"]);
  assert.equal(p.topic, "act");
  assert.equal(p.body.seq, 3);
  assert.throws(() => readPush(env.raw.toString(), "x"), /idempotency-key/);
});
