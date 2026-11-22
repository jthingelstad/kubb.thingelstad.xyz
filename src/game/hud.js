// The heads-up display over the canvas, in the DOM (crisp type, real
// buttons): the rail (who throws, what, the counts), the result flag and
// verdicts after a throw, the rest distance, SLOW MOTION and WATCH, the
// advantage line's text, and the plan beside the dial (the ARC and TILT
// sliders, SIDE VIEW and STAND). The game calls update() once a frame; only
// changed text touches the DOM.
import { h, button } from "../ui/dom.js";
import { PlanSlider, captionOf, leanOf } from "./plan-sliders.js";
import { StandPad, standCaption } from "./stand-pad.js";
import { Tray } from "./tray.js";
import { linearGeometry, tabRect } from "../render/linear.js";
import { tune as layoutTune, clockShapes } from "./layout.js";
import { dialGeometry, tune as dialTune } from "../render/dial.js";

// The verdict chips under the flag, from the core's words (throwplan.lua
// plan.verdictText): on target, power and release read "POWER ON" and
// "ARC ON", steadiness STEADY, the side STRAIGHT. Anything else is off
// target and reads as the plain word (LONG, SHORT, SLOW, LOW, HIGH, SHAKY,
// PULLED LEFT): inverted, larger and first, so a long throw under MISS
// cannot pass for a good one (Tyler's report, 2026-11-16). Since the 1.0
// design ("Verdict") an off word is 18 px with an arrow that says which way
// it went, so it is not told by inversion alone: down for SHORT and LOW, up
// for LONG and HIGH, left and right for PULLED, a wavy line for SHAKY, a
// clock hand for SLOW.
const VERDICT_ON = {
  power: { on: "ON", label: "POWER" },
  release: { on: "ON", label: "ARC" },
  steady: { on: "STEADY", label: "" },
  side: { on: "STRAIGHT", label: "" },
};

export const VERDICT_ICON = {
  SHORT: "down",
  LOW: "down",
  LONG: "up",
  HIGH: "up",
  "PULLED LEFT": "left",
  "PULLED RIGHT": "right",
  SHAKY: "wavy",
  SLOW: "clock",
};

// The arrows, 14 by 14, drawn in the chip's own type colour.
const ICON_PATH = {
  down: '<path d="M7 1V12M2 7.5L7 12.5L12 7.5"/>',
  up: '<path d="M7 13V2M2 6.5L7 1.5L12 6.5"/>',
  left: '<path d="M13 7H2M6.5 2L1.5 7L6.5 12"/>',
  right: '<path d="M1 7H12M7.5 2L12.5 7L7.5 12"/>',
  wavy: '<path d="M1 7.5C2.5 3.5 4 3.5 5 7.5S7.5 11.5 9 7.5S11.5 3.5 13 7.5"/>',
  clock: '<circle cx="7" cy="7" r="5.6"/><path d="M7 7V3.4M7 7L9.8 8.6"/>',
};

