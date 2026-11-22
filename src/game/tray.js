// The tray (the Throwing Wood 1.0 design, "Aim layout", the owner's choice
// of 2026-11-21: "the set-up tray (ARC, TILT, STAND as three equal plates)
// stays visible at the edge away from the meter; SIDE VIEW is no longer a
// button"). Three plates of one size in a column, each its control's value on
// a wooden band over a small picture of it. A tap opens that plate: it grows
// up from its place into the control (ARC's slider, TILT's or SPIN's, STAND's
// line from above), one at a time; ARC open shows the side view until it
// closes. Escape, a tap outside the tray, a tap on the open plate's band or
// opening another plate closes it. Where the plates go is layout.js trayAt;
// the controls are plan-sliders.js and stand-pad.js, unchanged inside.
//
// The pure part (the plates' words and pictures) is exported for tests; Tray
// is the DOM, the keys and the pointer.
import { h } from "../ui/dom.js";
import { arcLabel, sideLabel, sideValueText, leanOf } from "./plan-sliders.js";
import { standSpan, fractionOf, standValueText } from "./stand-pad.js";

export const PLATES = ["arc", "side", "stand"];

// A plate's band and its spoken name while closed, from the engine's aim:
// "ARC 32°" and "Arc, 32 degrees"; "TILT 7R" and "Tilt 7 degrees right" (a
// kubb's "SPIN 1.3L"); "STAND" and "Stand: 1.2 metres left, on the line".
export function plateWords(key, aim = {}) {
  const plan = aim.plan || {};
  const kubb = aim.projectile === "kubb";
  const controls = aim.controls || null;
  if (key === "arc") {
    const loft = Math.round(plan.loft ?? 0);
    return { head: arcLabel(plan), label: `Arc, ${loft} degrees` };
  }
  if (key === "side") {
    const c = controls ? (kubb ? controls.spin : controls.tilt) : null;
    const ok = c && Number.isFinite(c.min) && Number.isFinite(c.max);
    return {
      head: sideLabel(plan, kubb, ok ? c : null),
      label: sideValueText(plan, kubb, ok ? c : null).replace(" ", ", "),
    };
  }
  const t = aim.thrower || { x: 0, y: aim.lineY ?? 0 };
  return { head: "STAND", label: `Stand, ${standValueText(t, aim)}` };
}

// A plate's picture (70 by 32, SVG), the game's own way of showing each
// setting: ARC the planned arc dashed, as the side view draws it, rising by
// the loft; TILT the caption's baton, leaning by the tilt; SPIN the kubb with
// an arrow round it the way it spins; STAND the line from above with the
// ring where the thrower stands, as STAND's own plate draws it.
export function platePicture(key, aim = {}) {
  const plan = aim.plan || {};
  const ink = "var(--ink)";
  if (key === "arc") {
    const lift = Math.max(3, Math.min(26, (plan.loft ?? 32) * 0.55));
    return `<path d="M6 28 Q35 ${(28 - 2 * lift).toFixed(1)} 64 28" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="5 4" stroke-linecap="round"/>`;
  }
  if (key === "side" && aim.projectile === "kubb") {
    const spin = plan.spin || 0;
    const arrow =
      Math.abs(spin) < 0.05
        ? ""
        : spin > 0
          ? `<path d="M22 6 A14 10 0 0 1 48 6" fill="none" stroke="${ink}" stroke-width="2.5"/><path d="M44 1 L50 7 L43 10" fill="none" stroke="${ink}" stroke-width="2.5"/>`
          : `<path d="M48 6 A14 10 0 0 0 22 6" fill="none" stroke="${ink}" stroke-width="2.5"/><path d="M26 1 L20 7 L27 10" fill="none" stroke="${ink}" stroke-width="2.5"/>`;
    return `<rect x="28" y="10" width="14" height="20" rx="2" fill="var(--knob-face)" stroke="${ink}" stroke-width="2.5"/>${arrow}`;
  }
  if (key === "side") {
    const lean = leanOf(plan);
    return `<path d="M35 2 V30" stroke="${ink}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.5"/><rect x="31" y="3" width="8" height="26" rx="3" fill="var(--wood)" stroke="${ink}" stroke-width="2.5" transform="rotate(${lean.toFixed(1)} 35 16)"/>`;
  }
  const span = standSpan(aim);
  const t = aim.thrower || { x: 0, y: span.lineY };
  const { fx, fy } = fractionOf(span, t.x, t.y);
  const y = (f) => 2 + f * 28;
  const line = y(fractionOf(span, 0, span.lineY).fy);
  const limit = y(fractionOf(span, 0, span.limit).fy);
  const r1 = (v) => v.toFixed(1);
  return `<rect x="4" y="2" width="62" height="28" rx="2" fill="var(--stand-run)"/><rect x="4" y="${r1(limit)}" width="62" height="${r1(30 - limit)}" fill="var(--stand-zone)"/><path d="M2 ${r1(line)} H68" stroke="${ink}" stroke-width="3"/><circle cx="${r1(4 + fx * 62)}" cy="${r1(y(fy))}" r="5" fill="var(--field)" stroke="${ink}" stroke-width="2.5"/>`;
}

