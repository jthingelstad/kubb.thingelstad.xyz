// The browser's pitch client (src/net/pitch-client.js) against the pitch core
// (backend/pitch-server/core.mjs), served in this process by tools/pitch-dev.mjs over
// real sockets (Node's own WebSocket): two players, an observer, lobby writes that
// cross, actions committed while others are away, a retried action, every socket
// dropping at once, a refusal and a resync. PROTOCOL.md is the contract.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import {
  connect,
  makePitchCode,
  PITCH_CODE,
  PitchError,
  socketUrl,
} from "../../src/net/pitch-client.js";

let server;
before(async () => {
  server = await startPitchServer();
});
after(async () => {
  await server?.close();
});

const fast = { firstRetryMs: 20, retryMs: 40, retryMaxMs: 120 };
const clients = [];
const join = (code, name, opts = {}) => {
  const c = connect({
    url: server.url,
    pitch: code,
    member: `${name}-member-id`,
    me: { name },
    tune: fast,
    ...opts,
  });
  clients.push(c);
  return c;
};
const closeAll = () => {
  while (clients.length) clients.pop().close();
};

async function until(fn, ms = 3000, what = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Every action a client hears from others, in order.
function hear(c) {
  const got = [];
  c.on("acts", (acts) => got.push(...acts));
  return got;
}

const act = (seq, extra = {}) => ({
  n: 1,
  seq,
  a: { type: "throw", seq },
  h: `h${seq}`,
  snap: `snap-${seq}`,
  ...extra,
});

// A WebSocket that can be told to refuse to connect (the network gone) and to lose
// the next frame of one type on its way in.
function flakyWs() {
  const ctl = { down: false, lose: new Set(), made: 0 };
  class Flaky {
    constructor(url) {
      ctl.made++;
      if (ctl.down) throw new Error("network down");
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = (e) => this.onopen?.(e);
      ws.onclose = (e) => this.onclose?.(e);
      ws.onerror = (e) => this.onerror?.(e);
      ws.onmessage = (e) => {
        if (typeof e.data === "string" && e.data.startsWith("{")) {
          const t = JSON.parse(e.data).t;
          if (ctl.lose.has(t)) {
            ctl.lose.delete(t);
            return;
          }
        }
        this.onmessage?.(e);
      };
    }
    get readyState() {
      return this.ws.readyState;
    }
    send(x) {
      this.ws.send(x);
    }
    close() {
      this.ws.close();
    }
  }
  return { WebSocket: Flaky, ctl };
}

test("pitch client: codes and the socket's address", () => {
  for (let i = 0; i < 50; i++) assert.match(makePitchCode(), PITCH_CODE);
  assert.equal(
    socketUrl("wss://pitches.example/", "abcdefgh23"),
    "wss://pitches.example/ws?pitch=abcdefgh23",
  );
  assert.throws(
    () => connect({ url: server.url, pitch: "NOPE", member: "m-12345678" }),
    PitchError,
  );
});

test("pitch client: two players share the lobby, compare-and-set writes that cross both land", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const b = join(code, "gus");
  await b.ready;
  assert.equal(a.host, "hanna-member-id");
  assert.ok(a.isHost() && !b.isHost());
  await until(() => a.members.length === 2, 2000, "a sees gus");
  // both write at once: one is answered `no`, takes the newer document and writes again
  const add = (k) => (doc) => ({ ...(doc ?? {}), [k]: true });
  const [ra, rb] = await Promise.all([a.update(add("a")), b.update(add("b"))]);
  assert.ok(ra && rb);
  await until(() => a.doc?.a && a.doc?.b && b.doc?.a && b.doc?.b, 2000, "both");
  assert.equal(a.v, b.v);
  assert.equal(a.v, 2);
  closeAll();
});

test("pitch client: a match, actions both ways, never waiting for ok", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const b = join(code, "gus");
  await b.ready;
  const heardB = hear(b);
  const heardA = hear(a);
  let started = null;
  b.on("start", (e) => (started = e));
  const r = await a.start({
    doc: { started: true, match: { n: 1 } },
    n: 1,
    h: "h0",
    snap: "snap-0",
    meta: { v: 1, setup: { seed: 1 } },
  });
  assert.equal(r.v, 1);
  await until(() => started, 2000, "start");
  assert.equal(started.snap, "snap-0");
  assert.deepEqual(started.meta, { v: 1, setup: { seed: 1 } });
  // three actions sent back to back, before any answer
  a.act(act(1));
  a.act(act(2));
  a.act(act(3));
  assert.equal(a.pending.length, 3);
  await until(() => heardB.length === 3 && a.pending.length === 0);
  assert.deepEqual(
    heardB.map((x) => x.seq),
    [1, 2, 3],
  );
  assert.equal(heardB[0].from, "hanna-member-id");
  b.act(act(4));
  await until(() => heardA.length === 1 && b.pending.length === 0);
  assert.equal(a.match.seq, 4);
  assert.equal(b.match.h, "h4");
  closeAll();
});

