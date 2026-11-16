// What the browser remembers between visits (localStorage, "kubb:" keys):
// the mute toggle, the level, the solo options, the practice pitch's surface
// and whether HOW TO THROW has been seen. Every read and write is guarded: a
// private window or blocked storage just forgets.
const PREFIX = "kubb:";

export const prefs = {
  get(key, fallback = null) {
    try {
      const text = globalThis.localStorage?.getItem(PREFIX + key);
      return text == null ? fallback : JSON.parse(text);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // storage refused: the setting lasts this visit only
    }
  },
};
