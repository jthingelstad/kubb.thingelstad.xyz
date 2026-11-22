// A match against the computer, kept on the device after every action (QA, 2026-11-22;
// the iPhone app keeps its own the same way, its docs/MATCH.md "Saving"): reloading the
// page, or opening PLAY NOW or the solo link again, offers it back with RESUME and NEW
// MATCH. One match a device; a finished one is cleared, never offered. The save is the
// match's start, every action and the hash after it (what the record sends when the
// match ends, so a resumed match is still recorded once, whole) and the snapshot after
// the last, which comes back through the engine's strict door (`Game.resumeMatch`,
// `restoreChecked`). Storage that is blocked or full never stops play: the save is
// skipped and the match goes on (prefs.js guards every read and write).
import { prefs } from "./prefs.js";

export const SAVE_KEY = "soloMatch";
export const SAVE_VERSION = 1;

// The save for a match being played (game.trail in a solo match), or null.
export function saveOf(game, engine) {
  const t = game.trail;
  if (game.mode !== "match" || t?.kind !== "match" || !t.now) return null;
  if (game.need?.kind === "over") return null;
  return {
    v: SAVE_VERSION,
    engine,
    start: t.start,
    actions: t.actions,
    hashes: t.hashes,
    snap: t.now,
    turn: game.need?.turn ?? null,
    scene: game.viewData?.scene ?? null,
  };
}

export function writeSave(save, store = prefs) {
  if (save) store.set(SAVE_KEY, save);
}

export function clearSave(store = prefs) {
  store.set(SAVE_KEY, null);
}

// The kept match if it can be offered: this version's, on the engine this page plays,
// whole (as many hashes as actions, a snapshot). Anything else is dropped.
export function readSave(engine, store = prefs) {
  const s = store.get(SAVE_KEY, null);
  if (!s) return null;
  const ok =
    s.v === SAVE_VERSION &&
    s.engine === engine &&
    typeof s.start === "string" &&
    typeof s.snap === "string" &&
    Array.isArray(s.actions) &&
    Array.isArray(s.hashes) &&
    s.actions.length === s.hashes.length;
  if (!ok) {
    clearSave(store);
    return null;
  }
  return s;
}

// The resume card's words (cards.js resumeCard).
export const RESUME_WORDS = {
  kicker: "PLAY THE COMPUTER",
  title: "Your match is waiting",
  text: (s, sceneName) => {
    const where = [sceneName, s.turn ? `turn ${s.turn}` : null]
      .filter(Boolean)
      .join(", ");
    return `A match against the computer is kept on this device${where ? ` (${where})` : ""}. Carry on where you left off, or start a new one.`;
  },
  resume: "RESUME",
  fresh: "NEW MATCH",
};
