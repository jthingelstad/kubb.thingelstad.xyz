// Every colour of the renderer, in one place (docs/RENDER.md "Palette").
// Woodcut in color: the Playdate game's ink outlines and hard ink shadows,
// with flat colour where it had white and the 50% checker.
//
// The rest of the client (HUD, cards, lobby) takes its colours from here
// too, so a team or a target is the same colour everywhere.

export const INK = "#16130f"; // outlines, shadows, the type's edge: the 1.0 system's one ink (it was #17140f)
export const PAPER = "#fbf6ea"; // plates, the dial's face, the type's fill on ink

// The two teams' accents. Not the sites' colours (#1a5eb6, #b3123f,
// #b5461a, #1d7348): marigold and violet read apart on every ground and from
// each other for most colour-blind players (yellow against purple).
export const TEAM = {
  A: { fill: "#f2b705", deep: "#b98500", text: INK, name: "marigold" },
  B: { fill: "#8e44ad", deep: "#5e2777", text: PAPER, name: "violet" },
};

// The grounds. pitch: the mown playing area (two stripes, mown each way);
// rough: outside the sidelines and past the baselines; sky: above the horizon;
// line: the white field lines; speck: the rough's texture marks.
export const GROUND = {
  grass: {
    pitch: "#5fa43c",
    stripe: "#6bb146",
    rough: "#3f7a2a",
    speck: "#2f6120",
    sky: "#d8ecf2",
    haze: "#c4dfc0",
    line: "#ffffff",
  },
  sand: {
    pitch: "#e8cf98",
    stripe: "#efd8a6",
    rough: "#d2b277",
    speck: "#b8955a",
    sky: "#f3e6cf",
    haze: "#eadbb9",
    line: "#ffffff",
  },
  snow: {
    pitch: "#eef3f8",
    stripe: "#f7fafd",
    rough: "#d3dfec",
    speck: "#b4c6da",
    sky: "#c9d9ea",
    haze: "#dfe8f2",
    line: "#4f86c6", // white lines vanish on snow: blue paint, as on a winter pitch
  },
};

// Pale wood (birch): the lit top, the lit sides, the side away from the
// light, the end grain, and the grain strokes.
export const WOOD = {
  top: "#f6e4bf",
  light: "#ecd2a0",
  shade: "#b88a4f",
  end: "#e2bf86",
  endShade: "#a87a42",
  grain: "#c79d63",
  grainShade: "#8d6535",
  ring: "#c0935a",
  bevel: "#fff3d8",
};

// The stakes: darker, older wood.
export const STAKE = { light: "#c9a06a", shade: "#8a6234", end: "#b38550" };

// The painted kubb sets (playdate-kubb AGENTS.md "Kubb sets"): only the head
// of a kubb and the king's crown are painted; the bodies stay bare wood.
// Each band is { from, to, paint } as fractions of the kubb's length from its
// foot; detail is drawn on the head band near (stars, cross, wave, cheese);
// crown is the king's head paint, emblem its mark.
export const SETS = {
  classic: null,
  usa: {
    name: "USA",
    bands: [
      { from: 0.8, to: 1, paint: "#1f3a7a" },
      { from: 0.71, to: 0.75, paint: "#c8102e" },
      { from: 0.62, to: 0.66, paint: "#c8102e" },
    ],
    detail: "stars",
    detailPaint: "#ffffff",
    crown: "#1f3a7a",
    emblem: "star",
    emblemPaint: "#ffffff",
  },
  sweden: {
    name: "Sweden",
    bands: [
      { from: 0.9, to: 1, paint: "#006aa7" },
      { from: 0.76, to: 0.86, paint: "#006aa7" },
      { from: 0.86, to: 0.9, paint: "#fecc02" },
    ],
    detail: "cross",
    detailPaint: "#fecc02",
    crown: "#006aa7",
    emblem: "cross",
    emblemPaint: "#fecc02",
  },
  minnesota: {
    name: "Minnesota",
    bands: [{ from: 0.76, to: 1, paint: "#0b2a55" }],
    detail: "wave",
    detailPaint: "#7ec8e3",
    crown: "#0b2a55",
    emblem: "northstar",
    emblemPaint: "#ffffff",
  },
  wisconsin: {
    name: "Wisconsin",
    bands: [
      { from: 0.78, to: 1, paint: "#f7c33b" },
      { from: 0.73, to: 0.78, paint: "#c5050c" },
    ],
    detail: "cheese",
    detailPaint: "#d9961a",
    crown: "#f7c33b",
    emblem: "cheese",
    emblemPaint: "#d9961a",
  },
};
export const SET_NAMES = ["classic", "usa", "sweden", "minnesota", "wisconsin"];

