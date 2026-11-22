// The pitch core: joining, the lobby document, matches, actions and resume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Harness, act, id, start } from "./harness.mjs";
import {
  LIMITS,
  OPTIONS,
  createPitch,
  resolveOptions,
} from "../../backend/pitch-server/core.mjs";

// Two players on a pitch with match 1 started by A (the host).
function playing(options) {
  const h = new Harness({ options });
  h.join("a", "anna");
  h.join("b", "bert");
  h.send("a", start(0));
  h.take("a");
  h.take("b");
  return h;
}

test("the defaults are the spec's", () => {
  assert.equal(OPTIONS.commitOrder, "relay-first");
  assert.equal(OPTIONS.unknownPitch, "open");
  assert.equal(LIMITS.observers, 20);
  assert.equal(LIMITS.observerCastMs, 100);
  assert.throws(() => resolveOptions({ commitOrder: "sometimes" }));
  assert.throws(() => createPitch({ code: "short", now: 0 }));
});

test("the first player opens the pitch, is host and gets the whole state", () => {
  const h = new Harness();
  const j = h.join("a", "anna", { me: { name: "Mighty Maple" } });
  assert.equal(j.t, "joined");
  assert.equal(j.you, id("anna"));
  assert.equal(j.role, "player");
  assert.equal(j.host, id("anna"));
  assert.equal(j.v, 0);
  assert.equal(j.doc, null);
  assert.equal(j.match, null);
  assert.equal(j.s, 1);
  assert.equal(j.ts, h.now);
  assert.equal(j.limits.observers, 20);
  assert.deepEqual(
    j.members.map((m) => [m.id, m.role, m.connected, m.me.name]),
    [[id("anna"), "player", true, "Mighty Maple"]],
  );
  assert.ok(h.store.pitch && h.store.members && h.store.doc, "persisted");
  assert.deepEqual(h.attached.get("a"), { member: id("anna"), role: "player" });
});

test("the join that makes the pitch pushes `open` with its host's checked name, once", () => {
  const h = new Harness();
  h.deliver = false; // AWS does not answer: the push waits in the outbox
  h.join("a", "anna", { me: { name: "Cheerful Cedar" } });
  const opens = h.pushes.filter((p) => p.topic === "open");
  assert.equal(opens.length, 1);
  assert.equal(opens[0].k, "open");
  assert.deepEqual(opens[0].body, { pitch: h.code, host: "Cheerful Cedar" });
  assert.equal(opens[0].made, h.state.made);
  assert.deepEqual(
    h.store.outbox.map((e) => e.k),
    ["open"],
    "in the outbox until AWS takes it",
  );
  // nobody else's join pushes it again
  h.join("b", "bert", { me: { name: "Plucky Plum" } });
  assert.equal(h.pushes.filter((p) => p.topic === "open").length, 1);
  // a name the game did not make is never pushed
  const typed = new Harness();
  typed.join("a", "anna", { me: { name: "Anna Smith" } });
  assert.equal(typed.pushes.find((p) => p.topic === "open").body.host, null);
});

test("a second member is announced to the first, stamped", () => {
  const h = new Harness();
  h.join("a", "anna");
  const j = h.join("b", "bert");
  const [m] = h.take("a");
  assert.equal(m.t, "member");
  assert.equal(m.member.id, id("bert"));
  assert.equal(m.host, id("anna"));
  assert.equal(m.s, 2);
  assert.equal(j.s, 2);
  assert.equal(j.members.length, 2);
});

test("an observer never opens a pitch nobody is on", () => {
  const h = new Harness();
  h.send("o", { t: "join", member: id("olga"), role: "observer" });
  const e = h.take("o")[0];
  assert.equal(e.t, "error");
  assert.equal(e.code, "no-pitch");
  assert.deepEqual(h.store, {}, "nothing persisted");
});

test("unknownPitch refuse: a dead code is no pitch unless the join creates it", () => {
  const h = new Harness({ options: { unknownPitch: "refuse" } });
  h.send("a", { t: "join", member: id("anna") });
  assert.equal(h.take("a")[0].code, "no-pitch");
  assert.deepEqual(h.store, {});
  assert.equal(h.join("a", "anna", { create: true }).t, "joined");
  // once made, a plain join is fine
  assert.equal(h.join("b", "bert").t, "joined");
});

test("nothing but join and ping before joining", () => {
  const h = new Harness();
  h.send("a", { t: "ping" });
  assert.equal(h.take("a")[0].t, "pong");
  h.send("a", { t: "set", base: 0, doc: {} });
  const e = h.take("a")[0];
  assert.equal(e.code, "not-joined");
  assert.equal(e.re, "set");
  h.send("a", "not json");
  assert.equal(h.take("a")[0].code, "bad-message");
  h.send("a", { t: "nonsense" });
  assert.equal(h.take("a")[0].code, "not-joined");
});

