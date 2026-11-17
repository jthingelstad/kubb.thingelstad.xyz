// The menu, from the button in the top corner: resign, sound, level, how to
// throw, the score sheet (in a match), report a throw, the rules and home; on
// the practice pitch also the surface; watching the computer, the view. At its
// foot, small, the release this page is (src/site/release.js).
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
const SURFACES = [
  ["grass", "Grass"],
  ["sand", "Sand"],
  ["snow", "Snow"],
];

export class Menu {
  // hooks: { game, sound, howto, home, resign?, surface?, sheet?, report?, view?, release?, mode }
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
      // DOM append writes a null as the text "null": leave the absent rows out
      const rows = [
        h("h2.display", "Menu"),
        h(
          "div.opt",
          h("span.opt-label", "Level"),
          seg(LEVELS, game.level, (v) => {
            game.setLevel(v);
            render();
          }),
        ),
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
        h(
          "div.menu-list",
          button(
            sound && sound.muted ? "SOUND: OFF" : "SOUND: ON",
            () => {
              sound?.unlock();
              sound?.setMuted(!sound.muted);
              render();
            },
            "",
            { "data-test": "mute" },
          ),
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
                "REPORT A THROW",
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
        this.hooks.release
          ? h(
              "p.menu-version",
              { "data-test": "menu-version" },
              this.hooks.release,
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
