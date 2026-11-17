// The pages function's code (backend/pages, docs/HOSTING.md "Pitch pages"):
// backend/pages/main.mjs bundled by esbuild to one ESM file, index.js, with the AWS
// SDK inside it, and beside it package.json (type: module), resvg's WebAssembly
// and the display face. Zipped the same way every time, and named by a hash of
// its contents (contentHash).
//
//   node tools/pages-bundle.mjs   write build/pages.zip and print its key
//
// tools/infra.mjs uploads it as s3://<code bucket>/pages/<sha256>.zip and passes
// the key to the site stack, whose web function revision is that package.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const PAGES_ENTRY = "backend/pages/main.mjs";

// A zip of the entries in name order, every field fixed: DOS date 1980-01-01, no
// extra fields, Unix mode 0644.
export function zipFiles(entries) {
  const files = [...entries].sort((a, b) => (a.name < b.name ? -1 : 1));
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1;
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const file = Buffer.from(name, "utf8");
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(file.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, file, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, so the mode holds
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(file.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, file);
    offset += head.length + file.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

// The package's name: a hash of what is in it (each name, length and bytes, in
// name order), not of the zip, whose deflated bytes vary with the zlib of the Node
// that made it (this Mac's against CI's), so tools/deploy.mjs on CI and
// npm run infra:apply here agree on which package is live.
export function contentHash(entries) {
  const hash = createHash("sha256");
  for (const { name, data } of [...entries].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  ))
    hash.update(`${name}\0${data.length}\0`).update(data);
  return hash.digest("hex");
}

export async function bundlePages() {
  const result = await build({
    entryPoints: [PAGES_ENTRY],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    minify: false,
    legalComments: "none",
    write: false,
    logLevel: "silent",
    // the SDK's CommonJS parts ask for require
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  const require = createRequire(import.meta.url);
  const entries = [
    { name: "index.js", data: Buffer.from(result.outputFiles[0].contents) },
    { name: "package.json", data: Buffer.from('{"type":"module"}\n') },
    {
      name: "resvg.wasm",
      data: await fs.readFile(
        require.resolve("@resvg/resvg-wasm/index_bg.wasm"),
      ),
    },
    {
      name: "LondrinaSolid-Black.ttf",
      data: await fs.readFile("backend/pages/LondrinaSolid-Black.ttf"),
    },
  ];
  return { zip: zipFiles(entries), key: `pages/${contentHash(entries)}.zip` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundle = await bundlePages();
  await fs.mkdir("build", { recursive: true });
  await fs.writeFile("build/pages.zip", bundle.zip);
  console.log(`build/pages.zip ${bundle.zip.length} bytes, key ${bundle.key}`);
}
