// A shared pitch (docs/MULTIPLAYER.md): /p/<code> without ?solo=1. Joins
// the room (src/net/room.js), shows the lobby, and once the host starts,
// drives the Game through its seam (docs/CLIENT.md): the seat says who may
// act here, onAction commits what was done here, applyRemote plays what was
// done elsewhere, adopt takes the room's snapshot when this browser is out of
// step. The rules of who acts, the document's reducers and the in-step decision are
// the engine's (vendor/engine/room/), through src/net/seats.js, lobby.js and sync.js.
import { connect, memberId, observerId, RoomError } from "./room.js";
import {
  lobbyOf,
  joinTeam,
  setOptions,
  pruneTeams,
  lineup,
  matchOptions,
  startMatch,
  commitAction,
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
  nextHost,
} from "./seats.js";
import { decide, rider, aimKey } from "./sync.js";
import { Lobby } from "../ui/lobby.js";
import { WatchCard } from "../ui/watching.js";
import { WatchView } from "../ui/watch-view.js";
import { prefs } from "../game/prefs.js";
import { h, button } from "../ui/dom.js";
import { ReplayPlayer } from "../replay/player.js";
import { fetchReplay } from "../replay/fetch.js";
import { openEmbed, EMBED_ORIGIN } from "../ui/embed.js";
import { Reel } from "../ui/reel.js";
import { reelFromPage } from "./reel.js";
import { majorMinor, withEngineFor } from "../engine/registry.js";
import { openSheet } from "../ui/sheet.js";
import { SCENE_ROW } from "../render/scenes.js";
import { StepBack } from "./step-back.js";

