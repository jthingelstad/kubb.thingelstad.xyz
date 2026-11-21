// The pitch core after the object sleeps or restarts: rebuilt from what was persisted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Harness, act, id, start } from "./harness.mjs";
import { LIMITS } from "../../backend/pitch-server/core.mjs";

// A match under way: two players, an observer, some actions, the pitch open.
const before = [
  ["join", "a", "anna", { me: { name: "Anna" } }],
  ["join", "b", "bert", { me: { name: "Bert" } }],
  ["join", "o", "olga", { role: "observer" }],
  [
    "send",
    "a",
    { t: "set", id: "s1", base: 0, doc: { teams: { A: ["x"], B: ["y"] } } },
  ],
  ["send", "a", { t: "open", open: { seats: 12, state: "waiting" } }],
  ["send", "a", start(1)],
  ["send", "a", act(1)],
  ["send", "b", act(2)],
  ["send", "a", { t: "cast", d: "aim" }],
  ["send", "b", act(3)],
];

// What happens after: resends, refusals, a resume, a host change, the end, a rematch.
const after = [
  ["send", "b", act(4)],
  ["send", "a", act(2, { seq: 9 })], // a duplicate
  ["send", "a", act(4)], // a stale one
  ["send", "a", { t: "cast", d: "aim" }],
  ["send", "o", { t: "cast", d: "aim" }],
  ["close", "b"],
  ["join", "b2", "bert", { v: 1, n: 1, seq: 2 }],
  ["send", "b2", { t: "resync" }],
  ["close", "a"],
  ["tick", LIMITS.hostGraceMs],
  ["send", "b2", act(5, { over: true })],
  ["send", "b2", { t: "set", base: 2, doc: { started: false } }],
  ["send", "b2", start(3, 2)],
  ["join", "a", "anna", { n: 1, seq: 5 }],
  ["send", "b2", { t: "open", open: null }],
  ["send", "o", { t: "leave" }],
];

function run(h, steps, dt = 0) {
  const out = [];
  for (const [kind, ...args] of steps) {
    if (kind === "join") h.join(args[0], args[1], args[2], { dt });
    else if (kind === "send") h.send(args[0], args[1], { dt });
    else if (kind === "close") h.close(args[0], { dt });
    else if (kind === "tick") h.tick(args[0] + dt);
    out.push(JSON.parse(JSON.stringify(h.effects)));
  }
  return out;
}

test("rebuilt after a sleep, the pitch behaves exactly as if it had stayed awake", () => {
  const awake = new Harness();
  const slept = new Harness();
  run(awake, before, 10);
  run(slept, before, 10);
  // an idle gap long enough for the object to sleep; then only one of them is rebuilt
  awake.now += 30_000;
  const wake = slept.wake({ dt: 30_000 });
  assert.deepEqual(wake, [], "a clean sleep needs nothing on waking");
  assert.equal(slept.state.s, awake.state.s);
  assert.deepEqual(run(slept, after, 10), run(awake, after, 10));
  assert.deepEqual(slept.store, awake.store);
  assert.deepEqual(slept.pushes, awake.pushes);
  assert.deepEqual(slept.listings, awake.listings);
});

test("waking keeps the head, the log, duplicates and the sequence", () => {
  const h = new Harness();
  run(h, before, 10);
  h.take("b");
  h.wake({ dt: 30_000 });
  assert.equal(h.state.match.seq, 3);
  assert.equal(h.state.match.snap, "snap-1-3");
  assert.deepEqual(
    h.state.match.acts.map((r) => r.id),
    ["act-1", "act-2", "act-3"],
  );
  h.send("a", act(1));
  const dup = h.take("a").at(-1);
  assert.deepEqual([dup.dup, dup.seq], [true, 1]);
  const s = h.state.s;
  h.send("a", act(4));
  assert.equal(h.take("b").at(-1).s, s + 1, "s goes on from where it was");
});

