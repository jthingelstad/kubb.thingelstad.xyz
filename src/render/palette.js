// Every colour of the renderer, in one place (docs/RENDER.md "Palette").
// Woodcut in color: the Playdate game's ink outlines and hard ink shadows,
// with flat colour where it had white and the 50% checker.
//
// The rest of the client (HUD, cards, lobby) takes its colours from here
// too, so a team or a target is the same colour everywhere.

export const INK = "#17140f"; // outlines, shadows, the type's edge (a warm near-black)
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

// A baton's two bands.
export const BATON_BAND = "#6b4a2b";

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
  track: "rgba(23, 20, 15, 0.28)", // the arc's trace on the ground
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
  track: "rgba(251, 246, 234, 0.28)", // the clock's finger track (PAPER, faint)
  trackLine: "rgba(23, 20, 15, 0.45)", // its dashed middle (INK, faint)
  peak: INK,
  prompt: PAPER,
  promptInk: INK,
  mapGrass: "#5fa43c",
  mapLine: "#ffffff",
  wind: "#ffffff",
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