export const tune = {
  tickMs: 200, // the controller's clock: aim casts (5 a second), drain, host check
  hostGoneMs: 16000, // a host away this long is replaced (the room allows 15 s)
  claimEveryMs: 5000,
  shoutMs: 2600, // a shout stays up this long
  shoutGapMs: 700, // this browser's shouts at most this often
  stuckMs: 8000, // still not connected after this: say so
  watchNoteMs: 7000,
  openEveryMs: 5 * 60 * 1000, // an open pitch's host says so again this often (listing TTL 15 min)
  // an observer first in line for host steps back (rejoins, last in line) so a player
  // can take over; while nobody does, the wait doubles from this to the cap
  // (src/net/step-back.js, docs/OBSERVER.md)
  stepBackMs: 20000,
  stepBackMaxMs: 5 * 60 * 1000,
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
  // env: { game, cards, ui, config, code, home, roomsUrl, sheet?, menu?, engines?,
  //        observe?, WebSocket? }
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
    this.engineWait = null; // a match's engine loading: the room's news waits for it
    this.engineFailed = null; // a match's engine that did not load
    this.mode = "lobby"; // lobby | match | replay | gone | sealed
    this.sealed = null; // a shared match's kept replay (showSealed)
    this.replay = null; // the replay player while one plays (src/replay/player.js)
    this.replayFrom = null; // the mode to go back to
    this.kept = null; // the match number this browser asked the room to keep
    this.arrivedOver = null; // the match number this browser first saw finished
    this.lastReplay = null; // the room's kept replay, for the lobby
    this.reel = null; // the highlight reel of the last finished match (src/ui/reel.js)
    this.local = { n: null, seq: 0 }; // the match and action this browser holds
    this.match = null; // doc.match's players and cpu, for the seats
    this.queue = []; // remote actions waiting for a playback to end
    this.pending = 0; // our own commits in flight
    this.control = null;
    this.lastAim = "";
    this.lastShout = 0;
    this.hostGoneAt = null;
    this.lastClaim = 0;
    this.watchNoteUntil = 0;
    this.observe = !!env.observe;
    this.stepping = new StepBack(tune);
    this.view = null; // the watcher's view (src/ui/watch-view.js), made when first needed
    this.log = []; // what happened, for the test hook and debugging
  }

  get you() {
    return this.room?.you;
  }

  // ---------- starting ----------

  begin() {
    const { game, cards } = this;
    // The pages function's og:video, written when this pitch's reel is done
    // (backend/pages/pitch.mjs): the one honest way to know on load, because asking
    // the room server is what starts a render (src/net/reel.js).
    this.pageReel = reelFromPage(
      document.querySelector('meta[property="og:video"]')?.content,
      this.code,
      [EMBED_ORIGIN, location.origin],
    );
    game.newPractice({ surface: prefs.get("pitchOptions", {}).surface });
    if (!this.roomsUrl) {
      cards.notice({
        kicker: `PITCH ${this.code}`,
        title: "No rooms here",
        text: "This copy of the game has no room server, so friends cannot join this pitch. You can still play the computer.",
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
    try {
      this.room = connect({
        url: this.roomsUrl,
        room: this.code,
        // an observer is a member of its own, never this browser's player
        member: this.observe ? observerId() : memberId(),
        // engine and engines: what this page carries, the newest until it knows the
        // room (the engine's docs/ROOM.md "Speaking down"; Pitch.speak)
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

    // a change of level in MENU: the lobby says it, the room hears it
    this.stopLevel = game.onLevel((v) => this.levelChanged(v));
    // and a change of name there (or the first one typed in the lobby): the room hears it
    this.stopName = game.onPlayerName((v) => this.nameChanged(v));

    this.buildHud();
    game.seat = this.seatFor({ sides: [], cpu: false });
    game.onAction = (a, snap, hash) => this.onAction(a, snap, hash);
    game.onNeed = (need) => this.onNeed(need);
    game.whoActs = (need) => this.who(need);
    cards.who = (need) => this.who(need);

    room.on("status", () => this.onStatus());
    room.on("state", () => this.resync());
    room.on("members", () => this.onMembers());
    room.on("host", () => this.onMembers());
    room.on("left", () => this.pruneLater());
    room.on("doc", (e) => this.onDoc(e));
    room.on("cast", (e) => this.onCast(e));
    room.on("error", (e) => this.note("room", e.code));

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
  }

  onReady() {
    clearTimeout(this.stuckTimer);
    const room = this.room;
    if (this.lobby.note.textContent.startsWith("Still trying"))
      this.lobby.say("");
    // an observer that made the room (nobody was here): there is nothing to watch
    if (this.observe && room.isHost() && room.v === 0) return this.noGame();
    // the host's own options go in on a new pitch, and OPEN from the web game’s page
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
    this.resync();
    this.lookForReplay();
  }

  // Between matches, a pitch that has had one offers its last finished match
  // (WATCH THE LAST MATCH) when the room keeps its replay. Asked on a socket of
  // its own (src/replay/fetch.js), once on arriving and after each match.
  async lookForReplay() {
    const doc = this.room?.doc;
    if (this.mode !== "lobby" || !doc || lobbyOf(doc).n < 1) return;
    const r = await fetchReplay({
      url: this.roomsUrl,
      code: this.code,
      check: isReplay,
      ...(this.WebSocket ? { WebSocket: this.WebSocket } : {}),
    });
    this.lastReplay = r;
    this.lobby?.setReplay(!!r);
  }

  // An observer found an empty pitch (its join made the room): it leaves, so the room
  // keeps no member, and says so.
  noGame() {
    clearInterval(this.timer);
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
    this.mode = "gone";
    this.lobby?.hide();
    const code = err instanceof RoomError ? err.code : "error";
    if (code === "sealed") return this.showSealed();
    const text = {
      full: "Sixteen people are on this pitch already, every one of them connected. Start a pitch of your own, or try again when someone leaves.",
      "bad-room":
        "That is not a pitch's link. Pitch links come from Start a pitch on the web game’s page.",
      replaced: "This pitch is open in another tab or window of this browser.",
    }[code];
    this.cards.notice({
      kicker: `PITCH ${this.code}`,
      title:
        code === "full"
          ? "This pitch is full"
          : code === "bad-room"
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

  // A match against the computer shared from a winner card (docs/REEL.md, docs/ROOMS.md
  // section 13) is a sealed room: it is watched, never joined. Its page shows the
  // finished match from the room's kept replay, as a browser arriving after a pitch's
  // end sees it: the result, WATCH REPLAY, the score sheet, EMBED and the reel. No
  // lobby, seats or rematch. The room never moves on, so the replay read here is the
  // one its reel is made from.
  async showSealed() {
    this.mode = "sealed";
    if (this.shoutBar) this.shoutBar.hidden = true;
    const r = await fetchReplay({
      url: this.roomsUrl,
      code: this.code,
      check: isReplay,
      ...(this.WebSocket ? { WebSocket: this.WebSocket } : {}),
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

  // room.update with the errors turned into a word in the lobby; resolves
  // the result or null.
  async write(fn, opts) {
    try {
      return await this.room.update(fn, opts);
    } catch (err) {
      this.note("write", err.code);
      if (err.code === "uncertain" || err.code === "busy") this.resync();
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

  // The host keeps the room server's listing in step with the document: on every
  // change, and again every tune.openEveryMs while open. Anyone else sends nothing.
  publishOpen(at = Date.now()) {
    const room = this.room;
    if (!room || !room.isHost() || room.status !== "open") return;
    const info = openListing(room.doc, room.members, {
      over:
        this.mode === "replay" ||
        (this.mode === "match" && this.game.need?.kind === "over"),
    });
    if (info) this.sawOpen = true;
    else if (!this.sawOpen) return; // never open here: nothing to take off
    const key = JSON.stringify(info);
    if (key === this.openKey && (!info || at - this.openAt < tune.openEveryMs))
      return;
    if (room.setOpen(info)) {
      this.openKey = key;
      this.openAt = at;
    }
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
    const key = JSON.stringify(lu);
    let moved = false;
    this.pending++;
    const r = await this.write((d) => {
      const members = room.members;
      moved =
        JSON.stringify(lineup(d, members)) !== key ||
        roomEngineFor(d, members, room.you, room.you, this.carries).engine !==
          mm;
      if (moved) return undefined;
      return startMatch(
        d,
        {
          snap,
          hash,
          players: lu.players,
          cpu: lu.cpu,
          host: room.you,
          setup: opts,
          members: speakAs(members, mm),
        },
        mm,
      );
    });
    this.pending--;
    if (!r) {
      this.resync();
      if (moved && tries < 3 && this.mode === "lobby") {
        this.note("start-again", tries + 1);
        return this.start(tries + 1);
      }
    }
    if (this.mode === "match") this.afterEnter();
  }

  // REMATCH (the host): back to the lobby with the same teams.
  rematch() {
    this.write((d) => backToLobby(d, this.local.n));
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

  // An action taken here: commit the snapshot after it, the action riding
  // along for the others to watch.
  onAction(action, snap, hash) {
    if (this.mode !== "match" || this.refused || this.observe || snap == null)
      return;
    const n = this.local.n;
    const seq = this.local.seq + 1;
    this.local.seq = seq;
    this.pending++;
    const w = rider(n, seq, action, {
      bytes: this.room.limits?.withBytes ?? 4096,
      engine: this.game.engine.version,
    });
    if (!w) this.note("too-big-for-with", action.type);
    let over = false;
    try {
      over = this.game.engine.need()?.kind === "over";
    } catch {
      // no need to read: not the end
    }
    this.room
      .update(
        (d) =>
          commitAction(d, { n, seq, snap, hash, action, over }, this.matchMm),
        w ? { with: w } : {},
      )
      .then(
        (r) => {
          this.pending--;
          this.note("commit", seq, r ? "ok" : "lost");
          // lost: someone else acted first; their document is already here
          if (!r) this.resync();
          else this.keepReplay(r.doc, r.v);
          this.overLater();
        },
        (err) => {
          this.pending--;
          this.note("commit", seq, err.code);
          this.resync();
          this.overLater();
        },
      );
  }

  onDoc({ v, doc, with: w, mine }) {
    this.handleDoc(doc, w, mine);
    this.keepReplay(doc, v);
  }

  // A match this browser watched end (here or elsewhere): ask the room to keep its
  // replay a year (docs/ROOMS.md section 10). Once a match; the room keeps the
  // first it is told for a document version. A browser that only arrived after the
  // end sends nothing.
  keepReplay(doc, v) {
    const m = doc?.match;
    if (!doc?.started || !m?.over || m.n !== this.local.n) return;
    if (this.kept === m.n || this.arrivedOver === m.n) return;
    const r = replayOf(m);
    if (!r) return;
    if (this.room.keep(r, v)) {
      this.kept = m.n;
      this.note("keep", m.n);
    }
  }

  // Look at the room's document as it is now.
  resync() {
    if (!this.room || this.mode === "gone") return;
    this.handleDoc(this.room.doc, undefined, false);
    this.onMembers();
  }

  handleDoc(doc, w, mine) {
    if (this.mode === "gone") return;
    // a replay playing: the room's news waits for its end (endReplay looks again)
    if (this.mode === "replay") return;
    // a match's engine loading: so does the room's news (waitFor looks again)
    if (this.engineWait) return;
    const d = decide(this.local, doc, w, mine);
    switch (d.kind) {
      case "lobby":
        if (this.mode === "match") this.toLobby();
        this.renderLobby();
        return;
      case "start":
        return this.enterMatch(d.match);
      case "old":
        return;
      case "same":
        if (!this.busy() && this.game.engine.hash().hash !== d.match.hash) {
          this.note("adopt", d.match.seq, "hash");
          this.adoptMatch(d.match);
        }
        return;
      case "apply":
        this.queue.push({
          seq: d.match.seq,
          action: d.action,
          hash: d.match.hash,
          snap: d.match.snap,
        });
        this.local.seq = d.match.seq;
        this.drain();
        return;
      case "adopt":
        this.note("adopt", d.match.seq, d.why);
        this.adoptMatch(d.match);
        return;
    }
  }

  // Play the queued actions, one playback at a time; each must end on the
  // committed hash, or the committed snapshot is taken.
  drain() {
    const game = this.game;
    while (this.queue.length && game.phase !== "play") {
      const e = this.queue.shift();
      let r;
      try {
        r = game.applyRemote(e.action);
      } catch (err) {
        r = { ok: false, why: String(err?.message || err) };
      }
      const ok = r && r.ok !== false && game.engine.hash().hash === e.hash;
      this.note("apply", e.seq, ok ? "ok" : "adopt");
      if (!ok) {
        this.queue.length = 0;
        game.adopt(e.snap);
        this.local.seq = e.seq;
      }
    }
  }

  // The match's own engine (docs/ENGINES.md "Playing together"): a carried one not loaded
  // yet holds the room's news until it has (waitFor); one this page does not carry is
  // watched, never played, and says so.
  enterMatch(m) {
    const mm = majorMinor(m.engine);
    const reg = this.engines?.newest ? this.engines : null;
    const carried = reg ? reg.has(mm) : mm === ENGINE;
    const failed = this.engineFailed === mm;
    if (carried && reg && !failed && !reg.loaded(mm)) return this.waitFor(mm);
    this.mode = "match";
    this.arrivedOver = m.over ? m.n : null;
    this.match = { players: m.players, cpu: m.cpu };
    this.local = { n: m.n, seq: m.seq };
    this.queue.length = 0;
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
    // a match that had ended before replays has no `over`: the engine says so, after
    // the winner card went up, so it goes up again as an arrival's (with any replay
    // the room keeps for it)
    if (!m.over && this.game.engine.need().kind === "over") {
      this.arrivedOver = m.n;
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

  // A match's carried engine is loading: the room's news waits (handleDoc), then the
  // document as it is by then is looked at afresh.
  waitFor(mm) {
    if (this.engineWait === mm) return;
    this.engineWait = mm;
    this.note("engine-wait", mm);
    this.engines.loadEngine(mm).then(
      () => {
        this.engineWait = null;
        this.resync();
      },
      (err) => {
        this.engineWait = null;
        this.engineFailed = mm;
        this.note("engine-failed", mm, String(err?.message || err));
        this.resync();
      },
    );
  }

  afterEnter() {
    this.shoutBar.hidden = this.observe;
    this.lastAim = "";
  }

  adoptMatch(m) {
    this.queue.length = 0;
    this.local.seq = m.seq;
    this.game.adopt(m.snap);
  }

  toLobby() {
    this.mode = "lobby";
    this.match = null;
    this.matchMm = undefined;
    this.engineFailed = null; // the next match tries its engine again
    this.refused = null;
    this.local = { n: null, seq: 0 };
    this.queue.length = 0;
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

  onNeed(need) {
    this.lastAim = "";
    setTimeout(() => this.drain(), 0);
    if (this.mode !== "match" || need.kind !== "over") return;
    const m = this.room.doc?.match;
    const data = m && m.n === this.local.n ? replayOf(m) : null;
    // the last action is ours and still on its way: the card when it lands
    if (!data && this.pending > 0) {
      this.overNeed = need;
      return;
    }
    this.overNeed = null;
    const arrived = this.arrivedOver === this.local.n;
    this.winnerCard(need, m, data, arrived);
    // a match whose document carries no replay (it ended before replays) may still have
    // one the room keeps, set down after it was played (tools/backfill-replay.mjs):
    // offered when it is this match and ends on the very snapshot the room holds
    if (!data && arrived && m) this.lookForKept(need, m);
  }

  async lookForKept(need, m) {
    const r = await fetchReplay({
      url: this.roomsUrl,
      code: this.code,
      check: isReplay,
      ...(this.WebSocket ? { WebSocket: this.WebSocket } : {}),
    });
    const still =
      this.mode === "match" &&
      this.local.n === m.n &&
      this.game.need?.kind === "over";
    if (!r || !still || r.n !== m.n || r.snap !== m.snap) return;
    this.note("kept", m.n);
    this.winnerCard(need, m, r, true);
  }

  winnerCard(need, m, data, arrived) {
    const host = this.room.isHost();
    this.cards.winner(need, {
      rematch: host ? () => this.rematch() : null,
      sheet: this.sheet ? () => this.openSheet() : null,
      home: this.home,
      note: host ? null : `${this.nameOf(this.room.host)} can start a rematch.`,
      // a match from before replays (or too long to keep) has none
      replay: data ? () => this.watch(data) : null,
      // a finished match on another site (src/embed/embed.js): with its replay only
      embed: data ? () => this.showEmbed() : null,
      // a highlight reel of it (docs/REEL.md): with its replay only
      reel: data ? this.reelFor(m) : null,
      first: arrived,
      teams: arrived ? teamsLine(m.players) : null,
    });
  }

  // The winner card held back for our own last commit (onNeed).
  overLater() {
    if (this.pending > 0 || !this.overNeed) return;
    const need = this.overNeed;
    this.overNeed = null;
    if (this.mode === "match" && this.game.need?.kind === "over")
      this.onNeed(need);
  }

  // ---------- a replay ----------

  // WATCH REPLAY (the winner card) or WATCH THE LAST MATCH (the lobby): the match
  // played again here (src/replay/player.js), read only. The room stays joined; its
  // news waits until BACK TO THE PITCH.
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
        : this.mode === "match" && this.room?.doc?.match?.n === this.local.n
          ? this.room.doc.match
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
        (mode === "sealed"
          ? this.sealed === m
          : this.room?.doc?.match?.n === m.n);
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
  // the room's kept replay afresh (src/net/reel.js). The page's own word that a reel is done is
  // given only to the match this browser found finished on arriving: the page was
  // written for that one, never for a match played after it loaded.
  reelFor(m) {
    if (!this.roomsUrl || !m) return null;
    if (this.reel && this.reel.match?.n === m.n) return this.reel;
    this.reel?.destroy();
    this.reel = new Reel({
      root: this.ui,
      game: this.game,
      code: this.code,
      url: this.roomsUrl,
      match: { n: m.n, hash: m.hash ?? null },
      known: m.n === this.arrivedOver ? this.pageReel : null,
      ...(this.WebSocket ? { WebSocket: this.WebSocket } : {}),
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
    const doc = this.room.doc;
    if (from === "match" && doc?.started && doc.match?.n === this.local.n) {
      this.shoutBar.hidden = this.observe;
      this.syncView();
      this.adoptMatch(doc.match);
      return;
    }
    if (from === "lobby") {
      this.toLobby();
      this.resync();
      return;
    }
    // the pitch moved on while the replay played (a rematch)
    this.resync();
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

  // ---------- the room's news ----------

  onStatus() {
    const s = this.room.status;
    this.openKey = null; // a new connection (or a new host) says it again
    if (s === "replaced") return this.joinFailed(new RoomError("replaced", ""));
    this.renderNet();
    this.renderLobby();
  }

  onMembers() {
    if (this.room.host !== this.openHost) {
      this.openHost = this.room.host;
      this.openKey = null;
    }
    const host = this.room.members.find((m) => m.id === this.room.host);
    if (host && host.connected) this.hostGoneAt = null;
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
    if (
      !this.match?.cpu ||
      r.doc?.match?.over ||
      this.hostCard === this.local.n
    )
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

  onCast({ from, d }) {
    if (!d || typeof d !== "object") return;
    if (d.t === "aim" && this.mode === "match") this.game.showRemoteAim(d.s);
    else if (d.t === "shout" && SHOUTS.includes(d.w)) this.showShout(from, d.w);
  }

  tick() {
    const room = this.room;
    if (!room || this.mode === "gone") return;
    this.drain();
    this.refreshSeat();
    this.castAim();
    this.checkHost();
    this.publishOpen();
    this.renderNet();
  }

  // While it is this browser's throw: its aim, about 5 a second, when it changed.
  castAim() {
    const game = this.game;
    if (
      this.mode !== "match" ||
      game.phase !== "aim" ||
      game.need?.kind !== "throw" ||
      !game.mayAct()
    )
      return;
    let st;
    try {
      st = game.aimState();
    } catch {
      return;
    }
    const key = aimKey(st);
    if (key === this.lastAim) return;
    if (this.room.cast({ t: "aim", s: st })) this.lastAim = key;
  }

  // The host has been away a while: the next in line claims.
  checkHost() {
    const room = this.room;
    if (room.status !== "open" || room.isHost()) return;
    if (this.observe)
      this.stepping.see(
        room.members.filter((m) => m.connected).map((m) => m.id),
      );
    const host = room.members.find((m) => m.id === room.host);
    if (host && host.connected) {
      this.hostGoneAt = null;
      this.stepping.reset();
      return;
    }
    const now = Date.now();
    this.hostGoneAt ??= now;
    if (host && now - this.hostGoneAt < tune.hostGoneMs) return;
    if (nextHost(room.members, room.host) !== room.you) return;
    if (this.observe) return this.stepBack(now);
    if (now - this.lastClaim < tune.claimEveryMs) return;
    this.lastClaim = now;
    this.note("claim");
    room.claimHost();
  }

  // An observer never hosts (the host runs the computer and opens the game), so when it
  // is first in line it leaves and joins again, last in line, and the next member
  // claims as before. Only when someone else is here to take over, and backing off
  // while nobody takes host (src/net/step-back.js). A race (two step at once, or a claim meanwhile) is harmless: the
  // room server decides who is first, and this is asked again on the next tick.
  stepBack(now = Date.now()) {
    const room = this.room;
    if (!room.members.some((m) => m.connected && m.id !== room.you)) return;
    if (!this.stepping.due(now)) return;
    this.stepping.took(now);
    this.note("step-back");
    room.rejoin();
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
      docSeq: this.room?.doc?.match?.seq ?? null,
      docHash: this.room?.doc?.match?.hash ?? null,
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
      announced: this.room?.me?.engine ?? null,
      // the watcher's view (docs/OBSERVER.md)
      observe: this.observe,
      observing: g.observing,
      wide: g.viewName,
      camMoved: g.freeCam?.moved ?? false,
      stepBacks: this.stepping.steps,
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
  if (c === "too-big") return "That was too big for the room.";
  if (c === "closed") return "The connection to the pitch is closed.";
  return "The pitch did not take that. Try again.";
}