// The tray. controls: { arc, side, stand }, each a control with `el` (the
// PlanSlider or StandPad), `cancel()` and, for the arrow keys on a closed
// plate, onKey(key, step) from the game; onOpen(key) when the open plate
// changes (null: closed).
export class Tray {
  constructor(controls, { onOpen = () => {}, onKey = () => {} } = {}) {
    this.controls = controls;
    this.onOpen = onOpen;
    this.onKey = onKey;
    this.open = null;
    this.cache = new Map();
    this.plates = {};
    for (const key of PLATES) this.plates[key] = this.plate(key);
    this.el = h(
      "div.plans",
      {
        "data-test": "plans",
        role: "group",
        "aria-label": "Throw set-up",
      },
      ...PLATES.map((k) => this.plates[k].el),
    );
    this.bind();
  }

  plate(key) {
    const head = h("span.plate-head");
    const pic = h("span.plate-pic", { "aria-hidden": "true" });
    const toggle = h(
      "button.plate-toggle",
      {
        type: "button",
        "aria-expanded": "false",
        "data-test": `${key}-plate`,
      },
      head,
      pic,
    );
    const el = h(
      `div.plate.plate-${key}`,
      { "data-test": `plate-${key}` },
      toggle,
      this.controls[key].el,
    );
    toggle.addEventListener("click", (e) => {
      this.setOpen(this.open === key ? null : key, {
        // from the keyboard (Enter, Space): the control takes the focus
        focus: e.detail === 0,
      });
    });
    toggle.addEventListener("keydown", (e) => {
      const step = {
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
        ArrowRight: [1, 0],
        ArrowLeft: [-1, 0],
      }[e.code];
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      this.onKey(key, step);
    });
    return { key, el, toggle, head, pic };
  }

  bind() {
    if (typeof window === "undefined") return;
    // a press anywhere outside the tray closes the open plate first, so a
    // throw begun on the meter is not held by ARC's side view
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (this.open && !this.el.contains(e.target)) this.setOpen(null);
      },
      true,
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "Escape" || !this.open) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const p = this.plates[this.open];
        this.setOpen(null);
        p.toggle.focus({ preventScroll: true });
      },
      true,
    );
  }

  // Open a plate (key) or close the open one (null). One at a time.
  setOpen(key, { focus = false } = {}) {
    key = PLATES.includes(key) ? key : null;
    if (this.open === key) return;
    const was = this.open;
    if (was) {
      this.controls[was].cancel?.();
      const p = this.plates[was];
      p.el.removeAttribute("data-open");
      p.toggle.setAttribute("aria-expanded", "false");
    }
    this.open = key;
    if (key) {
      const p = this.plates[key];
      p.el.setAttribute("data-open", "");
      p.toggle.setAttribute("aria-expanded", "true");
      if (focus)
        requestAnimationFrame(() =>
          this.controls[key].el.focus({ preventScroll: true }),
        );
    }
    this.el.toggleAttribute("data-open", !!key);
    this.onOpen(key);
  }

  // Each frame the tray shows: the engine's aim. The bands, the spoken names
  // and the pictures follow it; the open control updates itself (hud.js).
  update(aim) {
    for (const key of PLATES) {
      const p = this.plates[key];
      const w = plateWords(key, aim);
      if (this.cache.get(`${key}:head`) !== w.head) {
        this.cache.set(`${key}:head`, w.head);
        p.head.textContent = w.head;
      }
      if (this.cache.get(`${key}:label`) !== w.label) {
        this.cache.set(`${key}:label`, w.label);
        p.toggle.setAttribute("aria-label", w.label);
      }
      if (this.open === key) continue; // the picture is hidden while open
      const svg = platePicture(key, aim);
      if (this.cache.get(`${key}:pic`) !== svg) {
        this.cache.set(`${key}:pic`, svg);
        p.pic.innerHTML = `<svg width="70" height="32" viewBox="0 0 70 32">${svg}</svg>`;
      }
    }
  }
}
