// Scenes: where the match is played (park, city, tournament, night), a look
// only. A scene never changes a throw: the engine, its poses and its hashes
// are the same in every one; it changes how the pitch is drawn.
//
// A scene is data plus a few hooks drawWorld calls (src/render/world.js;
// night.js is the first and says what each one does):
//   id                 "day" (the look as it has always been), "night", "neon"
//   groundOf(surface)  the ground's paint (GROUND's keys, plus the scene's own)
//   setOf(set)         the set it plays with (the night: the glowing set; a
//                      set is paint only, every set the same pieces)
//   light              where the light is: shadows, the faces' tones
//   paint              bare wood, stakes, ink, the king's marks; litOf(item),
//                      a piece's own light (the neon's sides), or none
//   clearing           where the ground ends round the pitch, or none
//   sky, rough, lightGround, lines, beforePieces, baton, afterPieces
//   dust               the stardust's numbers (src/render/stardust.js), or none
//   makeFx()           the scene's own effects in their place (the neon)
//   skin               the controls' colours (below)
// drawWorld given no scene, or the day, draws exactly what it always drew
// (tests/render/scene-day.test.mjs pins it).
//
// A match carries its scene as an id (the engine's `scene` option, since
// 0.9; the view's `scene`, "day" when none). The engine keeps the id and
// never reads it: a scene is a look only. An id this client does not know
// is drawn as the day. Every surface that draws a match (the game, its
// replay and embed, the reel and its stills on the server) draws it through
// one Stage (below). docs/SCENES.md.
//
// The scene is a match option, Scene (SCENE_ROW below): on the solo card
// (kept with its options; watching the computer takes the card's), in MENU
// on the practice pitch, and, set by the host, in the lobby of a pitch on
// 0.9 (the room keeps it in `settings.scene`). The address switch
// (?scene=night, ?scene=neon) picks one for the practice pitch, a match
// against the computer and watching the computer, never a shared pitch.
import { makeNight } from "./night.js";
import { makeNeon } from "./neon.js";
import { useSkin } from "./palette.js";
import { drawWorld } from "./world.js";
import { Stardust } from "./stardust.js";

export const DAY = { id: "day" };

export function sceneOf(id, opts = {}) {
  if (id === "night") return makeNight(opts);
  if (id === "neon") return makeNeon(opts);
  return DAY;
}

// The scenes this client draws, besides the day.
export const SCENES = ["night", "neon"];
const SWITCHED = new Set(SCENES);

// The Scene row, as the solo card, MENU and the lobby draw it: [key, label,
// [[value, label], ...]], the shape of the engine's MATCH_OPTIONS. The engine
// takes any scene id and does not list them (its docs/ROOM.md difference 9),
// so the labels are this client's.
//
// SCENE_NAMES is the one table of the names a player sees for each scene id, on
// every surface that names one (the solo card's tiles, the lobby, practice's MENU).
// The 1.0 design shows Day, Night and Neon as Park, Camping and Techno; whether
// that comes in 1.0 or with the scene catalogue is still the owner's to decide, so
// today's names stay until then. Renaming is this table alone: the stored ids
// ("day", "night", "neon") never change. The iPhone keeps the same table.
export const SCENE_NAMES = {
  day: "Day",
  night: "Night",
  neon: "Neon",
};
export const SCENE_ROW = [
  "scene",
  "Scene",
  ["day", "night", "neon"].map((id) => [id, SCENE_NAMES[id]]),
];

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
  }
  observe(items, t) {
    this.fx?.observe(items, t);
  }
  tick(dt) {
    this.fx?.tick(dt);
  }
  clear() {
    this.fx?.clear();
  }
  // With the day, exactly drawWorld's picture (tests/render/scene-day.test.mjs).
  draw(ctx, view, camera, scene, time = 0) {
    if (!this.look) return drawWorld(ctx, view, camera, scene);
    drawWorld(ctx, view, camera, {
      ...scene,
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
