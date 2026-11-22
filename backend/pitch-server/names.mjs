// The generated names' check, without Lua (the engine's docs/NAMES.md section 6, its
// docs/SESSION.md "Names"): the pitch server knows no Kubb, so it checks a name against a
// JSON copy of the engine's own word lists (`names.words`, written into names-words.json
// by tools/names-words.mjs and held to the engine by `npm run check`). The rule is the
// engine's, stated there: a name is valid for a kind when it is a string of at most
// `max[kind]` characters, its words split on single spaces (no empty word), it is not in
// `never`, no word begins with the word before it (ignoring case), and it matches one of
// the kind's shapes: the `prefix` when there is one, then one word from each slot's list.
// The engine's own names for no name (`defaults`: "Computer", "Team A", "Player 1", ...)
// pass a boundary too. tests/pitch-server/names.test.mjs proves this gives the engine's
// answer on every name and on thousands of near misses.
//
//   makeNameCheck(words) -> { valid(kind, text), passes(kind, text), teamPasses(text, n),
//                             hash, version, rules }
//   NAMES                   the check over names-words.json
import WORDS from "./names-words.json" with { type: "json" };

export function makeNameCheck(w) {
  const sets = Object.fromEntries(
    Object.entries(w.lists).map(([k, v]) => [k, new Set(v)]),
  );
  const never = new Set(w.never);
  const defaults = new Set(w.defaults);
  function valid(kind, text) {
    const shapes = w.shapes[kind];
    if (!shapes || typeof text !== "string" || text.length > w.max[kind])
      return false;
    const ws = text.split(" ");
    if (ws.some((x) => x === "") || never.has(text)) return false;
    for (let i = 1; i < ws.length; i++)
      if (ws[i].toLowerCase().startsWith(ws[i - 1].toLowerCase())) return false;
    return shapes.some((s) => {
      const lead = s.prefix === null ? [] : [s.prefix];
      if (ws.length !== lead.length + s.slots.length) return false;
      if (lead.length && ws[0] !== s.prefix) return false;
      return s.slots.every((list, i) => sets[list].has(ws[lead.length + i]));
    });
  }
  const isDefault = (text) => typeof text === "string" && defaults.has(text);
  const passes = (kind, text) => valid(kind, text) || isDefault(text);
  return {
    valid,
    isDefault,
    passes,
    // a team's name: a team name, or on a side of one player, that player's name
    teamPasses: (text, players = 2) =>
      passes("team", text) || (players === 1 && passes("player", text)),
    hash: w.hash,
    version: w.version,
    rules: w.rules,
  };
}

export const NAMES = makeNameCheck(WORDS);
