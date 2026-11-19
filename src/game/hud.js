// The heads-up display over the canvas, in the DOM (crisp type, real
// buttons): the rail (who throws, what, the counts), the result flag and
// verdicts after a throw, the rest distance, SLOW MOTION and WATCH, the
// advantage line's text, and the plan buttons beside the dial. The game
// calls update() once a frame; only changed text touches the DOM.
import { h, button } from "../ui/dom.js";

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
    this.arcUp = button("", () => a.arc(1), "plan", { "aria-label": "Arc up" });
    this.arcDown = button("", () => a.arc(-1), "plan", {
      "aria-label": "Arc down",
    });
    this.sideL = button("", () => a.side(-1), "plan", {
      "aria-label": "Tilt left",
    });
    this.sideR = button("", () => a.side(1), "plan", {
      "aria-label": "Tilt right",
    });
    this.planView = button("PLAN VIEW", null, "plan view", {
      "aria-label": "Plan view",
      "data-test": "plan-view",
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
      h("div.plan-col", this.arcUp, this.arcDown),
      h("div.plan-col", this.sideL, this.sideR),
      this.planView,
      this.walk,
    );
    this.skip = button("SKIP", () => a.skip(), "small skip-btn", {
      "data-test": "skip",
    });
    root.append(
      this.rail,
      this.center,
      this.status,
      this.adv,
      this.plans,
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
  //       verdicts, restText, layout, who: { text, mine } | null, wide }
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
      const side = kubb ? p.spin || 0 : p.tilt || 0;
      const sideWord = kubb ? "SPIN" : "TILT";
      this.text(this.arcUp, `ARC ${Math.round(p.loft ?? 0)}° ▲`);
      this.text(this.arcDown, `ARC ▼`);
      const sv =
        side === 0
          ? "0"
          : `${Math.abs(Math.round(side))}${side < 0 ? "L" : "R"}`;
      this.text(this.sideL, `◀ ${sideWord}`);
      this.text(this.sideR, `${sideWord} ${sv} ▶`);
      this.sideL.setAttribute("aria-label", `${sideWord} left`);
      this.sideR.setAttribute("aria-label", `${sideWord} right`);
      this.planView.classList.toggle("on", !!st.plan);
      this.walk.classList.toggle("on", !!st.walk);
      this.place(st.layout);
    }
    this.show(this.skip, !!st.playing);
  }

  // The plan buttons beside the meter, on its inner side: in one block to
  // its left (L.side "left") or right ("right") on a wide screen, split
  // either side of the throwing line ("both") on a tall one. Beside the
  // linear meter (at the right or left edge) a tall screen's are split
  // across what is left of the bottom; round a touchscreen's clock with its
  // finger track (L.plansFoot) they stand above the track.
  place(L) {
    if (!L) return;
    const key = `${L.W}x${L.H}:${L.side}:${L.meter}:${L.meterSide}:${L.plansFoot}`;
    if (this.cache.get("place") === key) return;
    this.cache.set("place", key);
    const d = L.dial;
    const s = this.plans.style;
    this.plans.classList.toggle("split", L.side === "both");
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
