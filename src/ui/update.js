// The notice that a new version of the game is out (src/net/freshness.js):
// small, bottom left, never in the way of a throw. RELOAD reloads only when
// the player presses it. On a shared pitch with a match on, it says to reload
// after the match and offers no button: a reload mid-match would drop this
// player from the pitch. LATER hides it for this page.
import { h, button, clear } from "./dom.js";

export function showUpdate(root, { canReload = () => true, every = 2000 }) {
  const el = h("div.update-note", {
    role: "status",
    "data-test": "update",
  });
  let shown = null;
  const render = () => {
    const can = canReload();
    if (can === shown) return;
    shown = can;
    clear(el).append(
      h(
        "span.update-text",
        can
          ? "A new version is out"
          : "A new version is out: reload after this match",
      ),
      can
        ? button("RELOAD", () => location.reload(), "small go", {
            "data-test": "update-reload",
          })
        : null,
      button("LATER", () => close(), "small"),
    );
  };
  const timer = setInterval(render, every);
  const close = () => {
    clearInterval(timer);
    el.remove();
  };
  render();
  // first in #ui, so every card and menu opened over the pitch covers it
  root.prepend(el);
  return { close, render };
}
