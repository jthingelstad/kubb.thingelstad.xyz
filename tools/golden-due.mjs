// Whether `npm run check` plays the engine's whole golden corpus
// (tests/engine/golden.test.mjs). It takes minutes under wasmoon and can only come out
// differently when one of its inputs changes, so check plays it when one has, or when
// it is asked for, and says which. In doubt it plays.
//
//   asked for    npm run check -- --golden, or KUBB_GOLDEN=1 (the workflow's
//                "Run workflow" box sets it)
//   an input     a file under GOLDEN_INPUTS, or the wasmoon package-lock.json
//                resolves, differs from the base
//   the base     KUBB_GOLDEN_BASE when set (CI on main: the commit before the push),
//                else where this checkout left origin/main. Changes not yet
//                committed count.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const GOLDEN_TEST = "tests/engine/golden.test.mjs";

// A path ending in "/" is everything under it.
export const GOLDEN_INPUTS = [
  "vendor/", // the engines the site carries, and their corpora
  "src/engine/", // the host that loads an engine and calls it
  "tools/lua-bundle.mjs", // which Lua an engine is made of
  "tests/engine/golden.test.mjs",
  "tests/engine/golden-play.mjs",
  "tools/golden-due.mjs", // a change to this rule proves itself
  "tools/check.mjs",
  ".github/workflows/check.yml",
  ".nvmrc", // the Node whose V8 runs the WebAssembly
];

export const isGoldenInput = (file) =>
  GOLDEN_INPUTS.some((p) =>
    p.endsWith("/") ? file.startsWith(p) : file === p,
  );

const wasmoonOf = (lockText) =>
  JSON.stringify(JSON.parse(lockText).packages["node_modules/wasmoon"]);

// Why the corpus is played, or null when nothing it depends on has changed.
export function goldenDue({
  argv = process.argv,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  if (argv.includes("--golden") || env.KUBB_GOLDEN === "1") return "asked for";
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return r.status === 0 ? r.stdout : null;
  };
  const named = env.KUBB_GOLDEN_BASE;
  const base = (
    named
      ? git("rev-parse", "--verify", "--quiet", `${named}^{commit}`)
      : git("merge-base", "origin/main", "HEAD")
  )?.trim();
  if (!base)
    return named
      ? `the base ${named} is not in this checkout`
      : "no origin/main to compare with";
  const changed = git("diff", "--name-only", base);
  const untracked = git("ls-files", "--others", "--exclude-standard");
  if (changed === null || untracked === null)
    return "git could not list what changed";
  const hit = `${changed}\n${untracked}`
    .split("\n")
    .filter(Boolean)
    .find(isGoldenInput);
  if (hit) return `${hit} changed`;
  try {
    const before = git("show", `${base}:package-lock.json`);
    const now = fs.readFileSync(path.join(cwd, "package-lock.json"), "utf8");
    if (before === null || wasmoonOf(before) !== wasmoonOf(now))
      return "wasmoon changed in package-lock.json";
  } catch {
    return "package-lock.json could not be read";
  }
  return null;
}