// The king's collar, ring and diamond (the classic king's dark details).
export const KING_MARK = "#2a2118";

// Marks on the ground and in the air while aiming.
export const AIM = {
  marker: "#fff6c8", // the target circle and its cross
  markerEdge: INK,
  arc: "#ffffff", // the planned throw, dashed
  arcEdge: INK,
  track: "rgba(22, 19, 15, 0.28)", // the arc's trace on the ground
  thrower: "#ffffff",
  footAllowed: "#ffffff",
  footChosen: "#fff6c8",
  footRefused: "#e5484d",
  keepOut: "rgba(229, 72, 77, 0.32)",
  keepOutEdge: "#c42b31",
};

// The HUD: the dial, the minimap, plates and flags.
export const HUD = {
  face: PAPER,
  faceShade: "#eadfc8",
  frame: INK,
  ring: "#f1e7d2",
  tick: INK,
  power: "#ff7a3d", // the power target (backswing side)
  powerDeep: "#c4521f",
  release: "#33b6e8", // the release target (forward side)
  releaseDeep: "#1f7fa8",
  dead: "#c9bfa9", // the dead zone round 6 o'clock
  over: "#e5484d", // the overpowered slice
  hand: "#7a5530",
  knob: "#f2e2c0",
  knobGrab: "#ffffff",
  glow: "rgba(255, 246, 200, 0.55)",
  peak: INK,
  prompt: PAPER,
  promptInk: INK,
  mapGrass: "#5fa43c",
  mapLine: "#ffffff",
  wind: "#ffffff",
  kidCone: "#ff7a1f", // the Kid line's cones on the minimap
};

// The hit bursts.
export const BURST = {
  flash: "#fff6c8",
  star: INK,
  inner: "#ffd23f",
  word: "#ffffff",
  kingInner: "#ffd23f",
  crown: "#ffd23f",
  chip: ["#ecd2a0", "#b88a4f", "#f6e4bf", INK],
};

// The controls' skin: what the HUD draws with (the meters, the minimap, the
// nudge, the bursts) besides HUD's and BURST's own colours. ink: lines and
// type; paper: faces; drop: the hard shadow under a plate. A scene that
// skins the controls (src/render/scenes.js, `skin`) changes these, HUD,
// BURST and AIM through useSkin, and the page's CSS tokens through its css;
// the day's are these, as they always were.
export const UI = { ink: INK, paper: PAPER, drop: INK };
BURST.ink = INK;
const DAY_SKIN = {
  team: { A: { ...TEAM.A }, B: { ...TEAM.B } },
  ui: { ...UI },
  hud: { ...HUD },
  burst: { ...BURST },
  aim: { ...AIM },
};
function reskin(into, day, over) {
  for (const k of Object.keys(into)) if (!(k in day)) delete into[k];
  Object.assign(into, day, over);
}
export function useSkin(skin = null) {
  // the teams' colours too, for a scene that has none (Black & White)
  reskin(TEAM.A, DAY_SKIN.team.A, skin?.team?.A);
  reskin(TEAM.B, DAY_SKIN.team.B, skin?.team?.B);
  reskin(UI, DAY_SKIN.ui, skin?.ui);
  reskin(HUD, DAY_SKIN.hud, skin?.hud);
  reskin(BURST, DAY_SKIN.burst, skin?.burst);
  reskin(AIM, DAY_SKIN.aim, skin?.aim);
}

