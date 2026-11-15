// The game core is the Playdate game's pure Lua (playdate-kubb, source/core),
// vendored unchanged. Never edit vendor/core by hand.
//   node tools/vendor.mjs sync [path-to-playdate-kubb]   copy it in and record the commit and hashes
//   node tools/vendor.mjs check                          fail if a vendored file differs from the record
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "vendor", "core");
const manifestPath = path.join(root, "vendor", "core.json");
const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const luaFiles = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".lua"))
    .sort();

const mode = process.argv[2];
if (mode === "sync") {
  const repo = path.resolve(
    process.argv[3] ?? path.join(root, "..", "..", "playdate-kubb"),
  );
  const src = path.join(repo, "source", "core");
  const dirty = execFileSync(
    "git",
    ["-C", repo, "status", "--porcelain", "--", "source/core"],
    { encoding: "utf8" },
  ).trim();
  if (dirty) throw new Error(`source/core has uncommitted changes in ${repo}`);
  const commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const files = {};
  for (const f of luaFiles(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
    files[f] = sha(path.join(dest, f));
  }
  fs.copyFileSync(
    path.join(repo, "LICENSE"),
    path.join(root, "vendor", "LICENSE-playdate-kubb"),
  );
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      { source: "playdate-kubb source/core", commit, files },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `vendored ${Object.keys(files).length} files at ${commit.slice(0, 7)}`,
  );
} else if (mode === "check") {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const have = luaFiles(dest);
  const want = Object.keys(manifest.files).sort();
  const bad = [];
  if (have.join() !== want.join())
    bad.push("file list differs from vendor/core.json");
  for (const f of want)
    if (
      fs.existsSync(path.join(dest, f)) &&
      sha(path.join(dest, f)) !== manifest.files[f]
    )
      bad.push(`${f} was edited`);
  if (bad.length) {
    console.error(
      "vendor/core does not match its record:\n  " + bad.join("\n  "),
    );
    process.exit(1);
  }
  console.log(
    `vendor/core matches ${manifest.commit.slice(0, 7)} (${want.length} files)`,
  );
} else {
  console.error("usage: node tools/vendor.mjs sync [repo] | check");
  process.exit(2);
}
