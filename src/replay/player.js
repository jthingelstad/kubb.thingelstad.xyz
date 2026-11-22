// A finished match played again on the Game (docs/CLIENT.md "Replays"; Jamie,
// 2026-11-16: "When a game is finished playing on a pitch I'd like the URL to allow
// people to come and watch a replay of the match."). Not a video: the engine sets the
// match out from its options and plays each committed action in turn
// (vendor/engine/session/replay.lua), the same throws with the same physics, drawn as any match is.
//
//   const p = await startReplay({ game, root, code, url });     // by a pitch's code
//   const p = new ReplayPlayer({ game, root, data }); p.start(); // a replay in hand
//   p.destroy();                                                 // the Game as it was
//
// A replay plays on the match's own engine when the site carries it (`engines`, the
// page's src/engine/registry.js, or `engine` given): the Game draws from that engine
// while it plays and goes back to its own at the end (docs/ENGINES.md). A match from
// an engine the site does not carry plays on the Game's engine, the newest, and a hash
// that disagrees is noted as before.
//
// Self-contained on purpose: it takes a Game and an element to put its controls in, and
// nothing from the pitch page (no lobby, no room socket, no menu unless one is given),
// so an embed can play a pitch's match with a Game, a root and the code.
//
// `data` is a replay (src/net/lobby.js replayOf): { setup, h0, log, snap, ... }.
// Options: home (HOME on the end card), close (BACK TO THE PITCH on the bar and the end
// card; without it there is no way back but HOME), menu (MENU's View follows the
// replay's view while it plays), onEnd (the end card is shown), embed (an EMBED
// button on the bar and the end card: src/ui/embed.js), reel (a highlight reel,
// src/ui/reel.js: its button on the bar and the end card), embedded (an embed's
// player, /e/<code>: no HOME, the score sheet closed until asked for).
//
// What it shows: the wide view by default (THROWER'S VIEW / WIDE VIEW switches, the
// "watchView" pref and the V key, as watching the computer does); PLAY / PAUSE (space),
// NEXT THROW, BACK (the start of the previous turn), 1x / 2x / 4x; TURN t · THROW x OF y
// and the score sheet beside the pitch; at the end the winner card with REPLAY AGAIN and
// HOME. Read only: nothing here sends anything, and the engine refuses every action
// from outside while the replay is loaded.
import { h, button } from "../ui/dom.js";
import { VIEWS, CamBar } from "../ui/watch-view.js";
import { prefs } from "../game/prefs.js";
import { openSheet, knownLines } from "../ui/sheet.js";
import { fetchReplay } from "./fetch.js";
import { engineFor, majorMinor } from "../engine/registry.js";

export const replayTune = {
  throwAfter: 1.2, // s a person stands before their throw is played
  cpuMost: 6, // s at most for the computer's swing to reach its release
  otherAfter: 0.8, // s before a raise or a punishment kubb
  overAfter: 0.6, // s after the last action before the end card
  speeds: [1, 2, 4],
  sheetWide: 900, // px: the score sheet is open beside the pitch from this width
};

export const DIFFERS = "This replay may differ from the match as played.";

// The one sentence for a kept match this page will not play (docs/ENGINES.md
// "Looking back at a match"): made on an engine the site no longer carries, or holding
// a name the game did not make (its snapshot is hashed, so the name cannot be put
// right: docs/MULTIPLAYER.md "Names").
export const OLD_REPLAY =
  "This match was made on an older version of the game and can no longer be replayed.";
export const NAMES_REPLAY =
  "This match has a name the game did not make, so it cannot be shown.";

// Why a replay (or a kept match) will not play here: "old", "names" or null. engines:
// the page's registry (src/engine/registry.js), or the one engine it plays on. The
// names are the engine's to judge (names.check with the whole kept replay: its setup or
// start, snap, players and log, since 0.13.4), so no field of it is read here; the
// replay is then loaded through the engine's strict door as well (replayLoad).
export function replayProblem(r, { engines = null, engine = null } = {}) {
  const mm = majorMinor(r?.engine);
  const carried = engines?.newest
    ? engines.has(mm)
    : !!mm && mm === majorMinor(engine?.version);
  if (!carried) return "old";
  const e = engine ?? engines?.loaded?.(mm);
  if (!e) return null;
  try {
    return e.call("names.check", { replay: r }).allowed === true
      ? null
      : "names";
  } catch {
    return "names";
  }
}

