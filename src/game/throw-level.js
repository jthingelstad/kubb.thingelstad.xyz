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
