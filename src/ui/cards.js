// The cards over the pitch, in the Playdate's words (render/cards.lua):
// the hand-off before a team's turn, the pass inside a team, the settle
// before a raise by hand, the winner; and the web's own: the solo options,
// the multiplayer-is-coming card, and the raise and punishment panels.
import { h, button, clear } from "./dom.js";
import { prefs } from "../game/prefs.js";
import { drawMinimap } from "../render/minimap.js";
import { teamOf } from "../game/scenes.js";

export class Cards {
  constructor(root) {
    this.root = root;
    this.layer = h("div.card-layer", { "data-test": "cards" });
    this.panel = h("div.panel-host");
    root.append(this.panel, this.layer);
    this.open = null;
    this.panelKey = null;
  }

  // A card in the middle, over a dimmed pitch. Returns close().
  show(card, game = null, { modal = true } = {}) {
    this.close();
    const scrim = h("div.scrim", card);
    this.layer.append(scrim);
    if (game && modal) game.modal++;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      scrim.remove();
      if (game && modal) game.modal = Math.max(0, game.modal - 1);
      if (this.open === close) this.open = null;
    };
    this.open = close;
    const go = card.querySelector("[data-default]");
    if (go) requestAnimationFrame(() => go.focus({ preventScroll: true }));
    return close;
  }

  close() {
    if (this.open) this.open();
  }

  // ---------- the engine's cards ----------

  engineCard(card, need, game) {
    const c = card[card.kind];
    if (!c) return;
    let close;
    const done = () => close();
    let el;
    if (card.kind === "handoff") el = handoff(c, need, done);
    else if (card.kind === "pass") el = pass(c, done);
    else if (card.kind === "settle") el = settle(c, done);
    else return;
    close = this.show(el, game);
  }

  winner(need, { rematch, home }) {
    const w = need.winner || {};
    const stats = [`${w.turns} ${w.turns === 1 ? "turn" : "turns"}`];
    if (w.minutes != null)
      stats.push(w.minutes < 1 ? "under a min" : `${w.minutes} min`);
    if (w.thrown)
      stats.push(`baton hits ${Math.round((100 * w.hits) / w.thrown)}%`);
    const el = h(
      "div.card.winner",
      { "data-test": "winner" },
      h("p.kicker", need.short || "GAME"),
      h("h2.display", `${w.winnerName || ""} wins`),
      h("p", need.how || ""),
      h("p.stats", stats.join("  ·  ")),
      w.players
        ? h(
            "ul.players",
            w.players.map((p) =>
              h("li", `${p.name}: ${p.hits} of ${p.thrown} batons`),
            ),
          )
        : null,
      h(
        "div.row",
        button("REMATCH", rematch, "go", { "data-default": true }),
        button("HOME", home),
      ),
    );
    return this.show(el);
  }

  // ---------- the solo options ----------

  options(onStart, { home }) {
    const saved = { ...SOLO_DEFAULTS, ...prefs.get("solo", {}) };
    const name = h("input.name", {
      type: "text",
      maxlength: 16,
      value: saved.name,
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Your name",
    });
    const groups = {};
    const rows = OPTION_ROWS.map(([key, label, choices]) => {
      const seg = segmented(key, choices, saved[key]);
      groups[key] = seg;
      return h("div.opt", h("span.opt-label", label), seg.el);
    });
    const start = () => {
      const o = { name: name.value.trim().slice(0, 16) || "You" };
      for (const k of Object.keys(groups)) o[k] = groups[k].value();
      prefs.set("solo", o);
      close();
      onStart(o);
    };
    const el = h(
      "div.card.options",
      { "data-test": "options" },
      h("h2.display", "Play the computer"),
      h("label.opt", h("span.opt-label", "Your name"), name),
      rows,
      h(
        "div.row.start-row",
        button("START", start, "go big", {
          "data-default": true,
          "data-test": "start",
        }),
        button("HOME", home),
      ),
    );
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") start();
    });
    const close = this.show(el);
    return close;
  }

  // ---------- the multiplayer seam's card ----------

  multiplayer(code, { solo, home }) {
    const el = h(
      "div.card.coming",
      { "data-test": "coming" },
      h("p.kicker", `PITCH ${code}`),
      h("h2.display", "Multiplayer is coming"),
      h(
        "p",
        "Friends on one pitch, each in their own browser, is the next thing being built. Until then, this link plays the computer.",
      ),
      h(
        "div.row",
        button("PLAY THE COMPUTER", solo, "go", {
          "data-default": true,
          "data-test": "play-computer",
        }),
        button("HOME", home),
      ),
    );
    return this.show(el);
  }

  // ---------- the raise and punishment panels (not modal) ----------

  tick(game) {
    const n = game.need;
    const phase = game.phase;
    const key =
      phase === "raise" || phase === "punish"
        ? `${phase}:${n.kubb}:${n.n}`
        : phase === "wait"
          ? "wait"
          : null;
    if (key !== this.panelKey) {
      this.panelKey = key;
      clear(this.panel);
      this.panelEl = null;
      if (phase === "raise") this.panelEl = raisePanel(n, game);
      else if (phase === "punish") this.panelEl = punishPanel(n, game);
      if (this.panelEl) this.panel.append(this.panelEl);
    }
    if (phase === "punish" && this.panelEl) {
      const why = this.panelEl.querySelector(".why");
      const ck = game.punishCheck;
      const t = ck && ck.ok === false ? ck.label || ck.why || "NOT THERE" : "";
      if (why.textContent !== t) why.textContent = t;
      why.hidden = !t;
      this.panelEl.querySelector("[data-test=place]").disabled = !!t;
    }
  }

  clearPanel() {
    this.panelKey = null;
    clear(this.panel);
  }
}

