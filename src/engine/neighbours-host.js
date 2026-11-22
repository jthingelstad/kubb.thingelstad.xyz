// The Tournament's neighbouring pitches, the engine side (the engine's docs/SESSION.md
// "Neighbours", docs/CLIENTS.md "0.15.1 on top"): a second engine, of its own, that
// plays computer-against-computer matches on the pitches round the player's. It runs in
// a Web Worker (src/engine/neighbours-worker.js) so its work never takes a frame from
// the page; the page side is src/game/neighbours.js. No DOM: Node's tests run it too.
//
//   const handle = neighboursHost({ makeEngine });
//   const reply = await handle(message);   // one reply a message, in order
//
// The messages, each carrying the page's `gen` (the opening they belong to, so an
// answer to a field the page has since closed is dropped there):
//   { type: "open", gen, luaUrl, wasmUrl, args }  -> { type: "opened", gen, text }
//       args: neighbours.open's ({ seed, scene, count, layout, now }); the engine is
//       made on the first open (the same bundle and import shim as the page's,
//       src/engine/index.js, with no tune and no client label) and kept
//   { type: "advance", gen, now, budgetMs }   -> { type: "events", gen, text }
//       neighbours.advance({ now, budgetMs }) (2 ms unless given): now is the match
//       clock in seconds, never going back
//   { type: "view", gen, id }                 -> { type: "view", gen, text }
//   { type: "close", gen }                    -> { type: "closed", gen }
//   anything that fails                       -> { type: "error", gen, message }
// `text` is the engine's own JSON answer, passed on as it came: the page parses it
// once, and its length is the message's size.
import { Engine } from "./index.js";

export const BUDGET_MS = 2;

// The engine a worker makes: the page's bundle, no tune, the host's clock for the
// budget (`__kubbClock`, the engine's docs/SESSION.md "Neighbours": milliseconds).
export async function makeNeighboursEngine({
  sources,
  luaUrl,
  wasmUrl,
  clock = () => performance.now(),
} = {}) {
  const engine = await Engine.create({
    sources: sources ?? luaUrl,
    wasmUrl,
    tune: null,
  });
  engine.lua.global.set("__kubbClock", clock);
  return engine;
}

export function neighboursHost({ makeEngine = makeNeighboursEngine } = {}) {
  let engine = null;
  let making = null;
  let chain = Promise.resolve();
  const answer = async (m) => {
    const gen = m?.gen ?? 0;
    try {
      switch (m?.type) {
        case "open": {
          if (!engine) {
            making ||= makeEngine({ luaUrl: m.luaUrl, wasmUrl: m.wasmUrl });
            engine = await making;
          }
          const text = engine.callText(
            "neighbours.open",
            JSON.stringify(m.args || {}),
          );
          return errorOf(text, gen) || { type: "opened", gen, text };
        }
        case "advance": {
          if (!engine) return { type: "error", gen, message: "not open" };
          const text = engine.callText(
            "neighbours.advance",
            JSON.stringify({ now: m.now, budgetMs: m.budgetMs ?? BUDGET_MS }),
          );
          return errorOf(text, gen) || { type: "events", gen, text };
        }
        case "view": {
          if (!engine) return { type: "error", gen, message: "not open" };
          const text = engine.callText(
            "neighbours.view",
            JSON.stringify(m.id == null ? {} : { id: m.id }),
          );
          return errorOf(text, gen) || { type: "view", gen, text };
        }
        case "close":
          if (engine) engine.callText("neighbours.close", "{}");
          return { type: "closed", gen };
        default:
          return { type: "error", gen, message: `unknown ${m?.type}` };
      }
    } catch (err) {
      return { type: "error", gen, message: String(err?.message || err) };
    }
  };
  // one at a time, in the order they came: an advance never runs inside an open
  return (m) => {
    const next = chain.then(() => answer(m));
    chain = next.catch(() => {});
    return next;
  };
}

function errorOf(text, gen) {
  if (!text.startsWith('{"error":')) return null;
  return { type: "error", gen, message: JSON.parse(text).error };
}
