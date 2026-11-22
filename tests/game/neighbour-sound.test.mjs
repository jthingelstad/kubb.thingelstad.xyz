// The Tournament's other pitches heard (src/game/neighbour-sound.js, Field's cues in
// src/game/neighbours.js, Game.neighbourSounds, Sound.distant): cued from a real
// neighbour recording's hits and landing (engine 0.16.0), a topple as loud as its hit
// was hard and a kubb struck and left standing quietly, quieter with distance and never as
// loud as the player's own knock, at most three at once, and silent wherever it must be.
// And no person is drawn on any path of the Tournament.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import {
  neighboursHost,
  makeNeighboursEngine,
} from "../../src/engine/neighbours-host.js";
import { Field } from "../../src/game/neighbours.js";
import {
  cuesOf,
  gainFor,
  panFor,
  capVoices,
  rateFor,
  tune,
} from "../../src/game/neighbour-sound.js";
import { tune as soundTune } from "../../src/game/sound.js";
import { Game } from "../../src/game/game.js";

const OWN = soundTune.volume * 0.9; // the player's own knock (game.js playFrame)

test("a neighbour's throw is heard at each hit, a topple by its strength, a struck kubb that stands quietly, its landing at landing.t", async () => {
  const handle = neighboursHost({
    makeEngine: () => makeNeighboursEngine({ sources: bundleLua() }),
  });
  const opened = await handle({
    type: "open",
    gen: 1,
    args: { seed: 3, scene: "tournament", count: 8, now: 0 },
  });
  const field = new Field(JSON.parse(opened.text));
  let now = 0;
  let toppling = null;
  const throws = [];
  while (now < 240 && !toppling) {
    now += 1 / 30;
    const r = await handle({ type: "advance", gen: 1, now, budgetMs: 4 });
    const { events } = JSON.parse(r.text);
    field.apply(events);
    for (const ev of events.filter((e) => e.phase === "throw")) {
      throws.push(ev);
      if (ev.recording.bodies.some((b) => b.toppleT !== undefined))
        toppling = ev;
    }
  }
  assert.ok(throws.length > 0, "a throw");
  let landed = 0;
  for (const ev of throws) {
    const rec = ev.recording;
    const cues = cuesOf(rec);
    // the landing: at the engine's landing.t, never read from the poses
    const land = cues.filter((c) => c.kind === "land");
    if (rec.landing) {
      landed += 1;
      assert.deepEqual(
        land.map((c) => c.t),
        [rec.landing.t],
      );
    } else assert.equal(land.length, 0, "no landing, no thud");
    // each body struck: once, at its hit's time, a topple by its strength, a kubb
    // left standing a quiet tap
    const bodies = new Map(rec.bodies.map((b) => [b.id, b]));
    const pid = rec.projectile.id;
    const struck = new Set();
    for (const h of rec.hits || []) {
      if (h.id === pid || struck.has(h.id)) continue;
      struck.add(h.id);
      const b = bodies.get(h.id);
      const fell = b && b.toppleT !== undefined;
      const c = cues.find((c) => c.t === h.t && c.kind !== "land");
      assert.ok(c, `${h.id} heard`);
      assert.equal(
        c.kind,
        fell ? (b.kind === "king" ? "king" : "hit") : "tap",
        h.id,
      );
      const share = tune.softest + (1 - tune.softest) * h.strength;
      assert.ok(Math.abs(c.level - (fell ? share : share * tune.stood)) < 1e-9);
    }
    for (const b of rec.bodies.filter((b) => b.toppleT !== undefined))
      assert.ok(struck.has(b.id), `${b.id} toppled with a hit to hear`);
    assert.deepEqual(
      cues.map((c) => c.t),
      [...cues.map((c) => c.t)].sort((a, b) => a - b),
    );
  }
  assert.ok(landed > 0, "throws land");
  assert.ok(toppling, "a throw that toppled something");
  // the model keeps them on the match clock, due at release + t, taken once
  const fresh = new Field(JSON.parse(opened.text));
  fresh.apply([toppling]);
  const want = cuesOf(toppling.recording).map((c) => toppling.at + c.t);
  assert.deepEqual(
    fresh.cues.map((c) => c.at),
    want,
  );
  assert.equal(fresh.takeCues(toppling.at - 0.01).length, 0, "none early");
  const due = fresh.takeCues(want.at(-1));
  assert.ok(due.length >= 1);
  assert.ok(due.every((c) => c.offset && c.id === toppling.id));
  assert.equal(fresh.takeCues(want.at(-1) + 5).length, 0, "taken once");
  // a cue that reaches the page late is dropped, not played late
  const late = new Field(JSON.parse(opened.text));
  late.apply([toppling]);
  assert.equal(late.takeCues(want.at(-1) + tune.stale + 0.1).length, 0);
});