export const SOLO_DEFAULTS = {
  name: "You",
  level: "club",
  surface: "grass",
  opening: "2-4-6",
  raising: "hand",
  wind: "off",
  set: "classic",
};

const OPTION_ROWS = [
  [
    "level",
    "Level",
    [
      ["beginner", "Beginner"],
      ["club", "Club"],
      ["pro", "Pro"],
    ],
  ],
  [
    "surface",
    "Surface",
    [
      ["grass", "Grass"],
      ["sand", "Sand"],
      ["snow", "Snow"],
    ],
  ],
  [
    "opening",
    "Opening",
    [
      ["2-4-6", "2-4-6"],
      ["six", "Six batons"],
    ],
  ],
  [
    "raising",
    "Raising",
    [
      ["hand", "By hand"],
      ["auto", "Automatic"],
    ],
  ],
  [
    "wind",
    "Wind",
    [
      ["off", "Off"],
      ["light", "Light"],
      ["strong", "Strong"],
    ],
  ],
  [
    "set",
    "Kubbs",
    [
      ["classic", "Classic"],
      ["usa", "USA"],
      ["sweden", "Sweden"],
      ["minnesota", "Minnesota"],
      ["wisconsin", "Wisconsin"],
    ],
  ],
];

function segmented(key, choices, value) {
  let current = choices.some(([v]) => v === value) ? value : choices[0][0];
  const btns = choices.map(([v, label]) =>
    h(
      "button.seg-btn",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(v === current),
        "data-value": v,
        onclick: () => {
          current = v;
          for (const b of btns)
            b.setAttribute("aria-checked", String(b.dataset.value === v));
        },
      },
      label,
    ),
  );
  return {
    el: h("div.seg", { role: "radiogroup", "data-key": key }, btns),
    value: () => current,
  };
}

