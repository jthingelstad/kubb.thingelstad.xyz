// The door to the room's logic in the engine (vendor/engine/room/, its docs/ROOM.md):
// the shared document's reducers, who acts and how a client stays in step are Lua in
// kubb-engine, the same calls the iPhone app makes, so the two clients cannot drift.
// src/net/lobby.js, seats.js and sync.js are thin wrappers over these calls.
//
// A page can hold more than one engine (src/engine/registry.js, docs/ENGINES.md):
// each is registered here under its major.minor, and a call goes to the one it
// names, or to the newest (the one the page plays on) when it names none.
//
//   useRoomEngine(engine)        once, with the page's newest engine (src/main.js
//                                makeEngine); lobby.js's constants are read from it
//   addRoomEngine(engine)        another carried engine, once it is loaded
//   roomCall(name, args, mm?)    kubbCall("room.<name>", JSON args) -> its `value`,
//                                on engine mm (a major.minor), the newest by default
//   roomEngine(mm?)              that engine, or null
//   roomMinor(version)           the major.minor a call for a match of `version`
//                                goes to: its own when registered, else the newest
//
// Every call encodes its arguments as JSON and decodes the result, so a call carries
// the whole document when it takes one. They are made when a document arrives or a
// player does something, never per frame: seats.js caches what the render loop asks.
const engines = new Map(); // major.minor -> engine
let newest = null;
let calls = 0;

const minorOf = (engine) =>
  typeof engine?.version === "string"
    ? engine.version.split(".").slice(0, 2).join(".")
    : "?";

// The page's newest engine: the one calls without a major.minor go to.
export function setRoomEngine(e) {
  newest = minorOf(e);
  engines.set(newest, e);
}

// Another engine the page carries, beside the newest.
export function addRoomEngine(e) {
  const mm = minorOf(e);
  if (!engines.has(mm)) engines.set(mm, e);
  return mm;
}

export const roomEngine = (mm = newest) => engines.get(mm) ?? null;

// A match's own engine when this page has it registered, else the newest.
export function roomMinor(version) {
  const mm =
    typeof version === "string"
      ? (version.match(/^\d+\.\d+/)?.[0] ?? null)
      : null;
  return mm && engines.has(mm) ? mm : newest;
}
export const roomEngineMinor = () => newest;

export function roomCall(name, args = {}, mm = newest) {
  const engine = engines.get(mm);
  if (!engine)
    throw new Error(
      newest
        ? `room.${name}: this page has no engine ${mm}`
        : `room.${name}: no engine yet (useRoomEngine first)`,
    );
  calls++;
  return engine.call(`room.${name}`, args).value;
}

// How many room calls this page has made (tests, and the bridge's call rate).
export const roomCallCount = () => calls;
