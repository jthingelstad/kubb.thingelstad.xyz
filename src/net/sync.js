// How a browser keeps its match in step with the room (docs/MULTIPLAYER.md "Staying in
// step"): the engine's rules (vendor/engine/room/sync.lua), thin wrappers over
// `room.<name>`. What stays here is the web's own: which program this is, and how it
// paces its aim casts on the socket.
//
// The acting browser applies its action, then commits the snapshot after it as action
// `seq` with the action riding along (`with`). Every other browser gets the new document
// with `with`, applies the same action to watch the same throw, and then checks its hash
// against the committed one. A gap, a missing `with`, a refused action or a different
// hash: it adopts the committed snapshot instead.
import { roomCall } from "./room-engine.js";

// What to do with a document version that arrived (local = { n, seq }, the match and
// last action this browser holds; w the document's `with`; mine: our own write):
// { kind: "lobby" | "start" | "same" | "old" | "apply" | "adopt", match?, action?, why? }
export const decide = (local, doc, w, mine = false) =>
  roomCall("decide", { local, doc, with: w, mine });

// Which program made a record or a report: `client` in a one-browser match and a
// report, `c` in a rider; and the engine that played it, `engine` and `e`
// (docs/ROOMS.md sections 2.6 and 7).
export const CLIENT = "web";

// The label the engine writes into every game file ("Scored by"): "web 0.1.0".
export const clientLabel = (version) => `${CLIENT} ${version}`;
// The game file's Location line: where the match was played. The iPhone app writes the
// same; the Playdate game keeps the engine's own, "Playdate".
export const LOCATION = "throwingwood.com";

// The `with` for an action, or undefined when it would not fit the room's limit
// (`bytes`, as ASCII JSON): then the others just adopt the snapshot.
export const rider = (n, seq, action, { bytes = 4096, engine = null } = {}) =>
  roomCall("rider", {
    n,
    seq,
    action,
    bytes,
    client: CLIENT,
    engine: engine ?? undefined,
  }) ?? undefined;

// The characters of JSON.stringify(value), each above U+007E counted as 6.
export const asciiSize = (value) => roomCall("asciiSize", { value });

// An aim cast is sent only when it changed (cast limit: 10 a second).
export function aimKey(state) {
  return state ? JSON.stringify(state) : "";
}
