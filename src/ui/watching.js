// The card an observer sees between matches (/p/<code>?observe=1, docs/OBSERVER.md),
// in place of the lobby: who is on each team, who is watching, and the ways on. An
// observer has no name box, no team buttons, no options and no START: it watches. It
// answers the calls the pitch makes on its lobby (src/ui/lobby.js), so Pitch drives
// either the same way.
import { h, button, clear } from "./dom.js";
import { lobbyOf } from "../net/lobby.js";

export class WatchCard {
  // hooks: { replay(), join(), home() }
  constructor(cards, game, hooks, { code }) {
    this.cards = cards;
    this.game = game;
    this.hooks = hooks;
    this.closeFn = null;
    this.status = h("span.lobby-status");
    this.state = h("p.watch-state", { "data-test": "watch-state" });
    this.teamsBox = h("div.watch-teams", { "data-test": "watch-teams" });
    this.watchList = h("p.watchers", { "data-test": "watchers" });
    this.note = h("p.lobby-note", {
      role: "status",
      hidden: true,
      "data-test": "lobby-note",
    });
    this.replayBtn = button(
      "WATCH THE LAST MATCH",
      () => hooks.replay?.(),
      "small",
      { "data-test": "lobby-replay", hidden: true },
    );
    this.el = h(
      "div.card.options.lobby.watch-card",
      { "data-test": "watch-card" },
      h("p.kicker", `PITCH ${code}  `, this.status),
      h("h2.display", "Watching"),
      this.state,
      this.teamsBox,
      h("div.watch-row", this.watchList),
      this.note,
      h(
        "div.row",
        this.replayBtn,
        button("JOIN THIS PITCH", () => hooks.join?.(), "", {
          "data-test": "watch-join",
        }),
        button("HOME", () => hooks.home()),
      ),
    );
  }

  get shown() {
    return !!this.closeFn;
  }

  show() {
    if (this.closeFn) return;
    this.closeFn = this.cards.show(this.el, this.game, {
      onClose: () => {
        this.closeFn = null;
      },
    });
  }

  hide() {
    if (this.closeFn) this.closeFn();
  }

  setReplay(on) {
    this.replayBtn.hidden = !on;
  }

  say(text) {
    this.note.textContent = text || "";
    this.note.hidden = !text;
  }

  // the lobby's: an observer starts nothing and throws nothing
  setEngine() {}
  // a name changed in MENU: the Watching line shows it when the room says so
  setName() {}

  // st: as Lobby.update's
  update(st) {
    const l = lobbyOf(st.doc);
    const byId = new Map(st.members.map((m) => [m.id, m]));
    clear(this.teamsBox);
    let players = 0;
    for (const side of ["A", "B"]) {
      const ids = l.teams[side].filter((id) => byId.has(id));
      players += ids.length;
      this.teamsBox.append(
        h(
          "p.watch-team",
          { "data-test": `watch-team-${side}` },
          h("span.opt-label", `Team ${side} `),
          ids.length ? ids.map((id) => st.nameOf(id)).join(", ") : "nobody yet",
        ),
      );
    }
    this.state.textContent = players
      ? st.host
        ? `Waiting for ${st.nameOf(st.host)} to start the match.`
        : "Waiting for the host to start the match."
      : "Nobody has picked a side yet.";
    const watching = st.members.filter(
      (m) => !l.teams.A.includes(m.id) && !l.teams.B.includes(m.id),
    );
    clear(this.watchList);
    this.watchList.append(h("span.opt-label", "Watching "));
    watching.forEach((m, i) => {
      if (i) this.watchList.append(", ");
      this.watchList.append(
        h(
          `span.who${m.connected ? "" : ".away"}`,
          st.nameOf(m.id) + (m.id === st.you ? " (you)" : ""),
        ),
      );
    });
    this.status.textContent =
      st.status === "connecting"
        ? "· CONNECTING"
        : st.status === "reconnecting"
          ? "· RECONNECTING"
          : "";
  }
}