test("pitch client: a player away while others act resumes with exactly the missed actions", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const f = flakyWs();
  const b = join(code, "gus", { WebSocket: f.WebSocket });
  await b.ready;
  const heardB = hear(b);
  const states = [];
  b.on("state", (e) => states.push(e));
  await a.start({
    doc: { started: true },
    n: 1,
    h: "h0",
    snap: "s0",
    meta: {},
  });
  a.act(act(1));
  await until(() => heardB.length === 1);
  // gus's network goes; hanna plays on
  f.ctl.down = true;
  b.ws.close();
  await until(() => b.status === "reconnecting", 2000, "reconnecting");
  for (let s = 2; s <= 6; s++) a.act(act(s));
  await until(() => a.pending.length === 0);
  f.ctl.down = false;
  await until(() => b.status === "open", 3000, "back");
  await until(() => heardB.length === 6, 2000, "the missed actions");
  assert.deepEqual(
    heardB.map((x) => x.seq),
    [1, 2, 3, 4, 5, 6],
  );
  // a resume, not the whole match
  assert.equal(states.at(-1).match.full, false);
  closeAll();
});

test("pitch client: an action whose ok was lost is sent again and answered dup, logged once", async () => {
  const code = makePitchCode();
  const f = flakyWs();
  const a = join(code, "hanna", { WebSocket: f.WebSocket });
  await a.ready;
  const b = join(code, "gus");
  await b.ready;
  const heardB = hear(b);
  const oks = [];
  a.on("ok", (e) => oks.push(e));
  await a.start({
    doc: { started: true },
    n: 1,
    h: "h0",
    snap: "s0",
    meta: {},
  });
  f.ctl.lose.add("ok");
  a.act(act(1));
  await until(() => heardB.length === 1, 2000, "relayed");
  assert.equal(a.pending.length, 1, "no ok heard");
  // the connection drops: on the way back the resume shows the action as ours (or it is
  // sent again and answered dup); either way it is answered once and logged once
  a.ws.close();
  await until(() => a.pending.length === 0, 3000, "answered");
  assert.equal(
    server.pitch(code).head?.seq ?? server.pitch(code).match?.seq,
    1,
  );
  assert.equal(heardB.length, 1, "the others heard it once");
  a.act(act(2));
  await until(() => heardB.length === 2);
  closeAll();
});

test("pitch client: a long backlog after a drop goes a window at a time, all of it", async () => {
  const code = makePitchCode();
  const f = flakyWs();
  const a = join(code, "hanna", { WebSocket: f.WebSocket });
  await a.ready;
  await a.start({
    doc: { started: true },
    n: 1,
    h: "h0",
    snap: "s0",
    meta: {},
  });
  // the network goes: 80 actions are played here meanwhile (more than the server's
  // burst of 60 messages), then it comes back
  f.ctl.down = true;
  a.ws.close();
  await until(() => !a.joined, 2000, "dropped");
  for (let seq = 1; seq <= 80; seq++) a.act(act(seq));
  assert.equal(a.pending.length, 80);
  f.ctl.down = false;
  await until(() => a.pending.length === 0, 8000, "all answered");
  assert.equal(
    server.pitch(code).match?.seq ?? server.pitch(code).head?.seq,
    80,
  );
  closeAll();
});

test("pitch client: an offline backlog is never sent on top of a refused action", async () => {
  const code = makePitchCode();
  const f = flakyWs();
  const a = join(code, "hanna", { WebSocket: f.WebSocket });
  await a.ready;
  const b = join(code, "gus");
  await b.ready;
  const refused = [];
  const oks = [];
  a.on("refused", (e) => refused.push(e.seq));
  a.on("ok", (e) => oks.push(e.seq));
  await a.start({
    doc: { started: true },
    n: 1,
    h: "h0",
    snap: "s0",
    meta: {},
  });
  // hanna's network goes; she plays 1 and 2 here while gus commits his own 1
  f.ctl.down = true;
  a.ws.close();
  await until(() => !a.joined, 2000, "dropped");
  a.act(act(1));
  a.act(act(2));
  b.act(act(1, { a: { type: "throw", by: "gus" }, h: "g1", snap: "gsnap-1" }));
  await until(() => b.pending.length === 0, 2000, "gus committed");
  f.ctl.down = false;
  await until(() => refused.length === 1, 3000, "refused");
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(refused, [1]);
  assert.deepEqual(oks, [], "her 2 was never sent on top of the refused 1");
  assert.equal(a.pending.length, 0);
  const m = server.pitch(code).match ?? server.pitch(code).head;
  assert.equal(m.seq, 1);
  assert.equal(m.h, "g1");
  closeAll();
});

