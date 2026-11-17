// EMBED (beside WATCH REPLAY on a finished pitch, and on the replay's bar): the
// HTML that puts this pitch's match on another site (Jamie, 2026-11-16: "I would
// like an embed option that allows me to put a Kubb game played as an embed on
// another website"). The frame is /e/<code>, which plays the pitch's replay read
// only (src/embed/embed.js). Like the score sheet, it is modal while open.
import { h, button } from "./dom.js";

export const EMBED_ORIGIN = "https://throwingwood.com";

// The snippet: full width, 16:10, loaded when it scrolls near, asking for nothing.
export function embedSnippet(code) {
  return `<iframe src="${EMBED_ORIGIN}/e/${code}" title="A match of Kubb: Throwing Wood" width="100%" style="aspect-ratio: 16 / 10; border: 0;" loading="lazy" allow=""></iframe>`;
}

// opts: { game?, code }
export function openEmbed(root, { game = null, code }) {
  const snippet = embedSnippet(code);
  if (game) game.modal++;
  const text = h(
    "textarea.embed-text",
    {
      readonly: true,
      rows: 4,
      spellcheck: "false",
      "aria-label": "The embed HTML",
      "data-test": "embed-text",
    },
    snippet,
  );
  text.value = snippet;
  const status = h("p.sheet-status", {
    role: "status",
    "data-test": "embed-status",
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      status.textContent = "Copied the embed HTML.";
    } catch {
      text.focus();
      text.select();
      status.textContent = "Could not copy. The HTML is selected to copy.";
    }
  };
  const body = h(
    "div.card.sheet.embed-card",
    { "data-test": "embed-card" },
    h("h2.display", "Embed this match"),
    h(
      "p.sheet-note",
      "Paste this into a page to show the match's replay there. It plays when it scrolls into view, without sound, and nobody watching it can throw.",
    ),
    text,
    status,
    h(
      "div.row",
      button("COPY", copy, "go", {
        "data-default": true,
        "data-test": "embed-copy",
      }),
      button("BACK", () => close(), "", { "data-test": "embed-back" }),
    ),
  );
  const scrim = h("div.scrim.sheet-scrim", body);
  scrim.addEventListener("pointerdown", (e) => {
    if (e.target === scrim) close();
  });
  let closed = false;
  const esc = (e) => {
    if (e.key === "Escape") close();
  };
  function close() {
    if (closed) return;
    closed = true;
    scrim.remove();
    for (const el of quieted) el.inert = false;
    window.removeEventListener("keydown", esc);
    if (game) game.modal = Math.max(0, game.modal - 1);
  }
  root.append(scrim);
  const quieted = [...root.children].filter((el) => el !== scrim && !el.inert);
  for (const el of quieted) el.inert = true;
  window.addEventListener("keydown", esc);
  requestAnimationFrame(() =>
    body.querySelector("[data-default]")?.focus({ preventScroll: true }),
  );
  return { close, snippet };
}
