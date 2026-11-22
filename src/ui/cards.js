// The cards over the pitch, in the Playdate's words (render/cards.lua):
// the hand-off before a team's turn, the pass inside a team, the settle
// before a raise by hand, the winner; and the web's own: the solo options,
// a plain notice (a pitch that cannot be reached), and the raise and
// punishment panels. On a shared pitch `cards.who(need)` (set by
// src/net/pitch.js) says who acts: the engine's cards then name them, and a
// browser that only watches gets a WATCH button and the card closes itself.
import { h, button, clear } from "./dom.js";
import { prefs } from "../game/prefs.js";
import { soloOptions } from "../game/throw-level.js";
import { youRow } from "./settings.js";
import { segBar } from "./seg.js";
import { drawMinimap } from "../render/minimap.js";
import { teamOf } from "../game/scenes.js";
import { SCENE_ROW, sceneId } from "../render/scenes.js";
import { watcherBases } from "./handoff-words.js";

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
  // banner: at the top with the pitch undimmed and live under it (a watched turn's
  // hand-off, so the thrower's dial is seen while it is up).
  show(
    card,
    game = null,
    { modal = true, onClose = null, banner = false } = {},
  ) {
    this.close();
    const scrim = h(banner ? "div.scrim.banner" : "div.scrim", card);
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
    // a browser with no side in the match (docs/OBSERVER.md): the card speaks of the
    // teams, not to one of them
    const watcher = !!game && !game.localSide && !game.seat?.sides?.length;
    if (card.kind === "handoff")
      el = handoff(c, need, done, (who && !who.mine) || watcher, watcher);
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
    }
    if ((who && !who.mine) || watcher) {
      const go = el.querySelector(".row .btn");
      if (go) go.textContent = "WATCH";
    }
    // someone else's turn on a shared pitch: the card's words as a banner over the live
    // pitch, so their aim is seen from the first moment (docs/MULTIPLAYER.md "Aim")
    const watched = !!who && !who.mine;
    close = this.show(el, game, watched ? { modal: false, banner: true } : {});
    if (watched) setTimeout(done, tune.watchCardMs);
  }

  // The winner card (the 1.0 design): the go button first and full width (REMATCH,
  // or WATCH REPLAY when `first`, or NEXT MATCH), then WATCH REPLAY and SCORE SHEET
  // plain side by side, one SHARE that opens the link, the reel and the embed, and
  // HOME quiet at the foot.
  //
  // again: the rematch button's words; stop: a STOP button that calls it and
  // takes itself and the note away (the computer against itself). replay: a
  // WATCH REPLAY button (a finished pitch, src/replay/player.js), the card's
  // main action when `first`; replayLabel its words (REPLAY AGAIN); back: a
  // BACK TO THE PITCH button (the end of a replay); teams: a line naming who
  // played (a finished pitch, for a browser that arrived after the end). share:
  // SHARE's card, { link?, embed?, reel? } (embed: EMBED's opener, src/ui/embed.js;
  // reel: a highlight reel, src/ui/reel.js; link: the pitch's address), or for a
  // match against the computer `shareMatch`, the share card (src/ui/share.js),
  // which makes the link and the reel. home: null leaves HOME out (an embed).
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
      link = null,
      shareMatch = null,
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
            : null;
    const replayBtn = () =>
      button(replayLabel, replay, lead === "replay" ? "go wide" : "", {
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
    const shareOpts = embed || reel || link ? { embed, reel, link } : null;
    const shareBtn =
      shareMatch || shareOpts
        ? button(
            "SHARE",
            () =>
              shareMatch
                ? shareMatch.open()
                : openShareCard(this.root, shareOpts),
            "wide",
            { "data-test": "winner-share" },
          )
        : null;
    const pair = [lead === "replay" ? null : replay ? replayBtn() : null];
    if (sheet)
      pair.push(
        button("SCORE SHEET", sheet, "", { "data-test": "winner-sheet" }),
      );
    if (stopBtn) pair.push(stopBtn);
    if (back)
      pair.push(
        button("BACK TO THE PITCH", back, "", {
          "data-test": "replay-back-to-pitch",
        }),
      );
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
      lead === "replay"
        ? replayBtn()
        : rematch
          ? button(again, rematch, "go wide", {
              "data-default": true,
              "data-test": "rematch",
            })
          : null,
      h("div.card-pair", pair.filter(Boolean)),
      shareBtn,
      // no HOME in an embed: its way out is the link to the pitch
      home
        ? h(
            "div.card-foot",
            button("HOME", home, "quiet", {
              "data-default": !lead,
              "data-test": "winner-home",
            }),
          )
        : null,
    );
    // a rematch from the replay's end (REPLAY AGAIN first) keeps its button
    if (lead === "replay" && rematch)
      el.querySelector(".card-pair").prepend(
        button(again, rematch, "", { "data-test": "rematch" }),
      );
    return this.show(el);
  }

  // ---------- the solo options ----------

  // The Computer level row is the computer's, a match option; a person's own level
  // is not shown (from engine 0.13 a person throws on one meter). name: the
  // device's name (src/game/player-name.js), a generated one, in the You row's name
  // row (src/ui/name-row.js): a pick there is the device's name (setName); onName(f)
  // hears a change made in MENU. names: the engine's door (src/game/names.js).
  // scene: the Scene row's value when the address names one (?scene=), else the
  // saved one; onScene(id) hears it picked, so the pitch behind the card can show it.
  //
  // The card (the 1.0 design, "Play the computer", direction A): the name row, the
  // Scene as three picture tiles, then Computer level, Opening, Raising and Wind, and
  // Surface as a fifth row until a scene decides the ground; HOME quiet at the left,
  // START go at the right. There is no Kubbs row: the scene decides the set (the
  // night and the neon have always played their own; the day plays Classic).
  // game: the Game behind the card, which draws the tiles' pictures (sceneThumb).
  options(
    onStart,
    {
      home,
      names,
      name: kept,
      setName = null,
      onName = null,
      scene = null,
      onScene = null,
      game = null,
    },
  ) {
    const saved = soloSaved();
    if (scene) saved.scene = sceneId(scene);
    onScene?.(saved.scene);
    let current = kept;
    // the name row: the name and SHUFFLE
    const you = youRow("solo", {
      names,
      name: kept,
      setName: (t) => {
        current = t;
        setName?.(t);
      },
    });
    const stopName = onName?.((v) => {
      current = v;
      you.setName(v);
    });
    const groups = {};
    const tiles = sceneTiles(saved.scene, onScene, game);
    groups.scene = tiles;
    const rows = OPTION_ROWS.map(([key, label, choices]) => {
      const id = `solo-label-${key}`;
      const seg = segBar({
        choices,
        value: saved[key],
        key,
        labelledBy: id,
      });
      groups[key] = seg;
      return h(
        "div.opt",
        { "data-test": `solo-opt-${key}` },
        h("span.opt-label", { id }, label),
        seg.el,
      );
    });
    const start = () => {
      const o = {};
      for (const k of Object.keys(groups)) o[k] = groups[k].value();
      // the scene decides the set (no Kubbs row): the day plays Classic
      o.set = SOLO_DEFAULTS.set;
      // the match options are kept for the next card; the name is the device's
      prefs.set("solo", o);
      close();
      onStart({ ...o, name: current });
    };
    const el = h(
      "div.card.options",
      { "data-test": "options" },
      h("h2.display", "Play the computer"),
      you.el,
      h("hr.rule"),
      h(
        "div.opt.opt-scene",
        { "data-test": "solo-opt-scene" },
        h("span.opt-label", { id: "solo-label-scene" }, SCENE_ROW[1]),
        tiles.el,
      ),
      rows,
      h(
        "div.card-foot.start-row",
        button("HOME", home, "quiet", { "data-test": "solo-home" }),
        button("START", start, "go big", {
          "data-default": true,
          "data-test": "start",
        }),
      ),
    );
    const close = this.show(el, null, {
      onClose: () => {
        stopName?.();
        tiles.stop();
      },
    });
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
          button(
            label,
            fn,
            // leaving is quiet unless the card makes it the one thing to do
            kind || (label === "HOME" ? "quiet" : ""),
            i === 0 ? { "data-default": true } : {},
          ),
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
// The name is the device's now (src/game/player-name.js moves an older card's across).
export const soloSaved = () => {
  const o = { ...SOLO_DEFAULTS, ...soloOptions(prefs.get("solo", {})) };
  delete o.name;
  o.scene = sceneId(o.scene); // one this copy does not draw: the day
  return o;
};

export const SOLO_DEFAULTS = {
  computer: "club",
  surface: "grass",
  opening: "2-4-6",
  raising: "hand",
  wind: "off",
  set: "classic",
  scene: "day",
};

// PLAY NOW on the landing page (the 1.0 design: "drops a first-time visitor
// straight into a match on defaults"): a device with no kept match options starts
// at once on these, Park (the day scene), a Beginner computer, 2-4-6, raising by
// hand, no wind; one that has kept options (it pressed START, or played a PLAY NOW
// match, which keeps these) gets the card. A saved name alone is not options.
export const FIRST_MATCH = {
  ...SOLO_DEFAULTS,
  computer: "beginner",
  scene: "day",
  opening: "2-4-6",
  raising: "hand",
  wind: "off",
};
export const soloKept = (saved) =>
  !!saved &&
  typeof saved === "object" &&
  Object.keys(saved).some((k) => k !== "name");

// The rows under the Scene tiles, in the design's order, with Surface last until a
// scene decides the ground. The Kubbs row is gone (the scene decides the set).
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
    "surface",
    "Surface",
    [
      ["grass", "Grass"],
      ["sand", "Sand"],
      ["snow", "Snow"],
    ],
  ],
];
export const SOLO_ROWS = ["scene", ...OPTION_ROWS.map(([k]) => k)];

