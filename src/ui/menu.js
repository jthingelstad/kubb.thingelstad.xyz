// The menu, from MENU in the header's plate (src/game/hud.js). The 1.0 design: a two
// by two grid of plain buttons (Settings, Score sheet, How to throw, Feedback), then
// Raising (a match that raises by hand, for the side this browser plays), BACK TO
// THE MATCH as the one go button, and RESIGN and HOME quiet; at its foot, small, the
// release label (src/site/release.js): "0.2.0 (0.8.1)", and "Also plays 0.7.4"
// under it when the page carries an older engine. Settings opens the device's
// settings as a card of their own over the pitch (src/ui/settings.js
// settingsCard), DONE at its bottom right back to the menu. Watching, the View row;
// on the practice pitch, that pitch's own Surface and Scene (the practice menu was
// not drawn: its rows stay as they were, under the grid). A match's own options are
// not here: they are set on the solo card or in the lobby; Raising is the part-way
// choice the raise panel also offers (REST OF GAME, BY HAND).
import { h, button, clear } from "./dom.js";
import { seg, settingsCard } from "./settings.js";
import { SCENE_ROW, sceneId } from "../render/scenes.js";

// watching the computer (src/main.js watchView)
const VIEWS = [
  ["wide", "Wide"],
  ["thrower", "Thrower's"],
];
const RAISING = [
  ["hand", "By hand"],
  ["auto", "Automatic"],
];
const SURFACES = [
  ["grass", "Grass"],
  ["sand", "Sand"],
  ["snow", "Snow"],
];

// The device rows' view of a Game and its Sound: read as each row is drawn, so the
// Settings card, drawn again after a pick, shows the values as they now are.
function gameDevice(game, sound) {
  return {
    names: game.names,
    get name() {
      return game.playerName;
    },
    setName: (t) => game.setPlayerName(t),
    get meter() {
      return game.meter;
    },
    setMeter: (v) => game.setMeter(v),
    get meterSide() {
      return game.meterSide;
    },
    setMeterSide: (v) => game.setMeterSide(v),
    get muted() {
      return sound?.muted;
    },
    setMuted: sound
      ? (on) => {
          sound.unlock();
          sound.setMuted(on);
        }
      : null,
    // chosen, but this screen has not the height for it (layout.js)
    get meterNote() {
      return game.meter === "linear" && game.L?.meter !== "linear"
        ? "This screen is too short for the linear meter, so the clock is shown."
        : null;
    },
    // a tall screen's clock is in the middle: the side is the linear meter's there
    get sideNote() {
      return game.L?.tall && game.L?.meter !== "linear"
        ? "On a screen held upright the clock stays in the middle; the side moves the linear meter."
        : null;
    },
  };
}

export class Menu {
  // hooks: { game, sound, howto, home, resign?, surface?, scene?, sheet?, report?, view?, release?: { text, detail }, mode }
  // view: { get() -> "wide" | "thrower", set(v) }
  constructor(root, hooks) {
    this.hooks = hooks;
    // MENU as a word inside the header's plate (src/game/hud.js menuSlot)
    this.btn = h(
      "button.btn.small.menu-btn",
      {
        type: "button",
        "aria-label": "Menu",
        "aria-expanded": "false",
        "data-test": "menu",
        onclick: () => (this.el ? this.close() : this.open()),
      },
      "MENU",
    );
    (hooks.game?.hud?.menuSlot ?? root).append(this.btn);
    this.root = root;
    this.el = null;
  }