test("the pitch beside is clearly heard but under the player's own throw, the far row faint", () => {
  const beside = gainFor(8),
    ahead = gainFor(12),
    corner = gainFor(Math.hypot(8, 12)),
    far = gainFor(24);
  assert.ok(beside > 0.15 && beside < OWN / 2, `beside ${beside}`);
  assert.ok(gainFor(8, "king") < OWN, "even a king");
  assert.ok(beside > ahead && ahead > corner && corner > far);
  assert.ok(far < 0.05, `far ${far}`);
  assert.equal(gainFor(200), 0, "out of hearing");
  assert.ok(gainFor(8, "land") < beside, "a landing is softer");
  assert.ok(rateFor("land") < rateFor("hit"), "and lower");
});

test("left or right from where the pitch lies across the view", () => {
  // a camera at the near baseline looking down the pitch (+y), right = +x
  const cam = { px: 0, py: -3, rx: 1, ry: 0 };
  assert.ok(panFor(cam, 8, 4) > 0.5);
  assert.ok(panFor(cam, -8, 4) < -0.5);
  assert.ok(Math.abs(panFor(cam, 0, 16)) < 1e-9);
  assert.ok(Math.abs(panFor(cam, 100, 4)) <= tune.pan);
  assert.equal(panFor(null, 8, 4), 0);
});

test("never more than three at once: the faintest goes", () => {
  const v = [{ gain: 0.2 }, { gain: 0.05 }, { gain: 0.1 }];
  assert.deepEqual(capVoices(v.slice(0, 2), 0.01), { play: true, stop: null });
  assert.deepEqual(capVoices(v, 0.03), { play: false, stop: null });
  assert.deepEqual(capVoices(v, 0.15), { play: true, stop: v[1] });
});

// Game.neighbourSounds on a stand-in game: what it plays, and when it plays nothing.
function standIn(over = {}) {
  const played = [];
  const g = {
    nb: {
      takeCues: () => [
        { id: 1, kind: "hit", at: 1, offset: { x: 8, y: 0 } },
        { id: 2, kind: "king", at: 1, offset: { x: -8, y: 12 } },
      ],
    },
    sound: {
      muted: false,
      distant: (gain, pan, rate) => (played.push({ gain, pan, rate }), true),
    },
    quiet: false,
    modal: 0,
    frozen: false,
    play: null,
    ownKnockAt: undefined,
    nbDrawn: { camera: { px: 0, py: -3, rx: 1, ry: 0 } },
    pitchFrame: () => "A",
    ownKnockNear: Game.prototype.ownKnockNear,
    ...over,
  };
  return { g, played, run: () => Game.prototype.neighbourSounds.call(g, 5000) };
}

