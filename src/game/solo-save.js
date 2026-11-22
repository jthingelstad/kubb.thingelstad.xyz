// A match against the computer, kept on the device after every action (QA, 2026-11-22;
// the iPhone app keeps its own the same way, its docs/MATCH.md "Saving"): reloading the
// page, or opening PLAY NOW or the solo link again, offers it back with RESUME and NEW
// MATCH. The save is the match's start, every action and the hash after it and the
// snapshot after the last, which comes back through the engine's strict door
// (`Game.resumeMatch`, `restoreChecked`). Storage that is blocked or full never stops
// play: the save is skipped and the match goes on (prefs.js guards every read and write).
//
// Every save and every record waiting to be sent carries the match's identity (`id`, its
// seed and start, matchId), and every step that clears or marks one checks it, so one
// match never clears or marks another's (Codex on #117: a REMATCH made while the last
// match's record was still on its way had its save cleared, or marked over).
//
// One kept match a device, the newest wins: a match claims the slot when it starts or is
// resumed (claim), and after that writes only while the slot is still its own, its own
// tab's or empty (a save names the tab that wrote it, `tab`, a random id a page load).
// A match in another tab that finds the slot taken stops being kept and is told once
// (main.js startSolo). A match being played holds a lock on its id (match-lock.js), so
// another tab never offers it for RESUME, nor sends its record, while it is live there.
//
// A finished match's record is kept apart (`soloPending`, by id: the message as sent)
// until the api has kept it, so a REMATCH, a reload or a closed tab never loses it nor
// sends it twice from here: it is tried when the match ends and once more on a later
// load (`tries` is counted before each send, so a send cut off by leaving the page
// counts), then dropped with a warning.
import { prefs } from "./prefs.js";

export const SAVE_KEY = "soloMatch";
export const PENDING_KEY = "soloPending";
export const SAVE_VERSION = 1;
export const RECORD_TRIES = 2;

// A match's identity from its first snapshot: the seed and the start, which no two
// matches share.
export function matchId(startText) {
  try {
    const o = JSON.parse(startText)?.opts;
    const s = o?.start;
    if (!o || o.seed == null || !s) return null;
    return `${o.seed}@${s.year}-${s.month}-${s.day}T${s.hour}:${s.min}`;
  } catch {
    return null;
  }
}

// The save for a match (game.trail in a solo match), or null. It is written as each
// action is tracked, before its throw plays, so the page's need may still be the one
// before: whether the match is over is the engine's (`over`), and a match that is over
// is kept until its end is shown (main.js startSolo).
export function saveOf(game, engine) {
  const t = game.trail;
  if (game.mode !== "match" || t?.kind !== "match" || !t.now) return null;
  const id = matchId(t.start);
  if (!id) return null;
  let over = false;
  try {
    over = game.engine.need()?.kind === "over";
  } catch {
    over = game.need?.kind === "over";
  }
  return {
    v: SAVE_VERSION,
    id,
    over,
    engine,
    start: t.start,
    actions: t.actions,
    hashes: t.hashes,
    snap: t.now,
    turn: game.need?.turn ?? null,
    scene: game.viewData?.scene ?? null,
  };
}

// Write `save` (as tab `tab`'s) unless the slot holds another tab's other match and this
// is not a claim. A tab's own earlier match it may always replace. Returns whether it
// was written.
export function keepSave(
  save,
  { claim = false, tab = null } = {},
  store = prefs,
) {
  if (!save) return false;
  const cur = store.get(SAVE_KEY, null);
  const mine =
    !cur?.id || cur.id === save.id || (tab != null && cur.tab === tab);
  if (!claim && !mine) return false;
  store.set(SAVE_KEY, tab != null ? { ...save, tab } : save);
  return true;
}

// Clear the slot if it holds match `id` (any match with no id: the save is being dropped).
export function clearSave(id = null, store = prefs) {
  if (id != null) {
    const cur = store.get(SAVE_KEY, null);
    if (cur && cur.id !== id) return false;
  }
  store.set(SAVE_KEY, null);
  return true;
}

// The kept match if it can be offered: this version's, on the engine this page plays,
// whole (as many hashes as actions, a snapshot, an id). Anything else is dropped.
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
    s.actions.length === s.hashes.length &&
    s.id === matchId(s.start);
  if (!ok) {
    clearSave(null, store);
    return null;
  }
  return s;
}

// ---------- records waiting to be sent ----------

const pendingMap = (store) => {
  const m = store.get(PENDING_KEY, null);
  return m && typeof m === "object" ? m : {};
};

export function pendingRecords(store = prefs) {
  return Object.entries(pendingMap(store)).map(([id, p]) => ({ id, ...p }));
}

// A record about to be sent: kept with its try counted first.
export function addPending(id, message, store = prefs) {
  const m = pendingMap(store);
  m[id] = { message, tries: (m[id]?.tries ?? 0) + 1 };
  store.set(PENDING_KEY, m);
  return m[id].tries;
}

export function dropPending(id, store = prefs) {
  const m = pendingMap(store);
  if (!(id in m)) return;
  delete m[id];
  store.set(PENDING_KEY, m);
}

// The resume card's words (cards.js resume).
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

// A match in another tab, told once when it finds the slot taken by a newer one.
export const YIELD_WORDS = {
  kicker: "PLAY THE COMPUTER",
  title: "Kept in another tab",
  text: "A newer match against the computer, in another tab, is the one kept on this device now. This match plays on, but a reload will not bring it back.",
  back: "BACK TO THE MATCH",
};
