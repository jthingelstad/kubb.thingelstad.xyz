// MAKE A HIGHLIGHT REEL on the winner card of a match against the computer (docs/REEL.md
// "Sharing a match against the computer", docs/CLIENT.md "Sharing a match"): the button,
// and the share card it opens before anything is sent. SHARE AND MAKE THE REEL sends the
// match once (src/net/share.js); the answer's code is a finished pitch like any other,
// and the reel card (src/ui/reel.js) takes over for it, with its link shown. A match
// shared once skips the card: the button opens the reel card.
//
//   const share = new Share({ root, game, url });   // game: the Game (engine, trail, need)
//   share.button("", { "data-test": "..." })        // what cards.winner's `reel` takes
//   share.open()
//   share.destroy()
//
// The match is read from the Game when the share is made: its trail (the first snapshot
// and every action) and its `over` need. Like the reel card, the share card is modal.
import { h, button, clear } from "./dom.js";
import { Reel } from "./reel.js";
import { REEL_WORDS } from "../net/reel.js";
import { nameRow } from "./name-row.js";
import {
  SHARE_WORDS,
  askShare,
  nameFromMatch,
  nameProblem,
  shareMessage,
  shareStart,
  shareStep,
  shareView,
} from "../net/share.js";

export class Share {
  // root: the element cards go in; game: the Game whose finished match this is; url:
  // the api's base (src/net/api.js); fetch: for tests.
  constructor({ root, game, url, fetch = null }) {
    Object.assign(this, { root, game, url });
    this.ws = fetch ? { fetch } : {};
    this.trail = game.trail; // the match as it ended, kept if a rematch starts
    this.need = game.need;
    this.state = shareStart();
    // the name row's: the name the match was played under, a generated name (the
    // device's when that is not one)
    this.names = game.names;
    this.name = nameFromMatch(this.names, this.trail?.start, game.playerName);
    this.message = null; // the share as sent, sent again as it is on TRY AGAIN
    this.buttons = new Set();
    this.card = null;
    this.reel = null; // once shared: the reel card for its code
    this.drawn = "";
  }

  get view() {
    return shareView(this.state);
  }

  // A button that opens the card; once shared, its words follow the reel.
  button(kind = "", attrs = {}) {
    const b = button(
      this.reel ? this.reel.view.label : REEL_WORDS.make,
      () => this.open(),
      kind,
      attrs,
    );
    this.buttons.add(b);
    this.reel?.buttons.add(b);
    return b;
  }

  dispatch(event) {
    const next = shareStep(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const b of this.buttons)
      if (!this.reel)
        b.textContent =
          next.phase === "sending" ? REEL_WORDS.making : REEL_WORDS.make;
    if (next.phase === "shared") this.shared();
    else this.draw();
  }

  open() {
    if (this.reel) return this.reel.open();
    this.dispatch({ type: "open" });
    if (!this.card) this.show();
    this.draw();
  }

  // SHARE AND MAKE THE REEL, and TRY AGAIN.
  send() {
    if (this.state.phase === "idle") {
      const name = this.name;
      if (nameProblem(this.names, name)) return this.draw(true);
      let made;
      try {
        made = shareMessage({
          engine: this.game.engine,
          trail: this.trail,
          need: this.need,
          name,
        });
      } catch {
        made = { why: "does-not-replay" };
      }
      if (made.why) return this.dispatch({ type: "refuse", why: made.why });
      this.message = made.message;
    }
    this.dispatch({ type: "send" });
    if (this.state.phase !== "sending") return;
    // A share is idempotent on the server: the same match is answered the same code,
    // free, so sending it again after a lost answer gives one link, not two.
    askShare({ url: this.url, message: this.message, ...this.ws }).then(
      (answer) => this.dispatch({ type: "answer", answer }),
      (error) => this.dispatch({ type: "error", code: error?.code }),
    );
  }

  // The answer's code: the reel card for it, asking for the reel at once (the press
  // was SHARE AND MAKE THE REEL), shown when the share card still is.
  shared() {
    const s = this.state;
    const showing = !!this.card;
    this.close();
    this.reel = new Reel({
      root: this.root,
      game: this.game,
      code: s.code,
      url: this.url,
      link: true,
      ...this.ws,
    });
    for (const b of this.buttons) this.reel.buttons.add(b);
    if (showing) this.reel.open();
    else this.reel.start();
  }

