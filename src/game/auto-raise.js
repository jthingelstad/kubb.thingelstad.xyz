// Automatic raising, the player's choice while a match raises by hand: AUTO
// ALL on the raise panel stands the rest of this turn's kubbs on the engine's
// choice of end, and REST OF GAME on the panel does it for the rest of the
// match (raising is a match option, so it is not in MENU). Pure: Game calls
// step() every frame and raises when it says so. Nothing here is kept on the device: a match that should
// always raise itself is the match's own Raising option.
import { pacing } from "./pacing.js";

export const tune = {
  wait: pacing.autoRaiseWait, // s a kubb lies before an automatic raise (src/game/pacing.js)
};

// game: for the rest of the match. turn: for the rest of this turn's kubbs.
// seen: this browser has been asked to raise in this match.
export function newAutoRaise() {
  return { game: false, turn: false, seen: false, key: null, wait: 0 };
}

export const isOn = (s) => s.game || s.turn;

// BY HAND and REST OF GAME on the panel.
export function setGame(s, on) {
  s.game = !!on;
  if (!on) s.turn = false;
  s.key = null;
}

// AUTO ALL.
export function restOfTurn(s) {
  s.turn = true;
  s.key = null;
}

// The engine would not raise it: back to the player.
export function refused(s) {
  s.game = false;
  s.turn = false;
}

export function reset(s) {
  Object.assign(s, newAutoRaise());
}

// One frame. phase: Game's ("raise" only when this browser may raise);
// need: the engine's; modal: a card or the menu is open (held then). True
// when the kubb in need should be raised now, once for each kubb.
export function step(s, dt, { phase, need, modal }) {
  if (phase === "over") {
    reset(s);
    return false;
  }
  if (phase !== "raise") {
    // AUTO ALL ends with the turn's raising, not with a wait in it
    if (!need || need.kind !== "raise") s.turn = false;
    s.key = null;
    return false;
  }
  s.seen = true;
  if (!isOn(s) || modal) return false;
  const key = `${need.turn}:${need.kubb}:${need.n}`;
  if (s.key !== key) {
    s.key = key;
    s.wait = tune.wait;
    return false;
  }
  s.wait -= dt;
  if (s.wait > 0) return false;
  s.wait = Infinity;
  return true;
}
