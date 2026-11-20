// The reel function's code and its ffmpeg layer (docs/REEL.md, docs/REEL-RUNBOOK.md).
//
//   node tools/reels-bundle.mjs   write build/reels.zip and build/reels-ffmpeg.zip, and
//                                 print the keys they would be uploaded as
//
// The function's package: backend/reels/handler.mjs bundled by esbuild to one ESM file,
// index.mjs (the AWS SDK left out: the runtime has it, as the rooms function's does),
// and beside it package.json (type: module), one Lua bundle per engine the site carries
// with its version (engines/<major.minor>.json, { engine, sources }: tools/lua-bundle.mjs
// carriedEngines, newest first; docs/ENGINES.md), the two faces, the nine knock takes, wasmoon (its JavaScript and
// glue.wasm: it finds the wasm beside itself) and @napi-rs/canvas (its JavaScript from
// node_modules and its Linux arm64 binary from npm, pinned in infra/reels-pins.json by
// version and integrity). Named by a hash of its contents like the pages package:
// reels/<sha256>.zip in the code bucket.
//
// The layer: the static ffmpeg pinned in infra/reels-pins.json by sha256, as bin/ffmpeg
// (mode 0755, so /opt/bin/ffmpeg) with its GPL text and readme: reels/ffmpeg-<sha256 of
// the download>.zip.
//
// Downloads are cached in build/reels-cache/ and checked against the pins every time;
// each lands in a new empty directory and nothing in them is run here. tools/infra.mjs
// uploads both when it applies the site stack; this tool only builds them.
import { build } from "esbuild";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { bundleLua, carriedEngines } from "./lua-bundle.mjs";
import { contentHash, zipFiles } from "./pages-bundle.mjs";

export const REELS_ENTRY = "backend/reels/handler.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(root, "build", "reels-cache");
// Lambda's limit for a function and its layers, unzipped.
export const UNZIPPED_LIMIT = 250 * 1024 * 1024;

export const pins = () =>
  JSON.parse(
    fs.readFileSync(path.join(root, "infra", "reels-pins.json"), "utf8"),
  );

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const integrityOf = (data) =>
  `sha512-${createHash("sha512").update(data).digest("base64")}`;

