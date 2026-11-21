// The pitch core: aim casts, the thinned observer feed and per-connection rates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Harness, id } from "./harness.mjs";
import { LIMITS, thinAllow } from "../../backend/pitch-server/core.mjs";

// Kept times of a steady stream at `hz` for `ms`, through the thinning.
function thin(hz, ms, start = 0) {
  const t = new Map();
  const kept = [];
  for (let i = 0; start + (i * 1000) / hz < start + ms; i++) {
    const now = start + (i * 1000) / hz;
    if (thinAllow(t, "p", now)) kept.push(now);
  }
  return kept;
}

test("thinning: 15 Hz in gives 10 Hz to observers, time-based", () => {
  const kept = thin(15, 10_000);
  assert.ok(kept.length >= 99 && kept.length <= 101, `kept ${kept.length}`);
});

test("thinning: faster input is still about 10 Hz; slower input passes whole", () => {
  for (const hz of [20, 30, 60]) {
    const n = thin(hz, 10_000).length;
    assert.ok(n >= 99 && n <= 102, `${hz} Hz kept ${n}`);
  }
  assert.equal(thin(5, 10_000).length, 50);
  assert.equal(thin(10, 10_000).length, 100);
});

test("thinning: never two within the gap, never more than T/100 + 2 in a span T", () => {
  for (const hz of [15, 24, 60]) {
    const kept = thin(hz, 5_000);
    for (let i = 1; i < kept.length; i++)
      assert.ok(
        kept[i] - kept[i - 1] >= LIMITS.observerCastGapMs - 1e-9,
        `${hz} Hz gap`,
      );
    for (const span of [100, 250, 1000]) {
      for (let i = 0; i < kept.length; i++) {
        const within = kept.filter(
          (x) => x >= kept[i] && x < kept[i] + span,
        ).length;
        assert.ok(
          within <= span / LIMITS.observerCastMs + 2,
          `${hz} Hz, ${span} ms: ${within}`,
        );
      }
    }
  }
});

test("thinning: irregular arrival (network jitter) stays at or under 10 Hz", () => {
  const t = new Map();
  let now = 0;
  let kept = 0;
  let x = 7;
  for (let i = 0; i < 1500; i++) {
    x = (x * 48271) % 2147483647;
    now += 30 + (x % 75); // 30 to 104 ms apart, about 15 Hz
    if (thinAllow(t, "p", now)) kept++;
  }
  const hz = kept / (now / 1000);
  assert.ok(hz <= 10.05 && hz >= 7, `kept ${hz.toFixed(2)} Hz`);
});

test("thinning: senders are thinned apart", () => {
  const t = new Map();
  assert.equal(thinAllow(t, "p1", 0), true);
  assert.equal(thinAllow(t, "p1", 10), false);
  assert.equal(thinAllow(t, "p2", 10), true);
});

// Two players and one observer.
function pitch(options) {
  const h = new Harness({ options });
  h.join("a", "anna");
  h.join("b", "bert");
  h.join("o", "olga", { role: "observer" });
  for (const c of ["a", "b", "o"]) h.take(c);
  return h;
}

test("a cast goes to every other player at once, stamped, never back to the sender", () => {
  const h = pitch();
  h.send("a", { t: "cast", d: { t: "aim", s: { arm: 10 } } }, { dt: 5 });
  assert.deepEqual(h.take("a"), []);
  const [c] = h.take("b");
  assert.deepEqual(
    [c.t, c.m, c.s, c.ts],
    ["cast", id("anna"), h.state.s, h.now],
  );
  assert.deepEqual(c.d, { t: "aim", s: { arm: 10 } });
  assert.equal(h.take("o").length, 1);
  assert.equal(
    h.effects.some((e) => e.kind === "persist"),
    false,
    "casts are never persisted",
  );
});

test("observers get the thinned feed; players get all of it", () => {
  const h = pitch();
  for (let i = 0; i < 45; i++)
    h.send("a", { t: "cast", d: i }, { dt: 1000 / 15 });
  assert.equal(h.take("b").length, 45);
  const o = h.take("o").length;
  assert.ok(o >= 29 && o <= 31, `observer got ${o} of 45 in 3 s`);
});

test("a cast marked all reaches observers unthinned (a shout, the release)", () => {
  const h = pitch();
  h.send("a", { t: "cast", d: "aim" }, { dt: 1 });
  h.send("a", { t: "cast", d: "shout", all: true }, { dt: 1 });
  h.send("a", { t: "cast", d: "aim" }, { dt: 1 });
  assert.deepEqual(
    h.take("o").map((c) => c.d),
    ["aim", "shout"],
  );
});

test("observers do not cast, act, write, start or open", () => {
  const h = pitch();
  for (const msg of [
    { t: "cast", d: 1 },
    { t: "act", id: "x", n: 1, seq: 1, a: {}, h: "h", snap: "s" },
    { t: "set", base: 0, doc: {} },
    { t: "start", base: 0, n: 1, doc: {}, h: "h", snap: "s" },
  ]) {
    h.send("o", msg);
    const e = h.take("o")[0];
    assert.equal(e.t, "error", msg.t);
    assert.ok(["observer", "not-host"].includes(e.code), `${msg.t}: ${e.code}`);
  }
  h.send("o", { t: "open", open: { seats: 12, state: "waiting" } });
  assert.equal(h.take("o")[0].code, "not-host");
  assert.deepEqual(h.take("a"), []);
  assert.deepEqual(h.take("b"), []);
});

test("cast rate: a burst, then dropped with one warning", () => {
  const h = pitch({ limits: { castRate: 10, castBurst: 5 } });
  for (let i = 0; i < 8; i++) h.send("a", { t: "cast", d: i });
  assert.equal(h.take("b").length, 5);
  const warn = h.take("a");
  assert.equal(warn.length, 1);
  assert.deepEqual([warn[0].code, warn[0].re], ["rate", "cast"]);
  h.send("a", { t: "cast", d: "later" }, { dt: 200 }); // two tokens back
  assert.deepEqual(
    h.take("b").map((c) => c.d),
    ["later"],
  );
});

test("cast size", () => {
  const h = pitch({ limits: { castBytes: 100 } });
  h.send("a", { t: "cast", d: "x".repeat(100) });
  assert.equal(h.take("a")[0].code, "too-big");
  assert.deepEqual(h.take("b"), []);
});

test("message rate per connection: a burst, then dropped with one warning", () => {
  // the join took one of the five
  const h = pitch({ limits: { msgRate: 10, msgBurst: 5 } });
  for (let i = 0; i < 7; i++) h.send("b", { t: "ping" });
  const got = h.take("b");
  assert.deepEqual(
    got.map((f) => f.t),
    ["pong", "pong", "pong", "pong", "error"],
  );
  assert.equal(got[4].code, "rate");
  h.send("b", { t: "ping" }, { dt: 100 });
  assert.deepEqual(
    h.take("b").map((f) => f.t),
    ["pong"],
  );
});
