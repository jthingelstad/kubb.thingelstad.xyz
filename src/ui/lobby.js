// The lobby on a pitch link (docs/MULTIPLAYER.md): your name (the device's
// generated name, in its name row: src/ui/name-row.js), the two teams with who is on
// them and, for a side of several, the team's name (the host's to pick), who is
// connected and who is host, who is watching, the link to share, who can join (open
// or invite only), the host's match options and START. Built once; update(state)
// changes only what changed, so picking a name is never interrupted by someone else
// joining.
import { h, button, clear } from "./dom.js";
import {
  MATCH_OPTIONS,
  SEAT_LEVELS,
  TEAM_MAX,
  engineConstants,
  isSeat,
  lobbyOf,
  optionLabel,
  optionRows,
  optionsOf,
} from "../net/lobby.js";
import { roomEngine } from "../net/room-engine.js";
import { youRow } from "./settings.js";
import { nameRow } from "./name-row.js";
import { segBar } from "./seg.js";
import { sceneId, takesScene } from "../render/scenes.js";
import { sceneTiles } from "./scene-tiles.js";
import { ROW_ORDER } from "./cards.js";
import { THROWS, THROW_WORD, THROW_DEFAULT } from "../game/throw-level.js";

// "Computer level", as the iPhone app and the solo card say it (the engine's label
// is "Computer")
const ROW_LABEL = { computer: "Computer level" };
const TEAM_LABEL = { A: "Team A", B: "Team B" };

// ---------- computer seats (engine 0.17; docs/SYSTEM.md "Computer seats") ----------

// A level as shown: the engine's words (its Computer row's labels).
export const LEVEL_WORD = {
  kid: "Kid",
  beginner: "Beginner",
  club: "Club",
  pro: "Pro",
};
// The Computer row beside seats: the level of the computer on an empty side, shown
// while a side has nobody and no seat; with no empty side and a seat on the pitch, a
// Kid match switch (Kid is the match's, never a seat's); else not shown.
export const COMPUTER_ROW = {
  empty: "An empty side plays as",
  kid: "Kid match",
};
export const KID_SWITCH = [
  ["off", "Off"],
  ["on", "On"],
];
export const KID_NOTE = "Kid match: every computer plays as Kid.";
// What the host's changes say, once, to a screen reader.
export const SEAT_SAYS = {
  add: (name, side, level) =>
    `${name} joins ${TEAM_LABEL[side]} at ${LEVEL_WORD[level] ?? level}.`,
  level: (name, level) => `${name} now plays at ${LEVEL_WORD[level] ?? level}.`,
  up: (name) => `${name} moves up.`,
  down: (name) => `${name} moves down.`,
  across: (name, side) => `${name} moves to ${TEAM_LABEL[side]}.`,
  remove: (name) => `${name} is off the team.`,
};

// A seat read as one thing: "Bold Birch, computer, Pro, 2 of 3 in Team A".
export function seatSpoken(name, level, place, of, side) {
  return `${name}, computer, ${LEVEL_WORD[level] ?? level}, ${place} of ${of} in ${TEAM_LABEL[side]}`;
}
// Everyone else's row: "Bold Birch · computer · Pro".
export function seatLine(name, level) {
  return `${name} · computer · ${LEVEL_WORD[level] ?? level}`;
}
// the engine's rows the lobby leaves out: the set, which the scene decides
export const HIDDEN_ROWS = new Set(["set"]);
export const ACCESS = [
  ["invite", "Invite only"],
  ["open", "Open"],
];
export const ACCESS_NOTE = {
  invite: "Only people with the link can join.",
  open: "Listed under Open games on the home page: anyone can join.",
};

