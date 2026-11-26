// HOLLER on a shared pitch (docs/MULTIPLAYER.md "Being there"): the fixed things a
// player can holler, read by the panel, the receiver and the tests from one list,
// `hollers.json` beside this file. The iPhone app keeps the same list
// (docs/MULTIPLAYER.md "What the iPhone app mirrors").
//
// Wire: a phrase is the cast `{ t: "shout", w: "<phrase>" }`, an emoji
// `{ t: "shout", e: "<emoji>" }` with no `w`. A receiver shows only a `w` that is
// exactly one of the phrases or an `e` that is exactly one of the emoji, and drops
// anything else without a word: nothing a player could write ever reaches the screen.
import list from "./hollers.json" with { type: "json" };

export const HOLLER_GROUPS = Object.freeze(
  list.groups.map((g) =>
    Object.freeze({ ...g, phrases: Object.freeze([...g.phrases]) }),
  ),
);
export const HOLLER_PHRASES = Object.freeze(
  HOLLER_GROUPS.flatMap((g) => g.phrases),
);
export const HOLLER_EMOJI = Object.freeze([...list.emoji]);

// The cast for one holler: { w } or { e }.
export function hollerCast(item) {
  return item.emoji
    ? { t: "shout", e: item.emoji }
    : { t: "shout", w: item.phrase };
}

// What a cast's payload hollers, or null to drop it: { phrase } or { emoji }.
export function hollerOf(d) {
  if (!d || typeof d !== "object" || d.t !== "shout") return null;
  if (HOLLER_PHRASES.includes(d.w)) return { phrase: d.w };
  if (HOLLER_EMOJI.includes(d.e)) return { emoji: d.e };
  return null;
}