export const problemText = (why) =>
  why === "names" ? NAMES_REPLAY : OLD_REPLAY;

// Fetch a pitch's kept replay and play it. Resolves the player, or null when the pitch
// keeps none (the caller says so: a match from before replays, a room long gone).
export async function startReplay({
  code,
  url,
  data = null,
  engines = null,
  ...opts
}) {
  const r = data ?? (await fetchReplay({ url, code }));
  if (!r) return null;
  // a match from an engine the site no longer carries, or with a name the game did
  // not make, is not played: { problem } (the caller says OLD_REPLAY or NAMES_REPLAY)
  const problem = replayProblem(r, { engines, engine: opts.game.engine });
  if (problem) return { problem };
  const engine = await engineFor(engines, r.engine, opts.game.engine);
  const p = new ReplayPlayer({ ...opts, data: r, engine });
  p.start();
  return p;
}

const NOBODY = Object.freeze({
  sides: [],
  cpu: false,
  mayAct: () => false,
});

// The status pill in a replay: who acts, by the players' names.
function whoActs(need) {
  if (!need || need.kind === "over") return null;
  const up = (x) => String(x || "").toUpperCase();
  const team = up(
    need.team || need.teams?.[need.side] || `TEAM ${need.side || ""}`,
  );
  if (need.kind === "throw") {
    const th = need.setup?.thrower;
    // a computer player in a team (engine 0.17): its name and level
    if (th?.cpu && th.name)
      return {
        text: `${up(th.name)} THROWS · COMPUTER · ${up(th.level)}`,
        mine: false,
      };
    if (need.cpu) return { text: "COMPUTER THROWS", mine: false };
    const name = th?.name;
    return { text: `${up(name) || team} THROWS`, mine: false };
  }
  if (need.kind === "raise") return { text: `${team} RAISES`, mine: false };
  if (need.kind === "punish")
    return { text: `${team} PLACES A KUBB`, mine: false };
  return null;
}

export class ReplayPlayer {
  constructor({
    game,
    root,
    data,
    home = null,
    close = null,
    menu = null,
    onEnd = null,
    embed = null,
    reel = null,
    link = null,
    embedded = false,
    engine = null,
  }) {
    this.engine = engine ?? game.engine;
    Object.assign(this, {
      game,
      root,
      data,
      home,
      close,
      menu,
      onEnd,
      embed,
      reel,
      link,
      embedded,
    });
    this.playing = true;
    this.speed = 1;
    this.wait = 0;
    this.waitCpu = false;
    this.single = false; // NEXT THROW while paused: this one throw plays
    this.ended = false;
    this.held = false; // paused by hold(), not by the viewer
    this.info = null;
    this.saved = null;
    this.onKey = (e) => this.key(e);
  }

  // ---------- starting and stopping ----------

  start() {
    const g = this.game;
    this.saved = {
      engine: g.engine,
      seat: g.seat,
      onNeed: g.onNeed,
      onAction: g.onAction,
      whoActs: g.whoActs,
      localSide: g.localSide,
      zen: g.zen,
      onWide: g.onWide,
      wideWanted: g.wideWanted,
      observing: g.observing,
      camChange: g.freeCam.onChange,
      view: this.menu?.hooks.view ?? null,
      report: this.menu?.hooks.report ?? null,
    };
    g.cards?.close();
    g.useEngine(this.engine);
    g.seat = NOBODY;
    g.onAction = null;
    g.whoActs = whoActs;
    g.localSide = null;
    g.zen = null;
    g.noCards = true;
    g.onNeed = (n) => this.onNeed(n);
    g.driver = (dt) => this.drive(dt);
    g.onWide = () => this.renderView();
    this.build();
    // the free camera (docs/OBSERVER.md), not in an embed: another site's page
    // scrolls under it, and a wheel there must scroll the page
    if (!this.embedded) {
      this.cam = new CamBar({ game: g, ui: this.root });
      g.setObserving(true);
      this.cam.on();
    }
    if (this.menu) {
      this.menu.hooks.view = {
        get: () => this.chosen(),
        set: (v) => this.choose(v),
      };
      // SEND FEEDBACK reports a game as it was played here; a replay's throws are the log's
      this.menu.hooks.report = null;
    }
    window.addEventListener("keydown", this.onKey);
    g.setWide(this.chosen() === "wide");
    this.load();
  }