export class Lobby {
  // hooks: { name(text), team(side|null), option(key, v), access(open),
  //          start(), share(), home(), menu() }
  constructor(cards, game, hooks, { code, name }) {
    this.cards = cards;
    this.game = game;
    this.hooks = hooks;
    this.code = code;
    this.closeFn = null;

    // one "You" row: your name, this device's (src/game/player-name.js), picked here
    // or in MENU; no level, as a person throws on one meter from engine 0.13
    // (src/game/throw-level.js)
    this.names = game.names;
    this.you = youRow("lobby", {
      names: this.names,
      name,
      setName: (t) => hooks.name(t),
      caption: "You are",
    });

    // the person's throw (engine 1.3 on), the device's, under the name: shown only
    // while the next match's engine has throw levels (a pitch with an engine 1.0
    // player has none)
    this.throwSeg = segBar({
      choices: THROWS,
      value: game.throwLevel,
      key: "throw",
      labelledBy: "lobby-label-throw",
      onPick: (v) => game.setThrowLevel(v),
    });
    this.throwRow = h(
      "div.opt",
      { "data-test": "lobby-opt-throw", hidden: true },
      h("span.opt-label", { id: "lobby-label-throw" }, "Throw"),
      this.throwSeg.el,
    );

    this.teams = {};
    for (const side of ["A", "B"]) {
      const list = h("ul.roster", { "data-test": `team-${side}` });
      const count = h("span.team-count");
      const join = button(`JOIN ${side}`, () => hooks.team(side), "small", {
        "data-test": `join-${side}`,
      });
      // the host's: a computer player last in this team's order (docs/SYSTEM.md
      // "Computer seats")
      const add = button(
        "ADD COMPUTER",
        () => hooks.addComputer?.(side),
        "small",
        {
          "data-test": `add-computer-${side}`,
          "data-focus": `add-${side}`,
          "aria-label": `Add a computer player to ${TEAM_LABEL[side]}`,
          hidden: true,
        },
      );
      const kidNote = h(
        "p.team-empty.team-kid",
        { "data-test": `team-${side}-kid`, hidden: true },
        KID_NOTE,
      );
      const empty = h("p.team-empty");
      // a side of several plays under a team name, the host's to pick (a side of one
      // plays under its player's name)
      const teamName = h("div.team-name", {
        "data-test": `team-${side}-name-box`,
        hidden: true,
      });
      this.teams[side] = {
        list,
        count,
        join,
        add,
        kidNote,
        empty,
        teamName,
        row: null,
        listKey: null,
        el: h(
          `section.team.team-${side.toLowerCase()}`,
          h("h3.team-head", TEAM_LABEL[side], count),
          teamName,
          list,
          kidNote,
          empty,
          join,
          add,
        ),
      };
    }
    this.teamsEl = h("div.teams", this.teams.A.el, this.teams.B.el);
    // the host's seat changes, said once (docs/SYSTEM.md "Computer seats")
    this.said = h("p.visually-hidden", {
      role: "status",
      "aria-live": "polite",
      "data-test": "lobby-said",
    });
    this.watchList = h("p.watchers", { "data-test": "watchers" });
    this.sitOut = button("WATCH INSTEAD", () => hooks.team(null), "quiet", {
      "data-test": "sit-out",
    });
    this.shareBtn = button("SHARE THE LINK", () => hooks.share(), "small", {
      "data-test": "share",
    });
    this.linkText = h("span.link-text", location.host + location.pathname);
    // the pitch's last finished match, when the room keeps its replay
    this.replayBtn = button(
      "WATCH THE LAST MATCH",
      () => hooks.replay?.(),
      "small",
      { "data-test": "lobby-replay", hidden: true },
    );
    this.optionsBox = h("div.lobby-options", { "data-test": "lobby-options" });
    this.startBtn = button("START", () => hooks.start(), "go big", {
      "data-test": "lobby-start",
    });
    this.waiting = h("p.waiting", { "data-test": "waiting" });
    this.note = h("p.lobby-note", {
      role: "status",
      hidden: true,
      "data-test": "lobby-note",
    });
    // what keeps the next match from starting, when the players' versions of the game
    // have no engine in common (Pitch.lobbyEngine)
    this.engineNote = h("p.lobby-note.lobby-engine", {
      role: "status",
      hidden: true,
      "data-test": "lobby-engine",
    });
    this.status = h("span.lobby-status");

    this.el = h(
      "div.card.options.lobby",
      { "data-test": "lobby" },
      h("p.kicker", `PITCH ${code}  `, this.status),
      h("h2.display", "Pick a side"),
      this.you.el,
      this.throwRow,
      this.teamsEl,
      this.said,
      h("div.watch-row", this.watchList, this.sitOut),
      h("div.share-row", this.shareBtn, this.linkText, this.replayBtn),
      this.optionsBox,
      this.engineNote,
      this.note,
      h(
        "div.row.start-row",
        button("HOME", () => hooks.home(), "quiet", {
          "data-test": "lobby-home",
        }),
        this.waiting,
        this.startBtn,
      ),
    );
    this.optKey = null;
  }

