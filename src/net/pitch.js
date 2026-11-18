// A shared pitch (docs/MULTIPLAYER.md): /p/<code> without ?solo=1. Joins
// the room (src/net/room.js), shows the lobby, and once the host starts,
// drives the Game through its seam (docs/CLIENT.md): the seat says who may
// act here, onAction commits what was done here, applyRemote plays what was
// done elsewhere, adopt takes the room's snapshot when this browser is out of
// step. The rules of who acts, the document's reducers and the in-step decision are
// the engine's (vendor/engine/room/), through src/net/seats.js, lobby.js and sync.js.
import { connect, memberId, RoomError } from "./room.js";
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
  sideOf,
  setAccess,
  openListing,
  replayOf,
  isReplay,
  startCheck,
  mayPlay,
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
import { prefs } from "../game/prefs.js";
import { h, button } from "../ui/dom.js";
import { ReplayPlayer } from "../replay/player.js";
import { fetchReplay } from "../replay/fetch.js";
import { openEmbed } from "../ui/embed.js";

export const tune = {
  tickMs: 200, // the controller's clock: aim casts (5 a second), drain, host check
  hostGoneMs: 16000, // a host away this long is replaced (the room allows 15 s)
  claimEveryMs: 5000,
  shoutMs: 2600, // a shout stays up this long
  shoutGapMs: 700, // this browser's shouts at most this often
  stuckMs: 8000, // still not connected after this: say so
  watchNoteMs: 7000,
  openEveryMs: 5 * 60 * 1000, // an open pitch's host says so again this often (listing TTL 15 min)
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

// The card for a member whose engine is not the pitch's (docs/MULTIPLAYER.md "Engines").
// `theirs`: the pitch's engine (the match's, or the host's before START); null when it
// names none (an older build).
export function versionNotice(mine, theirs) {
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
  // env: { game, cards, ui, config, code, home, roomsUrl, sheet?, menu?, WebSocket? }
  // sheet: () => void, opens the score sheet (the winner card's SCORE SHEET)
  constructor(env) {
    Object.assign(this, env);
    this.mode = "lobby"; // lobby | match | replay | gone
    this.replay = null; // the replay player while one plays (src/replay/player.js)
    this.replayFrom = null; // the mode to go back to
    this.kept = null; // the match number this browser asked the room to keep
    this.arrivedOver = null; // the match number this browser first saw finished
    this.lastReplay = null; // the room's kept replay, for the lobby
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
    this.log = []; // what happened, for the test hook and debugging
  }

  get you() {
    return this.room?.you;
  }

  // ---------- starting ----------

  begin() {
    const { game, cards } = this;
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
    const name = cleanName(prefs.get("name", prefs.get("solo", {}).name));
    this.name = name;
    try {
      this.room = connect({
        url: this.roomsUrl,
        room: this.code,
        member: memberId(),
        // engine: this engine's major.minor, so START can check everyone plays the same
        me: { name, level: game.level, engine: ENGINE },
        ...(this.WebSocket ? { WebSocket: this.WebSocket } : {}),
      });
    } catch (err) {
      this.joinFailed(err);
      return;
    }
    const room = this.room;

    this.lobby = new Lobby(
      cards,
      game,
      {
        name: (t) => this.setName(t),
        level: (v) => this.setLevel(v),
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
    // the host's own options go in on a new pitch, and OPEN from the home page
    // (/p/<code>?open=1) makes it an open game
    if (room.isHost() && room.v === 0) {
      const o = cleanOptions(prefs.get("pitchOptions", {}));
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

  joinFailed(err) {
    clearTimeout(this.stuckTimer);
    clearInterval(this.timer);
    this.mode = "gone";
    this.lobby?.hide();
    const code = err instanceof RoomError ? err.code : "error";
    const text = {
      full: "Sixteen people are on this pitch already, every one of them connected. Start a pitch of your own, or try again when someone leaves.",
      "bad-room":
        "That is not a pitch's link. Pitch links come from the home page.",
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

  setName(text) {
    const name = cleanName(text);
    if (name === this.name) return;
    this.name = name;
    prefs.set("name", name);
    this.room.setMe({ name });
  }

  setLevel(v) {
    this.game.setLevel(v);
    this.room?.setMe({ level: v });
  }

  async pickTeam(side) {
    this.setName(this.lobby.nameInput.value);
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

  // The host: open (listed on the home page) or invite only.
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
    });
    this.checkHostEngine();
  }

  // In the lobby, on a team: does the host (who will START) run another engine than
  // this browser? The engine says (mayPlay against the engine the match would carry);
  // the card goes up once for each host and engine.
  checkHostEngine() {
    const r = this.room;
    if (r.status !== "open") return;
    const mine = r.me.engine;
    if (mine && (r.isHost() || !sideOf(r.doc, r.you))) {
      this.engineKey = null;
      return;
    }
    const host = r.members.find((m) => m.id === r.host);
    const theirs = host?.me?.engine ?? null;
    const key = JSON.stringify([mine, r.host, theirs]);
    if (key === this.engineKey) return;
    this.engineKey = key;
    const p = mayPlay(mine, { engine: theirs });
    if (p.ok) return;
    this.showVersion(p, () => this.lobby.show());
  }

  // The card for an engine that is not the pitch's (mayPlay's refusal). The pitch can
  // still be watched: WATCH closes it.
  showVersion(p, after = null) {
    const v = versionNotice(p.engine, p.match);
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

  // START (the host): the match is made here, then committed.
  async start() {
    const room = this.room;
    if (!room.isHost() || this.mode !== "lobby") return;
    if (!room.me.engine) {
      this.checkHostEngine();
      return;
    }
    this.setName(this.lobby.nameInput.value);
    const doc = room.doc;
    const lu = lineup(doc, room.members);
    if (!lu) {
      this.lobby.say("Nobody is on a team yet.");
      return;
    }
    const ok = startCheck(lu.players, room.members, room.you);
    if (!ok.ok) {
      const who = [...ok.differ, ...ok.unknown].map((id) => this.nameOf(id));
      this.lobby.say(
        `${who.join(", ")} ${who.length > 1 ? "are" : "is"} on another version of Throwing Wood: reload to play.`,
      );
      this.note("start-refused", ok.differ.length, ok.unknown.length);
      return;
    }
    const now = new Date();
    const opts = matchOptions(doc, lu, {
      seed: Math.floor(Math.random() * 2 ** 31),
      start: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        min: now.getMinutes(),
      },
    });
    const n = lobbyOf(doc).n + 1;
    this.match = { players: lu.players, cpu: lu.cpu };
    this.refused = null;
    this.local = { n, seq: 0 };
    this.mode = "match";
    this.lobby.hide();
    this.control = this.controlHere();
    this.game.seat = this.seatFor(this.control);
    this.game.newMatch(opts);
    const snap = this.game.engine.snapshot();
    const hash = this.game.engine.hash().hash;
    this.pending++;
    const r = await this.write((d) =>
      startMatch(d, {
        snap,
        hash,
        players: lu.players,
        cpu: lu.cpu,
        host: room.you,
        setup: opts,
        members: room.members,
      }),
    );
    this.pending--;
    if (!r) this.resync();
    this.afterEnter();
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
    return this.refused ? NO_CONTROL : controlFor(this.ctx(), this.you);
  }

  seatFor(control) {
    return {
      sides: control.sides,
      cpu: control.cpu,
      mayAct: (need) =>
        this.mode === "match" &&
        !this.refused &&
        mayAct(need, this.ctx(), this.you),
    };
  }

  // Seats are recomputed when members or the host change, and on the
  // controller's clock; never in the middle of a playback.
  refreshSeat() {
    const game = this.game;
    if (this.mode !== "match" || game.phase === "play") return;
    const c = this.controlHere();
    game.localSide = this.refused ? null : playingSide(this.ctx(), this.you);
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
    if (this.mode !== "match" || this.refused || snap == null) return;
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
        (d) => commitAction(d, { n, seq, snap, hash, action, over }),
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

  enterMatch(m) {
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
    const permission = mayPlay(this.room.me.engine, m);
    this.refused = permission.ok ? null : permission;
    this.control = this.controlHere();
    this.game.seat = this.seatFor(this.control);
    this.game.localSide = this.refused
      ? null
      : playingSide(this.ctx(), this.you);
    this.game.adopt(m.snap);
    // a match that had ended before replays has no `over`: the engine says so, after
    // the winner card went up, so it goes up again as an arrival's (with any replay
    // the room keeps for it)
    if (!m.over && this.game.engine.need().kind === "over") {
      this.arrivedOver = m.n;
      if (this.game.need?.kind === "over") this.onNeed(this.game.need);
    }
    this.note("start", m.n, m.seq);
    if (this.refused) this.showVersion(this.refused);
    else if (!this.game.localSide) {
      this.watchNoteUntil = Date.now() + tune.watchNoteMs;
    }
    this.afterEnter();
  }

  afterEnter() {
    this.shoutBar.hidden = false;
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
    this.refused = null;
    this.local = { n: null, seq: 0 };
    this.queue.length = 0;
    this.control = null;
    this.cards.close();
    this.cards.clearPanel();
    this.game.seat = this.seatFor({ sides: [], cpu: false });
    this.game.newPractice({ surface: lobbyOf(this.room.doc).options.surface });
    this.shoutBar.hidden = true;
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
      sheet: this.sheet,
      home: this.home,
      note: host ? null : `${this.nameOf(this.room.host)} can start a rematch.`,
      // a match from before replays (or too long to keep) has none
      replay: data ? () => this.watch(data) : null,
      // a finished match on another site (src/embed/embed.js): with its replay only
      embed: data ? () => this.showEmbed() : null,
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
    if (this.mode !== "match" && this.mode !== "lobby") return;
    this.replayFrom = this.mode;
    this.mode = "replay";
    this.lobby?.hide();
    this.cards.close();
    this.cards.clearPanel?.();
    this.shoutBar.hidden = true;
    this.replay = new ReplayPlayer({
      game: this.game,
      root: this.ui,
      data,
      home: this.home,
      menu: this.menu,
      close: () => this.endReplay(),
      embed: () => this.showEmbed(),
    });
    this.replay.start();
    this.note("replay", data.n);
  }

  // EMBED: the HTML that shows this pitch's match on another site.
  showEmbed() {
    openEmbed(this.ui, { game: this.game, code: this.code });
  }

  endReplay() {
    const p = this.replay;
    if (!p) return;
    this.replay = null;
    p.destroy();
    const from = this.replayFrom;
    this.mode = from;
    const doc = this.room.doc;
    if (from === "match" && doc?.started && doc.match?.n === this.local.n) {
      this.shoutBar.hidden = false;
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
    this.renderLobby();
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
    const host = room.members.find((m) => m.id === room.host);
    if (host && host.connected) {
      this.hostGoneAt = null;
      return;
    }
    const now = Date.now();
    this.hostGoneAt ??= now;
    if (host && now - this.hostGoneAt < tune.hostGoneMs) return;
    if (nextHost(room.members, room.host) !== room.you) return;
    if (now - this.lastClaim < tune.claimEveryMs) return;
    this.lastClaim = now;
    this.note("claim");
    room.claimHost();
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
        text =
          "THE MATCH IS UNDER WAY: YOU ARE WATCHING. PICK A SIDE FOR THE NEXT ONE.";
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

function plainError(err) {
  const c = err?.code;
  if (c === "too-big") return "That was too big for the room.";
  if (c === "closed") return "The connection to the pitch is closed.";
  return "The pitch did not take that. Try again.";
}
