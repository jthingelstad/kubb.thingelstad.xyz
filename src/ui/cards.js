// The cards over the pitch, in the Playdate's words (render/cards.lua):
// the hand-off before a team's turn, the pass inside a team, the settle
// before a raise by hand, the winner; and the web's own: the solo options,
// a plain notice (a pitch that cannot be reached), and the raise and
// punishment panels. On a shared pitch `cards.who(need)` (set by
// src/net/pitch.js) says who acts: the engine's cards then name them, and a
// browser that only watches gets a WATCH button and the card closes itself.
import { h, button, clear } from "./dom.js";
import { prefs } from "../game/prefs.js";
import { levelLine, soloOptions } from "../game/throw-level.js";
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
  show(card, game = null, { modal = true, onClose = null } = {}) {
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
      onClose?.();
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
    const who = this.who?.(need);
    if (card.kind === "handoff") el = handoff(c, need, done, who && !who.mine);
    else if (card.kind === "pass") el = pass(c, done);
    else if (card.kind === "settle") el = settle(c, done);
    else return;
    if (who) {
      el.prepend(
        h(
          `p.whose${who.mine ? ".mine" : ""}`,
          { "data-test": "whose" },
          who.text,
        ),
      );
      if (!who.mine) {
        const go = el.querySelector(".row .btn");
        if (go) go.textContent = "WATCH";
      }
    }
    close = this.show(el, game);
    if (who && !who.mine) setTimeout(done, tune.watchCardMs);
  }

  // again: the rematch button's words; stop: a STOP button that calls it and
  // takes itself and the note away (the computer against itself). replay: a
  // WATCH REPLAY button (a finished pitch, src/replay/player.js), the card's
  // main action when `first`; replayLabel its words (REPLAY AGAIN); back: a
  // BACK TO THE PITCH button (the end of a replay); teams: a line naming who
  // played (a finished pitch, for a browser that arrived after the end); embed: an
  // EMBED button (src/ui/embed.js); reel: a highlight reel (src/ui/reel.js), whose
  // button goes beside EMBED; home: null leaves HOME out (an embed).
  winner(
    need,
    {
      rematch,
      again = "REMATCH",
      home,
      note = null,
      stop = null,
      sheet = null,
      replay = null,
      replayLabel = "WATCH REPLAY",
      first = false,
      back = null,
      teams = null,
      embed = null,
      reel = null,
    },
  ) {
    const w = need.winner || {};
    const lead =
      replay && first
        ? "replay"
        : rematch
          ? "rematch"
          : replay
            ? "replay"
            : "home";
    const replayBtn = () =>
      button(replayLabel, replay, lead === "replay" ? "go" : "", {
        "data-default": lead === "replay",
        "data-test": "watch-replay",
      });
    const stats = [`${w.turns} ${w.turns === 1 ? "turn" : "turns"}`];
    if (w.minutes != null)
      stats.push(w.minutes < 1 ? "under a min" : `${w.minutes} min`);
    if (w.thrown)
      stats.push(`baton hits ${Math.round((100 * w.hits) / w.thrown)}%`);
    const noteEl = note
      ? h("p.waiting", { "data-test": "winner-note" }, note)
      : null;
    const stopBtn = stop
      ? button(
          "STOP",
          () => {
            stop();
            noteEl?.remove();
            stopBtn.remove();
          },
          "",
          { "data-test": "stop" },
        )
      : null;
    const el = h(
      "div.card.winner",
      { "data-test": "winner" },
      h("p.kicker", need.short || "GAME"),
      h("h2.display", `${w.winnerName || ""} wins`),
      teams ? h("p.teams-line", { "data-test": "winner-teams" }, teams) : null,
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
      noteEl,
      h(
        "div.row",
        replay && first ? replayBtn() : null,
        rematch
          ? button(again, rematch, lead === "rematch" ? "go" : "", {
              "data-default": lead === "rematch",
              "data-test": "rematch",
            })
          : null,
        replay && !first ? replayBtn() : null,
        embed
          ? button("EMBED", embed, "", { "data-test": "winner-embed" })
          : null,
        reel ? reel.button("", { "data-test": "winner-reel" }) : null,
        stopBtn,
        sheet
          ? button("SCORE SHEET", sheet, "", { "data-test": "winner-sheet" })
          : null,
        back
          ? button("BACK TO THE PITCH", back, "", {
              "data-test": "replay-back-to-pitch",
            })
          : null,
        // no HOME in an embed: its way out is the link to the pitch
        home
          ? button("HOME", home, lead === "home" ? "go" : "", {
              "data-default": lead === "home",
            })
          : null,
      ),
    );
    return this.show(el);
  }

  // ---------- the solo options ----------

  // level: the device's throw level, shown, not picked (MENU sets it: menu() opens
  // it over this card, onLevel(f) hears a change); the Computer level row is the
  // computer's, a match option
  options(onStart, { home, level = null, menu = null, onLevel = null }) {
    const saved = soloSaved();
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
      return h(
        "div.opt",
        { "data-test": `solo-opt-${key}` },
        h("span.opt-label", label),
        seg.el,
      );
    });
    const levelText = h("span.opt-value", levelLine(level));
    const stopLevel = onLevel?.((v) => (levelText.textContent = levelLine(v)));
    const levelRow = level
      ? h(
          "div.opt",
          { "data-test": "solo-level" },
          h("span.opt-label", "Your level"),
          levelText,
          menu
            ? button("CHANGE IN MENU", () => menu(), "small", {
                "data-test": "solo-level-menu",
              })
            : null,
        )
      : null;
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
      levelRow,
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
    const close = this.show(el, null, { onClose: () => stopLevel?.() });
    return close;
  }

  // ---------- a plain notice (a pitch that cannot be reached) ----------

  // { kicker, title, text, actions: [[label, fn, kind?]], test }
  notice({ kicker = null, title, text, actions = [], test = "notice" }) {
    const el = h(
      "div.card.notice-card",
      { "data-test": test, role: "alert" },
      kicker ? h("p.kicker", kicker) : null,
      h("h2.display", title),
      text ? h("p", text) : null,
      h(
        "div.row",
        actions.map(([label, fn, kind = ""], i) =>
          button(label, fn, kind, i === 0 ? { "data-default": true } : {}),
        ),
      ),
    );
    return this.show(el);
  }

  // ---------- the raise and punishment panels (not modal) ----------

  tick(game) {
    const n = game.need;
    const phase = game.phase;
    const ar = game.autoRaise;
    const auto =
      phase === "raise" && ar ? (ar.game ? "game" : ar.turn ? "turn" : "") : "";
    const key =
      phase === "raise" || phase === "punish"
        ? `${phase}:${n.kubb}:${n.n}:${auto}`
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

export const tune = {
  watchCardMs: 2500, // a card for a turn this browser only watches
};

// The solo card's options as last saved (prefs "solo"), the computer's level moved
// across from the card's older Level row (src/game/throw-level.js).
export const soloSaved = () => ({
  ...SOLO_DEFAULTS,
  ...soloOptions(prefs.get("solo", {})),
});

export const SOLO_DEFAULTS = {
  name: "You",
  computer: "club",
  surface: "grass",
  opening: "2-4-6",
  raising: "hand",
  wind: "off",
  set: "classic",
};

const OPTION_ROWS = [
  [
    "computer",
    "Computer level",
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
// theirs: this browser only watches the turn (a shared pitch)
function handoff(c, need, done, theirs = false) {
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
  } else
    lines.push(`${theirs ? "they throw" : "you throw"} ${c.batons} batons`);
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

// Raising: an end for this kubb, AUTO (the engine's choice for this one) or
// AUTO ALL (for every kubb still to raise this turn). While the raising is
// automatic (AUTO ALL; MENU's Raising or REST OF GAME for the whole match)
// the panel only says so, with BY HAND to take it back
// (src/game/auto-raise.js).
function raisePanel(n, game) {
  const kicker = h("p.kicker", `${n.team || ""}  RAISE ${n.n} OF ${n.of}`);
  const ar = game.autoRaise;
  if (ar && (ar.game || ar.turn))
    return h(
      "div.panel",
      { "data-test": "raise" },
      kicker,
      h(
        "p.panel-text",
        { "data-test": "raise-note" },
        ar.game
          ? "Raising automatically for the rest of the game."
          : "Raising the rest automatically.",
      ),
      h(
        "div.row",
        button("BY HAND", () => game.setRaise("hand"), "small", {
          "data-test": "raise-hand",
        }),
        ar.game
          ? null
          : button("REST OF GAME", () => game.setRaise("auto"), "small", {
              "data-test": "raise-auto-game",
            }),
      ),
    );
  // The kubb on the pitch is the control (game.js raisePick, raise-touch.js):
  // END 1 and END 2 stay for the keyboard and screen readers, out of sight
  // until one has the keyboard's focus.
  const ends = (n.ends || []).map((e, i) =>
    button(
      e.ok === false ? `END ${i + 1}: ${e.why || "NO ROOM"}` : `END ${i + 1}`,
      () => game.raise(i),
      e.ok === false ? "small raise-end" : "small go raise-end",
      { disabled: e.ok === false, "data-test": `end-${i + 1}` },
    ),
  );
  return h(
    "div.panel",
    { "data-test": "raise" },
    kicker,
    h(
      "p.panel-text",
      { "data-test": "raise-text" },
      // two lines on a 390 px phone, the MENU, Raising sentence kept
      game.coarse
        ? "Touch the kubb or drag it to the end to stand it on. MENU, Raising for the rest of the game."
        : "Click the kubb to stand it up, nearer the end it should stand on. MENU, Raising does it for the rest of the game.",
    ),
    h(
      "div.row",
      ends,
      button("AUTO", () => game.raise(null), "small", {
        "data-test": "raise-auto",
      }),
      n.n < n.of
        ? button("AUTO ALL", () => game.raiseRest(), "small", {
            "data-test": "raise-auto-all",
          })
        : null,
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
