// Writes the game's Lua sources as one JSON file: { "core/world": "<source>",
// "web/session": "<source>", ... } from vendor/core/*.lua and lua/web/*.lua.
// src/engine loads it into wasmoon behind the `import` shim.
//
//   node tools/lua-bundle.mjs [--out build/lua-sources.json]
//
// The keys are sorted so the same sources always give the same bytes (the
// build hashes the file's name from them).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DIRS = [
  ["core", "vendor/core"],
  ["web", "lua/web"],
];

export async function bundleLua() {
  const out = {};
  for (const [prefix, dir] of DIRS) {
    const names = (await fs.readdir(path.join(root, dir)))
      .filter((f) => f.endsWith(".lua"))
      .sort();
    for (const f of names) {
      out[`${prefix}/${f.slice(0, -4)}`] = await fs.readFile(
        path.join(root, dir, f),
        "utf8",
      );
    }
  }
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return sorted;
}

async function main() {
  let outFile = "build/lua-sources.json";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outFile = args[++i];
    else throw new Error(`unknown argument ${args[i]}`);
  }
  const sources = await bundleLua();
  const target = path.resolve(root, outFile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const text = JSON.stringify(sources);
  await fs.writeFile(target, text);
  console.log(
    `lua-bundle: ${Object.keys(sources).length} modules, ${text.length} bytes -> ${outFile}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