// The pinned file's bytes, from the cache or downloaded, and always checked.
async function fetchPinned({ urls, name, check }) {
  const kept = path.join(CACHE, name);
  if (fs.existsSync(kept)) {
    const data = fs.readFileSync(kept);
    if (check(data)) return data;
    fs.rmSync(kept);
  }
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = Buffer.from(await res.arrayBuffer());
    if (!check(data))
      throw new Error(`${url}: not the pinned file (checksum differs)`);
    // a new empty directory for each download
    const dir = path.join(CACHE, `dl-${randomBytes(6).toString("hex")}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, path.basename(name)), data);
    fs.renameSync(path.join(dir, path.basename(name)), kept);
    fs.rmSync(dir, { recursive: true, force: true });
    return data;
  }
  throw new Error(`${name}: no source answered (${urls.join(", ")})`);
}

// The regular files in a .tgz (ustar, as npm packs), name -> bytes. Read in memory:
// nothing from the archive is written to disk or run.
export function readTgz(tgz) {
  const tar = zlib.gunzipSync(tgz);
  const out = new Map();
  let p = 0;
  let longName = null;
  while (p + 512 <= tar.length) {
    const head = tar.subarray(p, p + 512);
    if (head.every((b) => b === 0)) break;
    const field = (a, n) =>
      head
        .subarray(a, a + n)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    let name = field(0, 100);
    const prefix = field(345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(head[156] || 48);
    const body = tar.subarray(p + 512, p + 512 + size);
    if (type === "L") longName = body.toString("utf8").replace(/\0.*$/s, "");
    else {
      if (longName) name = longName;
      longName = null;
      if (type === "0" || type === "\0") out.set(name, Buffer.from(body));
    }
    p += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function canvasBinary() {
  const pin = pins().canvas;
  const tgz = await fetchPinned({
    urls: [pin.url],
    name: `canvas-${pin.version}.tgz`,
    check: (d) => integrityOf(d) === pin.integrity,
  });
  const files = readTgz(tgz);
  const node = files.get("package/skia.linux-arm64-gnu.node");
  const pkg = files.get("package/package.json");
  if (!node || !pkg)
    throw new Error("canvas tarball: binary or package.json missing");
  if (JSON.parse(pkg).version !== pin.version)
    throw new Error("canvas tarball: another version");
  return { node, pkg };
}

const read = (p) => fs.readFileSync(path.join(root, p));

// REEL_ENGINES for the package bundleReels makes: the carried major.minors, newest
// first, "0.7" or "0.8,0.7" (tools/infra.mjs passes it to both stacks).
export const reelEngines = (vendorDir) =>
  carriedEngines(vendorDir)
    .map((e) => e.mm)
    .join(",");

// The package's engines: engines/<mm>.json per carried engine, { engine, sources }.
// The same bytes for the same vendored engines (bundleLua sorts its keys).
export function engineEntries(vendorDir) {
  return carriedEngines(vendorDir).map(({ mm, version, dir }) => ({
    name: `engines/${mm}.json`,
    data: Buffer.from(
      JSON.stringify({ engine: version, sources: bundleLua(dir) }),
    ),
  }));
}

// The function's package. `binary` is canvasBinary()'s (the tests pass a stand-in);
// `vendorDir` another vendor/ folder (the tests' two engines).
export async function bundleReels({ binary, vendorDir } = {}) {
  binary ??= await canvasBinary();
  const result = await build({
    entryPoints: [path.join(root, REELS_ENTRY)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: false,
    legalComments: "none",
    write: false,
    logLevel: "silent",
    external: ["@aws-sdk/*", "@napi-rs/canvas", "wasmoon"],
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  const canvasDir = "node_modules/@napi-rs/canvas";
  const canvasPkg = JSON.parse(read(`${canvasDir}/package.json`));
  if (canvasPkg.version !== pins().canvas.version)
    throw new Error(
      `@napi-rs/canvas ${canvasPkg.version} in node_modules, ${pins().canvas.version} pinned`,
    );
  const entries = [
    { name: "index.mjs", data: Buffer.from(result.outputFiles[0].contents) },
    { name: "package.json", data: Buffer.from('{"type":"module"}\n') },
    ...engineEntries(vendorDir),
    {
      name: "fonts/LondrinaSolid-Black.ttf",
      data: read("backend/pages/LondrinaSolid-Black.ttf"),
    },
    {
      name: "fonts/inter-latin-wght-normal.woff2",
      data: read("public/shared/fonts/inter-latin-wght-normal.woff2"),
    },
    ...fs
      .readdirSync(path.join(root, "public/sounds"))
      .filter((f) => /^knock-\d+\.wav$/.test(f))
      .map((f) => ({ name: `sounds/${f}`, data: read(`public/sounds/${f}`) })),
    ...["package.json", "dist/index.js", "dist/glue.wasm", "LICENSE"].map(
      (f) => ({
        name: `node_modules/wasmoon/${f}`,
        data: read(`node_modules/wasmoon/${f}`),
      }),
    ),
    ...[
      ...canvasPkg.files.filter((f) => f.endsWith(".js")),
      "package.json",
      "LICENSE",
    ].map((f) => ({
      name: `${canvasDir}/${f}`,
      data: read(`${canvasDir}/${f}`),
    })),
    {
      name: "node_modules/@napi-rs/canvas-linux-arm64-gnu/package.json",
      data: binary.pkg,
    },
    {
      name: "node_modules/@napi-rs/canvas-linux-arm64-gnu/skia.linux-arm64-gnu.node",
      data: binary.node,
    },
  ];
  return {
    zip: zipFiles(entries),
    key: `reels/${contentHash(entries)}.zip`,
    unzipped: entries.reduce((n, e) => n + e.data.length, 0),
  };
}

// The ffmpeg layer. tar unpacks the three pinned members into a new empty directory;
// the files are only read back, never run here.
export async function ffmpegLayer() {
  const pin = pins().ffmpeg;
  await fetchPinned({
    urls: [pin.url, pin.fallbackUrl],
    name: `ffmpeg-${pin.version}-arm64-static.tar.xz`,
    check: (d) => sha256(d) === pin.sha256,
  });
  const top = `ffmpeg-${pin.version}-arm64-static`;
  const dir = path.join(CACHE, `x-${randomBytes(6).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const archive = path.join(
      CACHE,
      `ffmpeg-${pin.version}-arm64-static.tar.xz`,
    );
    const r = spawnSync(
      "tar",
      ["-xJf", archive, "-C", dir, ...pin.members.map((m) => `${top}/${m}`)],
      { stdio: "inherit" },
    );
    if (r.status !== 0)
      throw new Error("tar could not unpack the ffmpeg build");
    const entries = pin.members.map((m) => ({
      name: m === "ffmpeg" ? "bin/ffmpeg" : `licenses/ffmpeg/${m}`,
      data: fs.readFileSync(path.join(dir, top, m)),
      mode: m === "ffmpeg" ? 0o755 : 0o644,
    }));
    return {
      zip: zipFiles(entries),
      key: `reels/ffmpeg-${pin.sha256}.zip`,
      unzipped: entries.reduce((n, e) => n + e.data.length, 0),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fn = await bundleReels();
  const layer = await ffmpegLayer();
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  fs.writeFileSync(path.join(root, "build/reels.zip"), fn.zip);
  fs.writeFileSync(path.join(root, "build/reels-ffmpeg.zip"), layer.zip);
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  console.log(
    `build/reels.zip ${mb(fn.zip.length)} (${mb(fn.unzipped)} unzipped), key ${fn.key}`,
  );
  console.log(
    `build/reels-ffmpeg.zip ${mb(layer.zip.length)} (${mb(layer.unzipped)} unzipped), key ${layer.key}`,
  );
  const total = fn.unzipped + layer.unzipped;
  console.log(
    `function and layer unzipped: ${mb(total)} of Lambda's ${mb(UNZIPPED_LIMIT)}`,
  );
  if (total > UNZIPPED_LIMIT) process.exit(1);
}