export function verdictIconSvg(icon) {
  const d = ICON_PATH[icon];
  if (!d) return "";
  return `<svg class="verdict-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

// [{ text, off, icon }] for the HUD's chips: the off-target ones first, each
// group in the order power, release, steadiness, side.
export function verdictChips(vs) {
  if (!vs) return [];
  const off = [];
  const on = [];
  for (const [key, v] of Object.entries(VERDICT_ON)) {
    const word = vs[key];
    if (!word) continue;
    if (word === v.on)
      on.push({ text: v.label ? `${v.label} ${word}` : word, off: false });
    else off.push({ text: word, off: true, icon: VERDICT_ICON[word] || null });
  }
  return [...off, ...on];
}

// The verdict as a screen reader hears it, once: the off words first, then the
// flag, then the on-target words, then where the throw came to rest when the screen
// shows it under the verdict (as the iPhone says it). "Short. Miss. Arc on,
// steady, straight. 50 cm away."
export function verdictSpeech(flag, vs, rest = null) {
  const chips = verdictChips(vs);
  const sentence = (t) => {
    const l = String(t).toLowerCase().replace(/!+$/, "");
    return l.charAt(0).toUpperCase() + l.slice(1);
  };
  const parts = chips.filter((c) => c.off).map((c) => `${sentence(c.text)}.`);
  if (flag) parts.push(`${sentence(flag)}.`);
  const on = chips.filter((c) => !c.off).map((c) => c.text.toLowerCase());
  if (on.length) parts.push(`${sentence(on.join(", "))}.`);
  // "50 CM AWAY", "1.2 M AWAY" (the engine's restText): "50 cm away."
  const r = String(rest || "").trim();
  if (r) parts.push(`${r.toLowerCase()}.`);
  return parts.join(" ");
}

// The rail's counts in plain words. The engine's rail is the Playdate's
// (session.lua aimView): "FIELD 2", "BASE 5", "KING", and a drilled kubb's
// "2.3 M" (how far out the circle is). A new player read "BASE 5" as a level or a score; it is how many
// of the far team's kubbs are still standing on their baseline.
export function railCount(t) {
  const m = /^(FIELD|BASE) (\d+)$/.exec(t || "");
  if (m) {
    const n = Number(m[2]);
    return `${n} ${m[1]} ${n === 1 ? "KUBB" : "KUBBS"}`;
  }
  if (/^\d+\.\d M$/.test(t || "")) return `TARGET ${t}`;
  if (t === "KING") return "AT THE KING";
  return t || "";
}

// The header's words (the 1.0 design, "Header"): the line over the name, "Turn 4 ·
// baton 2 of 6" (shown in the label's capitals), with what the thrower aims at when
// it is not the base kubbs the numbers show ("2 field kubbs", "at the king"; practice:
// "Kubbs · target 2.3 m"). The iPhone's header says the same words.
export function headerLine({
  turn = null,
  kind = "",
  n = null,
  of = null,
  count = "",
  cpu = null,
} = {}) {
  const parts = [];
  if (turn) parts.push(`Turn ${turn}`);
  if (kind) parts.push(n && of ? `${kind} ${n} of ${of}` : kind);
  if (count) parts.push(count);
  // a computer player throws (engine 0.17, need.setup.thrower.cpu): "· computer · Pro"
  if (cpu) parts.push("computer", cpu);
  const t = parts.join(" · ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// A computer seat's id on a pitch (engine 0.17: "cpu:" and a number, never a member's).
export const isSeatKey = (key) =>
  typeof key === "string" && /^cpu:[1-9]\d?$/.test(key);

// A computer player's level as the header says it (the engine's words).
const LEVEL_WORDS = {
  kid: "Kid",
  beginner: "Beginner",
  club: "Club",
  pro: "Pro",
};

// Whose throw it is, in sentence case: the engine's rail says it in capitals
// ("MIGHTY MAPLE", "GOLDEN KUBBLETS: PLUCKY PLUM"), so the name is the team's (and
// the thrower's) as the match has it. Anything else is given its words' capitals.
export function headerName(railName, need = null) {
  const r = railName || "";
  if (!r) return "";
  if (r === "PRACTICE") return "Practice";
  const team = need?.teams?.[need?.side];
  const thrower = need?.setup?.thrower?.name;
  if (team && r === team.toUpperCase()) return team;
  if (team && thrower && r === `${team}: ${thrower}`.toUpperCase())
    return `${team}: ${thrower}`;
  return r
    .toLowerCase()
    .replace(/(^|[\s:])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

// The width a caption over the tray keeps so it stops short of the minimap,
// where the two share a band (y0 to y1, the caption's): from x0 toward the
// middle (fromLeft) or back from x0 toward it (the right edge).
function clearOfMap(m, fromLeft, x0, w, y0, y1) {
  if (!m || y1 <= m.y || y0 >= m.y + m.height) return w;
  const gap = 8;
  return fromLeft
    ? x0 < m.x
      ? Math.min(w, m.x - gap - x0)
      : w
    : x0 > m.x + m.width
      ? Math.min(w, x0 - (m.x + m.width) - gap)
      : w;
}

// The meter tab's distance spoken ("8 M", "1.5 M" from metresWords in game.js):
// "8 metres", "1.5 metres", "1 metre".
export function spokenMetres(words) {
  const n = parseFloat(words);
  return `${n} ${n === 1 ? "metre" : "metres"}`;
}

// The minimap as one image for a screen reader: the kubbs standing in each
// half, by team, and how far out the target is. "Map of the pitch: Mighty
// Maple 5 kubbs standing, Computer 4. The target is 8 metres out."
export function mapSummary(st, distance = null) {
  const need = st.need;
  const sd = need?.standing;
  const t = need?.teams || {};
  let text = "Map of the pitch";
  if (!st.practice && sd && Number.isInteger(sd.A) && Number.isInteger(sd.B))
    text += `: ${t.A || "Team A"} ${sd.A} ${sd.A === 1 ? "kubb" : "kubbs"} standing, ${t.B || "Team B"} ${sd.B}`;
  text += ".";
  if (distance) text += ` The target is ${distance} out.`;
  return text;
}

export class Hud {
  constructor(root, actions) {
    this.root = root;
    this.actions = actions;
    this.cache = new Map();

    // the header (the 1.0 design): "Turn N · baton n of m" over the name, the kubbs
    // standing in each half as two numbers on the team colours, and MENU as a word
    // inside the plate (src/ui/menu.js puts its button here: hud.menuSlot)
    this.railScore = h(
      "div.rail-score",
      { role: "img", "data-test": "rail-score" },
      h("span.rail-n.team-a", { "data-test": "rail-n-A" }),
      h("span.rail-n.team-b", { "data-test": "rail-n-B" }),
    );
    this.menuSlot = h("div.rail-menu");
    this.rail = h(
      "div.hud.hud-rail",
      { "data-test": "rail" },
      h("div.rail-what", { "data-test": "rail-what" }),
      h("div.rail-name", { "data-test": "rail-name" }),
      this.railScore,
      this.menuSlot,
    );
    // the header's height, for what stands under it on a tall screen (game.css
    // --rail-h)
    if (typeof ResizeObserver === "function") {
      this.railObs = new ResizeObserver(() => {
        const hgt = Math.round(this.rail.offsetHeight);
        if (!hgt || hgt === this.railH) return;
        this.railH = hgt;
        document.documentElement.style.setProperty("--rail-h", `${hgt}px`);
        // the minimap stands under it (layout.js minimapBox)
        this.actions.railHeight?.(hgt);
      });
      this.railObs.observe(this.rail);
    }
    this.center = h(
      "div.hud.center",
      h("div.flag", { "data-test": "flag", "aria-hidden": "true" }),
      h("div.verdicts", { "data-test": "verdicts", "aria-hidden": "true" }),
      // in the spoken line (verdictSpeech), so hidden from a screen reader here
      h("div.rest", { "data-test": "rest", "aria-hidden": "true" }),
    );
    // the verdict for a screen reader, said once (verdictSpeech)
    this.said = h("div.visually-hidden", {
      role: "status",
      "aria-live": "polite",
      "data-test": "verdict-said",
    });
    this.status = h("div.hud.status", { "data-test": "status" });
    // Stand-ins over what the canvas draws, for a screen reader and the
    // keyboard (the 1.0 design's order: the header, the prompt and distance,
    // the meter, the tray, the minimap as one image with a spoken summary).
    // They take no presses: the canvas under them does.
    const proxy = (test) =>
      h("div.meter-proxy", { tabindex: "0", role: "img", "data-test": test });
    this.promptProxy = proxy("prompt-proxy");
    this.meterProxy = proxy("meter-proxy");
    this.mapProxy = proxy("map-proxy");
    this.adv = h("div.hud.adv");

    const a = actions;
    // the plan: ARC and TILT (or SPIN) as sliders (src/game/plan-sliders.js)
    this.arc = new PlanSlider("arc", { onSlide: a.slide, onKey: a.step });
    this.side = new PlanSlider("side", { onSlide: a.slide, onKey: a.step });
    // STAND: where the thrower stands, dragged on a picture of the line
    // (src/game/stand-pad.js; it replaced WALK, the Playdate's held A)
    this.stand = new StandPad({ onStand: a.stand, onKey: a.standKey });
    // the tray (src/game/tray.js, the 1.0 design): the three as plates of one
    // size at the screen's edge away from the meter, each opened by a tap;
    // ARC open is the side view (SIDE VIEW is no longer a button)
    this.tray = new Tray(
      { arc: this.arc, side: this.side, stand: this.stand },
      {
        onOpen: (key) => {
          this.cache.delete("capPlace");
          this.cache.delete("coachPlace");
          a.open?.(key);
        },
        onKey: (key, [dx, dy]) => {
          if (key === "stand") a.standKey(dx * 0.25, dy * 0.25);
          else if (key === "arc" && dy) a.step("arc", dy, true);
          else if (key === "side" && dx) a.step("side", dx, true);
        },
      },
    );
    this.plans = this.tray.el;
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
    // the throw's coach (coach.js): a line over the meter's prompt that
    // follows the stroke, for a learner and after a SLOW flick
    // in one style (the 1.0 design): one inverted ink chip, the SLOW lead
    // and the line in it, never pills of their own
    this.coachLead = h("span.coach-lead");
    this.coachLine = h("span.coach-line");
    this.coach = h(
      "div.hud.coach",
      { "data-test": "coach", role: "status" },
      h("span.coach-chip", this.coachLead, this.coachLine),
    );
    this.coach.hidden = true;
    this.skip = button("SKIP", () => a.skip(), "skip-btn", {
      "data-test": "skip",
    });
    root.append(
      this.rail,
      this.center,
      this.said,
      this.status,
      this.adv,
      this.promptProxy,
      this.meterProxy,
      this.plans,
      this.mapProxy,
      this.caption,
      this.coach,
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
  //       caption: the held slider's "arc" | "side", or null,
  //       coach: coach.js coachFor's { stage, lead, line }, or null }
  update(st) {
    const aim = st.aim || {};
    const rail = aim.rail || {};
    const [what, name] = this.rail.children;
    const need = st.need;
    this.text(name, headerName(rail.name, need));
    let line = "";
    if (st.practice)
      line = headerLine({
        kind: aim.drill ? "Kubbs" : "Batons",
        count: railCount(rail.r1),
      });
    else if (rail.kind || aim.projectile) {
      // what the thrower aims at, when it is not the base kubbs the numbers show
      const at = /^(FIELD \d+|KING)$/.test(rail.r1 || "")
        ? railCount(rail.r1)
        : "";
      // a computer player in a team, by its seat id (a side the computer plays whole
      // is the header's name, "Computer", as before)
      const th =
        need?.kind === "throw" && isSeatKey(need.setup?.thrower?.key)
          ? need.setup.thrower
          : null;
      line = headerLine({
        turn: need?.turn,
        // a kubb rethrown (engine 0.17.0): counted among the rethrows, "rethrow 1 of 1"
        kind: rail.rethrow ? "Rethrow" : rail.kind || aim.projectile || "",
        n: rail.n,
        of: rail.of,
        count: at,
        cpu: th?.cpu ? (LEVEL_WORDS[th.level] ?? th.level ?? "") : null,
      });
    }
    this.text(what, line);
    // the kubbs standing in each half, on the team colours (a match only)
    const sd = !st.practice && need?.standing;
    const score = sd && Number.isInteger(sd.A) && Number.isInteger(sd.B);
    const [na, nb] = this.railScore.children;
    this.text(na, score ? String(sd.A) : "");
    this.text(nb, score ? String(sd.B) : "");
    this.show(this.railScore, score);
    if (score) {
      const t = need.teams || {};
      const label = `Kubbs standing: ${t.A || "Team A"} ${sd.A}, ${t.B || "Team B"} ${sd.B}`;
      if (this.cache.get("scoreLabel") !== label) {
        this.cache.set("scoreLabel", label);
        this.railScore.setAttribute("aria-label", label);
      }
    }
    this.show(this.rail, !!(rail.name || line || this.menuSlot.firstChild));

    const [flag, verdicts, rest] = this.center.children;
    this.text(flag, st.flag || "");
    this.text(rest, st.restText || "");
    const chips = verdictChips(st.verdicts);
    const vtext = chips.map((c) => (c.off ? "!" : "") + c.text).join("|");
    if (this.cache.get(verdicts) !== vtext) {
      this.cache.set(verdicts, vtext);
      verdicts.replaceChildren(
        ...chips.map((c) => {
          const el = h(c.off ? "span.chip.off" : "span.chip");
          if (c.icon) {
            el.dataset.icon = c.icon;
            el.innerHTML = verdictIconSvg(c.icon);
          }
          el.append(c.text);
          return el;
        }),
      );
      verdicts.hidden = !vtext;
    }
    // said once to a screen reader, the off word first (the chips and the
    // flag are hidden from it: this line is the verdict)
    const said =
      vtext || st.flag || st.restText
        ? verdictSpeech(st.flag, st.verdicts, st.restText)
        : "";
    if (this.cache.get("said") !== said) {
      this.cache.set("said", said);
      if (said) this.said.textContent = said;
    }

    // who acts, on a shared pitch (st.who from game.whoActs): YOUR THROW,
    // or whose it is
    const who = !st.slow && !st.playing ? st.who : null;
    this.text(
      this.status,
      st.slow
        ? "SLOW MOTION"
        : who
          ? who.text
          : st.watching && !st.meterWatch
            ? "WATCH"
            : "",
    );
    // the verdict stands under the pill while the pill shows (game.css)
    this.center.classList.toggle("status-on", !this.status.hidden);
    const cls = who ? (who.mine ? "mine" : "theirs") : "";
    if (this.cache.get("statusCls") !== cls) {
      this.cache.set("statusCls", cls);
      this.status.classList.toggle("mine", cls === "mine");
      this.status.classList.toggle("theirs", cls === "theirs");
    }
    // the advantage line's words are the thrower's; the wide view draws the line
    this.text(this.adv, st.aiming && !st.wide ? aim.advText || "" : "");

    this.proxies(st);
    const showPlans = !!st.aiming && st.mayAct;
    this.show(this.plans, showPlans);
    if (showPlans) {
      const p = aim.plan || {};
      const kubb = aim.projectile === "kubb";
      // engine 0.9 on: each slider's range and value from the engine
      this.arc.update(p, kubb, aim.controls);
      this.side.update(p, kubb, aim.controls);
      this.stand.update(aim);
      this.tray.update(aim);
      this.place(st.layout);
      const cap =
        st.caption === "stand"
          ? standCaption(aim.thrower, aim)
          : st.caption
            ? captionOf(st.caption, kubb, p, aim.controls?.arc)
            : null;
      this.showCaption(cap, p);
      // one voice at a time: a held slider's caption wins
      this.showCoach(cap ? null : st.coach || null);
    } else {
      this.tray.setOpen(null);
      this.arc.cancel();
      this.side.cancel();
      this.stand.cancel();
      this.showCaption(null);
      this.showCoach(null);
    }
    this.show(this.skip, !!st.playing);
  }

  // The stand-ins' words and places: the prompt with the distance, the meter,
  // and the minimap's summary, each over what the canvas draws there, shown
  // while the meter is (st.meter: game.meterShown; null in the wide view).
  proxies(st) {
    const L = st.layout;
    const m = st.meter;
    const on = !!(L && m && !st.playing);
    this.show(this.promptProxy, on && !!m.prompt);
    this.show(this.meterProxy, on);
    this.show(this.mapProxy, on && !!L.minimap);
    if (!on) return;
    const sentence = (t) => {
      const l = String(t || "")
        .toLowerCase()
        .replace(/[!↓]+/g, "")
        .trim();
      return l.charAt(0).toUpperCase() + l.slice(1);
    };
    const kind = L.meter === "linear" ? "Linear meter" : "Clock meter";
    const words = {
      prompt: m.prompt
        ? `${sentence(m.prompt)}${m.distance ? `, ${spokenMetres(m.distance)}` : ""}`
        : "",
      meter: st.watching
        ? `${kind}, shown for watching only.`
        : `${kind}. Draw back to the stripes, then flick and let go on the solid mark.`,
      map: mapSummary(st, m.distance ? spokenMetres(m.distance) : null),
    };
    for (const [k, el] of [
      ["prompt", this.promptProxy],
      ["meter", this.meterProxy],
      ["map", this.mapProxy],
    ]) {
      if (this.cache.get(`proxy:${k}`) === words[k]) continue;
      this.cache.set(`proxy:${k}`, words[k]);
      el.setAttribute("aria-label", words[k]);
    }
    const key = `${L.W}x${L.H}:${L.meter}:${L.meterSide}:${L.dial.x}:${L.dial.y}:${L.minimap?.x}:${L.minimap?.y}`;
    if (this.cache.get("proxyPlace") === key) return;
    this.cache.set("proxyPlace", key);
    const put = (el, r) => {
      if (!r) return;
      Object.assign(el.style, {
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    };
    put(
      this.promptProxy,
      L.meter === "linear"
        ? tabRect(linearGeometry(L.dial, L.meterSide))
        : clockShapes(L).prompt,
    );
    put(this.meterProxy, L.dial);
    put(this.mapProxy, L.minimap);
  }

  // The held slider's caption (cap: { key, text } or null): over the tray,
  // growing from the screen's edge the tray stands at toward the middle, at
  // least 330 px wide where there is the room. Where an open plate has taken
  // the room over the tray (under its ceiling: the header, the minimap) it
  // stands beside the open plate's top on its inner side instead. Never onto
  // the meter: a tall canvas's linear meter bounds it, and beside it over the
  // prompt tab it is lifted above the tab. Never onto the minimap either (a QA
  // note, 2026-11-22: an upright phone's clock had the ARC caption across it):
  // where the two share a band it stops short of the minimap and wraps, and
  // beside a plate, where that leaves too little to read, starts under it. Measured only when the caption appears, a plate opens or closes, or the
  // layout changes.
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
    if (this.capText.textContent !== cap.text)
      this.capText.textContent = cap.text;
    if (key === "tilt") {
      const lean = leanOf(plan);
      if (this.cache.get("capLean") !== lean) {
        this.cache.set("capLean", lean);
        this.capWood.style.transform = `rotate(${lean}deg)`;
      }
    }
    const L = this.cache.get("placeL");
    const pk = `${this.cache.get("place")}:${this.tray.open}`;
    if (!L || !L.tray || this.cache.get("capPlace") === pk) return;
    this.cache.set("capPlace", pk);
    const r = this.plans.getBoundingClientRect();
    const s = this.caption.style;
    const t = L.tray;
    const fromLeft = t.edge === "left";
    // the room toward the middle: on a wide canvas planClear short of the
    // throwing line; on a tall one up to the other edge, or the linear meter
    const tallLinear = L.tall && L.meter === "linear";
    const reach = (x0) =>
      fromLeft
        ? (L.tall
            ? tallLinear
              ? L.dial.x - 8
              : L.W - L.safe.right - 8
            : L.W / 2 - layoutTune.planClear) - x0
        : x0 -
          (L.tall
            ? tallLinear
              ? L.dial.x + L.dial.width + 8
              : L.safe.left + 8
            : L.W / 2 + layoutTune.planClear);
    const capH = 52;
    const above = r.top - 8 - capH >= t.ceiling;
    let top, x0, w;
    if (above) {
      x0 = fromLeft ? r.left : r.right;
      w = Math.min(Math.max(r.width, 330), reach(x0));
      top = r.top;
      if (L.meter === "linear" && !L.tall) {
        const tab = tabRect(linearGeometry(L.dial, L.meterSide));
        const a = fromLeft ? x0 : x0 - w;
        if (a < tab.x + tab.width + 8 && a + w > tab.x - 8)
          top = Math.min(top, tab.y - 4);
      }
      w = clearOfMap(L.minimap, fromLeft, x0, w, top - 8 - capH, top - 8);
      s.top = "";
      s.bottom = `${L.H - top + 8}px`;
    } else {
      // beside the open plate, its top level with the plate's
      const open = this.tray.open && this.tray.plates[this.tray.open].el;
      const o = open ? open.getBoundingClientRect() : r;
      x0 = fromLeft ? o.right + t.gap : o.left - t.gap;
      w = Math.min(330, reach(x0));
      let y = Math.max(t.ceiling, o.top);
      const narrow = clearOfMap(L.minimap, fromLeft, x0, w, y, y + capH);
      // too narrow to read beside the minimap: under it instead
      if (narrow < 160) y = L.minimap.y + L.minimap.height + t.gap;
      else w = narrow;
      s.bottom = "";
      s.top = `${y}px`;
    }
    w = Math.max(160, w);
    this.caption.classList.remove("split");
    this.caption.classList.toggle("from-left", fromLeft);
    s.width = `${w}px`;
    s.left = fromLeft ? `${x0}px` : "";
    s.right = fromLeft ? "" : `${L.W - x0}px`;
  }

  // The coach line (coach: { stage, lead, line } or null) just over the
  // meter's prompt, so the two read as one: centred over the clock's plate,
  // or over the linear meter's tab from the meter's inner edge. Its width
  // stops short of any plan control level with it. Placed once per layout.
  showCoach(coach) {
    this.coach.hidden = !coach;
    if (!coach) return;
    this.text(this.coachLead, coach.lead || "");
    this.text(this.coachLine, coach.line);
    if (this.cache.get("coachStage") !== coach.stage) {
      this.cache.set("coachStage", coach.stage);
      this.coach.dataset.stage = coach.stage;
    }
    const L = this.cache.get("placeL");
    const pk = this.cache.get("place");
    if (!L || this.cache.get("coachPlace") === pk) return;
    this.cache.set("coachPlace", pk);
    const linear = L.meter === "linear";
    const d = L.dial;
    let bottom, anchor, align; // anchor: the x the line is centred on or ends at
    // Beside a wide canvas's linear meter with the plan block away at the
    // far edge (a phone on its side) the line hangs under the tab instead,
    // in the meter's half: over the tab it would meet the verdicts and the
    // header on a short screen (the iPhone app's coachBand).
    let under = null;
    if (linear) {
      const g = linearGeometry(d, L.meterSide);
      bottom = g.y0 - g.promptH / 2 - 8;
      align = L.meterSide === "left" ? "left" : "right";
      anchor = align === "right" ? d.x : d.x + d.width;
      if (!L.tall && L.planEdge) {
        const t = tabRect(g);
        under = t.y + t.height + 8;
      }
    } else {
      const g = dialGeometry(d);
      const ph = Math.max(14, g.r * dialTune.promptH);
      bottom = g.cy - g.r - ph * 0.85 - ph / 2 - 8;
      align = "center";
      anchor = g.cx;
    }
    // the room left and right of the anchor, short of the screen's safe
    // edges and of plan controls level with the line (up to 76 px above it)
    let lo = L.safe.left + 8;
    let hi = L.W - L.safe.right - 8;
    if (under != null) {
      const mid = L.W / 2;
      if (align === "right") lo = Math.max(lo, mid + layoutTune.planClear);
      else hi = Math.min(hi, mid - layoutTune.planClear);
    }
    // a wide screen's clock: the line keeps to the clock's own column, so the
    // verdicts beside it (game.js placeRoom) never meet it
    if (!linear && !L.tall) {
      lo = Math.max(lo, d.x - 8);
      hi = Math.min(hi, d.x + d.width + 8);
    }
    const band = under != null ? [under, under + 76] : [bottom - 76, bottom];
    for (const el of this.plans.children) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < band[0] || r.top > band[1]) continue;
      if (r.right <= anchor) lo = Math.max(lo, r.right + 8);
      else if (r.left >= anchor) hi = Math.min(hi, r.left - 8);
    }
    const max = 280;
    const s = this.coach.style;
    s.bottom = under != null ? "" : `${L.H - bottom}px`;
    s.top = under != null ? `${under}px` : "";
    this.coach.dataset.align = align;
    if (align === "center") {
      // centred over the prompt where it can be; a plate beside it (an open
      // one) moves it over rather than squeezing it
      const w = Math.min(max, hi - lo);
      s.width = `${w}px`;
      s.left = `${Math.max(lo, Math.min(hi - w, anchor - w / 2))}px`;
      s.right = "";
    } else if (align === "right") {
      const w = Math.min(max, anchor - lo);
      s.width = `${w}px`;
      s.left = "";
      s.right = `${Math.ceil(L.W - anchor)}px`; // whole px: never onto the meter
    } else {
      const w = Math.min(max, hi - anchor);
      s.width = `${w}px`;
      s.left = `${Math.ceil(anchor)}px`;
      s.right = "";
    }
  }

  // The tray at the screen's edge away from the meter (layout.js trayAt):
  // its foot at L.tray.foot, at the left or right edge, the plates' size and
  // each open plate's size as CSS variables (game.css .plans), so an open
  // plate grows up from its place, and in toward the middle at the right edge.
  place(L) {
    if (!L || !L.tray) return;
    const t = L.tray;
    const o = t.open;
    const key = `${L.W}x${L.H}:${t.edge}:${t.x}:${t.foot}:${t.plateW}:${o.arc.height}:${o.side.width}:${o.stand.height}:${L.meter}:${L.meterSide}`;
    if (this.cache.get("place") === key) return;
    this.cache.set("place", key);
    this.cache.set("placeL", L);
    const s = this.plans.style;
    const px = (v) => `${Math.round(v * 10) / 10}px`;
    this.plans.classList.toggle("at-left", t.edge === "left");
    this.plans.classList.toggle("at-right", t.edge === "right");
    this.plans.classList.toggle("phone", t.plateW < 100);
    s.left = t.edge === "left" ? px(t.x) : "";
    s.right = t.edge === "right" ? px(L.W - t.x - t.plateW) : "";
    s.top = "";
    s.bottom = px(L.H - t.foot);
    s.setProperty("--plate-w", px(t.plateW));
    s.setProperty("--plate-h", px(t.plateH));
    s.setProperty("--plate-gap", px(t.gap));
    for (const k of ["arc", "side", "stand"]) {
      s.setProperty(`--open-${k}-w`, px(o[k].width));
      s.setProperty(`--open-${k}-h`, px(o[k].height));
      this.tray.plates[k].el.classList.toggle("cover", !!o[k].cover);
    }
  }
}