  get shown() {
    return !!this.closeFn;
  }

  show() {
    if (this.closeFn) return;
    // (Cards.show closes us when another card takes the screen)
    this.closeFn = this.cards.show(this.el, this.game, {
      onClose: () => {
        this.closeFn = null;
        this.game?.showScene?.(null);
      },
    });
    this.showScene();
  }

  // The pitch behind the lobby and the page show the room's Scene while the lobby
  // is up (a pitch whose next match cannot take one: the day); a match then draws
  // its own view's.
  showScene() {
    if (this.closeFn) this.game?.showScene?.(this.scene ?? "day");
  }

  hide() {
    if (this.closeFn) this.closeFn();
  }

  // Show WATCH THE LAST MATCH or not.
  setReplay(on) {
    this.replayBtn.hidden = !on;
  }

  say(text) {
    this.note.textContent = text || "";
    this.note.hidden = !text;
    // a refusal is read where it is (START's row stays at the foot while the card
    // scrolls): brought into view
    if (text && this.closeFn)
      this.note.scrollIntoView?.({ block: "center", behavior: "auto" });
  }

  // A seat change the host made, said once to a screen reader.
  announce(text) {
    this.said.textContent = "";
    if (text) requestAnimationFrame(() => (this.said.textContent = text));
  }

  // Why the next match cannot start, or null when it can. While it cannot, START is off.
  setEngine(text) {
    if (this.engineNote.textContent !== (text || ""))
      this.engineNote.textContent = text || "";
    this.engineNote.hidden = !text;
    if (text) this.startBtn.disabled = true;
  }

  // A side's team name: the host picks it in a name row, everyone else reads it.
  // Shown while the side has several players.
  teamNameShow(side, { several, isHost, name }) {
    const t = this.teams[side];
    t.teamName.hidden = !several;
    if (!several) return;
    // the host's row once the side has its rolled name (src/net/pitch.js
    // rollTeamNames); until then, and for everyone else, the name as text
    const mode = isHost && this.names.valid("team", name).ok ? "host" : "read";
    if (t.mode !== mode) {
      t.mode = mode;
      t.row = null;
      t.text = null;
      if (mode === "host")
        t.row = nameRow({
          names: this.names,
          kind: "team",
          text: name,
          label: `${TEAM_LABEL[side]}'s name`,
          key: `team-${side}-name`,
          onChange: (v) => this.hooks.teamName?.(side, v),
        });
      else
        t.text = h("p.team-title", { "data-test": `team-${side}-name-text` });
      t.teamName.replaceChildren(
        h("span.opt-label", "Plays as"),
        t.row ? t.row.el : t.text,
      );
    }
    if (t.row) t.row.set(name);
    else if (t.text.textContent !== name) t.text.textContent = name;
  }