// Type. Londrina Solid Black is the display face (bursts, prompts, numbers);
// Inter is the label face. Never italic.
export const FONT = {
  display: '"Londrina Solid", "Arial Black", Impact, sans-serif',
  label: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
};

export function groundOf(surface) {
  return GROUND[surface] || GROUND.grass;
}

export function setOf(name) {
  return SETS[name] || null;
}

// ---------- the night scene (src/render/night.js) ----------
// docs/SCENES.md. Moonlight is cool and dim; the lines,
// the stakes and the glowing set give their own light; the stardust is warm.
export const NIGHT = {
  sky: { top: "#02040b", mid: "#081127", low: "#16264a" },
  star: ["#ffffff", "#fff1d2", "#d6e4ff", "#c9d8ff"],
  milky: "#9fb4ff",
  moon: {
    face: "#f6f3e4",
    limb: "#ddd6bd",
    mare: "#cfc7ad",
    halo: "#c9d8ff",
  },
  // the grounds by moonlight: edge is the clearing's dark rim, rim the
  // silhouette against the sky, glow the lines' bloom, line their core
  grounds: {
    grass: {
      pitch: "#284a3b",
      stripe: "#2e5242",
      rough: "#1a3329",
      speck: "#10241b",
      edge: "#0b1813",
      rim: "#04090a",
      sky: "#02040b",
      line: "#e6f8ff",
      glow: "#6fcfff",
    },
    sand: {
      pitch: "#6e6452",
      stripe: "#776c59",
      rough: "#554c3e",
      speck: "#3e372d",
      edge: "#29241d",
      rim: "#0a0907",
      sky: "#02040b",
      line: "#fff3dc",
      glow: "#ffc86b",
    },
    snow: {
      pitch: "#b9cbe4",
      stripe: "#c5d6ec",
      rough: "#9fb4d3",
      speck: "#8399bd",
      edge: "#61779c",
      rim: "#0b1222",
      sky: "#02040b",
      line: "#1f7bff",
      glow: "#3f9dff",
    },
  },
  // the glowing set: kubbs pale aqua, the king gold (a look only: the same
  // pieces, sizes and weights as every set)
  glow: {
    top: "#f4fffc",
    light: "#c8f8ec",
    shade: "#82d3c2",
    end: "#ddfcf4",
    endShade: "#6fbfae",
    grain: "#a9ebdc",
    grainShade: "#66b5a5",
    ring: "#a4e7d8",
    bevel: "#ffffff",
    halo: "#5ff0d2",
  },
  glowKing: {
    top: "#fff8dc",
    light: "#ffe8a6",
    shade: "#e1b45c",
    end: "#fff1c4",
    endShade: "#cb9c48",
    grain: "#f1cf80",
    grainShade: "#ba8b3c",
    ring: "#eec872",
    bevel: "#ffffff",
    halo: "#ffcf5c",
    mark: "#6e4512",
  },
  stake: {
    top: "#eafaff",
    light: "#c4ecff",
    shade: "#86bddf",
    end: "#dcf5ff",
    endShade: "#86bddf",
    halo: "#7fd4ff",
  },
  // plain wood by moonlight, for the batons (never painted)
  wood: {
    light: "#d6c7a4",
    shade: "rgba(10, 14, 30, 0.36)",
    end: "#c3b08b",
    ring: "#9a8868",
    rim: "#f4f2e8",
  },
  ink: "#060a13",
  shadow: "rgba(1, 3, 10, 0.5)",
  vignette: "rgba(1, 2, 8, 0.55)",
  // the stardust: warm white and gold, with a little cool
  dust: ["#fff3cf", "#ffd56a", "#ffe9a8", "#bfefff"],
  kingDust: ["#ffe17a", "#fff2c0", "#ffb938", "#ffffff"],
};

// The night's controls (useSkin, and the page's CSS tokens): dark faces,
// moonlit type and lines; the meter's bands keep their day colours, which
// read on the dark face as on the light one.
// Team B's violet, deeper in the two dark scenes so white type on it holds 7:1 there
// (8.55:1 with white, 7.93:1 with the paper; the day's #8e44ad is 5.87:1): the
// header's chip, the minimap, the WATCH tab and the lobby's team head. The pieces keep
// the day's violet (world.js PIECE_TEAM). docs/SYSTEM.md "Scenes".
export const DARK_VIOLET = { fill: "#6c3483", deep: "#4a2259" };

