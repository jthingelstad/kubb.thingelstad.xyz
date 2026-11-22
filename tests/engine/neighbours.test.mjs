// The Tournament's neighbours' worker protocol (src/engine/neighbours-host.js) against
// the real engine bundle under wasmoon, as the worker runs it: open, advance to a first
// recording, the page's playback (src/game/neighbours.js, the engine's playRecording)
// ending where neighbours.view says, close. And the page's model built from those
// messages alone equals view after every advance, turned or not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import {
  neighboursHost,
  makeNeighboursEngine,
} from "../../src/engine/neighbours-host.js";
import { Field, fieldFor, playRecording } from "../../src/game/neighbours.js";

const sources = bundleLua();
const host = () =>
  neighboursHost({
    makeEngine: () => makeNeighboursEngine({ sources }),
  });

function sameItems(got, want, what) {
  assert.equal(got.length, want.length, `${what}: count`);
  const by = new Map(want.map((it) => [it.id, it]));
  for (const it of got) {
    const w = by.get(it.id);
    assert.ok(w, `${what}: ${it.id}`);
    for (const k of ["x", "y", "z", "qw", "qx", "qy", "qz"])
      assert.ok(Math.abs(it[k] - w[k]) < 1e-9, `${what}: ${it.id}.${k}`);
    assert.equal(it.toppled, w.toppled, `${what}: ${it.id} toppled`);
  }
}

test("open, advance to a first throw, its playback ends where view says, close", async () => {
  const handle = host();
  const opened = await handle({
    type: "open",
    gen: 1,
    args: { seed: 7, scene: "tournament", count: 4, now: 0 },
  });
  assert.equal(opened.type, "opened");
  assert.equal(opened.gen, 1);
  const open = JSON.parse(opened.text);
  assert.equal(open.scene, "tournament");
  assert.equal(open.set, "usa");
  assert.equal(open.pitches.length, 4);
  assert.equal(open.stakes.length, 6);
  const field = new Field(open);

  // the match clock in frames until a throw comes back (each pitch's first is 1 to 20 s
  // after opening)
  let now = 0,
    thrown = null,
    bytes = 0;
  while (!thrown && now < 40) {
    now += 1 / 30;
    const r = await handle({ type: "advance", gen: 1, now, budgetMs: 2 });
    assert.equal(r.type, "events", r.message);
    bytes = Math.max(bytes, r.text.length);
    const { events } = JSON.parse(r.text);
    field.apply(events);
    thrown = events.find((e) => e.phase === "throw") || null;
  }
  assert.ok(thrown, "a throw within 40 s of clock");
  assert.ok(thrown.recording.bodies.length > 0);
  assert.ok(bytes < 16000, `an advance's answer is small: ${bytes}`);
  const p = field.byId.get(thrown.id);
  // mid-throw the thrown piece is in the air, somewhere along its flight
  const mid = field.itemsAt(p, thrown.at + thrown.recording.duration / 3);
  const proj = mid.find((it) => it.id === thrown.recording.projectile.id);
  assert.ok(proj && proj.z > 0.2, "the piece is in the air");
  // play on past its end: the pitch is where view has it then
  const before = p.items;
  const end = thrown.at + thrown.recording.duration + 0.01;
  const r = await handle({ type: "advance", gen: 1, now: end });
  const after = JSON.parse(r.text).events;
  assert.ok(!after.some((e) => e.id === thrown.id), "nothing more on it yet");
  field.apply(after);
  const played = playRecording(
    before,
    thrown.recording,
    thrown.recording.duration,
  );
  const v = await handle({ type: "view", gen: 1, id: thrown.id });
  assert.equal(v.type, "view");
  const view = JSON.parse(v.text);
  assert.equal(view.phase, "rest");
  sameItems(played, view.items, "the throw played out");
  sameItems(field.itemsAt(p, end), view.items, "the page's model");

  const closed = await handle({ type: "close", gen: 1 });
  assert.equal(closed.type, "closed");
  // after close, a new open on the same engine is a fresh field
  const again = await handle({
    type: "open",
    gen: 2,
    args: { seed: 7, count: 4 },
  });
  assert.equal(JSON.parse(again.text).pitches.length, 4);
});

test("the page's model from the messages alone equals view after every advance", async () => {
  const handle = host();
  const o = await handle({
    type: "open",
    gen: 1,
    args: { seed: 11, count: 3 },
  });
  const field = new Field(JSON.parse(o.text));
  let now = 0,
    throws = 0;
  while (now < 90) {
    now += 0.25;
    const r = await handle({ type: "advance", gen: 1, now });
    const { events } = JSON.parse(r.text);
    throws += events.filter((e) => e.phase === "throw").length;
    field.apply(events);
    if (Math.round(now * 4) % 8) continue; // every 2 s of clock
    const all = JSON.parse((await handle({ type: "view", gen: 1 })).text);
    for (const v of all.pitches) {
      const p = field.byId.get(v.id);
      // a throw still playing is compared once it has played out
      if (p.rec && now < p.recAt + p.rec.duration) continue;
      sameItems(field.itemsAt(p, now), v.items, `pitch ${v.id} at ${now}`);
    }
  }
  assert.ok(throws >= 5, `throws ${throws}`);
});

test("the field turned for Team B's frame: half a turn about (0, 4)", async () => {
  const handle = host();
  const o = JSON.parse(
    (await handle({ type: "open", gen: 1, args: { seed: 3, count: 2 } })).text,
  );
  const field = new Field(o);
  const a = fieldFor(field, 0, false);
  const b = fieldFor(field, 0, true);
  for (let i = 0; i < a.length; i++) {
    assert.equal(b[i].x, -a[i].x);
    assert.equal(b[i].y, -a[i].y);
    for (let j = 0; j < a[i].pieces.length; j++) {
      const pa = a[i].pieces[j],
        pb = b[i].pieces[j];
      // drawn: (ox + x, oy + y) -> (-(ox + x), 8 - (oy + y))
      assert.ok(Math.abs(b[i].x + pb.x + (a[i].x + pa.x)) < 1e-9);
      assert.ok(Math.abs(b[i].y + pb.y - (8 - (a[i].y + pa.y))) < 1e-9);
      assert.ok(Math.abs(pb.axis[2] - pa.axis[2]) < 1e-9);
    }
  }
});

test("a wrong argument is an error reply, never a throw; advance before open is refused", async () => {
  const handle = host();
  const early = await handle({ type: "advance", gen: 1, now: 1 });
  assert.equal(early.type, "error");
  const bad = await handle({ type: "open", gen: 2, args: { level: "kid" } });
  assert.equal(bad.type, "error");
  assert.match(bad.message, /level/);
  assert.equal((await handle({ type: "nonsense", gen: 3 })).type, "error");
});

test("the budget: the worker passes 2 ms to the engine, which keeps to it", async () => {
  const handle = host();
  await handle({ type: "open", gen: 1, args: { seed: 5 } });
  const used = [];
  let now = 0;
  while (now < 60) {
    now += 1 / 60;
    const r = await handle({ type: "advance", gen: 1, now });
    used.push(JSON.parse(r.text).used.ms);
  }
  // the engine's own measure of its work (docs/notes/tournament.md "What it costs");
  // a single call can run over by the host's own pauses (a busy machine running the
  // other test files), so the 99th centile is held, not the worst
  used.sort((a, b) => a - b);
  const p99 = used[Math.floor(used.length * 0.99)];
  assert.ok(p99 <= 3, `99% of calls under ${p99} ms`);
});
