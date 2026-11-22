// The Tournament's other pitches heard (src/game/neighbour-sound.js, Field's cues in
// src/game/neighbours.js, Game.neighbourSounds, Sound.distant): cued from a real
// neighbour recording at its toppleT and its landing, quieter with distance and never as
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

test("a neighbour's throw is heard at each topple, its landing and a king down, in the engine's time", async () => {
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
  while (now < 120 && !toppling) {
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
  for (const ev of throws) {
    const cues = cuesOf(ev.recording);
    // the landing: the thrown piece's first frame on the ground after it flew
    const pid = ev.recording.projectile.id;
    const body = ev.recording.bodies.find((b) => b.id === pid);
    const land = cues.find((c) => c.kind === "land");
    assert.ok(land, "it lands");
    const j = Math.round(land.t / ev.recording.frameDt) - body.start;
    const z = (i) => body.poses[i * 7 + 2] / ev.recording.poseScale;
    assert.ok(z(j) <= tune.landZ);
    for (let i = 0; i < j; i++)
      assert.ok(
        z(i) > tune.landZ ||
          ![...Array(i).keys()].some((h) => z(h) > tune.flewZ),
      );
    // each topple at its toppleT, a king's as a king
    for (const b of ev.recording.bodies.filter((b) => b.toppleT !== undefined))
      assert.ok(
        cues.some(
          (c) =>
            c.t === b.toppleT &&
            c.kind === (b.kind === "king" ? "king" : "hit"),
        ),
      );
    assert.deepEqual(
      cues.map((c) => c.t),
      [...cues.map((c) => c.t)].sort((a, b) => a - b),
    );
  }
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
