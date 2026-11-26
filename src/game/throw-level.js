// The player's own throw level (Beginner, Club or Pro). From Kubb Engine 0.13 a
// level is the computer's standard only: every person throws on one meter, the
// bars going by the throw's distance (the engine's docs/notes/throw.md "The
// person's meter"; the owner, 2026-11-21: "player level really should only mean
// for the computer opponent"). So the web no longer asks for it: MENU's Your
// level row and the solo card's and lobby's "Throwing at ..." line are gone.
//
// The value is still read, passed and kept, never reset: the engine takes it and
// keeps it (the view's plan.level, a player's level in a start), a shared pitch's
// presence carries it (`me.level`), and a match on a carried engine before 0.13
// (a pitch with an iPhone still on 0.9, a replay of a 0.9 match) throws a person
// at it, as it always did. A device keeps the level it last chose; one that never
// chose throws at Club.
//
// The computer's level is another thing: a match option, "Computer level" on
// the solo card and the lobby (engine 0.9 on), kept as `computer` in the solo
// card's saved options.
//
// Moving a device's older choice across, once: the web kept the player's level
// in the `level` pref (MENU and the lobby wrote it, and the solo card's START
// too), and the solo card's own `level` row set both the player and the
// computer. So the device level is the `level` pref, else the solo card's saved
// level, else Club; and the solo card's saved level becomes its computer level
// when it has none yet.

export const LEVEL_CHOICES = ["beginner", "club", "pro"];
// The computer's levels: Kid first since engine 0.15 (a Kid match: the engine's
// docs/notes/kid-mode.md), then the three. Kid is the computer's only, never a
// person's own level.
export const COMPUTER_CHOICES = ["kid", ...LEVEL_CHOICES];
export const FALLBACK = "club";

const known = (v) => LEVEL_CHOICES.includes(v);
const knownComputer = (v) => COMPUTER_CHOICES.includes(v);

// The device's level, moved from the older values when needed and stored.
// prefs: { get(key, fallback), set(key, value) } (src/game/prefs.js).
export function loadThrowLevel(prefs) {
  const own = prefs.get("level", null);
  if (known(own)) return own;
  const solo = prefs.get("solo", null);
  const v = known(solo?.level) ? solo.level : FALLBACK;
  prefs.set("level", v);
  return v;
}

// The solo card's saved options with `computer` (a kept "kid" stays Kid), moved from
// its older `level` (which then goes: the card no longer sets the player's level).
export function soloOptions(saved) {
  const o = { ...(saved || {}) };
  if (!knownComputer(o.computer))
    o.computer = known(o.level) ? o.level : FALLBACK;
  delete o.level;
  return o;
}

// A person's throw (engine 1.3 on; the engine's docs/SESSION.md "A person's throw
// level"): the meter they throw on, Easy, Standard or Hard. The levels differ only in
// how wide the meter's bars are, never in luck. It is the device's (the `throw` pref,
// Standard until picked): Settings and MENU, the solo card and the lobby pick it; the
// solo match's and practice's player entries carry it, and a shared pitch hears it as
// `me.throw`. A match on an engine before 1.3 (the iPhone's 1.0 on a mixed pitch) has
// no such thing, and the rows that pick it are not shown there. The older `level` pref
// above is a separate, older value and is left as it was.
export const THROWS = [
  ["easy", "Easy"],
  ["standard", "Standard"],
  ["hard", "Hard"],
];
export const THROW_WORD = Object.fromEntries(THROWS);
export const THROW_DEFAULT = "standard";
export const THROW_NOTE =
  "Easy has wider bars on the meter. Hard has narrow ones.";
const knownThrow = (v) => THROWS.some(([k]) => k === v);

export function loadThrow(prefs) {
  const v = prefs.get("throw", null);
  return knownThrow(v) ? v : THROW_DEFAULT;
}

export function saveThrow(prefs, v) {
  const t = knownThrow(v) ? v : THROW_DEFAULT;
  prefs.set("throw", t);
  return t;
}

// A player entry's `throw`, for an engine that takes one (constants.THROW_LEVELS):
// nothing for Standard, which the engine does not keep either.
export const throwEntry = (t, takes = true) =>
  takes && knownThrow(t) && t !== THROW_DEFAULT ? { throw: t } : {};
