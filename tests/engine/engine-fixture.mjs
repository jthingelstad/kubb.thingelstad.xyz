// A stand-in kubb-engine checkout for tests of carrying more than one engine: a git
// repository in a temporary directory, made at test time from vendor/engine/, with
// a tag for each version asked for. A version other than the vendored one is the
// same Lua with only its version string changed (version.lua and engine.json, the
// manifest's hashes made again), so it plays exactly as the vendored engine does
// but names itself another engine. Nothing under vendor/ is ever written.
//
//   const repo = makeEngineRepo(["0.7.4", "0.7.5", "0.8.0"]);
//   repo.dir      the checkout, for tools/vendor.mjs sync --repo
//   repo.clean()  removes it
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleText } from "../../tools/lua-bundle.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const vendored = path.join(root, "vendor", "engine");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The vendored engine's files laid out as kubb-engine keeps them, at a version.
export function writeEngineTree(dir, version) {
  const from = JSON.parse(
    fs.readFileSync(path.join(vendored, "engine.json"), "utf8"),
  );
  const copy = (src, to) => {
    const file = path.join(dir, to);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(vendored, src), file);
  };
  for (const f of Object.keys(from.files)) copy(f, f);
  copy("LICENSE", "LICENSE");
  copy("golden/drive.lua", "tests/golden/drive.lua");
  copy("golden/hashes.json", "tests/golden/hashes.json");
  const versionFile = path.join(dir, "version.lua");
  const lua = fs.readFileSync(versionFile, "utf8");
  const changed = lua.replace(
    /local VERSION <const> = "[^"]+"/,
    `local VERSION <const> = "${version}"`,
  );
  if (changed === lua && version !== from.version)
    throw new Error("version.lua has no VERSION line to change");
  fs.writeFileSync(versionFile, changed);
  const files = { ...from.files, "version.lua": sha(Buffer.from(changed)) };
  const manifest = { ...from, version, files };
  // The bundle hash is over the sources as the bundle takes them.
  manifest.bundle = { ...from.bundle, sha256: bundleText(dir).sha256 };
  fs.writeFileSync(
    path.join(dir, "engine.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

export function makeEngineRepo(versions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-engine-fixture-"));
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
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  git("init", "-q");
  for (const version of versions) {
    for (const f of fs.readdirSync(dir))
      if (f !== ".git") fs.rmSync(path.join(dir, f), { recursive: true });
    writeEngineTree(dir, version);
    git("add", "-A");
    git("commit", "-q", "-m", `v${version}`);
    git("tag", `v${version}`);
  }
  return { dir, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// An empty checkout of the web's vendor/ to vendor into: a temporary root.
export function makeVendorRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-vendor-fixture-"));
  fs.mkdirSync(path.join(dir, "vendor"));
  return { dir, clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
