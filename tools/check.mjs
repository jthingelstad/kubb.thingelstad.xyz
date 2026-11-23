// npm run check: everything CI runs before a merge, in order, stopping at the
// first failure.
//
//   1. vendor:check   vendor/engine is kubb-engine's tagged release byte for byte,
//                     and the pitch server's names-words.json is its names.words
//   2. shared:check   the vendored shared type and sites.json are current
//   3. infra/site.json carries infra/viewer-request.js and the CSP
//   4. node --test    every *.test.mjs under tests/. The engine's whole golden
//                     corpus under wasmoon (tests/engine/golden.test.mjs, minutes)
//                     is among them only when the engine, wasmoon or their host
//                     changed, or with --golden (tools/golden-due.mjs)
//   5. build          dist/
//   6. validate:site  the built site and the repository's Markdown
//
// The engine's Lua tests are the engine's (kubb-engine, make test); this
// repository has no Lua of its own.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GOLDEN_TEST, goldenDue } from "./golden-due.mjs";

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
node("vendor:check", "tools/vendor.mjs", "check");
node("names-words", "tools/names-words.mjs", "check");
node("shared:check", "tools/shared.mjs", "check");
node("infra/site.json", "tools/site-template.mjs", "check");
const golden = goldenDue();
console.log(
  golden
    ? `\ngolden corpus: played (${golden})`
    : "\ngolden corpus: not played, nothing it depends on changed (npm run golden plays it)",
);
const tests = testFiles("tests").filter(
  (f) => golden || f !== path.normalize(GOLDEN_TEST),
);
if (tests.length)
  node(`node --test (${tests.length} files)`, "--test", ...tests);
node("build", "tools/build.mjs");
node("validate:site", "tools/validate-site.mjs");
console.log("\nAll checks passed");
