// Soft light for the scenes (src/render/scenes.js): a round glow sprite per
// colour, drawn once into a small canvas of its own and stamped with
// drawImage, so a frame full of stardust or halos costs no gradients.
//
// The sprite canvas comes from OffscreenCanvas or the page's document; a
// renderer with neither (the highlight reel on @napi-rs/canvas) hands its own
// maker to setSpriteMaker. Without any, glows are drawn as radial gradients.

const SIZE = 64;
let maker = null;
const sprites = new Map();

export function setSpriteMaker(fn) {
  maker = fn;
  sprites.clear();
}

export function newCanvas(w, h) {
  if (maker) return maker(w, h);
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  if (typeof document !== "undefined" && document.createElement) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function stops(g, color, core) {
  const [r, gg, b] = rgb(color);
  if (core) g.addColorStop(0, "rgba(255, 255, 255, 1)");
  else g.addColorStop(0, `rgba(${r}, ${gg}, ${b}, 1)`);
  g.addColorStop(core ? 0.18 : 0.25, `rgba(${r}, ${gg}, ${b}, 0.85)`);
  g.addColorStop(0.55, `rgba(${r}, ${gg}, ${b}, 0.22)`);
  g.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
}

// The sprite for a colour: a disc that falls off to nothing at its rim;
// core: with a white-hot centre (a spark).
export function sprite(color, core = false) {
  const key = color + (core ? "*" : "");
  if (sprites.has(key)) return sprites.get(key);
  const c = newCanvas(SIZE, SIZE);
  if (c) {
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(
      SIZE / 2,
      SIZE / 2,
      0,
      SIZE / 2,
      SIZE / 2,
      SIZE / 2,
    );
    stops(grd, color, core);
    g.fillStyle = grd;
    g.fillRect(0, 0, SIZE, SIZE);
  }
  sprites.set(key, c);
  return c;
}

// A glow of radius rx by ry (the ctx's units) at (x, y), alpha a.
export function drawGlow(ctx, x, y, rx, ry, color, a, core = false) {
  if (!(a > 0.003) || !(rx > 0) || !(ry > 0)) return;
  const s = sprite(color, core);
  ctx.globalAlpha = a;
  if (s) {
    ctx.drawImage(s, x - rx, y - ry, rx * 2, ry * 2);
  } else {
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rx);
    stops(grd, color, core);
    ctx.fillStyle = grd;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.beginPath();
    ctx.arc(x, y, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
