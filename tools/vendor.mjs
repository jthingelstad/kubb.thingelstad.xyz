// The game engine is kubb-engine (jthingelstad/kubb-engine), vendored at a tagged
// release into vendor/engine/ byte for byte. Never edit vendor/engine by hand: change
// the engine there, release a tag, and vendor that tag here.
//
//   node tools/vendor.mjs sync [--tag vX.Y.Z] [--repo ../kubb-engine]
//       reads the tag (default: the one in vendor/engine.json) from the engine checkout's
//       git objects, never its working tree, writes vendor/engine/ and records the tag,
//       its commit and the sha256 of what the engine's own manifest does not cover
//   node tools/vendor.mjs check
//       fails unless every file in vendor/engine/ matches: the Lua against the engine's
//       manifest (vendor/engine/engine.json), the manifest, LICENSE and the golden
//       corpus against vendor/engine.json, and the bundle against the manifest's
//
// vendor/engine/ holds the engine's core/, room/, session/, tune/, version.lua, engine.json and
// LICENSE, and its golden corpus (tests/golden/drive.lua and hashes.json) as golden/.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleText } from "./lua-bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "vendor", "engine");
const pinPath = path.join(root, "vendor", "engine.json");
const REPOSITORY = "jthingelstad/kubb-engine";

// What is taken from the tag: [path in the engine, path under vendor/engine/].
const ENGINE_DIRS = ["core", "room", "session", "tune"];
const EXTRA = [
  ["engine.json", "engine.json"],
  ["LICENSE", "LICENSE"],
  ["tests/golden/drive.lua", "golden/drive.lua"],
  ["tests/golden/hashes.json", "golden/hashes.json"],
];

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Every file under vendor/engine/, as paths with forward slashes, sorted.
function vendoredFiles() {
  if (!fs.existsSync(dest)) return [];
  return fs
    .readdirSync(dest, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      path
        .relative(dest, path.join(e.parentPath, e.name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}

function sync(args) {
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? undefined : args[i + 1];
  };
  const pin = fs.existsSync(pinPath)
    ? JSON.parse(fs.readFileSync(pinPath, "utf8"))
    : {};
  const tag = opt("tag") ?? pin.tag;
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? ""))
    throw new Error(`a release tag like v0.2.0, not ${tag}`);
  const repo = path.resolve(
    opt("repo") ?? path.join(root, "..", "kubb-engine"),
  );
  const git = (...a) =>
    execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 28 });
  const commit = git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`)
    .toString()
    .trim();
  const blob = (p) => git("cat-file", "blob", `${commit}:${p}`);
  const listed = git("ls-tree", "-r", "--name-only", commit)
    .toString()
    .split("\n")
    .filter(Boolean);
  const lua = listed.filter(
    (p) =>
      p === "version.lua" ||
      (ENGINE_DIRS.includes(p.split("/")[0]) &&
        p.endsWith(".lua") &&
        p.split("/").length === 2),
  );

  // The tag's own manifest must describe exactly these files, and name the tag.
  const manifest = JSON.parse(blob("engine.json").toString("utf8"));
  if (`v${manifest.version}` !== tag)
    throw new Error(`${tag}'s engine.json says version ${manifest.version}`);
  const named = Object.keys(manifest.files ?? {}).sort();
  if (named.join() !== [...lua].sort().join())
    throw new Error(`${tag}'s engine.json does not list its Lua files`);

  fs.rmSync(dest, { recursive: true, force: true });
  const write = (to, bytes) => {
    const file = path.join(dest, to);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  };
  for (const p of lua) {
    const bytes = blob(p);
    if (sha(bytes) !== manifest.files[p])
      throw new Error(`${p} at ${tag} does not match its engine.json hash`);
    write(p, bytes);
  }
  const files = {};
  for (const [from, to] of EXTRA) {
    const bytes = blob(from);
    write(to, bytes);
    files[to] = sha(bytes);
  }
  const record = { repository: REPOSITORY, tag, commit, files };
  fs.writeFileSync(pinPath, JSON.stringify(record, null, 2) + "\n");
  console.log(
    `vendored kubb-engine ${tag} (${commit.slice(0, 7)}): ${lua.length} Lua files`,
  );
  check();
}

function check() {
  const pin = JSON.parse(fs.readFileSync(pinPath, "utf8"));
  const bad = [];
  const have = vendoredFiles();
  const manifestFile = path.join(dest, "engine.json");
  const manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
    : { files: {} };
  const want = [
    ...Object.keys(manifest.files),
    ...Object.keys(pin.files),
  ].sort();
  for (const f of have)
    if (!want.includes(f)) bad.push(`${f} is not the engine's`);
  for (const f of want) {
    const file = path.join(dest, f);
    if (!fs.existsSync(file)) {
      bad.push(`${f} is missing`);
      continue;
    }
    const expected = manifest.files[f] ?? pin.files[f];
    if (sha(fs.readFileSync(file)) !== expected) bad.push(`${f} was edited`);
  }
  if (`v${manifest.version}` !== pin.tag)
    bad.push(`engine.json is ${manifest.version}, the pin ${pin.tag}`);
  if (!bad.length && bundleText().sha256 !== manifest.bundle?.sha256)
    bad.push("the Lua bundle does not match the engine's bundle hash");
  if (bad.length) {
    console.error(
      "vendor/engine does not match kubb-engine " +
        `${pin.tag} (npm run vendor:sync):\n  ` +
        bad.join("\n  "),
    );
    process.exit(1);
  }
  console.log(
    `vendor/engine matches kubb-engine ${pin.tag} (${pin.commit.slice(0, 7)}, ` +
      `${Object.keys(manifest.files).length} Lua files and the bundle)`,
  );
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "sync") sync(args);
else if (mode === "check") check();
else {
  console.error(
    "usage: node tools/vendor.mjs sync [--tag vX.Y.Z] [--repo <path>] | check",
  );
  process.exit(2);
}
