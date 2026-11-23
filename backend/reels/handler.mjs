// The reel function on AWS (kubb-xyz-site-reels): one render a call, invoked
// asynchronously by the api function with { room, v, tag }, or one check of a shared
// match against the computer, invoked synchronously with { check: g } (docs/REEL.md,
// backend/api/API.md). The work is job.mjs and check.mjs; this file is the
// adapters and the package's own files. A check reads and writes nothing: it answers.
//
//   TABLE         the pitches table: GetItem on the kept replay, UpdateItem on the reel item
//   SITE_BUCKET   the site bucket: PutObject under reels/
//   REEL_ENGINES  the engine major.minors this function renders ("0.7", "0.8,0.7")
//   FFMPEG        the encoder (/opt/bin/ffmpeg, from the function's layer)
//
// tools/reels-bundle.mjs packages this with one Lua bundle per engine the site carries
// (engines/<major.minor>.json: { engine, sources }), the faces, the knock takes,
// wasmoon and @napi-rs/canvas (its linux-arm64 binary) beside it. A match is rendered
// or checked on its own engine (docs/ENGINES.md); an engine's bundle is read the first
// time a match of it comes, and kept.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { logLine } from "../log.mjs";
import { reelStore, s3Uploader } from "./aws.mjs";
import { carriedLookup } from "./carried.mjs";
import { checkShare } from "./check.mjs";
import { runReel } from "./job.mjs";
import { renderReel } from "./render.mjs";
import { majorMinor, parseEngines } from "./tag.mjs";

const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

// The engines in a package's engines/ folder: mm -> { engine, sources } | null, each
// read the first time it is asked for.
export function packageEngines(dir = here("engines")) {
  const names = new Set(
    fs
      .readdirSync(dir)
      .map((f) => /^(\d{1,4}\.\d{1,4})\.json$/.exec(f)?.[1])
      .filter(Boolean),
  );
  const read = new Map();
  const carried = (mm) => {
    if (!names.has(mm)) return null;
    if (!read.has(mm)) {
      const lua = JSON.parse(fs.readFileSync(`${dir}/${mm}.json`, "utf8"));
      read.set(
        mm,
        majorMinor(lua.engine) === mm
          ? { engine: lua.engine, sources: lua.sources }
          : null,
      );
    }
    return read.get(mm);
  };
  carried.list = () => [...names];
  return carried;
}

// The package's files: its engines, the faces, the knock takes.
export function packageAssets() {
  return {
    carried: packageEngines(),
    assets: {
      display: here("fonts/LondrinaSolid-Black.ttf"),
      label: here("fonts/inter-latin-wght-normal.woff2"),
      sounds: here("sounds"),
    },
  };
}

// A check, answered to the api function that waits for it. Logged: the step that
// failed, the engine and the size, never a name.
export async function checkHandler(
  event,
  { carried, sources, engine, engines },
) {
  const t0 = Date.now();
  const out = await checkShare({
    g: event.check,
    carried,
    sources,
    engine,
    engines,
  });
  logLine({
    event: "check",
    check: out.ok ? "ok" : out.why,
    step: out.ok ? null : out.step,
    // the engine it was checked on, or null when it was none this function carries
    engine:
      carriedLookup({ carried, engine, sources })(
        majorMinor(event.check?.engine),
      )?.engine ?? null,
    played:
      typeof event.check?.engine === "string"
        ? event.check.engine.slice(0, 64)
        : null,
    actions: Array.isArray(event.check?.log) ? event.check.log.length : null,
    ms: Date.now() - t0,
  });
  return out;
}

let assets = null;
let ready = null;
export async function handler(event) {
  if (event && typeof event === "object" && "check" in event) {
    assets ??= packageAssets();
    return checkHandler(event, {
      carried: assets.carried,
      engines: parseEngines(process.env.REEL_ENGINES),
    });
  }
  ready ??= (() => {
    assets ??= packageAssets();
    return {
      carried: assets.carried,
      store: reelStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        table: process.env.TABLE,
      }),
      upload: s3Uploader({
        s3: new S3Client({}),
        bucket: process.env.SITE_BUCKET,
      }),
      render: ({ replay, code, out, sources }) =>
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
