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

// ---------- a pitch's share image ----------

// One pitch's share image (1200 x 630; Jamie, 2026-11-16: "can we get the share
// preview image to reflect the game that it is linked to?"): the wordmark, the two
// teams by the names they typed, the state line, and the pitch from above with its
// pieces as they stand, or as they fell (backend/pages/pitch.mjs piecesOf).
//
//   pitchCardImage({ teams: { A, B } | null, line, pieces })
//
// teams null (a pitch waiting for players) shows "A PITCH" instead of names: the
// lobby holds member ids, not names. The team colours are the game's
// (src/render/palette.js): marigold for A, violet for B.
const TEAM_FILL = { A: "#f2b705", B: "#8e44ad" };
const TEAM_TEXT = { A: C.ink, B: C.paper };
const XML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const xml = (s) => String(s).replace(/[&<>"]/g, (c) => XML[c]);

// A name for the card: at most 18 characters, upper case.
export function cardName(name) {
  const s = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return s.length > 18 ? `${s.slice(0, 17).trimEnd()}...` : s;
}

// Type that shrinks with its length to fit `width` (Londrina is about half an em wide).
const fit = (text, width, most, least) =>
  Math.max(least, Math.min(most, Math.floor(width / (0.5 * text.length))));

// The pitch from above, the length across the image: Team A's baseline on the
// left (world y = 0), Team B's on the right (y = 8), the sidelines (x = -2.5, 2.5)
// top and bottom. Pieces are drawn larger than life so they read at a glance.
function pitchFromAbove(left, top, scale, pieces) {
  const px = (y) => left + (y + 0.8) * scale;
  const py = (x) => top + (x + 3.1) * scale;
  const out = [];
  const w = 9.6 * scale;
  const h = 6.2 * scale;
  out.push(
    `<rect x="${r(left + 8)}" y="${r(top + 8)}" width="${r(w)}" height="${r(h)}" fill="${C.ink}"/>`,
    `<rect x="${r(left)}" y="${r(top)}" width="${r(w)}" height="${r(h)}" fill="${C.grass}" stroke="${C.ink}" stroke-width="5"/>`,
  );
  // mown stripes, one per metre
  for (let y = 0; y < 8; y += 2)
    out.push(
      `<rect x="${r(px(y))}" y="${r(py(-2.5))}" width="${r(scale)}" height="${r(5 * scale)}" fill="${C.grassDark}" opacity="0.35"/>`,
    );
  // the team ends, then the lines: baselines, sidelines, centre line
  out.push(
    `<rect x="${r(px(-0.8) + 2.5)}" y="${r(py(-2.5))}" width="${r(0.8 * scale - 2.5)}" height="${r(5 * scale)}" fill="${TEAM_FILL.A}"/>`,
    `<rect x="${r(px(8))}" y="${r(py(-2.5))}" width="${r(0.8 * scale - 2.5)}" height="${r(5 * scale)}" fill="${TEAM_FILL.B}"/>`,
    `<rect x="${r(px(0))}" y="${r(py(-2.5))}" width="${r(8 * scale)}" height="${r(5 * scale)}" fill="none" stroke="${C.line}" stroke-width="4"/>`,
    `<line x1="${r(px(4))}" y1="${r(py(-2.5))}" x2="${r(px(4))}" y2="${r(py(2.5))}" stroke="${C.line}" stroke-width="3" stroke-dasharray="10 8"/>`,
  );
  const shadow = 5;
  const box = (cx, cy, len, wid, deg, fill) =>
    `<g transform="translate(${r(cx)} ${r(cy)}) rotate(${r(deg)})"><rect x="${r(-len / 2 + shadow)}" y="${r(-wid / 2 + shadow)}" width="${r(len)}" height="${r(wid)}" fill="${C.ink}"/><rect x="${r(-len / 2)}" y="${r(-wid / 2)}" width="${r(len)}" height="${r(wid)}" fill="${fill}" stroke="${C.ink}" stroke-width="3"/></g>`;
  // the pieces stay inside the drawing: a baton past the baseline is cut at its edge
  out.push(
    `<clipPath id="field"><rect x="${r(left)}" y="${r(top)}" width="${r(w)}" height="${r(h)}"/></clipPath>`,
    `<g clip-path="url(#field)">`,
  );
  // fallen and thrown pieces first, standing ones over them
  const order = [...pieces].sort(
    (a, b) => Number(a.standing) - Number(b.standing),
  );
  for (const p of order) {
    const cx = px(p.y);
    const cy = py(p.x);
    // a piece's long axis on the ground, in degrees on the image: world y is
    // image x and world x is image y
    const deg = (Math.atan2(p.ax ?? 0, p.ay ?? 1) * 180) / Math.PI;
    if (p.kind === "baton")
      out.push(box(cx, cy, 0.3 * scale * 1.6, 9, deg, C.baton));
    else if (p.kind === "king") {
      if (p.standing) {
        out.push(box(cx, cy, 30, 30, 0, C.wood));
        out.push(
          `<path d="M${r(cx - 9)},${r(cy + 6)} L${r(cx - 9)},${r(cy - 7)} L${r(cx - 4.5)},${r(cy - 1)} L${r(cx)},${r(cy - 9)} L${r(cx + 4.5)},${r(cy - 1)} L${r(cx + 9)},${r(cy - 7)} L${r(cx + 9)},${r(cy + 6)} Z" fill="${C.ink}"/>`,
        );
      } else out.push(box(cx, cy, 52, 20, deg, C.woodDark));
    } else if (p.standing) out.push(box(cx, cy, 20, 20, 0, C.wood));
    else out.push(box(cx, cy, 34, 15, deg, C.woodDark));
  }
  out.push("</g>");
  return out.join("\n");
}

export function pitchCardImage({ teams = null, line = "", pieces = [] } = {}) {
  const W = 1200;
  const H = 630;
  const TEXT = 520; // the text column's width
  const parts = [];
  const plate = (text, x, y, size, fill, ink) => {
    const w = Math.ceil(text.length * size * 0.52 + size * 0.7);
    return `<rect x="${x + 6}" y="${y - size + 6}" width="${w}" height="${Math.round(size * 1.25)}" fill="${C.ink}"/>
<rect x="${x}" y="${y - size}" width="${w}" height="${Math.round(size * 1.25)}" fill="${fill}" stroke="${C.ink}" stroke-width="4"/>
<text x="${x + size * 0.35}" y="${Math.round(y + size * 0.05)}" font-size="${size}" fill="${ink}">${xml(text)}</text>`;
  };
  parts.push(
    `<rect x="56" y="48" width="${TEXT - 30}" height="70" fill="${C.ink}"/>`,
    `<text x="76" y="100" font-size="44" fill="${C.paper}" letter-spacing="1">KUBB: THROWING WOOD</text>`,
  );
  if (teams) {
    const a = cardName(teams.A);
    const b = cardName(teams.B);
    const size = Math.min(fit(a, TEXT - 60, 76, 40), fit(b, TEXT - 60, 76, 40));
    parts.push(
      plate(a, 56, 236, size, TEAM_FILL.A, TEAM_TEXT.A),
      `<text x="64" y="${236 + size * 0.95}" font-size="40" fill="${C.ink}">VS</text>`,
      plate(b, 56, 236 + size * 1.6 + 30, size, TEAM_FILL.B, TEAM_TEXT.B),
    );
  } else
    parts.push(
      `<text x="56" y="300" font-size="110" fill="${C.wood}" stroke="${C.ink}" stroke-width="8" stroke-linejoin="round" paint-order="stroke">A PITCH</text>`,
    );
  const l = String(line).toUpperCase();
  parts.push(
    `<text x="58" y="560" font-size="${fit(l, TEXT, 50, 30)}" fill="${C.ink}" letter-spacing="1">${xml(l)}</text>`,
  );
  const scale = 58;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.paper}"/>
<g font-family="Londrina Solid" font-weight="900" text-anchor="start">
${parts.join("\n")}
</g>
${pitchFromAbove(W - 9.6 * scale - 44, (H - 6.2 * scale) / 2 - 4, scale, pieces)}
</svg>`;
}