// The Scene's three picture tiles: each the pitch behind the card drawn in that
// scene by the game itself (Game.sceneThumb), its name (SCENE_NAMES) under it. A
// radio group like the segmented bar: one Tab stop, the arrow keys inside. onPick(v)
// hears a pick (the pitch behind shows it). stop() ends the drawing.
function sceneTiles(value, onPick, game) {
  const choices = SCENE_ROW[2];
  let current = choices.some(([v]) => v === value) ? value : choices[0][0];
  const canvases = [];
  const btns = choices.map(([v, label]) => {
    const canvas = h("canvas", {
      width: 192,
      height: 112,
      "aria-hidden": "true",
    });
    canvases.push([canvas, v]);
    return h(
      "button.tile",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(v === current),
        tabindex: v === current ? "0" : "-1",
        "data-value": v,
        "data-test": `scene-tile-${v}`,
        onclick: () => pick(v),
        onkeydown: (e) => {
          const i = choices.findIndex(([c]) => c === current);
          const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
            e.key
          ];
          let j = d ? (i + d + choices.length) % choices.length : null;
          if (e.key === "Home") j = 0;
          if (e.key === "End") j = choices.length - 1;
          if (j === null) return;
          e.preventDefault();
          pick(choices[j][0]);
          btns[j].focus();
        },
      },
      canvas,
      h("span.tile-name", label),
    );
  });
  function pick(v) {
    current = v;
    for (const b of btns) {
      const on = b.dataset.value === v;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    onPick?.(v);
  }
  // the pictures: drawn once the game has a frame to draw them from
  let tries = 0;
  let raf = 0;
  const draw = () => {
    raf = 0;
    const done = canvases.every(([c, v]) => game?.sceneThumb?.(c, v));
    if (!done && game && ++tries < 120) raf = requestAnimationFrame(draw);
  };
  if (game) raf = requestAnimationFrame(draw);
  return {
    el: h(
      "div.tiles",
      {
        role: "radiogroup",
        "aria-labelledby": "solo-label-scene",
        "data-key": "scene",
      },
      btns,
    ),
    value: () => current,
    stop: () => raf && cancelAnimationFrame(raf),
  };
}

