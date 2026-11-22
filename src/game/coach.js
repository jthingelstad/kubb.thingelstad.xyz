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
// flick stops. The marks are named by their shape, not their colour (the 1.0
// design, the owner's decision of 2026-11-21, with the iPhone's Coach.swift):
// the power band is "the stripes", the release band "the solid mark".
//
// Pure: no DOM, no engine. Drawing only: never fed to the engine, sent or
// recorded. Tested in tests/game/coach.test.mjs.

export const tune = {
  // a device that has made fewer throws than this is coached (the nudge's
  // learnedAt, nudge.js: the same `throwsMade` count)
  learnedAt: 3,
};

export const LINES = {
  rest: "PULL BACK TO THE STRIPES",
  winding: "NO RUSH GOING BACK",
  band: "NOW FLICK FAST AND STOP ON THE SOLID MARK",
  // the lead line for the throw after one the engine called SLOW
  slow: "SLOW FLICK. FLICK FASTER.",
  // the lead line for the throw after a drive (engine 0.16: a release under ARC's
  // knee) the engine called SHORT: a drive is planned hard, so its stripes are far
  // round (a backswing of about 128 to 131 at 3 to 4 m) and a short one fell under them
  driveShort: "A DRIVE NEEDS MORE POWER.",
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

// Was the last throw a drive that fell SHORT (its power under the band)? drive: it
// was planned under ARC's knee (plan-sliders.js isDrive).
export const shortDrive = (verdicts, drive) =>
  !!drive && verdicts?.power === "SHORT";

// The coach for this frame, or null: { stage, lead, line }. throws: this
// device's throws (capped, prefs throwsMade); slow: the last throw of this
// player's was SLOW; short: it was a drive that fell SHORT (slow wins: a slow
// flick is the first thing to mend).
export function coachFor({
  throws = 0,
  slow = false,
  short = false,
  dial = {},
} = {}) {
  if (!slow && !short && throws >= tune.learnedAt) return null;
  const stage = stageOf(dial);
  const lead = slow ? LINES.slow : short ? LINES.driveShort : null;
  return { stage, lead, line: LINES[stage] };
}
