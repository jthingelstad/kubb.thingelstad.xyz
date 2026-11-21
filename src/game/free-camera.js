// The free camera's controls (docs/OBSERVER.md): the mouse, fingers and keys of a
// watcher, turned into moves of the orbit in src/render/freecam.js. The Game owns one,
// gives it the wide camera as its lens (Game.applyWide), lets it take the canvas's
// pointers and the keys while it is on (Game.freeOn), and draws through camera().
//
//   mouse   drag: turn round the pitch and raise or lower the eye
//           right drag, middle drag or Shift and drag: move over the pitch
//           wheel (and a trackpad's pinch): closer or farther
//   touch   one finger: turn and raise or lower
//           two fingers: pinch closer or farther, twist to turn, slide to move
//   keys    arrows: turn (left, right) and raise or lower (up, down)
//           W A S D: move over the pitch;  + and -: closer, farther
//           0 or Home: back to the default view
//
// Until the first move it draws the engine's own wide camera untouched: the default
// view is exactly the wide view. RESET VIEW eases back to it (at once with Reduce
// Motion) and then hands the engine's camera back. Nothing is stored.
import {
  freeTune,
  orbitOf,
  clampOrbit,
  cameraOf,
  turn,
  zoom,
  move,
  drag,
  mixOrbit,
  twoFingers,
} from "../render/freecam.js";

const KEYS = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  KeyW: "ahead",
  KeyS: "back",
  KeyA: "west",
  KeyD: "east",
  Equal: "in",
  NumpadAdd: "in",
  Minus: "out",
  NumpadSubtract: "out",
};
const RESET_KEYS = new Set(["Digit0", "Numpad0", "Home"]);

export class FreeCamera {
  // reduced: a MediaQueryList for prefers-reduced-motion (or null)
  constructor({ reduced = null, tune = freeTune } = {}) {
    this.tune = tune;
    this.reduced = reduced;
    this.lens = null; // the wide camera: its lens, and the default orbit
    this.orbit = null; // null: the default view (the lens itself)
    this.ease = null; // { from, t } while easing back to the default
    this.k = 1; // CSS px a frame px (the view's fit), for drags
    this.pointers = new Map(); // id -> { x, y, pan }
    this.held = new Set();
    this.cache = null;
    this.onChange = null; // (moved) => void
  }

  get moved() {
    return !!this.orbit;
  }

  // The wide camera, again on every resize (a turned phone): the lens follows the
  // window, the orbit chosen stays.
  setLens(cam) {
    this.lens = cam || null;
    this.cache = null;
    if (!this.lens) this.cancel();
    else if (this.orbit) this.orbit = clampOrbit(this.orbit, this.tune);
  }

  // The camera to draw through: `base` (the engine's) in the default view.
  camera(base) {
    if (!this.orbit || !this.lens) return base;
    const c = this.cache;
    if (c && c.orbit === this.orbit && c.lens === this.lens) return c.cam;
    const cam = cameraOf(this.orbit, this.lens);
    this.cache = { orbit: this.orbit, lens: this.lens, cam };
    return cam;
  }

  // ---------- moves ----------

  begin() {
    if (!this.lens) return null;
    this.ease = null;
    return this.orbit ?? clampOrbit(orbitOf(this.lens), this.tune);
  }

  set(o) {
    if (!o) return;
    const was = this.moved;
    this.orbit = o;
    if (!was) this.onChange?.(true);
  }

  turnBy(dyaw, dpitch) {
    const o = this.begin();
    if (o) this.set(turn(o, dyaw, dpitch));
  }

  zoomBy(factor) {
    const o = this.begin();
    if (o) this.set(zoom(o, factor));
  }

  moveBy(right, ahead) {
    const o = this.begin();
    if (o) this.set(move(o, right, ahead));
  }

