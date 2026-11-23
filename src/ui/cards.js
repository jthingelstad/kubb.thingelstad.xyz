// The cards over the pitch, in the Playdate's words (render/cards.lua):
// the hand-off before a team's turn, the pass inside a team, the settle
// before a raise by hand, the winner; and the web's own: the solo options,
// a plain notice (a pitch that cannot be reached), and the raise and
// punishment panels. On a shared pitch `cards.who(need)` (set by
// src/net/pitch.js) says who acts: the engine's cards then name them, and a
// browser that only watches gets a WATCH button and the card closes itself.
import { MAX_MINUTES } from "../game/clock.js";
import { h, button, clear } from "./dom.js";
import { prefs } from "../game/prefs.js";
import { soloOptions } from "../game/throw-level.js";
import { youRow } from "./settings.js";
import { segBar } from "./seg.js";
import { sceneId } from "../render/scenes.js";
import { optionRows } from "../net/lobby.js";
import { sceneTiles } from "./scene-tiles.js";
import {
  handoffCpu,
  handoffKid,
  handoffLine,
  handoffTitle,
} from "./handoff-words.js";

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
  // hand-off, so the thrower's dial is seen while it is up). foot: at the foot
  // of the screen, the header shown over the dim (the 1.0 design's hand-off).
  show(
    card,
    game = null,
    { modal = true, onClose = null, banner = false, foot = false } = {},
  ) {
    this.close();
    const scrim = h(
      banner ? "div.scrim.banner" : foot ? "div.scrim.at-foot" : "div.scrim",
      card,
    );
    this.layer.append(scrim);
    // a card that dims the pitch (all but a watched turn's banner): the game
    // draws no meter round it
    this.dims = !banner;
    if (game && modal) game.modal++;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      scrim.remove();
      if (game && modal) game.modal = Math.max(0, game.modal - 1);
      if (this.open === close) {
        this.open = null;
        this.dims = false;
      }
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
    // the 1.0 design's hand-off: a short card at the foot of the screen, its
    // title ("Your turn" for this browser's own turn, else the name's), one
    // line from the engine's state and one go button; the settle card before a
    // raise or punishment by hand is the same card. "Your turn" where this
    // browser plays the side alone (solo, or its turn on a shared pitch).
    const theirs = (who && !who.mine) || watcher;
    const mine = who
      ? !!who.mine
      : !watcher && (game?.seat?.sides?.length ?? 1) <= 1;
    if (card.kind === "handoff")
      el = shortCard(
        c.toName,
        mine,
        handoffLine(need),
        theirs ? "WATCH" : "THROW",
        done,
        "handoff",
        handoffKid(need),
        handoffCpu(c),
      );
    else if (card.kind === "settle")
      el = shortCard(
        c.toName,
        mine,
        handoffLine(need, c),
        theirs ? "WATCH" : "READY",
        done,
        "settle",
        handoffKid(need),
      );
    else if (card.kind === "pass") el = pass(c, done);
    else return;
    if (who && card.kind === "pass") {
      el.prepend(
        h(
          `p.whose${who.mine ? ".mine" : ""}`,
          { "data-test": "whose" },
          who.text,
        ),
      );
    }
    if (theirs && card.kind === "pass") {
      const go = el.querySelector(".row .btn");
      if (go) go.textContent = "WATCH";
    }
    // someone else's turn on a shared pitch: the card's words as a banner over the live
    // pitch, so their aim is seen from the first moment (docs/MULTIPLAYER.md "Aim")
    const watched = !!who && !who.mine;
    close = this.show(
      el,
      game,
      watched
        ? { modal: false, banner: true }
        : card.kind === "pass"
          ? { onClose: () => nextControl(this.root) }
          : { foot: true, onClose: () => nextControl(this.root) },
    );
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
    // the length only when it is known: since engine 0.18.0 `minutes` is nil when no
    // action carried the clock (every action made here is stamped: Game.stamp), and
    // never one that cannot be true (a stamp from a clock gone wrong). A match from
    // before kept 0 for "no stamp", so 0 says nothing either.
    if (w.minutes >= 1 && w.minutes <= MAX_MINUTES)
      stats.push(`${w.minutes} min`);
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
  // scene: the Scene's value when the address names one (?scene=), else the saved
  // one; onScene(id) hears it picked, so the pitch behind the card can show it.
  //
  // The card is scene first (engine 0.14, the engine's docs/PITCH.md `optionRows`):
  // its rows are the engine's for the scene picked, `pitch.optionRows({ scene })`:
  // the Scene as seven picture tiles with the engine's names, a Surface row only
  // where the scene leaves one (Black & White: grass, sand, snow), no Kubbs row (the
  // scene decides the set), then Computer level (Kid first since 0.15), Opening,
  // Raising and Wind. Picking another scene takes its rows and its defaults. HOME
  // quiet at the left, START go at the right. game: the Game behind the card, which
  // draws the tiles' pictures (sceneThumb).
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
    const saved = soloSaved(scene ? { scene } : null);
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
    const values = { ...saved };
    let card = soloCard(values.scene);
    const sceneRow = card.rows.find(([k]) => k === "scene");
    const tiles = sceneTiles({
      choices: sceneRow[2],
      value: values.scene,
      game,
      labelledBy: "solo-label-scene",
      onPick: (v) => {
        values.scene = v;
        card = soloCard(v);
        // the new scene's surface and set: the one kept where it allows it
        Object.assign(values, throughScene(values, card));
        drawRows();
        onScene?.(v);
      },
    });
    const rowsBox = h("div.opt-rows");
    const drawRows = () => {
      rowsBox.replaceChildren(
        ...card.rows
          .filter(([k]) => k !== "scene" && k !== "set")
          .sort((a, b) => ROW_ORDER.indexOf(a[0]) - ROW_ORDER.indexOf(b[0]))
          .map(([key, label, choices]) => {
            const id = `solo-label-${key}`;
            const seg = segBar({
              choices,
              value: values[key],
              key,
              labelledBy: id,
              onPick: (v) => {
                values[key] = v;
              },
            });
            return h(
              "div.opt",
              { "data-test": `solo-opt-${key}` },
              h("span.opt-label", { id }, ROW_LABEL[key] ?? label),
              seg.el,
            );
          }),
      );
    };
    drawRows();
    const start = () => {
      const o = { ...values, ...throughScene(values, card) };
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
        h("span.opt-label", { id: "solo-label-scene" }, sceneRow[1]),
        tiles.el,
      ),
      rowsBox,
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
  // A kept match against the computer (src/game/solo-save.js): RESUME (go) and NEW
  // MATCH. words: RESUME_WORDS; sceneName the scene's shown name.
  resume(save, words, sceneName, { resume, fresh }) {
    let close;
    const el = h(
      "div.card.resume-card",
      { "data-test": "resume", role: "dialog", "aria-label": words.title },
      h("p.kicker", words.kicker),
      h("h2.display", words.title),
      h("p", { "data-test": "resume-text" }, words.text(save, sceneName)),
      h(
        "div.card-foot",
        button(words.fresh, () => (close(), fresh()), "", {
          "data-test": "resume-new",
        }),
        button(words.resume, () => (close(), resume()), "go", {
          "data-default": true,
          "data-test": "resume-go",
        }),
      ),
    );
    close = this.show(el);
    return close;
  }

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
// across from the card's older Level row (src/game/throw-level.js), and the surface
// and set through the scene (engine 0.14: a scene decides them, so a choice of
// surface or set kept from before may come back changed). over: values to take
// first (the address's ?scene=). The name is the device's now
// (src/game/player-name.js moves an older card's across).
export const soloSaved = (over = null) => {
  const o = {
    ...SOLO_DEFAULTS,
    ...soloOptions(prefs.get("solo", {})),
    ...(over || {}),
  };
  delete o.name;
  o.scene = sceneId(o.scene); // one this copy does not draw: the day
  return { ...o, ...throughScene(o, soloCard(o.scene)) };
};

// The engine's card for a scene (pitch.optionRows): { scene, rows, defaults }. Without
// a room engine (a test of the card alone) the scene alone and the day's defaults.
export function soloCard(scene) {
  try {
    return optionRows(scene);
  } catch {
    return {
      scene,
      rows: [["scene", "Scene", [[scene, scene]]]],
      defaults: { surface: "grass", set: "classic" },
    };
  }
}

// The surface and set a card's scene takes from values `o`: the kept one where the
// scene's rows offer it, else the scene's default.
export function throughScene(o, card) {
  const pick = (key) => {
    const row = card.rows.find(([k]) => k === key);
    return row && row[2].some(([v]) => v === o[key])
      ? o[key]
      : card.defaults?.[key];
  };
  return { surface: pick("surface"), set: pick("set") };
}

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

// The rows under the Scene tiles, in the design's order: the engine's rows (its
// labels and values) but Computer level first, as the design put it; "Computer
// level" as the iPhone app and the lobby say it (the engine's label is "Computer").
export const ROW_ORDER = ["surface", "computer", "opening", "raising", "wind"];
export const ROW_LABEL = { computer: "Computer level" };

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
    "div.card.sheet.share-choices",
    {
      "data-test": "share-choices",
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
        "data-test": "share-choices-back",
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

// The hand-off card (the 1.0 design, "Hand-off"): the title, one line, one go
// button; no turn number and no map (the header says the turn, the minimap the
// pitch). Also the settle card's, before a raise or punishment by hand. line:
// handoffLine's { state, text }.
function shortCard(name, mine, line, go, done, kind, kid = null, cpu = null) {
  return h(
    `div.card.handoff.short`,
    { "data-test": kind, "data-line": line.state || "" },
    // a Kid match says so over the title (handoffKid)
    kid ? h("p.kicker", { "data-test": `${kind}-kid` }, kid) : null,
    h("h2.display", { "data-test": `${kind}-title` }, handoffTitle(name, mine)),
    line.text
      ? h("p.handoff-line", { "data-test": `${kind}-line` }, line.text)
      : null,
    // the turn opens with a computer player (engine 0.17)
    cpu ? h("p.handoff-cpu", { "data-test": `${kind}-cpu` }, cpu) : null,
    h(
      "div.row",
      button(go, done, "go wide", {
        "data-default": true,
        "data-test": `${kind}-go`,
      }),
    ),
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
        button("AUTO", () => game.raiseAuto(), "small", {
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

// After a hand-off (or the settle or pass card) closes, the keyboard goes to what it
// needs next instead of being left on the page: the raise or punishment panel's first
// choice (END 1 shows itself when focused), else the meter's stand-in, which says how
// to throw. Only when the focus was on the card (it is now on nothing): a press on the
// pitch or a pointer elsewhere keeps its own. Two frames: the panel is built by the
// game's next frame.
export function nextControl(root, doc = globalThis.document) {
  if (!doc) return;
  const lost = () => {
    const a = doc.activeElement;
    return !a || a === doc.body || !a.isConnected;
  };
  if (!lost()) return;
  const shown = (el) =>
    !!el &&
    !el.disabled &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const pick = () => {
    if (!lost()) return true;
    const panel = [
      ...(root ?? doc).querySelectorAll(".panel-host .panel button"),
    ].find((b) => !b.disabled);
    const target =
      panel ?? [...doc.querySelectorAll("[data-test=meter-proxy]")].find(shown);
    if (!target) return false;
    target.focus({ preventScroll: true });
    return true;
  };
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!pick()) setTimeout(pick, 300);
    }),
  );
}
