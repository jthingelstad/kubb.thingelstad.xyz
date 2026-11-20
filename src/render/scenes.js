// Scenes: where the match is played (park, city, tournament, night), a look
// only. A scene never changes a throw: the engine, its poses and its hashes
// are the same in every one; it changes how the pitch is drawn.
//
// A scene is data plus a few hooks drawWorld calls (src/render/world.js;
// night.js is the first and says what each one does):
//   id                 "day" (the look as it has always been), "night"
//   groundOf(surface)  the ground's paint (GROUND's keys, plus the scene's own)
//   setOf(set)         the set it plays with (the night: the glowing set; a
//                      set is paint only, every set the same pieces)
//   light              where the light is: shadows, the faces' tones
//   paint              bare wood, stakes, ink, the king's marks
//   clearing           where the ground ends round the pitch, or none
//   sky, rough, lightGround, lines, beforePieces, baton, afterPieces
//   dust               the stardust's numbers (src/render/stardust.js), or none
// drawWorld given no scene, or the day, draws exactly what it always drew
// (tests/render/scene-day.test.mjs pins it).
//
// The night is a prototype, shown only by the address switch ?scene=night on
// the practice pitch, a match against the computer and watching the
// computer. It is in no menu, never saved, sent or recorded.
import { makeNight } from "./night.js";
import { useSkin } from "./palette.js";

export const DAY = { id: "day" };

export function sceneOf(id, opts = {}) {
  if (id === "night") return makeNight(opts);
  return DAY;
}

// The address switch: the scene `?scene=` names, or null for the day. Only
// the exact lower-case name is taken.
export function sceneFromQuery(search, opts = {}) {
  const want = new URLSearchParams(search || "").get("scene");
  return want === "night" ? sceneOf("night", opts) : null;
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
