// The menu, from the button in the top corner. Its top half is the device's
// settings (src/ui/settings.js: your name, the meter and its side, the
// sound), the same rows as the /settings/ page; below them, on the practice pitch,
// that pitch's own options (surface and scene), and watching the computer, the
// view. Then the actions: how to throw, resign, the score sheet (in a match), send
// feedback, the rules and home. At its foot, small, the release label
// (src/site/release.js): "0.2.0 (0.8.1)", and "Also plays 0.7.4" under it when the
// page carries an older engine. A match's own options are not here: they are set on
// the solo card or in the lobby, and the raise panel's REST OF GAME hands the
// raising over mid-match (src/ui/cards.js).
import { h, button, clear } from "./dom.js";
import { deviceRows, seg } from "./settings.js";
import { SCENE_ROW, sceneId } from "../render/scenes.js";

// watching the computer (src/main.js watchView)
const VIEWS = [
  ["wide", "Wide"],
  ["thrower", "Thrower's"],
];
const SURFACES = [
  ["grass", "Grass"],
  ["sand", "Sand"],
  ["snow", "Snow"],
];

// The device rows' view of a Game and its Sound.
function gameDevice(game, sound) {
  return {
    name: game.playerName,
    setName: (t) => game.setPlayerName(t),
    meter: game.meter,
    setMeter: (v) => game.setMeter(v),
    meterSide: game.meterSide,
    setMeterSide: (v) => game.setMeterSide(v),
    muted: sound?.muted,
    setMuted: sound
      ? (on) => {
          sound.unlock();
          sound.setMuted(on);
        }
      : null,
    // chosen, but this screen has not the height for it (layout.js)
    meterNote:
      game.meter === "linear" && game.L?.meter !== "linear"
        ? "This screen is too short for the linear meter, so the clock is shown."
        : null,
    // a tall screen's clock is in the middle: the side is the linear meter's there
    sideNote:
      game.L?.tall && game.L?.meter !== "linear"
        ? "On a screen held upright the clock stays in the middle; the side moves the linear meter."
        : null,
  };
}

export class Menu {
  // hooks: { game, sound, howto, home, resign?, surface?, scene?, sheet?, report?, view?, release?: { text, detail }, mode }
  // view: { get() -> "wide" | "thrower", set(v) }
  constructor(root, hooks) {
    this.hooks = hooks;
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
    root.append(this.btn);
    this.root = root;
    this.el = null;
  }

  open() {
    const { game, sound, howto, home } = this.hooks;
    game.modal++;
    const body = h("div.card.menu", { "data-test": "menu-card" });
    const scrim = h("div.scrim.menu-scrim", body);
    scrim.addEventListener("pointerdown", (e) => {
      if (e.target === scrim) this.close();
    });
    const render = () => {
      clear(body);
      const n = game.need;
      const canResign =
        game.mode === "match" &&
        n &&
        n.kind !== "over" &&
        game.localSide !== null &&
        this.hooks.resign;
      // the release label, "0.2.0 (0.8.1)", and its detail ("Also plays 0.7.4")
      const r = this.hooks.release;
      const release = typeof r === "string" ? { text: r } : r?.text ? r : null;
      // DOM append writes a null as the text "null": leave the absent rows out
      const rows = [
        h("h2.display", "Menu"),
        ...deviceRows(gameDevice(game, sound), render),
        this.hooks.view
          ? h(
              "div.opt",
              { "data-test": "menu-view" },
              h("span.opt-label", "View"),
              seg(VIEWS, this.hooks.view.get(), (v) => {
                this.hooks.view.set(v);
                render();
              }),
            )
          : null,
        // the practice pitch's own options: its match-options place
        game.mode === "practice" && this.hooks.surface
          ? h(
              "div.opt",
              { "data-test": "menu-surface" },
              h("span.opt-label", "Surface"),
              seg(SURFACES, game.viewData?.surface || "grass", (v) => {
                this.hooks.surface(v);
                render();
              }),
            )
          : null,
        game.mode === "practice" && this.hooks.scene
          ? h(
              "div.opt",
              { "data-test": "menu-scene" },
              h("span.opt-label", SCENE_ROW[1]),
              seg(
                SCENE_ROW[2],
                sceneId(game.viewData?.scene),
                (v) => {
                  this.hooks.scene(v);
                  render();
                },
                "scene",
              ),
            )
          : null,
        h(
          "div.menu-list",
          button("HOW TO THROW", () => {
            this.close();
            howto();
          }),
          canResign
            ? button(
                n.resignPending ? "RESIGNING..." : "RESIGN",
                () => {
                  this.close();
                  this.hooks.resign();
                },
                "",
                { disabled: !!n.resignPending },
              )
            : null,
          this.hooks.sheet && game.mode === "match"
            ? button(
                "SCORE SHEET",
                () => {
                  this.close();
                  this.hooks.sheet();
                },
                "",
                { "data-test": "menu-sheet" },
              )
            : null,
          this.hooks.report
            ? button(
                "SEND FEEDBACK",
                () => {
                  this.close();
                  this.hooks.report();
                },
                "",
                { "data-test": "report" },
              )
            : null,
          h(
            "a.btn",
            { href: "/rules/", target: "_blank", rel: "noopener" },
            "RULES",
          ),
          button("HOME", home),
          button("BACK TO THE PITCH", () => this.close(), "go", {
            "data-default": true,
          }),
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
    render();
    this.root.append(scrim);
    this.el = scrim;
    this.btn.setAttribute("aria-expanded", "true");
    this.esc = (e) => {
      if (e.key === "Escape") this.close();
    };
    window.addEventListener("keydown", this.esc);
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.hooks.game.modal = Math.max(0, this.hooks.game.modal - 1);
    this.btn.setAttribute("aria-expanded", "false");
    window.removeEventListener("keydown", this.esc);
  }
}
