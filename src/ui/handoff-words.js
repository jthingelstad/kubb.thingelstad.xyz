// ---------- the hand-off card's words (the 1.0 design, "Hand-off") ----------
//
// The card is short: a title, one line, one go button. The title is "Your turn"
// when the turn is this browser's own (solo against the computer, or this
// player's on a shared pitch), else the name's ("Lucky Larch’s turn": two
// people sharing a device, a watcher, someone else's turn). The one line says
// what the thrower faces, from the engine's own state (the session's need), in
// plain words: the counts as words up to ten. The design left the line to the
// engine session, which decided it (2026-11-22).

const COUNT = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

// A count in words up to ten, digits past it.
export function countWord(n) {
  return Number.isInteger(n) && n >= 0 && n <= 10 ? COUNT[n] : String(n);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const many = (n, one, more) => `${countWord(n)} ${n === 1 ? one : more}`;

// Every line the card says, in one table: each state's words.
export const HANDOFF_LINES = {
  // a turn of batons: how many, then what stands in the way
  batons: (n) => `${cap(many(n, "baton", "batons"))}.`,
  field: (n) => `${cap(many(n, "field kubb", "field kubbs"))} to clear first.`,
  base: "Aim for the base kubbs.",
  king: "Go for the king.",
  // an inkast: the kubbs to throw into the other half
  inkast: (n) => `Throw ${many(n, "kubb", "kubbs")} into the other half.`,
  // raising by hand
  raise: "Stand your kubbs up.",
  // not in the design's list: placing punishment kubbs (the settle card when
  // there is nothing to raise), in the same plain words
  punish: (n) => `Place ${many(n, "punishment kubb", "punishment kubbs")}.`,
  // not in the design's list: the throw to go (engine 1.4), one baton at the king
  togo: "Throw to go. Closest to the king goes first.",
  togoAgain: "Throw again. Closest to the king goes first.",
};

// A Kid match (engine 0.15, its docs/notes/kid-mode.md): the card's kicker over the
// title, from the need's `kid`. Every kubb and every baton at a kubb is thrown from
// the Kid line, which the pitch marks with a cone at each end; the king shot is from
// the baseline. Nothing here speaks of a punishment or a loss: a Kid match has none.
export const KID_LINES = {
  cones: "Kid match · throw from the cones",
  king: "Kid match · the king from your line",
  plain: "Kid match",
};

// The kicker for a need, or null in a match that is not a Kid match.
export function handoffKid(need) {
  if (!need?.kid) return null;
  if (need.kind !== "throw" || !need.setup) return KID_LINES.plain;
  return need.setup.kingShot ? KID_LINES.king : KID_LINES.cones;
}

// Field kubbs standing in the other half, from the hand-off card's pieces (the
// engine's core/cards.lua handoff: the receiving team's view frame, its own
// baseline at y 0, so the other half is past the centre line at 4 m).
export function fieldToClear(card) {
  const pieces = card?.pieces;
  if (!Array.isArray(pieces)) return 0;
  return pieces.filter((p) => p.kind === "field" && !p.down && p.y > 4).length;
}

// The one line for a need (the session's: { kind, setup, card, ... }), and the
// counts the settle card carries for a raise or punishment (core/cards.lua
// settle: { raise, punish }). Returns { state, text }; state names the row of
// HANDOFF_LINES the line was made from ("batons-field", "batons-base",
// "batons-king", "inkast", "raise", "punish"), or null with no line.
export function handoffLine(need, settle = null) {
  if (!need) return { state: null, text: "" };
  if (need.kind === "raise")
    return { state: "raise", text: HANDOFF_LINES.raise };
  if (need.kind === "punish") {
    const n = settle?.punish > 0 ? settle.punish : 1;
    return { state: "punish", text: HANDOFF_LINES.punish(n) };
  }
  if (need.kind !== "throw" || !need.setup) return { state: null, text: "" };
  const s = need.setup;
  const card = need.card?.handoff || null;
  if (s.kind === "toss" || s.projectile === "kubb") {
    const n = s.of ?? card?.kubbs ?? 0;
    return { state: "inkast", text: HANDOFF_LINES.inkast(n) };
  }
  const n = s.of ?? card?.batons ?? 6;
  const batons = HANDOFF_LINES.batons(n);
  if (s.kingShot)
    return { state: "batons-king", text: `${batons} ${HANDOFF_LINES.king}` };
  const field = fieldToClear(card);
  if (field > 0)
    return {
      state: "batons-field",
      text: `${batons} ${HANDOFF_LINES.field(field)}`,
    };
  return { state: "batons-base", text: `${batons} ${HANDOFF_LINES.base}` };
}

// The card's title: "Your turn" for this browser's own turn, else the name's.
export function handoffTitle(name, mine) {
  if (mine) return "Your turn";
  const n = String(name || "").trim() || "Their";
  if (n === "Their") return "Their turn";
  return `${n}${/s$/i.test(n) ? "’" : "’s"} turn`;
}

// A turn that opens with a computer player (engine 0.17, the hand-off card's
// `throwerCpu`, `throwerLevel`): "Bold Birch throws first · computer · Pro", or null.
const LEVEL = { kid: "Kid", beginner: "Beginner", club: "Club", pro: "Pro" };
export function handoffCpu(card) {
  if (!card?.throwerCpu || !card.thrower) return null;
  const level = LEVEL[card.throwerLevel] ?? card.throwerLevel;
  return `${card.thrower} throws first · computer${level ? ` · ${level}` : ""}`;
}
