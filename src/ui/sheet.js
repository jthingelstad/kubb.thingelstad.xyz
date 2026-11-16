// The score sheet (MENU, SCORE SHEET during a match; SCORE SHEET on the winner card):
// the match so far as a Planet Kubb Notation game file, the same text the Playdate game
// keeps (engine.sheet(), lua/web/session.lua). On screen each line is shown without the
// positions on the pitch (gamefile.shown); SHOW POSITIONS puts them back. COPY and
// DOWNLOAD always take the whole file, positions included. Like the report card, it is
// modal while open and everything else under the root is inert.
import { h, button } from "./dom.js";

export const NOTATION_URL =
  "https://thingelstad.xyz/things/planet-kubb-score/?ref=kubb-sheet";

// opts: { game, download? (for tests: (name, text) => void) }
// Returns null when there is no match to show (practice).
export function openSheet(root, opts) {
  const { game } = opts;
  let sheet = null;
  try {
    sheet = game.engine.sheet();
  } catch (err) {
    console.warn("No score sheet:", err);
  }
  if (!sheet || typeof sheet.text !== "string") return null;
  const lines = sheet.text.replace(/\n$/, "").split("\n");
  const shown = Array.isArray(sheet.shown) ? sheet.shown : lines;
  let positions = false;
  game.modal++;

  const text = h("pre.sheet-text", {
    "data-test": "sheet-text",
    tabindex: "0",
    "aria-label": "The game file",
  });
  const fill = () => {
    text.textContent = (positions ? lines : shown).join("\n");
  };
  const status = h("p.sheet-status", {
    role: "status",
    "data-test": "sheet-status",
  });
  const toggle = button(
    "SHOW POSITIONS",
    () => {
      positions = !positions;
      toggle.textContent = positions ? "HIDE POSITIONS" : "SHOW POSITIONS";
      toggle.setAttribute("aria-pressed", String(positions));
      fill();
    },
    "small",
    { "aria-pressed": "false", "data-test": "sheet-positions" },
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sheet.text);
      status.textContent = "Copied the game file.";
    } catch {
      // No clipboard here: select the whole file (with positions) to copy by hand.
      if (!positions) toggle.click();
      const range = document.createRange();
      range.selectNodeContents(text);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      status.textContent = "Could not copy. The file is selected to copy.";
    }
  };
  const download =
    opts.download ??
    ((name, body) => {
      const url = URL.createObjectURL(
        new Blob([body], { type: "text/plain;charset=utf-8" }),
      );
      const a = h("a", { href: url, download: name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  const body = h(
    "div.card.sheet",
    { "data-test": "sheet-card" },
    h("h2.display", "Score sheet"),
    h(
      "p.sheet-note",
      sheet.done ? "The whole match." : "The match so far.",
      " ",
      h(
        "a",
        { href: NOTATION_URL, target: "_blank", rel: "noopener" },
        "How to read it",
      ),
    ),
    h("div.sheet-tools", toggle),
    text,
    status,
    h(
      "div.row",
      button("COPY", copy, "", { "data-test": "sheet-copy" }),
      button(
        "DOWNLOAD",
        () => {
          download(sheet.name || "kubb-game.txt", sheet.text);
          status.textContent = `Saved ${sheet.name || "kubb-game.txt"}.`;
        },
        "",
        { "data-test": "sheet-download" },
      ),
      button("BACK", () => close(), "go", {
        "data-default": true,
        "data-test": "sheet-back",
      }),
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
    game.modal = Math.max(0, game.modal - 1);
  }
  fill();
  root.append(scrim);
  const quieted = [...root.children].filter((el) => el !== scrim && !el.inert);
  for (const el of quieted) el.inert = true;
  window.addEventListener("keydown", esc);
  requestAnimationFrame(() =>
    body.querySelector("[data-default]")?.focus({ preventScroll: true }),
  );
  return { close, sheet };
}
