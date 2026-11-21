// A shared pitch (docs/MULTIPLAYER.md): /p/<code> without ?solo=1. Joins the pitch on
// the pitch server (src/net/pitch-client.js), shows the lobby, and once the host starts,
// drives the Game through its seam (docs/CLIENT.md): the seat says who may act here,
// onAction commits what was done here, applyRemote plays what was done elsewhere, adopt
// takes the pitch's snapshot when this browser is out of step. The rules of who acts and
// the lobby document's reducers are the engine's (vendor/engine/room/), through
// src/net/seats.js and lobby.js.
import { connect, memberId, observerId, PitchError } from "./pitch-client.js";
import { AimSender, AimBuffer, aimTune } from "./aim.js";
import {
  lobbyOf,
  joinTeam,
  setOptions,
  pruneTeams,
  lineup,
  matchOptions,
  startMatch,
  backToLobby,
  cleanName,
  cleanOptions,
  optionsOf,
  LEVELS,
  sideOf,
  setAccess,
  openListing,
  replayOf,
  isReplay,
  startCheck,
  mayPlay,
  roomEngineFor,
  carriedBy,
  announce,
  speakAs,
  compareEngines,
  ENGINE,
} from "./lobby.js";
import {
  controlFor,
  sameControl,
  mayAct,
  shownActor,
  playingSide,
} from "./seats.js";
import { Lobby } from "../ui/lobby.js";
import { WatchCard } from "../ui/watching.js";
import { WatchView } from "../ui/watch-view.js";
import { prefs } from "../game/prefs.js";
import { h, button } from "../ui/dom.js";
import { ReplayPlayer } from "../replay/player.js";
import { fetchReplay, askReplay } from "../replay/fetch.js";
import { openEmbed, EMBED_ORIGIN } from "../ui/embed.js";
import { Reel } from "../ui/reel.js";
import { reelFromPage } from "./reel.js";
import { majorMinor, withEngineFor } from "../engine/registry.js";
import { openSheet } from "../ui/sheet.js";
import { SCENE_ROW } from "../render/scenes.js";

export const tune = {
  tickMs: 200, // the controller's clock: drain, seats, the open listing
  aimMs: 1000 / aimTune.hz, // the aim's clock while it is this browser's throw
  shoutMs: 2600, // a shout stays up this long
  shoutGapMs: 700, // this browser's shouts at most this often
  stuckMs: 8000, // still not connected after this: say so
  watchNoteMs: 7000,
};

export const SHOUTS = ["NICE!", "OOH!", "TOK!", "UNLUCKY"];

// The seat of a browser that may not play (watching, or an engine the match's is not).
const NO_CONTROL = Object.freeze({ sides: [], cpu: false });
const NO_PLAYERS = Object.freeze({ A: [], B: [] });

