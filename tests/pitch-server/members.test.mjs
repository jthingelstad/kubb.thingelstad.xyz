// The pitch core: members, the host, observers, limits and the open games list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Harness, id } from "./harness.mjs";
import { LIMITS } from "../../backend/pitch-server/core.mjs";

const G = LIMITS.hostGraceMs;

test("the host away: kept through the grace, then passed to the earliest player", () => {
  const h = new Harness();
  assert.equal(
    h.join("o", "olga-early", { role: "observer" }).code,
    "no-pitch",
  );
  h.join("a", "anna");
  h.join("o", "olga", { role: "observer" }, { dt: 1 });
  h.join("b", "bert");
  h.join("c", "carl");
  h.take("b");
  h.close("a", { dt: 10 });
  assert.equal(
    h.alarm,
    h.now + G,
    "a tick is asked for when the grace runs out",
  );
  const m = h.take("b")[0];
  assert.deepEqual(
    [m.t, m.member.connected, m.host],
    ["member", false, id("anna")],
  );
  h.tick(G - 1);
  assert.equal(h.state.host, id("anna"));
  h.tick(1);
  assert.equal(
    h.state.host,
    id("bert"),
    "the observer joined earlier and is skipped",
  );
  const f = h.take("b").at(-1);
  assert.deepEqual([f.t, f.host], ["host", id("bert")]);
  assert.equal(h.take("o").at(-1).host, id("bert"));
  assert.equal(h.store.pitch.host, id("bert"));
  // anna comes back: not host again
  assert.equal(h.join("a", "anna").host, id("bert"));
});

test("the host back within the grace stays host", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("b", "bert");
  h.close("a");
  h.tick(G / 2);
  h.join("a2", "anna");
  h.tick(G);
  assert.equal(h.state.host, id("anna"));
  assert.equal(h.state.hostAway, null);
  assert.equal(h.alarm, null);
});

test("the host who leaves passes it at once; observers never take it", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("o", "olga", { role: "observer" });
  h.join("b", "bert");
  h.take("o");
  h.send("a", { t: "leave" });
  assert.equal(h.take("a").at(-1).t, "bye");
  const left = h.take("o")[0];
  assert.deepEqual(
    [left.t, left.id, left.host],
    ["left", id("anna"), id("bert")],
  );
  assert.equal(h.attached.has("a"), false);
  // bert leaves too: only the observer is left, and nobody hosts
  h.send("b", { t: "leave" });
  assert.equal(h.state.host, null);
  assert.equal(h.take("o").at(-1).host, null);
  // the next player to arrive hosts
  assert.equal(h.join("c", "carl").host, id("carl"));
});

test("a host away past the grace with nobody to take over passes it to the next arrival", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("o", "olga", { role: "observer" });
  h.close("a");
  h.tick(G + 1);
  assert.equal(h.state.host, id("anna"), "nobody may take it");
  assert.equal(
    h.alarm,
    null,
    "no tick is asked for while nobody may take over",
  );
  const j = h.join("b", "bert", {}, { dt: 5 });
  assert.equal(j.host, id("bert"));
});

test("the same member on a second connection replaces the first", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("b", "bert");
  h.take("b");
  h.join("a2", "anna");
  const old = h.take("a");
  assert.equal(old.at(-1).code, "replaced");
  assert.deepEqual(h.closed.at(-1), {
    kind: "close",
    conn: "a",
    code: 4001,
    reason: "replaced",
  });
  assert.equal(h.state.members.get(id("anna")).conn, "a2");
  // the old socket's close changes nothing
  h.close("a");
  assert.equal(h.state.members.get(id("anna")).conn, "a2");
  // a connection is one member
  h.send("a2", { t: "join", member: id("someone-else") });
  assert.equal(h.take("a2").at(-1).code, "already-joined");
});

test("a member keeps its role; another role needs another member id", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("o", "olga", { role: "observer" });
  h.close("o");
  assert.equal(h.join("o2", "olga").code, "bad-role");
});

test("players: 16; when full the one away longest gives up their place, never the host", () => {
  const h = new Harness();
  for (let i = 0; i < 16; i++) h.join(`p${i}`, `player${i}`, {}, { dt: 1 });
  assert.equal(h.join("x", "extra").code, "full");
  h.close("p3", { dt: 1 });
  h.close("p5", { dt: 1 });
  h.close("p0", { dt: 1 }); // the host: never evicted
  h.take("p1");
  const j = h.join("x", "extra");
  assert.equal(j.t, "joined");
  assert.equal(h.state.members.has(id("player3")), false);
  assert.equal(h.state.members.has(id("player0")), true);
  const toP1 = h.take("p1");
  assert.deepEqual(
    toP1.map((f) => f.t),
    ["left", "member"],
  );
  assert.equal(toP1[0].id, id("player3"));
  assert.equal(toP1[1].s, toP1[0].s + 1);
});

