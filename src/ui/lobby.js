// The lobby on a pitch link (docs/MULTIPLAYER.md): your name, the level you throw
// at (MENU's, never picked here), the two teams with who is on them, who is connected and who is host, who is
// watching, the link to share, who can join (open or invite only), the host's
// match options and START. Built
// once; update(state) changes only what changed, so typing a name is never
// interrupted by someone else joining.
import { h, button, clear } from "./dom.js";
import {
  MATCH_OPTIONS,
  TEAM_MAX,
  engineConstants,
  lobbyOf,
  optionLabel,
  optionsOf,
  NAME_MAX,
} from "../net/lobby.js";
import { roomEngine } from "../net/room-engine.js";
import { levelLine } from "../game/throw-level.js";
import { SCENE_ROW, sceneId, takesScene } from "../render/scenes.js";

// "Computer level", as the iPhone app and the solo card say it (the engine's label
// is "Computer")
const ROW_LABEL = { computer: "Computer level" };
const TEAM_LABEL = { A: "Team A", B: "Team B" };
export const ACCESS = [
  ["invite", "Invite only"],
  ["open", "Open"],
];
export const ACCESS_NOTE = {
  invite: "Only people with the link can join.",
  open: "Listed under Open games on the web game’s page: anyone can join.",
};

export class Lobby {
  // hooks: { name(text), team(side|null), option(key, v), access(open),
  //          start(), share(), home(), menu() }
  constructor(cards, game, hooks, { code, name, level }) {
    this.cards = cards;
    this.game = game;
    this.hooks = hooks;
    this.code = code;
    this.closeFn = null;

    this.nameInput = h("input.name", {
      type: "text",
      maxlength: NAME_MAX,
      value: name || "",
      placeholder: "Your name",
      autocomplete: "off",
      spellcheck: "false",
      enterkeyhint: "done",
      "aria-label": "Your name",
      "data-test": "lobby-name",
    });
    const sendName = () => hooks.name(this.nameInput.value);
    this.nameInput.addEventListener("change", sendName);
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        sendName();
        this.nameInput.blur();
      }
    });
    let timer = null;
    this.nameInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(sendName, 600);
    });

    // the level you throw at is this device's, set in MENU (src/game/throw-level.js)
    this.levelText = h("span.opt-value", levelLine(level));
    this.levelRow = h(
      "div.opt",
      { "data-test": "lobby-level" },
      h("span.opt-label", "Your level"),
      this.levelText,
      button("CHANGE IN MENU", () => hooks.menu?.(), "small", {
        "data-test": "lobby-level-menu",
      }),
    );

    this.teams = {};
    for (const side of ["A", "B"]) {
      const list = h("ul.roster", { "data-test": `team-${side}` });
      const count = h("span.team-count");
      const join = button(`JOIN ${side}`, () => hooks.team(side), "small", {
        "data-test": `join-${side}`,
      });
      const empty = h("p.team-empty");
      this.teams[side] = {
        list,
        count,
        join,
        empty,
        el: h(
          `section.team.team-${side.toLowerCase()}`,
          h("h3.team-head", TEAM_LABEL[side], count),
          list,
          empty,
          join,
        ),
      };
    }
    this.watchList = h("p.watchers", { "data-test": "watchers" });
    this.sitOut = button("WATCH INSTEAD", () => hooks.team(null), "small", {
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
      h("label.opt", h("span.opt-label", "Your name"), this.nameInput),
      this.levelRow,
      h("div.teams", this.teams.A.el, this.teams.B.el),
      h("div.watch-row", this.watchList, this.sitOut),
      h("div.share-row", this.shareBtn, this.linkText, this.replayBtn),
      this.optionsBox,
      this.engineNote,
      this.note,
      h(
        "div.row.start-row",
        this.startBtn,
        this.waiting,
        button("HOME", () => hooks.home()),
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
  }

  // Why the next match cannot start, or null when it can. While it cannot, START is off.
  setEngine(text) {
    if (this.engineNote.textContent !== (text || ""))
      this.engineNote.textContent = text || "";
    this.engineNote.hidden = !text;
    if (text) this.startBtn.disabled = true;
  }

  // st: { you, host, members, doc, status, nameOf(id), engine }, engine the
  // major.minor the next match runs on (null when none is carried by all: then the
  // newest's options are shown)
  update(st) {
    const l = lobbyOf(st.doc);
    const byId = new Map(st.members.map((m) => [m.id, m]));
    const isHost = st.host === st.you;
    const mySide = l.teams.A.includes(st.you)
      ? "A"
      : l.teams.B.includes(st.you)
        ? "B"
        : null;

    for (const side of ["A", "B"]) {
      const t = this.teams[side];
      const ids = l.teams[side].filter((id) => byId.has(id));
      t.count.textContent = ` ${ids.length} of ${TEAM_MAX}`;
      clear(t.list);
      for (const id of ids) t.list.append(memberRow(byId.get(id), st));
      const other = side === "A" ? "B" : "A";
      const otherHas = l.teams[other].some((id) => byId.has(id));
      t.empty.textContent = ids.length
        ? ""
        : otherHas
          ? "The computer plays this side."
          : "Nobody yet.";
      t.empty.hidden = !t.empty.textContent;
      t.join.hidden = mySide === side;
      t.join.disabled = ids.length >= TEAM_MAX;
      t.join.textContent =
        ids.length >= TEAM_MAX ? `${TEAM_LABEL[side]} IS FULL` : `JOIN ${side}`;
    }

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
    const key = JSON.stringify([isHost, options, l.open, mm ?? null, loaded]);
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
              ).el
            : h("span.opt-value", l.open ? "Open" : "Invite only"),
        ),
        h("p.access-note", ACCESS_NOTE[access]),
      );
      this.optionsBox.append(h("h3", "The match"));
      const rows = [
        ...(mm
          ? engineConstants(mm).MATCH_OPTIONS
          : loaded
            ? MATCH_OPTIONS
            : MATCH_OPTIONS.filter(([k]) => k in l.options)),
      ];
      // the Scene: the engine takes any id and lists none, so the row is this
      // client's, shown when the next match's engine takes a scene (0.9 on)
      const scened = loaded && takesScene(engineConstants(mm));
      this.scene = scened ? sceneId(options.scene) : "day";
      if (scened) rows.push(SCENE_ROW);
      for (const [k, label, choices] of rows) {
        this.optionsBox.append(
          h(
            "div.opt",
            { "data-test": `lobby-opt-${k}` },
            h("span.opt-label", ROW_LABEL[k] ?? label),
            isHost
              ? seg(
                  choices,
                  k === "scene" ? this.scene : options[k],
                  (v) => this.hooks.option(k, v),
                  k,
                ).el
              : h(
                  "span.opt-value",
                  choices.find(
                    ([v]) => v === (k === "scene" ? this.scene : options[k]),
                  )?.[1] ?? optionLabel(k, options[k]),
                ),
          ),
        );
      }
      this.showScene();
    }

    const players = ["A", "B"].reduce(
      (n, s) => n + l.teams[s].filter((id) => byId.has(id)).length,
      0,
    );
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

  // The device's throw level changed (in MENU).
  setLevel(v) {
    this.levelText.textContent = levelLine(v);
  }
}

function memberRow(m, st) {
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
    tags,
  );
}

function seg(choices, value, onPick, key) {
  let current = value;
  const btns = choices.map(([v, label]) =>
    h(
      "button.seg-btn",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(v === current),
        "data-value": v,
        onclick: () => {
          set(v);
          onPick(v);
        },
      },
      label,
    ),
  );
  const set = (v) => {
    current = v;
    for (const b of btns)
      b.setAttribute("aria-checked", String(b.dataset.value === v));
  };
  return {
    el: h("div.seg", { role: "radiogroup", "data-key": key }, btns),
    set,
    value: () => current,
  };
}
