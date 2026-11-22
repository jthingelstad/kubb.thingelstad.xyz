// The name row (the engine's docs/NAMES.md section 8; the owner, 2026-11-21: no typed
// name anywhere): one control for a generated name, built once and used wherever a name
// is chosen: Settings (MENU and /settings/), the solo card, the lobby (your name, and the
// host's team names) and the share card.
//
//   the name as it reads, then one picker per word (a native select of every word the
//   slot can take with the others, names.choices), a lock per word (aria-pressed), and
//   SHUFFLE, which rolls a new name keeping the locked words (names.roll with keep).
//
// A team's "The ___" shows its "The" as text. Shuffle may change a team's shape unless
// a lock holds it. Every control is a native button or select, so the keyboard and a
// screen reader reach each one; the name is announced (aria-live) when it changes.
//
//   const row = nameRow({ names, kind, text, label, onChange, key })
//   row.el            the element
//   row.set(text)     shows another name (a change made elsewhere); locks are kept
//                     where the word is still in its place
//   row.text          the name shown
import { h, button } from "./dom.js";

// The widest a name and a word are drawn, in CSS px at the row's type (700 17px of the
// body face): a name's text at NAME_FIT.text, each word's picker at NAME_FIT.word. Both
// are measured against every name the engine can make (names.all) by
// tests/game/names-fit-client.test.mjs, so no name is ever cut.
export const NAME_FIT = { text: 200, word: 150 };

const SLOT_WORDS = ["first", "second", "third"];

// The words as the row shows them: for "The Lumberjacks" the "The" is text, not a slot.
function prefixOf(names, kind, shape) {
  const w = (names._words ??= names.words());
  return w.shapes[kind].find((s) => s.id === shape)?.prefix ?? null;
}

export function nameRow({
  names,
  kind = "player",
  text,
  label = "Your name",
  onChange = null,
  key = "name",
}) {
  let parts = names.valid(kind, text).parts ?? names.roll(kind).parts;
  let current = text;
  let locks = [];
  const shown = h("span.name-text", { "data-test": `${key}-text` });
  const live = h("span.visually-hidden", { "aria-live": "polite" });
  const words = h("div.name-words");
  const shuffle = button("SHUFFLE", () => doShuffle(), "small", {
    "data-test": `${key}-shuffle`,
    // "Shuffle your name", "Shuffle name on the reel", "Shuffle Team A's name"
    "aria-label": `Shuffle ${/^Team /.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1)}`,
  });
  const el = h(
    "div.name-row",
    { role: "group", "aria-label": label, "data-test": key },
    h("div.name-head", shown, shuffle),
    words,
    live,
  );

  const make = (p) => {
    const t = names.call("make", { kind, parts: p }).text;
    return t ?? null;
  };

  function draw(announce) {
    current = make(parts) ?? current;
    shown.textContent = current;
    if (announce) live.textContent = `${label}: ${current}`;
    const prefix = prefixOf(names, kind, parts.shape);
    const nodes = [];
    if (prefix) nodes.push(h("span.name-prefix", prefix));
    parts.words.forEach((word, slot) => {
      const choices = names.choices(kind, parts, slot);
      const ord = SLOT_WORDS[prefix ? slot + 1 : slot] ?? `word ${slot + 1}`;
      const select = h(
        "select.name-pick",
        {
          "aria-label": `${label}, ${ord} word`,
          "data-test": `${key}-word-${slot}`,
          onchange: (e) => pick(slot, e.target.value),
        },
        choices.map((w) => h("option", { value: w, selected: w === word }, w)),
      );
      select.value = word;
      const locked = !!locks[slot];
      const lock = h(
        "button.name-lock",
        {
          type: "button",
          "aria-pressed": String(locked),
          "aria-label": `Keep ${word} when shuffling`,
          title: locked ? `${word} is kept` : `Keep ${word}`,
          "data-test": `${key}-lock-${slot}`,
          onclick: () => {
            locks[slot] = !locks[slot];
            draw(false);
            el.querySelector(`[data-test="${key}-lock-${slot}"]`)?.focus();
          },
        },
        locked ? "KEPT" : "KEEP",
      );
      nodes.push(h("div.name-word", select, lock));
    });
    words.replaceChildren(...nodes);
  }

  function pick(slot, word) {
    const next = { shape: parts.shape, words: parts.words.slice() };
    next.words[slot] = word;
    if (!make(next)) return draw(false);
    parts = next;
    draw(true);
    onChange?.(current);
    el.querySelector(`[data-test="${key}-word-${slot}"]`)?.focus();
  }

  function doShuffle() {
    const held = parts.words.map((w, i) => (locks[i] ? w : null));
    const keep = held.some(Boolean)
      ? { shape: parts.shape, words: held }
      : null;
    const r = names.roll(kind, keep);
    if (!r?.parts) return;
    parts = r.parts;
    locks = locks.map((l, i) => l && parts.words[i] === held[i]);
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
      const old = parts;
      parts = v.parts;
      locks = locks.map(
        (l, i) =>
          l && old.shape === parts.shape && old.words[i] === parts.words[i],
      );
      draw(false);
    },
  };
}