  // Set the match out from its start and play.
  load() {
    const g = this.game;
    g.cards?.close();
    const v = g.engine.replayLoad(this.data);
    g.nbSeed = null; // the Tournament's neighbours follow the replayed match's seed
    this.info = v.replay;
    this.ended = false;
    this.restored = false;
    this.single = false;
    this.setPlaying(true);
    this.show(v);
  }

  destroy() {
    const g = this.game;
    if (!this.saved) return;
    window.removeEventListener("keydown", this.onKey);
    g.driver = null;
    g.frozen = false;
    g.timeScale = 1;
    g.noCards = false;
    g.play = null;
    g.queue.length = 0;
    try {
      g.engine.replayEnd();
    } catch {
      // the engine has gone: nothing to end
    }
    const s = this.saved;
    this.saved = null;
    g.useEngine(s.engine);
    Object.assign(g, {
      seat: s.seat,
      onNeed: s.onNeed,
      onAction: s.onAction,
      whoActs: s.whoActs,
      localSide: s.localSide,
      zen: s.zen,
      onWide: s.onWide,
    });
    this.cam?.off();
    this.cam = null;
    g.freeCam.home();
    g.freeCam.onChange = s.camChange;
    g.setObserving(s.observing);
    if (this.menu) {
      this.menu.hooks.view = s.view;
      this.menu.hooks.report = s.report;
    }
    g.cards?.close();
    this.bar?.remove();
    this.panel?.remove();
    this.root.classList.remove("replaying");
    g.setWide(s.wideWanted);
  }

  // ---------- the controls ----------

  build() {
    this.count = h("p.replay-count", { "data-test": "replay-count" });
    this.note = h(
      "p.replay-note",
      { "data-test": "replay-differs", hidden: true },
      DIFFERS,
    );
    this.playBtn = button("PAUSE", () => this.toggle(), "small", {
      "data-test": "replay-play",
      "aria-pressed": "true",
    });
    this.speedBtns = replayTune.speeds.map((x) =>
      button(`${x}x`, () => this.setSpeed(x), "small", {
        "data-speed": x,
        "aria-pressed": String(x === this.speed),
      }),
    );
    this.viewBtn = button(VIEWS.thrower, () => this.toggleView(), "small", {
      "data-test": "replay-view",
      title: "Switch the view (V)",
    });
    this.sheetBtn = button("SHEET", () => this.toggleSheet(), "small", {
      "data-test": "replay-sheet-toggle",
    });
    this.bar = h(
      "div.replay-bar",
      { "data-test": "replay-bar" },
      h("div.replay-head", h("span.replay-kicker", "REPLAY"), this.count),
      this.note,
      h(
        "div.replay-controls",
        button("BACK", () => this.back(), "small", {
          "data-test": "replay-back",
          title: "The start of the previous turn",
        }),
        this.playBtn,
        button("NEXT THROW", () => this.next(), "small", {
          "data-test": "replay-next",
        }),
        h("span.replay-speeds", this.speedBtns),
        this.viewBtn,
        this.sheetBtn,
        this.embed
          ? button("EMBED", () => this.embed(), "small", {
              "data-test": "replay-embed",
            })
          : null,
        this.reel
          ? this.reel.button("small", { "data-test": "replay-reel" })
          : null,
        this.close
          ? button("BACK TO THE PITCH", () => this.close(), "small", {
              "data-test": "replay-close",
            })
          : null,
      ),
    );
    this.sheetText = h("pre.replay-sheet-text", {
      "data-test": "replay-sheet",
    });
    this.panel = h(
      "aside.replay-sheet",
      { "aria-label": "The score sheet" },
      h("p.kicker", "SCORE SHEET"),
      this.sheetText,
    );
    this.panel.hidden =
      this.embedded || window.innerWidth < replayTune.sheetWide;
    this.root.append(this.panel, this.bar);
    this.root.classList.add("replaying");
  }

