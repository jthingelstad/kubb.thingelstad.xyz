// The lobby on a pitch link (docs/MULTIPLAYER.md): your name and level, the
// two teams with who is on them, who is connected and who is host, who is
// watching, the link to share, the host's match options and START. Built
// once; update(state) changes only what changed, so typing a name is never
// interrupted by someone else joining.
import { h, button, clear } from "./dom.js";
import {
  MATCH_OPTIONS,
  TEAM_MAX,
  lobbyOf,
  optionLabel,
  NAME_MAX,
  LEVELS,
} from "../net/lobby.js";

const LEVEL_LABELS = { beginner: "Beginner", club: "Club", pro: "Pro" };
const TEAM_LABEL = { A: "Team A", B: "Team B" };

export class Lobby {
  // hooks: { name(text), level(v), team(side|null), option(key, v), start(),
  //          share(), home() }
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

    this.levelSeg = seg(
      LEVELS.map((v) => [v, LEVEL_LABELS[v]]),
      level,
      (v) => hooks.level(v),
      "lobby-level",
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
    this.status = h("span.lobby-status");

    this.el = h(
      "div.card.options.lobby",
      { "data-test": "lobby" },
      h("p.kicker", `PITCH ${code}  `, this.status),
      h("h2.display", "Pick a side"),
      h("label.opt", h("span.opt-label", "Your name"), this.nameInput),
      h("div.opt", h("span.opt-label", "Your level"), this.levelSeg.el),
      h("div.teams", this.teams.A.el, this.teams.B.el),
      h("div.watch-row", this.watchList, this.sitOut),
      h("div.share-row", this.shareBtn, this.linkText),
      this.optionsBox,
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
      onClose: () => (this.closeFn = null),
    });
  }

  hide() {
    if (this.closeFn) this.closeFn();
  }

  say(text) {
    this.note.textContent = text || "";
    this.note.hidden = !text;
  }

  // st: { you, host, members, doc, status, nameOf(id) }
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

    // the options: the host's to set, everyone else's to read
    const key = JSON.stringify([isHost, l.options]);
    if (key !== this.optKey) {
      this.optKey = key;
      clear(this.optionsBox);
      this.optionsBox.append(h("h3", "The match"));
      for (const [k, label, choices] of MATCH_OPTIONS) {
        this.optionsBox.append(
          h(
            "div.opt",
            h("span.opt-label", label),
            isHost
              ? seg(choices, l.options[k], (v) => this.hooks.option(k, v), k).el
              : h("span.opt-value", optionLabel(k, l.options[k])),
          ),
        );
      }
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

  setLevel(v) {
    this.levelSeg.set(v);
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