  // st: { you, host, members, doc, status, nameOf(id), teamName(side), seatName(id),
  // engine }, engine the major.minor the next match runs on (null when none is
  // carried by all: then the newest's options are shown)
  update(st) {
    const l = lobbyOf(st.doc);
    const byId = new Map(st.members.map((m) => [m.id, m]));
    const isHost = st.host === st.you;
    const mySide = l.teams.A.includes(st.you)
      ? "A"
      : l.teams.B.includes(st.you)
        ? "B"
        : null;
    // a Kid pitch: every computer plays as Kid, whatever its seat says (the seat keeps
    // its own level for when Kid is switched off)
    const kid = optionsOf(st.doc).computer === "kid";
    const comps = l.computers ?? {};
    const throws = takesThrows(st.engine);
    this.throwRow.hidden = !throws;
    // who is on each side, in throwing order: the members on the pitch and the seats
    const shown = {};
    for (const side of ["A", "B"])
      shown[side] = l.teams[side].filter((id) =>
        isSeat(id) ? !!comps[id] : byId.has(id),
      );
    const anySeat = ["A", "B"].some((s) => shown[s].some((id) => isSeat(id)));
    this.teamsEl.classList.toggle("has-seats", anySeat);
    const open = st.status === "open";
    // where the keyboard is, to put it back after a list is drawn again
    const active = document.activeElement;
    const focus = this.teamsEl.contains(active)
      ? {
          key: active.dataset?.focus ?? null,
          add: active.closest(".team")?.querySelector("[data-focus^='add-']")
            ?.dataset.focus,
        }
      : null;

    for (const side of ["A", "B"]) {
      const t = this.teams[side];
      const ids = shown[side];
      const other = side === "A" ? "B" : "A";
      const full = ids.length >= TEAM_MAX;
      const otherFull = shown[other].length >= TEAM_MAX;
      t.count.textContent = ` ${ids.length} of ${TEAM_MAX}`;
      // the list is drawn again only when what it shows changed, and the keyboard
      // stays where it was (a seat's controls)
      const rows = ids.map((id, i) => {
        if (!isSeat(id)) {
          const m = byId.get(id);
          return {
            id,
            name: st.nameOf(id),
            connected: !!m.connected,
            host: id === st.host,
            you: id === st.you,
            // the person's throw beside the name (engine 1.3 on)
            throw: throws ? throwOf(m.me) : null,
          };
        }
        const level = comps[id].level;
        return {
          id,
          seat: true,
          name: st.seatName?.(id) ?? "Computer",
          level,
          shownLevel: kid ? "kid" : level,
          first: i === 0,
          last: i === ids.length - 1,
          // the doc's places of the rows either side, for a move up or down
          up: i > 0 ? l.teams[side].indexOf(ids[i - 1]) : null,
          down: i < ids.length - 1 ? l.teams[side].indexOf(ids[i + 1]) : null,
          place: i + 1,
          of: ids.length,
        };
      });
      const listKey = JSON.stringify([rows, isHost, open, otherFull, kid]);
      if (listKey !== t.listKey) {
        t.listKey = listKey;
        clear(t.list);
        for (const r of rows)
          t.list.append(
            r.seat
              ? seatRow(r, {
                  side,
                  other,
                  host: isHost && open,
                  otherFull,
                  hooks: this.hooks,
                })
              : memberRow(byId.get(r.id), st, r.throw),
          );
      }
      t.empty.textContent = ids.length
        ? ""
        : shown[other].length
          ? "The computer plays this side."
          : "Nobody yet.";
      t.empty.hidden = !t.empty.textContent;
      t.kidNote.hidden = !(kid && ids.some((id) => isSeat(id)));
      t.join.hidden = mySide === side;
      t.join.disabled = full;
      t.join.textContent = full
        ? `${TEAM_LABEL[side]} IS FULL`
        : `JOIN ${side}`;
      t.add.hidden = !isHost;
      t.add.disabled = full || !open;
      this.teamNameShow(side, {
        several: ids.length > 1,
        isHost,
        name: st.teamName?.(side) ?? TEAM_LABEL[side],
      });
    }
    if (focus?.key && !this.teamsEl.contains(document.activeElement))
      refocus(this.teamsEl, focus);
    const emptySide = ["A", "B"].some((s) => !shown[s].length);

    const watching = st.members.filter(
      (m) => !l.teams.A.includes(m.id) && !l.teams.B.includes(m.id),
    );
    clear(this.watchList);
    this.watchList.append(h("span.opt-label", "Watching "));
    if (!watching.length) this.watchList.append("nobody");
    watching.forEach((m, i) => {
      if (i) this.watchList.append(", ");
      this.watchList.append(
        h(
          `span.who${m.connected ? "" : ".away"}`,
          st.nameOf(m.id) +
            (m.id === st.you ? " (you)" : "") +
            (m.id === st.host ? " (host)" : ""),
        ),
      );
    });
    this.sitOut.hidden = !mySide;

    // the options: the host's to set, everyone else's to read. The rows are the
    // next match's engine's (the computer's level since 0.9), the values the room's.
    // An older engine still loading: the five every engine has (`options`), none of
    // the newest's own, until it is in (the pitch draws the lobby again then).
    const loaded = !st.engine || !!roomEngine(st.engine);
    const mm = st.engine && loaded ? st.engine : undefined;
    const options = optionsOf(st.doc);
    // the Computer row's form: the empty side's level, the Kid match switch, or none
    const computerRow = emptySide ? "empty" : anySeat ? "kid" : null;
    const key = JSON.stringify([
      isHost,
      options,
      l.open,
      mm ?? null,
      loaded,
      computerRow,
    ]);
    if (key !== this.optKey) {
      this.optKey = key;
      clear(this.optionsBox);
      const access = l.open ? "open" : "invite";
      this.optionsBox.append(
        h(
          "div.opt",
          { "data-test": "lobby-access" },
          h("span.opt-label", "Who can join"),
          isHost
            ? seg(
                ACCESS,
                access,
                (v) => this.hooks.access?.(v === "open"),
                "access",
                "Who can join",
              ).el
            : h("span.opt-value", l.open ? "Open" : "Invite only"),
        ),
        h("p.access-note", ACCESS_NOTE[access]),
      );
      this.optionsBox.append(h("h3", "The match"));
      // the rows are the engine's card for the room's scene (engine 0.14,
      // `pitch.optionRows`): the Scene first, a Surface row only where the scene
      // leaves one (Black & White), no Kubbs row (the scene decides the set), then
      // Computer level (Kid first since 0.15), Opening, Raising, Wind, as on the solo
      // card. An engine without optionRows (none carried today) walks its
      // MATCH_OPTIONS without the set, as before.
      const scened = loaded && takesScene(engineConstants(mm));
      this.scene = scened ? sceneId(options.scene) : "day";
      let rows;
      try {
        rows = optionRows(this.scene, mm).rows;
      } catch {
        rows = (
          mm
            ? engineConstants(mm).MATCH_OPTIONS
            : loaded
              ? MATCH_OPTIONS
              : MATCH_OPTIONS.filter(([k]) => k in l.options)
        ).filter(([k]) => !HIDDEN_ROWS.has(k));
      }
      rows = rows.filter(([k]) => !HIDDEN_ROWS.has(k));
      const sceneRow = rows.find(([k]) => k === "scene");
      this.tiles?.stop();
      this.tiles = null;
      if (sceneRow) {
        // the Scene: the host's as picture tiles, everyone else's as its name
        if (isHost) {
          this.tiles = sceneTiles({
            choices: sceneRow[2],
            value: this.scene,
            game: this.game,
            labelledBy: "lobby-label-scene",
            test: "lobby-scene-tile",
            onPick: (v) => this.hooks.option("scene", v),
          });
        }
        this.optionsBox.append(
          h(
            "div.opt.opt-scene",
            { "data-test": "lobby-opt-scene" },
            h("span.opt-label", { id: "lobby-label-scene" }, sceneRow[1]),
            this.tiles
              ? this.tiles.el
              : h(
                  "span.opt-value",
                  sceneRow[2].find(([v]) => v === this.scene)?.[1] ??
                    optionLabel("scene", this.scene),
                ),
          ),
        );
      }
      const ordered = rows
        .filter(([k]) => k !== "scene")
        .sort(
          (a, b) =>
            (ROW_ORDER.indexOf(a[0]) + 1 || 99) -
            (ROW_ORDER.indexOf(b[0]) + 1 || 99),
        );
      for (const [k, label, choices] of ordered) {
        if (k === "computer") {
          this.computerRow(computerRow, choices, options, isHost);
          continue;
        }
        this.optionsBox.append(
          h(
            "div.opt",
            { "data-test": `lobby-opt-${k}` },
            h("span.opt-label", ROW_LABEL[k] ?? label),
            isHost
              ? seg(
                  choices,
                  options[k],
                  (v) => this.hooks.option(k, v),
                  k,
                  ROW_LABEL[k] ?? label,
                ).el
              : h(
                  "span.opt-value",
                  choices.find(([v]) => v === options[k])?.[1] ??
                    optionLabel(k, options[k]),
                ),
          ),
        );
      }
      this.showScene();
    }

    // anyone on a team, a seat too: START with no person is the engine's to refuse,
    // in its own words (startCheck's `text`)
    const players = shown.A.length + shown.B.length;
    this.startBtn.hidden = !isHost;
    this.startBtn.disabled = players === 0 || st.status !== "open";
    this.waiting.hidden = isHost;
    this.waiting.textContent = st.host
      ? `Waiting for ${st.nameOf(st.host)} to start.`
      : "Waiting for the host to start.";
    const hint =
      "Join a team to start. An empty side is played by the computer.";
    if (isHost && players === 0) this.say(hint);
    else if (this.note.textContent === hint) this.say("");
    this.status.textContent =
      st.status === "open"
        ? ""
        : st.status === "connecting"
          ? "· CONNECTING"
          : st.status === "reconnecting"
            ? "· RECONNECTING"
            : "";
  }

