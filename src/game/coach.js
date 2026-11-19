// The throw's coach line: a few words beside the meter that follow the
// stroke, for a player who is learning, and that answer a tester's question
// (2026-11-19: "Does it matter how quickly or slowly I track my finger") on
// the meter itself, as Jamie asked for the throw's help ("Have the UI show it
// not a separate how to page").
//
// What the engine does (vendor/engine/core/swing.lua, core/throwplan.lua
// plan.launch): the pull back sets the power and its speed does not matter;
// the forward flick must be fast, because a slow one delivers only part of
// that power (the engine's verdict for it is SLOW; a flick at swing.tune
// fullFlickDps or faster delivers all of it); the throw leaves where the
// flick stops. The marks are the meter's own words (HOW TO THROW): the power
// band is the orange mark, the release band the blue mark.
//
// Pure: no DOM, no engine. Drawing only: never fed to the engine, sent or
// recorded. Tested in tests/game/coach.test.mjs.

export const tune = {
  // a device that has made fewer throws than this is coached (the nudge's
  // learnedAt, nudge.js: the same `throwsMade` count)
  learnedAt: 3,
};

export const LINES = {
  rest: "PULL BACK TO THE ORANGE MARK",
  winding: "NO RUSH GOING BACK",
  band: "NOW FLICK FAST AND STOP ON THE BLUE MARK",
  // the lead line for the throw after one the engine called SLOW
  slow: "SLOW FLICK. FLICK FASTER.",
};

// Where the stroke is, from the meter's state (the session's dial state,
// render/dial.js): "rest" before a backswing, "winding" while drawing back
// short of the power band, "band" once the band is reached and through the
// flick.
export function stageOf(dial = {}) {
  const phase = dial.phase ?? "idle";
  if (phase === "swinging") return "band";
  if (phase !== "winding") return "rest";
  const lo = Number.isFinite(dial.powerLo) ? dial.powerLo : Infinity;
  return (dial.back || 0) >= lo ? "band" : "winding";
}

// Was the last throw's flick too slow? verdicts: the HUD's words for this
// player's own throw (throwplan.lua plan.verdictText: power is SLOW).
export const slowVerdict = (verdicts) => verdicts?.power === "SLOW";

// The coach for this frame, or null: { stage, lead, line }. throws: this
// device's throws (capped, prefs throwsMade); slow: the last throw of this
// player's was SLOW.
export function coachFor({ throws = 0, slow = false, dial = {} } = {}) {
  if (!slow && throws >= tune.learnedAt) return null;
  const stage = stageOf(dial);
  return { stage, lead: slow ? LINES.slow : null, line: LINES[stage] };
}
