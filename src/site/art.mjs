// The site's drawings in the game's look, "Woodcut in color" (docs/DESIGN.md
// section 6): bold ink outlines, hard ink shadows, flat color. Plain SVG
// strings, so the home page can carry them inline and tools/render-images.mjs
// can render the share image and the icons from the same pieces.

export const COLORS = {
  ink: "#16130f",
  paper: "#f7f0de",
  wood: "#ecd09a",
  woodDark: "#c79a58",
  grass: "#4f9a3b",
  grassDark: "#3d7f2c",
  line: "#ffffff",
  baton: "#fbf6ea",
};
const C = COLORS;
const r = (n) => Math.round(n * 10) / 10;

// A kubb standing on the ground at (x, ground): its face, the darker side away
// from the light, the hard shadow down and to the right.
export function kubb(x, ground, h = 60, { shadow = 0.12 } = {}) {
  const w = h * 0.47;
  const s = h * shadow;
  const side = w * 0.28;
  const left = x - w / 2;
  const top = ground - h;
  const sw = Math.max(2, h * 0.07);
  return `<g>
<rect x="${r(left + s)}" y="${r(top + s)}" width="${r(w)}" height="${r(h)}" fill="${C.ink}"/>
<rect x="${r(left)}" y="${r(top)}" width="${r(w)}" height="${r(h)}" fill="${C.wood}" stroke="${C.ink}" stroke-width="${r(sw)}" stroke-linejoin="miter"/>
<rect x="${r(left + w - side)}" y="${r(top + sw / 2)}" width="${r(side - sw / 2)}" height="${r(h - sw)}" fill="${C.woodDark}"/>
<line x1="${r(left + w - side)}" y1="${r(top)}" x2="${r(left + w - side)}" y2="${r(ground)}" stroke="${C.ink}" stroke-width="${r(sw * 0.6)}"/>
</g>`;
}

// The king: taller, with a crown of three points.
export function king(x, ground, h = 130) {
  const w = h * 0.3;
  const s = h * 0.06;
  const left = x - w / 2;
  const crown = h * 0.24;
  const top = ground - h;
  const body = top + crown;
  const sw = Math.max(2.5, h * 0.035);
  const pts = [];
  const n = 3;
  for (let i = 0; i <= n * 2; i++) {
    const px = left + (w * i) / (n * 2);
    pts.push(`${r(px)},${r(i % 2 ? top + crown * 0.55 : top)}`);
  }
  const crownPath = `M${r(left)},${r(body)} L${pts.join(" L")} L${r(left + w)},${r(body)} Z`;
  const shadow = `M${r(left + s)},${r(body + s)} L${pts
    .map((p) => {
      const [a, b] = p.split(",").map(Number);
      return `${r(a + s)},${r(b + s)}`;
    })
    .join(
      " L",
    )} L${r(left + w + s)},${r(ground + s)} L${r(left + s)},${r(ground + s)} Z`;
  return `<g>
<path d="${shadow}" fill="${C.ink}"/>
<rect x="${r(left)}" y="${r(body)}" width="${r(w)}" height="${r(ground - body)}" fill="${C.wood}" stroke="${C.ink}" stroke-width="${r(sw)}"/>
<rect x="${r(left + w * 0.72)}" y="${r(body + sw / 2)}" width="${r(w * 0.28 - sw / 2)}" height="${r(ground - body - sw)}" fill="${C.woodDark}"/>
<rect x="${r(left)}" y="${r(body)}" width="${r(w)}" height="${r(h * 0.04)}" fill="${C.ink}"/>
<path d="${crownPath}" fill="${C.wood}" stroke="${C.ink}" stroke-width="${r(sw)}" stroke-linejoin="miter"/>
</g>`;
}