test("pitch client: the same action sent twice on one connection is answered dup", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const b = join(code, "gus");
  await b.ready;
  const heardB = hear(b);
  const oks = [];
  a.on("ok", (e) => oks.push(e));
  await a.start({
    doc: { started: true },
    n: 1,
    h: "h0",
    snap: "s0",
    meta: {},
  });
  a.act(act(1));
  // the outbox's copy, sent again as a reconnect would
  const again = a.pending[0].msg;
  a.pending.push({ id: again.id, n: 1, seq: 1, msg: again });
  a.sendRaw(again);
  await until(() => oks.length === 2, 2000, "two answers");
  assert.deepEqual(
    oks.map((o) => o.dup),
    [false, true],
  );
  assert.equal(heardB.length, 1);
  closeAll();
});

test("pitch client: every socket dropping at once mid-play loses and repeats nothing", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const b = join(code, "gus");
  await b.ready;
  const o = join(code, "olga", { role: "observer" });
  await o.ready;
  const heardB = hear(b);
  const heardO = hear(o);
  const statuses = [];
  b.on("status", (s) => statuses.push(s));
  await a.start({
    doc: { started: true },
    n: 1,
    h: "h0",
    snap: "s0",
    meta: {},
  });
  for (let s = 1; s <= 20; s++) {
    a.act(act(s));
    if (s === 8 || s === 15) server.dropAll();
    await new Promise((r) => setTimeout(r, 5));
  }
  await until(
    () =>
      a.pending.length === 0 &&
      heardB.length >= 20 &&
      heardO.length >= 20 &&
      [a, b, o].every((c) => c.status === "open"),
    5000,
    "all back and in step",
  );
  for (const got of [heardB, heardO])
    assert.deepEqual(
      got.map((x) => x.seq),
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  assert.ok(statuses.includes("reconnecting"), "it said it was reconnecting");
  closeAll();
});

test("pitch client: two players acting at once: one is refused and asks for the whole pitch", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const b = join(code, "gus");
  await b.ready;
  await a.start({
    doc: { started: true },
    n: 1,
    h: "h0",
    snap: "s0",
    meta: {},
  });
  await until(() => b.match?.n === 1);
  const refused = [];
  const states = [];
  for (const c of [a, b]) {
    c.on("refused", (e) => {
      refused.push(e);
      c.resync();
    });
    c.on("state", (e) => states.push(e));
  }
  a.act(act(1, { a: { type: "throw", by: "a" } }));
  b.act(act(1, { a: { type: "throw", by: "b" } }));
  await until(() => refused.length === 1, 2000, "a refusal");
  assert.equal(refused[0].why, "seq");
  await until(() => states.length >= 1, 2000, "the state");
  const st = states.at(-1);
  assert.equal(st.match.full, true);
  assert.equal(st.match.seq, 1);
  assert.equal(st.match.snap, "snap-1");
  assert.equal(a.pending.length + b.pending.length, 0);
  closeAll();
});

test("pitch client: a jump in the pitch's sequence asks for the whole pitch", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  let states = 0;
  a.on("state", () => states++);
  const s = a.s;
  // a frame from further on than the next: something was missed
  a.frame({ t: "host", host: a.you, s: s + 2, ts: Date.now() });
  assert.equal(a.waitState, true);
  await until(() => states === 1 && !a.waitState, 2000, "the state");
  assert.equal(a.s, s);
  closeAll();
});

test("pitch client: observers watch, never cast, and never become host", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const o = join(code, "olga", { role: "observer" });
  await o.ready;
  assert.equal(o.role, "observer");
  assert.equal(o.cast({ t: "shout", w: "TOK!" }), false);
  const casts = [];
  o.on("cast", (c) => casts.push(c));
  assert.ok(a.cast({ t: "aim", s: { seq: 0 }, k: 1, c: 1 }, true));
  await until(() => casts.length === 1);
  assert.equal(casts[0].from, "hanna-member-id");
  assert.equal(typeof casts[0].ts, "number");
  assert.ok(!o.isHost());
  closeAll();
});

test("pitch client: the same member opening the pitch elsewhere replaces this one", async () => {
  const code = makePitchCode();
  const a = join(code, "hanna");
  await a.ready;
  const errors = [];
  a.on("error", (e) => errors.push(e.code));
  const again = join(code, "hanna");
  await again.ready;
  await until(() => a.status === "replaced", 2000, "replaced");
  assert.ok(errors.includes("replaced"));
  assert.equal(again.status, "open");
  closeAll();
});

test("pitch client: an observer on a pitch nobody started is refused when the server says so", async () => {
  const s = await startPitchServer({ options: { unknownPitch: "refuse" } });
  try {
    const o = connect({
      url: s.url,
      pitch: makePitchCode(),
      member: "olga-member-id",
      role: "observer",
      tune: fast,
    });
    await assert.rejects(o.ready, (err) => err.code === "no-pitch");
    assert.equal(o.status, "closed");
  } finally {
    await s.close();
  }
});
