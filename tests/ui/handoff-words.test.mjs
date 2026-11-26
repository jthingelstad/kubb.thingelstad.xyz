// The hand-off card's words (src/ui/handoff-words.js; the 1.0 design,
// "Hand-off"): the title, and the one line that says what the thrower faces,
// from the session's need, each state its own words.
import test from "node:test";
import assert from "node:assert/strict";
import {
  countWord,
  fieldToClear,
  handoffLine,
  handoffTitle,
  HANDOFF_LINES,
} from "../../src/ui/handoff-words.js";

// A baton need as the session gives it (its setup and the engine's hand-off
// card, whose pieces are in the receiving team's view frame).
const batons = ({ of = 6, kingShot = false, pieces = [] } = {}) => ({
  kind: "throw",
  setup: { kind: "baton", projectile: "baton", of, kingShot },
  card: { kind: "handoff", handoff: { batons: of, kubbs: 0, pieces } },
});
const field = (y, down = false) => ({ kind: "field", x: 0, y, down });
const base = (y, down = false) => ({ kind: "base", x: 0, y, down });

test("counts are words up to ten, digits past it", () => {
  assert.deepEqual([0, 1, 2, 3, 6, 10, 11].map(countWord), [
    "no",
    "one",
    "two",
    "three",
    "six",
    "ten",
    "11",
  ]);
});

test("a turn of batons with field kubbs to clear first", () => {
  const two = batons({ pieces: [field(6), field(6.5), base(8)] });
  assert.deepEqual(handoffLine(two), {
    state: "batons-field",
    text: "Six batons. Two field kubbs to clear first.",
  });
  const one = batons({ pieces: [field(6), field(5, true), base(8)] });
  assert.equal(
    handoffLine(one).text,
    "Six batons. One field kubb to clear first.",
  );
  // a field kubb in the thrower's own half is not in the way
  assert.equal(fieldToClear({ pieces: [field(2), field(6)] }), 1);
});

test("a turn of batons with no field kubbs standing: the base kubbs", () => {
  assert.deepEqual(handoffLine(batons({ pieces: [base(8), field(6, true)] })), {
    state: "batons-base",
    text: "Six batons. Aim for the base kubbs.",
  });
  // the 2-4-6 opening's first turn
  assert.equal(
    handoffLine(batons({ of: 2 })).text,
    "Two batons. Aim for the base kubbs.",
  );
  assert.equal(
    handoffLine(batons({ of: 1 })).text,
    "One baton. Aim for the base kubbs.",
  );
});

test("every base kubb of the other side down: the king", () => {
  assert.deepEqual(handoffLine(batons({ of: 4, kingShot: true })), {
    state: "batons-king",
    text: "Four batons. Go for the king.",
  });
});

test("an inkast: the kubbs to throw into the other half", () => {
  const toss = (of) => ({
    kind: "throw",
    setup: { kind: "toss", projectile: "kubb", of },
    card: { kind: "handoff", handoff: { batons: 6, kubbs: of } },
  });
  assert.deepEqual(handoffLine(toss(3)), {
    state: "inkast",
    text: "Throw three kubbs into the other half.",
  });
  assert.equal(
    handoffLine(toss(1)).text,
    "Throw one kubb into the other half.",
  );
});

test("a raise by hand, and the punishment kubbs the design's list left out", () => {
  assert.deepEqual(handoffLine({ kind: "raise" }, { raise: 2 }), {
    state: "raise",
    text: "Stand your kubbs up.",
  });
  assert.deepEqual(handoffLine({ kind: "punish" }, { punish: 1 }), {
    state: "punish",
    text: "Place one punishment kubb.",
  });
  assert.equal(
    handoffLine({ kind: "punish" }, { punish: 2 }).text,
    "Place two punishment kubbs.",
  );
  // nothing to say: no line
  assert.deepEqual(handoffLine(null), { state: null, text: "" });
  assert.deepEqual(handoffLine({ kind: "over" }), { state: null, text: "" });
});

test("every line is in the one table", () => {
  assert.deepEqual(Object.keys(HANDOFF_LINES), [
    "batons",
    "field",
    "base",
    "king",
    "inkast",
    "raise",
    "punish",
    "togo",
    "togoAgain",
  ]);
});

test("the title: Your turn, or the name's", () => {
  assert.equal(handoffTitle("Mighty Maple", true), "Your turn");
  assert.equal(handoffTitle("Mighty Maple", false), "Mighty Maple’s turn");
  assert.equal(handoffTitle("North", false), "North’s turn");
  assert.equal(handoffTitle("Lucky Larches", false), "Lucky Larches’ turn");
  assert.equal(handoffTitle("", false), "Their turn");
});
