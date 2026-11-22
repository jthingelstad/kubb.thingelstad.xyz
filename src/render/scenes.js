// Scenes: where the match is played, a look only. A scene never changes a throw:
// the engine, its poses and its hashes are the same in every one; it changes how
// the pitch is drawn.
//
// Since engine 0.14 the scenes are the engine's own objects (core/scenes, the
// engine's docs/SESSION.md "Scenes"): it lists them, names them, and decides each
// one's surfaces and kubb set when a client names a scene (`new`, the pitch's
// setOptions). The web draws what the view says (`scene`, `surface`, `set`) and
// builds its options cards from the engine's rows (`pitch.optionRows`). The seven:
//   day        Park        grass                     the look as it always was
//   beach      Beach       sand                      src/render/beach.js
//   night      Camping     grass (the glowing set)   src/render/night.js
//   neon       Techno      grid                      src/render/neon.js
//   minnesota  Minnesota   snow, the Minnesota set   src/render/minnesota.js
//   tournament Tournament  grass, the USA set        src/render/tournament.js
//   bw         Black & White  grass, sand or snow    src/render/mono.js
//
// A scene is data plus a few hooks drawWorld calls (src/render/world.js; night.js
// is the first and says what each one does):
//   id                 the engine's id
//   groundOf(surface)  the ground's paint (GROUND's keys, plus the scene's own)
//   setOf(set)         the set it plays with (a set is paint only)
//   light              where the light is: shadows, the faces' tones
//   paint              bare wood, stakes, ink, the king's marks; litOf(item),
//                      a piece's own light (the neon's sides), or none
//   clearing           where the ground ends round the pitch, or none
//   sky, rough, beyond, lightGround, lines, scenery, beforePieces, baton,
//   afterPieces        the hooks, in drawing order
//   reflect            a glossy floor's reflections (Techno's grid), or none
//   cone               the Kid line's cones' paint
//   dust, makeFx()     the scene's effects (stardust, rings, puffs, snow)
//   skin               the controls' colours (below), or none for the day's
// drawWorld given no scene, or the day, draws exactly what it always drew
// (tests/render/scene-day.test.mjs pins it).
//
// An id this client does not draw is the day (an engine newer than this page may
// list more), and so is an id the engine does not list. Every surface that draws
// a match (the game, its replay and embed, the reel and its stills on the server)
// draws it through one Stage (below). docs/SCENES.md.
import { makeNight } from "./night.js";
import { makeNeon } from "./neon.js";
import { makeBeach } from "./beach.js";
import { makeMinnesota } from "./minnesota.js";
import { makeTournament } from "./tournament.js";
import { makeMono } from "./mono.js";
import { useSkin } from "./palette.js";
import { drawWorld } from "./world.js";
import { Stardust } from "./stardust.js";

export const DAY = { id: "day" };

const MAKERS = {
  beach: makeBeach,
  night: makeNight,
  neon: makeNeon,
  minnesota: makeMinnesota,
  tournament: makeTournament,
  bw: makeMono,
};

export function sceneOf(id, opts = {}) {
  const make = MAKERS[id];
  return make ? make(opts) : DAY;
}

// The scenes this client draws, besides the day, in the engine's order.
export const SCENES = [
  "beach",
  "night",
  "neon",
  "minnesota",
  "tournament",
  "bw",
];
const SWITCHED = new Set(SCENES);

// The names a player sees come from the engine's rows (pitch.optionRows); this
// table is the same words for the places that have no engine at hand (the address
// switch's checks, the reel's tests) and is held to the engine's by a test. The
// stored ids of three are older than their names: day is Park, night Camping, neon
// Techno (the owner, 2026-11-22: "Park camping and techno.").
export const SCENE_NAMES = {
  day: "Park",
  beach: "Beach",
  night: "Camping",
  neon: "Techno",
  minnesota: "Minnesota",
  tournament: "Tournament",
  bw: "Black & White",
};

// A scene id as this client draws it: a known one, else "day".
export const sceneId = (id) => (SWITCHED.has(id) ? id : "day");

