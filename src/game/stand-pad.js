// STAND: where the thrower stands, as one control that shows it. It replaces
// WALK, a mode switch carried over from the Playdate's held A (Jamie,
// 2026-11-19: "Can you audit the control surface from a broader level that
// would catch these type of odd engagements. It is all a hangover from us
// starting on play date"). While WALK was on, a drag on the pitch walked the
// thrower like a joystick; the press meant something else depending on a
// button pressed before it.
//
// The thrower's own spot is never on the screen in the thrower's view (the
// camera stands behind it: the stance projects about 180 px below a phone's
// bottom edge and 1500 px below a desktop's), so there is nothing on the
// pitch to take hold of. STAND is a small plate beside the plan instead: the
// throwing line seen from above, the ground behind it the rules allow, the
// advantage line when there is one, and a ring where the thrower stands.
// Press anywhere on it and the ring goes under the finger; drag and the
// thrower follows, by position, not by speed. The engine's setStance holds
// it to the line's ends, `backMax` behind it and the forward limit, as its
// walk keys are held.
//
// The pure part (the map both ways and the words) is exported for tests;
// StandPad is the DOM and the pointer. The game decides what a drag does
// (game.js standAt): the engine is called once a frame at most.
import { h } from "../ui/dom.js";

export const tune = {
  front: 0.6, // m of pitch shown in front of the farthest line the thrower may stand on
  keyStep: 0.25, // m an arrow key moves the thrower while STAND has the focus
  still: 0.05, // m: nearer the middle or the line than this reads as on it
};

const clamp01 = (f) => Math.max(0, Math.min(1, f));

// The ground the plate shows, from the engine's aim: { x0, x1 } across the
// line's width, { yBack, yFront } from `backMax` behind the line to a little
// in front of the forward limit (the advantage line for a baton, else the
// line itself), and the lines to draw.
export function standSpan(aim) {
  const hw = aim?.halfWidth ?? 2.5;
  const lineY = aim?.lineY ?? 0;
  const fwd = Math.max(lineY, aim?.forwardY ?? lineY);
  // a kubb's forward limit is the baseline in a standard match; in a Kid match
  // (engine 0.15) kubbs are thrown from the Kid line too, and forwardY says so
  const limit = aim?.projectile === "kubb" && aim?.kidY == null ? lineY : fwd;
  return {
    x0: -hw,
    x1: hw,
    yBack: lineY - (aim?.backMax ?? 3),
    yFront: limit + tune.front,
    lineY,
    limit,
  };
}

// A place on the plate (fx 0 left to 1 right, fy 0 top to 1 bottom) to the
// ground, and back. Top is toward the target.
export function groundAt(span, fx, fy) {
  return {
    x: span.x0 + clamp01(fx) * (span.x1 - span.x0),
    y: span.yFront - clamp01(fy) * (span.yFront - span.yBack),
  };
}
export function fractionOf(span, x, y) {
  return {
    fx: clamp01((x - span.x0) / (span.x1 - span.x0 || 1)),
    fy: clamp01((span.yFront - y) / (span.yFront - span.yBack || 1)),
  };
}

const metres = (d) => `${(Math.round(Math.abs(d) * 10) / 10).toFixed(1)} M`;

// Where the thrower stands, in words: "MIDDLE, ON THE LINE",
// "1.2 M LEFT, 0.5 M BACK", "0.8 M RIGHT, 1.5 M UP" (on toward the
// advantage line).
export function standText(thrower, aim) {
  const x = thrower?.x ?? 0;
  const y = (thrower?.y ?? 0) - (aim?.lineY ?? 0);
  const across =
    Math.abs(x) < tune.still
      ? "MIDDLE"
      : `${metres(x)} ${x < 0 ? "LEFT" : "RIGHT"}`;
  const kid = aim?.kidY != null ? aim.kidY - (aim?.lineY ?? 0) : null;
  const along =
    Math.abs(y) < tune.still
      ? "ON THE LINE"
      : kid != null && Math.abs(y - kid) < tune.still
        ? "ON THE KID LINE"
        : `${metres(y)} ${y < 0 ? "BACK" : "UP"}`;
  return `${across}, ${along}`;
}

