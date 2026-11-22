// The player's name: a device setting (the owner's settings sheet, 2026-11-20:
// "Your name | Device"), kept on this device as the `name` pref. It is a generated
// name (the engine's docs/NAMES.md; the owner, 2026-11-21: no typed name anywhere):
// the first run rolls one, and the name row (src/ui/name-row.js) in Settings, the solo
// card, the lobby and the share card changes it.
//
// A name kept from before is typed text, not a generated name. It is never shown: on
// load, a kept text that is not a generated player name (names.valid's `ok`; a default
// such as "Player 1" is not one either) is replaced by a rolled name, kept at once. The
// solo card's old `solo.name` is dropped unread.

// names: the engine's door (src/game/names.js): valid(kind, text), roll(kind, keep).
// prefs: { get(key, fallback), set(key, value) } (src/game/prefs.js).

function dropSoloName(prefs) {
  const solo = prefs.get("solo", null);
  if (!solo || typeof solo !== "object" || !("name" in solo)) return;
  const rest = { ...solo };
  delete rest.name;
  prefs.set("solo", rest);
}

// The device's name: the kept one while it is a generated player name, else a new one
// rolled and kept (the first run, or a typed name from before). A kept text that fails
// is rolled afresh, keeping none of its words: on the web no generated name was ever
// kept before this, so a failing text is typed text, and none of it is shown. (The
// engine's docs/SESSION.md "Names" lets a client keep the still-good words of a name
// that lost one for safety; do that once generated names have been kept a while.)
export function loadName(prefs, names) {
  dropSoloName(prefs);
  const kept = prefs.get("name", null);
  if (typeof kept === "string" && names.valid("player", kept).ok) return kept;
  const text = names.roll("player").text;
  prefs.set("name", text);
  return text;
}

// Keeps a generated name on the device; anything else is refused (the kept name stays).
// Returns the name kept.
export function saveName(prefs, names, text) {
  if (typeof text === "string" && names.valid("player", text).ok) {
    prefs.set("name", text);
    return text;
  }
  return loadName(prefs, names);
}
