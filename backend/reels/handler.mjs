// The reel function on AWS (kubb-xyz-site-reels): one render a call, invoked
// asynchronously by the rooms function with { room, v, tag }, or one check of a shared
// match against the computer, invoked synchronously with { check: g } (docs/REEL.md,
// docs/ROOMS.md sections 12 and 13). The work is job.mjs and check.mjs; this file is the
// adapters and the package's own files. A check reads and writes nothing: it answers.
//
//   TABLE         the rooms table: GetItem on the kept replay, UpdateItem on the reel item
//   SITE_BUCKET   the site bucket: PutObject under reels/
//   REEL_ENGINES  the engine major.minors this function renders ("0.7")
//   FFMPEG        the encoder (/opt/bin/ffmpeg, from the function's layer)
//
// tools/reels-bundle.mjs packages this with the engine's Lua sources, the faces, the
// knock takes, wasmoon and @napi-rs/canvas (its linux-arm64 binary) beside it.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { reelStore, s3Uploader } from "./aws.mjs";
import { checkShare } from "./check.mjs";
import { runReel } from "./job.mjs";
import { renderReel } from "./render.mjs";
import { parseEngines } from "./tag.mjs";

const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

// The package's files: the engine and its version, the faces, the knock takes.
export function packageAssets() {
  const lua = JSON.parse(fs.readFileSync(here("lua-sources.json"), "utf8"));
  return {
    sources: lua.sources,
    engine: lua.engine,
    assets: {
      display: here("fonts/LondrinaSolid-Black.ttf"),
      label: here("fonts/inter-latin-wght-normal.woff2"),
      sounds: here("sounds"),
    },
  };
}

// A check, answered to the rooms function that waits for it. Logged: the step that
// failed, the engine and the size, never a name.
export async function checkHandler(event, { sources, engine, engines }) {
  const t0 = Date.now();
  const out = await checkShare({ g: event.check, sources, engine, engines });
  console.log(
    JSON.stringify({
      check: out.ok ? "ok" : out.why,
      step: out.ok ? null : out.step,
      engine,
      played:
        typeof event.check?.engine === "string"
          ? event.check.engine.slice(0, 64)
          : null,
      actions: Array.isArray(event.check?.log) ? event.check.log.length : null,
      ms: Date.now() - t0,
    }),
  );
  return out;
}

let assets = null;
let ready = null;
export async function handler(event) {
  if (event && typeof event === "object" && "check" in event) {
    assets ??= packageAssets();
    return checkHandler(event, {
      sources: assets.sources,
      engine: assets.engine,
      engines: parseEngines(process.env.REEL_ENGINES),
    });
  }
  ready ??= (() => {
    assets ??= packageAssets();
    const { sources, engine } = assets;
    return {
      engine,
      store: reelStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        table: process.env.TABLE,
      }),
      upload: s3Uploader({
        s3: new S3Client({}),
        bucket: process.env.SITE_BUCKET,
      }),
      render: ({ replay, code, out }) =>
        renderReel({
          replay,
          code,
          out,
          sources,
          assets: assets.assets,
          log: (line) => console.log(line),
        }),
    };
  })();
  return runReel({
    input: event,
    engines: parseEngines(process.env.REEL_ENGINES),
    ...ready,
  });
}