// Which of two engine versions ("0.3") is newer: > 0 when a is.
function compareVersions(a, b) {
  const x = String(a ?? "")
    .split(".")
    .map(Number);
  const y = String(b ?? "")
    .split(".")
    .map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

// The card for a match this browser may not play (docs/MULTIPLAYER.md "Engines"): `mine`,
// this browser's newest; `theirs`, the match's engine, null when it names none (an older
// build). `why` "load": the match's engine is carried but did not load here.
export function versionNotice(mine, theirs, why = null) {
  if (why === "load")
    return {
      title: "Could not load the match",
      text: "This match plays on another version of Throwing Wood, and it did not load in this browser. Reload to try again.",
      reload: true,
    };
  if (!mine)
    return {
      title: "Reload to play",
      text: "This tab has not announced its engine version. Reload to join.",
      reload: true,
    };
  const newer = theirs != null && compareVersions(theirs, mine) > 0;
  return newer
    ? {
        title: "A newer version",
        text: "This pitch is playing on a newer version of Throwing Wood. Reload to join.",
        reload: true,
      }
    : {
        title: "An older version",
        text: "This pitch is playing on an older version of Throwing Wood. Ask the host to reload.",
        reload: false,
      };
}

export function startPitch(env) {
  const p = new Pitch(env);
  p.begin();
  return p;
}

export class Pitch {
  // env: { game, cards, ui, config, code, home, pitchUrl, apiUrl, sheet?, menu?,
  //        engines?, observe?, WebSocket?, fetch? }
  // pitchUrl: the pitch server (wss://...); apiUrl: the api over HTTPS (kept replays,
  //   reels), "/api" on the site
  // observe: /p/<code>?observe=1, an observer (docs/OBSERVER.md): joins to watch,
  //   never takes a side, the computer or the host, and never writes the document
  // sheet: () => void, opens the score sheet of the Game's engine
  // engines: the page's carried engines (src/engine/registry.js); a finished match is
  //   looked back at (its replay, its score sheet) with its own when carried
  //   (docs/ENGINES.md). Without it, the Game's engine.
  constructor(env) {
    Object.assign(this, env);
    // the page's newest engine, the Game's at the start: the lobby, practice behind it,
    // and a match this browser may not play are drawn from it (docs/ENGINES.md)
    this.newestEngine = env.game?.engine ?? null;
    this.matchMm = undefined; // the running match's major.minor, when this page plays it
    this.engineWait = null; // a match's engine loading: the pitch's news waits for it
    this.engineFailed = null; // a match's engine that did not load
    this.mode = "lobby"; // lobby | match | replay | gone | sealed
    this.sealed = null; // a shared match's kept replay (showSealed)
    this.replay = null; // the replay player while one plays (src/replay/player.js)
    this.replayFrom = null; // the mode to go back to
    this.arrivedOver = null; // the match number this browser first saw finished
    this.lastReplay = null; // the pitch's kept replay, for the lobby
    this.keptBefore = false; // the api kept a match from before the live pitch was wiped
    this.reel = null; // the highlight reel of the last finished match (src/ui/reel.js)
    this.local = { n: null, seq: 0 }; // the match and action this browser holds
    this.head = null; // { seq, h }: the newest action this browser knows was committed
    this.match = null; // the match header (players, cpu, host, engine), for the seats
    this.meta = null; // the match's start info, what its replay needs besides the log
    this.acts = null; // the match's log as seen here ([{ a, h, ts }]), null when not whole
    this.h0 = null; // the hash at the match's start
    this.overSnap = null; // the snapshot a finished match ended on
    this.queue = []; // remote actions waiting for a playback (or their aim) to end
    this.stale = false; // the pitch's news was missed (a replay, an engine loading)
    this.control = null;
    this.lastShout = 0;
    this.watchNoteUntil = 0;
    this.observe = !!env.observe;
    this.aimOut = new AimSender();
    this.aimIn = new AimBuffer();
    this.view = null; // the watcher's view (src/ui/watch-view.js), made when first needed
    this.log = []; // what happened, for the test hook and debugging
  }

  get you() {
    return this.room?.you;
  }

  // our own actions the pitch has not answered yet
  get pending() {
    return this.room?.pending.length ?? 0;
  }

  // the api calls' options (src/net/api.js): a test's fetch when it gave one
  apiOpts() {
    return { url: this.apiUrl, ...(this.fetch ? { fetch: this.fetch } : {}) };
  }

  // ---------- starting ----------

  begin() {
    const { game, cards } = this;
    // The pages function's og:video, written when this pitch's reel is done
    // (backend/pages/pitch.mjs): the one honest way to know on load, because asking
    // the api is what starts a render (src/net/reel.js).
    this.pageReel = reelFromPage(
      document.querySelector('meta[property="og:video"]')?.content,
      this.code,
      [EMBED_ORIGIN, location.origin],
    );
    game.newPractice({ surface: prefs.get("pitchOptions", {}).surface });
    if (!this.pitchUrl) {
      cards.notice({
        kicker: `PITCH ${this.code}`,
        title: "No pitches here",
        text: "This copy of the game has no pitch server, so friends cannot join this pitch. You can still play the computer.",
        actions: [
          ["PLAY THE COMPUTER", () => this.solo(), "go"],
          ["HOME", this.home],
        ],
        test: "no-rooms",
      });
      return;
    }
    // the device's name (src/game/player-name.js): typed once, kept on the device
    const name = cleanName(game.playerName);
    this.name = name;
    // every engine this page can play, newest first (src/engine/registry.js)
    this.carries = this.engines?.newest ? this.engines.carried() : [ENGINE];
    // A shared match (docs/REEL.md) has no live pitch, only its kept replay: asked of
    // the api beside the join, and looked at before this browser writes anything on a
    // pitch nobody has used (onReady).
    this.sealedAsk = this.apiUrl
      ? askReplay({ ...this.apiOpts(), code: this.code }).catch(() => null)
      : Promise.resolve(null);
    try {
      this.room = connect({
        url: this.pitchUrl,
        pitch: this.code,
        // an observer is a member of its own, never this browser's player
        member: this.observe ? observerId() : memberId(),
        role: this.observe ? "observer" : "player",
        // engine and engines: what this page carries, the newest until it knows the
        // pitch (the engine's docs/ROOM.md "Speaking down"; Pitch.speak)
        me: { name, level: game.level, ...this.announcement(null) },
        ...(this.WebSocket ? { WebSocket: this.WebSocket } : {}),
      });
    } catch (err) {
      this.joinFailed(err);
      return;
    }
    const room = this.room;

    this.lobby = this.observe
      ? new WatchCard(
          cards,
          game,
          {
            replay: () => this.lastReplay && this.watch(this.lastReplay),
            join: () => this.joinPitch(),
            home: this.home,
          },
          { code: this.code },
        )
      : new Lobby(
          cards,
          game,
          {
            name: (t) => this.setName(t),
            // the level you throw at is MENU's (src/game/throw-level.js)
            menu: () => this.menu?.open(),
            team: (side) => this.pickTeam(side),
            option: (k, v) => this.setOption(k, v),
            access: (open) => this.setAccess(open),
            start: () => this.start(),
            share: () => this.share(),
            replay: () => this.lastReplay && this.watch(this.lastReplay),
            home: this.home,
          },
          { code: this.code, name, level: game.level },
        );

    // a change of level in MENU: the lobby says it, the pitch hears it
    this.stopLevel = game.onLevel((v) => this.levelChanged(v));
    // and a change of name there (or the first one typed in the lobby): the pitch hears it
    this.stopName = game.onPlayerName((v) => this.nameChanged(v));

    this.buildHud();
    game.seat = this.seatFor({ sides: [], cpu: false });
    game.onAction = (a, snap, hash) => this.onAction(a, snap, hash);
    game.onNeed = (need) => this.onNeed(need);
    game.whoActs = (need) => this.who(need);
    game.remoteFeed = () => this.remoteAim();
    game.onRelease = (pre) => this.castRelease(pre);
    cards.who = (need) => this.who(need);

    room.on("status", () => this.onStatus());
    room.on("state", (e) => this.onState(e));
    room.on("members", () => this.onMembers());
    room.on("left", () => this.pruneLater());
    room.on("doc", (e) => this.onDoc(e));
    room.on("start", (e) => this.onStart(e));
    room.on("acts", (acts) => this.onActs(acts));
    room.on("ok", (e) => this.onOk(e));
    room.on("refused", (e) => this.onRefused(e));
    room.on("cast", (e) => this.onCast(e));
    room.on("error", (e) => this.note("pitch", e.code));
    room.on("failed", (err) => {
      if (this.ready) this.joinFailed(err);
    });

    this.lobby.show();
    this.renderLobby();
    room.ready.then(
      () => this.onReady(),
      (err) => this.joinFailed(err),
    );
    this.stuckTimer = setTimeout(() => {
      if (room.status === "connecting")
        this.lobby.say("Still trying to reach the pitch...");
    }, tune.stuckMs);
    this.timer = setInterval(() => this.tick(), tune.tickMs);
    this.aimTimer = setInterval(() => this.castAim(), tune.aimMs);
  }

  async onReady() {
    clearTimeout(this.stuckTimer);
    const room = this.room;
    if (this.lobby.note.textContent.startsWith("Still trying"))
      this.lobby.say("");
    // a pitch nobody has used: a shared match's code is one (its replay is kept, there
    // is no live pitch), and an observer has nothing to watch
    if (room.v === 0 && !room.match) {
      const kept = await this.sealedAsk;
      if (this.mode === "gone") return;
      if (kept?.sealed) {
        this.note("sealed-code");
        room.leave();
        clearInterval(this.timer);
        clearInterval(this.aimTimer);
        this.lobby?.hide();
        return this.showSealed();
      }
      // a finished pitch left empty for 48 hours is wiped while the api keeps its
      // replay a year: the lobby still offers that match (lookForReplay)
      this.keptBefore = !!kept;
      const players = room.members.filter(
        (m) => m.connected && m.role !== "observer",
      );
      if (this.observe && players.length === 0) return this.noGame();
    }
    this.ready = true;
    // the host's own options go in on a new pitch, and OPEN from the web game's page
    // (/p/<code>?open=1) makes it an open game
    if (!this.observe && room.isHost() && room.v === 0) {
      const saved = prefs.get("pitchOptions", {});
      const o = cleanOptions(saved);
      // the computer's level (engine 0.9 on): cleanOptions knows only the five, and
      // an engine before 0.9 ignores it
      if (LEVELS.includes(saved?.computer)) o.computer = saved.computer;
      // and the scene the host last picked (a look only, the same way)
      if (SCENE_ROW[2].some(([v]) => v === saved?.scene)) o.scene = saved.scene;
      const open = new URLSearchParams(location.search).get("open") === "1";
      this.write((doc) => {
        const d = setOptions(doc, o) ?? lobbyOf(doc);
        return open ? (setAccess(d, true) ?? d) : d;
      });
    }
    this.renderLobby();
    this.lookForReplay();
  }

  // Between matches, a pitch that has had one offers its last finished match
  // (WATCH THE LAST MATCH) when the api keeps its replay. Asked over HTTPS
  // (src/replay/fetch.js), once on arriving and after each match.
  async lookForReplay() {
    const doc = this.room?.doc;
    if (this.mode !== "lobby" || !doc || !this.apiUrl) return;
    if (lobbyOf(doc).n < 1 && !this.keptBefore) return;
    const r = await fetchReplay({
      ...this.apiOpts(),
      code: this.code,
      check: isReplay,
    });
    this.lastReplay = r;
    this.lobby?.setReplay(!!r);
  }

  // An observer found an empty pitch: it leaves, so the pitch keeps no member, and says
  // so.
  noGame() {
    clearInterval(this.timer);
    clearInterval(this.aimTimer);
    this.mode = "gone";
    this.note("no-game");
    this.room.leave();
    this.lobby?.hide();
    this.cards.notice({
      kicker: `PITCH ${this.code}`,
      title: "No game here",
      text: "Nobody is playing on this pitch. Open games are listed on the web game’s page.",
      actions: [
        ["JOIN THIS PITCH", () => this.joinPitch(), "go"],
        ["HOME", this.home],
      ],
      test: "no-game",
    });
  }

  // JOIN THIS PITCH (an observer): the same link without ?observe=1, the lobby.
  joinPitch() {
    const u = new URL(location.href);
    u.searchParams.delete("observe");
    location.href = u.toString();
  }

  joinFailed(err) {
    clearTimeout(this.stuckTimer);
    clearInterval(this.timer);
    clearInterval(this.aimTimer);
    if (this.mode === "gone") return;
    this.mode = "gone";
    this.lobby?.hide();
    let code = err instanceof PitchError ? err.code : "error";
    if (code === "bad-pitch" || code === "bad-member") code = "bad-room";
    // an observer refused for a pitch with nobody on it
    if (code === "no-pitch" && this.observe) {
      this.mode = "lobby";
      return this.noGame();
    }
    const text = {
      full: "This pitch has as many people on it as it takes, every one of them connected. Start a pitch of your own, or try again when someone leaves.",
      "bad-room":
        "That is not a pitch's link. Pitch links come from Start a pitch on the web game’s page.",
      "no-pitch":
        "Nobody has started this pitch. Pitch links come from Start a pitch on the web game’s page.",
      replaced: "This pitch is open in another tab or window of this browser.",
    }[code];
    this.cards.notice({
      kicker: `PITCH ${this.code}`,
      title:
        code === "full"
          ? "This pitch is full"
          : code === "bad-room" || code === "no-pitch"
            ? "No such pitch"
            : code === "replaced"
              ? "Open somewhere else"
              : "Could not join",
      text:
        text ||
        `Something went wrong joining the pitch (${String(err?.message || err)}).`,
      actions: [
        code === "replaced"
          ? ["USE IT HERE", () => location.reload(), "go"]
          : ["START A PITCH", () => (location.href = "/p/"), "go"],
        ["HOME", this.home],
      ],
      test: `join-${code}`,
    });
  }

  // ---------- a shared match ----------

  // A match against the computer shared from a winner card (docs/REEL.md, backend/api
  // `share`) is a sealed pitch: it is watched, never joined. Its page shows the finished
  // match from the api's kept replay, as a browser arriving after a pitch's end sees it:
  // the result, WATCH REPLAY, the score sheet, EMBED and the reel. No lobby, seats or
  // rematch. It never moves on, so the replay read here is the one its reel is made from.
  async showSealed() {
    this.mode = "sealed";
    if (this.shoutBar) this.shoutBar.hidden = true;
    const r = await fetchReplay({
      ...this.apiOpts(),
      code: this.code,
      check: isReplay,
    });
    if (!r) {
      this.mode = "gone";
      this.cards.notice({
        kicker: `PITCH ${this.code}`,
        title: "Could not show the match",
        text: "This pitch is a shared match, and it could not be loaded just now. Try again in a moment.",
        actions: [
          ["TRY AGAIN", () => location.reload(), "go"],
          ["HOME", this.home],
        ],
        test: "sealed-missing",
      });
      return;
    }
    this.sealed = r;
    this.arrivedOver = r.n; // the page's og:video, if any, was written for this match
    this.note("sealed", r.n);
    this.game.whoActs = () => null;
    this.cards.who = () => null;
    this.game.onNeed = (need) => {
      if (this.mode === "sealed" && need?.kind === "over")
        this.sealedCard(need);
    };
    this.game.adopt(r.snap);
  }

  sealedCard(need) {
    const r = this.sealed;
    this.cards.winner(need, {
      rematch: null,
      sheet: this.sheet ? () => this.openSheet() : null,
      home: this.home,
      replay: () => this.watch(r),
      embed: () => this.showEmbed(),
      reel: this.reelFor(r),
      first: true,
      teams: teamsLine(r.players),
    });
  }

  solo() {
    const u = new URL(location.href);
    u.searchParams.set("solo", "1");
    location.href = u.toString();
  }

  // ---------- writing the document ----------

  // The lobby document through fn, compare-and-set (pitch.update), with the errors
  // turned into a word in the lobby; resolves the result or null.
  async write(fn) {
    try {
      return await this.room.update(fn);
    } catch (err) {
      this.note("write", err.code);
      if (err.code === "uncertain" || err.code === "busy") this.room.resync();
      else if (this.lobby?.shown) this.lobby.say(plainError(err));
      return null;
    }
  }

  // ---------- the lobby ----------

  // A name typed in the lobby (only while this device keeps none): kept on the
  // device, which tells nameChanged.
  setName(text) {
    if (text == null) return;
    this.game.setPlayerName(text);
  }

  // The device's name changed (MENU, or typed in the lobby).
  nameChanged(v) {
    const name = cleanName(v);
    this.lobby?.setName(name);
    if (name === this.name) return;
    this.name = name;
    this.room?.setMe({ name });
  }

  // The device's throw level changed (MENU). A match in play reads it from this
  // browser's throws; the room's copy is for the next START, sent now in the lobby
  // and again on the way back to it.
  levelChanged(v) {
    this.lobby?.setLevel(v);
    if (this.mode === "lobby") this.room?.setMe({ level: v });
  }

  async pickTeam(side) {
    this.setName(this.lobby.typedName());
    const doc = this.room.doc;
    const full = side && lobbyOf(doc).teams[side].length >= 6;
    const r = await this.write((d) => joinTeam(d, this.you, side));
    if (!r && full) this.lobby.say(`Team ${side} is full.`);
    this.renderLobby();
  }

  setOption(k, v) {
    if (!this.room.isHost()) return;
    prefs.set("pitchOptions", {
      ...prefs.get("pitchOptions", {}),
      [k]: v,
    });
    this.write((d) => setOptions(d, { [k]: v }));
  }

  // The host: open (listed on the web game’s page) or invite only.
  setAccess(open) {
    if (!this.room.isHost()) return;
    this.write((d) => setAccess(d, open));
  }

  // The host keeps the open games list in step with the document: { seats, state }
  // on every change (the pitch server counts who is on it and says it again while
  // listed). Anyone else sends nothing.
  publishOpen() {
    const room = this.room;
    if (!room || !room.isHost() || room.status !== "open") return;
    const listed = openListing(room.doc, room.members, {
      over:
        this.mode === "replay" ||
        (this.mode === "match" && this.game.need?.kind === "over"),
    });
    const info = listed ? { seats: listed.seats, state: listed.state } : null;
    if (info) this.sawOpen = true;
    else if (!this.sawOpen) return; // never open here: nothing to take off
    const key = JSON.stringify(info);
    if (key === this.openKey) return;
    if (room.setOpen(info)) this.openKey = key;
  }

  async share() {
    const url = location.origin + location.pathname;
    const btn = this.lobby.shareBtn;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Kubb: Throwing Wood", url });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = "LINK COPIED";
    } catch {
      btn.textContent = "COPY FAILED";
      this.lobby.say(`The link is ${url}`);
    }
    setTimeout(() => (btn.textContent = "SHARE THE LINK"), 2000);
  }

  nameOf(id) {
    if (!id) return "";
    const m = this.room?.members.find((x) => x.id === id);
    const n = cleanName(m?.me?.name);
    if (n) return n;
    for (const s of ["A", "B"]) {
      const p = this.match?.players?.[s]?.find((x) => x.id === id);
      if (p) return p.name;
    }
    return "Someone";
  }

  renderLobby() {
    if (!this.lobby || this.mode !== "lobby") return;
    const r = this.room;
    this.lobby.update({
      you: r.you,
      host: r.host,
      members: r.members,
      doc: r.doc,
      status: r.status,
      nameOf: (id) => this.nameOf(id),
      // the next match's engine: its options are the rows (the computer's level on 0.9)
      engine: this.roomEngine().engine,
    });
    this.lobbyEngine();
  }

  // ---------- the room's engine (docs/ENGINES.md "Playing together") ----------

  // What this browser announces while the room's engine is `engine` (null: not known).
  announcement(engine) {
    return announce(this.carries, engine) ?? { engine: ENGINE };
  }

  // Say it to the room when it changed.
  speak(engine) {
    const room = this.room;
    if (!room) return;
    const a = this.announcement(engine);
    const me = room.me || {};
    if (
      me.engine === a.engine &&
      JSON.stringify(me.engines ?? null) === JSON.stringify(a.engines ?? null)
    )
      return;
    room.setMe(a);
    this.note("announce", a.engine);
  }

  // The room's engine, kept while the document, the members and the host are the same:
  // { engine, missing, unknown } for the next match (the host and the lineup's players,
  // this browser among them only when it plays or hosts), and `speak`, the engine this
  // browser announces, which counts it either way.
  roomEngine() {
    const r = this.room;
    const k = this.roomKey;
    if (
      k &&
      k.doc === r.doc &&
      k.members === r.members &&
      k.host === r.host &&
      k.you === r.you
    )
      return k.value;
    const mine = roomEngineFor(r.doc, r.members, r.host, r.you, this.carries);
    const counted = r.isHost() || !!sideOf(r.doc, r.you);
    const room = counted ? mine : roomEngineFor(r.doc, r.members, r.host);
    const value = { ...room, speak: mine.engine };
    this.roomKey = {
      doc: r.doc,
      members: r.members,
      host: r.host,
      you: r.you,
      value,
    };
    return value;
  }

  // In the lobby: announce the room's engine, fetch its bundle ahead of START, and say
  // what keeps the next match from starting when the players share no engine.
  lobbyEngine() {
    const r = this.room;
    if (!this.lobby || this.mode !== "lobby" || r.status !== "open") return;
    const e = this.roomEngine();
    this.speak(e.speak);
    this.prefetch(e.engine);
    const text = e.engine ? null : this.blockedText(e);
    this.lobby.setEngine(text);
    const key = text && JSON.stringify([e.missing, e.unknown]);
    if (key && key !== this.blockedKey)
      this.note("engine-blocked", e.missing.length, e.unknown.length);
    this.blockedKey = key;
  }

  // Load a carried engine before it is needed (the room's, ahead of START).
  prefetch(mm) {
    const reg = this.engines;
    if (!mm || !reg?.has(mm) || reg.loaded(mm) || this.prefetching === mm)
      return;
    this.prefetching = mm;
    reg.loadEngine(mm).then(
      () => {
        this.prefetching = null;
        // the lobby's rows are the room engine's: drawn again now it is in
        this.renderLobby();
      },
      (err) => {
        this.prefetching = null;
        this.note("prefetch", mm, String(err?.message || err));
      },
    );
  }

  // The engine a match on major.minor `mm` is played with here: null when the page does
  // not carry it. A promise while it loads.
  async engineOf(mm) {
    const reg = this.engines;
    if (!reg?.newest) return mm === ENGINE ? this.newestEngine : null;
    if (!reg.has(mm)) return null;
    return reg.loaded(mm) ?? (await reg.loadEngine(mm));
  }

  // The lobby's words when no engine is carried by the host and every player: who stands
  // in the way and what to do, in a player's words. Version numbers only here, where they
  // say what to get.
  blockedText(e) {
    const r = this.room;
    const byId = new Map(r.members.map((m) => [m.id, m]));
    const carriedOf = (id) =>
      id === r.you ? this.carries : carriedBy(byId.get(id)?.me);
    const missing = [...new Set([...e.missing, ...e.unknown])];
    const lu = lineup(r.doc, r.members);
    const counted = [
      r.host,
      ...["A", "B"].flatMap((s) => (lu?.players[s] || []).map((p) => p.id)),
    ].filter((id, i, all) => id != null && all.indexOf(id) === i);
    const others = counted.filter((id) => !missing.includes(id));
    // the engine the rest share: the newest every one of them carries
    const lists = others.map(carriedOf);
    const shared =
      lists[0]?.find((mm) => lists.every((l) => l.includes(mm))) ?? null;
    const lines = [];
    if (missing.includes(r.you)) {
      const mine = this.carries[0];
      lines.push(
        shared && compareEngines(mine, shared) < 0
          ? `This browser has an older version of Throwing Wood (${mine}) than the others here (${shared}), so the match cannot start. Reload the page to play.`
          : shared
            ? `The others here have an older version of Throwing Wood (${shared}) than this browser (${mine}), so the match cannot start. Ask them to reload the page or update the app.`
            : "The players here have different versions of Throwing Wood, so the match cannot start. Everyone: reload the page or update the app.",
      );
    }
    const older = [];
    const newer = [];
    const unknown = [];
    for (const id of missing) {
      if (id === r.you) continue;
      const list = carriedOf(id);
      if (!list.length) unknown.push(id);
      else if (shared && compareEngines(list[0], shared) > 0) newer.push(id);
      else older.push(id);
    }
    const who = (ids) => namesLine(ids.map((id) => this.nameOf(id)));
    const has = (ids) => (ids.length > 1 ? "have" : "has");
    const theirs = (ids) =>
      [...new Set(ids.map((id) => carriedOf(id)[0]))].join(", ");
    if (older.length)
      lines.push(
        `${who(older)} ${has(older)} an older version of Throwing Wood (${theirs(older)})${shared ? ` than this pitch plays (${shared})` : ""}, so the match cannot start. ${who(older)}: reload the page or update the app.`,
      );
    if (newer.length)
      lines.push(
        `${who(newer)} ${has(newer)} a newer version of Throwing Wood (${theirs(newer)}) than the rest of this pitch (${shared}), so the match cannot start. Everyone else: reload the page or update the app, or ${who(newer)} can watch.`,
      );
    if (unknown.length)
      lines.push(
        `${who(unknown)} ${has(unknown)} a version of Throwing Wood too old to say which it is, so the match cannot start. ${who(unknown)}: reload the page or update the app.`,
      );
    return lines.join(" ") || null;
  }

  // The card for an engine that is not the pitch's (mayPlay's refusal). The pitch can
  // still be watched: WATCH closes it.
  showVersion(p, after = null) {
    const v = versionNotice(p.engine, p.match, p.why);
    this.note("engine", p.why, p.match ?? null);
    const close = this.cards.notice({
      kicker: `PITCH ${this.code}`,
      title: v.title,
      text: v.text,
      actions: [
        ...(v.reload ? [["RELOAD", () => location.reload(), "go"]] : []),
        [
          "WATCH",
          () => {
            close();
            after?.();
          },
          v.reload ? "" : "go",
        ],
      ],
      test: "engine-differs",
    });
  }

  // The host forgets members who left the room for good, between matches.
  pruneLater() {
    clearTimeout(this.pruneTimer);
    this.pruneTimer = setTimeout(() => {
      if (!this.room.isHost() || this.mode !== "lobby") return;
      const ids = this.room.members.map((m) => m.id);
      this.write((d) => pruneTeams(d, ids));
    }, 300);
  }

  // START (the host): the match is made here, on the room's engine, then committed. The
  // write checks the room's engine and the lineup again on the document it goes on: a
  // member who joined, left or changed seat meanwhile changes them, and START begins
  // again from there (a few times at most).
  async start(tries = 0) {
    const room = this.room;
    if (!room.isHost() || this.mode !== "lobby" || this.starting) return;
    this.setName(this.lobby.typedName());
    const doc = room.doc;
    const lu = lineup(doc, room.members);
    if (!lu) {
      this.lobby.say("Nobody is on a team yet.");
      return;
    }
    const e = this.roomEngine();
    if (!e.engine) {
      this.note("start-refused", e.missing.length, e.unknown.length);
      this.lobbyEngine();
      return;
    }
    const mm = e.engine;
    // the room's engine first: startCheck is that engine's own call, and an older one
    // answers only once it has loaded (the lobby's prefetch may not be done, or failed)
    let engine = null;
    this.starting = true;
    try {
      engine = await this.engineOf(mm);
    } catch (err) {
      this.note("engine-failed", mm, String(err?.message || err));
    } finally {
      this.starting = false;
    }
    if (!engine) {
      this.lobby.say(
        "This match's version of Throwing Wood did not load. Reload the page to try again.",
      );
      return;
    }
    if (!room.isHost() || this.mode !== "lobby") return;
    // the room moved while the engine loaded: from the top
    if (room.doc !== doc) return tries < 3 ? this.start(tries + 1) : undefined;
    const ok = startCheck(lu.players, speakAs(room.members, mm), room.you, mm);
    if (!ok.ok) {
      const who = [...ok.differ, ...ok.unknown].map((id) => this.nameOf(id));
      this.lobby.say(
        `${namesLine(who)} ${who.length > 1 ? "are" : "is"} on another version of Throwing Wood: reload to play.`,
      );
      this.note("start-refused", ok.differ.length, ok.unknown.length);
      return;
    }
    const now = new Date();
    const opts = matchOptions(
      doc,
      lu,
      {
        seed: Math.floor(Math.random() * 2 ** 31),
        start: {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          day: now.getDate(),
          hour: now.getHours(),
          min: now.getMinutes(),
        },
      },
      mm,
    );
    const n = lobbyOf(doc).n + 1;
    this.match = { players: lu.players, cpu: lu.cpu };
    this.matchMm = mm;
    this.refused = null;
    this.local = { n, seq: 0 };
    this.mode = "match";
    this.lobby.hide();
    this.game.useEngine(engine);
    this.control = this.controlHere();
    this.game.seat = this.seatFor(this.control);
    this.game.newMatch(opts);
    const snap = this.game.engine.snapshot();
    const hash = this.game.engine.hash().hash;
    this.speak(mm);
    this.note("start-on", mm);
    // The document gets the match's header (who plays, the computer, the host, the
    // engine) and its number; the snapshot, the hash and `meta` (what a replay needs
    // besides the log) go beside it in the start (PROTOCOL.md `start`), never in it.
    const full = startMatch(
      doc,
      {
        snap,
        hash,
        players: lu.players,
        cpu: lu.cpu,
        host: room.you,
        setup: opts,
        members: speakAs(room.members, mm),
      },
      mm,
    );
    if (!full) {
      this.mode = "lobby";
      this.toLobby();
      this.lobby.say("The match could not start. Try again.");
      return;
    }
    const fm = full.match;
    const header = {
      ...full,
      match: {
        n: fm.n,
        players: fm.players,
        cpu: fm.cpu ?? null,
        host: fm.host,
        engine: fm.engine,
      },
    };
    // `engine` is the match's major.minor (what picks the engine to replay it on);
    // `version` the full one it was started on, for the records (the old rider's `e`).
    const meta = {
      v: 1,
      setup: fm.setup,
      engine: fm.engine,
      version: engine.version ?? null,
      players: fm.players,
      cpu: fm.cpu ?? null,
    };
    this.match = header.match;
    this.newLog(n, hash, meta);
    let r = null;
    try {
      r = await room.start({ doc: header, n, h: hash, snap, meta });
    } catch (err) {
      this.note("start", err.code);
    }
    if (!r) {
      // someone wrote first (a member joined or changed side): from the top on the
      // newer document, a few times at most
      this.note("start-lost", tries + 1);
      if (this.mode === "match" && this.local.n === n) this.toLobby();
      if (tries < 3 && room.doc && !lobbyOf(room.doc).started)
        return this.start(tries + 1);
      room.resync();
      return;
    }
    if (this.mode === "match") this.afterEnter();
  }

  // REMATCH (the host): back to the lobby with the same teams.
  rematch() {
    this.write((d) => backToLobby(d, this.local.n));
  }

  // A new match's log, kept here so its replay can be watched at its end without asking
  // the api; null when this browser has not seen every action.
  newLog(n, h0, meta) {
    this.acts = [];
    this.h0 = h0;
    this.meta = meta;
    this.head = { seq: 0, h: h0 };
    this.overSnap = null;
    this.local = { n, seq: 0 };
  }

  // ---------- the match ----------

  // Who acts now, for the seats (src/net/seats.js): one object while the match, the
  // host and the members are the same, so the seats' answers are kept between changes
  // and the render loop never crosses to the engine for them.
  ctx() {
    const r = this.room;
    const members = r?.members || [];
    const host = r?.host;
    const k = this.ctxKey;
    if (k && k.members === members && k.host === host && k.match === this.match)
      return k.ctx;
    const ctx = {
      players: this.match?.players || NO_PLAYERS,
      cpu: this.match?.cpu ?? null,
      host,
      connected: members.filter((m) => m.connected).map((m) => m.id),
    };
    this.ctxKey = { members, host, match: this.match, ctx };
    return ctx;
  }

  // This browser's control: none while its engine may not play this match (mayPlay).
  controlHere() {
    return this.refused || this.observe
      ? NO_CONTROL
      : controlFor(this.ctx(), this.you);
  }

  seatFor(control) {
    return {
      sides: control.sides,
      cpu: control.cpu,
      mayAct: (need) =>
        this.mode === "match" &&
        !this.refused &&
        !this.observe &&
        mayAct(need, this.ctx(), this.you),
    };
  }

  // Seats are recomputed when members or the host change, and on the
  // controller's clock; never in the middle of a playback.
  refreshSeat() {
    const game = this.game;
    if (this.mode !== "match" || game.phase === "play") return;
    const c = this.controlHere();
    game.localSide = this.sideHere();
    this.syncView();
    if (!sameControl(c, this.control)) {
      const gotCpu = c.cpu && !this.control?.cpu;
      this.control = c;
      game.setSeat(this.seatFor(c));
      // the new host takes over a computer's throw the old host was holding
      if (gotCpu && game.need?.cpu && !this.busy())
        game.adopt(game.engine.snapshot());
      return;
    }
    // a raise or punishment kubb that has become (or stopped being) ours
    if (["wait", "raise", "punish"].includes(game.phase)) {
      const may = game.mayAct();
      if (may !== (game.phase !== "wait")) game.enter(game.engine.view());
    }
  }

  busy() {
    return this.pending > 0 || this.queue.length > 0;
  }

  // An action taken here: committed at once (PROTOCOL.md `act`: the action, the hash
  // and snapshot after it), and play goes on without waiting for the answer. The pitch
  // client sends it again after a reconnect until the pitch answers; a refusal (someone
  // else was first) brings the whole pitch back (onRefused).
  onAction(action, snap, hash) {
    if (this.mode !== "match" || this.refused || this.observe || snap == null)
      return;
    const n = this.local.n;
    const seq = this.local.seq + 1;
    this.local.seq = seq;
    this.head = { seq, h: hash };
    this.acts?.push({ a: action, h: hash, ts: Date.now() });
    let over = false;
    try {
      over = this.game.engine.need()?.kind === "over";
    } catch {
      // no need to read: not the end
    }
    if (over) this.overSnap = snap;
    this.room.act({ n, seq, a: action, h: hash, snap, over });
    this.note("commit", seq);
  }

  onOk({ seq, dup }) {
    this.note("ok", seq, dup ? "dup" : "");
  }

  // Someone else committed this seq first: their action is on its way, or already here;
  // the whole pitch is asked for and its snapshot taken (onState).
  onRefused({ seq, why }) {
    this.note("refused", seq, why);
    this.queue.length = 0;
    this.room.resync();
  }

  // ---------- the pitch's news ----------

  // `joined` (every connect) and `state` (a resync): the lobby document and the match
  // as the pitch holds them. A whole match (`full`) comes with the snapshot at its head;
  // a resume only with the header, its missed actions following as `acts`.
  onState({ doc, match }) {
    if (this.mode === "gone" || this.mode === "sealed") return;
    if (this.mode === "replay" || this.engineWait) {
      this.stale = true; // looked at again when the replay ends or the engine is in
      return;
    }
    const started = !!doc?.started && !!doc?.match && !!match;
    if (!started) {
      if (this.mode === "match") this.toLobby();
      this.onMembers();
      this.renderLobby();
      return;
    }
    if (match.full) {
      const m = { ...doc.match, ...match, hash: match.h, snap: match.snap };
      if (this.mode === "match" && this.local.n === match.n) {
        // the same match: in step unless the head moved past this browser, or its hash
        // is not the head's
        const behind = this.local.seq !== match.seq;
        let differs = false;
        try {
          differs = this.game.engine.hash().hash !== match.h;
        } catch {
          differs = true;
        }
        if (behind || differs) {
          this.note("adopt", match.seq, behind ? "behind" : "hash");
          this.adoptMatch(m);
        }
      } else this.enterMatch(m);
    } else if (this.mode !== "match" || this.local.n !== match.n) {
      // a resume of a match this page is not in (it cannot be, but be safe)
      this.room.resync();
    }
    this.onMembers();
  }

  // A lobby write (ours or anyone's). A rematch takes the pitch back to the lobby; a
  // new match comes as its own `start`.
  onDoc({ doc }) {
    if (this.mode === "gone" || this.mode === "sealed") return;
    if (this.mode === "replay" || this.engineWait) {
      this.stale = true;
      return;
    }
    if (!doc?.started && this.mode === "match") this.toLobby();
    this.renderLobby();
  }

  // The host started a match.
  onStart({ doc, n, h, snap, meta }) {
    if (this.mode === "gone" || this.mode === "sealed") return;
    if (this.mode === "replay" || this.engineWait) {
      this.stale = true;
      return;
    }
    this.newLog(n, h, meta);
    this.enterMatch({
      ...doc.match,
      n,
      seq: 0,
      hash: h,
      snap,
      over: false,
      fresh: true,
    });
  }

  // Actions others committed, in order. Each must be the next after this browser's;
  // a gap (something missed) asks for the whole pitch.
  onActs(acts) {
    if (this.mode === "replay" || this.engineWait) {
      this.stale = true;
      return;
    }
    if (this.mode !== "match") return;
    const now = Date.now();
    for (const a of acts) {
      if (a.n !== this.local.n || a.seq <= this.local.seq) continue;
      if (a.seq !== this.local.seq + 1) {
        this.note("gap", this.local.seq, a.seq);
        this.queue.length = 0;
        this.room.resync();
        return;
      }
      this.local.seq = a.seq;
      this.head = { seq: a.seq, h: a.h };
      this.acts?.push({ a: a.a, h: a.h, ts: a.ts });
      // a throw is drawn after its aim has played out on this screen (src/net/aim.js)
      const due =
        now + (a.a?.type === "throw" ? this.aimIn.holdFor(a.ts, now) : 0);
      this.queue.push({
        seq: a.seq,
        action: a.a,
        hash: a.h,
        due,
        over: a.over,
      });
    }
    this.drain();
  }

  // Play the queued actions, one playback at a time; each must end on the committed
  // hash, or the whole pitch is asked for (its snapshot is the head's).
  drain() {
    const game = this.game;
    while (this.queue.length && game.phase !== "play") {
      const e = this.queue[0];
      if (e.due > Date.now()) {
        clearTimeout(this.drainTimer);
        this.drainTimer = setTimeout(() => this.drain(), e.due - Date.now());
        return;
      }
      this.queue.shift();
      let r;
      try {
        r = game.applyRemote(e.action);
      } catch (err) {
        r = { ok: false, why: String(err?.message || err) };
      }
      const ok = r && r.ok !== false && game.engine.hash().hash === e.hash;
      this.note("apply", e.seq, ok ? "ok" : "resync");
      if (!ok) {
        this.queue.length = 0;
        this.room.resync();
        return;
      }
      if (e.over) this.overSnap = game.engine.snapshot();
    }
  }

  // The match's own engine (docs/ENGINES.md "Playing together"): a carried one not loaded
  // yet holds the pitch's news until it has (waitFor); one this page does not carry is
  // watched, never played, and says so. `m`: the header with n, seq, hash, snap, over.
  enterMatch(m) {
    const mm = majorMinor(m.engine);
    const reg = this.engines?.newest ? this.engines : null;
    const carried = reg ? reg.has(mm) : mm === ENGINE;
    const failed = this.engineFailed === mm;
    if (carried && reg && !failed && !reg.loaded(mm)) return this.waitFor(mm);
    this.mode = "match";
    this.arrivedOver = m.over ? m.n : null;
    this.match = {
      players: m.players,
      cpu: m.cpu ?? null,
      host: m.host,
      engine: m.engine,
    };
    if (!m.fresh) {
      // arrived part way (or after the end): the log so far is not here
      this.acts = null;
      this.meta = m.meta ?? null;
      this.h0 = m.h0 ?? null;
    }
    this.local = { n: m.n, seq: m.seq };
    this.head = { seq: m.seq, h: m.hash };
    this.overSnap = m.over ? m.snap : null;
    this.queue.length = 0;
    this.aimIn.clear();
    this.lobby?.hide();
    this.cards.close();
    this.game.shownCards.clear();
    // Check every member before giving out control: a watcher can become host and
    // run the computer too. A refused engine never takes either side or the CPU.
    const permission = failed
      ? { ok: false, why: "load", engine: ENGINE, match: mm }
      : carried
        ? mayPlay(mm, m, mm)
        : mayPlay(ENGINE, m);
    this.refused = permission.ok ? null : permission;
    this.matchMm = this.refused ? undefined : mm;
    this.enteredHost = this.room.host; // checkRefusedHost: a host that changes after
    this.game.useEngine(
      this.refused ? this.newestEngine : (reg?.loaded(mm) ?? this.newestEngine),
    );
    this.control = this.controlHere();
    this.game.seat = this.seatFor(this.control);
    this.game.localSide = this.sideHere();
    this.syncView();
    this.game.adopt(m.snap);
    // a match that ended with no `over` on its last action: the engine says so, after
    // the winner card went up, so it goes up again as an arrival's
    if (!m.over && this.game.engine.need().kind === "over") {
      this.arrivedOver = m.n;
      this.overSnap = m.snap;
      if (this.game.need?.kind === "over") this.onNeed(this.game.need);
    }
    this.note("start", m.n, m.seq);
    if (!this.refused) this.speak(mm);
    if (this.refused) this.showVersion(this.refused);
    else if (!this.game.localSide) {
      this.watchNoteUntil = Date.now() + tune.watchNoteMs;
    }
    this.afterEnter();
  }

  // A match's carried engine is loading: the pitch's news waits, then the whole pitch is
  // asked for afresh.
  waitFor(mm) {
    if (this.engineWait === mm) return;
    this.engineWait = mm;
    this.note("engine-wait", mm);
    this.engines.loadEngine(mm).then(
      () => {
        this.engineWait = null;
        this.catchUp(true);
      },
      (err) => {
        this.engineWait = null;
        this.engineFailed = mm;
        this.note("engine-failed", mm, String(err?.message || err));
        this.catchUp(true);
      },
    );
  }

  // The pitch's news was held (a replay, an engine loading): the whole pitch again.
  catchUp(always = false) {
    if (!this.stale && !always) return;
    this.stale = false;
    this.room.resync();
  }

  afterEnter() {
    this.shoutBar.hidden = this.observe;
    this.aimOut.reset();
  }

  adoptMatch(m) {
    this.queue.length = 0;
    this.local.seq = m.seq;
    this.head = { seq: m.seq, h: m.hash };
    // the log here is no longer whole: the replay comes from the api
    this.acts = null;
    if (m.over) this.overSnap = m.snap;
    this.game.adopt(m.snap);
  }

  toLobby() {
    this.mode = "lobby";
    this.match = null;
    this.matchMm = undefined;
    this.engineFailed = null; // the next match tries its engine again
    this.refused = null;
    this.local = { n: null, seq: 0 };
    this.head = null;
    this.queue.length = 0;
    this.aimIn.clear();
    this.control = null;
    this.cards.close();
    this.cards.clearPanel();
    this.game.seat = this.seatFor({ sides: [], cpu: false });
    this.game.useEngine(this.newestEngine);
    this.game.newPractice({ surface: optionsOf(this.room.doc).surface });
    this.shoutBar.hidden = true;
    this.syncView();
    // the level may have changed from the menu during the match
    this.lobby.setLevel(this.game.level);
    this.room.setMe({ level: this.game.level });
    this.lobby.show();
    this.renderLobby();
    this.lobby.setReplay(false);
    this.lookForReplay();
  }

  // The finished match's replay as this browser saw it: every action from the start,
  // with the start's info and the snapshot it ended on. null when any part is missing.
  replayHere() {
    const n = this.local.n;
    if (!this.acts || !this.meta || this.acts.length !== this.local.seq)
      return null;
    const snap = this.overSnap ?? this.game.engine.snapshot();
    const r = {
      ...this.meta,
      n,
      h0: this.h0,
      log: this.acts.map((e) => ({ a: e.a, h: e.h, ts: e.ts ?? null })),
      snap,
      hash: this.head?.h ?? null,
    };
    return isReplay(r) ? r : null;
  }

  onNeed(need) {
    setTimeout(() => this.drain(), 0);
    if (this.mode !== "match" || need.kind !== "over") return;
    // (the last action may be ours and on its way: the card does not wait for it, as
    // play never waits for `ok`; a refusal brings the pitch's own end back)
    this.overSnap ??= this.game.engine.snapshot();
    const arrived = this.arrivedOver === this.local.n;
    const data = this.replayHere();
    const m = { ...this.match, n: this.local.n, hash: this.head?.h ?? null };
    this.winnerCard(need, m, data, arrived);
    // arrived part way or after the end: the replay is the api's, offered when it is
    // this match and ends on the same hash
    if (!data) this.lookForKept(need, m);
  }

  async lookForKept(need, m, tries = 0) {
    if (!this.apiUrl) return;
    const r = await fetchReplay({
      ...this.apiOpts(),
      code: this.code,
      check: isReplay,
    });
    const still =
      this.mode === "match" &&
      this.local.n === m.n &&
      this.game.need?.kind === "over";
    if (!still) return;
    if (!r || r.n !== m.n || (m.hash && r.hash !== m.hash)) {
      // the api may not have made it whole yet (the last pushes are on their way)
      if (tries < 3)
        setTimeout(
          () => this.lookForKept(need, m, tries + 1),
          1500 * (tries + 1),
        );
      return;
    }
    this.note("kept", m.n);
    this.winnerCard(need, m, r, this.arrivedOver === m.n);
  }

  winnerCard(need, m, data, arrived) {
    const host = this.room.isHost();
    this.cards.winner(need, {
      rematch: host ? () => this.rematch() : null,
      sheet: this.sheet ? () => this.openSheet() : null,
      home: this.home,
      note: host ? null : `${this.nameOf(this.room.host)} can start a rematch.`,
      // a match whose replay is not to be had (yet) has none
      replay: data ? () => this.watch(data) : null,
      // a finished match on another site (src/embed/embed.js): with its replay only
      embed: data ? () => this.showEmbed() : null,
      // a highlight reel of it (docs/REEL.md): with its replay only
      reel: data ? this.reelFor(m) : null,
      first: arrived,
      teams: arrived ? teamsLine(m.players) : null,
    });
  }

  // ---------- a replay ----------

  // WATCH REPLAY (the winner card) or WATCH THE LAST MATCH (the lobby): the match
  // played again here (src/replay/player.js), read only. The pitch stays joined; its
  // news is looked at again at BACK TO THE PITCH.
  watch(data) {
    if (
      this.mode !== "match" &&
      this.mode !== "lobby" &&
      this.mode !== "sealed"
    )
      return;
    // the match's own engine: at once when it is loaded (the newest always is), else
    // once it has loaded, if the page is still where it was
    const from = this.mode;
    return withEngineFor(
      this.engines,
      data.engine,
      this.game.engine,
      (engine) => {
        if (this.mode === from) this.playReplay(data, engine);
      },
    );
  }

  playReplay(data, engine) {
    this.replayFrom = this.mode;
    this.mode = "replay";
    this.lobby?.hide();
    this.cards.close();
    this.cards.clearPanel?.();
    this.shoutBar.hidden = true;
    this.syncView();
    this.replay = new ReplayPlayer({
      game: this.game,
      root: this.ui,
      data,
      home: this.home,
      menu: this.menu,
      close: () => this.endReplay(),
      embed: () => this.showEmbed(),
      reel: this.reelFor(data),
      engine,
    });
    this.replay.start();
    this.note("replay", data.n);
  }

  // SCORE SHEET (the winner card, MENU): the match on screen. A finished match from an
  // older engine the site carries is read from that engine, set to the match's last
  // snapshot (docs/ENGINES.md); everything else, a replay playing included, from the
  // Game's.
  openSheet() {
    const m =
      this.mode === "sealed"
        ? this.sealed
        : this.mode === "match" && this.overSnap
          ? {
              engine: this.match?.engine,
              n: this.local.n,
              snap: this.overSnap,
              over: true,
            }
          : null;
    const mm = majorMinor(m?.engine);
    const engines = this.engines;
    const own =
      m &&
      typeof m.snap === "string" &&
      (this.mode === "sealed" || m.over) &&
      engines?.has(mm) &&
      mm !== engines.newest &&
      // a match played here on its own engine: the Game's engine is already it
      engines.loaded(mm) !== this.game.engine;
    if (!own) return this.sheet?.();
    const mode = this.mode;
    return withEngineFor(engines, mm, null, (engine) => {
      // the engine may have loaded after something else began on it: WATCH REPLAY
      // pressed while it loaded is playing by now, and a restore would end its replay
      const still =
        this.mode === mode &&
        (mode === "sealed" ? this.sealed === m : this.local.n === m.n);
      if (!still) return this.sheet?.();
      engine.restore(m.snap);
      return openSheet(this.ui, { game: this.game, engine });
    });
  }

  // EMBED: the HTML that shows this pitch's match on another site.
  showEmbed() {
    openEmbed(this.ui, { game: this.game, code: this.code });
  }

  // MAKE A HIGHLIGHT REEL: one Reel a finished match, shared by its winner card and
  // its replay, so their buttons say the same. `m`: { n, hash } of the match. The
  // replay in hand only decides that the button is shown: before asking, the card reads
  // the api's kept replay afresh (src/net/reel.js). The page's own word that a reel is done is
  // given only to the match this browser found finished on arriving: the page was
  // written for that one, never for a match played after it loaded.
  reelFor(m) {
    if (!this.apiUrl || !m) return null;
    if (this.reel && this.reel.match?.n === m.n) return this.reel;
    this.reel?.destroy();
    this.reel = new Reel({
      root: this.ui,
      game: this.game,
      code: this.code,
      url: this.apiUrl,
      match: { n: m.n, hash: m.hash ?? null },
      known: m.n === this.arrivedOver ? this.pageReel : null,
      fetch: this.fetch ?? null,
    });
    return this.reel;
  }

  endReplay() {
    const p = this.replay;
    if (!p) return;
    this.replay = null;
    p.destroy();
    const from = this.replayFrom;
    this.mode = from;
    if (from === "sealed") {
      this.game.adopt(this.sealed.snap); // the winner card again (sealedCard)
      return;
    }
    if (from === "match") {
      // back where the match was (the snapshot the Game held is the engine's now: the
      // replay played on it), then the pitch as it is now
      this.shoutBar.hidden = this.observe;
      this.syncView();
      if (this.overSnap) this.game.adopt(this.overSnap);
      this.catchUp(true);
      return;
    }
    if (from === "lobby") this.toLobby();
    this.catchUp(true);
  }

  // Who acts, for the HUD and the engine's cards.
  who(need) {
    if (this.mode !== "match" || !need || need.kind === "over") return null;
    const ctx = this.ctx();
    const actor = shownActor(need, ctx);
    if (actor === "cpu") return { text: "COMPUTER THROWS", mine: false };
    const mine = !this.refused && mayAct(need, ctx, this.you);
    const up = (s) => s.toUpperCase();
    if (need.kind === "throw") {
      const owner = need.setup?.thrower?.key;
      if (mine)
        return {
          text:
            owner && owner !== this.you
              ? `YOUR THROW FOR ${up(this.nameOf(owner))}`
              : "YOUR THROW",
          mine,
        };
      return { text: `${up(this.nameOf(actor))} THROWS`, mine };
    }
    const team = up(
      need.team || need.teams?.[need.side] || `TEAM ${need.side}`,
    );
    const verb = need.kind === "raise" ? "RAISES" : "PLACES A KUBB";
    if (mine)
      return {
        text: need.kind === "raise" ? "YOUR RAISE" : "PLACE YOUR KUBB",
        mine,
      };
    const many = ctx.players[need.side]?.length > 1;
    return { text: `${many ? team : up(this.nameOf(actor))} ${verb}`, mine };
  }

  // ---------- members, the host, casts ----------

  onStatus() {
    const s = this.room.status;
    this.openKey = null; // a new connection (or a new host) says it again
    if (s === "replaced")
      return this.joinFailed(new PitchError("replaced", ""));
    this.renderNet();
    this.renderLobby();
  }

  onMembers() {
    if (this.room.host !== this.openHost) {
      this.openHost = this.room.host;
      this.openKey = null;
    }
    this.refreshSeat();
    this.checkRefusedHost();
    this.renderLobby();
  }

  // The host runs the computer's turns on the match's engine. A browser that may not
  // play the match and becomes host mid-match (the host before it left) cannot: say so
  // once a match, with the way out (another member hosts once this one leaves).
  checkRefusedHost() {
    const r = this.room;
    if (this.mode !== "match" || !this.refused || !r.isHost()) return;
    if (r.host === this.enteredHost) return; // host from the start: its card says it
    if (!this.match?.cpu || r.match?.over || this.hostCard === this.local.n)
      return;
    this.hostCard = this.local.n;
    this.note("host-refused", this.local.n);
    const close = this.cards.notice({
      kicker: `PITCH ${this.code}`,
      title: "You are the host now",
      text: "This browser cannot play this match's version of Throwing Wood, so the computer cannot take its turns from here. Leave the pitch and another player becomes the host, or reload to get the newest version.",
      actions: [
        ["LEAVE THE PITCH", this.home, "go"],
        ["RELOAD", () => location.reload()],
        ["WATCH", () => close()],
      ],
      test: "host-refused",
    });
  }

  onCast(e) {
    const d = e.d;
    if (!d || typeof d !== "object") return;
    if (d.t === "aim" && this.mode === "match") this.aimIn.push(e, Date.now());
    else if (d.t === "shout" && SHOUTS.includes(d.w))
      this.showShout(e.from, d.w);
  }

  // Someone else's aim for this frame (Game.remoteFeed): drawn about 100 ms behind,
  // between their samples (src/net/aim.js); null when it has not changed.
  remoteAim() {
    if (this.mode !== "match") return null;
    const before = this.aimIn.drawn;
    const s = this.aimIn.at(Date.now());
    return s && s !== before ? s : null;
  }

  tick() {
    const room = this.room;
    if (!room || this.mode === "gone") return;
    this.drain();
    this.refreshSeat();
    this.publishOpen();
    this.renderNet();
  }

  // May this browser's aim go out now: its own throw in a match.
  aiming() {
    const game = this.game;
    return (
      this.mode === "match" &&
      this.room?.status === "open" &&
      game.phase === "aim" &&
      game.need?.kind === "throw" &&
      game.mayAct()
    );
  }

  // While it is this browser's throw: its aim, up to 15 a second, when it changed.
  castAim() {
    if (!this.aiming()) return;
    let st;
    try {
      st = this.game.aimState();
    } catch {
      return;
    }
    const d = this.aimOut.sample(st, performance.now());
    if (d) this.room.cast(d);
  }

  // The throw went (Game.onRelease): the aim as it stood just before, sent to every
  // watcher whatever the rate (`all`), so each sees the swing let go.
  castRelease(pre) {
    if (!this.aiming()) return;
    let st = pre;
    if (!st) {
      try {
        st = this.game.aimState();
      } catch {
        return;
      }
    }
    const d = this.aimOut.sample(st, performance.now(), { force: true });
    if (d) this.room.cast(d, true);
    this.aimOut.reset();
  }

  // The side this browser plays in the match: none for an observer or a refused engine.
  sideHere() {
    return this.refused || this.observe
      ? null
      : playingSide(this.ctx(), this.you);
  }

  // Anyone with no side in the match watches it with the watcher's view: the wide view
  // and the free camera (src/ui/watch-view.js, docs/OBSERVER.md). Players keep theirs.
  syncView() {
    const on = this.mode === "match" && !this.game.localSide;
    if (!on && !this.view) return;
    this.view ??= new WatchView({
      game: this.game,
      ui: this.ui,
      menu: this.menu,
    });
    if (on) this.view.on();
    else this.view.off();
  }

  // ---------- the HUD: connection, shouts ----------

  buildHud() {
    this.net = h("div.hud.net", { "data-test": "net", hidden: true });
    this.shouts = h("ul.shouts", { "aria-live": "polite" });
    const opts = h(
      "div.shout-opts",
      { hidden: true },
      SHOUTS.map((w) =>
        button(w, () => this.shout(w), "small", { "data-shout": w }),
      ),
    );
    const toggle = button(
      "SHOUT",
      () => {
        opts.hidden = !opts.hidden;
        toggle.setAttribute("aria-expanded", String(!opts.hidden));
      },
      "small",
      { "aria-expanded": "false", "data-test": "shout" },
    );
    this.shoutOpts = opts;
    this.shoutBar = h("div.shout-bar", { hidden: true }, toggle, opts);
    this.ui.append(this.net, this.shoutBar, this.shouts);
  }

  shout(w) {
    const now = Date.now();
    this.shoutOpts.hidden = true;
    if (now - this.lastShout < tune.shoutGapMs) return;
    this.lastShout = now;
    this.aimOut.spend(performance.now());
    this.room.cast({ t: "shout", w });
    this.showShout(this.you, w);
  }

  showShout(from, w) {
    const li = h(
      "li.shout",
      { "data-from": from },
      h("span.shout-name", this.nameOf(from)),
      h("span.shout-word", w),
    );
    this.shouts.append(li);
    while (this.shouts.children.length > 4) this.shouts.firstChild.remove();
    setTimeout(() => li.remove(), tune.shoutMs);
  }

  renderNet() {
    const s = this.room?.status;
    let text = "";
    if (this.mode === "match") {
      if (s === "reconnecting" || s === "connecting") text = "RECONNECTING";
      else if (Date.now() < this.watchNoteUntil)
        text = this.observe
          ? "YOU ARE WATCHING THIS MATCH."
          : "THE MATCH IS UNDER WAY: YOU ARE WATCHING. PICK A SIDE FOR THE NEXT ONE.";
    }
    if (this.net.textContent !== text) {
      this.net.textContent = text;
      this.net.hidden = !text;
      this.net.classList.toggle("warn", text === "RECONNECTING");
    }
  }

  note(...what) {
    this.log.push([Date.now(), ...what]);
    if (this.log.length > 200) this.log.shift();
  }

  // For tests (window.__kubb.pitch).
  state() {
    const g = this.game;
    return {
      mode: this.mode,
      you: this.you,
      host: this.room?.host,
      status: this.room?.status,
      local: { ...this.local },
      pending: this.pending,
      queued: this.queue.length,
      v: this.room?.v,
      docSeq: this.room?.match?.seq ?? null,
      docHash: this.room?.match?.h ?? null,
      hash: g.mode === "match" ? g.engine.hash().hash : null,
      phase: g.phase,
      side: sideOf(this.room?.doc, this.you),
      open: lobbyOf(this.room?.doc).open,
      members: this.room?.members.length ?? 0,
      playing: this.mode === "match" ? playingSide(this.ctx(), this.you) : null,
      control: this.control,
      mayAct: this.mode === "match" ? g.mayAct() : false,
      who: g.whoActs?.(g.need) ?? null,
      // the engines (docs/ENGINES.md): the Game's, the match's, and what this browser says
      engine: g.engine?.version ?? null,
      matchEngine: this.room?.doc?.match?.engine ?? null,
      aimSent: this.aimOut.k,
      aimHeard: this.aimIn.samples.length,
      announced: this.room?.me?.engine ?? null,
      // the watcher's view (docs/OBSERVER.md)
      observe: this.observe,
      observing: g.observing,
      wide: g.viewName,
      camMoved: g.freeCam?.moved ?? false,
    };
  }
}

// "Hanna, Ola v Per" for the winner card of a match this browser arrived at
// after its end.
function teamsLine(players) {
  if (!players) return null;
  const side = (s) => (players[s] || []).map((p) => p.name).join(", ");
  const a = side("A") || "The computer";
  const b = side("B") || "The computer";
  return `${a}  v  ${b}`;
}

// "Hanna", "Hanna and Ola", "Hanna, Ola and Per".
function namesLine(names) {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function plainError(err) {
  const c = err?.code;
  if (c === "too-big") return "That was too big for the pitch.";
  if (c === "closed") return "The connection to the pitch is closed.";
  return "The pitch did not take that. Try again.";
}
