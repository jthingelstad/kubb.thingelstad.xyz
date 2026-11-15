// Render the site's images from the drawings in src/site/art.mjs: the share
// image (public/share/kubb.png, 1200 x 630), the favicon (public/favicon.png,
// 64 x 64) and the apple-touch-icon (public/apple-touch-icon.png, 180 x 180).
//
//   npm run images
//
// Uses Playwright's Chromium (npx playwright install chromium once), with
// Londrina Solid loaded from public/fonts so the title is the real face. The
// PNGs are committed; run this again after changing a drawing.
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { iconImage, shareImage } from "../src/site/art.mjs";

const font = (
  await fs.readFile("public/fonts/LondrinaSolid-Black.woff2")
).toString("base64");
const html = (svg, size) => `<!doctype html><html><head><style>
@font-face { font-family: "Londrina Solid"; font-weight: 900; src: url(data:font/woff2;base64,${font}) format("woff2"); }
html, body { margin: 0; padding: 0; width: ${size[0]}px; height: ${size[1]}px; overflow: hidden; }
svg { display: block; width: ${size[0]}px; height: ${size[1]}px; }
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
try {
  for (const [file, svg, size] of [
    ["public/share/kubb.png", shareImage(), [1200, 630]],
    ["public/apple-touch-icon.png", iconImage(180), [180, 180]],
    ["public/favicon.png", iconImage(64), [64, 64]],
  ]) {
    const page = await browser.newPage({
      viewport: { width: size[0], height: size[1] },
      deviceScaleFactor: 1,
    });
    await page.setContent(html(svg, size));
    await page.evaluate(() => document.fonts.ready);
    await fs.mkdir(file.split("/").slice(0, -1).join("/"), { recursive: true });
    await page.screenshot({ path: file, omitBackground: false });
    await page.close();
    console.log(`Wrote ${file}`);
  }
} finally {
  await browser.close();
}
