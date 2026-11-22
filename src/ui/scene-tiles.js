// The Scene as picture tiles (the 1.0 design's "Scene tiles"): each the pitch behind
// the card drawn in that scene by the game itself (Game.sceneThumb), its name (the
// engine's, from pitch.optionRows' Scene row) under it. A radio group like the
// segmented bar: one Tab stop, the arrow keys, Home and End inside.
//
// Seven since engine 0.14: they wrap, three a row on a phone (the seventh centred on
// a row of its own) and four a row where the card is wide (four and three, centred),
// every tile at least 48 px tall to a finger (game.css `.tiles`; docs/SYSTEM.md
// "Scene tiles"). The solo card, the lobby (the host's) and practice's MENU use it.
//
//   const t = sceneTiles({ choices, value, onPick, game, labelledBy, test })
//   t.el, t.value(), t.set(v), t.stop()
import { h } from "./dom.js";

export function sceneTiles({
  choices,
  value,
  onPick = null,
  game = null,
  labelledBy = null,
  test = "scene-tile",
}) {
  let current = choices.some(([v]) => v === value) ? value : choices[0][0];
  const canvases = [];
  const btns = choices.map(([v, label]) => {
    const canvas = h("canvas", {
      width: 192,
      height: 112,
      "aria-hidden": "true",
    });
    canvases.push([canvas, v]);
    return h(
      "button.tile",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(v === current),
        tabindex: v === current ? "0" : "-1",
        "data-value": v,
        "data-test": `${test}-${v}`,
        onclick: () => pick(v),
        onkeydown: (e) => {
          const i = choices.findIndex(([c]) => c === current);
          const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
            e.key
          ];
          let j = d ? (i + d + choices.length) % choices.length : null;
          if (e.key === "Home") j = 0;
          if (e.key === "End") j = choices.length - 1;
          if (j === null) return;
          e.preventDefault();
          pick(choices[j][0]);
          btns[j].focus();
        },
      },
      canvas,
      h("span.tile-name", label),
    );
  });
  function mark(v) {
    current = v;
    for (const b of btns) {
      const on = b.dataset.value === v;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  function pick(v) {
    if (v === current) return;
    mark(v);
    onPick?.(v);
  }
  // the pictures: drawn once the game has a frame to draw them from
  let tries = 0;
  let raf = 0;
  const draw = () => {
    raf = 0;
    const done = canvases.every(([c, v]) => game?.sceneThumb?.(c, v));
    if (!done && game && ++tries < 120) raf = requestAnimationFrame(draw);
  };
  if (game) raf = requestAnimationFrame(draw);
  return {
    el: h(
      "div.tiles",
      {
        role: "radiogroup",
        ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
        "data-key": "scene",
        "data-count": String(choices.length),
      },
      btns,
    ),
    value: () => current,
    set: (v) => mark(v),
    stop: () => raf && cancelAnimationFrame(raf),
  };
}
