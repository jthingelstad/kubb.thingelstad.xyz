// The api function's code: backend/api/handler.mjs bundled by esbuild to one ESM file,
// index.mjs (the AWS SDK left out: the Node.js runtime has it, Secrets Manager's client
// included), zipped the same way as the rooms function's (tools/rooms-bundle.mjs
// zipOne: stored, every field fixed), so its hash names the bundle.
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
import { zipOne } from "./rooms-bundle.mjs";

export const API_ENTRY = "backend/api/handler.mjs";

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