NIGHT.skin = {
  team: { B: DARK_VIOLET },
  ui: { ink: "#dbe9ff", paper: "#0d1424", drop: "rgba(0, 0, 0, 0.55)" },
  hud: {
    face: "#0d1424",
    faceShade: "#152038",
    frame: "#dbe9ff",
    ring: "#1a2540",
    tick: "#dbe9ff",
    dead: "#2c3754",
    hand: "#b9d3ff",
    knob: "#e3edff",
    knobGrab: "#ffffff",
    glow: "rgba(150, 205, 255, 0.5)",
    peak: "#dbe9ff",
    prompt: "#0d1424",
    promptInk: "#dbe9ff",
    mapGrass: "#284a3b",
    mapLine: "#e6f8ff",
    wind: "#dbe9ff",
    mapGround: {
      grass: { rough: "#1a3329", pitch: "#284a3b", line: "#e6f8ff" },
      sand: { rough: "#554c3e", pitch: "#6e6452", line: "#fff3dc" },
      snow: { rough: "#61779c", pitch: "#9fb4d3", line: "#1f5fd0" },
    },
  },
  burst: { flash: "#d9f6ff" },
  aim: { track: "rgba(200, 225, 255, 0.2)" },
  css: {
    "--ink": "#dbe9ff",
    "--paper": "#0d1424",
    "--wood": "#1c2a45",
    "--muted": "#a9bcdc",
    "--stand-run": "#24452f",
    "--stand-zone": "#17263a",
    "--field": "#0a101d",
    "--stem": "#8fb4e8",
    "--knob-face": "#c9dcff",
    "--held": "#1a2742",
    // the 1.0 system's "insides" (a boxed name row, the scene tiles' ground)
    "--baton": "#121c31",
    "--accent": "#9cc8ff",
    "--on-accent": "#0d1424",
    "--violet": DARK_VIOLET.fill,
    "--shadow-sm":
      "0 0 0 1px rgba(219, 233, 255, 0.18), 0 0 12px rgba(110, 180, 255, 0.35)",
    "--shadow":
      "0 0 0 1px rgba(219, 233, 255, 0.18), 0 0 16px rgba(110, 180, 255, 0.35)",
  },
};

// The neon (src/render/neon.js, docs/SCENES.md): a black world on
// a grid of light. The pieces are dark solids edged in light: each side in
// its own colour (the team colours, brightened), the king in his own, the
// stakes and batons white. A piece that lies is dimmed. The grid's colour
// and spacing say the surface.
export const NEON = {
  sky: "#000000",
  // per surface: grid the floor's lines, gridEvery their spacing (m), pitch
  // its floor (a little light over the grid), line the pitch's core, glow
  // its bloom and the horizon's
  grounds: {
    grass: {
      grid: "#11a3b4",
      gridEvery: 1,
      pitch: "rgba(4, 36, 46, 0.4)",
      line: "#c8fdff",
      glow: "#2be4ff",
    },
    sand: {
      grid: "#c07a12",
      gridEvery: 2,
      pitch: "rgba(48, 28, 2, 0.4)",
      line: "#fff0c8",
      glow: "#ffad33",
    },
    snow: {
      grid: "#8fb4ff",
      gridEvery: 0.5,
      pitch: "rgba(26, 38, 70, 0.4)",
      line: "#ffffff",
      glow: "#9cc2ff",
    },
    // the Techno scene's own floor (engine 0.14's `grid` surface): flat, glossy and
    // electronic, nothing organic. A faint grid a metre apart on a near-black floor
    // that mirrors what stands on it (reflect), its pitch a pane a shade lighter,
    // the lines cyan light.
    grid: {
      grid: "#1fd7ee",
      gridEvery: 1,
      gridAlpha: 0.55,
      pitch: "rgba(10, 60, 80, 0.34)",
      line: "#d8feff",
      glow: "#2be4ff",
      floor: "#02060c",
      sheen: "#0d3a4c",
      reflect: 0.26,
    },
  },
  // the pieces' dark bodies (every tone the faces take)
  solid: {
    top: "#111827",
    light: "#0b111c",
    shade: "#060a12",
    end: "#0e1522",
    endShade: "#05080e",
    grain: "#0b111c",
    grainShade: "#060a12",
    ring: "#0e1522",
    bevel: "#5d6b80",
  },
  // the light at the edges: lit, and dimmed while the piece lies
  team: {
    A: { lit: "#ffc94a", dim: "#7a5b1c", deep: "#d99a14", dimDeep: "#4a3710" },
    B: { lit: "#cf8bff", dim: "#5f3f7c", deep: "#9a55d6", dimDeep: "#3a2650" },
  },
  king: { lit: "#ff5c9d", dim: "#7c2d4c" },
  stake: { lit: "#e9fbff" },
  baton: { edge: "#f2fdff", body: "#070b12", core: "#8fefff" },
  ribbon: ["#ffffff", "#8ff4ff", "#2be4ff"],
  spark: ["#ffffff", "#c8fdff", "#8ff4ff", "#ffe4f0"],
  kingSpark: ["#ff5c9d", "#ff9cc4", "#ffffff", "#ffc94a"],
  shadow: "rgba(0, 0, 0, 0.6)",
};