// SHARE on the winner card of a finished pitch (the 1.0 design: "one SHARE button
// that opens link, reel and embed"): the pitch's link with COPY LINK, MAKE A
// HIGHLIGHT REEL (its button follows the reel, src/ui/reel.js) and EMBED, over the
// winner card, which stays. BACK, Escape and a press outside close it.
export function openShareCard(
  root,
  { link = null, reel = null, embed = null },
) {
  const status = h("p.sheet-status", {
    role: "status",
    "data-test": "share-status",
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = "Copied the link.";
    } catch {
      status.textContent = "Could not copy. The link is shown to copy.";
    }
  };
  const close = () => {
    scrim.remove();
    for (const el of quieted) el.inert = false;
    window.removeEventListener("keydown", esc);
  };
  const run = (fn) => () => {
    close();
    fn();
  };
  const body = h(
    "div.card.sheet.share-card",
    {
      "data-test": "share-card",
      role: "dialog",
      "aria-label": "Share this match",
    },
    h("h2.display", "Share this match"),
    link
      ? h(
          "div.share-link",
          h("span.link-text", { "data-test": "share-link" }, link),
          button("COPY LINK", copy, "", { "data-test": "share-copy" }),
        )
      : null,
    status,
    h(
      "div.card-pair",
      reel ? reel.button("", { "data-test": "winner-reel" }) : null,
      embed
        ? button("EMBED", run(embed), "", { "data-test": "winner-embed" })
        : null,
    ),
    h(
      "div.card-foot",
      button("BACK", close, "quiet", {
        "data-default": true,
        "data-test": "share-card-back",
      }),
    ),
  );
  const scrim = h("div.scrim.sheet-scrim", body);
  scrim.addEventListener("pointerdown", (e) => {
    if (e.target === scrim) close();
  });
  const esc = (e) => {
    if (e.key === "Escape") close();
  };
  root.append(scrim);
  const quieted = [...root.children].filter((el) => el !== scrim && !el.inert);
  for (const el of quieted) el.inert = true;
  window.addEventListener("keydown", esc);
  // the reel's own card opens over this one: close this one first
  body
    .querySelector("[data-test=winner-reel]")
    ?.addEventListener("click", () => close(), { capture: true });
  requestAnimationFrame(() =>
    body.querySelector("button")?.focus({ preventScroll: true }),
  );
  return { close };
}

