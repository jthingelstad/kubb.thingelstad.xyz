// Reduced motion holds the end camera (src/game/held-end.js; engine 1.4.1, its
// docs/CLIENTS.md "1.4.1 on top"; the iPhone app's Playback.heldEnd): the other side's
// throw seen from the player's end keeps the first frame's camera for the whole of it,
// and nothing else changes. The engine's own frames are played in
// tests/game/held-end-client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { holdEnd } from "../../src/game/held-end.js";

const endAt = (yaw) => ({ kind: "end", eye: [0, -1.2, 1.6], yaw });
const shownAt = (t, camera) => ({ t, camera, items: [{ id: "b", t }] });

test("reduced motion: the first frame's end camera, held for the whole throw", () => {
  const first = endAt(0);
  let asked = 0;
  const opts = { reduced: true, first: () => (asked++, first) };
  let held = null;
  for (const t of [0, 0.2, 0.9, 2.4]) {
    const r = holdEnd(shownAt(t, endAt(t)), held, opts);
    held = r.held;
    assert.deepEqual(r.shown.camera, first, `t ${t}: the first frame's`);
    assert.equal(r.shown.t, t, "the frame's own time");
    assert.deepEqual(r.shown.items, [{ id: "b", t }], "the frame's own pieces");
  }
  assert.equal(asked, 1, "showAt t = 0 asked once a playback");
});

test("reduced motion from a skipped start: still t = 0's, never the frame it began on", () => {
  const first = endAt(0);
  const r = holdEnd(shownAt(3, endAt(3)), null, {
    reduced: true,
    first: () => first,
  });
  assert.deepEqual(r.shown.camera, first);
  // t = 0 not to be had: the frame's own, held from there
  const g = holdEnd(shownAt(3, endAt(3)), null, {
    reduced: true,
    first: () => {
      throw new Error("no recording");
    },
  });
  assert.deepEqual(g.held, endAt(3));
});

test("motion allowed: the engine's turning camera, frame by frame", () => {
  let held = null;
  for (const t of [0, 0.5, 1]) {
    const s = shownAt(t, endAt(t));
    const r = holdEnd(s, held, { reduced: false, first: () => endAt(0) });
    held = r.held;
    assert.equal(r.shown, s, "drawn as given");
    assert.equal(held, null);
  }
});

test("any other camera is drawn as given, reduced motion or not", () => {
  for (const kind of ["throw", "wide", undefined]) {
    const s = shownAt(1, { kind, yaw: 1 });
    const r = holdEnd(s, null, { reduced: true, first: () => endAt(0) });
    assert.equal(r.shown, s, `${kind}`);
    assert.equal(r.held, null);
  }
  assert.deepEqual(holdEnd(null, null, { reduced: true }), {
    shown: null,
    held: null,
  });
});
