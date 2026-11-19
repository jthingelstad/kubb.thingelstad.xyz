// Automatic raising (src/game/auto-raise.js): AUTO ALL for the turn, MENU's
// Raising for the match, one kubb every tune.wait, held under a card.
import test from "node:test";
import assert from "node:assert/strict";
import {
  tune,
  newAutoRaise,
  isOn,
  setGame,
  restOfTurn,
  refused,
  step,
} from "../../src/game/auto-raise.js";

const raise = (n, of = 3, turn = 4) => ({
  phase: "raise",
  need: { kind: "raise", turn, kubb: `k${n}`, n, of },
  modal: 0,
});
// frames until step says raise, or -1 within `max`
function framesUntil(s, st, max = 200) {
  for (let i = 1; i <= max; i++) if (step(s, 1 / 60, st)) return i;
  return -1;
}

test("by hand nothing is raised, and the menu row waits for a first raise", () => {
  const s = newAutoRaise();
  assert.equal(s.seen, false);
  assert.equal(framesUntil(s, raise(1)), -1);
  assert.equal(s.seen, true);
  assert.equal(isOn(s), false);
});

test("AUTO ALL raises each of the turn's kubbs once, tune.wait apart, then ends", () => {
  const s = newAutoRaise();
  restOfTurn(s);
  for (const n of [1, 2, 3]) {
    const f = framesUntil(s, raise(n));
    assert.ok(Math.abs(f / 60 - tune.wait) < 0.06, `kubb ${n}: ${f} frames`);
    // the same kubb is not raised twice while the engine has yet to move on
    assert.equal(framesUntil(s, raise(n), 30), -1);
  }
  // the other side's raising in between does not end it
  step(s, 1 / 60, { phase: "wait", need: { kind: "raise" }, modal: 0 });
  assert.equal(s.turn, true);
  // the throwing does
  step(s, 1 / 60, { phase: "aim", need: { kind: "throw" }, modal: 0 });
  assert.equal(s.turn, false);
  assert.equal(framesUntil(s, raise(1, 2, 6)), -1);
});

test("MENU's Raising lasts for the match and ends with it", () => {
  const s = newAutoRaise();
  setGame(s, true);
  assert.ok(framesUntil(s, raise(1, 1, 4)) > 0);
  step(s, 1 / 60, { phase: "aim", need: { kind: "throw" }, modal: 0 });
  assert.ok(framesUntil(s, raise(1, 2, 6)) > 0, "the next turn too");
  step(s, 1 / 60, { phase: "over", need: null, modal: 0 });
  assert.deepEqual(s, newAutoRaise());
});

test("BY HAND takes both back", () => {
  const s = newAutoRaise();
  restOfTurn(s);
  setGame(s, true);
  setGame(s, false);
  assert.equal(isOn(s), false);
  assert.equal(framesUntil(s, raise(1)), -1);
});

test("an open card or menu holds it, and the wait starts over for a new kubb", () => {
  const s = newAutoRaise();
  setGame(s, true);
  const held = { ...raise(1), modal: 1 };
  assert.equal(framesUntil(s, held, 120), -1);
  assert.ok(framesUntil(s, raise(1)) > 30);
});

test("a raise the engine refuses goes back to the player", () => {
  const s = newAutoRaise();
  setGame(s, true);
  assert.ok(framesUntil(s, raise(1)) > 0);
  refused(s);
  assert.equal(isOn(s), false);
  assert.equal(framesUntil(s, raise(1)), -1);
});
