// Helpers for the browser tests (tests/game/client.test.mjs) and the
// screenshot and swing-feel runs: build dist once, serve it through
// tools/preview.mjs on a free 127.0.0.1 port, and drive the game's dial with
// a scripted pointer.
import fs from "node:fs/promises";
import { chromium, devices } from "playwright";
import { buildSite } from "../../tools/build.mjs";
import { startPreview } from "../../tools/preview.mjs";

export const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 768 }, deviceScaleFactor: 1 },
  // Headless Chrome keeps a window at least ~500 px wide: a phone is emulated
  // with isMobile and touch, which lays the page out at the device's width.
  portrait: {
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  landscape: {
    ...devices["iPhone 13 landscape"],
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

// Each test file runs in its own process, so two may build at once: the build
// runs under a lock, and each process serves its own copy of what it built
// (build/test-dist-<pid>, removed on close), so another file's rebuild never
// changes the files under a running test.
export async function serve({ build = true } = {}) {
  let root = "dist";
  if (build) {
    root = `build/test-dist-${process.pid}`;
    await withLock("build/dist.lock", async () => {
      await buildSite({ quiet: true });
      await fs.rm(root, { recursive: true, force: true });
      await fs.cp("dist", root, { recursive: true });
    });
  }
  const server = await startPreview({ port: 0, root });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  return {
    base,
    browser,
    async close() {
      await browser.close();
      await new Promise((r) => server.close(r));
      if (root !== "dist") await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function withLock(dir, fn, staleMs = 180000) {
  await fs.mkdir("build", { recursive: true });
  for (;;) {
    try {
      await fs.mkdir(dir);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const st = await fs.stat(dir).catch(() => null);
      if (st && Date.now() - st.mtimeMs > staleMs)
        await fs.rm(dir, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// A page on `path`, with its console errors collected in page.errors.
export async function open(env, path, kind = "desktop") {
  const ctx = await env.browser.newContext(VIEWPORTS[kind]);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(env.base + path);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  return page;
}

export const state = (page) =>
  page.evaluate(() => {
    const g = window.__kubb.game;
    return {
      phase: g.phase,
      need: g.need,
      modal: g.modal,
      marker: g.out?.aim?.marker,
      dial: g.out?.dial,
      plan: g.out?.aim?.plan,
    };
  });

export async function dialGeometry(page) {
  return page.evaluate(() => {
    const g = window.__kubb.game;
    const d = g.L.dial;
    // the same as render/dial dialGeometry
    const pad = Math.min(d.width, d.height) * 0.04;
    const r = Math.max(
      4,
      Math.min((d.width - 2 * pad) / 2.12, (d.height - 2 * pad) / 2.54),
    );
    return { cx: d.x + d.width / 2, cy: d.y + d.height - pad - r * 1.06, r };
  });
}

function at(g, arm, R) {
  const a = (arm * Math.PI) / 180;
  return [g.cx + R * Math.sin(a), g.cy + R * Math.cos(a)];
}

// The arm angles of a swing, one a frame: from 6 o'clock back to `back`
// degrees at `backDps`, then forward through the bottom to `stop` at
// `flickDps`. hold: frames held at the stop before letting go.
export function sweep({
  back,
  stop,
  backDps = 450,
  flickDps = 1800,
  hold = 0,
}) {
  const arms = [0];
  for (let a = 0; a > -back;)
    arms.push((a = Math.max(-back, a - backDps / 60)));
  for (let i = 0; i < 3; i++) arms.push(-back);
  for (let a = -back; a < stop;)
    arms.push((a = Math.min(stop, a + flickDps / 60)));
  for (let i = 0; i < hold; i++) arms.push(stop);
  return arms;
}

// Drive the dial with the mouse (or touch, via CDP touch events), a frame
// at a time: press at the first arm, move through the rest, let go.
export async function swing(page, arms, { touch = false, radius = 0.7 } = {}) {
  const g = await dialGeometry(page);
  const R = g.r * radius;
  const pts = arms.map((a) => at(g, a, R));
  if (!touch) {
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) {
      await page.mouse.move(x, y);
      await nextFrame(page);
    }
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    const tp = ([x, y]) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: tp(pts[0]),
    });
    for (const p of pts.slice(1)) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: tp(p),
      });
      await nextFrame(page);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }
}

// The same swing from inside the page: one pointer event each animation
// frame, as a browser delivers a real drag (coalesced to the frame). The
// Playwright mouse above needs two frames a step (a round trip each), so
// this is the one the swing-feel numbers use.
export async function swingInPage(
  page,
  arms,
  { radius = 0.7, type = "mouse" } = {},
) {
  const g = await dialGeometry(page);
  const R = g.r * radius;
  const pts = arms.map((a) => at(g, a, R));
  await page.evaluate(
    ({ pts, type }) =>
      new Promise((done) => {
        const c = document.getElementById("pitch");
        const ev = (name, [x, y]) =>
          c.dispatchEvent(
            new PointerEvent(name, {
              clientX: x,
              clientY: y,
              pointerId: 7,
              pointerType: type,
              isPrimary: true,
              bubbles: true,
              cancelable: true,
              buttons: name === "pointerup" ? 0 : 1,
            }),
          );
        ev("pointerdown", pts[0]);
        let i = 1;
        const step = () => {
          if (i < pts.length) {
            ev("pointermove", pts[i++]);
            requestAnimationFrame(step);
          } else {
            ev("pointerup", pts[pts.length - 1]);
            done();
          }
        };
        requestAnimationFrame(step);
      }),
    { pts, type },
  );
}

export const nextFrame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

// Wait for the game's phase (polling), up to ms.
export async function waitPhase(page, phases, ms = 20000) {
  const want = [].concat(phases);
  await page.waitForFunction(
    (w) => w.includes(window.__kubb.game.phase),
    want,
    { timeout: ms, polling: 50 },
  );
}

// Record what the game saw of the last throw: the recording's result.
export async function watchThrows(page) {
  await page.evaluate(() => {
    const g = window.__kubb.game;
    window.__throws = [];
    const start = g.startPlayback.bind(g);
    g.startPlayback = (rec, local, out) => {
      window.__throws.push({
        local,
        result: rec.result,
        duration: rec.duration,
      });
      return start(rec, local, out);
    };
  });
}