// The neon's controls: thin light lines on black, the meter a ring of light
// whose bands are coloured light.
NEON.skin = {
  team: { B: DARK_VIOLET },
  ui: { ink: "#c8fdff", paper: "#02050a", drop: "rgba(43, 228, 255, 0.35)" },
  hud: {
    face: "#02050a",
    faceShade: "#061019",
    frame: "#5ff0ff",
    ring: "#04121a",
    tick: "#8ff4ff",
    power: "#ff9a4a",
    powerDeep: "#ff7a1f",
    release: "#3fe0ff",
    releaseDeep: "#16b8e6",
    dead: "#10222c",
    over: "#ff4d6a",
    hand: "#c8fdff",
    knob: "#e9feff",
    knobGrab: "#ffffff",
    glow: "rgba(95, 240, 255, 0.55)",
    peak: "#ffffff",
    prompt: "#02050a",
    promptInk: "#c8fdff",
    mapGrass: "#04121a",
    mapLine: "#c8fdff",
    wind: "#c8fdff",
    mapGround: {
      grass: { rough: "#02070b", pitch: "#0a2a33", line: "#c8fdff" },
      sand: { rough: "#070502", pitch: "#30200a", line: "#fff0c8" },
      snow: { rough: "#03060d", pitch: "#1c2a48", line: "#ffffff" },
    },
  },
  // the bursts: a star of light round a black inside, the word white
  burst: {
    flash: "#c8fdff",
    ink: "#5ff0ff",
    inner: "#02050a",
    kingInner: "#1a0410",
    crown: "#ff5c9d",
    word: "#ffffff",
    chip: ["#5ff0ff", "#ff5c9d", "#ffc94a", "#02050a"],
  },
  aim: {
    track: "rgba(95, 240, 255, 0.22)",
    arcEdge: "#02050a",
    markerEdge: "#02050a",
  },
  css: {
    "--ink": "#c8fdff",
    "--paper": "#02050a",
    "--wood": "#06141c",
    "--muted": "#86c4cf",
    "--stand-run": "#06303a",
    "--stand-zone": "#041821",
    "--field": "#000000",
    "--stem": "#5ff0ff",
    "--knob-face": "#c8fdff",
    "--held": "#062430",
    "--baton": "#041018",
    "--accent": "#5ff0ff",
    "--on-accent": "#02050a",
    "--violet": DARK_VIOLET.fill,
    "--shadow-sm":
      "0 0 0 1px rgba(95, 240, 255, 0.55), 0 0 10px rgba(43, 228, 255, 0.45)",
    "--shadow":
      "0 0 0 1px rgba(95, 240, 255, 0.55), 0 0 16px rgba(43, 228, 255, 0.45)",
  },
};

