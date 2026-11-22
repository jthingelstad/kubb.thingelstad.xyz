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
// Since engine 0.9 the engine gives each slider its numbers (`aim.controls`,
// the engine's docs/SESSION.md "The controls": { min, max, value, default,
// tick, step, unit, scope }) and takes any value in the range (setArc,
// setTilt, setSpin; Jamie, 2026-11-20: "more analog allow the slider to select
// any value in a range"). Then the scale is the control's, a mark is drawn at
// every `tick` (a long one at every `step`) and the knob rests wherever it is
// let go. A match on an older engine has no `controls`: the scale is `limits`
// and TILT and SPIN settle on the engine's steps, as before.
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

// ---------- the engine's controls (0.9 on) ----------

// The control a slider shows: ARC's, or a baton's tilt or a kubb's spin; null on
// an engine before 0.9 (no `aim.controls`).
export function controlOf(controls, what, kubb) {
  if (!controls) return null;
  const c =
    what === "arc" ? controls.arc : kubb ? controls.spin : controls.tilt;
  return c && Number.isFinite(c.min) && Number.isFinite(c.max) && c.max > c.min
    ? c
    : null;
}
// ---------- the drive (engine 0.16) ----------
//
// From engine 0.16 a baton's ARC reaches down through flat to a downward drive
// (the engine's docs/notes/throw.md "The drive"): `arc.min` is the throw's floor,
// which moves with the circle and the stance (0 at a kubb a metre away, about 12 at
// 4 m, the knee from about 5 m), and `arc.knee` (15, half past 5) is where the drive
// begins. Under the knee the planned loft falls on a steeper line and the baton does
// not turn end over end. A thrown kubb has no drive: its range starts at the knee.
export const drive = {
  // of the track the part under the knee takes when the floor is 0; less as the floor
  // rises toward the knee, none once it is there. A linear track would give the whole
  // drive (15 degrees of release out of 165) 9% of ARC, too little for a thumb.
  share: 0.3,
  // (the word shows where the part is tall enough for it: game.css hides it in a
  // part under 44 px, so a short part is marked, not named)
  word: "DRIVE",
};

// The knee of an ARC control, or null where it has no drive part (a kubb's, an
// engine before 0.16, or a floor at the knee: nothing under it is offered).
export function kneeOf(c) {
  const k = c?.knee;
  if (!Number.isFinite(k) || !(k > c.min + 1e-6) || !(k < c.max)) return null;
  return k;
}
// The share of the track under the knee (0 when there is none).
export function driveShare(c) {
  const k = kneeOf(c);
  if (k === null) return 0;
  return drive.share * clamp01((k - c.min) / k);
}
// Is this plan a drive (a release under the knee)?
export function isDrive(plan, c) {
  const k = c?.knee;
  return Number.isFinite(k) && Number.isFinite(plan?.release)
    ? plan.release < k - 1e-6
    : false;
}

// The value for a place on the track (0 the bottom or left end, 1 the top or
// right), any value in the range, and a value's place. An ARC with a drive part is
// two straight scales joined at the knee: the floor to the knee on the lowest
// driveShare of the track, the knee to the top on the rest.
export function valueAt(c, f) {
  const u = clamp01(f);
  const kf = driveShare(c);
  if (!(kf > 0)) return c.min + u * (c.max - c.min);
  const k = c.knee;
  return u < kf
    ? c.min + (u / kf) * (k - c.min)
    : k + ((u - kf) / (1 - kf)) * (c.max - k);
}
export function fractionOf(c, v) {
  const x = Math.max(c.min, Math.min(c.max, v ?? c.default ?? c.min));
  const kf = driveShare(c);
  if (!(kf > 0)) return clamp01((x - c.min) / (c.max - c.min));
  const k = c.knee;
  return x < k
    ? clamp01(((x - c.min) / (k - c.min)) * kf)
    : clamp01(kf + ((x - k) / (c.max - k)) * (1 - kf));
}
// The marks: a small one at every tick, a full one at every step, and the long
// heavy one at the middle of a side slider (0) and ARC's normal throw (3
// o'clock), as the step scale has them.
// ARC's marks (engine 0.16) are on the clock's own degrees, every tick from the first
// over the floor, which moves (0, 5, 10 ... a full mark every step from 0), and the
// knee is a mark of its own (`knee`); the ones under it are the drive's (`drive`).
export function controlMarks(c, what) {
  const arc = what === "arc";
  const from = arc ? Math.ceil(c.min / c.tick - 1e-6) * c.tick : c.min;
  const n = Math.floor((c.max - from) / c.tick + 1e-6);
  if (!(n >= 0) || !(c.tick > 0) || n > 200) return [];
  const centre = arc ? limits.releaseNormal : 0;
  const on = (v, by) => Math.abs(v / by - Math.round(v / by)) < 1e-6;
  const knee = arc ? kneeOf(c) : null;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const v = from + i * c.tick;
    const mid = Math.abs(v - centre) < 1e-6;
    const atKnee = knee !== null && Math.abs(v - knee) < 1e-6;
    const m = {
      f: fractionOf(c, v),
      long: mid,
      centre: mid && !arc,
      minor:
        !mid && !atKnee && !(c.step > 0 && on(arc ? v : v - c.min, c.step)),
    };
    if (atKnee) m.knee = true;
    if (knee !== null && v < knee - 1e-6) m.drive = true;
    out.push(m);
  }
  if (knee !== null && !out.some((m) => m.knee))
    out.push({
      f: fractionOf(c, knee),
      long: false,
      centre: false,
      minor: false,
      knee: true,
    });
  return out;
}
// A value as the header shows it: whole degrees, a spin to a tenth of a tap.
function shown(v, kubb) {
  const d = kubb ? 10 : 1;
  const r = Math.round(Math.abs(v) * d) / d;
  return r === 0 ? 0 : r;
}

