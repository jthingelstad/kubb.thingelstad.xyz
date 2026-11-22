// The name row (the engine's docs/NAMES.md section 8; the owner, 2026-11-21: no typed
// name anywhere; the Throwing Wood 1.0 design, "The name row"): one control for a
// generated name, built once and used wherever a name is chosen: Settings (MENU and
// /settings/), the solo card, the lobby (your name, and the host's team names), the
// pitch link's welcome card and the share card.
//
//   one line: the name as it reads, then SHUFFLE, which rolls a whole new name
//   (names.roll, nothing kept). In Settings only (`steppers`), under it one stepper
//   per word: previous, the word, next (names.step, the Playdate's crank as a
//   control), so stepping one word keeps the others.
//
// There is no KEEP and no picker: the design took both out (the owner, 2026-11-21:
// "KEEP goes from the name row; the row is the name and SHUFFLE, word steppers only in
// Settings"). A team's "The ___" shows its "The" as text. Every control is a native
// button, so the keyboard and a screen reader reach each one; the name is announced
// (aria-live) when it changes.
//
//   const row = nameRow({ names, kind, text, label, onChange, key, steppers })
//   row.el            the element
//   row.set(text)     shows another name (a change made elsewhere)
//   row.text          the name shown
import { h, button } from "./dom.js";

// The widest a name and a word are drawn, in CSS px: a name's text at NAME_FIT.text
// (the display face at 24 px, .name-text), each stepper's word at NAME_FIT.word (its
// box, .name-step-word). Both are measured against every name the engine can make
// (names.all) by tests/game/names-fit-client.test.mjs, so no name is ever cut. The
// iPhone's row keeps the same two numbers.
export const NAME_FIT = { text: 200, word: 120 };

const SLOT_WORDS = ["first", "second", "third"];

// The words as the row shows them: for "The Lumberjacks" the "The" is text, not a slot.
function prefixOf(names, kind, shape) {
  const w = (names._words ??= names.words());
  return w.shapes[kind].find((s) => s.id === shape)?.prefix ?? null;
}

const lower = (label) =>
  /^Team /.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);

export function nameRow({
  names,
  kind = "player",
  text,
  label = "Your name",
  onChange = null,
  key = "name",
  steppers = false,
}) {
  let parts = names.valid(kind, text).parts ?? names.roll(kind).parts;
  let current = text;
  const shown = h("span.name-text", { "data-test": `${key}-text` });
  const live = h("span.visually-hidden", { "aria-live": "polite" });
  const words = steppers ? h("div.name-steps") : null;
  const shuffle = button("SHUFFLE", () => doShuffle(), "", {
    "data-test": `${key}-shuffle`,
    // "Shuffle your name", "Shuffle name on the reel", "Shuffle Team A's name"
    "aria-label": `Shuffle ${lower(label)}`,
  });
  const el = h(
    "div.name-row",
    { role: "group", "aria-label": label, "data-test": key },
    h("div.name-head", shown, shuffle),
    words,
    live,
  );

  const make = (p) => names.call("make", { kind, parts: p }).text ?? null;

  function draw(announce) {
    current = make(parts) ?? current;
    shown.textContent = current;
    if (announce) live.textContent = `${label}: ${current}`;
    if (!words) return;
    const prefix = prefixOf(names, kind, parts.shape);
    const nodes = [];
    if (prefix) nodes.push(h("span.name-prefix", prefix));
    parts.words.forEach((word, slot) => {
      const ord = SLOT_WORDS[prefix ? slot + 1 : slot] ?? `word ${slot + 1}`;
      const Ord = ord.charAt(0).toUpperCase() + ord.slice(1);
      nodes.push(
        h(
          "div.name-step",
          { role: "group", "aria-label": `${Ord} word` },
          h(
            "button.name-step-btn",
            {
              type: "button",
              "aria-label": `Previous ${ord} word`,
              "data-test": `${key}-prev-${slot}`,
              onclick: () => step(slot, -1),
            },
            "‹",
          ),
          h(
            "span.name-step-word",
            { "data-test": `${key}-word-${slot}` },
            word,
          ),
          h(
            "button.name-step-btn",
            {
              type: "button",
              "aria-label": `Next ${ord} word`,
              "data-test": `${key}-next-${slot}`,
              onclick: () => step(slot, 1),
            },
            "›",
          ),
        ),
      );
    });
    words.replaceChildren(...nodes);
  }

  function step(slot, dir) {
    const r = names.step(kind, parts, slot, dir);
    if (!r?.parts || !r.moved) return;
    parts = r.parts;
    draw(true);
    onChange?.(current);
    el.querySelector(
      `[data-test="${key}-${dir < 0 ? "prev" : "next"}-${slot}"]`,
    )?.focus();
  }

  function doShuffle() {
    const r = names.roll(kind);
    if (!r?.parts) return;
    parts = r.parts;
    draw(true);
    onChange?.(current);
  }

  draw(false);
  return {
    el,
    get text() {
      return current;
    },
    set(t) {
      if (t === current) return;
      const v = names.valid(kind, t);
      if (!v.parts) return;
      parts = v.parts;
      draw(false);
    },
  };
}
