// The share image as a PNG: src/site/art.mjs draws it as SVG, resvg (as
// WebAssembly, the renderer cards.thingelstad.com uses) rasterises it with the
// site's display face. resvg reads TrueType, not WOFF2, so the face is kept
// beside this file as LondrinaSolid-Black.ttf (SIL Open Font License,
// public/fonts/OFL-LondrinaSolid.txt).
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { pitchCardImage } from "../../src/site/art.mjs";

let ready = null;

// wasm and font: the bytes of resvg's index_bg.wasm and the TrueType face.
export function renderer({ wasm, font }) {
  ready ??= initWasm(wasm);
  return async (card) => {
    await ready;
    const svg = pitchCardImage(card);
    const r = new Resvg(svg, {
      fitTo: { mode: "width", value: 1200 },
      font: {
        fontBuffers: [font],
        loadSystemFonts: false,
        defaultFontFamily: "Londrina Solid",
      },
    });
    const image = r.render();
    const png = image.asPng();
    image.free();
    r.free();
    return Buffer.from(png);
  };
}
