// The plan's two sliders beside the meter: ARC (vertical, up is a higher
// arc, continuous) and TILT for a baton or SPIN for a kubb (horizontal, 0 in
// the middle, detents at the engine's steps). They replace the four step
// buttons the web carried over from the Playdate's "hold B and press the
// d-pad" (Jamie, 2026-11-19: "I'd like to make arc and tilt less buttons and
// more a slider with continuous movement ... It is all a hangover from us
// starting on play date").
//
// Each is a plate in the game's look: a wooden header with the value
// (ARC 32°, TILT 10R) above the body, and in the body a lane of scale marks
// beside the ink slot the wooden knob runs in. The header and the lane sit
// where the finger is not: above the track, and on the side of it away from
// the thumb, so the value reads while it is dragged. The whole body takes the
// press: a press anywhere jumps the knob there and keeps dragging.
//
// The pure part (the scale both ways) is exported for tests; PlanSlider is
// the DOM and the pointer. The game decides what a drag does (game.js
// planSlide): the engine is called at most once a frame.
import { h } from "../ui/dom.js";

// The engine's plan limits (vendor/engine/core/throwplan.lua plan.tune):
// the planned release on the clock, 15 to 165 (half past 5 to half past 12);
// a baton's tilt in steps of 5 to 20 either way; a kubb's spin in steps of
// 1 to 3 either way. The engine clamps; these only lay out the scale.
export const limits = {
  releaseMin: 15,
  releaseMax: 165,
  releaseNormal: 90, // 3 o'clock: the normal throw (loft 32)
  tiltStep: 5,
  tiltMax: 20,
  spinMax: 3,
};

const clamp01 = (f) => Math.max(0, Math.min(1, f));

// ARC: the release for a place on the track (0 the bottom, 1 the top) and
// back.
export function releaseAt(f) {
  const { releaseMin: lo, releaseMax: hi } = limits;
  return lo + clamp01(f) * (hi - lo);
}
export function arcFraction(release) {
  const { releaseMin: lo, releaseMax: hi } = limits;
  return clamp01(((release ?? limits.releaseNormal) - lo) / (hi - lo));
}

// TILT or SPIN: the side's steps either way (4 for a baton, 3 for a kubb),
// the nearest step for a place on the track (0 the left end, 1 the right),
// and a value's place.
export const sideSteps = (kubb) =>
  kubb ? limits.spinMax : limits.tiltMax / limits.tiltStep;
export function sideStepAt(f, kubb) {
  const n = sideSteps(kubb);
  return Math.round((clamp01(f) * 2 - 1) * n);
}
// the value in steps: a baton's tilt is in degrees, a kubb's spin in steps
export const sideStepOf = (plan, kubb) =>
  kubb
    ? Math.round(plan?.spin || 0)
    : Math.round((plan?.tilt || 0) / limits.tiltStep);
export function sideFraction(step, kubb) {
  const n = sideSteps(kubb);
  return clamp01((step / n + 1) / 2);
}

// The header's words: ARC 32° from the plan's loft; TILT 10R, SPIN 2L,
// TILT 0.
export const arcLabel = (plan) => `ARC ${Math.round(plan?.loft ?? 0)}°`;
export function sideLabel(plan, kubb) {
  const v = kubb ? plan?.spin || 0 : plan?.tilt || 0;
  const word = kubb ? "SPIN" : "TILT";
  if (Math.round(v) === 0) return `${word} 0`;
  return `${word} ${Math.abs(Math.round(v))}${v < 0 ? "L" : "R"}`;
}
// For a screen reader: "Tilt 10 degrees right", "Spin 2 left", "straight".
export function sideValueText(plan, kubb) {
  const v = Math.round(kubb ? plan?.spin || 0 : plan?.tilt || 0);
  const word = kubb ? "Spin" : "Tilt";
  if (v === 0) return `${word} none`;
  const dir = v < 0 ? "left" : "right";
  return kubb
    ? `${word} ${Math.abs(v)} ${dir}`
    : `${word} ${Math.abs(v)} degrees ${dir}`;
}

// A slider. what: "arc" | "side"; onSlide(what, f, phase) with phase
// "down", "move" or "up" and f the place on the track (0..1, bottom to top
// or left to right), or "cancel" when the hold ends without a release;
// onKey(what, step) for the arrow keys.
export class PlanSlider {
  constructor(what, { onSlide, onKey }) {
    this.what = what;
    this.vertical = what === "arc";
    this.onSlide = onSlide;
    this.onKey = onKey;
    this.cache = new Map();
    this.drag = null; // { id, f } while a pointer holds it
    this.head = h("div.slider-head");
    this.lane = h("div.slider-lane");
    this.stem = h("div.slider-stem");
    this.knob = h("div.slider-knob");
    this.index = h("div.slider-index");
    this.run = h(
      "div.slider-run",
      h("div.slider-slot"),
      this.stem,
      this.lane,
      this.index,
      this.knob,
    );
    this.body = h("div.slider-body", this.run);
    this.el = h(
      `div.slider.${this.vertical ? "vertical" : "horizontal"}.${what}`,
      {
        role: "slider",
        tabindex: "0",
        "aria-orientation": this.vertical ? "vertical" : "horizontal",
        "data-test": what === "arc" ? "arc" : "side",
      },
      this.head,
      this.body,
    );
    if (this.vertical) this.marks(this.arcMarks());
    this.bind();
  }