test("lobby writes are compare-and-set, without the log", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("b", "bert");
  h.take("a");
  h.send("a", { t: "set", id: "w1", base: 0, doc: { teams: { A: ["x"] } } });
  const ok = h.take("a")[0];
  assert.deepEqual([ok.t, ok.re, ok.id, ok.v], ["ok", "set", "w1", 1]);
  const d = h.take("b")[0];
  assert.deepEqual(
    [d.t, d.v, d.by, d.s, d.ts],
    ["doc", 1, id("anna"), ok.s, ok.ts],
  );
  assert.deepEqual(d.doc, { teams: { A: ["x"] } });
  // B writes on the old version: refused with the current document
  h.send("b", { t: "set", id: "w2", base: 0, doc: { teams: {} } });
  const no = h.take("b")[0];
  assert.deepEqual(
    [no.t, no.re, no.id, no.v, no.by, no.sid],
    ["no", "set", "w2", 1, id("anna"), "w1"],
  );
  assert.deepEqual(no.doc, { teams: { A: ["x"] } });
  assert.deepEqual(h.take("a"), [], "a refusal is not relayed");
  assert.equal(JSON.parse(h.store.doc.text).teams.A[0], "x");
});

test("a joiner holding the current document version is not sent it", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.send("a", { t: "set", base: 0, doc: { x: 1 } });
  const j = h.join("b", "bert", { v: 1 });
  assert.equal("doc" in j, false);
  assert.equal(j.v, 1);
  const j2 = h.join("c", "carl", { v: 0 });
  assert.deepEqual(j2.doc, { x: 1 });
});

test("only the host starts a match, at the next number", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("b", "bert");
  h.take("a");
  h.send("b", start(0));
  assert.equal(h.take("b")[0].code, "not-host");
  h.send("a", start(0, 2));
  const bad = h.take("a")[0];
  assert.equal(bad.code, "bad-match");
  assert.equal(bad.n, 0);
  h.send("a", start(0));
  const ok = h.take("a")[0];
  assert.deepEqual([ok.t, ok.re, ok.v, ok.n], ["ok", "start", 1, 1]);
  const s = h.take("b")[0];
  assert.equal(s.t, "start");
  assert.equal(s.n, 1);
  assert.equal(s.snap, "snap-1-0");
  assert.equal(s.h, "h0");
  assert.deepEqual(s.meta, { engine: "0.9.0", setup: { seed: 1 } });
  assert.equal(s.v, 1);
  assert.equal(s.s, ok.s);
  assert.equal(h.pushes.at(-1).topic, "start");
  assert.equal(h.pushes.at(-1).body.snap, "snap-1-0");
  assert.deepEqual(h.store.head, {
    n: 1,
    seq: 0,
    h: "h0",
    snap: "snap-1-0",
    over: false,
  });
  // a start on a stale lobby version is a `no`, and starts nothing
  h.send("a", start(0, 2));
  const no = h.take("a")[0];
  assert.deepEqual([no.t, no.re, no.v], ["no", "start", 1]);
  assert.equal(h.state.match.n, 1);
});

test("an action: a small relay to the others, ok to the sender, both stamped", () => {
  const h = playing();
  h.send("a", act(1, { c: "web" }), { dt: 40 });
  const ok = h.take("a")[0];
  assert.deepEqual(
    [ok.t, ok.re, ok.id, ok.n, ok.seq],
    ["ok", "act", "act-1", 1, 1],
  );
  const r = h.take("b")[0];
  assert.equal(r.t, "act");
  assert.equal("snap" in r, false, "the relay drops the snapshot");
  assert.deepEqual(
    [r.m, r.id, r.n, r.seq, r.h, r.s, r.ts],
    [id("anna"), "act-1", 1, 1, "h1", ok.s, ok.ts],
  );
  assert.equal(r.ts, h.now);
  assert.deepEqual(r.a, { kind: "throw", seq: 1 });
  const p = h.pushes.at(-1);
  assert.equal(p.topic, "act");
  assert.equal(p.body.snap, "snap-1-1");
  assert.equal(p.body.c, "web");
  assert.equal(h.store.acts.length, 1);
  assert.equal(h.store.head.seq, 1);
  assert.equal(h.store.head.snap, "snap-1-1");
});

