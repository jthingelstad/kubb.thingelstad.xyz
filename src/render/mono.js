// The Black & White scene (engine id `bw`; docs/SCENES.md): the Playdate game's own
// look, opened to every game (the owner: "This IS the Playdate"). Pure black and white,
// 1-bit, as playdate-kubb's render/world.lua draws it: white ground and sky, black
// lines, a sparse dithered rough past the pitch (its own pattern for each surface),
// pieces white with black faces where they turn from the light, black ink and solid
// black shadows. Every grey is a dither pattern, never a tint: Team A's band is a 50%
// checker, Team B's solid black; the king's marks black. The controls go black and
// white too (MONO_SKIN: the meter, the minimap, the plates and the page's tokens).
//
// The patterns are 8 by 8 tiles, one bit a Playdate pixel (a frame px, the 400 x 240
// frame drawWorld draws in), drawn at half that so they read on a large screen, and
// moved with the far baseline as the Playdate moves its rough (so the rough does not
// swim when the camera turns).
import { project } from "./camera.js";
import { newCanvas } from "./glow.js";
import { horizon } from "./scenery.js";

// The patterns as rows of bits (1 black), the Playdate's way (gfx.setPattern).
export const PATTERNS = {
  // the rough on grass: the Playdate's tufts (world.tune.roughPattern)
  grass: [0x00, 0x22, 0x00, 0x00, 0x00, 0x88, 0x00, 0x00],
  // sand: a fine stipple
  sand: [0x80, 0x00, 0x08, 0x00, 0x40, 0x00, 0x04, 0x00],
  // snow: bare, a sparkle here and there
  snow: [0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00],
  checker: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55],
  light: [0x88, 0x00, 0x22, 0x00, 0x88, 0x00, 0x22, 0x00], // 12.5%
  dark: [0x77, 0xff, 0xdd, 0xff, 0x77, 0xff, 0xdd, 0xff], // 87.5%
};

export const tune = {
  scale: 0.5, // frame px a pattern bit is drawn at
};

const BLACK = "#000000",
  WHITE = "#ffffff";

// One pattern, made once (null where no canvas can be made: plain colours then).
const made = new Map();
export function pattern(name) {
  if (made.has(name)) return made.get(name);
  const rows = PATTERNS[name];
  let p = null;
  const c = rows && newCanvas(8, 8);
  const g = c?.getContext?.("2d");
  if (g) {
    g.fillStyle = WHITE;
    g.fillRect(0, 0, 8, 8);
    g.fillStyle = BLACK;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        if ((rows[y] >> (7 - x)) & 1) g.fillRect(x, y, 1, 1);
    try {
      p = g.createPattern(c, "repeat");
    } catch {
      p = null;
    }
  }
  made.set(name, p);
  return p;
}

// Each pattern's fill, or a plain colour of about its weight where patterns cannot
// be made.
const fill = (name, fallback) => pattern(name) || fallback;

// Move every pattern to the far baseline's middle on the screen (the Playdate's
// phase), at tune.scale.
function phase(cam) {
  const p = project(cam, 0, 8, 0) || [0, 0];
  const s = tune.scale;
  for (const pat of made.values()) {
    if (!pat?.setTransform) continue;
    try {
      const m =
        typeof DOMMatrix === "function"
          ? new DOMMatrix([s, 0, 0, s, p[0], p[1]])
          : { a: s, b: 0, c: 0, d: s, e: p[0], f: p[1] };
      pat.setTransform(m);
    } catch {
      // a canvas without pattern transforms keeps the Playdate's own size
    }
  }
}

function grounds() {
  const base = {
    pitch: WHITE,
    stripe: WHITE,
    speck: BLACK,
    sky: WHITE,
    haze: WHITE,
    line: BLACK,
  };
  return {
    // the pattern is the rough's texture: no tufts drawn over it
    grass: { ...base, rough: fill("grass", WHITE), noSpeck: true },
    sand: { ...base, rough: fill("sand", WHITE), noSpeck: true },
    snow: { ...base, rough: fill("snow", WHITE), noSpeck: true },
  };
}

// The pieces: white faces, black where they face away from the light (the
// Playdate's), the grain black up close.
const WOOD = {
  top: WHITE,
  light: WHITE,
  shade: BLACK,
  end: WHITE,
  endShade: BLACK,
  grain: BLACK,
  grainShade: BLACK,
  ring: BLACK,
  bevel: WHITE,
};