test("the game plays each cue at its pitch's loudness and side", () => {
  const { played, run } = standIn();
  assert.equal(run(), 2);
  assert.equal(played[0].gain, gainFor(8, "hit"));
  assert.ok(played[0].pan > 0, "the pitch to the right");
  assert.equal(played[1].gain, gainFor(Math.hypot(8, 12), "king"));
  assert.ok(played[1].pan < 0, "the corner to the left");
  // in Team B's frame the field is turned: the right-hand pitch is on the left
  const b = standIn({ pitchFrame: () => "B" });
  b.run();
  assert.ok(b.played[0].pan < 0);
});

test("silent with the Sound off, in a hidden tab, under a card, paused, and around the player's own knock", () => {
  for (const [what, over] of [
    ["sound off", { sound: { muted: true, distant: () => assert.fail() } }],
    ["no sound (the embed)", { sound: null }],
    ["a hidden tab", { quiet: true }],
    ["a card", { modal: 1 }],
    ["paused", { frozen: true }],
    ["just after its own knock", { ownKnockAt: 5000 - 100 }],
    [
      "just before its own knock",
      { play: { done: false, ki: 0, t: 1.0, knocks: [{ t: 1.1 }] } },
    ],
  ]) {
    const { played, run } = standIn(over);
    assert.equal(run(), 0, what);
    assert.equal(played.length, 0, what);
  }
  // a knock half a second ago no longer holds them
  const { run } = standIn({ ownKnockAt: 5000 - tune.ownGap * 1000 });
  assert.equal(run(), 2);
});

test("no person is drawn on any path of the Tournament", () => {
  // the drawing has no person in it at all: the figure is gone from the scenery, the
  // palette has no person or shirts, the still pitches and the live field carry none
  const read = (p) =>
    fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  for (const f of [
    "src/render/scenery.js",
    "src/render/tournament.js",
    "src/render/scenes.js",
    "src/game/neighbours.js",
    "src/site/art.mjs",
  ])
    assert.equal(
      /\bperson\s*\(|\.people\b|people:|shirts|watchers|peopleOf/.test(read(f)),
      false,
      f,
    );
});

test("the sounds' loudness: a hard hit is louder than a graze, a kubb left standing quieter than one that falls", () => {
  const rec = {
    projectile: { id: "baton1", kind: "baton" },
    bodies: [
      { id: "baton1", kind: "baton", start: 0, frames: 0, poses: [] },
      { id: "k1", kind: "kubb", toppleT: 0.8 },
      { id: "k2", kind: "kubb", toppleT: 0.9 },
      { id: "k3", kind: "kubb" },
      { id: "king", kind: "king", toppleT: 1.2 },
    ],
    hits: [
      { t: 0.5, id: "k1", strength: 1 },
      { t: 0.55, id: "k2", strength: 0.1 },
      { t: 0.6, id: "k3", strength: 1 },
      { t: 0.7, id: "k1", strength: 0.2 },
      { t: 1.0, id: "king", strength: 0.6 },
    ],
    landing: { t: 0.4, strength: 0.5 },
  };
  const cues = cuesOf(rec);
  assert.deepEqual(
    cues.map((c) => [c.t, c.kind]),
    [
      [0.4, "land"],
      [0.5, "hit"],
      [0.55, "hit"],
      [0.6, "tap"],
      [1.0, "king"],
    ],
    "the first contact on each body only",
  );
  const lv = Object.fromEntries(cues.map((c) => [c.t, c.level]));
  assert.equal(lv[0.5], 1, "a hard hit: the full knock");
  assert.ok(lv[0.55] < lv[0.5] && lv[0.55] >= tune.softest, "a graze softer");
  assert.ok(lv[0.6] < lv[0.5], "struck as hard and left standing: quieter");
  assert.ok(rateFor("tap") > rateFor("hit"), "a tap, not a fall");
  // a recording with no hits (nothing struck) still knocks at a topple's toppleT
  assert.deepEqual(
    cuesOf({ bodies: [{ id: "k1", kind: "kubb", toppleT: 1 }] }),
    [{ t: 1, kind: "hit", level: 1 }],
  );
});
