// The score sheet (MENU, SCORE SHEET during a match; SCORE SHEET on the winner card):
// the match so far as a Planet Kubb Notation game file, the same text the Playdate game
// keeps (engine.sheet(), vendor/engine/session/session.lua). Since engine 0.13.1 the file is
// Planet Kubb Notation 2, whose positions are lines of their own after a turn ("@a" or
// "@b" for the pitch under attack, "*a" or "*b" for where each baton's kubbs fell; older
// engines wrote "(@ ...)" comments on the turn line). On screen the file is shown without
// them (the engine's `shown`); SHOW POSITIONS puts them back. COPY and DOWNLOAD always
// take the whole file, positions included. Like the report card, it is
// modal while open and everything else under the root is inert.
import { h, button } from "./dom.js";

export const NOTATION_URL =
  "https://thingelstad.xyz/things/planet-kubb-score/?ref=kubb-sheet";

// opts: { game, engine?, download? (for tests: (name, text) => void) }
// engine: the engine holding the match, when it is not the Game's (a finished match from
// an older engine the site carries, docs/ENGINES.md).
// Returns null when there is no match to show (practice).
export function openSheet(root, opts) {
  const { game, engine = game.engine } = opts;
  let sheet = null;
  try {
    sheet = engine.sheet();
  } catch (err) {
    console.warn("No score sheet:", err);
  }
  if (!sheet || typeof sheet.text !== "string") return null;
  // where the keyboard was (MENU, or the winner card's SCORE SHEET), to go back to
  const opener = document.activeElement;
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
    { "data-test": "sheet-card", role: "dialog", "aria-label": "Score sheet" },
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
    if (opener && opener !== document.body && opener.isConnected)
      opener.focus({ preventScroll: true });
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