// The header's words: ARC 32° from the plan's loft; TILT 10R, SPIN 2L,
// TILT 0, and since 0.9 values between the steps: TILT 7R, SPIN 1.3L.
// A drive (engine 0.16, a release under the knee) says so: DRIVE 3°, DRIVE −5° (the
// loft is the launch's, under 0 when the baton leaves the hand going down).
const degrees = (v) => {
  const r = Math.round(v ?? 0);
  return r < 0 ? `\u2212${-r}` : `${r === 0 ? 0 : r}`;
};
export const arcLabel = (plan, c = null) =>
  isDrive(plan, c)
    ? `${drive.word} ${degrees(plan?.loft)}°`
    : `ARC ${Math.round(plan?.loft ?? 0)}°`;
// For a screen reader: "Arc, 32 degrees"; "Arc, 3 degrees, drive"; "Arc, 5 degrees
// down, drive". sep: what follows "Arc" (the plate says "Arc, 32 degrees", the
// slider "Arc 32 degrees").
export function arcValueText(plan, c = null, sep = ", ") {
  const r = Math.round(plan?.loft ?? 0);
  const v = r < 0 ? `${-r} degrees down` : `${r === 0 ? 0 : r} degrees`;
  return `Arc${sep}${v}${isDrive(plan, c) ? ", drive" : ""}`;
}
const sideOf = (plan, kubb, c) =>
  c ? c.value || 0 : kubb ? plan?.spin || 0 : plan?.tilt || 0;
export function sideLabel(plan, kubb, c = null) {
  const v = sideOf(plan, kubb, c);
  const word = kubb ? "SPIN" : "TILT";
  const a = c ? shown(v, kubb) : Math.abs(Math.round(v));
  if (a === 0) return `${word} 0`;
  return `${word} ${a}${v < 0 ? "L" : "R"}`;
}
// For a screen reader: "Tilt 10 degrees right", "Spin 2 left", "Tilt none".
export function sideValueText(plan, kubb, c = null) {
  const raw = sideOf(plan, kubb, c);
  const a = c ? shown(raw, kubb) : Math.abs(Math.round(raw));
  const word = kubb ? "Spin" : "Tilt";
  if (a === 0) return `${word} none`;
  const dir = raw < 0 ? "left" : "right";
  return kubb ? `${word} ${a} ${dir}` : `${word} ${a} degrees ${dir}`;
}

// What the held slider does, in a line shown while it is held and through
// the side view's peek after (hud.js): the same words as the iPhone's. A
// tester, 2026-11-19: "I can't tell what tilt does at all", and no word on
// how arc and tilt affect the toss; Jamie: "Have the UI show it not a
// separate how to page". The HUD sets them in capitals, as its chips are.
// From engine 0.16 a baton's lower arc drives in (the owner, 2026-11-22: "A real
// player would throw hard at a tight group this close"): the baton's caption says
// what a lower arc does now, and under the knee what a drive is. A kubb has no
// drive and keeps its words.
export const CAPTIONS = {
  arc: "A higher arc drops in steeper. A lower arc drives in harder.",
  drive: "A drive goes in low and hard, with no flip.",
  kubbArc: "A higher arc drops in steeper. A lower one skids in.",
  tilt: "Tilt leans the baton to steer it through a group.",
  spin: "Spin keeps a drilled kubb steady in the air.",
};

// The caption for a held slider (what: "arc" | "side"), or null. plan and c (the
// ARC control): a baton's plan under the knee is a drive.
export function captionOf(what, kubb, plan = null, c = null) {
  if (what === "arc") {
    if (kubb) return { key: "arc", text: CAPTIONS.kubbArc };
    if (isDrive(plan, c)) return { key: "drive", text: CAPTIONS.drive };
    return { key: "arc", text: CAPTIONS.arc };
  }
  if (what === "side")
    return kubb
      ? { key: "spin", text: CAPTIONS.spin }
      : { key: "tilt", text: CAPTIONS.tilt };
  return null;
}

