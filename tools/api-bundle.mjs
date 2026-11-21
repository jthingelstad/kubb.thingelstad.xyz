// The api function's code: backend/api/handler.mjs bundled by esbuild to one ESM file,
// index.mjs (the AWS SDK left out: the Node.js runtime has it, Secrets Manager's client
// included), zipped byte for byte the same every time and on every machine (zipOne
// below), so its hash names the bundle. The file is stored, not deflated: Node's zlib
// deflates the same bytes differently on x86-64 (CI) and arm64 (a Mac), which made CI's
// zip hash differently from a local build's. A stored zip is a function of index.mjs
// alone; Lambda takes it as it is. tools/pages-bundle.mjs and tools/reels-bundle.mjs
// package their own way.
//
//   node tools/api-bundle.mjs   write build/api.zip and print its key
//
// With "pitchesStack": true in infra/deployment.json, tools/infra.mjs uploads it as
// s3://<code bucket>/api/<sha256>.zip (the site stack's code bucket, which keeps its old
// name) and passes ApiCodeKey to the pitches stack (infra/pitches.json);
// tools/deploy.mjs updates throwing-wood-api's code when Lambda's CodeSha256 differs.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const API_ENTRY = "backend/api/handler.mjs";

// A zip of one stored file with every field fixed: DOS date 1980-01-01, no
// extra fields, Unix mode 0644.
export function zipOne(name, data) {
  const nameBytes = Buffer.from(name, "utf8");
  const stored = Buffer.from(data);
  const crc = zlib.crc32(data);
  const DOS_TIME = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(10, 4); // version needed: 1.0, stored
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(stored.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, 2.0
  central.writeUInt16LE(10, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(stored.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk
  central.writeUInt16LE(0, 36); // internal attributes
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42); // local header offset

  const localSize = local.length + nameBytes.length + stored.length;
  const centralSize = central.length + nameBytes.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localSize, 16);
  return Buffer.concat([local, nameBytes, stored, central, nameBytes, end]);
}

export async function bundleApi() {
  const result = await build({
    entryPoints: [API_ENTRY],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ["@aws-sdk/*"],
    minify: false,
    legalComments: "none",
    write: false,
    logLevel: "silent",
  });
  const code = Buffer.from(result.outputFiles[0].contents);
  const zip = zipOne("index.mjs", code);
  const hex = createHash("sha256").update(zip).digest("hex");
  return {
    zip,
    key: `api/${hex}.zip`,
    codeSha256: createHash("sha256").update(zip).digest("base64"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundle = await bundleApi();
  await fs.mkdir("build", { recursive: true });
  await fs.writeFile("build/api.zip", bundle.zip);
  console.log(
    `build/api.zip ${bundle.zip.length} bytes, key ${bundle.key}, CodeSha256 ${bundle.codeSha256}`,
  );
}