  // The device's name changed (in MENU, or picked here): the row says it.
  setName(v) {
    this.you.setName(v);
  }

  // The device's throw changed (in Settings, or picked here): the row says it.
  setThrow(v) {
    this.throwSeg.set?.(v);
  }

  // The Computer row beside seats (docs/SYSTEM.md "Computer seats"): "An empty side
  // plays as" while a side has nobody and no seat; "Kid match" Off/On with no empty
  // side and a seat on the pitch; nothing when no computer plays.
  computerRow(form, choices, options, isHost) {
    if (!form) return;
    const value = options.computer;
    let bar;
    if (form === "empty")
      bar = isHost
        ? seg(
            choices,
            value,
            (v) => this.hooks.option("computer", v),
            "computer",
            COMPUTER_ROW.empty,
          ).el
        : h(
            "span.opt-value",
            choices.find(([v]) => v === value)?.[1] ??
              optionLabel("computer", value),
          );
    else
      bar = isHost
        ? seg(
            KID_SWITCH,
            value === "kid" ? "on" : "off",
            (v) => this.hooks.option("computer", v === "on" ? "kid" : "club"),
            "computer-kid",
            COMPUTER_ROW.kid,
          ).el
        : h("span.opt-value", value === "kid" ? "On" : "Off");
    this.optionsBox.append(
      h(
        "div.opt",
        { "data-test": "lobby-opt-computer", "data-form": form },
        h("span.opt-label", COMPUTER_ROW[form]),
        bar,
      ),
    );
  }
}