// The lean of the caption's baton for a plan: its tilt in degrees, right
// positive, kept to the engine's range.
export function leanOf(plan) {
  const t = plan?.tilt || 0;
  return Math.max(-limits.tiltMax, Math.min(limits.tiltMax, t));
}

// A slider. what: "arc" | "side"; onSlide(what, f, phase) with phase
// "down", "move" or "up" and f the place on the track (0..1, bottom to top
// or left to right), or "cancel" when the hold ends without a release;
// onKey(what, step, fine) for the arrow keys (fine: an arrow, a tick where the
// engine has ticks; PageUp and PageDown a step; Home and End the range's ends).
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
          `div.slider-tick${m.long ? ".long" : ""}${m.centre ? ".centre" : ""}${m.minor ? ".minor" : ""}${m.knee ? ".knee" : ""}${m.drive ? ".drive" : ""}`,
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
      // Home and End: the ends of its range, as a slider's keys are
      if (e.code === "Home" || e.code === "End") {
        e.preventDefault();
        e.stopPropagation();
        const f = e.code === "Home" ? 0 : 1;
        if (this.onSlide(this.what, f, "down") !== false)
          this.onSlide(this.what, f, "up");
        return;
      }
      let step = 0;
      if (e.code === up || e.code === "PageUp") step = 1;
      else if (e.code === down || e.code === "PageDown") step = -1;
      else return;
      e.preventDefault();
      e.stopPropagation();
      this.onKey(this.what, step, !e.code.startsWith("Page"));
    });
  }

  // ARC's drive part (engine 0.16): the track under the knee tinted and named DRIVE,
  // from the floor the engine gives this frame; none where the floor is the knee.
  driveZone(c) {
    const kf = driveShare(c);
    const k = kneeOf(c);
    const named = kf > 0 && k > c.min;
    this.set("drive", `${Math.round(kf * 1000)}:${named}`, () => {
      if (!(kf > 0)) {
        this.zone?.remove();
        this.zone = null;
        this.el.classList.remove("drives");
        return;
      }
      if (!this.zone) {
        this.zone = h("div.slider-drive", h("span.slider-drive-word"));
        this.run.insertBefore(this.zone, this.run.firstChild);
      }
      this.zone.firstChild.textContent = named ? drive.word : "";
      this.zone.style.setProperty(
        "--knee",
        String(Math.round(kf * 1000) / 1000),
      );
      this.el.classList.add("drives");
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

  // Each frame the plans show: plan is the engine's aim.plan, controls its
  // aim.controls (engine 0.9 on; null before).
  update(plan, kubb, controls = null) {
    const c = controlOf(controls, this.what, kubb);
    if (c) return this.updateControl(plan, kubb, c);
    this.set("scale", "steps", () =>
      this.vertical ? this.marks(this.arcMarks()) : this.cache.delete("kind"),
    );
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

  // The engine's own control: its range and marks, the knob where the value is,
  // under the finger while held. A kubb's spin kept for the turn (scope "turn")
  // is the value the engine gives for the next kubb, so it shows as it is.
  updateControl(plan, kubb, c) {
    const what = this.vertical ? "arc" : kubb ? "spin" : "tilt";
    // the floor moves with the circle and the stance (engine 0.16): the marks follow
    // it to a tenth of a degree
    const lo = Math.round(c.min * 10) / 10;
    this.set(
      "scale",
      `${what}:${lo}:${c.max}:${c.tick}:${c.step}:${c.knee}`,
      () => {
        this.cache.delete("kind");
        this.marks(controlMarks(c, this.vertical ? "arc" : "side"));
      },
    );
    const f = this.drag ? this.drag.f : fractionOf(c, c.value);
    const d = !this.vertical && kubb ? 10 : 1;
    const round = (v) => Math.round(v * d) / d;
    this.set(
      "text",
      this.vertical ? arcLabel(plan, c) : sideLabel(plan, kubb, c),
      (t) => (this.head.textContent = t),
    );
    if (this.vertical) this.driveZone(c);
    this.set("f", Math.round(f * 1000) / 1000, (v) =>
      this.el.style.setProperty("--f", String(v)),
    );
    const label = this.vertical ? "Arc" : kubb ? "Spin" : "Tilt";
    this.set("label", label, (v) => this.el.setAttribute("aria-label", v));
    this.set("min", round(c.min), (v) =>
      this.el.setAttribute("aria-valuemin", v),
    );
    this.set("max", round(c.max), (v) =>
      this.el.setAttribute("aria-valuemax", v),
    );
    this.set("now", round(c.value ?? c.default ?? 0), (v) =>
      this.el.setAttribute("aria-valuenow", v),
    );
    this.set(
      "vt",
      this.vertical ? arcValueText(plan, c, " ") : sideValueText(plan, kubb, c),
      (v) => this.el.setAttribute("aria-valuetext", v),
    );
  }
}