// The controls in black and white (useSkin; the page's tokens): the meter's bands
// told apart by their shapes alone (the power band striped, the release band
// solid, the overpowered zone cross-hatched: the 1.0 design's marks), the teams
// white (Team A, circles on the minimap) and black (Team B, squares).
export const MONO_SKIN = {
  ui: { ink: BLACK, paper: WHITE, drop: BLACK },
  team: {
    A: { fill: WHITE, deep: WHITE, text: BLACK },
    B: { fill: BLACK, deep: BLACK, text: WHITE },
  },
  hud: {
    face: WHITE,
    faceShade: WHITE,
    frame: BLACK,
    ring: WHITE,
    tick: BLACK,
    power: BLACK,
    powerDeep: BLACK,
    release: BLACK,
    releaseDeep: BLACK,
    dead: WHITE,
    over: BLACK,
    hand: BLACK,
    knob: WHITE,
    knobGrab: WHITE,
    glow: "rgba(0, 0, 0, 0)",
    peak: BLACK,
    prompt: WHITE,
    promptInk: BLACK,
    mapGrass: WHITE,
    mapLine: BLACK,
    wind: WHITE,
    kidCone: WHITE,
    mapGround: {
      grass: { rough: WHITE, pitch: WHITE, line: BLACK },
      sand: { rough: WHITE, pitch: WHITE, line: BLACK },
      snow: { rough: WHITE, pitch: WHITE, line: BLACK },
    },
  },
  burst: {
    flash: WHITE,
    star: BLACK,
    ink: BLACK,
    inner: WHITE,
    word: WHITE,
    kingInner: WHITE,
    crown: BLACK,
    chip: [WHITE, BLACK, WHITE, BLACK],
  },
  aim: {
    marker: WHITE,
    markerEdge: BLACK,
    arc: WHITE,
    arcEdge: BLACK,
    track: BLACK,
    thrower: WHITE,
    footAllowed: WHITE,
    footChosen: WHITE,
    footRefused: BLACK,
    keepOut: "rgba(0, 0, 0, 0)",
    keepOutEdge: BLACK,
  },
  css: {
    "--ink": BLACK,
    "--paper": WHITE,
    "--wood": WHITE,
    "--wood-dark": BLACK,
    "--muted": BLACK,
    "--marigold": WHITE,
    "--violet": BLACK,
    "--power": BLACK,
    "--release": BLACK,
    "--stand-run": WHITE,
    "--stand-zone": WHITE,
    "--field": WHITE,
    "--stem": BLACK,
    "--knob-face": WHITE,
    "--held": WHITE,
    "--baton": WHITE,
    "--accent": BLACK,
    "--on-accent": WHITE,
    "--shadow-sm": "3px 3px 0 #000000",
    "--shadow": "5px 5px 0 #000000",
  },
};

const L = (() => {
  // the Playdate's light (render/world shadowX 0.55, shadowY -0.3): from the far left
  const lx = -0.55,
    ly = 0.3,
    lz = 1;
  const n = Math.hypot(lx, ly, lz);
  return [lx / n, ly / n, lz / n];
})();

// A piece's band: Team A a checker, Team B solid black; nothing else is lit.
function litOf(it) {
  const T = it.team === "A" ? "A" : it.team === "B" ? "B" : null;
  if (!T) return { ink: BLACK, bevel: WHITE, band: null, bandDeep: null };
  const band = T === "A" ? fill("checker", WHITE) : BLACK;
  return {
    ink: BLACK,
    bevel: WHITE,
    band,
    bandDeep: T === "A" ? fill("checker", BLACK) : BLACK,
  };
}

export function makeMono({ reduced = false } = {}) {
  const G = grounds();
  return {
    id: "bw",
    skin: MONO_SKIN,
    reduced,
    mono: true,
    groundOf: (surface) => G[surface] || G.grass,
    // the classic look only: a set's paint is colour
    setOf: () => null,
    light: {
      shadowX: 0.55,
      shadowY: -0.3,
      L,
      awayBelow: -0.35,
      topAbove: 0.75,
      shadowFill: BLACK,
    },
    paint: {
      wood: WOOD,
      stake: {
        top: WHITE,
        light: WHITE,
        shade: BLACK,
        end: WHITE,
        endShade: BLACK,
      },
      ink: BLACK,
      kingMark: BLACK,
      batonShade: BLACK,
      litOf,
    },
    clearing: null,
    cone: { cone: WHITE, band: BLACK, ink: BLACK },
    // a spinning piece's own pose never faded over its in-between poses: no greys
    spinOpaque: true,
    // every frame: the patterns move with the far baseline
    sky: (ctx, cam) => phase(cam),
    // the Playdate's horizon: one black line where the ground meets the white sky
    beyond: (ctx, cam, kx, B) => {
      const hz = horizon(cam);
      if (!hz) return;
      ctx.strokeStyle = BLACK;
      ctx.lineWidth = 1.2 / kx;
      ctx.beginPath();
      ctx.moveTo(B.left - 2, hz.y + (B.left - 2 - cam.cx) * hz.slope);
      ctx.lineTo(B.right + 2, hz.y + (B.right + 2 - cam.cx) * hz.slope);
      ctx.stroke();
    },
  };
}