// The Playdate's hand-off card: who it goes to, what the last turn took,
// what this one throws, the bases, and the pitch from above.
function handoff(c, need, done) {
  const took = c.took
    ? c.took.field || c.took.base
      ? `${c.fromName} just took ${[
          c.took.field ? `${c.took.field} field` : null,
          c.took.base ? `${c.took.base} base` : null,
        ]
          .filter(Boolean)
          .join(", ")}`
      : `${c.fromName} took none`
    : "the first turn";
  const lines = [];
  if (c.kubbs) {
    lines.push(`${c.kubbs} ${c.kubbs === 1 ? "kubb" : "kubbs"} in`);
    lines.push(`then ${c.batons} batons`);
  } else lines.push(`you throw ${c.batons} batons`);
  if (c.thrower) lines.push(`${c.thrower} first`);
  const map = h("canvas.card-map", { width: 120, height: 200 });
  drawCardMap(map, c, need);
  return h(
    "div.card.handoff",
    { "data-test": "handoff" },
    h(
      "div.handoff-body",
      h(
        "div",
        h("p.kicker", `TURN ${c.turn}`),
        h("h2.display", `${c.toName}`),
        h("p.took", took),
        h(
          "ul.lines",
          lines.map((t) => h("li", t)),
        ),
        h(
          "p.bases",
          (c.baseText || []).map((t) => h("span.chip", t)),
        ),
      ),
      map,
    ),
    h(
      "div.row",
      button("THROW", done, "go", {
        "data-default": true,
        "data-test": "handoff-go",
      }),
    ),
  );
}

function drawCardMap(canvas, c, need) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const W = 120,
    H = 200;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const items = (c.pieces || []).map((p) => ({
    id: p.id,
    kind: p.kind === "king" ? "king" : "kubb",
    x: p.x,
    y: p.y,
    toppled: !!p.down,
    team: teamOf(p.id),
  }));
  drawMinimap(
    ctx,
    { x: 4, y: 4, width: W - 8, height: H - 8 },
    {
      // a base kubb knocked down leaves its slot empty
      items: items.filter(
        (p, i) => !(c.pieces[i].kind === "base" && p.toppled),
      ),
      surface: need?.setup?.surface || "grass",
    },
  );
}

function pass(c, done) {
  const what =
    c.kind === "kubbs"
      ? "the kubbs in"
      : c.from === c.to
        ? `baton ${c.from}`
        : `batons ${c.from} to ${c.to}`;
  return h(
    "div.card.pass",
    { "data-test": "pass" },
    h("p.kicker", c.team),
    h("h2.display", `Over to ${c.name}`),
    h("p", `${c.name} throws ${what}`),
    h("div.row", button("READY", done, "go", { "data-default": true })),
  );
}

function settle(c, done) {
  const parts = [];
  if (c.raise)
    parts.push(`raise ${c.raise} ${c.raise === 1 ? "kubb" : "kubbs"} up`);
  if (c.punish)
    parts.push(
      `place ${c.punish} punishment ${c.punish === 1 ? "kubb" : "kubbs"}`,
    );
  return h(
    "div.card.settle",
    { "data-test": "settle" },
    h("h2.display", c.toName),
    h("p", `You ${parts.join(" and ")}, then hand it back to ${c.backName}.`),
    h("div.row", button("READY", done, "go", { "data-default": true })),
  );
}

function raisePanel(n, game) {
  const ends = (n.ends || []).map((e, i) =>
    button(
      e.ok === false ? `END ${i + 1}: ${e.why || "NO ROOM"}` : `END ${i + 1}`,
      () => game.raise(i),
      e.ok === false ? "small" : "small go",
      { disabled: e.ok === false, "data-test": `end-${i + 1}` },
    ),
  );
  return h(
    "div.panel",
    { "data-test": "raise" },
    h("p.kicker", `${n.team || ""}  RAISE ${n.n} OF ${n.of}`),
    h("p.panel-text", "Tap the end to stand it on."),
    h(
      "div.row",
      ends,
      button("AUTOMATIC", () => game.raise(null), "small", {
        "data-test": "raise-auto",
      }),
    ),
  );
}

function punishPanel(n, game) {
  return h(
    "div.panel",
    { "data-test": "punish" },
    h("p.kicker", `${n.team || ""}  PUNISHMENT KUBB ${n.n} OF ${n.of}`),
    h("p.panel-text", "Drag or tap a spot in your half, clear of the circles."),
    h("p.why", { hidden: true }),
    h(
      "div.row",
      button("PLACE IT", () => game.punish(), "small go", {
        "data-test": "place",
      }),
    ),
  );
}