  // a drag of the ground by CSS px
  dragBy(dx, dy) {
    const o = this.begin();
    if (o && this.lens)
      this.set(drag(o, dx / this.k, dy / this.k, this.lens.f));
  }

  // RESET VIEW: back to the default, eased unless Reduce Motion is on.
  reset() {
    if (!this.orbit) return;
    if (this.reduced?.matches || !this.lens) return this.home();
    this.ease = { from: this.orbit, t: 0 };
  }

  home() {
    this.ease = null;
    const was = this.moved;
    this.orbit = null;
    this.cache = null;
    if (was) this.onChange?.(false);
  }

  // Let go of every pointer and key (the camera stays where it is).
  cancel() {
    this.pointers.clear();
    this.held.clear();
  }

  // ---------- each frame ----------

  tick(dt) {
    if (!this.lens || !(dt > 0)) return;
    const t = this.tune;
    if (this.ease) {
      this.ease.t = Math.min(1, this.ease.t + dt / t.resetTime);
      const goal = clampOrbit(orbitOf(this.lens), t);
      const s = this.ease.t;
      const e = s * s * (3 - 2 * s);
      if (s >= 1) return this.home();
      this.orbit = mixOrbit(this.ease.from, goal, e);
      return;
    }
    if (!this.held.size) return;
    const h = (n) => (this.held.has(n) ? 1 : 0);
    const yaw = (h("left") - h("right")) * t.keyTurn * dt;
    const pitch = (h("up") - h("down")) * t.keyTilt * dt;
    if (yaw || pitch) this.turnBy(yaw, pitch);
    const o = this.orbit ?? clampOrbit(orbitOf(this.lens), t);
    const step = o.dist * t.keyMove * dt;
    const right = (h("east") - h("west")) * step;
    const ahead = (h("ahead") - h("back")) * step;
    if (right || ahead) this.moveBy(right, ahead);
    const z = h("out") - h("in");
    if (z) this.zoomBy(Math.exp(z * t.keyZoom * dt));
  }

  // ---------- input ----------

  // A pointer pressed on the canvas (CSS px). True when it is taken.
  down({ id, x, y, button = 0, shift = false, mouse = true }) {
    if (!this.lens) return false;
    const pan = mouse && (button === 2 || button === 1 || shift);
    this.pointers.set(id, { x, y, pan });
    return true;
  }

  move({ id, x, y }) {
    const p = this.pointers.get(id);
    if (!p) return false;
    const t = this.tune;
    if (this.pointers.size >= 2) {
      // the other finger stays where it was this event
      const [a, b] = [...this.pointers.entries()];
      const other = a[0] === id ? b[1] : a[1];
      const g = twoFingers(
        [p.x, p.y],
        [other.x, other.y],
        [x, y],
        [other.x, other.y],
      );
      const o = this.begin();
      if (o) {
        let n = zoom(o, 1 / g.scale);
        n = turn(n, g.angle, 0);
        this.set(n);
        this.dragBy(g.dx, g.dy);
      }
    } else if (p.pan) this.dragBy(x - p.x, y - p.y);
    else this.turnBy(-(x - p.x) * t.turnPerPx, (y - p.y) * t.tiltPerPx);
    p.x = x;
    p.y = y;
    return true;
  }

  up({ id }) {
    return this.pointers.delete(id);
  }

  // The wheel: deltaY in px (deltaMode 1 is lines, 2 pages).
  wheel(deltaY, deltaMode = 0) {
    if (!this.lens) return false;
    const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
    this.zoomBy(
      Math.exp(Math.max(-200, Math.min(200, px)) * this.tune.wheelRate),
    );
    return true;
  }

  // A key pressed or let go. True when it is one of the camera's.
  key(code, down) {
    if (RESET_KEYS.has(code)) {
      if (down) this.reset();
      return true;
    }
    const k = KEYS[code];
    if (!k) return false;
    if (down) this.held.add(k);
    else this.held.delete(k);
    return true;
  }
}
