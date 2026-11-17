// End to end: tools/rooms-dev.mjs on a free port, src/net/room.js clients over Node's own
// WebSocket. The dev server enforces API Gateway's 32 KB frame rule, so the 100 KB
// document round trip only works because the client and server chunk.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  connect,
  makeRoomCode,
  memberId,
  throttle,
} from "../../src/net/room.js";
import { FRAME_MAX, startRoomsServer } from "../../tools/rooms-dev.mjs";

let server;
const open = [];

before(async () => {
  server = await startRoomsServer({ port: 0 });
});

after(async () => {
  for (const r of open) r.close();
  await server.close();
});

function join(room, member, name, extra = {}) {
  const r = connect({
    url: server.url,
    room,
    member,
    name,
    backoff: [50, 200],
    ...extra,
  });
  open.push(r);
  return r;
}

function next(room, type, predicate = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, ms);
    const off = room.on(type, (detail) => {
      if (!predicate(detail)) return;
      clearTimeout(timer);
      off();
      resolve(detail);
    });
  });
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("condition not met");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("helpers: room codes and member ids", () => {
  const code = makeRoomCode();
  assert.match(code, /^[2-9a-hjkmnp-z]{10}$/);
  const kept = new Map();
  const storage = {
    getItem: (k) => kept.get(k) ?? null,
    setItem: (k, v) => kept.set(k, v),
  };
  const id = memberId(storage);
  assert.match(id, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(memberId(storage), id);
  assert.match(memberId(null), /^[A-Za-z0-9_-]{16}$/);
});

test("three clients: presence, me, update races, 100 KB documents, casts, reconnect", async () => {
  const code = makeRoomCode();
  const a = join(code, "member-aaaa", "Ann");
  const sa = await a.ready;
  assert.equal(sa.host, "member-aaaa");
  assert.equal(a.isHost(), true);

  // Presence: A sees B and C arrive.
  const seenB = next(a, "member", (d) => d.member.id === "member-bbbb");
  const b = join(code, "member-bbbb", "Bo");
  await b.ready;
  assert.equal((await seenB).member.me.name, "Bo");
  const c = join(code, "member-cccc", "Cy");
  await c.ready;
  await until(() => a.members.length === 3 && b.members.length === 3);
  assert.deepEqual(
    c.members.map((m) => m.id),
    ["member-aaaa", "member-bbbb", "member-cccc"],
  );

  // me: fields broadcast to all.
  const teamSeen = next(
    a,
    "member",
    (d) => d.member.id === "member-cccc" && d.member.me.team === "B",
  );
  c.setMe({ team: "B" });
  await teamSeen;

  // Two clients update at once: both land, in order, and everyone ends on the same doc.
  await a.update(() => ({ log: [] }));
  await until(() => b.v === 1 && c.v === 1);
  const seen = [];
  c.on("doc", ({ v }) => seen.push(v));
  const [ra, rb] = await Promise.all([
    a.update((doc) => ({ log: [...doc.log, "a"] }), { with: { action: "a" } }),
    b.update((doc) => ({ log: [...doc.log, "b"] }), { with: { action: "b" } }),
  ]);
  assert.deepEqual([ra.v, rb.v].sort(), [2, 3]);
  await until(() => a.v === 3 && b.v === 3 && c.v === 3);
  for (const r of [a, b, c])
    assert.deepEqual([...r.doc.log].sort(), ["a", "b"]);
  assert.deepEqual(a.doc, c.doc);
  assert.deepEqual(
    seen,
    [...seen].sort((x, y) => x - y),
  ); // never goes back

  // The rider arrives with the document it produced.
  const withSeen = next(c, "doc", (d) => d.with?.action === "start");
  await a.update((doc) => ({ ...doc, started: true }), {
    with: { action: "start" },
  });
  const got = await withSeen;
  assert.equal(got.by, "member-aaaa");
  assert.equal(got.doc.started, true);

  // 100 KB document both ways (with non-ASCII text, which is escaped on the wire).
  const big = { started: true, pad: "é".repeat(30_000) + "x".repeat(70_000) };
  const bigSeen = next(c, "doc", (d) => d.doc?.pad?.length === 100_000);
  await b.update(() => big);
  assert.deepEqual((await bigSeen).doc, big);
  await c.update((doc) => ({ ...doc, back: true }));
  await until(() => a.doc?.back === true);
  assert.equal(a.doc.pad, big.pad);

  // A frame over 32 KB is refused the way API Gateway refuses it (the socket closes).
  const raw = new WebSocket(server.url);
  await new Promise((r) => (raw.onopen = r));
  const closed = new Promise((r) => (raw.onclose = (e) => r(e.code)));
  raw.send("x".repeat(FRAME_MAX + 1));
  assert.equal(await closed, 1009);

  // Casts reach everyone else, not the sender.
  const castB = next(b, "cast", (d) => d.d.aim === 1);
  const castC = next(c, "cast", (d) => d.d.aim === 1);
  let selfCast = false;
  const offSelf = a.on("cast", () => (selfCast = true));
  a.cast({ aim: 1 });
  assert.equal((await castB).from, "member-aaaa");
  await castC;
  offSelf();
  assert.equal(selfCast, false);

  // Rate cap: a burst far over the cap is cut, and the sender is told once.
  await new Promise((r) => setTimeout(r, 2100)); // refill the bucket
  let relayed = 0;
  const offCount = b.on("cast", (d) => d.d.burst && relayed++);
  const rate = next(a, "error", (e) => e.code === "rate");
  for (let i = 0; i < 60; i++) a.cast({ burst: i + 1 });
  await rate;
  await new Promise((r) => setTimeout(r, 200));
  offCount();
  assert.ok(relayed >= 20 && relayed < 30, `relayed ${relayed}`);

  // A throttled caster sends at most a few.
  let throttled = 0;
  const offT = b.on("cast", (d) => d.d.t && throttled++);
  const aim = a.caster(100);
  for (let i = 0; i < 50; i++) {
    aim({ t: i });
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 300));
  offT();
  assert.ok(throttled >= 2 && throttled <= 6, `throttled ${throttled}`);

  // Reconnect after a dropped socket: C shows away, then back, and catches up on a change it missed.
  const cConn = [...server.store.conns.entries()].find(
    ([, w]) => w.member === "member-cccc",
  )[0];
  const away = next(
    a,
    "member",
    (d) => d.member.id === "member-cccc" && !d.member.connected,
  );
  const statuses = [];
  c.on("status", ({ status }) => statuses.push(status));
  server.drop(cConn);
  await away;
  await a.update((doc) => ({ ...doc, missed: "yes" }));
  const back = next(
    a,
    "member",
    (d) => d.member.id === "member-cccc" && d.member.connected,
  );
  await next(c, "state", () => true, 5000);
  await back;
  assert.equal(c.doc.missed, "yes");
  assert.equal(c.v, a.v);
  assert.deepEqual(statuses, ["reconnecting", "open"]);
  // And it still works after.
  await c.update((doc) => ({ ...doc, after: true }));
  await until(() => a.doc.after === true);

  // Same member in a second tab: the newer connection wins, the older one stops.
  const c2 = join(code, "member-cccc", "Cy");
  const replaced = next(c, "status", (s) => s.status === "replaced");
  await c2.ready;
  await replaced;
  assert.equal(c2.members.length, 3);
  assert.equal(c2.doc.after, true);

  // Host: A leaves for good; B is first in line and takes it.
  const hostSeen = next(c2, "host", (h) => h.host === "member-bbbb");
  const left = next(b, "left", (d) => d.id === "member-aaaa");
  a.leave();
  await left;
  b.claimHost();
  await hostSeen;
  assert.equal(b.isHost(), true);
});

