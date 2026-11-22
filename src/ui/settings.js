// The device's settings, in one place (the owner's settings sheet, 2026-11-20):
// your name (a generated one, picked with the name row: src/ui/name-row.js), the
// meter and its side, and the sound. Each is kept on
// this device and is never asked per match. The same rows are MENU's top half
// (src/ui/menu.js, inside every mode) and the /settings/ page, reached from the
// web game's page (openSettingsPage below). Match options (surface, scene, the
// computer's level, ...) are not here: they live on the solo card, the practice
// MENU and the lobby.
import { h, button } from "./dom.js";
import { prefs } from "../game/prefs.js";
import { loadName, saveName } from "../game/player-name.js";
import { nameRow } from "./name-row.js";
import { segBar } from "./seg.js";

// The solo card's, the lobby's and the welcome card's one name row: the device's name
// and SHUFFLE on one line (src/ui/name-row.js; the 1.0 design: word steppers are in
// Settings only), so it is picked where it is shown; a pick is the device's name
// everywhere (setName). There is no level here: from engine 0.13 a person throws on
// one meter (src/game/throw-level.js). `key` names the row for tests (`<key>-you`, its
// name row `<key>-name`). `caption`: a label over the name ("You are" in the lobby,
// "You will be" on the welcome card); the solo card shows the name alone.
export function youRow(key, { names, name, setName = null, caption = null }) {
  const row = nameRow({
    names,
    kind: "player",
    text: name,
    label: "Your name",
    key: `${key}-name`,
    onChange: (t) => setName?.(t),
  });
  const el = h(
    `div.you${caption ? ".boxed" : ""}`,
    { "data-test": `${key}-you` },
    caption ? h("span.opt-label.you-caption", caption) : null,
    row.el,
  );
  return {
    el,
    setName(v) {
      row.set(v);
    },
  };
}

// the throw's meter (src/game/game.js setMeter)
export const METERS = [
  ["clock", "Clock"],
  ["linear", "Linear"],
];
// the screen edge the meter sits at (src/game/game.js setMeterSide)
export const SIDES = [
  ["left", "Left"],
  ["right", "Right"],
];
export const SOUND = [
  ["on", "On"],
  ["off", "Off"],
];

// The rows for a device:
//   { names, name, setName(t), meter, setMeter(v), meterSide,
//     setMeterSide(v), muted, setMuted(on), meterNote?, sideNote? }
// render() draws them again after a pick.
export function deviceRows(dev, render) {
  const name = nameRow({
    names: dev.names,
    kind: "player",
    text: dev.name,
    label: "Your name",
    key: "settings-name",
    steppers: true,
    onChange: (t) => dev.setName(t),
  });
  const row = (test, label, control, note = null, noteTest = null) =>
    h(
      "div.opt",
      { "data-test": test },
      h("span.opt-label", label),
      control,
      note ? h("p.opt-note", { "data-test": noteTest }, note) : null,
    );
  return [
    h(
      "div.opt.opt-name",
      { "data-test": "settings-name-row" },
      h("span.opt-label", "Your name"),
      name.el,
    ),
    h("hr.rule"),
    // the sound as a choice that shows which it is (it was one button, SOUND: ON,
    // that read as its own state)
    dev.setMuted
      ? row(
          "mute",
          "Sound",
          seg(
            SOUND,
            dev.muted ? "off" : "on",
            (v) => {
              dev.setMuted(v === "off");
              render();
            },
            "sound",
            "Sound",
          ),
        )
      : null,
    row(
      "menu-meter",
      "Meter",
      seg(
        METERS,
        dev.meter,
        (v) => {
          dev.setMeter(v);
          render();
        },
        "meter",
        "Meter",
      ),
      dev.meterNote,
      "menu-meter-note",
    ),
    row(
      "menu-side",
      "Meter side",
      seg(
        SIDES,
        dev.meterSide,
        (v) => {
          dev.setMeterSide(v);
          render();
        },
        "meter-side",
        "Meter side",
      ),
      dev.sideNote,
      "menu-side-note",
    ),
  ].filter(Boolean);
}

// The same settings with no game around them: read from and written to the prefs
// the game reads when it starts (src/game/game.js, src/game/sound.js). names: the
// engine's door (src/game/names.js).
export function prefsDevice(store = prefs, names) {
  return {
    names,
    name: loadName(store, names),
    setName(t) {
      this.name = saveName(store, names, t);
    },
    meter: store.get("meter", "clock") === "linear" ? "linear" : "clock",
    setMeter(v) {
      this.meter = v === "linear" ? "linear" : "clock";
      store.set("meter", this.meter);
    },
    meterSide: store.get("meterSide", "right") === "left" ? "left" : "right",
    setMeterSide(v) {
      this.meterSide = v === "left" ? "left" : "right";
      store.set("meterSide", this.meterSide);
    },
    muted: !!store.get("muted", false),
    setMuted(on) {
      this.muted = !!on;
      store.set("muted", this.muted);
    },
  };
}

// /settings/: the device's settings as a card of their own, reached from the web
// game's page, with DONE back to it. The engine is loaded for the names only.
export function openSettingsPage(root, { home, names, release = null }) {
  const dev = prefsDevice(prefs, names);
  // the card is the page: its title is the page's one h1
  const body = settingsCard(dev, { done: home, release, heading: "h1" });
  root.append(h("div.scrim", body.el));
  const esc = (e) => {
    if (e.key === "Escape") home();
  };
  window.addEventListener("keydown", esc);
  return body.el;
}

// The Settings card (the 1.0 design: "Settings closes with DONE at the bottom
// right"): its title, "Kept on this device.", the device's rows, and a foot with the
// release label at the left and DONE, the one go button, at the right. MENU opens it
// over the match (src/ui/menu.js) and /settings/ shows it alone. done: DONE (and
// Escape, which the opener listens for). release: { text } or null. heading: the
// title's element, "h2" over a match, "h1" where the card is the page.
export function settingsCard(dev, { done, release = null, heading = "h2" }) {
  const el = h("div.card.menu.settings", {
    "data-test": "settings",
    role: "dialog",
    "aria-label": "Settings",
  });
  const render = () => {
    el.replaceChildren(
      h(`${heading}.display`, "Settings"),
      h(
        "p.opt-note",
        "Kept on this device. The match options are on each match's card.",
      ),
      ...deviceRows(dev, render),
      h(
        "div.card-foot",
        release?.text
          ? h(
              "span.menu-version",
              { "data-test": "settings-version" },
              release.text,
            )
          : h("span"),
        button("DONE", done, "go", {
          "data-default": true,
          "data-test": "settings-done",
        }),
      ),
    );
  };
  render();
  requestAnimationFrame(() =>
    el.querySelector("[data-default]")?.focus({ preventScroll: true }),
  );
  return { el, render };
}

// A row's segmented bar (src/ui/seg.js). key: the row's data-key (the Scene row's
// swatches; the keyboard's focus kept across a redraw).
export function seg(choices, value, onPick, key = null, label = null) {
  return segBar({ choices, value, onPick, key, label }).el;
}
