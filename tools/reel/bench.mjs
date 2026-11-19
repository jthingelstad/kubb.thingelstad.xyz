// How fast each way of drawing a reel is, on the same frames: Node with @napi-rs/canvas
// (what render.mjs uses) and headless Chromium through Playwright, drawing with the
// same src/render/world.js. The frames are a real reel's cameras and pieces (render.mjs's
// `capture`), the first 30 s of it per format. Measures drawing the pitch and getting
// its pixels out to where ffmpeg could read them; the overlays and the encoder are the
// same either way and are timed by render.mjs itself.
//
//   node tools/reel/bench.mjs [--replay build/reel/matches/seed-1.json] [--frames 900]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { build } from "esbuild";
import { chromium } from "playwright";
import { drawWorld } from "../../src/render/world.js";
import { renderReel, FORMATS } from "./render.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const replayFile = arg("replay", "build/reel/matches/seed-1.json");
const N = Number(arg("frames", 900));
const SAMPLE = 90; // frames sent out of Chromium one at a time (extrapolated to N)
const load = () =>
  os
    .loadavg()
    .map((x) => x.toFixed(1))
    .join(" ");

const replay = JSON.parse(fs.readFileSync(replayFile, "utf8"));
const frames = { tall: [], wide: [] };
let scene = null;
await renderReel({
  replay,
  code: "benchbench",
  out: "build/reel/bench",
  name: "bench",
  log: () => {},
  capture: (f, x) => {
    scene ??= x.scene;
    if (frames[f].length < N)
      frames[f].push({ camera: x.camera, items: x.items });
  },
});

const out = {};
for (const f of ["tall", "wide"]) {
  const { W, H } = FORMATS[f];
  const view = {
    width: W,
    height: H,
    dpr: 1,
    fit: { k: W / 400, ox: 0, oy: 0 },
  };
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const t0 = performance.now();
  let bytes = 0;
  for (const fr of frames[f]) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawWorld(ctx, view, fr.camera, { ...scene, items: fr.items });
    bytes += canvas.data().length;
  }
  out[f] = { napi: (performance.now() - t0) / 1000, napiLoad: load(), bytes };
}

// Chromium: the same drawWorld, bundled for the page
const bundle = await build({
  stdin: {
    contents: `import { drawWorld } from "./src/render/world.js";
      window.drawWorld = drawWorld;`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
});
const browser = await chromium.launch();
for (const f of ["tall", "wide"]) {
  const { W, H } = FORMATS[f];
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(
    `<style>body{margin:0}</style><canvas id="c" width="${W}" height="${H}"></canvas>`,
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(
    ({ scene, W, H }) => {
      const c = document.getElementById("c");
      window.ctx = c.getContext("2d", { willReadFrequently: true });
      window.view = {
        width: W,
        height: H,
        dpr: 1,
        fit: { k: W / 400, ox: 0, oy: 0 },
      };
      window.scene = scene;
      window.one = (fr) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawWorld(ctx, view, fr.camera, { ...scene, items: fr.items });
      };
    },
    { scene, W, H },
  );
  // (1) draw and read the pixels inside the page: the floor for any Chromium path
  let t0 = performance.now();
  await page.evaluate((list) => {
    let n = 0;
    for (const fr of list) {
      one(fr);
      n += ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
        .length;
    }
    return n;
  }, frames[f]);
  out[f].chromeInPage = (performance.now() - t0) / 1000;
  // (2) each frame's pixels out to Node, as base64 over the protocol
  const some = frames[f].slice(0, SAMPLE);
  t0 = performance.now();
  for (const fr of some) {
    const b64 = await page.evaluate((fr) => {
      one(fr);
      const d = ctx.getImageData(
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height,
      ).data;
      let s = "";
      for (let i = 0; i < d.length; i += 0x8000)
        s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
      return btoa(s);
    }, fr);
    Buffer.from(b64, "base64");
  }
  out[f].chromeOut =
    ((performance.now() - t0) / 1000) * (frames[f].length / some.length);
  // (3) a screenshot per frame, the usual Playwright way
  t0 = performance.now();
  for (const fr of some) {
    await page.evaluate((fr) => one(fr), fr);
    await page.screenshot({ type: "png" });
  }
  out[f].chromeShot =
    ((performance.now() - t0) / 1000) * (frames[f].length / some.length);
  out[f].chromeLoad = load();
  await page.close();
}
await browser.close();

for (const f of ["tall", "wide"]) {
  const o = out[f];
  console.log(
    `${f} ${frames[f].length} frames (${(frames[f].length / 30).toFixed(0)} s of reel): ` +
      `napi draw+pixels ${o.napi.toFixed(1)} s (load ${o.napiLoad}); ` +
      `chromium draw+getImageData ${o.chromeInPage.toFixed(1)} s, ` +
      `+ pixels to Node ${o.chromeOut.toFixed(1)} s, screenshots ${o.chromeShot.toFixed(1)} s ` +
      `(load ${o.chromeLoad}; the last two from ${SAMPLE} frames)`,
  );
}
fs.rmSync(path.join("build/reel/bench"), { recursive: true, force: true });