// Does engine constants `k` (src/net/lobby.js engineConstants) take a scene?
// Engine 0.9 on: `scene` is one of its OPTION_DEFAULTS.
export const takesScene = (k) =>
  !!k?.OPTION_DEFAULTS && "scene" in k.OPTION_DEFAULTS;

// The look for a scene id, or null for the day (and any id not known here).
export function lookOf(id, opts = {}) {
  return SWITCHED.has(id) ? sceneOf(id, opts) : null;
}

// ---------- a piece that spins faster than the frames ----------
//
// Two players said a thrown kubb "looks really weird" (2026-11-22): at SPIN's
// most a kubb leaves the hand at about 69 rad/s, eleven turns a second, 66 degrees a
// frame at 60 frames a second. A kubb's square section looks the same every quarter
// turn, so a turn of more than an eighth a frame is read the wrong way round: it
// seems to stand, jitter or turn back. Its end over end turn looks the same every
// half turn. So Stage.observe measures each piece's turn since the frame before,
// split into the twist about its long axis and the rest (a swing-twist split), and
// gives a piece `spin` (0 to 1: how much of the spin drawing to use) and `from` (its
// pose the frame before); world.js draws its in-between poses (drawSpin). The physics
// is never touched.
export const spinTune = {
  twistFrom: 30, // degrees a frame about the long axis: the drawing starts to blur
  twistFull: 50, // fully a spin by here (a square section's eighth turn is 45)
  swingFrom: 60, // end over end: a half turn repeats, so twice those
  swingFull: 100,
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// How much of a spin to draw for a piece that turned from pose a to pose b in one
// frame (each { qw, qx, qy, qz }): 0 to 1.
export function spinAmount(a, b, kind = "kubb") {
  const q1 = [a.qw ?? 1, a.qx ?? 0, a.qy ?? 0, a.qz ?? 0];
  const q2 = [b.qw ?? 1, b.qx ?? 0, b.qy ?? 0, b.qz ?? 0];
  // the turn between them in the world: d = q2 * conj(q1)
  const [w1, x1, y1, z1] = [q1[0], -q1[1], -q1[2], -q1[3]];
  const [w2, x2, y2, z2] = q2;
  let dw = w2 * w1 - x2 * x1 - y2 * y1 - z2 * z1;
  let dx = w2 * x1 + x2 * w1 + y2 * z1 - z2 * y1;
  let dy = w2 * y1 - x2 * z1 + y2 * w1 + z2 * x1;
  let dz = w2 * z1 + x2 * y1 - y2 * x1 + z2 * w1;
  if (dw < 0) {
    dw = -dw;
    dx = -dx;
    dy = -dy;
    dz = -dz;
  }
  // the long axis (local z) of the pose after, in the world
  const [qw, qx, qy, qz] = q2;
  const ax = 2 * (qx * qz + qw * qy),
    ay = 2 * (qy * qz - qw * qx),
    az = 1 - 2 * (qx * qx + qy * qy);
  const along = dx * ax + dy * ay + dz * az;
  const twist = (2 * Math.atan2(Math.abs(along), dw) * 180) / Math.PI;
  // the swing: what is left once the twist is taken out (its w is the twist's
  // length, |(dw, along)|)
  const swing =
    (2 * Math.acos(Math.min(1, Math.hypot(dw, along))) * 180) / Math.PI;
  const t = spinTune;
  // a baton is round about its long axis: its twist never shows
  const ut =
    kind === "baton"
      ? 0
      : clamp01((twist - t.twistFrom) / (t.twistFull - t.twistFrom));
  const us = clamp01((swing - t.swingFrom) / (t.swingFull - t.swingFrom));
  return Math.max(ut, us);
}

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

// A match drawn in its scene: the look, its effects (fed by the throw being
// shown) and the controls' skin. One a game, replay or reel.
//   const stage = new Stage({ reduced, skin })  skin: also skin the page
//   stage.use(id)                  the scene to draw ("day", unknown: day)
//   stage.watch(rec)               a throw starts playing
//   stage.observe(items, t)        a shown frame of it, at shown time t
//   stage.tick(dt), stage.clear()  between throws; a skipped one
//   stage.draw(ctx, view, camera, scene, time)   drawWorld in the scene
export class Stage {
  constructor({ reduced = reducedMotion(), skin = false } = {}) {
    this.reduced = reduced;
    this.skin = skin;
    this.id = "day";
    this.look = null;
    this.fx = null;
  }
  use(id) {
    const want = SWITCHED.has(id) ? id : "day";
    this.spins = null;
    if (want === this.id) return false;
    this.useLook(lookOf(want, { reduced: this.reduced }));
    return true;
  }
  useLook(look) {
    this.look = look && look.id !== "day" ? look : null;
    this.id = this.look ? this.look.id : "day";
    // a scene brings its own effects (makeFx), or the stardust's numbers
    this.fx = this.look?.makeFx
      ? this.look.makeFx()
      : this.look?.dust
        ? new Stardust(this.look.dust)
        : null;
    if (this.skin) skinPage(this.look);
  }
  watch(rec) {
    this.fx?.watch(rec);
    this.poses = new Map();
    this.spins = null;
  }
  // A shown frame of the throw: the effects, and each piece's spin since the frame
  // before (spinAmount).
  observe(items, t) {
    this.fx?.observe(items, t);
    const was = this.poses || new Map();
    const now = new Map();
    let spins = null;
    for (const it of items || []) {
      if (!it || it.kind === "stake" || it.id == null) continue;
      const pose = {
        x: it.x,
        y: it.y,
        z: it.z,
        qw: it.qw,
        qx: it.qx,
        qy: it.qy,
        qz: it.qz,
      };
      now.set(it.id, pose);
      const p = was.get(it.id);
      if (!p) continue;
      const u = spinAmount(p, pose, it.kind);
      if (u > 0) (spins ||= new Map()).set(it.id, { spin: u, from: p });
    }
    this.poses = now;
    this.spins = spins;
  }
  // Between throws: nothing spins.
  tick(dt) {
    this.fx?.tick(dt);
    this.spins = null;
  }
  clear() {
    this.fx?.clear();
    this.spins = null;
    this.poses = null;
  }
  // The items with each spinning piece's spin and pose the frame before.
  spun(items) {
    if (!this.spins || !items) return items;
    return items.map((it) => {
      const s = this.spins.get(it.id);
      return s ? { ...it, spin: s.spin, from: s.from } : it;
    });
  }
  // With the day, exactly drawWorld's picture (tests/render/scene-day.test.mjs).
  draw(ctx, view, camera, scene, time = 0) {
    const items = this.spun(scene.items);
    const sc = items === scene.items ? scene : { ...scene, items };
    if (!this.look) return drawWorld(ctx, view, camera, sc);
    drawWorld(ctx, view, camera, {
      ...sc,
      look: this.look,
      fx: this.fx,
      time,
    });
  }
}

// The address switch: the scene id `?scene=` names ("day" too), or null
// when it names none this client draws. Only the exact lower-case name is
// taken.
export function sceneFromQuery(search) {
  const want = new URLSearchParams(search || "").get("scene");
  return want === "day" || SWITCHED.has(want) ? want : null;
}

// The controls take the scene's skin (look.skin): the canvas HUD's colours
// (palette.js useSkin) and the page's CSS tokens, set on the root element so
// every token built on another resolves with it. No skin: the day's.
const skinned = new Set();
export function skinPage(look, root = globalThis.document?.documentElement) {
  const skin = look?.skin || null;
  useSkin(skin);
  if (!root?.style) return;
  for (const k of skinned) root.style.removeProperty(k);
  skinned.clear();
  for (const [k, v] of Object.entries(skin?.css || {})) {
    root.style.setProperty(k, v);
    skinned.add(k);
  }
  if (skin) root.dataset.scene = look.id;
  else delete root.dataset.scene;
}