// A computer seat's row (docs/SYSTEM.md "Computer seats"). The host's: the name and
// " · computer", its level as a segmented bar (Kid in a Kid pitch, as a word), up and
// down in the team's order, across to the other team, and REMOVE. Everyone else's: one
// line, "Bold Birch · computer · Pro". Either way one group to a screen reader.
// r: the row (Lobby.update); o: { side, other, host, otherFull, hooks }.
function seatRow(r, { side, other, host, otherFull, hooks }) {
  const spoken = seatSpoken(r.name, r.shownLevel, r.place, r.of, side);
  const base = {
    role: "group",
    "aria-label": spoken,
    "data-seat": r.id,
    "data-level": r.shownLevel,
  };
  if (!host)
    return h(
      "li.member.seat",
      base,
      h("span.member-name", r.name),
      h("span.seat-what", ` · computer · ${LEVEL_WORD[r.shownLevel]}`),
    );
  const k = (what) => `${r.id}:${what}`;
  const level =
    r.shownLevel === "kid"
      ? h("span.seat-kid", { "data-test": "seat-kid" }, LEVEL_WORD.kid)
      : segBar({
          choices: SEAT_LEVELS.map((v) => [v, LEVEL_WORD[v] ?? v]),
          value: r.level,
          onPick: (v) => hooks.seatLevel?.(r.id, v),
          key: k("level"),
          label: `${r.name}'s level`,
        }).el;
  for (const b of level.querySelectorAll("button"))
    b.dataset.focus = k("level");
  const small = (label, fn, focus, aria, off, test) =>
    button(label, fn, "small", {
      "data-focus": k(focus),
      "data-test": test,
      "aria-label": aria,
      disabled: off,
    });
  return h(
    "li.seat.seat-host",
    base,
    h(
      "div.seat-head",
      h("span.member-name", r.name),
      h("span.seat-what", " · computer"),
    ),
    level,
    h(
      "div.seat-moves",
      small(
        "↑",
        () => hooks.moveSeat?.(r.id, side, r.up, "up"),
        "up",
        `Move ${r.name} up`,
        r.first,
        "seat-up",
      ),
      small(
        "↓",
        () => hooks.moveSeat?.(r.id, side, r.down, "down"),
        "down",
        `Move ${r.name} down`,
        r.last,
        "seat-down",
      ),
      small(
        `TO ${other}`,
        () => hooks.moveSeat?.(r.id, other, null, "across"),
        "across",
        `Move ${r.name} to ${TEAM_LABEL[other]}`,
        otherFull,
        "seat-across",
      ),
      button("REMOVE", () => hooks.removeSeat?.(r.id), "quiet", {
        "data-focus": k("remove"),
        "data-test": "seat-remove",
        "aria-label": `Remove ${r.name}`,
      }),
    ),
  );
}

