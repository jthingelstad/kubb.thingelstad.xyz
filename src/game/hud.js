// The heads-up display over the canvas, in the DOM (crisp type, real
// buttons): the rail (who throws, what, the counts), the result flag and
// verdicts after a throw, the rest distance, SLOW MOTION and WATCH, the
// advantage line's text, and the plan beside the dial (the ARC and TILT
// sliders, SIDE VIEW and WALK). The game calls update() once a frame; only
// changed text touches the DOM.
import { h, button } from "../ui/dom.js";
import { PlanSlider, captionOf, leanOf } from "./plan-sliders.js";
import { linearGeometry } from "../render/linear.js";

// The verdict chips under the flag, from the core's words (throwplan.lua
// plan.verdictText): on target, power and release read "POWER ON" and
// "ARC ON", steadiness STEADY, the side STRAIGHT. Anything else is off
// target and reads as the plain word (LONG, SHORT, SLOW, LOW, HIGH, SHAKY,
// PULLED LEFT): inverted, larger and first, so a long throw under MISS
// cannot pass for a good one (Tyler's report, 2026-11-16).
const VERDICT_ON = {
  power: { on: "ON", label: "POWER" },
  release: { on: "ON", label: "ARC" },
  steady: { on: "STEADY", label: "" },
  side: { on: "STRAIGHT", label: "" },
};

// [{ text, off }] for the HUD's chips: the off-target ones first, each group
// in the order power, release, steadiness, side.
export function verdictChips(vs) {
  if (!vs) return [];
  const off = [];
  const on = [];
  for (const [key, v] of Object.entries(VERDICT_ON)) {
    const word = vs[key];
    if (!word) continue;
    if (word === v.on)
      on.push({ text: v.label ? `${v.label} ${word}` : word, off: false });
    else off.push({ text: word, off: true });
  }
  return [...off, ...on];
}

export class Hud {
  constructor(root, actions) {
    this.root = root;
    this.actions = actions;
    this.cache = new Map();

    this.rail = h(
      "div.hud.hud-rail",
      { "data-test": "rail" },
      h("div.rail-name"),
      h("div.rail-what"),
      h("div.rail-counts"),
    );
    this.center = h(
      "div.hud.center",
      h("div.flag", { "data-test": "flag" }),
      h("div.verdicts"),
      h("div.rest"),
    );
    this.status = h("div.hud.status", { "data-test": "status" });
    this.adv = h("div.hud.adv");

    const a = actions;
    // the plan: ARC and TILT (or SPIN) as sliders (src/game/plan-sliders.js)
    this.arc = new PlanSlider("arc", { onSlide: a.slide, onKey: a.step });
    this.side = new PlanSlider("side", { onSlide: a.slide, onKey: a.step });
    // SIDE VIEW: the camera out over the thrower's shoulder, the planned
    // arc dashed (the engine's plan view, the Playdate's held B)
    this.sideView = button("SIDE VIEW", null, "plan view", {
      "aria-label": "Side view",
      "aria-pressed": "false",
      "data-test": "side-view",
    });
    // WALK is the Playdate's held A: while it is on, a drag on the pitch
    // walks the thrower (left and right along the line, down to step back)
    this.walk = button("WALK", null, "plan walk", {
      "aria-label": "Walk the thrower",
      "data-test": "walk",
    });
    this.plans = h(
      "div.plans",
      { "data-test": "plans" },
      this.arc.el,
      this.side.el,
      this.sideView,
      this.walk,
    );
    // what the held slider does (plan-sliders.js CAPTIONS), above the plan
    // where the finger on a slider is not, with a baton that leans by the
    // tilt while TILT is held
    this.capWood = h("div.cap-wood");
    this.capBaton = h(
      "div.cap-baton",
      { "aria-hidden": "true" },
      h("div.cap-plumb"),
      this.capWood,
    );
    this.capText = h("span.cap-text");
    this.caption = h(
      "div.hud.plan-caption",
      { "data-test": "plan-caption", role: "status" },
      this.capBaton,
      this.capText,
    );
    this.caption.hidden = true;
    this.skip = button("SKIP", () => a.skip(), "small skip-btn", {
      "data-test": "skip",
    });
    root.append(
      this.rail,
      this.center,
      this.status,
      this.adv,
      this.plans,
      this.caption,
      this.skip,
    );
  }

