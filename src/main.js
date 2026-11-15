// PLACEHOLDER ENTRY. The game client replaces this file (src/game/, src/ui/).
//
// tools/build.mjs bundles src/main.js into dist/assets/main-<hash>.js, and the
// game pages (/p/<code> and /practice/) load it as a module. Until the client
// is written, the page says plainly that the pitch is being built.
import { readConfig, pitchCode } from "./site/config.js";

const config = readConfig();
const ui = document.getElementById("ui");
const box = document.createElement("div");
box.className = "placeholder";
const title = document.createElement("h1");
title.className = "display";
title.textContent = "The pitch is being built";
const text = document.createElement("p");
const code = pitchCode();
text.textContent =
  config.mode === "practice"
    ? "The practice pitch is not ready yet. The game is still being built."
    : `This is pitch ${code}. Matches are not ready yet: the game is still being built.`;
const back = document.createElement("a");
back.className = "button";
back.href = "/";
back.textContent = "Back to the start";
box.append(title, text, back);
ui.append(box);