test("stale and out-of-order actions are refused with the head", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.send("a", act(1));
  let r = h.take("a")[0];
  assert.deepEqual([r.t, r.why, r.head], ["refused", "no-match", null]);
  h.send("a", start(0));
  h.take("a");
  h.send("a", act(2));
  r = h.take("a")[0];
  assert.deepEqual([r.t, r.why, r.seq], ["refused", "seq", 2]);
  assert.deepEqual(r.head, { n: 1, seq: 0, h: "h0", over: false });
  h.send("a", act(0));
  assert.equal(h.take("a")[0].why, "seq");
  h.send("a", act(1, { n: 7 }));
  assert.equal(h.take("a")[0].why, "match");
  assert.equal(h.state.match.acts.length, 0);
});

test("a resent action is acked again with its stored place, not stored twice", () => {
  const h = playing();
  h.send("a", act(1), { dt: 10 });
  const first = h.take("a")[0];
  h.send("a", act(2), { dt: 10 });
  h.take("a");
  h.take("b");
  // the client lost the first ok and resends act-1, now claiming another seq
  h.send("a", act(1, { seq: 3 }), { dt: 10 });
  const again = h.take("a")[0];
  assert.deepEqual(
    [again.t, again.dup, again.seq, again.s, again.ts],
    ["ok", true, 1, first.s, first.ts],
  );
  assert.deepEqual(h.take("b"), [], "a duplicate is not relayed");
  assert.equal(h.state.match.acts.length, 2);
  assert.equal(h.store.acts.length, 2);
});

test("an old match's retry is refused, even when its id was used again", () => {
  const h = playing();
  h.send("a", act(1, { over: true }));
  h.send("a", { t: "set", base: 1, doc: { started: false } });
  h.send("a", start(2, 2));
  h.send("a", act(1, { n: 2 })); // act-1 again, in match 2
  h.take("a");
  h.send("b", act(1)); // a late retry of match 1's act-1
  const r = h.take("b").at(-1);
  assert.deepEqual([r.t, r.why, r.n], ["refused", "match", 1]);
});

test("two players acting at once: one is stored, the other refused, same log", () => {
  const h = playing();
  // both act on seq 1; A's arrives first
  h.send("a", act(1, { id: "a-1" }));
  h.send("b", act(1, { id: "b-1", h: "other", snap: "other" }));
  const toA = h.take("a");
  const toB = h.take("b");
  assert.deepEqual(
    toA.map((f) => f.t),
    ["ok"],
  );
  assert.deepEqual(
    toB.map((f) => f.t),
    ["act", "refused"],
    "B sees the winner before its refusal",
  );
  assert.equal(toB[1].why, "seq");
  assert.deepEqual(toB[1].head, { n: 1, seq: 1, h: "h1", over: false });
  assert.equal(toB[0].id, "a-1");
  assert.deepEqual(
    h.state.match.acts.map((r) => r.id),
    ["a-1"],
  );
  // B resends its own on top of the winner: accepted as seq 2
  h.send("b", act(2, { id: "b-1" }));
  assert.equal(h.take("b")[0].seq, 2);
  assert.equal(h.take("a")[0].id, "b-1");
});

test("the action that ends the match pushes the kept replay; nothing after it lands", () => {
  const h = playing();
  h.send("a", act(1), { dt: 100 });
  h.send("b", act(2, { over: true }), { dt: 100 });
  const relay = h.take("a").at(-1);
  assert.equal(relay.over, true);
  const keep = h.pushes.at(-1);
  assert.equal(keep.topic, "keep");
  assert.equal(keep.body.n, 1);
  assert.equal(keep.body.h0, "h0");
  assert.deepEqual(keep.body.meta, { engine: "0.9.0", setup: { seed: 1 } });
  assert.deepEqual(
    keep.body.log.map((e) => e.h),
    ["h1", "h2"],
  );
  assert.equal("m" in keep.body.log[0], false, "no member ids in a replay");
  assert.equal(h.store.head.over, true);
  h.send("a", act(3));
  assert.equal(h.take("a").at(-1).why, "over");
  // the next match starts afresh and clears the log
  h.send("a", { t: "set", base: 1, doc: { started: false } });
  h.send("a", start(2, 2));
  assert.equal(h.store.acts.length, 0);
  assert.equal(h.state.match.n, 2);
});