  text(el, value) {
    const v = value ?? "";
    if (this.cache.get(el) === v) return;
    this.cache.set(el, v);
    el.textContent = v;
    el.hidden = v === "";
  }

  show(el, on) {
    if (this.cache.get(el) === !!on) return;
    this.cache.set(el, !!on);
    el.hidden = !on;
  }

  // st: { aim, need, phase, playing, slow, watching, plan, practice, flag,
  //       verdicts, restText, layout, who: { text, mine } | null, wide,
  //       caption: the held slider's "arc" | "side", or null }
  update(st) {
    const aim = st.aim || {};
    const rail = aim.rail || {};
    const [name, what, counts] = this.rail.children;
    this.text(name, rail.name || "");
    let w = "";
    if (rail.kind || aim.projectile) {
      const kind = (rail.kind || aim.projectile || "").toUpperCase();
      w = rail.n && rail.of ? `${kind} ${rail.n} OF ${rail.of}` : kind;
    }
    if (st.practice) w = aim.drill ? "DRILLING" : "BATONS";
    // the wide view's rail says the turn too: the whole match at a glance
    if (st.wide && st.need?.turn && w) w = `TURN ${st.need.turn}  ·  ${w}`;
    this.text(what, w);
    this.text(counts, [rail.r1, rail.r2].filter(Boolean).join("  ·  "));
    this.show(this.rail, !!(rail.name || w));

    const [flag, verdicts, rest] = this.center.children;
    this.text(flag, st.flag || "");
    this.text(rest, st.restText || "");
    const chips = verdictChips(st.verdicts);
    const vtext = chips.map((c) => (c.off ? "!" : "") + c.text).join("|");
    if (this.cache.get(verdicts) !== vtext) {
      this.cache.set(verdicts, vtext);
      verdicts.replaceChildren(
        ...chips.map((c) => h(c.off ? "span.chip.off" : "span.chip", c.text)),
      );
      verdicts.hidden = !vtext;
    }

    // who acts, on a shared pitch (st.who from game.whoActs): YOUR THROW,
    // or whose it is
    const who = !st.slow && !st.playing ? st.who : null;
    this.text(
      this.status,
      st.slow ? "SLOW MOTION" : who ? who.text : st.watching ? "WATCH" : "",
    );
    const cls = who ? (who.mine ? "mine" : "theirs") : "";
    if (this.cache.get("statusCls") !== cls) {
      this.cache.set("statusCls", cls);
      this.status.classList.toggle("mine", cls === "mine");
      this.status.classList.toggle("theirs", cls === "theirs");
    }
    // the advantage line's words are the thrower's; the wide view draws the line
    this.text(this.adv, st.aiming && !st.wide ? aim.advText || "" : "");

    const showPlans = !!st.aiming && st.mayAct;
    this.show(this.plans, showPlans);
    if (showPlans) {
      const p = aim.plan || {};
      const kubb = aim.projectile === "kubb";
      this.arc.update(p, kubb);
      this.side.update(p, kubb);
      const on = !!st.plan;
      if (this.cache.get("sideView") !== on) {
        this.cache.set("sideView", on);
        this.sideView.classList.toggle("on", on);
        this.sideView.setAttribute("aria-pressed", String(on));
      }
      this.walk.classList.toggle("on", !!st.walk);
      this.place(st.layout);
      this.showCaption(st.caption ? captionOf(st.caption, kubb) : null, p);
    } else {
      this.arc.cancel();
      this.side.cancel();
      this.showCaption(null);
    }
    this.show(this.skip, !!st.playing);
  }