// What STAND does, shown above the plan while it is held, with where the
// thrower is.
export function standCaption(thrower, aim) {
  const span = standSpan(aim);
  const kidLine =
    aim?.kidY != null && Math.abs(span.limit - aim.kidY) < tune.still;
  const how = kidLine
    ? "Stand anywhere from behind your line up to the Kid line."
    : span.limit > span.lineY + tune.still
      ? "Stand on your line, behind it, or up to the advantage line."
      : "Stand on your line or behind it.";
  return { key: "stand", text: `${standText(thrower, aim)}. ${how}` };
}

// For a screen reader.
export function standValueText(thrower, aim) {
  return standText(thrower, aim).toLowerCase().replace(" m ", " metres ");
}

// The plate. onStand(fx, fy, phase) with phase "down", "move", "up" or
// "cancel" (the plate went away under the finger); returns false when the
// press is not taken. onKey(dx, dy) for the arrow keys (dx right, dy up).
export class StandPad {
  constructor({ onStand, onKey }) {
    this.onStand = onStand;
    this.onKey = onKey;
    this.cache = new Map();
    this.drag = null; // { id } while a pointer holds it
    this.zone = h("div.stand-zone");
    this.line = h("div.stand-line");
    this.adv = h("div.stand-adv");
    this.mark = h("div.stand-mark");
    this.run = h("div.stand-run", this.zone, this.line, this.adv, this.mark);
    this.body = h("div.slider-body.stand-body", this.run);
    this.el = h(
      "div.slider.stand",
      {
        role: "group",
        tabindex: "0",
        "aria-label": "Where you stand. Arrow keys move you.",
        "data-test": "stand",
      },
      h("div.slider-head", "STAND"),
      this.body,
    );
    this.bind();
  }

  fractionAt(e) {
    const r = this.run.getBoundingClientRect();
    return {
      fx: clamp01((e.clientX - r.left) / (r.width || 1)),
      fy: clamp01((e.clientY - r.top) / (r.height || 1)),
    };
  }

  bind() {
    const body = this.body;
    body.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      const { fx, fy } = this.fractionAt(e);
      if (this.onStand(fx, fy, "down") === false) return;
      this.drag = { id: e.pointerId };
      try {
        body.setPointerCapture(e.pointerId);
      } catch {}
      this.el.classList.add("held");
    });
    body.addEventListener("pointermove", (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const { fx, fy } = this.fractionAt(e);
      this.onStand(fx, fy, "move");
    });
    const end = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag = null;
      this.el.classList.remove("held");
      const { fx, fy } = this.fractionAt(e);
      this.onStand(fx, fy, "up");
    };
    body.addEventListener("pointerup", end);
    body.addEventListener("pointercancel", end);
    body.addEventListener("lostpointercapture", end);
    this.el.addEventListener("keydown", (e) => {
      const d = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
      }[e.code];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      this.onKey(d[0] * tune.keyStep, d[1] * tune.keyStep);
    });
  }

  get held() {
    return !!this.drag;
  }

  cancel() {
    if (!this.drag) return;
    this.drag = null;
    this.el.classList.remove("held");
    this.onStand(0, 0, "cancel");
  }

  set(key, value, fn) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    fn(value);
  }

  // Each frame the plan shows: aim is the engine's aim.
  update(aim) {
    const span = standSpan(aim);
    const t = aim?.thrower || { x: 0, y: span.lineY };
    const { fx, fy } = fractionOf(span, t.x, t.y);
    const r3 = (v) => String(Math.round(v * 1000) / 1000);
    const s = this.el.style;
    this.set("fx", r3(fx), (v) => s.setProperty("--fx", v));
    this.set("fy", r3(fy), (v) => s.setProperty("--fy", v));
    const line = fractionOf(span, 0, span.lineY).fy;
    const limit = fractionOf(span, 0, span.limit).fy;
    this.set("line", r3(line), (v) => s.setProperty("--line", v));
    this.set("limit", r3(limit), (v) => s.setProperty("--limit", v));
    this.set("adv", limit < line - 0.01, (v) => (this.adv.hidden = !v));
    this.set("vt", standValueText(t, aim), (v) =>
      this.el.setAttribute(
        "aria-label",
        `Where you stand: ${v}. Arrow keys move you.`,
      ),
    );
  }
}
