// The tray's plates (src/game/tray.js; the 1.0 design, "Aim layout"): each
// plate's band and spoken name from the engine's aim, and its picture. The
// plates in the page, opening one at a time and closing on Escape, are
// plan-client.test.mjs's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATES, plateWords, platePicture } from "../../src/game/tray.js";

const aim = (over = {}) => ({
  projectile: "baton",
  plan: { loft: 22, tilt: 0, spin: 0 },
  controls: {
    tilt: { min: -20, max: 20, value: 0, tick: 1, step: 5 },
    spin: { min: -3, max: 3, value: 0, tick: 0.1, step: 1 },
  },
  thrower: { x: 0, y: 0 },
  lineY: 0,
  forwardY: 0,
  halfWidth: 2.5,
  backMax: 3,
  ...over,
});

test("three plates, top to bottom: ARC, TILT (or SPIN), STAND", () => {
  assert.deepEqual(PLATES, ["arc", "side", "stand"]);
});

test("each plate's band and its spoken name", () => {
  assert.deepEqual(plateWords("arc", aim()), {
    head: "ARC 22°",
    label: "Arc, 22 degrees",
  });
  assert.deepEqual(plateWords("side", aim()), {
    head: "TILT 0",
    label: "Tilt, none",
  });
  const leaned = aim({
    plan: { loft: 22, tilt: 7 },
    controls: { tilt: { min: -20, max: 20, value: 7, tick: 1, step: 5 } },
  });
  assert.deepEqual(plateWords("side", leaned), {
    head: "TILT 7R",
    label: "Tilt, 7 degrees right",
  });
  const kubb = aim({
    projectile: "kubb",
    plan: { loft: 30, spin: -1.3 },
    controls: { spin: { min: -3, max: 3, value: -1.3, tick: 0.1, step: 1 } },
  });
  assert.deepEqual(plateWords("side", kubb), {
    head: "SPIN 1.3L",
    label: "Spin, 1.3 left",
  });
  assert.deepEqual(plateWords("stand", aim()), {
    head: "STAND",
    label: "Stand, middle, on the line",
  });
  assert.equal(
    plateWords("stand", aim({ thrower: { x: -1.2, y: -0.5 } })).label,
    "Stand, 1.2 metres left, 0.5 m back",
  );
});

test("each plate's picture follows its value", () => {
  // the planned arc rises with the loft
  const low = platePicture("arc", aim({ plan: { loft: 10 } }));
  const high = platePicture("arc", aim({ plan: { loft: 50 } }));
  const peak = (svg) => Number(/Q35 (-?[\d.]+)/.exec(svg)[1]);
  assert.ok(peak(high) < peak(low), "a higher loft draws a higher arc");
  assert.match(low, /stroke-dasharray/, "dashed, as the side view draws it");
  // the baton leans by the tilt
  assert.match(
    platePicture("side", aim({ plan: { tilt: 10 } })),
    /rotate\(10\.0 35 16\)/,
  );
  // a kubb's spin: an arrow the way it spins, none at 0
  const spun = platePicture(
    "side",
    aim({ projectile: "kubb", plan: { spin: 2 } }),
  );
  assert.match(spun, /<path d="M22 6/);
  assert.doesNotMatch(
    platePicture("side", aim({ projectile: "kubb", plan: { spin: 0 } })),
    /<path/,
  );
  // the ring where the thrower stands, across the line
  const at = (x) =>
    Number(
      /circle cx="([\d.]+)"/.exec(
        platePicture("stand", aim({ thrower: { x, y: 0 } })),
      )[1],
    );
  assert.ok(at(-2) < at(0) && at(0) < at(2));
  assert.equal(at(0), 35);
});
