// The game engine is kubb-engine (jthingelstad/kubb-engine), vendored at tagged
// releases byte for byte. Never edit a vendored engine by hand: change the engine
// there, release a tag, and vendor that tag here.
//
// The site can carry more than one engine, one per major.minor (docs/ENGINES.md):
// the newest in vendor/engine/, each older minor it still plays back in
// vendor/engines/<major.minor>/. vendor/engine.json pins them all: its top-level
// tag, commit and files are vendor/engine/'s, and `older` holds the others by
// major.minor.
//
//   node tools/vendor.mjs sync [--repo ../kubb-engine]
//       writes every pinned engine again at its own tag
//   node tools/vendor.mjs sync --tag vX.Y.Z [--keep | --drop] [--repo ../kubb-engine]
//       moves the engine of that tag's major.minor to the tag: the newest when it is
//       the newest's minor, an older engine when it is one the site carries. A newer
//       minor replaces the newest and must say what happens to the one it replaces:
//       --keep moves it to vendor/engines/<its major.minor>/ (the site goes on
//       playing back its matches), --drop removes it. Without either it stops.
//   node tools/vendor.mjs drop <major.minor>
//       stops carrying an older engine
//   node tools/vendor.mjs check
//       fails unless every pinned engine matches: its Lua against its own manifest
//       (engine.json), the manifest, LICENSE and the golden corpus against the pin,
//       the bundle against the manifest's, and nothing else under vendor/engines/
//
// Each engine folder holds the engine's core/, room/, session/, tune/, version.lua,
// engine.json and LICENSE, and its golden corpus (tests/golden/drive.lua and
// hashes.json) as golden/. Tags are read from the engine checkout's git objects,
// never its working tree.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleText, compareMinor, majorMinor } from "./lua-bundle.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "jthingelstad/kubb-engine";

// What is taken from the tag: [path in the engine, path in the engine folder].
// The shared pitch is pitch/ from 0.13 and room/ before it; a tag has one or the
// other, and only what the tag has is taken.
const ENGINE_DIRS = ["core", "pitch", "room", "session", "tune"];
const EXTRA = [
  ["engine.json", "engine.json"],
  ["LICENSE", "LICENSE"],
  ["tests/golden/drive.lua", "golden/drive.lua"],
  ["tests/golden/hashes.json", "golden/hashes.json"],
];

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const minorOfTag = (tag) => majorMinor(tag.replace(/^v/, ""));

// Where a checkout keeps its engines.
export function vendorPaths(root = here) {
  const vendor = path.join(root, "vendor");
  return {
    vendor,
    newest: path.join(vendor, "engine"),
    olderDir: path.join(vendor, "engines"),
    older: (mm) => path.join(vendor, "engines", mm),
    pin: path.join(vendor, "engine.json"),
  };
}

export function readPin(root = here) {
  const { pin } = vendorPaths(root);
  if (!fs.existsSync(pin)) return { repository: REPOSITORY, older: {} };
  const record = JSON.parse(fs.readFileSync(pin, "utf8"));
  return { ...record, older: record.older ?? {} };
}

function writePin(root, record) {
  const older = Object.fromEntries(
    Object.keys(record.older)
      .sort(compareMinor)
      .reverse()
      .map((mm) => [mm, record.older[mm]]),
  );
  fs.writeFileSync(
    vendorPaths(root).pin,
    JSON.stringify({ ...record, repository: REPOSITORY, older }, null, 2) +
      "\n",
  );
}

// Every file under dir, as paths with forward slashes, sorted.
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      path
        .relative(dir, path.join(e.parentPath, e.name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}

// Writes one tag into dest (replacing it) and returns its pin entry.
function extract(repo, tag, dest) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? ""))
    throw new Error(`a release tag like v0.2.0, not ${tag}`);
  const git = (...a) =>
    execFileSync("git", ["-C", repo, ...a], {
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "pipe"],
    });
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

  const out = new Map();
  for (const p of lua) {
    const bytes = blob(p);
    if (sha(bytes) !== manifest.files[p])
      throw new Error(`${p} at ${tag} does not match its engine.json hash`);
    out.set(p, bytes);
  }
  const files = {};
  for (const [from, to] of EXTRA) {
    const bytes = blob(from);
    out.set(to, bytes);
    files[to] = sha(bytes);
  }
  // Read all of it before touching dest: a bad tag leaves the folder as it was.
  fs.rmSync(dest, { recursive: true, force: true });
  for (const [to, bytes] of out) {
    const file = path.join(dest, to);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return { entry: { tag, commit, files }, luaFiles: lua.length };
}

