// HOW TO THROW: four short steps with a small dial that swings by itself
// (wind back up the left, swing through, let go). Shown on the first visit
// and from the menu; remembered once dismissed.
import { h, button } from "./dom.js";
import { drawDial } from "../render/dial.js";
import { prefs } from "../game/prefs.js";

const STEPS = [
  {
    swipe: [
      "Start on the dial or the grass",
      "Close this guide to play. Touch the wooden knob or the grass in the lower half of the screen, then pull straight down.",
    ],
    title: "Grab the dial",
    text: "Press on the big dial and keep holding. The arm follows your finger or mouse round its centre.",
    arm: (t) => -10 * Math.min(1, t * 2),
  },
  {
    swipe: [
      "Pull down to wind back",
      "Pull straight down until the dial’s arm reaches the orange mark. A deeper pull gives you more power.",
    ],
    title: "Wind back up the left",
    text: "Drag up the left side to the orange mark. How far back is how hard you throw.",
    arm: (t) => -10 - 110 * ease(Math.min(1, t)),
  },
  {
    swipe: [
      "Flick up and lift",
      "Flick straight up past where you started. Lift at the blue mark to release. Return slowly to let the arm down.",
    ],
    title: "Swing through and let go",
    text: "Sweep quickly down through the bottom and up the right, then let go on the blue mark. Where you let go is the arc.",
    arm: (t) => (t < 0.6 ? -120 + 210 * ease(t / 0.6) : 90),
    release: true,
  },
  {
    title: "Aim if you like",
    text: "Drag the target circle on the pitch. WALK, then drag on the pitch, moves the thrower along the line or back (keys: WASD). ARC and TILT sit beside the dial. Or just throw: the circle starts on a good target.",
    arm: () => 0,
  },
];

function ease(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function shouldShowHowto() {
  return !prefs.get("howtoSeen", false);
}

export function showHowto(root, game = null, onDone = null) {
  let i = 0;
  let raf = 0;
  let t0 = performance.now();
  const canvas = h("canvas.howto-dial", { width: 180, height: 200 });
  const title = h("h3.display");
  const text = h("p");
  const count = h("p.kicker");
  const next = button("NEXT", () => go(i + 1), "go", {
    "data-default": true,
    "data-test": "howto-next",
  });
  const back = button("BACK", () => go(i - 1));
  const card = h(
    "div.card.howto",
    { "data-test": "howto", role: "dialog", "aria-label": "How to throw" },
    h("h2.display", "How to throw"),
    h("div.howto-body", canvas, h("div", count, title, text)),
    h(
      "div.row",
      back,
      next,
      button("CLOSE", () => done(), "plain", { "data-test": "howto-close" }),
    ),
  );
  const scrim = h("div.scrim", card);
  root.append(scrim);
  if (game) game.modal++;

  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = 180 * dpr;
  canvas.height = 200 * dpr;
  const ctx = canvas.getContext("2d");
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const s = STEPS[i];
    const t = ((now - t0) / 1000) % 2.2;
    const arm = s.arm(Math.min(1, t / 1.6));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 180, 200);
    const prompt = i === 1 ? "WIND BACK" : i === 2 ? "FLICK!" : null;
    drawDial(
      ctx,
      { x: 0, y: 0, width: 180, height: 200 },
      {
        phase: i === 1 || i === 2 ? "winding" : "idle",
        arm,
        crank: arm,
        back: i === 2 ? 120 : Math.max(0, -arm),
        powerLo: 112,
        powerHi: 128,
        releaseLo: 72,
        releaseHi: 108,
        deadDeg: 30,
        overDeg: 150,
        lastBack: null,
        lastStop: null,
        prompt,
        grabbed: i < 3 && !(s.release && t > 1.0),
      },
    );
  };
  function go(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    if (n >= STEPS.length) return done();
    t0 = performance.now();
    count.textContent = `${i + 1} OF ${STEPS.length}`;
    const step = STEPS[i];
    const swipe = game?.touchPrompts && step.swipe;
    title.textContent = swipe ? swipe[0] : step.title;
    text.textContent = swipe ? swipe[1] : step.text;
    back.disabled = i === 0;
    next.textContent = i === STEPS.length - 1 ? "PLAY" : "NEXT";
  }
  function done() {
    cancelAnimationFrame(raf);
    scrim.remove();
    prefs.set("howtoSeen", true);
    if (game) game.modal = Math.max(0, game.modal - 1);
    window.removeEventListener("keydown", esc);
    onDone?.();
  }
  const esc = (e) => {
    if (e.key === "Escape") done();
  };
  window.addEventListener("keydown", esc);
  go(0);
  raf = requestAnimationFrame(frame);
  requestAnimationFrame(() => next.focus({ preventScroll: true }));
  return done;
}