  open() {
    const { game, sound, howto, home } = this.hooks;
    game.modal++;
    const body = h("div.card.menu", {
      "data-test": "menu-card",
      role: "dialog",
      "aria-label": "Menu",
    });
    const scrim = h("div.scrim.menu-scrim", body);
    scrim.addEventListener("pointerdown", (e) => {
      if (e.target === scrim) this.close();
    });
    this.settings = null;
    const render = () => {
      clear(body);
      const n = game.need;
      const inMatch = game.mode === "match" && n && n.kind !== "over";
      const plays = game.localSide != null || !!game.seat?.sides?.length;
      const canResign = inMatch && game.localSide !== null && this.hooks.resign;
      // the release label, "0.2.0 (0.8.1)", and its detail ("Also plays 0.7.4")
      const r = this.hooks.release;
      const release = typeof r === "string" ? { text: r } : r?.text ? r : null;
      const act = (fn) => () => {
        this.close();
        fn();
      };
      // Raising: the part-way choice for a match that raises by hand, this
      // browser's own (src/game/auto-raise.js)
      const raising =
        inMatch &&
        plays &&
        !game.unattended &&
        (game.matchRaising === "hand" || game.autoRaise?.seen);
      const grid = [
        button("SETTINGS", () => this.openSettings(), "", {
          "data-test": "menu-settings",
        }),
        this.hooks.sheet && game.mode === "match"
          ? button("SCORE SHEET", act(this.hooks.sheet), "", {
              "data-test": "menu-sheet",
            })
          : null,
        button("HOW TO THROW", act(howto), "", { "data-test": "menu-howto" }),
        this.hooks.report
          ? button("FEEDBACK", act(this.hooks.report), "", {
              "data-test": "report",
            })
          : null,
      ].filter(Boolean);
      const row = (test, label, control) =>
        h(
          "div.opt",
          { "data-test": test },
          h("span.opt-label", label),
          control,
        );
      // DOM append writes a null as the text "null": leave the absent rows out
      const rows = [
        h("h2.display", "Menu"),
        h("div.menu-grid", grid),
        raising
          ? row(
              "menu-raising",
              "Raising",
              seg(
                RAISING,
                game.autoRaise?.game ? "auto" : "hand",
                (v) => {
                  game.setRaise(v);
                  render();
                },
                "raising",
                "Raising",
              ),
            )
          : null,
        this.hooks.view
          ? row(
              "menu-view",
              "View",
              seg(
                VIEWS,
                this.hooks.view.get(),
                (v) => {
                  this.hooks.view.set(v);
                  render();
                },
                "view",
                "View",
              ),
            )
          : null,
        // the practice pitch's own options: its match-options place
        game.mode === "practice" && this.hooks.surface
          ? row(
              "menu-surface",
              "Surface",
              seg(
                SURFACES,
                game.viewData?.surface || "grass",
                (v) => {
                  this.hooks.surface(v);
                  render();
                },
                "surface",
                "Surface",
              ),
            )
          : null,
        game.mode === "practice" && this.hooks.scene
          ? row(
              "menu-scene",
              SCENE_ROW[1],
              seg(
                SCENE_ROW[2],
                sceneId(game.viewData?.scene),
                (v) => {
                  this.hooks.scene(v);
                  render();
                },
                "scene",
                SCENE_ROW[1],
              ),
            )
          : null,
        button(
          game.mode === "match" ? "BACK TO THE MATCH" : "BACK TO THE PITCH",
          () => this.close(),
          "go wide",
          { "data-default": true, "data-test": "menu-back" },
        ),
        h(
          "div.card-foot",
          canResign
            ? button(
                n.resignPending ? "RESIGNING..." : "RESIGN",
                act(this.hooks.resign),
                "quiet",
                { disabled: !!n.resignPending, "data-test": "menu-resign" },
              )
            : h("span"),
          button("HOME", home, "quiet", { "data-test": "menu-home" }),
        ),
        release
          ? h(
              "p.menu-version",
              { "data-test": "menu-version" },
              h("span", { "data-test": "menu-version-label" }, release.text),
              release.detail
                ? h(
                    "span.menu-version__also",
                    { "data-test": "menu-version-also" },
                    release.detail,
                  )
                : null,
            )
          : null,
      ];
      body.append(...rows.filter(Boolean));
    };
    this.render = render;
    render();
    this.root.append(scrim);
    this.el = scrim;
    this.body = body;
    this.btn.setAttribute("aria-expanded", "true");
    this.esc = (e) => {
      if (e.key !== "Escape") return;
      if (this.settings) this.closeSettings();
      else this.close();
    };
    window.addEventListener("keydown", this.esc);
    requestAnimationFrame(() =>
      body.querySelector("[data-default]")?.focus({ preventScroll: true }),
    );
  }

  // Settings from the menu: the device's rows as a card of their own in the menu's
  // place, DONE (or Escape) back to the menu.
  openSettings() {
    if (!this.el || this.settings) return;
    const { game, sound } = this.hooks;
    const card = settingsCard(gameDevice(game, sound), {
      done: () => this.closeSettings(),
      release: null,
    });
    this.settings = card;
    this.body.hidden = true;
    this.el.append(card.el);
  }

  closeSettings() {
    if (!this.settings) return;
    this.settings.el.remove();
    this.settings = null;
    if (!this.body) return;
    this.body.hidden = false;
    this.render?.();
    this.body
      .querySelector("[data-test=menu-settings]")
      ?.focus({ preventScroll: true });
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.settings = null;
    this.body = null;
    this.hooks.game.modal = Math.max(0, this.hooks.game.modal - 1);
    this.btn.setAttribute("aria-expanded", "false");
    window.removeEventListener("keydown", this.esc);
  }
}