// ---------- the outdoor scenes (beach.js, minnesota.js, tournament.js) ----------
// Each keeps the day's controls (its skin is the day's: the same type, plates and
// contrast) and draws its own sky, ground and what stands round the pitch, in the
// day's flat colour with the ink line. Surfaces are the engine's (a scene decides
// them: Beach sand, Minnesota snow, Tournament grass).

// The beach: a sand pitch by the sea, a hot clear sky.
export const BEACH = {
  sky: { top: "#5fb8e3", low: "#d4eef7" },
  sun: { face: "#fff3c2", halo: "rgba(255, 236, 170, 0.45)" },
  sea: { near: "#2aa3c7", far: "#1c7fae", haze: "#bfe6f1", foam: "#ffffff" },
  wet: "#c9a96b", // the sand the waves reach
  shore: 11.2, // m: where the sand meets the sea, 3 m past the far baseline (the aim
  // view sees about 6 m past it on a wide screen, the sea a band at its top)
  ground: {
    pitch: "#ecd59f",
    stripe: "#f1dcab",
    rough: "#e0c184",
    speck: "#bf9b5c",
    sky: "#d4eef7",
    haze: "#e9dcb6",
    line: "#ffffff",
  },
  umbrella: ["#e5484d", "#ffffff", "#f2b705", "#ffffff"],
  towel: ["#33b6e8", "#ffffff", "#e5484d", "#f2b705"],
  pole: "#efe6d6",
  sail: "#ffffff",
  hull: "#e5484d",
  grass: "#7a9a4a", // the dune grass
  puff: ["#e8cf98", "#dcbd80", "#f3e2b8"],
  cone: { cone: "#ff6a2b", band: "#ffffff", ink: INK },
};

// Minnesota: a winter park in snow, bare birches and pines, a low cold sun.
export const MINNESOTA = {
  sky: { top: "#8fa9c6", low: "#e8eef4" },
  sun: { face: "#fbf5e2", halo: "rgba(255, 250, 230, 0.4)" },
  ground: {
    pitch: "#eef3f8",
    stripe: "#f7fafd",
    rough: "#dfe8f1",
    speck: "#b4c6da",
    sky: "#e8eef4",
    haze: "#eef2f6",
    line: "#3f78bd", // white lines vanish on snow: blue paint, as on a winter pitch
  },
  bank: "#f7fafd", // the snowbanks round the park
  bankShade: "#c9d7e6",
  pine: { leaf: "#2f5e48", trunk: "#5a4030", snow: "#f7fafd", ink: INK },
  birch: { bark: "#f4f1ea", ink: INK },
  shadow: "#3d4c66", // a cold shadow
  flake: "#ffffff",
  puff: ["#ffffff", "#eef4fb", "#dfe9f4"],
  cone: { cone: "#ff6a2b", band: "#ffffff", ink: INK },
};

// A kubb tournament: pitches side by side on mown grass, rope lines with pennants,
// scoreboards and a canopy round the neighbouring pitches (no championship's name or
// logo, and no people: the owner, 2026-11-22).
export const TOURNAMENT = {
  sky: { top: "#86c3e6", low: "#e2f2f7" },
  ground: {
    pitch: "#5fa43c",
    stripe: "#6bb146",
    rough: "#4f9234",
    speck: "#356e23",
    sky: "#e2f2f7",
    haze: "#cfe4c4",
    line: "#ffffff",
  },
  neighbour: { pitch: "#5a9c39", stripe: "#64a742", line: "#f4f8ee" },
  rope: "#f6efe0",
  pennant: ["#1f3a7a", "#ffffff", "#c8102e", "#f2b705"],
  post: "#ece2cc",
  board: {
    face: "#1f2a3a",
    frame: "#ece2cc",
    digit: "#ffffff",
    plate: "#2e3d52",
  },
  tent: { roof: ["#ffffff", "#1f3a7a"], leg: "#d7d0c2" },
  wood: "#ecd2a0",
  cone: { cone: "#ff6a2b", band: "#ffffff", ink: INK },
};
