// Writes the engine's Lua sources as one JSON file, the module map kubb-engine's
// `make bundle` writes ({ "core/world": "<source>", "session/api": "<source>",
// "tune/pointer": "<source>", "version": "<source>", ... }, keys sorted, no
// whitespace), one per engine the site carries: the newest from vendor/engine/,
// each older minor from vendor/engines/<major.minor>/ (tools/vendor.mjs). The same
// sources give the same bytes, and vendor:check holds their sha256 to each engine
// manifest's `bundle.sha256`. src/engine loads one into wasmoon behind the `import`
// shim.
//
//   node tools/lua-bundle.mjs [--out build/]
//       writes build/lua-sources-<major.minor>.json for every carried engine
//
// bundleLua(), bundleText() and engineVersion() with no argument are the newest
// engine's; given a major.minor ("0.7") or an engine directory, that engine's.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The engine's Lua: these folders' *.lua files and version.lua, as kubb-engine's
// tools/bundle.mjs takes them. Module names are the paths without ".lua". The
// shared pitch is pitch/ from 0.13 and room/ before it; an engine has one or the
// other, and a folder an engine does not have is skipped.
const DIRS = ["core", "pitch", "room", "session", "tune"];
const TOP = ["version.lua"];

export const majorMinor = (version) =>
  String(version).split(".").slice(0, 2).join(".");

// The engines a vendor/ folder carries, newest first:
// [{ mm: "0.8", version: "0.8.1", dir }, { mm: "0.7", version: "0.7.4", dir }].
export function carriedEngines(vendorDir = path.join(root, "vendor")) {
  const list = [];
  const add = (dir) => {
    const version = engineVersion(dir);
    list.push({ mm: majorMinor(version), version, dir });
  };
  add(path.join(vendorDir, "engine"));
  const older = path.join(vendorDir, "engines");
  if (fs.existsSync(older))
    for (const mm of fs.readdirSync(older).sort(compareMinor).reverse())
      add(path.join(older, mm));
  return list;
}

// "0.10" after "0.9": major.minor strings compared as numbers.
export function compareMinor(a, b) {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
}

// An engine directory: the newest when not given, a carried major.minor, or a path.
function engineDir(which) {
  if (which === undefined) return path.join(root, "vendor", "engine");
  if (/^\d+\.\d+$/.test(which)) {
    const found = carriedEngines().find((e) => e.mm === which);
    if (!found) throw new Error(`the site carries no engine ${which}`);
    return found.dir;
  }
  return which;
}

function engineFiles(dir) {
  const files = [...TOP];
  for (const sub of DIRS) {
    const folder = path.join(dir, sub);
    if (!fs.existsSync(folder)) continue;
    for (const f of fs.readdirSync(folder))
      if (f.endsWith(".lua")) files.push(`${sub}/${f}`);
  }
  return files.sort();
}

// The module map, keys sorted.
export function bundleLua(which) {
  const dir = engineDir(which);
  const out = {};
  for (const f of engineFiles(dir))
    out[f.slice(0, -4)] = fs.readFileSync(path.join(dir, f), "utf8");
  return out;
}

// The bundle's bytes and their sha256 (the engine manifest's bundle.sha256).
export function bundleText(which) {
  const text = JSON.stringify(bundleLua(which));
  return {
    text,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

// An engine's version (its engine.json).
export function engineVersion(which) {
  return JSON.parse(
    fs.readFileSync(path.join(engineDir(which), "engine.json"), "utf8"),
  ).version;
}

// The bundle file the build names for an engine.
export const bundleFile = (outDir, mm) =>
  path.join(outDir, `lua-sources-${mm}.json`);

function main() {
  let outDir = "build";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") outDir = args[++i];
    else throw new Error(`unknown argument ${args[i]}`);
  }
  for (const { mm, version, dir } of carriedEngines()) {
    const { text, sha256 } = bundleText(dir);
    const target = path.resolve(root, bundleFile(outDir, mm));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    console.log(
      `lua-bundle: kubb-engine ${version}, ${Object.keys(JSON.parse(text)).length} modules, sha256 ${sha256.slice(0, 12)} -> ${path.relative(root, target)}`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
