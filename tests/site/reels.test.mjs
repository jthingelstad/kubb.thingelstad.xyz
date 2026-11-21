// The highlight reel's hosting: the paths CloudFront serves, the deploy that never
// touches them, the templates' function, role and permission, the pins and the
// package (docs/REEL.md, docs/REEL-RUNBOOK.md).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { loadViewerRequest, cloudfrontRequest } from "../../tools/preview.mjs";
import { prepareObject } from "../../tools/delivery-plan.mjs";
import { bundleReels, readTgz } from "../../tools/reels-bundle.mjs";
import {
  majorMinor,
  parseEngines,
  reelKeys,
  reelTag,
  tagEngine,
  REEL_TAG,
} from "../../backend/reels/tag.mjs";

const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const viewer = await loadViewerRequest();

test("a reel's path goes to the bucket untouched", () => {
  for (const uri of [
    "/reels/abcd2345/7-r1-0.7/wide.mp4",
    "/reels/abcd2345/7-r1-0.7/tall.mp4",
    "/reels/abcd2345/7-r1-0.7/edit.json",
  ]) {
    const out = viewer({
      request: cloudfrontRequest(new URL(uri, "https://throwingwood.com")),
    });
    assert.equal(out.statusCode, undefined, uri);
    assert.equal(out.uri, uri);
  }
});

test("a deploy never writes under reels/", () => {
  assert.throws(
    () => prepareObject("reels/abcd2345/7-r1-0.7/wide.mp4", Buffer.alloc(1)),
    /reel function/,
  );
});

test("tags, keys and engines", () => {
  assert.equal(majorMinor("0.7.1"), "0.7");
  assert.equal(majorMinor("10.12"), "10.12");
  assert.equal(majorMinor("x"), null);
  assert.deepEqual(parseEngines("0.7, 0.8.2,junk"), ["0.7", "0.8"]);
  assert.deepEqual(parseEngines(undefined), []);
  assert.equal(reelTag("0.7"), "r1-0.7");
  assert.equal(tagEngine("r1-0.7"), "0.7");
  assert.equal(tagEngine("r1-0.7/../x"), null);
  assert.ok(!REEL_TAG.test("r1-0.7/x"));
  assert.deepEqual(reelKeys("abcd2345", 7, "r1-0.7"), {
    dir: "reels/abcd2345/7-r1-0.7/",
    tall: "reels/abcd2345/7-r1-0.7/tall.mp4",
    wide: "reels/abcd2345/7-r1-0.7/wide.mp4",
    edit: "reels/abcd2345/7-r1-0.7/edit.json",
  });
});

test("the reel function: arm64 Node 24, 3008 MB, 5 minutes, two at a time, one retry", async () => {
  const R = (await json("infra/site.json")).Resources;
  const fn = R.ReelsFunction.Properties;
  assert.equal(fn.Runtime, "nodejs24.x");
  assert.deepEqual(fn.Architectures, ["arm64"]);
  assert.equal(fn.MemorySize, 3008);
  assert.equal(fn.Timeout, 300);
  assert.equal(fn.ReservedConcurrentExecutions, 2);
  assert.deepEqual(fn.Layers, [{ Ref: "ReelsLayer" }]);
  assert.equal(fn.Environment.Variables.FFMPEG, "/opt/bin/ffmpeg");
  assert.equal(R.ReelsInvokeConfig.Properties.MaximumRetryAttempts, 1);
  assert.equal(R.ReelsLogs.Properties.RetentionInDays, 30);
  assert.equal(R.ReelsLayer.Properties.LicenseInfo, "GPL-3.0-or-later");
  for (const name of [
    "ReelsLogs",
    "ReelsRole",
    "ReelsLayer",
    "ReelsFunction",
    "ReelsInvokeConfig",
  ])
    assert.equal(R[name].Condition, "HasReels", name);
  const expire = R.SiteBucket.Properties.LifecycleConfiguration.Rules.find(
    (r) => r.Id === "ExpireReels",
  );
  assert.deepEqual(
    { prefix: expire.Prefix, days: expire.ExpirationInDays },
    { prefix: "reels/", days: 366 },
  );
});