// A baton in flight: white with two ink bands, turned by angle (degrees).
export function baton(cx, cy, len = 150, angle = -30) {
  const t = len * 0.15;
  const sw = Math.max(2, len * 0.03);
  const band = len * 0.08;
  return `<g transform="translate(${r(cx)} ${r(cy)}) rotate(${angle})">
<rect x="${r(-len / 2 + t * 0.4)}" y="${r(-t / 2 + t * 0.4)}" width="${r(len)}" height="${r(t)}" rx="${r(t / 2)}" fill="${C.ink}"/>
<rect x="${r(-len / 2)}" y="${r(-t / 2)}" width="${r(len)}" height="${r(t)}" rx="${r(t / 2)}" fill="${C.baton}" stroke="${C.ink}" stroke-width="${r(sw)}"/>
<rect x="${r(-len * 0.3)}" y="${r(-t / 2)}" width="${r(band)}" height="${r(t)}" fill="${C.ink}"/>
<rect x="${r(len * 0.3 - band)}" y="${r(-t / 2)}" width="${r(band)}" height="${r(t)}" fill="${C.ink}"/>
</g>`;
}

// Speed lines behind something moving right and up.
export function speedLines(x, y, len = 70, gap = 16) {
  return [0, 1, 2]
    .map(
      (i) =>
        `<line x1="${r(x - len + i * 12)}" y1="${r(y + i * gap)}" x2="${r(x + i * 12)}" y2="${r(y + i * gap)}" stroke="${C.ink}" stroke-width="6" stroke-linecap="round"/>`,
    )
    .join("");
}

// The ground: grass with a darker rough of short dashes, a white baseline.
export function ground(width, top, height) {
  const dashes = [];
  for (let y = top + 18, row = 0; y < top + height; y += 22, row++)
    for (let x = (row % 2) * 24 + 8; x < width; x += 48)
      dashes.push(
        `<line x1="${x}" y1="${y}" x2="${x + 12}" y2="${y}" stroke="${C.grassDark}" stroke-width="5" stroke-linecap="round"/>`,
      );
  return `<rect x="0" y="${top}" width="${width}" height="${height}" fill="${C.grass}"/>${dashes.join("")}<rect x="0" y="${top - 3}" width="${width}" height="6" fill="${C.ink}"/>`;
}

// The hero scene on the home page: a baton flying in at a row of kubbs with
// the king behind them. 1200 x 320, scaled by the page.
export function heroScene() {
  const W = 1200;
  const G = 250;
  return `<svg class="hero__scene" viewBox="0 0 ${W} 320" role="img" aria-label="A baton in flight toward a row of kubbs with the king standing behind them" preserveAspectRatio="xMidYMax slice">
${ground(W, G, 70)}
${speedLines(250, 92)}
${baton(340, 110, 150, -32)}
${king(640, G, 150)}
${[760, 850, 940, 1030, 1120].map((x) => kubb(x, G, 70)).join("\n")}
${kubb(120, G, 54)}
</svg>`;
}

// The share image (1200 x 630): the title in cut wood over the pitch.
export function shareImage() {
  const W = 1200;
  const H = 630;
  const G = 520;
  const word = (text, x, y, size, fill) =>
    `<text x="${x + size * 0.06}" y="${y + size * 0.06}" font-size="${size}" fill="${C.ink}" stroke="${C.ink}" stroke-width="${size * 0.08}" stroke-linejoin="round">${text}</text>
<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" stroke="${C.ink}" stroke-width="${size * 0.07}" stroke-linejoin="round" paint-order="stroke">${text}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.paper}"/>
<g font-family="Londrina Solid" font-weight="900" text-anchor="start">
${word("KUBB", 70, 250, 250, C.wood)}
<rect x="70" y="285" width="660" height="92" fill="${C.ink}"/>
<text x="94" y="357" font-size="72" fill="${C.paper}" letter-spacing="2">THROWING WOOD</text>
<text x="72" y="440" font-size="40" fill="${C.ink}" letter-spacing="1">ON THE WEB · START A PITCH, SEND THE LINK</text>
</g>
${ground(W, G, H - G)}
${speedLines(760, 120)}
${baton(860, 140, 160, -28)}
${king(1030, G, 190)}
${kubb(900, G, 80)}
${kubb(1140, G, 80)}
</svg>`;
}

// The icon: the king on grass, drawn large so it reads at 32 px.
export function iconImage(size = 180) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 180 180">
<rect width="180" height="180" fill="${C.paper}"/>
<rect x="0" y="146" width="180" height="34" fill="${C.grass}"/>
<rect x="0" y="143" width="180" height="6" fill="${C.ink}"/>
${king(84, 146, 136)}
</svg>`;
}
