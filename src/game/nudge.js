// The throw's nudge (Jamie, 2026-11-19: "A couple of users have had a lot of
// confusion on how to throw. It would be awesome if we see the user not
// making progress on a throw to animate a nudge in the screen on what to do.
// Have the UI show it not a separate how to page."). A ghost of the knob
// does one good throw on the real meter, with a ghost fingertip showing
// where the finger goes. Pure: no DOM, no engine. The Game feeds the trigger
// what the player does and draws the timeline's frame (src/render/nudge.js).
// It is drawing only: the ghost's arm is never fed to the engine, sent or
// recorded. Tested in tests/game/nudge.test.mjs.

export const tune = {
  // when it starts
  learnedAt: 3, // throws ever made on this device before it counts as learned
  learnCap: 9, // the counter kept in prefs stops here (it only needs to pass learnedAt)
  wait: 8, // s in the aim without touching the meter before a new device is nudged
  idle: 30, // s with no input of any kind before a learned device is nudged
  fumbles: 2, // presses on the meter in a row that made no throw before a nudge
  fumbleDelay: 0.8, // s after the last of those before the nudge starts
  tapResume: 1.5, // s a tap in the throw zone keeps the nudge away (it aims; it is no fumble)
  fadeOut: 0.15, // s the ghost takes to fade when it stops
  // the ghost's throw, one loop
  press: 0.4, // s at home: the fingertip comes down and a ring closes in on it
  back: 0.9, // s drawing back from home to the middle of the back band, eased
  hold: 0.25, // s held at the back: a beat
  flick: 0.25, // s flicking forward to the release band, fast
  release: 0.35, // s at the release: the fingertip lets go, a ring opens out, the ghost fades
  rest: 1.0, // s of nothing between loops
  fadeIn: 0.15, // s the ghost takes to appear at the start of a loop
  // the swing when the meter's state has none (it always does while aiming)
  defaultBack: 120, // degrees back
  defaultRelease: 90, // degrees forward
};

// The loop's length, s.
export function loopLength(tn = tune) {
  return tn.press + tn.back + tn.hold + tn.flick + tn.release + tn.rest;
}

const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const easeIn = (u) => u * u;
const clamp01 = (u) => Math.max(0, Math.min(1, u));

// The swing the ghost makes from the meter's state (the session's dial
// state, render/dial.js): back to the middle of the power band, forward to
// the middle of the release band.
export function swingOf(st = {}, tn = tune) {
  const ok = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > a;
  return {
    back: ok(st.powerLo, st.powerHi)
      ? (st.powerLo + st.powerHi) / 2
      : tn.defaultBack,
    release: ok(st.releaseLo, st.releaseHi)
      ? (st.releaseLo + st.releaseHi) / 2
      : tn.defaultRelease,
  };
}

// The ghost at time t (s since the nudge started) of a swing { back,
// release } (positive degrees). Returns:
//   arm     the ghost's arm, arm degrees (0 home, back negative, forward positive)
//   step    "press" | "back" | "hold" | "flick" | "release" | "rest" | "still"
//   press   0..1, how far down the fingertip is (1: on the glass)
//   ring    null, or { k, a }: the press cue's ring, k of the fingertip's
//           radius and its alpha; it closes in on the press, opens out on
//           the release
//   alpha   0..1, the whole ghost's
// With reduced motion there is no tween: the ghost stands at the back,
// pressed, and the renderer adds the strokes' arrows (step "still").
export function timeline(t, swing, { reduced = false, tn = tune } = {}) {
  const back = -Math.abs(swing.back);
  const fwd = Math.abs(swing.release);
  if (reduced)
    return { arm: back, step: "still", press: 1, ring: null, alpha: 1 };
  const L = loopLength(tn);
  let u = ((t % L) + L) % L;
  const fadeIn = clamp01(u / tn.fadeIn);
  if (u < tn.press) {
    const p = u / tn.press;
    return {
      arm: 0,
      step: "press",
      press: easeInOut(clamp01(p / 0.7)),
      ring: { k: 2.4 - 1.3 * easeInOut(p), a: 0.9 * p },
      alpha: fadeIn,
    };
  }
  u -= tn.press;
  if (u < tn.back) {
    return {
      arm: back * easeInOut(u / tn.back),
      step: "back",
      press: 1,
      ring: null,
      alpha: 1,
    };
  }
  u -= tn.back;
  if (u < tn.hold)
    return { arm: back, step: "hold", press: 1, ring: null, alpha: 1 };
  u -= tn.hold;
  if (u < tn.flick) {
    return {
      arm: back + (fwd - back) * easeIn(u / tn.flick),
      step: "flick",
      press: 1,
      ring: null,
      alpha: 1,
    };
  }
  u -= tn.flick;
  if (u < tn.release) {
    const p = u / tn.release;
    return {
      arm: fwd,
      step: "release",
      press: 1 - easeInOut(clamp01(p / 0.5)),
      ring: { k: 1.1 + 1.6 * easeInOut(p), a: 0.9 * (1 - p) },
      alpha: 1 - easeIn(p),
    };
  }
  return { arm: 0, step: "rest", press: 0, ring: null, alpha: 0 };
}

