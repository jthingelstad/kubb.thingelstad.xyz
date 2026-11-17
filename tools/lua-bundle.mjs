// Writes the engine's Lua sources as one JSON file, the module map kubb-engine's
// `make bundle` writes ({ "core/world": "<source>", "session/api": "<source>",
// "tune/pointer": "<source>", "version": "<source>", ... }, keys sorted, no
// whitespace), from vendor/engine/. The same sources give the same bytes, and
// vendor:check holds their sha256 to the engine manifest's `bundle.sha256`.
// src/engine loads it into wasmoon behind the `import` shim.
//
//   node tools/lua-bundle.mjs [--out build/lua-sources.json]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(root, "vendor", "engine");

// The engine's Lua: these folders' *.lua files and version.lua, as kubb-engine's
// tools/bundle.mjs takes them. Module names are the paths without ".lua".
const DIRS = ["core", "room", "session", "tune"];
const TOP = ["version.lua"];

function engineFiles() {
  const files = [...TOP];
  for (const dir of DIRS)
    for (const f of fs.readdirSync(path.join(engineDir, dir)))
      if (f.endsWith(".lua")) files.push(`${dir}/${f}`);
  return files.sort();
}

// The module map, keys sorted.
export function bundleLua() {
  const out = {};
  for (const f of engineFiles())
    out[f.slice(0, -4)] = fs.readFileSync(path.join(engineDir, f), "utf8");
  return out;
}

// The bundle's bytes and their sha256 (the engine manifest's bundle.sha256).
export function bundleText() {
  const text = JSON.stringify(bundleLua());
  return {
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

// The vendored engine's version (vendor/engine/engine.json).
export function engineVersion() {
  return JSON.parse(
    fs.readFileSync(path.join(engineDir, "engine.json"), "utf8"),
  ).version;
}

function main() {
  let outFile = "build/lua-sources.json";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outFile = args[++i];
    else throw new Error(`unknown argument ${args[i]}`);
  }
  const { text, sha256 } = bundleText();
  const target = path.resolve(root, outFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  console.log(
    `lua-bundle: kubb-engine ${engineVersion()}, ${Object.keys(JSON.parse(text)).length} modules, sha256 ${sha256.slice(0, 12)} -> ${outFile}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