  setPlaying(on) {
    this.playing = on;
    this.game.frozen = !on && !this.single;
    this.playBtn.textContent = on ? "PAUSE" : "PLAY";
    this.playBtn.setAttribute("aria-pressed", String(on));
  }

  // Held while out of view (an embed scrolled away): nothing plays until resumed.
  // A pause the viewer chose stays a pause.
  hold(on) {
    if (this.ended || !this.saved) return;
    if (on) {
      if (!this.playing) return;
      this.held = true;
      this.single = false;
      this.setPlaying(false);
    } else if (this.held) {
      this.held = false;
      this.setPlaying(true);
    }
  }

  toggle() {
    this.held = false;
    if (this.ended) return this.load();
    this.single = false;
    this.setPlaying(!this.playing);
  }

  setSpeed(x) {
    this.speed = x;
    this.game.timeScale = x;
    for (const b of this.speedBtns)
      b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === x));
  }

  toggleSheet() {
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden) this.renderSheet();
  }

  // An embed opens in the wide view and keeps its choice to itself.
  chosen() {
    if (this.embedded) return this.view ?? "wide";
    return prefs.get("watchView", "wide") === "thrower" ? "thrower" : "wide";
  }

  choose(v) {
    if (this.embedded) this.view = v;
    else prefs.set("watchView", v);
    this.game.setWide(v === "wide");
  }

  toggleView() {
    this.choose(this.chosen() === "wide" ? "thrower" : "wide");
  }

  renderView() {
    const label = this.game.wide ? VIEWS.thrower : VIEWS.wide;
    if (this.viewBtn.textContent !== label) this.viewBtn.textContent = label;
    // a window too small for the wide view shows the thrower's: no switch
    this.viewBtn.hidden = this.chosen() === "wide" && !this.game.wide;
    this.cam?.render();
  }

  key(e) {
    if (this.game.modal || e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "KeyV") this.toggleView();
    else if (e.code === "Space") this.toggle();
    else return;
    e.preventDefault();
  }

  render() {
    const i = this.info;
    if (!i) return;
    const shown = Math.max(1, Math.min(i.throws, i.thrown));
    this.count.textContent = `TURN ${i.turn}  ·  THROW ${i.throws ? shown : 0} OF ${i.throws}`;
    this.note.hidden = !i.differs;
    if (!this.panel.hidden) this.renderSheet();
  }

  renderSheet() {
    let s = null;
    try {
      s = this.game.engine.sheet();
    } catch {
      return;
    }
    if (!s || typeof s.text !== "string") return;
    const lines = knownLines(
      Array.isArray(s.shown) ? s.shown : s.text.replace(/\n$/, "").split("\n"),
    );
    const text = lines.join("\n");
    if (this.sheetText.textContent === text) return;
    this.sheetText.textContent = text;
    this.sheetText.scrollTop = this.sheetText.scrollHeight;
  }

  // ---------- playing ----------

  // The Game's view after a step or a jump.
  show(v) {
    const g = this.game;
    g.play = null;
    g.queue.length = 0;
    g.result = null;
    g.mode = "match";
    g.phase = "idle";
    g.shownCards.clear();
    g.enter(v);
    this.render();
  }

  // Each time the Game takes a new need: how long before the next action.
  onNeed(n) {
    this.render();
    if (n.kind === "over") {
      this.waitCpu = false;
      this.wait = replayTune.overAfter;
      return;
    }
    if (this.single && this.game.phase !== "play") {
      // NEXT THROW while paused: the throw has played; hold here
      this.single = false;
      this.setPlaying(false);
    }
    const next = this.data.log[this.info.i];
    this.waitCpu = false;
    if (!next) this.wait = replayTune.overAfter;
    else if (next.a.type === "throw") {
      this.waitCpu = !!n.cpu;
      this.wait = this.waitCpu ? replayTune.cpuMost : replayTune.throwAfter;
    } else this.wait = replayTune.otherAfter;
  }

  // From the Game's tick, with its dt (already at the replay's speed, 0 when paused).
  drive(dt) {
    const g = this.game;
    // a throw playing back, or a raise being watched (src/game/lift.js), holds the log
    if (this.ended || g.phase === "play" || g.phase === "lift" || g.modal)
      return;
    if (!this.playing && !this.single) return;
    if (this.info.done) {
      this.wait -= dt;
      if (this.wait <= 0) this.finish();
      return;
    }
    this.wait -= dt;
    // the computer's swing runs in the engine until it holds at its release
    if (this.waitCpu && this.wait > 0 && g.engine.replayInfo().held)
      this.wait = 0;
    if (this.wait <= 0) this.step();
  }

  // The next action in the log.
  step() {
    const g = this.game;
    const before = g.need;
    const action = this.data.log[this.info.i]?.a;
    const r = g.engine.replayStep();
    this.info = r.replay;
    if (r.recording) {
      g.startPlayback(r.recording, false);
      this.render();
    } else if (this.rushing) g.enter(g.engine.view());
    // a raise is watched being made, as it was in the match (src/game/lift.js)
    else g.showAction(before, action, g.engine.view());
  }

  // NEXT THROW: the throw playing now to its end, then the next throw (with any raise
  // or punishment kubb before it) played; when paused it plays and holds after.
  next() {
    const g = this.game;
    if (this.ended) return;
    if (g.phase === "play") {
      g.skip();
      g.endPlayback();
    }
    // NEXT THROW goes straight on: no raise is watched on the way
    if (g.phase === "lift") g.finishLifts();
    this.rushing = true;
    try {
      while (!this.info.done) {
        const e = this.data.log[this.info.i];
        this.step();
        if (e.a.type === "throw" || this.ended) break;
      }
    } finally {
      this.rushing = false;
    }
    if (!this.playing && g.phase === "play") {
      this.single = true;
      g.frozen = false;
    }
    // the log ran out on something that does not play back (a resignation): the end
    if (this.info.done && g.phase !== "play") {
      if (this.playing) this.wait = 0;
      else this.finish();
    }
  }

  // BACK: the start of the previous turn (the start of the match from the first).
  back() {
    const g = this.game;
    if (this.ended) {
      g.cards?.close();
      this.ended = false;
      // the match's own end was shown (the replay went another way): start again
      if (this.restored) return this.load();
    }
    this.single = false;
    const v = g.engine.replayBack();
    this.info = v.replay;
    this.show(v);
  }

  // The last action has played: the result, as the match ended.
  finish() {
    const g = this.game;
    this.ended = true;
    this.single = false;
    this.setPlaying(false);
    g.frozen = false;
    let need = g.need;
    if (this.info.differs || need?.kind !== "over") {
      // this engine went another way: the result is the match's own
      try {
        this.restored = true;
        g.engine.replayEnd();
        const v = g.engine.restoreChecked(this.data.snap);
        g.onNeed = null;
        this.show(v);
        need = v.need;
      } finally {
        g.onNeed = (n) => this.onNeed(n);
      }
    }
    this.render();
    g.cards?.winner(need, {
      replay: () => this.load(),
      replayLabel: "REPLAY AGAIN",
      first: true,
      rematch: null,
      home: this.embedded
        ? null
        : (this.home ?? (() => (location.href = "/#play"))),
      embed: this.embed,
      reel: this.reel,
      link: this.embedded ? null : this.link,
      back: this.close,
      sheet: () => openSheet(this.root, { game: g }),
      note: this.info.differs ? DIFFERS : null,
    });
    this.onEnd?.();
  }
}
