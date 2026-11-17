// The door to the room's logic in the engine (vendor/engine/room/, its docs/ROOM.md):
// the shared document's reducers, who acts and how a client stays in step are Lua in
// kubb-engine, the same calls the iPhone app makes, so the two clients cannot drift.
// src/net/lobby.js, seats.js and sync.js are thin wrappers over these calls.
//
//   useRoomEngine(engine)   once, with the page's engine (src/main.js makeEngine);
//                           lobby.js's constants are read from it then
//   roomCall(name, args)    kubbCall("room.<name>", JSON args) -> its `value`
//
// Every call encodes its arguments as JSON and decodes the result, so a call carries
// the whole document when it takes one. They are made when a document arrives or a
// player does something, never per frame: seats.js caches what the render loop asks.
let engine = null;
let calls = 0;

export function setRoomEngine(e) {
  engine = e;
}

export function roomCall(name, args = {}) {
  if (!engine)
    throw new Error(`room.${name}: no engine yet (useRoomEngine first)`);
  calls++;
  return engine.call(`room.${name}`, args).value;
}

// How many room calls this page has made (tests, and the bridge's call rate).
export const roomCallCount = () => calls;
