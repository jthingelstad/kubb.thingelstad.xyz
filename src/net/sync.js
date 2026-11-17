// How a browser keeps its match in step with the room (docs/MULTIPLAYER.md).
// Pure: tested in tests/net/sync.test.mjs.
//
// The acting browser applies its action, then commits the snapshot after it
// as action `seq` with the action riding along (`with`). Every other browser
// gets the new document with `with`, applies the same action to watch the
// same throw, and then checks its hash against the committed one. A gap, a
// missing `with`, a refused action or a different hash: it adopts the
// committed snapshot instead.

// What to do with a document version that arrived.
//   local = { n, seq }  the match number and the last action number this
//                       browser holds (applied or queued to apply)
//   doc   the room's document; w its `with` (or undefined); mine: our own
// Returns one of:
//   { kind: "lobby" }                       no match running
//   { kind: "start", match }                another match than ours: take it
//   { kind: "same", match }                 the version we hold: compare hashes
//   { kind: "old" }                         older than what we hold
//   { kind: "apply", match, action }        the next action: apply and verify
//   { kind: "adopt", match, why }           take the snapshot as it is
export function decide(local, doc, w, mine = false) {
  const m = doc && doc.started ? doc.match : null;
  if (!m || typeof m.snap !== "string") return { kind: "lobby" };
  if (m.n !== local.n) return { kind: "start", match: m };
  if (m.seq === local.seq) return { kind: "same", match: m };
  if (m.seq < local.seq) return { kind: "old" };
  if (mine) return { kind: "adopt", match: m, why: "own" };
  if (m.seq !== local.seq + 1) return { kind: "adopt", match: m, why: "gap" };
  if (!w || w.n !== m.n || w.seq !== m.seq || !w.a)
    return { kind: "adopt", match: m, why: "no-action" };
  return { kind: "apply", match: m, action: w.a };
}

// Which program made a record or a report: `client` in a one-browser match
// and a report, `c` in a rider; and the engine that played it (its version,
// engine.version): `engine` and `e` (docs/ROOMS.md sections 2.6 and 7).
export const CLIENT = "web";

// The label the engine writes into every game file ("Scored by"): "web 0.1.0".
export const clientLabel = (version) => `${CLIENT} ${version}`;

// The `with` for an action, or undefined when it would not fit the room's
// limit (`bytes`, as ASCII JSON): then the others just adopt the snapshot.
// `c` says this client committed it and `e` on which engine; the recorder
// keeps both with the action.
export function rider(
  n,
  seq,
  action,
  { bytes = 4096, engine = null, size = asciiSize } = {},
) {
  const w = { n, seq, a: action, c: CLIENT };
  if (engine) w.e = engine;
  return size(w) <= bytes - 64 ? w : undefined;
}

export function asciiSize(value) {
  let n = 0;
  for (const c of JSON.stringify(value)) n += c.charCodeAt(0) > 0x7e ? 6 : 1;
  return n;
}

// An aim cast is sent only when it changed (cast limit: 10 a second).
export function aimKey(state) {
  return state ? JSON.stringify(state) : "";
}