test("resume: exactly the missed actions, or the state when too far behind", () => {
  const h = playing({ limits: { resumeMax: 5 } });
  for (let s = 1; s <= 8; s++) h.send("a", act(s), { dt: 50 });
  h.close("b");
  // back at seq 5: the three it missed, relayed as they were
  let j = h.join("b", "bert", { v: 1, n: 1, seq: 5 });
  assert.equal(j.match.full, false);
  assert.deepEqual(
    j.match.acts.map((f) => f.seq),
    [6, 7, 8],
  );
  assert.equal(j.match.acts[0].t, "act");
  assert.equal("snap" in j.match, false);
  assert.equal("snap" in j.match.acts[0], false);
  assert.deepEqual([j.match.n, j.match.seq, j.match.h], [1, 8, "h8"]);
  // holding the head: nothing to send
  h.close("b");
  j = h.join("b", "bert", { n: 1, seq: 8 });
  assert.deepEqual([j.match.full, j.match.acts], [false, []]);
  // too far behind (8 > 5): the state
  h.close("b");
  j = h.join("b", "bert", { n: 1, seq: 0 });
  assert.equal(j.match.full, true);
  assert.equal(j.match.snap, "snap-1-8");
  assert.equal(j.match.h0, "h0");
  assert.deepEqual(j.match.meta, { engine: "0.9.0", setup: { seed: 1 } });
  // just inside: 5 behind
  h.close("b");
  j = h.join("b", "bert", { n: 1, seq: 3 });
  assert.deepEqual(
    j.match.acts.map((f) => f.seq),
    [4, 5, 6, 7, 8],
  );
  // ahead of the pitch (it lost an action), another match, or no seq: the state
  for (const extra of [{ n: 1, seq: 9 }, { n: 0, seq: 3 }, {}]) {
    h.close("b");
    j = h.join("b", "bert", extra);
    assert.equal(j.match.full, true, JSON.stringify(extra));
  }
});

test("resync sends the whole state", () => {
  const h = playing();
  h.send("a", act(1));
  h.send("b", { t: "resync" });
  const st = h.take("b").at(-1);
  assert.equal(st.t, "state");
  assert.equal(st.match.full, true);
  assert.equal(st.match.snap, "snap-1-1");
  assert.equal(st.v, 1);
  assert.equal(st.host, id("anna"));
  assert.equal(st.members.length, 2);
});

test("every client sees every pitch sequence number once, in order", () => {
  const h = playing();
  const seen = { a: [], b: [] };
  const note = () => {
    for (const c of ["a", "b"])
      for (const f of h.take(c)) if (f.t !== "cast") seen[c].push(f.s);
  };
  const base = h.state.s;
  h.send("a", act(1));
  note();
  h.send("b", { t: "me", me: { name: "Brave Birch" } });
  note();
  h.send("b", act(2));
  note();
  h.send("a", { t: "set", base: 1, doc: { x: 2 } });
  note();
  for (const c of ["a", "b"])
    assert.deepEqual(seen[c], [base + 1, base + 2, base + 3, base + 4], c);
});

test("size limits", () => {
  const h = playing({
    limits: {
      snapBytes: 100,
      docBytes: 100,
      actionBytes: 50,
      messageBytes: 1000,
    },
  });
  h.send("a", act(1, { snap: "x".repeat(101) }));
  assert.equal(h.take("a")[0].code, "too-big");
  h.send("a", act(1, { a: { big: "x".repeat(60) } }));
  assert.equal(h.take("a")[0].code, "too-big");
  h.send("a", { t: "set", base: 1, doc: { big: "x".repeat(100) } });
  assert.equal(h.take("a")[0].code, "too-big");
  h.send("a", { t: "set", base: 1, doc: "é".repeat(60) }); // 120 bytes as UTF-8
  assert.equal(h.take("a")[0].code, "too-big");
  h.send("a", { t: "me", me: { name: "x".repeat(600) } });
  assert.equal(h.take("a")[0].code, "too-big");
  h.send("a", JSON.stringify({ t: "ping", pad: "x".repeat(1000) }));
  assert.equal(h.take("a")[0].code, "too-big");
  assert.equal(h.state.match.acts.length, 0);
});

test("malformed actions are errors, not refusals", () => {
  const h = playing();
  for (const bad of [
    { id: "has space" },
    { seq: "1" },
    { a: "text" },
    { h: null },
    { snap: "" },
    { over: "yes" },
    { c: "Web Browser" },
  ]) {
    h.send("a", act(1, bad));
    const e = h.take("a")[0];
    assert.equal(e.t, "error", JSON.stringify(bad));
    assert.equal(e.code, "bad-message");
  }
  // numeric hashes are fine
  h.send("a", act(1, { h: 123456 }));
  assert.equal(h.take("a")[0].t, "ok");
});

test("write-first puts the write before every frame; relay-first after", () => {
  const order = (commitOrder) => {
    const h = playing({ commitOrder });
    return h.send("a", act(1)).map((e) => e.kind);
  };
  assert.deepEqual(order("write-first").slice(0, 3), [
    "persist",
    "send",
    "send",
  ]);
  assert.deepEqual(order("relay-first").slice(0, 3), [
    "send",
    "send",
    "persist",
  ]);
});