test("a member whose socket went while the object was down is marked away, the host's grace starts", () => {
  const h = new Harness();
  run(h, before, 10);
  for (const c of ["a", "b", "o"]) h.take(c);
  // a deploy restarted the object: only bert's socket is back so far
  h.open.delete("a");
  h.open.delete("o");
  const effects = h.wake({ dt: 1000 });
  const toB = h.take("b");
  assert.deepEqual(
    toB.map((f) => [f.t, f.member.id, f.member.connected]),
    [
      ["member", id("anna"), false],
      ["member", id("olga"), false],
    ],
  );
  assert.equal(toB[1].s, toB[0].s + 1);
  assert.equal(h.state.hostAway, h.now);
  assert.ok(effects.some((e) => e.kind === "persist" && e.members));
  assert.equal(h.alarm, h.now + LIMITS.hostGraceMs);
  h.tick(LIMITS.hostGraceMs);
  assert.equal(h.state.host, id("bert"));
});

test("a socket whose member is gone is detached on waking", () => {
  const h = new Harness();
  run(h, before, 10);
  const effects = h.wake({
    conns: [
      { conn: "a", member: id("anna"), role: "player" },
      { conn: "z", member: id("nobody-here"), role: "player" },
    ],
  });
  assert.ok(
    effects.some(
      (e) => e.kind === "attach" && e.conn === "z" && e.member === null,
    ),
  );
  h.connect("z");
  h.send("z", { t: "ping" });
  h.send("z", { t: "resync" });
  assert.deepEqual(
    h.take("z").map((f) => f.code ?? f.t),
    ["pong", "not-joined"],
  );
});

test("relay-first: an action shown and then lost when the object dies is caught", () => {
  const h = new Harness(); // relay-first, the default
  run(h, before.slice(0, 7), 10); // up to act 1
  for (const c of ["a", "b", "o"]) h.take(c);
  // act 2 is relayed, then the object dies before the write
  h.send("b", act(2), { stopAt: "persist" });
  assert.equal(h.take("a").at(-1).seq, 2, "A saw it");
  assert.equal(h.store.head.seq, 1, "but it was never written");
  h.wake({ dt: 500 });
  // A acts on top of what it saw: refused with the real head, so A resyncs
  h.send("a", act(3));
  const r = h.take("a").at(-1);
  assert.deepEqual([r.why, r.head.seq, r.head.h], ["seq", 1, "h1"]);
  // B resends act 2 (it never got its ok): stored now, and A is told
  h.send("b", act(2));
  assert.equal(h.take("b").at(-1).t, "ok");
  assert.equal(h.state.match.seq, 2);
  // a client back with the lost act is ahead of the pitch: it gets the state
  h.close("a");
  const j = h.join("a", "anna", { n: 1, seq: 3 });
  assert.equal(j.match.full, true);
});

test("write-first: an action written and then not relayed is acked on the resend", () => {
  const h = new Harness({ options: { commitOrder: "write-first" } });
  run(h, before.slice(0, 7), 10);
  for (const c of ["a", "b", "o"]) h.take(c);
  h.send("b", act(2), { stopAt: "send" });
  assert.deepEqual(h.take("a"), [], "nobody heard of it");
  assert.equal(h.store.head.seq, 2, "but it is written");
  h.wake({ dt: 500 });
  h.send("b", act(2));
  const ok = h.take("b").at(-1);
  assert.deepEqual([ok.t, ok.dup, ok.seq], ["ok", true, 2]);
  h.close("a");
  const j = h.join("a", "anna", { n: 1, seq: 1 });
  assert.deepEqual(
    j.match.acts.map((f) => f.id),
    ["act-2"],
  );
});

test("persisted records carry no snapshot copies beyond the head and stay small", () => {
  const h = new Harness();
  run(h, before, 10);
  assert.deepEqual(Object.keys(h.store).sort(), [
    "acts",
    "doc",
    "head",
    "match",
    "members",
    "pitch",
  ]);
  for (const a of h.store.acts) assert.equal("snap" in a, false);
  assert.ok(JSON.stringify(h.store.pitch).length < 600);
});
