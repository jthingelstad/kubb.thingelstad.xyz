// HOW TO THROW: four short steps with a small dial that swings by itself
// (wind back up the left, swing through, let go). Shown on the first visit
// and from the menu; remembered once dismissed. With the linear meter on the
// screen (MENU, Meter) the steps and the picture are that meter's.
import { h, button } from "./dom.js";
import { drawDial } from "../render/dial.js";
import { drawLinear } from "../render/linear.js";
import { prefs } from "../game/prefs.js";

const STEPS = [
  {
    swipe: [
      "Start on the dial or the grass",
      "Close this guide to play. Touch the wooden knob or the grass in the lower half of the screen, then pull straight down.",
    ],
    linear: [
      "Grab the knob",
      "Press on the wooden knob in the middle of the meter, or anywhere in the lower part of the screen, and keep holding. The knob follows your finger or mouse down and up, so you can watch the meter while you stroke.",
    ],
    touch: [
      "Grab the dial",
      "Press on the big dial, or just outside its rim, and keep holding. The arm follows your finger round its centre, so a finger outside the ring leaves the marks in view.",
    ],
    title: "Grab the dial",
    text: "Press on the big dial and keep holding. The arm follows your finger or mouse round its centre.",
    arm: (t) => -10 * Math.min(1, t * 2),
  },
  {
    swipe: [
      "Pull down to wind back",
      "Pull straight down until the dial’s arm reaches the stripes. A deeper pull gives you more power.",
    ],
    linear: [
      "Draw back",
      "Drag the knob down to the stripes. How far back is how hard you throw.",
    ],
    title: "Wind back up the left",
    text: "Drag up the left side to the stripes. How far back is how hard you throw.",
    arm: (t) => -10 - 110 * ease(Math.min(1, t)),
  },
  {
    swipe: [
      "Flick up and lift",
      "Flick straight up past where you started. Lift at the solid mark to release. Return slowly to let the arm down.",
    ],
    linear: [
      "Fling forward and let go",
      "Sweep quickly up through the middle, then let go on the solid mark. Where you let go is the arc.",
    ],
    title: "Swing through and let go",
    text: "Sweep quickly down through the bottom and up the right, then let go on the solid mark. Where you let go is the arc.",
    arm: (t) => (t < 0.6 ? -120 + 210 * ease(t / 0.6) : 90),
    release: true,
  },
  {
    linear: [
      "Aim if you like",
      "Tap the pitch to put the target circle there, or drag to move it. Slide ARC and TILT beside the meter; drag the ring on STAND to stand somewhere else. Or just throw: the circle starts on a good target.",
    ],
    title: "Aim if you like",
    text: "Tap the pitch to put the target circle there, or drag to move it. Slide ARC and TILT beside the dial; drag the ring on STAND to stand somewhere else. Or just throw: the circle starts on a good target.",
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
  // where the keyboard was, to go back to when the guide closes
  const opener = document.activeElement;
  let t0 = performance.now();
  // the picture is the meter on the screen: the linear one is tall and narrow
  const linear = game?.L?.meter === "linear";
  // and at the side it is on (MENU, Side): its prompt hangs toward the middle
  const left = linear && game?.L?.meterSide === "left";
  const [cw, ch] = linear ? [180, 250] : [180, 200];
  const canvas = h(linear ? "canvas.howto-dial.linear" : "canvas.howto-dial", {
    width: cw,
    height: ch,
  });
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
      "div.row.howto-row",
      button("CLOSE", () => done(), "quiet", { "data-test": "howto-close" }),
      back,
      next,
    ),
  );
  const scrim = h("div.scrim.howto-scrim", card);
  root.append(scrim);
  if (game) game.modal++;

  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  const ctx = canvas.getContext("2d");
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const s = STEPS[i];
    const t = ((now - t0) / 1000) % 2.2;
    const arm = s.arm(Math.min(1, t / 1.6));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const prompt = linear
      ? [null, "DRAW BACK", "FLING!"][i] || null
      : i === 1
        ? "WIND BACK"
        : i === 2
          ? "FLICK!"
          : null;
    (linear ? drawLinear : drawDial)(
      ctx,
      // (the prompt's plate is on the meter's inner side: the room is for it)
      linear
        ? { x: left ? 4 : 104, y: 0, width: 72, height: ch }
        : { x: 0, y: 0, width: cw, height: ch },
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
      left ? "left" : "right",
    );
  };
  function go(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    if (n >= STEPS.length) return done();
    t0 = performance.now();
    count.textContent = `${i + 1} OF ${STEPS.length}`;
    const step = STEPS[i];
    const words = linear
      ? step.linear
      : (game?.touchPrompts && step.swipe) ||
        (game?.L?.track && step.touch) ||
        null;
    title.textContent = words ? words[0] : step.title;
    text.textContent = words ? words[1] : step.text;
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
    // the keyboard goes to the card the guide stood over (a first visit's hand-off,
    // which waited out of sight under it), else back where it was
    requestAnimationFrame(() => {
      const under = root.querySelector(".card-layer [data-default]");
      const back =
        opener && opener !== document.body && opener.isConnected
          ? opener
          : null;
      (under ?? back)?.focus({ preventScroll: true });
    });
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
