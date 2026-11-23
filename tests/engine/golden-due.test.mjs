// When `npm run check` plays the engine's whole golden corpus (tools/golden-due.mjs):
// asked for, or one of its inputs differs from the base, and in doubt it plays. Each
// case is a small git checkout made in a temporary directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GOLDEN_INPUTS,
  GOLDEN_TEST,
  goldenDue,
  isGoldenInput,
} from "../../tools/golden-due.mjs";

const lock = (wasmoon, version = "1.0.0") =>
  JSON.stringify({
    version,
    packages: {
      "": { version },
      "node_modules/wasmoon": { version: wasmoon, integrity: `sha-${wasmoon}` },
    },
  });

// A checkout whose origin/main is its first commit: the engine, a page and the lock.
function checkout(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-golden-due-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...a) =>
    execFileSync(
      "git",
      [
        "-C",
        dir,
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=",
        "-c",
        "commit.gpgsign=false",
        ...a,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  write("vendor/engine/core/world.lua", "return 1\n");
  write("src/site/page.mjs", "export const page = 1;\n");
  write("package-lock.json", lock("1.16.0"));
  const first = commit("first");
  git("update-ref", "refs/remotes/origin/main", first);
  const due = (env = {}, argv = []) => goldenDue({ argv, env, cwd: dir });
  return { dir, git, write, commit, first, due };
}

test("the corpus's own files and the engine's are inputs; a page is not", () => {
  for (const file of [
    GOLDEN_TEST,
    "tests/engine/golden-play.mjs",
    "vendor/engine/core/world.lua",
    "vendor/engines/0.18/version.lua",
    "vendor/engine.json",
    "src/engine/index.js",
    "tools/lua-bundle.mjs",
    ".nvmrc",
  ])
    assert.equal(isGoldenInput(file), true, file);
  for (const file of [
    "src/site/landing.mjs",
    "src/game/hud.js",
    "package.json",
    "package-lock.json",
    "tests/engine/engine.test.mjs",
    "vendored/engine.lua",
  ])
    assert.equal(isGoldenInput(file), false, file);
  // every input is a file or folder this repository has
  for (const p of GOLDEN_INPUTS)
    assert.ok(fs.existsSync(new URL(`../../${p}`, import.meta.url)), p);
});

test("nothing changed, or only a page: the corpus is not played", (t) => {
  const c = checkout(t);
  assert.equal(c.due(), null);
  c.write("src/site/page.mjs", "export const page = 2;\n");
  assert.equal(c.due(), null, "an uncommitted page");
  c.commit("a page");
  c.write("README.md", "new\n");
  assert.equal(c.due(), null, "a committed page and a new file");
});

test("a change to the engine plays it: committed, uncommitted or a new file", (t) => {
  const c = checkout(t);
  c.write("vendor/engine/core/world.lua", "return 2\n");
  assert.equal(c.due(), "vendor/engine/core/world.lua changed");
  c.commit("the engine");
  assert.equal(c.due(), "vendor/engine/core/world.lua changed");
  const d = checkout(t);
  d.write("vendor/engines/0.18/version.lua", "return 0\n");
  assert.equal(d.due(), "vendor/engines/0.18/version.lua changed");
});

test("wasmoon in the lock plays it; the site's own version there does not", (t) => {
  const c = checkout(t);
  c.write("package-lock.json", lock("1.16.0", "1.0.1"));
  assert.equal(c.due(), null);
  c.write("package-lock.json", lock("1.16.1", "1.0.1"));
  assert.equal(c.due(), "wasmoon changed in package-lock.json");
});

test("asked for, it is played whatever changed", (t) => {
  const c = checkout(t);
  assert.equal(c.due({ KUBB_GOLDEN: "1" }), "asked for");
  assert.equal(c.due({}, ["node", "tools/check.mjs", "--golden"]), "asked for");
  assert.equal(c.due({ KUBB_GOLDEN: "" }), null);
});

test("a named base is the commit before a push to main", (t) => {
  const c = checkout(t);
  c.write("vendor/engine/core/world.lua", "return 2\n");
  const engine = c.commit("the engine");
  c.git("update-ref", "refs/remotes/origin/main", engine);
  c.write("src/site/page.mjs", "export const page = 2;\n");
  const page = c.commit("a page");
  c.git("update-ref", "refs/remotes/origin/main", page);
  // main is at HEAD, so only the named base says what the push brought
  assert.equal(c.due(), null);
  assert.equal(c.due({ KUBB_GOLDEN_BASE: engine }), null);
  assert.equal(
    c.due({ KUBB_GOLDEN_BASE: c.first }),
    "vendor/engine/core/world.lua changed",
  );
});

test("in doubt it is played: a base not in the checkout, or no origin/main", (t) => {
  const c = checkout(t);
  const zeros = "0".repeat(40);
  assert.equal(
    c.due({ KUBB_GOLDEN_BASE: zeros }),
    `the base ${zeros} is not in this checkout`,
  );
  c.git("update-ref", "-d", "refs/remotes/origin/main");
  assert.equal(c.due(), "no origin/main to compare with");
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-golden-due-"));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  assert.equal(
    goldenDue({ argv: [], env: {}, cwd: bare }),
    "no origin/main to compare with",
  );
});
