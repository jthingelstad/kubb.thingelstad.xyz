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

// The solo card's and the lobby's one "You" row: the device's name in the name row
// (src/ui/name-row.js), so it is picked where it is shown; a pick is the device's
// name everywhere (setName). There is no level here: from engine 0.13 a person
// throws on one meter (src/game/throw-level.js). `key` names the row for tests
// (`<key>-you`, its name row `<key>-name`).
export function youRow(key, { names, name, setName = null }) {
  const row = nameRow({
    names,
    kind: "player",
    text: name,
    label: "Your name",
    key: `${key}-name`,
    onChange: (t) => setName?.(t),
  });
  const el = h(
    "div.opt.you",
    { "data-test": `${key}-you` },
    h("span.opt-label", "You"),
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
    onChange: (t) => dev.setName(t),
  });
  return [
    h(
      "div.opt",
      { "data-test": "settings-name-row" },
      h("span.opt-label", "Your name"),
      name.el,
    ),
    h(
      "div.opt",
      { "data-test": "menu-meter" },
      h("span.opt-label", "Meter"),
      seg(METERS, dev.meter, (v) => {
        dev.setMeter(v);
        render();
      }),
      dev.meterNote
        ? h("p.opt-note", { "data-test": "menu-meter-note" }, dev.meterNote)
        : null,
    ),
    h(
      "div.opt",
      { "data-test": "menu-side" },
      h("span.opt-label", "Meter side"),
      seg(SIDES, dev.meterSide, (v) => {
        dev.setMeterSide(v);
        render();
      }),
      dev.sideNote
        ? h("p.opt-note", { "data-test": "menu-side-note" }, dev.sideNote)
        : null,
    ),
    // the sound as a choice that shows which it is (it was one button, SOUND: ON,
    // that read as its own state)
    dev.setMuted
      ? h(
          "div.opt",
          { "data-test": "mute" },
          h("span.opt-label", "Sound"),
          seg(SOUND, dev.muted ? "off" : "on", (v) => {
            dev.setMuted(v === "off");
            render();
          }),
        )
      : null,
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
export function openSettingsPage(root, { home, names }) {
  const dev = prefsDevice(prefs, names);
  const body = h("div.card.menu.settings", { "data-test": "settings" });
  const render = () => {
    body.replaceChildren(
      h("h2.display", "Settings"),
      h(
        "p.opt-note",
        "Kept on this device. The match options are on each match's card.",
      ),
      ...deviceRows(dev, render),
      h(
        "div.menu-list",
        button("DONE", home, "go", {
          "data-default": true,
          "data-test": "settings-done",
        }),
      ),
    );
  };
  render();
  root.append(h("div.scrim", body));
  return body;
}

export function seg(choices, value, onPick, key = null) {
  return h(
    "div.seg",
    key ? { role: "radiogroup", "data-key": key } : { role: "radiogroup" },
    choices.map(([v, label]) =>
      h(
        "button.seg-btn",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(v === value),
          "data-value": v,
          onclick: () => onPick(v),
        },
        label,
      ),
    ),
  );
}
