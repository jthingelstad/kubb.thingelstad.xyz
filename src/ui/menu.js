// The menu, from the button in the top corner: resign, sound, level, meter
// and its side, how to throw, the score sheet (in a match), send feedback, the rules and home; on
// the practice pitch also the surface; watching the computer, the view. At its
// foot, small, the release label (src/site/release.js): "0.2.0 (0.8.1)", and
// "Also plays 0.7.4" under it when the page carries an older engine.
import { h, button, clear } from "./dom.js";

const LEVELS = [
  ["beginner", "Beginner"],
  ["club", "Club"],
  ["pro", "Pro"],
];
// watching the computer (src/main.js watchView)
const VIEWS = [
  ["wide", "Wide"],
  ["thrower", "Thrower's"],
];
// the throw's meter (src/game/game.js setMeter)
const METERS = [
  ["clock", "Clock"],
  ["linear", "Linear"],
];
// the screen edge the meter sits at (src/game/game.js setMeterSide)
const SIDES = [
  ["left", "Left"],
  ["right", "Right"],
];
// raising kubbs for the rest of this match (src/game/auto-raise.js)
const RAISING = [
  ["hand", "By hand"],
  ["auto", "Automatic"],
];
const SOUND = [
  ["on", "On"],
  ["off", "Off"],
];
const SURFACES = [
  ["grass", "Grass"],
  ["sand", "Sand"],
  ["snow", "Snow"],
];

export class Menu {
  // hooks: { game, sound, howto, home, resign?, surface?, sheet?, report?, view?, release?: { text, detail }, mode }
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
        h(
          "div.opt",
          h("span.opt-label", "Your level"),
          seg(LEVELS, game.level, (v) => {
            game.setLevel(v);
            render();
          }),
        ),
        h(
          "div.opt",
          { "data-test": "menu-meter" },
          h("span.opt-label", "Meter"),
          seg(METERS, game.meter, (v) => {
            game.setMeter(v);
            render();
          }),
          // chosen, but this screen has not the height for it (layout.js)
          game.meter === "linear" && game.L?.meter !== "linear"
            ? h(
                "p.opt-note",
                { "data-test": "menu-meter-note" },
                "This screen is too short for the linear meter, so the clock is shown.",
              )
            : null,
        ),
        h(
          "div.opt",
          { "data-test": "menu-side" },
          h("span.opt-label", "Meter side"),
          seg(SIDES, game.meterSide, (v) => {
            game.setMeterSide(v);
            render();
          }),
          // a tall screen's clock is in the middle: the side is the linear
          // meter's there
          game.L?.tall && game.L?.meter !== "linear"
            ? h(
                "p.opt-note",
                { "data-test": "menu-side-note" },
                "On a screen held upright the clock stays in the middle; the side moves the linear meter.",
              )
            : null,
        ),
        // shown once this browser has been asked to raise: a match whose own
        // Raising option is Automatic never asks
        game.mode === "match" && (game.autoRaise.seen || game.autoRaise.game)
          ? h(
              "div.opt",
              { "data-test": "menu-raise" },
              h("span.opt-label", "Raising"),
              seg(RAISING, game.autoRaise.game ? "auto" : "hand", (v) => {
                game.setRaise(v);
                render();
              }),
            )
          : null,
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
        game.mode === "practice" && this.hooks.surface
          ? h(
              "div.opt",
              h("span.opt-label", "Surface"),
              seg(SURFACES, game.viewData?.surface || "grass", (v) => {
                this.hooks.surface(v);
                render();
              }),
            )
          : null,
        // the sound as a choice that shows which it is, as every row above
        // (it was one button, SOUND: ON, that read as its own state)
        sound
          ? h(
              "div.opt",
              { "data-test": "mute" },
              h("span.opt-label", "Sound"),
              seg(SOUND, sound.muted ? "off" : "on", (v) => {
                sound.unlock();
                sound.setMuted(v === "off");
                render();
              }),
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

function seg(choices, value, onPick) {
  return h(
    "div.seg",
    { role: "radiogroup" },
    choices.map(([v, label]) =>
      h(
        "button.seg-btn",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(v === value),
          onclick: () => onPick(v),
        },
        label,
      ),
    ),
  );
}