// The prompt plate's words for a step: the engine's own (WIND BACK, then
// FLICK! once the back band is reached), so the plate follows the ghost.
// The Game maps them to the linear meter's (DRAW BACK, FLING!) as it does
// the engine's. null: leave the plate as the engine has it.
export function captionFor(step) {
  if (step === "hold" || step === "flick" || step === "still") return "FLICK!";
  if (step === "press" || step === "back") return "WIND BACK";
  return null;
}

// When the nudge shows. Fed by the Game:
//   aimBegan()          a throw is wanted (a new aim)
//   input()             any input: a press anywhere, a key, a plan button
//   meterPressed()      a press on the meter, the finger track or a stroke
//                       in the throw zone (stops the nudge)
//   zonePressed()       a press in the throw zone that may yet be a tap (it
//                       stops the nudge; a tap there aims, so it is no fumble)
//   pressEnded(thrown)  a press on the meter ended: with a throw or without
//   step(dt, eligible)  time passing; eligible: this player's own throw to
//                       make, nothing over the pitch, no pointer down
// step returns { show, t, alpha }: whether to draw, the timeline's time and
// the fade (1 while showing, falling to 0 over tune.fadeOut when it stops).
export class NudgeTrigger {
  constructor({ throws = 0, tn = tune } = {}) {
    this.tune = { ...tn }; // tests may shorten it (window.__kubb, test hosts only)
    this.throws = throws; // throws ever made on this device (capped)
    this.fumbles = 0; // presses on the meter in a row with no throw
    this.clock = 0; // s of eligible time: the waits run only while it may show
    this.meterAt = 0; // clock at the aim's start or the last press on the meter
    this.inputAt = 0; // clock at the last input of any kind
    this.endedAt = -Infinity; // clock at the last press that ended with no throw
    this.holdUntil = 0; // clock before which it does not start (a zone tap)
    this.showing = false;
    this.shownAt = 0;
    this.fade = 0;
    this.lastT = 0;
  }

  get learned() {
    return this.throws >= this.tune.learnedAt;
  }

  aimBegan() {
    this.meterAt = this.clock;
    this.inputAt = this.clock;
  }

  input() {
    this.inputAt = this.clock;
  }

  meterPressed() {
    this.input();
    this.meterAt = this.clock;
    this.showing = false;
  }

  zonePressed() {
    this.input();
    this.showing = false;
    this.holdUntil = this.clock + this.tune.tapResume;
  }

  pressEnded(thrown) {
    this.input();
    this.meterAt = this.clock;
    this.showing = false;
    if (thrown) {
      this.fumbles = 0;
      this.endedAt = -Infinity;
      this.throws = Math.min(this.tune.learnCap, this.throws + 1);
    } else {
      this.fumbles++;
      this.endedAt = this.clock;
    }
  }

  // Whether it should start now (eligible time only).
  wanted() {
    const tn = this.tune;
    if (this.clock < this.holdUntil) return false;
    if (
      this.fumbles >= tn.fumbles &&
      this.clock - this.endedAt >= tn.fumbleDelay
    )
      return true;
    if (!this.learned) return this.clock - this.meterAt >= tn.wait;
    return this.clock - this.inputAt >= tn.idle;
  }

  step(dt, eligible) {
    if (!eligible) this.showing = false;
    else {
      this.clock += dt;
      if (!this.showing && this.wanted()) {
        this.showing = true;
        this.shownAt = this.clock;
      }
    }
    if (this.showing) {
      this.fade = 1;
      this.lastT = this.clock - this.shownAt;
    } else this.fade = Math.max(0, this.fade - dt / this.tune.fadeOut);
    return { show: this.fade > 0, t: this.lastT, alpha: this.fade };
  }
}