test("throttle sends the latest value at the end of the wait", async () => {
  const sent = [];
  const t = throttle((v) => sent.push(v), 50);
  t(1);
  t(2);
  t(3);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(sent, [1, 3]);
});

test("a join that cannot succeed rejects ready and closes", async () => {
  const code = makeRoomCode();
  const r = join(code, "bad", "X");
  await assert.rejects(r.ready, (e) => e.code === "bad-member");
  assert.equal(r.status, "closed");
});

test("a kept replay comes back by its code on a socket of its own, in frames", async () => {
  const { fetchReplay } = await import("../../src/replay/fetch.js");
  const code = makeRoomCode();
  const a = join(code, memberId(), "Ann");
  await a.ready;
  assert.equal(
    await fetchReplay({ url: server.url, code }),
    null,
    "nothing kept",
  );
  const ended = await a.update(() => ({
    started: true,
    match: { over: true },
  }));
  const replay = {
    v: 1,
    n: 1,
    setup: { seed: 3 },
    h0: "00c0ffee",
    log: Array.from({ length: 300 }, (_, i) => ({
      a: { type: "throw", i, pad: "z".repeat(300) },
      h: "abcdef01",
    })),
    snap: '{"x":3.0}',
    hash: "abcdef01",
    players: { A: [{ id: "m", name: "Ann" }], B: [] },
    cpu: "B",
  };
  assert.ok(JSON.stringify(replay).length > FRAME_MAX * 2);
  assert.ok(a.keep(replay, ended.v));
  // keep has no answer: ask until the room has it
  let got = null;
  for (let i = 0; i < 50 && !got; i++) {
    got = await fetchReplay({ url: server.url, code });
    if (!got) await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(got, "kept and fetched");
  assert.equal(got.log.length, 300);
  assert.equal(got.snap, '{"x":3.0}', "the snapshot text untouched");
  assert.deepEqual(
    { ...got, at: undefined, kept: undefined },
    {
      ...replay,
      at: undefined,
      kept: undefined,
    },
  );
  assert.equal(got.kept, 1);
  assert.equal(
    await fetchReplay({ url: server.url, code: makeRoomCode() }),
    null,
    "another pitch keeps none",
  );
});
