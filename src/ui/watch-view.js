// The view of anyone who watches (docs/OBSERVER.md): the computer against itself, a
// watcher on a shared pitch, and a replay.
//
// WatchView is the switch between the wide view and the thrower's view (Jamie,
// 2026-11-16: "It'd be fun to actually do more with the camera on the web version
// because we could zoom out."): a button by MENU, MENU's View and the V key,
// remembered as the "watchView" pref. The button names the view it switches to, as
// BATONS / KUBBS does on the practice pitch. A window too small for the wide view
// shows the thrower's whatever is chosen, and the button is hidden there.
//
// CamBar is the free camera's own small bar, low on the left: a one-line hint until
// the first move, and RESET VIEW once the view has been moved. The camera itself is
// the Game's (src/game/free-camera.js); it is on whenever a watcher sees the wide view.
import { h, button } from "./dom.js";
import { prefs } from "../game/prefs.js";

export const VIEWS = { wide: "WIDE VIEW", thrower: "THROWER'S VIEW" };

export const camTune = {
  hintMs: 8000, // the hint goes after this long, or at the first move
};

// The "watchView" pref: "wide" (the default) or "thrower".
export const viewPref = {
  get: () =>
    prefs.get("watchView", "wide") === "thrower" ? "thrower" : "wide",
  set: (v) => prefs.set("watchView", v),
};

export class CamBar {
  constructor({ game, ui }) {
    this.game = game;
    this.ui = ui;
    this.hinted = false;
    this.timer = null;
    this.resetBtn = button("RESET VIEW", () => game.freeCam.reset(), "small", {
      "data-test": "cam-reset",
      title: "Back to the first view (0)",
    });
    this.hint = h(
      "span.cam-hint",
      { "data-test": "cam-hint" },
      game.coarse
        ? "Drag to look around. Pinch to zoom."
        : "Drag to look around. Scroll to zoom.",
    );
    this.el = h(
      "div.cam-bar",
      { "data-test": "cam-bar", hidden: true },
      this.hint,
      this.resetBtn,
    );
  }

  on() {
    this.ui.append(this.el);
    this.game.freeCam.onChange = () => this.render();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.hinted = true;
      this.render();
    }, camTune.hintMs);
    this.render();
  }

  off() {
    clearTimeout(this.timer);
    this.timer = null;
    this.el.remove();
    if (this.game.freeCam.onChange) this.game.freeCam.onChange = null;
  }

  render() {
    const g = this.game;
    const moved = g.freeCam.moved;
    if (moved) this.hinted = true;
    this.el.hidden = !(g.observing && g.wide);
    this.resetBtn.hidden = !moved;
    this.hint.hidden = this.hinted;
  }
}

export class WatchView {
  // store: where the chosen view is kept ({ get, set }; the "watchView" pref)
  constructor({ game, ui, menu, store = viewPref }) {
    this.game = game;
    this.ui = ui;
    this.menu = menu;
    this.store = store;
    this.live = false;
    this.btn = button(VIEWS.thrower, () => this.toggle(), "small", {
      "data-test": "view",
      title: "Switch the view (V)",
    });
    this.tray = h("div.tray.view-tray", this.btn);
    this.cam = new CamBar({ game, ui });
    this.onKey = (e) => {
      if (e.code !== "KeyV" || e.repeat || this.game.modal) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.toggle();
    };
  }

  chosen() {
    return this.store.get();
  }

  choose(v) {
    this.store.set(v);
    this.game.setWide(v === "wide");
  }

  toggle() {
    this.choose(this.chosen() === "wide" ? "thrower" : "wide");
  }

  on() {
    if (this.live) return;
    this.live = true;
    const g = this.game;
    this.ui.append(this.tray);
    g.setHeader("watch");
    g.onWide = () => this.render();
    if (this.menu)
      this.menu.hooks.view = {
        get: () => this.chosen(),
        set: (v) => this.choose(v),
      };
    window.addEventListener("keydown", this.onKey);
    g.setObserving(true);
    this.cam.on();
    g.setWide(this.chosen() === "wide");
    this.render();
  }

  off() {
    if (!this.live) return;
    this.live = false;
    const g = this.game;
    this.tray.remove();
    this.cam.off();
    window.removeEventListener("keydown", this.onKey);
    if (this.menu) this.menu.hooks.view = null;
    g.onWide = null;
    g.setHeader(null);
    g.freeCam.home();
    g.setObserving(false);
    g.setWide(false);
  }

  render() {
    const label = this.game.wide ? VIEWS.thrower : VIEWS.wide;
    if (this.btn.textContent !== label) this.btn.textContent = label;
    this.tray.hidden = this.chosen() === "wide" && !this.game.wide;
    this.cam.render();
  }
}