  // The held slider's caption (cap: { key, text } or null), placed above the
  // plan's block: across it where the plan is split, else at least 330 px
  // wide from the block's edge away from the meter. The block is measured
  // only when the caption appears or the layout changes. Beside the linear
  // meter it also stays above the meter's prompt tab.
  showCaption(cap, plan = null) {
    const key = cap ? cap.key : "";
    if (this.cache.get("capKey") !== key) {
      this.cache.set("capKey", key);
      this.caption.hidden = !cap;
      this.caption.dataset.what = key;
      this.capText.textContent = cap ? cap.text : "";
      this.capBaton.hidden = key !== "tilt";
      this.cache.delete("capPlace");
    }
    if (!cap) return;
    if (key === "tilt") {
      const lean = leanOf(plan);
      if (this.cache.get("capLean") !== lean) {
        this.cache.set("capLean", lean);
        this.capWood.style.transform = `rotate(${lean}deg)`;
      }
    }
    const L = this.cache.get("placeL");
    const pk = this.cache.get("place");
    if (!L || this.cache.get("capPlace") === pk) return;
    this.cache.set("capPlace", pk);
    const r = this.plans.getBoundingClientRect();
    const s = this.caption.style;
    // and above the linear meter's prompt tab, which hangs toward the plan
    let top = r.top;
    if (L.meter === "linear") {
      const g = linearGeometry(L.dial, L.meterSide);
      top = Math.min(top, g.y0 - g.promptH / 2 - 4);
    }
    s.bottom = `${L.H - top + 8}px`;
    const split = L.side === "both";
    const toRight = L.side === "right"; // the block is right of the meter
    this.caption.classList.toggle("split", split);
    this.caption.classList.toggle("from-left", !split && toRight);
    if (split) {
      s.left = `${r.left}px`;
      s.right = `${L.W - r.right}px`;
      s.width = "";
    } else {
      const w = Math.max(r.width, 330);
      s.width = `${w}px`;
      s.left = toRight ? `${r.left}px` : "";
      s.right = toRight ? "" : `${L.W - r.right}px`;
    }
  }

  // The plan beside the meter, on its inner side: in one block to its left
  // (L.side "left") or right ("right") on a wide screen, ARC's tall plate
  // next to the meter and TILT, SIDE VIEW and WALK stacked beside it
  // ("mirror" when the block is right of the meter); split either side of
  // the throwing line ("both") on a tall one, ARC over SIDE VIEW on the
  // left and TILT over WALK on the right. Beside the linear meter (at the
  // right or left edge) a tall screen's are split across what is left of
  // the bottom; round a touchscreen's clock with its finger track
  // (L.plansFoot) they stand above the track.
  place(L) {
    if (!L) return;
    const key = `${L.W}x${L.H}:${L.side}:${L.meter}:${L.meterSide}:${L.plansFoot}`;
    if (this.cache.get("place") === key) return;
    this.cache.set("place", key);
    this.cache.set("placeL", L);
    const d = L.dial;
    const s = this.plans.style;
    this.plans.classList.toggle("split", L.side === "both");
    this.plans.classList.toggle("mirror", L.side === "right");
    s.width = "";
    if (L.side === "both" && L.meter === "linear") {
      const left = L.meterSide === "left";
      s.left = left ? `${d.x + d.width + 6}px` : `${L.safe.left + 8}px`;
      s.right = left ? `${L.safe.right + 8}px` : `${L.W - d.x + 6}px`;
      s.top = "";
      s.bottom = `${L.H - (d.y + d.height) + 10}px`;
    } else if (L.side === "both" && L.plansFoot != null) {
      s.left = `${L.safe.left + 8}px`;
      s.right = `${L.safe.right + 8}px`;
      s.top = "";
      s.bottom = `${L.H - L.plansFoot}px`;
    } else if (L.side === "both") {
      s.left = `${L.safe.left + 8}px`;
      s.right = `${L.safe.right + 8}px`;
      s.top = `${L.plansY + d.height * 0.18}px`;
      s.bottom = "";
    } else if (L.side === "right") {
      s.left = `${d.x + d.width + 6}px`;
      s.right = "";
      s.top = "";
      s.bottom = `${L.H - (L.plansY + d.height) + 10}px`;
    } else {
      s.left = "";
      s.right = `${L.W - d.x + 6}px`;
      s.top = "";
      s.bottom = `${L.H - (L.plansY + d.height) + 10}px`;
    }
  }
}