test("the reel role: the replay's attributes, the reel item's, reels/ and its logs; nothing else", async () => {
  const R = (await json("infra/site.json")).Resources;
  const st = R.ReelsRole.Properties.Policies[0].PolicyDocument.Statement;
  const by = Object.fromEntries(st.map((s) => [s.Sid, s]));
  assert.deepEqual(Object.keys(by).sort(), [
    "OwnLogs",
    "ReadKeptReplay",
    "UpdateReelItem",
    "WriteReels",
  ]);
  assert.equal(by.ReadKeptReplay.Action, "dynamodb:GetItem");
  assert.equal(by.UpdateReelItem.Action, "dynamodb:UpdateItem");
  for (const s of [by.ReadKeptReplay, by.UpdateReelItem])
    assert.deepEqual(
      s.Condition["ForAllValues:StringLike"]["dynamodb:LeadingKeys"],
      ["pitch#*"],
    );
  assert.deepEqual(
    by.ReadKeptReplay.Condition["ForAllValues:StringEquals"][
      "dynamodb:Attributes"
    ].sort(),
    ["exp", "pk", "s", "sk", "v", "z"],
  );
  // the reel item's own attributes: none is on a state, half or replay item
  const reelAttrs =
    by.UpdateReelItem.Condition["ForAllValues:StringEquals"][
      "dynamodb:Attributes"
    ];
  for (const other of ["rev", "json", "doc", "by", "sid", "z", "s", "exp", "v"])
    assert.ok(!reelAttrs.includes(other), other);
  assert.equal(by.WriteReels.Action, "s3:PutObject");
  assert.match(by.WriteReels.Resource["Fn::Sub"], /\/reels\/\*$/);
  assert.ok(!JSON.stringify(st).includes('"*"'), "no wildcard resource");
});

test("the rooms function may invoke that one function, and runs without it", async () => {
  const t = await json("infra/rooms.json");
  const st =
    t.Resources.RoomsRole.Properties.Policies[0].PolicyDocument.Statement;
  const invoke = st.find((s) => s["Fn::If"])["Fn::If"];
  assert.equal(invoke[0], "HasReels");
  assert.equal(invoke[1].Action, "lambda:InvokeFunction");
  assert.deepEqual(invoke[1].Resource, { Ref: "ReelsFunctionArn" });
  assert.deepEqual(invoke[2], { Ref: "AWS::NoValue" });
  assert.equal(t.Parameters.ReelsFunctionArn.Default, "");
  const env = t.Resources.RoomsFunction.Properties.Environment.Variables;
  assert.deepEqual(env.REELS_FUNCTION, { Ref: "ReelsFunctionArn" });
});

test("the pins: a sha256 for ffmpeg, an npm integrity for canvas, the same canvas as node_modules", async () => {
  const pins = await json("infra/reels-pins.json");
  assert.match(pins.ffmpeg.sha256, /^[0-9a-f]{64}$/);
  assert.match(pins.ffmpeg.url, /^https:\/\//);
  assert.match(pins.ffmpeg.license, /GPL/);
  assert.match(pins.canvas.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  const pkg = await json("package.json");
  const canvas =
    pkg.dependencies?.["@napi-rs/canvas"] ??
    pkg.devDependencies?.["@napi-rs/canvas"];
  assert.equal(canvas, pins.canvas.version);
});

test("the reel package is the same every time, named by its contents, with what the function needs", async () => {
  const binary = {
    node: Buffer.from("not a real binary"),
    pkg: Buffer.from('{"name":"@napi-rs/canvas-linux-arm64-gnu"}'),
  };
  const a = await bundleReels({ binary });
  const b = await bundleReels({ binary });
  assert.ok(a.zip.equals(b.zip));
  assert.equal(a.key, b.key);
  assert.match(a.key, /^reels\/[0-9a-f]{64}\.zip$/);
  const text = a.zip.toString("latin1");
  for (const name of [
    "index.mjs",
    "package.json",
    "engines/0.7.json",
    "fonts/LondrinaSolid-Black.ttf",
    "fonts/inter-latin-wght-normal.woff2",
    "sounds/knock-1.wav",
    "node_modules/wasmoon/dist/glue.wasm",
    "node_modules/@napi-rs/canvas/index.js",
    "node_modules/@napi-rs/canvas-linux-arm64-gnu/skia.linux-arm64-gnu.node",
  ])
    assert.ok(text.includes(name), name);
  const other = await bundleReels({
    binary: { ...binary, node: Buffer.from("another") },
  });
  assert.notEqual(other.key, a.key);
});

test("readTgz reads an npm tarball's files in memory", async () => {
  const { gzipSync } = await import("node:zlib");
  const header = Buffer.alloc(512);
  header.write("package/a.txt", 0);
  header.write("0000644\0", 100);
  header.write("00000000005\0", 124);
  header.write("0", 156);
  const body = Buffer.alloc(512);
  body.write("hello");
  const tgz = gzipSync(Buffer.concat([header, body, Buffer.alloc(1024)]));
  assert.equal(readTgz(tgz).get("package/a.txt").toString(), "hello");
});
