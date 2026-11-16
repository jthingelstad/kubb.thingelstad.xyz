// The heads-up display over the canvas, in the DOM (crisp type, real
// buttons): the rail (who throws, what, the counts), the result flag and
// verdicts after a throw, the rest distance, SLOW MOTION and WATCH, the
// advantage line's text, and the plan buttons beside the dial. The game
// calls update() once a frame; only changed text touches the DOM.
import { h, button } from "../ui/dom.js";

const VERDICT_TEXT = {
  power: { label: "POWER" },
  release: { label: "ARC" },
  steady: { label: "" },
};

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
    this.plans = h(
      "div.plans",
      { "data-test": "plans" },
      h("div.plan-col", this.arcUp, this.arcDown),
      h("div.plan-col", this.sideL, this.sideR),
      this.planView,
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
  //       verdicts, restText, layout }
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
    this.text(what, w);
    this.text(counts, [rail.r1, rail.r2].filter(Boolean).join("  ·  "));
    this.show(this.rail, !!(rail.name || w));

    const [flag, verdicts, rest] = this.center.children;
    this.text(flag, st.flag || "");
    this.text(rest, st.restText || "");
    const vs = st.verdicts;
    const vtext = vs
      ? [
          vs.power && `${VERDICT_TEXT.power.label} ${vs.power}`,
          vs.release && `${VERDICT_TEXT.release.label} ${vs.release}`,
          vs.steady,
        ]
          .filter(Boolean)
          .join("|")
      : "";
    if (this.cache.get(verdicts) !== vtext) {
      this.cache.set(verdicts, vtext);
      verdicts.replaceChildren(
        ...vtext
          .split("|")
          .filter(Boolean)
          .map((t) => h("span.chip", t)),
      );
      verdicts.hidden = !vtext;
    }

    this.text(
      this.status,
      st.slow ? "SLOW MOTION" : st.watching ? "WATCH" : "",
    );
    this.text(this.adv, st.aiming ? aim.advText || "" : "");

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
      this.place(st.layout);
    }
    this.show(this.skip, !!st.playing);
  }

  // The plan buttons beside the dial: to its left on a wide screen, split
  // either side of it on a tall one.
  place(L) {
    if (!L) return;
    const key = `${L.W}x${L.H}:${L.side}`;
    if (this.cache.get("place") === key) return;
    this.cache.set("place", key);
    const d = L.dial;
    const s = this.plans.style;
    this.plans.classList.toggle("split", L.side === "both");
    if (L.side === "both") {
      s.left = `${L.safe.left + 8}px`;
      s.right = `${L.safe.right + 8}px`;
      s.width = "";
      s.top = `${d.y + d.height * 0.18}px`;
      s.bottom = "";
    } else {
      s.left = "";
      s.right = `${L.W - d.x + 6}px`;
      s.width = "";
      s.top = "";
      s.bottom = `${L.H - (d.y + d.height) + 10}px`;
    }
  }
}