// The Playdate's hand-off card: who it goes to, what the last turn took,
// what this one throws, the bases, and the pitch from above.
// theirs: this browser only watches the turn (a shared pitch); watcher: it has no
// side in the match, so the bases name both teams (src/ui/handoff-words.js)
function handoff(c, need, done, theirs = false, watcher = false) {
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
          (watcher ? watcherBases(c, need) : c.baseText || []).map((t) =>
            h("span.chip", t),
          ),
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

// Raising: an end for this kubb, AUTO (the engine's choice for this one), AUTO
// ALL (for every kubb still to raise this turn) or REST OF GAME (every raise from
// now to the end of the match). Raising is a match option (the solo card's and the
// lobby's Raising), so the part-way choice is here on the raise controls, not in
// MENU. While the raising is automatic the panel only says so, with BY HAND to
// take it back (src/game/auto-raise.js).
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
      slots(
        [
          button("BY HAND", () => game.setRaise("hand"), "small", {
            "data-test": "raise-hand",
          }),
          ar.game
            ? null
            : button("REST OF GAME", () => game.setRaise("auto"), "small", {
                "data-test": "raise-auto-game",
              }),
        ],
        [],
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
      // two lines on a 390 px phone
      game.coarse
        ? "Touch the kubb or drag it to the end to stand it on."
        : "Click the kubb to stand it up, nearer the end it should stand on.",
    ),
    slots(
      [
        button("AUTO", () => game.raise(null), "small", {
          "data-test": "raise-auto",
        }),
        n.n < n.of
          ? button("AUTO ALL", () => game.raiseRest(), "small", {
              "data-test": "raise-auto-all",
            })
          : null,
        button("REST OF GAME", () => game.setRaise("auto"), "small", {
          "data-test": "raise-auto-game",
        }),
      ],
      ends,
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
    slots(
      [],
      [
        button("PLACE IT", () => game.punish(), "small go", {
          "data-test": "place",
        }),
      ],
    ),
  );
}

// The panel's buttons in two fixed slots, in every state (the 1.0 design's one rule
// for this panel): the automatic choices, plain, at the left; the one confirming
// action (PLACE IT; raising by hand, END 1 and END 2, out of sight until focused)
// at the right.
function slots(autos, confirm) {
  return h(
    "div.row.panel-slots",
    h("div.panel-auto", autos.filter(Boolean)),
    h("div.panel-confirm", confirm.filter(Boolean)),
  );
}
