// The player's own throw level (Beginner, Club or Pro): how much help their
// throw gets. One value on this device, set in MENU (the web's settings) and
// never asked per match (Jamie, 2026-11-20: "Yes this is a device/user
// setting... not a per game setting."), as the iPhone app has it (its
// ThrowLevel.swift). Practice, a match against the computer and a shared pitch
// all throw at it. The engine reads the thrower's level for each throw, so a
// change applies from the player's next throw.
//
// The computer's level is another thing: a match option, "Computer level" on
// the solo card and the lobby (engine 0.9 on), kept as `computer` in the solo
// card's saved options.
//
// Moving a device's older choice across, once, so nobody's level resets: the
// web kept the player's level in the `level` pref (MENU and the lobby wrote
// it, and the solo card's START too), and the solo card's own `level` row set
// both the player and the computer. So the device level is the `level` pref,
// else the solo card's saved level, else Club; and the solo card's saved
// level becomes its computer level when it has none yet.

export const LEVEL_CHOICES = ["beginner", "club", "pro"];
export const FALLBACK = "club";
export const LEVEL_LABELS = { beginner: "Beginner", club: "Club", pro: "Pro" };

const known = (v) => LEVEL_CHOICES.includes(v);

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

// The solo card's saved options with `computer`, moved from its older `level`
// (which then goes: the card no longer sets the player's level).
export function soloOptions(saved) {
  const o = { ...(saved || {}) };
  if (!known(o.computer)) o.computer = known(o.level) ? o.level : FALLBACK;
  delete o.level;
  return o;
}

// What the solo card and the lobby show instead of a picker.
export const levelLine = (level) =>
  `Throwing at ${LEVEL_LABELS[level] || LEVEL_LABELS[FALLBACK]}.`;

// Under MENU's row, where a change waits for the next throw.
export const LEVEL_NOTE = "A change applies from your next throw.";
