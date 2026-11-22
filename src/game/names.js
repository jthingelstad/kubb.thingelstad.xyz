// Generated names (the engine's docs/NAMES.md, its docs/SESSION.md "Names"): every
// player and team name is made from the engine's word lists, never typed. This is the
// web's door to the engine's `names.*` calls, and the one place a name that arrives from
// outside (a pitch, a kept match, a replay, a share) is checked before it is shown.
//
//   const names = namesOf(engine)      one per engine, kept
//   names.roll(kind, keep?)            { text, parts }: a name from this browser's own
//                                      randomness; keep holds locked words
//   names.step(kind, parts, slot, dir) { text, parts, moved }: the next word in a slot
//   names.choices(kind, parts, slot)   [word, ...]: every word the slot can take
//   names.valid(kind, text)            { ok, default, parts }, kept per text
//   names.passes(kind, text)           ok or default: what a boundary takes
//   names.shown(kind, text, fallback)  text when it passes, else the fallback
//
// kind is "player" or "team". A side of one player is named after that player, so a
// team name there is checked as a player's (teamPasses). Slots are 0-based, parts
// { shape, words }, as the engine has them. A name is kept and sent as its text.

export const KINDS = ["player", "team"];

// The engine's defaults for a name that is missing or dropped (its names.words
// `defaults`): "Player n" for a member, "Team A" / "Team B" for a side.
export const playerDefault = (n) => `Player ${Math.max(1, Math.min(6, n | 0))}`;
export const teamDefault = (side) => `Team ${side === "B" ? "B" : "A"}`;

// A whole-number seed from the browser's own randomness (crypto when it has it).
export function randomSeed() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] & 0x7fffffff;
  }
  return Math.floor(Math.random() * 2 ** 31);
}

const doors = new WeakMap();

export function namesOf(engine) {
  let d = doors.get(engine);
  if (!d) {
    d = new Names(engine);
    doors.set(engine, d);
  }
  return d;
}

export class Names {
  constructor(engine, { seed = randomSeed } = {}) {
    this.engine = engine;
    this.seed = seed;
    this.checked = { player: new Map(), team: new Map() };
  }

  call(name, args) {
    return this.engine.call(`names.${name}`, args);
  }

  roll(kind, keep = null) {
    const args = { kind, seed: this.seed() };
    if (keep) args.keep = keep;
    return this.call("roll", args);
  }

  step(kind, parts, slot, dir = 1) {
    return this.call("step", { kind, parts, slot, dir });
  }

  choices(kind, parts, slot) {
    return this.call("choices", { kind, parts, slot }).words;
  }

  valid(kind, text) {
    if (typeof text !== "string")
      return { ok: false, default: false, parts: null };
    const seen = this.checked[kind];
    let v = seen?.get(text);
    if (!v) {
      v = this.call("valid", { kind, text });
      if (seen.size > 512) seen.clear();
      seen.set(text, v);
    }
    return v;
  }

  passes(kind, text) {
    const v = this.valid(kind, text);
    return !!(v.ok || v.default);
  }

  // A team's name: a team name, or, on a side of one player, that player's name.
  teamPasses(text, players = 2) {
    return (
      this.passes("team", text) ||
      (players === 1 && this.passes("player", text))
    );
  }

  shown(kind, text, fallback) {
    return this.passes(kind, text) ? text : fallback;
  }

  // Every name of a kind (names.all): for measuring, never on a screen.
  all(kind) {
    return this.call("all", { kind }).names;
  }

  words() {
    return this.call("words", {});
  }
}

// The names in a match's options ({ teams: { A: { name, players: [{ name }] } } }, as in
// a snapshot's or a replay's `opts`/`setup`) that do not pass: [] when every one does. A
// match whose names do not pass is not shown (its snapshot is hashed, so its names
// cannot be put right here): src/net/pitch.js, src/replay/player.js.
export function badNames(names, setup) {
  const out = [];
  for (const side of ["A", "B"]) {
    const t = setup?.teams?.[side];
    if (!t) continue;
    const players = Array.isArray(t.players) ? t.players : [];
    if (!names.teamPasses(t.name, players.length)) out.push(t.name);
    for (const p of players)
      if (!names.passes("player", p?.name)) out.push(p?.name);
  }
  return out;
}

// The options inside a snapshot's text, read only (never written back: the text is
// hashed). null when it is not one.
export function setupOfSnapshot(text) {
  try {
    return JSON.parse(text)?.opts ?? null;
  } catch {
    return null;
  }
}

// Telling two members with one name apart in a lobby (docs/NAMES.md section 8): the
// second shows "II", the third "III", by the order given. Never changes a name.
// list: [{ id, name }] -> Map id -> the name as shown.
const NUMERALS = ["", " II", " III", " IV", " V", " VI", " VII", " VIII"];
export function apartNames(list) {
  const seen = new Map();
  const out = new Map();
  for (const { id, name } of list) {
    const k = seen.get(name) ?? 0;
    seen.set(name, k + 1);
    out.set(id, name + (NUMERALS[k] ?? ` ${k + 1}`));
  }
  return out;
}