  // ARC's marks: every hour of the release on the clock (1 to 5), the
  // normal throw's at 3 o'clock long
  arcMarks() {
    const out = [];
    for (let r = 30; r <= 150; r += 30)
      out.push({ f: arcFraction(r), long: r === limits.releaseNormal });
    return out;
  }

  // TILT or SPIN's marks: one a detent, the middle long and heavy
  sideMarks(kubb) {
    const n = sideSteps(kubb);
    const out = [];
    for (let i = -n; i <= n; i++)
      out.push({ f: sideFraction(i, kubb), long: i === 0, centre: i === 0 });
    return out;
  }

  marks(list) {
    this.lane.replaceChildren(
      ...list.map((m) => {
        const t = h(
          `div.slider-tick${m.long ? ".long" : ""}${m.centre ? ".centre" : ""}`,
        );
        t.style.setProperty("--at", String(m.f));
        return t;
      }),
    );
  }

  set(key, value, fn) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    fn(value);
  }

  // The place on the track for a pointer at clientX/Y.
  fractionAt(e) {
    const r = this.run.getBoundingClientRect();
    if (this.vertical) return clamp01((r.bottom - e.clientY) / (r.height || 1));
    return clamp01((e.clientX - r.left) / (r.width || 1));
  }

  bind() {
    const body = this.body;
    body.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      const f = this.fractionAt(e);
      if (this.onSlide(this.what, f, "down") === false) return;
      this.drag = { id: e.pointerId, f };
      try {
        body.setPointerCapture(e.pointerId);
      } catch {}
      this.el.classList.add("held");
    });
    body.addEventListener("pointermove", (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag.f = this.fractionAt(e);
      this.onSlide(this.what, this.drag.f, "move");
    });
    const end = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const f = this.drag.f;
      this.drag = null;
      this.el.classList.remove("held");
      this.onSlide(this.what, f, "up");
    };
    body.addEventListener("pointerup", end);
    body.addEventListener("pointercancel", end);
    body.addEventListener("lostpointercapture", end);
    // the arrow keys while it has the focus (they would move the target
    // circle otherwise): a step, as R/F and Q/E
    this.el.addEventListener("keydown", (e) => {
      const up = this.vertical ? "ArrowUp" : "ArrowRight";
      const down = this.vertical ? "ArrowDown" : "ArrowLeft";
      let step = 0;
      if (e.code === up || e.code === "PageUp") step = 1;
      else if (e.code === down || e.code === "PageDown") step = -1;
      else return;
      e.preventDefault();
      e.stopPropagation();
      this.onKey(this.what, step);
    });
  }

  // The slider is hidden while it is held (MENU opened with another finger,
  // a throw began): the hold ends here and the game is told, so its side
  // view does not wait for a release that will be ignored.
  cancel() {
    if (!this.drag) return;
    this.drag = null;
    this.el.classList.remove("held");
    this.onSlide(this.what, 0, "cancel");
  }

  // Each frame the plans show: plan is the engine's aim.plan.
  update(plan, kubb) {
    let f, text, now, min, max, label, valueText;
    if (this.vertical) {
      f = arcFraction(plan?.release);
      text = arcLabel(plan);
      now = Math.round(plan?.release ?? limits.releaseNormal);
      min = limits.releaseMin;
      max = limits.releaseMax;
      label = "Arc";
      valueText = `Arc ${Math.round(plan?.loft ?? 0)} degrees`;
    } else {
      const step = sideStepOf(plan, kubb);
      // the knob follows the finger while it is held, and settles on the
      // engine's detent when let go (a short ease in game.css)
      f = this.drag ? this.drag.f : sideFraction(step, kubb);
      text = sideLabel(plan, kubb);
      now = kubb ? step : step * limits.tiltStep;
      max = kubb ? limits.spinMax : limits.tiltMax;
      min = -max;
      label = kubb ? "Spin" : "Tilt";
      valueText = sideValueText(plan, kubb);
      this.set("kind", kubb, (k) => this.marks(this.sideMarks(k)));
    }
    this.set("text", text, (t) => (this.head.textContent = t));
    this.set("f", Math.round(f * 1000) / 1000, (v) =>
      this.el.style.setProperty("--f", String(v)),
    );
    this.set("label", label, (v) => this.el.setAttribute("aria-label", v));
    this.set("min", min, (v) => this.el.setAttribute("aria-valuemin", v));
    this.set("max", max, (v) => this.el.setAttribute("aria-valuemax", v));
    this.set("now", now, (v) => this.el.setAttribute("aria-valuenow", v));
    this.set("vt", valueText, (v) => this.el.setAttribute("aria-valuetext", v));
  }
}