test("observers have their own cap (configurable; 20 by default)", () => {
  const h = new Harness({ options: { limits: { observers: 2 } } });
  h.join("a", "anna");
  h.join("o1", "olga1", { role: "observer" });
  h.join("o2", "olga2", { role: "observer" });
  assert.equal(h.join("o3", "olga3", { role: "observer" }).code, "full");
  assert.equal(h.join("b", "bert").t, "joined", "players are counted apart");
  assert.equal(new Harness().state.opts.limits.observers, 20);
});

test("observers get every reliable frame", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("o", "olga", { role: "observer" });
  h.send("a", { t: "set", base: 0, doc: { x: 1 } });
  h.send("a", {
    t: "start",
    base: 1,
    n: 1,
    doc: { s: 1 },
    h: "h0",
    snap: "s0",
  });
  h.send("a", { t: "act", id: "a1", n: 1, seq: 1, a: {}, h: "h1", snap: "s1" });
  assert.deepEqual(
    h.take("o").map((f) => f.t),
    ["doc", "start", "act"],
  );
});

test("me: a member's own fields, merged, null removes, announced to all", () => {
  const h = new Harness();
  h.join("a", "anna", { me: { name: "Anna", level: "club" } });
  h.join("b", "bert");
  h.take("a");
  h.send("a", { t: "me", me: { level: null, engine: "0.9+engines" } });
  const toA = h.take("a")[0];
  const toB = h.take("b")[0];
  assert.deepEqual(toA.member.me, { name: "Anna", engine: "0.9+engines" });
  assert.deepEqual(toB, toA);
  h.send("a", { t: "me", me: "nope" });
  assert.equal(h.take("a")[0].code, "bad-message");
});

test("open games: the host lists it; counts come from the pitch", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.join("b", "bert");
  h.send("b", { t: "open", open: { seats: 12, state: "waiting" } });
  assert.equal(h.take("b").at(-1).code, "not-host");
  h.send("a", { t: "open", open: { seats: 12, state: "waiting" } });
  let l = h.listings.at(-1);
  assert.equal(l.pitch, h.code);
  assert.deepEqual(l.entry, {
    made: h.now,
    players: 2,
    watchers: 0,
    seats: 12,
    state: "waiting",
  });
  const count = h.listings.length;
  h.join("o", "olga", { role: "observer" });
  assert.equal(h.listings.at(-1).entry.watchers, 1);
  // the same again pushes nothing
  h.send("a", { t: "open", open: { seats: 12, state: "waiting" } });
  assert.equal(h.listings.length, count + 1);
  // refreshed every listRefreshMs while listed
  assert.equal(h.alarm, h.now + LIMITS.listRefreshMs);
  h.tick(LIMITS.listRefreshMs);
  assert.equal(h.listings.length, count + 2);
  // playing, then over: off the list
  h.send("a", { t: "open", open: { seats: 12, state: "over" } });
  assert.equal(h.listings.at(-1).entry, null);
  h.send("a", { t: "open", open: { seats: 12, state: "playing" } });
  assert.equal(h.listings.at(-1).entry.state, "playing");
  h.send("a", { t: "open", open: { seats: 2, state: "playing" } });
  assert.equal(h.listings.at(-1).entry, null, "every seat taken");
  h.send("a", { t: "open", open: { seats: 13, state: "playing" } });
  assert.equal(h.take("a").at(-1).code, "bad-message");
  h.send("a", { t: "open", open: { seats: 12, state: "waiting" } });
  h.close("a");
  h.close("b");
  l = h.listings.at(-1);
  assert.equal(l.entry, null, "nobody on it");
  h.join("a", "anna");
  h.send("a", { t: "open", open: null });
  assert.equal(h.listings.at(-1).entry, null);
});

test("a pitch nobody is on is wiped after idleMs; the code is fresh again", () => {
  const h = new Harness();
  h.join("a", "anna");
  h.send("a", { t: "set", base: 0, doc: { x: 1 } });
  h.close("a", { dt: 10 });
  const left = h.now;
  assert.equal(h.alarm, left + G, "first the host's grace");
  h.tick(G);
  assert.equal(h.alarm, left + LIMITS.idleMs, "then the wipe");
  h.tick(LIMITS.idleMs - G - 1);
  assert.equal(h.wiped, 0);
  h.tick(1);
  assert.equal(h.wiped, 1);
  assert.deepEqual(h.store, {});
  assert.equal(h.alarm, null);
  assert.equal(h.state.fresh, true);
  const j = h.join("b", "bert");
  assert.deepEqual([j.v, j.doc, j.host], [0, null, id("bert")]);
});