  // ---------- the card ----------

  show() {
    const body = h("div.card.sheet.reel-card.share-card", {
      "data-test": "share-card",
    });
    const scrim = h("div.scrim.sheet-scrim", body);
    scrim.addEventListener("pointerdown", (e) => {
      if (e.target === scrim) this.close();
    });
    const esc = (e) => {
      if (e.key === "Escape") this.close();
    };
    this.root.append(scrim);
    const quieted = [...this.root.children].filter(
      (el) => el !== scrim && !el.inert,
    );
    for (const el of quieted) el.inert = true;
    window.addEventListener("keydown", esc);
    if (this.game) this.game.modal++;
    this.card = { scrim, body, esc, quieted };
    this.drawn = "";
  }

  close() {
    const c = this.card;
    if (!c) return;
    this.card = null;
    c.scrim.remove();
    for (const el of c.quieted) el.inert = false;
    window.removeEventListener("keydown", c.esc);
    if (this.game) this.game.modal = Math.max(0, this.game.modal - 1);
  }

  destroy() {
    this.close();
    this.reel?.destroy();
    this.buttons.clear();
  }

  // tried: SHARE was pressed with a name the reel cannot take (say why).
  draw(tried = false) {
    const c = this.card;
    if (!c) return;
    const s = this.state;
    const v = this.view;
    const key = `${s.phase}|${s.why}`;
    if (key === this.drawn && !tried) return;
    this.drawn = key;
    const W = SHARE_WORDS;
    const body = clear(c.body);
    body.dataset.share = s.phase;
    body.append(h("h2.display", W.title));
    if (v.form) return this.drawForm(body, tried);
    if (v.line)
      body.append(h("p.reel-line", { "data-test": "share-line" }, v.line));
    if (v.bar)
      body.append(
        h(
          "div.reel-bar",
          {
            role: "progressbar",
            "aria-label": v.line,
            "data-test": "share-bar",
          },
          h("span"),
        ),
      );
    if (v.text)
      body.append(h("p.reel-text", { "data-test": "share-text" }, v.text));
    const actions = [];
    if (v.retry)
      actions.push(
        button("TRY AGAIN", () => this.send(), "go", {
          "data-default": true,
          "data-test": "share-retry",
        }),
      );
    actions.push(
      button("BACK", () => this.close(), actions.length ? "" : "go", {
        "data-default": !actions.length,
        "data-test": "share-back",
      }),
    );
    body.append(h("div.row", actions));
    requestAnimationFrame(() =>
      body.querySelector("[data-default]")?.focus({ preventScroll: true }),
    );
  }

  drawForm(body, tried) {
    const W = SHARE_WORDS;
    // the name row (src/ui/name-row.js): only a generated name can be picked, so the
    // server's check (backend/reels/check.mjs) is never what stops an honest page
    const row = nameRow({
      names: this.names,
      kind: "player",
      text: this.name,
      label: W.label,
      key: "share-name",
      onChange: (t) => {
        this.name = t;
        check(false);
      },
    });
    const say = h("p.reel-text.share-say", {
      role: "status",
      "data-test": "share-say",
    });
    const go = button(W.share, () => this.send(), "go", {
      "data-test": "share-send",
    });
    const check = (loud) => {
      const problem = nameProblem(this.names, this.name);
      go.disabled = !!problem;
      go.setAttribute("aria-disabled", String(!!problem));
      say.textContent = problem && loud ? W.name[problem] : "";
    };
    body.append(
      h("p.reel-text", W.about),
      h("div.opt.share-name", h("span.opt-label", W.label), row.el),
      h("p.reel-text", W.sides),
      h("p.reel-text.share-when", W.when),
      say,
      h(
        "div.row",
        go,
        button(W.notNow, () => this.close(), "", { "data-test": "share-back" }),
      ),
    );
    check(tried);
    requestAnimationFrame(() => go.focus({ preventScroll: true }));
  }
}