// sync, as the command line runs it. Returns what it did, as lines.
export function sync({
  root = here,
  repo = path.join(root, "..", "kubb-engine"),
  tag,
  keep = false,
  drop = false,
} = {}) {
  repo = path.resolve(repo);
  const paths = vendorPaths(root);
  const pin = readPin(root);
  const said = [];
  const did = (dest, { entry, luaFiles }) =>
    said.push(
      `vendored kubb-engine ${entry.tag} (${entry.commit.slice(0, 7)}) into ${path.relative(root, dest)}: ${luaFiles} Lua files`,
    );
  if (keep && drop) throw new Error("--keep or --drop, not both");

  if (!tag) {
    if (!pin.tag) throw new Error("nothing pinned yet: sync --tag vX.Y.Z");
    const made = extract(repo, pin.tag, paths.newest);
    Object.assign(pin, made.entry);
    did(paths.newest, made);
    for (const mm of Object.keys(pin.older)) {
      const old = extract(repo, pin.older[mm].tag, paths.older(mm));
      pin.older[mm] = old.entry;
      did(paths.older(mm), old);
    }
    writePin(root, pin);
    return said;
  }

  if (!/^v\d+\.\d+\.\d+$/.test(tag))
    throw new Error(`a release tag like v0.2.0, not ${tag}`);
  const mm = minorOfTag(tag);
  const newestMm = pin.tag ? minorOfTag(pin.tag) : null;

  if (!newestMm || mm === newestMm) {
    if (keep || drop)
      throw new Error(
        `${tag} is the newest engine's minor: --keep and --drop are for a newer minor`,
      );
    const made = extract(repo, tag, paths.newest);
    Object.assign(pin, made.entry);
    did(paths.newest, made);
  } else if (pin.older[mm]) {
    if (keep || drop)
      throw new Error(
        `${tag} is an older engine the site carries: --keep and --drop are for a newer minor`,
      );
    const made = extract(repo, tag, paths.older(mm));
    pin.older[mm] = made.entry;
    did(paths.older(mm), made);
  } else if (compareMinor(mm, newestMm) > 0) {
    if (!keep && !drop)
      throw new Error(
        `${tag} is a new minor: say what happens to ${newestMm} (${pin.tag}). ` +
          `--keep carries it on in vendor/engines/${newestMm}/ so its matches still play back; ` +
          `--drop removes it`,
      );
    // Read the new tag first, into a folder of its own, so a bad tag changes nothing.
    const incoming = path.join(paths.vendor, `.incoming-${mm}`);
    let made;
    try {
      made = extract(repo, tag, incoming);
    } catch (err) {
      fs.rmSync(incoming, { recursive: true, force: true });
      throw err;
    }
    if (keep) {
      const to = paths.older(newestMm);
      if (fs.existsSync(to))
        throw new Error(`${path.relative(root, to)} is already there`);
      fs.mkdirSync(paths.olderDir, { recursive: true });
      fs.renameSync(paths.newest, to);
      pin.older[newestMm] = {
        tag: pin.tag,
        commit: pin.commit,
        files: pin.files,
      };
      said.push(`kept kubb-engine ${pin.tag} in ${path.relative(root, to)}`);
    } else {
      fs.rmSync(paths.newest, { recursive: true, force: true });
      said.push(`dropped kubb-engine ${pin.tag}`);
    }
    fs.renameSync(incoming, paths.newest);
    Object.assign(pin, made.entry);
    did(paths.newest, made);
  } else {
    throw new Error(
      `${tag} is older than the newest engine (${pin.tag}) and the site does not carry ${mm}: ` +
        `an engine the site has dropped is not added back`,
    );
  }
  writePin(root, pin);
  return said;
}

// Stops carrying an older engine.
export function drop({ root = here, mm } = {}) {
  const pin = readPin(root);
  if (!pin.older[mm])
    throw new Error(
      mm && pin.tag && minorOfTag(pin.tag) === mm
        ? `${mm} is the newest engine: a newer one replaces it (sync --tag)`
        : `the site carries no older engine ${mm}`,
    );
  const { tag } = pin.older[mm];
  delete pin.older[mm];
  fs.rmSync(vendorPaths(root).older(mm), { recursive: true, force: true });
  writePin(root, pin);
  return [`dropped kubb-engine ${tag} (vendor/engines/${mm}/)`];
}

