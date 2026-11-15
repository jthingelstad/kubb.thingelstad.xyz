// npm run check: everything CI runs before a merge, in order, stopping at the
// first failure.
//
//   1. vendor:check   vendor/core is playdate-kubb's core byte for byte
//   2. shared:check   the vendored shared type and sites.json are current
//   3. infra/site.json carries infra/viewer-request.js and the CSP
//   4. node --test    every *.test.mjs under tests/
//   5. tests/lua      tests/lua/run.lua under Lua 5.4, when both exist
//   6. build          dist/
//   7. validate:site  the built site and the repository's Markdown
//
// Lua: LUA=<binary> picks the interpreter; otherwise Homebrew's lua@5.4, then
// lua5.4 on the PATH (CI installs it with apt). Without one the Lua tests are
// skipped with a notice, never silently.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(label, command, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n${label} failed`);
    process.exit(result.status || 1);
  }
}
const node = (label, ...args) => run(label, process.execPath, args);

function testFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".test.mjs"))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}
function lua() {
  const candidates = [
    process.env.LUA,
    "/opt/homebrew/opt/lua@5.4/bin/lua5.4",
    "lua5.4",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-v"], { encoding: "utf8" });
    if (probe.status === 0 && /Lua 5\.4/.test(probe.stdout + probe.stderr))
      return candidate;
  }
  return null;
}

if (fs.existsSync("tools/vendor.mjs"))
  node("vendor:check", "tools/vendor.mjs", "check");
node("shared:check", "tools/shared.mjs", "check");
node("infra/site.json", "tools/site-template.mjs", "check");
const tests = testFiles("tests");
if (tests.length)
  node(`node --test (${tests.length} files)`, "--test", ...tests);
if (fs.existsSync("tests/lua/run.lua")) {
  const binary = lua();
  if (binary) run("tests/lua", binary, ["tests/lua/run.lua"]);
  else
    console.log(
      "\n> tests/lua SKIPPED: no Lua 5.4 (brew install lua@5.4, or apt install lua5.4)",
    );
}
node("build", "tools/build.mjs");
node("validate:site", "tools/validate-site.mjs");
console.log("\nAll checks passed");