// After the teams are drawn again: the keyboard back on the control it was on (by its
// data-focus; a level bar's chosen part), wherever its seat now is, else the next one
// along in that seat's row that is on, else (the seat removed) its team's ADD
// COMPUTER. focus: { key, add }.
function refocus(root, { key, add }) {
  const all = [...root.querySelectorAll("[data-focus]")];
  const at = all.filter((el) => el.dataset.focus === key && !el.disabled);
  const pick =
    at.find((el) => el.getAttribute("aria-checked") === "true") ?? at[0];
  if (pick) return pick.focus({ preventScroll: true });
  const seat = key.split(":").slice(0, 2).join(":");
  const after = ["level", "up", "down", "across", "remove"];
  const from = after.indexOf(key.split(":")[2]);
  const row = all.filter(
    (el) => el.dataset.focus.startsWith(seat + ":") && !el.disabled,
  );
  const next =
    row.find((el) => after.indexOf(el.dataset.focus.split(":")[2]) > from) ??
    row[0];
  if (next) return next.focus({ preventScroll: true });
  root.querySelector(`[data-focus="${add}"]`)?.focus({ preventScroll: true });
}

// A member's throw as the lobby says it: "Easy", "Standard" or "Hard".
const throwOf = (me) => THROW_WORD[me?.throw] ?? THROW_WORD[THROW_DEFAULT];

// Whether the engine `mm` (the next match's) has throw levels (engine 1.3 on).
function takesThrows(mm) {
  // an engine not loaded yet is asked once it is (the lobby is drawn again then)
  if (mm && !roomEngine(mm)) return false;
  try {
    return Array.isArray(engineConstants(mm || undefined)?.THROW_LEVELS);
  } catch {
    return false;
  }
}

function memberRow(m, st, throwWord = null) {
  const tags = [];
  if (m.id === st.host) tags.push(h("span.tag", "HOST"));
  if (m.id === st.you) tags.push(h("span.tag.you", "YOU"));
  return h(
    `li.member${m.connected ? "" : ".away"}`,
    { "data-member": m.id },
    h("span.dot", {
      title: m.connected ? "Connected" : "Not connected",
      "aria-label": m.connected ? "connected" : "not connected",
    }),
    h("span.member-name", st.nameOf(m.id)),
    throwWord
      ? h(
          "span.member-throw",
          { "data-test": "member-throw" },
          ` · ${throwWord} throw`,
        )
      : null,
    tags,
  );
}

function seg(choices, value, onPick, key, label = null) {
  return segBar({ choices, value, onPick, key, label });
}
