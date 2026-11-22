// The segmented bar (the Throwing Wood 1.0 design, "Segmented bar"): one joined bar
// for two to four options, the chosen part ink with paper type. It is every row's
// choice on the web: the solo card, the lobby, MENU and Settings (it replaced the
// loose .seg-btn chips). The iPhone builds the same control (its segmented bar).
//
//   const s = segBar({ choices, value, onPick, key, label })
//   s.el          the bar: role="radiogroup", each part a button with role="radio"
//   s.value()     the value chosen
//   s.set(v)      shows another value as chosen (a change made elsewhere)
//
// choices: [[value, label], ...]. label names the group for a screen reader (else the
// row's label names it through aria-labelledby, `labelledBy`). key: data-key, so a
// row is found (the Scene row's swatches, tests).
//
// The keyboard (the design's "Keyboard (web)"): the bar is one Tab stop, the chosen
// part; the arrow keys (and Home, End) move the choice inside it and pick as they go,
// as a radio group does. A row drawn again after a pick (MENU's render) keeps the
// keyboard's focus on the new bar's chosen part.
import { h } from "./dom.js";

const NEXT = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function segBar({
  choices,
  value,
  onPick = null,
  key = null,
  label = null,
  labelledBy = null,
}) {
  let current = choices.some(([v]) => v === value) ? value : choices[0][0];
  const el = h("div.seg", {
    role: "radiogroup",
    "data-key": key,
    "aria-label": labelledBy ? null : label,
    "aria-labelledby": labelledBy,
  });
  const btns = choices.map(([v, text]) =>
    h(
      "button.seg-btn",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(v === current),
        tabindex: v === current ? "0" : "-1",
        "data-value": v,
        onclick: () => pick(v, false),
        onkeydown: (e) => onKey(e),
      },
      text,
    ),
  );
  el.append(...btns);

  function show(v) {
    current = v;
    for (const b of btns) {
      const on = b.dataset.value === v;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  function pick(v, fromKey) {
    const changed = v !== current;
    show(v);
    if (fromKey) btns.find((b) => b.dataset.value === v)?.focus();
    if (changed || !fromKey) onPick?.(v);
    if (fromKey) refocus();
  }

  // MENU and Settings draw their rows again after a pick: the keyboard stays on the
  // chosen part of the bar that took this one's place.
  function refocus() {
    if (el.isConnected || !key) return;
    const again = document.querySelector(
      `.seg[data-key="${CSS.escape(key)}"] [aria-checked="true"]`,
    );
    again?.focus();
  }

  function onKey(e) {
    const i = choices.findIndex(([v]) => v === current);
    let j = null;
    if (e.key in NEXT) j = (i + NEXT[e.key] + choices.length) % choices.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = choices.length - 1;
    if (j === null) return;
    e.preventDefault();
    pick(choices[j][0], true);
  }

  return {
    el,
    value: () => current,
    set: show,
  };
}
