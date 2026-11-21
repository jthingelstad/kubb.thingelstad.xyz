// The player's name: a device setting (the owner's settings sheet, 2026-11-20:
// "Your name | Device"), typed once and kept on this device as the `name` pref.
// Settings (MENU, and /settings/ from the web game's page) is where it is changed;
// the solo card and the lobby show it, and ask for it only while this device has
// none yet.
//
// Moving a device's older choice across, once: the solo card kept the name in its
// own saved options (`solo.name`, "You" when nothing was typed) and the lobby in
// `name` (falling back to the solo card's). So the device name is `name`, else the
// solo card's when it is not the "You" placeholder, else none.

export const NAME_MAX = 16; // the engine's room.NAME_MAX (room/lobby.lua)
export const PLACEHOLDER = "You"; // the solo card's side when no name is kept

// White space made one space, trimmed, at most NAME_MAX UTF-16 units without
// half a character (the lobby cleans it again with the engine's cleanName).
export function tidyName(text) {
  if (typeof text !== "string") return "";
  const s = text.replace(/\s+/g, " ").trim();
  let out = "";
  for (const ch of s) {
    if (out.length + ch.length > NAME_MAX) break;
    out += ch;
  }
  return out.trim();
}

// The solo card's old name is read once: it leaves the card's saved options as it
// is read, and whenever a name is kept, so a name cleared in Settings stays cleared.
function dropSoloName(prefs) {
  const solo = prefs.get("solo", null);
  if (!solo || typeof solo !== "object" || !("name" in solo)) return;
  const rest = { ...solo };
  delete rest.name;
  prefs.set("solo", rest);
}

// The device's name, moved from the older values when needed and stored; "" for none.
// prefs: { get(key, fallback), set(key, value) } (src/game/prefs.js).
export function loadName(prefs) {
  const own = tidyName(prefs.get("name", null));
  if (own) return own;
  const solo = tidyName(prefs.get("solo", null)?.name);
  dropSoloName(prefs);
  if (solo && solo !== PLACEHOLDER) {
    prefs.set("name", solo);
    return solo;
  }
  return "";
}

// Keeps a name on the device (an empty one forgets it); returns the name kept.
export function saveName(prefs, text) {
  const name = tidyName(text);
  prefs.set("name", name);
  dropSoloName(prefs);
  return name;
}
