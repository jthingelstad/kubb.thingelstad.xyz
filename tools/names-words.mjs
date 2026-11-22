// The generated names' word lists for the pitch server, which knows no Lua (the engine's
// docs/NAMES.md section 6, docs/SESSION.md "Names"): backend/pitch-server/names-words.json
// is the vendored engine's own `names.words` answer, written here at sync time and
// checked against the engine by `npm run check`, so the server's check and the engine's
// can never hold different words. Its `hash` is the engine's; a client can compare it.
//
//   node tools/names-words.mjs write    writes it from vendor/engine
//   node tools/names-words.mjs check    fails when it is not the engine's answer
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine/index.js";
import { bundleLua } from "./lua-bundle.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORDS_FILE = path.join(
  here,
  "backend",
  "pitch-server",
  "names-words.json",
);

export async function engineWords() {
  const e = await Engine.create({ sources: bundleLua() });
  try {
    return e.call("names.words", {});
  } finally {
    try {
      e.lua.global.close();
    } catch {
      // closed already
    }
  }
}

export const wordsText = (w) => `${JSON.stringify(w, null, 2)}\n`;

async function main(mode) {
  const text = wordsText(await engineWords());
  if (mode === "write") {
    fs.writeFileSync(WORDS_FILE, text);
    console.log(`wrote ${path.relative(here, WORDS_FILE)}`);
    return;
  }
  if (mode !== "check") {
    console.error("usage: node tools/names-words.mjs write | check");
    process.exit(2);
  }
  const kept = fs.existsSync(WORDS_FILE)
    ? fs.readFileSync(WORDS_FILE, "utf8")
    : "";
  if (kept !== text) {
    console.error(
      `${path.relative(here, WORDS_FILE)} is not the vendored engine's names.words: run node tools/names-words.mjs write`,
    );
    process.exit(1);
  }
  console.log(
    `${path.relative(here, WORDS_FILE)} is the engine's names.words (${JSON.parse(text).hash})`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2]);
