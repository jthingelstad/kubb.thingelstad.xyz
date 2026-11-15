// Screenshots of the renderer gallery (dev/render.html) for looking at the
// drawing: every picture full-window at 1280 x 768 (dpr 2) and 390 x 844
// (dpr 3), the gallery page, and the draw timings.
//
//   node tools/render-shots.mjs [name ...]
//
// Serves the repository on 127.0.0.1 at a free port, drives Playwright's
// Chromium and writes build/render-shots/<name>-<size>.png. Names limit the
// run to those pictures. The server and the browser stop when it ends.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "build", "render-shots");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const bench = !process.argv.includes("--no-bench");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".css": "text/css",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const file = path.normalize(
      path.join(root, decodeURIComponent(url.pathname)),
    );
    if (!file.startsWith(root + path.sep)) throw new Error("outside");
    const body = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/dev/render.html`;

const SIZES = [
  { tag: "1280x768", width: 1280, height: 768, dpr: 2 },
  { tag: "390x844", width: 390, height: 844, dpr: 3 },
];

const browser = await chromium.launch();
try {
  await fs.mkdir(out, { recursive: true });
  const errors = [];
  const open = async (size, query) => {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.dpr,
    });
    page.on("pageerror", (e) => errors.push(`${query}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${query}: ${m.text()}`);
    });
    await page.goto(`${base}${query}`);
    try {
      await page.waitForFunction(() => window.__ready === true, null, {
        timeout: 60000,
      });
    } catch (e) {
      throw new Error(`${query} never got ready\n${errors.join("\n")}`, {
        cause: e,
      });
    }
    return page;
  };

  // the list of pictures, from the gallery itself
  const first = await open(SIZES[0], "?list");
  const names = await first.evaluate(() => window.__pictures);
  await first.close();

  let n = 0;
  for (const name of names) {
    if (only.length && !only.includes(name)) continue;
    for (const size of SIZES) {
      const page = await open(size, `?only=${name}`);
      const file = path.join(out, `${name}-${size.tag}.png`);
      await page.screenshot({ path: file });
      await page.close();
      n++;
    }
  }
  if (!only.length) {
    const page = await open({ width: 1320, height: 900, dpr: 1 }, "");
    await page.screenshot({
      path: path.join(out, "gallery.png"),
      fullPage: true,
    });
    await page.close();
    n++;
  }
  console.log(`Wrote ${n} PNGs to build/render-shots/`);

  if (bench) {
    const page = await open({ width: 1280, height: 768, dpr: 1 }, "?bench");
    const lines = await page.evaluate(() => window.__bench);
    await page.close();
    console.log(lines.join("\n"));
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.close();
}