// One engine folder against its pin entry: a list of problems.
function checkEngine(dir, entry, label) {
  const bad = [];
  const manifestFile = path.join(dir, "engine.json");
  if (!fs.existsSync(dir)) return [`${label} is missing`];
  const manifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, "utf8"))
    : { files: {} };
  const want = [
    ...Object.keys(manifest.files ?? {}),
    ...Object.keys(entry.files ?? {}),
  ].sort();
  for (const f of filesUnder(dir))
    if (!want.includes(f)) bad.push(`${label}/${f} is not the engine's`);
  for (const f of want) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) {
      bad.push(`${label}/${f} is missing`);
      continue;
    }
    const expected = manifest.files?.[f] ?? entry.files[f];
    if (sha(fs.readFileSync(file)) !== expected)
      bad.push(`${label}/${f} was edited`);
  }
  if (`v${manifest.version}` !== entry.tag)
    bad.push(
      `${label}/engine.json is ${manifest.version}, the pin ${entry.tag}`,
    );
  if (!bad.length && bundleText(dir).sha256 !== manifest.bundle?.sha256)
    bad.push(`${label}'s Lua bundle does not match the engine's bundle hash`);
  return bad;
}

// Every pin. Returns { problems: [...], said: [...] }.
export function check({ root = here } = {}) {
  const paths = vendorPaths(root);
  const pin = readPin(root);
  const problems = [];
  const said = [];
  if (!pin.tag) return { problems: ["vendor/engine.json pins nothing"], said };
  const newestMm = minorOfTag(pin.tag);

  const engines = [
    ["vendor/engine", paths.newest, pin],
    ...Object.keys(pin.older)
      .sort(compareMinor)
      .reverse()
      .map((mm) => [`vendor/engines/${mm}`, paths.older(mm), pin.older[mm]]),
  ];
  for (const mm of Object.keys(pin.older)) {
    if (!/^\d+\.\d+$/.test(mm) || minorOfTag(pin.older[mm].tag ?? "") !== mm)
      problems.push(`older engine ${mm} is pinned at ${pin.older[mm].tag}`);
    if (compareMinor(mm, newestMm) >= 0)
      problems.push(
        `older engine ${mm} is not older than the newest, ${newestMm}`,
      );
  }
  if (fs.existsSync(paths.olderDir))
    for (const name of fs.readdirSync(paths.olderDir))
      if (!pin.older[name])
        problems.push(
          `vendor/engines/${name} is not pinned in vendor/engine.json`,
        );

  for (const [label, dir, entry] of engines) {
    const bad = checkEngine(dir, entry, label);
    problems.push(...bad);
    if (!bad.length) {
      const n = Object.keys(
        JSON.parse(fs.readFileSync(path.join(dir, "engine.json"), "utf8"))
          .files,
      ).length;
      said.push(
        `${label} matches kubb-engine ${entry.tag} (${entry.commit.slice(0, 7)}, ${n} Lua files and the bundle)`,
      );
    }
  }
  return { problems, said };
}

function main(argv) {
  const [mode, ...args] = argv;
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? undefined : args[i + 1];
  };
  const flag = (name) => args.includes(`--${name}`);
  try {
    if (mode === "sync") {
      for (const line of sync({
        tag: opt("tag"),
        repo: opt("repo"),
        keep: flag("keep"),
        drop: flag("drop"),
      }))
        console.log(line);
      // the names' word lists for the pitch server, from the newest engine
      // (tools/names-words.mjs; `npm run check` holds them to it)
      const words = spawnSync(
        process.execPath,
        [path.join(here, "tools", "names-words.mjs"), "write"],
        { stdio: "inherit" },
      );
      if (words.status !== 0) throw new Error("names-words.json not written");
    } else if (mode === "drop") {
      for (const line of drop({ mm: args[0] })) console.log(line);
    } else if (mode !== "check") {
      console.error(
        "usage: node tools/vendor.mjs sync [--tag vX.Y.Z [--keep | --drop]] [--repo <path>]\n" +
          "       node tools/vendor.mjs drop <major.minor>\n" +
          "       node tools/vendor.mjs check",
      );
      process.exit(2);
    }
  } catch (err) {
    console.error(`vendor: ${err.message}`);
    process.exit(1);
  }
  const { problems, said } = check();
  if (problems.length) {
    console.error(
      "the vendored engines do not match their pins (npm run vendor:sync):\n  " +
        problems.join("\n  "),
    );
    process.exit(1);
  }
  for (const line of said) console.log(line);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2));
