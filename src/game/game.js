// The game on the screen (docs/CLIENT.md): one engine, the canvas, the
// pointer and keys, the HUD, playback, sound and the cards, run by one
// requestAnimationFrame loop in the engine's per-frame pattern (ENGINE.md
// "The frame").
//
// THE MULTIPLAYER SEAM. A Game knows nothing of networks. It is told who may
// act here (the seat), reports every action taken here, and plays actions
// taken elsewhere:
//
//   const game = new Game({ engine, canvas, ui, sound, seat, onAction });
//   seat      { sides: ["A"], cpu: true }  the sides this browser plays, and
//             whether it runs the computer's side (engine.setControl); an
//             optional mayAct(need) overrides the engine's need.local
//   onAction  (action, snapshotText, hash) => void, after every action
//             applied here (a throw, the computer's throw when cpu is true,
//             a raise, a punishment kubb, a resignation)
//   game.applyRemote(action)  an action taken elsewhere: played back here
//                             (queued while a throw plays back)
//   game.showRemoteAim(state) someone else's aim (their aimState())
//   game.adopt(snapshotText)  take a committed snapshot as it is
//   game.aimState()           this browser's aim, to send while aiming
//
// Solo is only this: the local seat owns team A and runs the computer, B.
import {
  drawWorld,
  drawDial,
  drawMinimap,
  drawBurst,
  burstLength,
  dialGeometry,
  armAt,
  hitTest,
  projectView,
  unprojectView,
  project,
} from "./draw.js";
import { layoutFor, worldFit, panFor, isTall, stillFit } from "./layout.js";
import { settleItems, raiseCamera, punishCamera, poseItem } from "./scenes.js";
import { Hud } from "./hud.js";
import { prefs } from "./prefs.js";

export const tune = {
  maxDt: 1 / 20, // s: a longer frame (a hitch, a background tab) is cut to this
  holdAfter: 0.8, // s the pitch rests after a throw before play goes on
  raiseZoom: 1.8, // a tall canvas's raise scene, over the whole frame across
  grabTouch: 56, // px round the target circle a finger grabs it
  grabMouse: 30,
  tapSlop: 10, // px a press may move and still be a tap
  panEase: 5, // 1/s: how quickly a tall view pans after the circle
  remoteAimFresh: 1.5, // s a remote aim stays shown without news
  flagFor: 6, // s a result flag stays up into the next aim
  keyMove: 1, // the move and walk axes from keys
  holdFeed: 1 / 30 - 0.002, // s: a held pointer's arm is fed again after this
};

const ZERO = { dx: 0, dy: 0 };

export class Game {
  constructor({
    engine,
    canvas,
    ui,
    sound = null,
    seat = { sides: ["A"], cpu: true },
    onAction = null,
    cards = null,
  }) {
    this.engine = engine;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ui = ui;
    this.sound = sound;
    this.seat = seat;
    this.onAction = onAction;
    this.cards = cards; // the card host (src/ui/cards.js), set by main
    this.mode = null; // "practice" | "match"
    this.phase = "idle"; // aim | play | raise | punish | over | idle
    this.need = null;
    this.viewData = null;
    this.out = null;
    this.items = [];
    this.queue = [];
    this.modal = 0; // cards and overlays open: no input, no engine time
    this.keys = new Set();
    this.planHeld = false;
    this.planToggle = false;
    this.ptr = null; // the pointer that is pressed: { id, kind, x, y, ... }
    this.dialArm = null;
    this.dialAcc = 0;
    this.dialFresh = false;
    this.remote = null;
    this.result = null; // the last throw's flag, verdicts, rest text
    this.shownCards = new Set();
    this.listeners = [];
    this.panX = 200;
    this.level = prefs.get("level", "club");
    this.raiseSel = null;
    this.punishAt = null;
    this.running = false;
    this.lastT = 0;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.onNeed = null; // (need) => void: main shows the winner card etc.

    this.hud = new Hud(ui, {
      arc: (s) => this.planStep("arc", s),
      side: (s) => this.planStep("side", s),
      skip: () => this.skip(),
    });
    this.bindPlanView(this.hud.planView);
    this.bindInput();
    this.resize();
  }

  // ---------- starting ----------

  newPractice(opts = {}) {
    this.mode = "practice";
    const v = this.engine.newPractice({ level: this.level, ...opts });
    this.engine.setLevel(this.level);
    this.enter(this.engine.view() || v);
  }

  newMatch(opts) {
    this.mode = "match";
    this.engine.newMatch(opts);
    this.engine.setControl(this.seat);
    this.shownCards.clear();
    this.result = null;
    this.enter(this.engine.view());
  }

  setSeat(seat) {
    this.seat = seat;
    if (this.mode === "match") this.engine.setControl(seat);
    this.enter(this.engine.view());
  }

  // ---------- the seam ----------

  aimState() {
    return this.engine.aimState();
  }

  showRemoteAim(state) {
    if (this.phase !== "aim" || this.mayAct()) return;
    try {
      const r = this.engine.showAim(state);
      this.remote = { ...r, at: performance.now() };
    } catch {
      this.remote = null;
    }
  }

  applyRemote(action) {
    if (this.phase === "play") {
      this.queue.push(action);
      return;
    }
    const r = this.engine.apply(action);
    if (r && r.ok === false) return r;
    this.remote = null;
    if (r.recording) this.startPlayback(r.recording, false);
    else this.enter(this.engine.view());
    return r;
  }

  // (A match's snapshot: the seam is for matches.)
  adopt(snapshotText) {
    this.engine.restore(snapshotText);
    this.mode = "match";
    this.engine.setControl(this.seat);
    this.queue.length = 0;
    this.play = null;
    this.enter(this.engine.view());
  }

  emit(action) {
    if (!this.onAction || !action) return;
    let snap = null,
      hash = null;
    if (this.mode === "match") {
      snap = this.engine.snapshot();
      hash = this.engine.hash().hash;
    }
    this.onAction(action, snap, hash);
  }

  mayAct(need = this.need) {
    if (!need) return false;
    if (this.mode === "practice") return true;
    if (this.seat.mayAct) return !!this.seat.mayAct(need);
    return !!need.local && !need.cpu;
  }

  // ---------- states ----------

  // Take the engine's view and go where its need says.
  enter(view) {
    this.viewData = view;
    this.need = view.need;
    this.items = view.items || [];
    this.out = {
      aim: view.aim,
      camera: view.camera,
      dial: view.dial,
    };
    this.remote = null;
    this.dialArm = null;
    const n = this.need;
    if (n.kind === "throw") {
      this.phase = "aim";
      if (this.mode === "match" && this.mayAct())
        this.engine.setLevel(this.level);
    } else if (n.kind === "raise") {
      this.phase = "raise";
      this.raiseSel = null;
      if (this.mode === "match" && !this.mayAct()) this.phase = "wait";
    } else if (n.kind === "punish") {
      this.phase = "punish";
      this.punishAt = { ...n.cursor };
      this.punishCheck = this.engine.checkPunish(n.cursor.x, n.cursor.y);
      if (this.mode === "match" && !this.mayAct()) this.phase = "wait";
    } else if (n.kind === "over") {
      this.phase = "over";
    }
    this.cards?.tick?.(this);
    this.showCard();
    this.onNeed?.(n, this);
  }

  // The engine's cards (hand-off, pass, settle), each shown once.
  showCard() {
    const n = this.need;
    if (!n || !n.card || !this.cards) return;
    const key = `${n.turn}:${n.throws}:${n.kind}:${n.card.kind}`;
    if (this.shownCards.has(key)) return;
    this.shownCards.add(key);
    this.cards.engineCard(n.card, n, this);
  }

  // ---------- the loop ----------

  start() {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const step = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(step);
      if (document.hidden) {
        this.lastT = now;
        return;
      }
      const dt = Math.min(tune.maxDt, Math.max(0, (now - this.lastT) / 1000));
      this.lastT = now;
      try {
        this.tick(dt, now);
      } catch (err) {
        this.running = false;
        this.onError?.(err);
      }
    };
    this.raf = requestAnimationFrame(step);
    this.listen(document, "visibilitychange", () => {
      // back from a hidden tab: start the clock again, never a huge dt
      this.lastT = performance.now();
      if (document.hidden) this.releaseAll();
    });
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    for (const [el, ev, fn, o] of this.listeners)
      el.removeEventListener(ev, fn, o);
    this.listeners = [];
  }

  tick(dt, now) {
    this.resizeIfNeeded();
    if (this.phase === "aim") this.aimFrame(dt, now);
    else if (this.phase === "play") this.playFrame(dt, now);
    else this.drawStill();
    if (this.result) this.result.age += dt;
  }

  // ---------- aiming ----------

  aimFrame(dt, now) {
    const may = this.mayAct();
    const input = { dt };
    if (!this.modal && may) {
      if (this.ptr?.kind === "dial") input.arm = this.dialArm;
      input.plan = this.planHeld || this.planToggle;
      const m = this.keyAxes("ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp");
      const w = this.keyAxes("KeyA", "KeyD", "KeyS", "KeyW");
      if (m.dx || m.dy) input.move = m;
      if (w.dx || w.dy) input.walk = w;
    }
    // While the dial is held, the engine is fed once per pointer sample
    // (with the time since the last), not once per display frame: a pointer
    // that reports at half the frame rate (a busy page, a 120 Hz screen)
    // would otherwise read as a stop-start, shaky swing. A pointer held still
    // sends nothing, so after `holdFeed` the same arm is fed again: the stop.
    let out;
    if (this.modal && may) out = this.out;
    else if (input.arm != null) {
      this.dialAcc += dt;
      if (this.dialFresh || this.dialAcc >= tune.holdFeed) {
        out = this.engine.frame({ ...input, dt: this.dialAcc });
        this.dialAcc = 0;
        this.dialFresh = false;
      } else out = { ...this.out, event: undefined };
    } else {
      this.dialAcc = 0;
      out = this.engine.frame(input);
    }
    if (out.event === "release" && out.action) {
      this.emit(out.action);
      this.startPlayback(out.recording, may, out);
      return;
    }
    if (!out.event) this.out = out;
    else this.out = { ...this.out, ...out };
    if (out.dial && out.dial.phase !== "idle" && this.result)
      this.result.age = Math.max(this.result.age, tune.flagFor - 0.3);

    let aim = out.aim,
      camera = out.camera,
      dial = out.dial;
    const remote =
      this.remote && now - this.remote.at < tune.remoteAimFresh * 1000
        ? this.remote
        : null;
    if (!may && remote) {
      aim = remote.aim || aim;
      camera = remote.camera || camera;
      dial = remote.dial || dial;
    }
    this.drawAim(aim, camera, dial, may, dt);
  }

  keyAxes(left, right, down, up) {
    const k = this.keys;
    const dx = (k.has(right) ? 1 : 0) - (k.has(left) ? 1 : 0);
    const dy = (k.has(up) ? 1 : 0) - (k.has(down) ? 1 : 0);
    return dx || dy ? { dx: dx * tune.keyMove, dy: dy * tune.keyMove } : ZERO;
  }

  planStep(what, step) {
    if (this.phase !== "aim" || !this.mayAct()) return;
    const r =
      what === "arc" ? this.engine.stepArc(step) : this.engine.stepSide(step);
    if (r && r.aim) this.out = { ...this.out, aim: r.aim, camera: r.camera };
  }

  // ---------- playback ----------

  startPlayback(rec, local, out = null) {
    const tl = rec.timeline || {};
    const pid = rec.projectile && rec.projectile.id;
    this.play = {
      rec,
      local,
      t: 0,
      done: false,
      hold: 0,
      knocks: (tl.touches || [])
        .filter((x) => x.id !== pid)
        .sort((a, b) => a.t - b.t),
      ki: 0,
      bursts: (tl.bursts || []).map((b) => ({ ...b, realAt: null })),
      slow: false,
      last: null,
    };
    this.phase = "play";
    this.planToggle = false;
    this.dialArm = null;
    if (this.ptr?.kind === "dial") this.ptr = null;
    this.result = null;
  }

  skip() {
    const p = this.play;
    if (!p) return;
    p.t = p.rec.duration;
    p.knocks.length = 0;
    for (const b of p.bursts) b.realAt = -1;
    p.skipped = true;
  }

  playFrame(dt, now) {
    const p = this.play;
    if (!p.done) {
      const s = this.engine.showAt(p.t);
      p.last = s;
      p.slow = s.speed < 0.99;
      // the knocks: one take each, at each piece's first touch
      while (p.ki < p.knocks.length && p.knocks[p.ki].t <= p.t) {
        const k = p.knocks[p.ki++];
        this.sound?.knock(k.kind === "king" ? 1 : 0.9);
      }
      for (const b of p.bursts) {
        if (b.realAt === null && p.t >= b.start) {
          b.realAt = now;
          if (b.kind === "king") this.sound?.king();
        }
      }
      if (s.done) {
        p.done = true;
        const r = p.rec.result || {};
        this.result = {
          flag: r.flag,
          verdicts: p.local ? r.verdicts : null,
          restText: r.restText,
          age: 0,
        };
      } else p.t += dt * (s.speed || 1);
    } else {
      p.hold += dt;
      p.slow = false;
      const burstsLive = p.bursts.some(
        (b) => b.realAt > 0 && (now - b.realAt) / 1000 < burstLength(b.kind),
      );
      if (p.hold >= tune.holdAfter && !burstsLive) return this.endPlayback();
    }
    const s = p.last;
    if (s) this.drawPlay(s, now);
  }

  endPlayback() {
    this.play = null;
    this.phase = "idle";
    const v = this.engine.view();
    this.enter(v);
    // actions that came in while the throw played
    while (this.queue.length && this.phase !== "play") {
      this.applyRemote(this.queue.shift());
    }
  }

  // ---------- raise and punishment ----------

  raiseAt(x, y) {
    const n = this.need;
    let best = null,
      bd = 0.45;
    (n.ends || []).forEach((e, i) => {
      const d = Math.hypot(e.pose.x - x, e.pose.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  // Stand the kubb on end i (an index into need.ends), or the engine's own
  // choice with null.
  raise(i) {
    const n = this.need;
    if (this.phase !== "raise") return;
    let action;
    if (i == null) action = { type: "raise" };
    else {
      const end = n.ends[i];
      if (!end || end.ok === false) return;
      const ci = (n.choices || []).findIndex((c) => c.which === end.which);
      action = { type: "raise", choice: ci >= 0 ? ci + 1 : undefined };
    }
    const r = this.engine.apply(action);
    if (r.ok === false) return r;
    this.emit(action);
    this.enter(this.engine.view());
    return r;
  }

  punishMove(x, y) {
    const n = this.need;
    const b = n.bounds;
    if (b) {
      x = Math.max(b.xMin, Math.min(b.xMax, x));
      y = Math.max(b.yMin, Math.min(b.yMax, y));
    }
    this.punishAt = { x, y };
    this.punishCheck = this.engine.checkPunish(x, y);
  }

  punish() {
    if (this.phase !== "punish" || !this.punishAt) return;
    const { x, y } = this.punishAt;
    const action = { type: "punish", x, y };
    const r = this.engine.apply(action);
    if (r.ok === false) {
      this.punishCheck = r;
      return r;
    }
    this.emit(action);
    this.enter(this.engine.view());
    return r;
  }

  resign(side) {
    const action = { type: "resign", side };
    const r = this.engine.apply(action);
    if (r.ok === false) return r;
    this.emit(action);
    if (this.phase !== "play") this.enter(this.engine.view());
    return r;
  }

  // ---------- practice ----------

  practiceDo(fn) {
    if (this.mode !== "practice" || this.phase !== "aim") return;
    const v = fn();
    this.result = null;
    this.enter(v && v.need ? v : this.engine.view());
  }

  setLevel(level) {
    this.level = level;
    prefs.set("level", level);
    if (this.phase === "aim" && this.mayAct()) {
      const r = this.engine.setLevel(level);
      if (r && r.aim) this.out = { ...this.out, aim: r.aim, camera: r.camera };
    }
  }

  // ---------- drawing ----------

  get view() {
    return { width: this.W, height: this.H, dpr: this.dpr, fit: this.fit };
  }

  layout() {
    return this.L;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width || window.innerWidth));
    const H = Math.max(1, Math.round(r.height || window.innerHeight));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    const cs = getComputedStyle(document.documentElement);
    const inset = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
    this.L = layoutFor(W, H, {
      top: inset("--safe-top"),
      right: inset("--safe-right"),
      bottom: inset("--safe-bottom"),
      left: inset("--safe-left"),
    });
    this.fit = worldFit(W, H, this.panX);
  }

  resizeIfNeeded() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (
      Math.round(r.width) !== this.W ||
      Math.round(r.height) !== this.H ||
      dpr !== this.dpr
    )
      this.resize();
  }

  // Pan a tall view after frame x fx (eased; frozen while dragging).
  pan(fx, dt, center = false) {
    if (!isTall(this.W, this.H)) {
      this.fit = null;
      return;
    }
    if (!(this.ptr && this.ptr.kind === "target")) {
      const want = center ? 200 : panFor(this.W, this.H, fx);
      const a = dt > 0 ? Math.min(1, dt * tune.panEase) : 1;
      this.panX += (want - this.panX) * a;
    }
    this.fit = worldFit(this.W, this.H, this.panX);
  }

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  css() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  drawAim(aim, camera, dial, may, dt) {
    const v = this.viewData || {};
    const marker = aim.marker && aim.marker.shown !== false ? aim.marker : null;
    if (marker) {
      const p = project(camera, marker.x, marker.y, 0);
      this.pan(p ? p[0] : 200, dt);
    } else this.pan(200, dt, true);
    this.begin();
    const arc = Array.isArray(aim.arc)
      ? aim.arc.map((q) => (Array.isArray(q) ? q : [q.x, q.y, q.z]))
      : null;
    drawWorld(this.ctx, this.view, camera, {
      surface: v.surface,
      set: v.set,
      items: this.items,
      advantageY: aim.advY ?? null,
      marker: marker ? { x: marker.x, y: marker.y, r: marker.r } : null,
      arc,
      thrower: aim.thrower ? { x: aim.thrower.x, y: aim.thrower.y } : null,
    });
    this.css();
    this.drawMap(aim, this.viewData?.minimap?.pieces || this.items);
    const watching = !may || !!aim.watching;
    const st = { ...dial, grabbed: this.ptr?.kind === "dial" };
    if (watching && !st.prompt) st.prompt = "WATCH";
    drawDial(this.ctx, this.L.dial, st);
    const res =
      this.result && this.result.age < tune.flagFor ? this.result : null;
    this.hud.update({
      aim,
      need: this.need,
      aiming: !this.modal && !this.cards?.open,
      mayAct: may && !watching,
      plan: this.planHeld || this.planToggle,
      practice: this.mode === "practice",
      watching,
      flag: res && res.flag,
      verdicts: res && res.verdicts,
      restText: res && res.restText,
      layout: this.L,
    });
  }

  drawMap(aim, pieces, extra = {}) {
    const v = this.viewData || {};
    drawMinimap(this.ctx, this.L.minimap, {
      items: pieces,
      thrower: aim?.thrower || null,
      aim: aim?.marker ? { x: aim.marker.x, y: aim.marker.y } : null,
      marker: aim?.marker?.shown !== false ? aim?.marker : null,
      advantageY: aim?.advY ?? v.minimap?.advY ?? null,
      wind: aim?.wind || v.minimap?.wind || null,
      surface: v.surface,
      ...extra,
    });
  }

  drawPlay(s, now) {
    const p = this.play;
    const v = this.viewData || {};
    // a tall view keeps the pan it had at the release
    this.pan(this.panX, 0);
    this.begin();
    drawWorld(this.ctx, this.view, s.camera, {
      surface: v.surface,
      set: v.set,
      items: s.items,
      advantageY: this.out?.aim?.advY ?? null,
    });
    this.css();
    const pid = p.rec.projectile && p.rec.projectile.id;
    const proj = s.items.find((it) => it.id === pid);
    this.drawMap(null, s.items, {
      baton: proj ? { x: proj.x, y: proj.y } : null,
      advantageY: this.out?.aim?.advY ?? null,
      wind: this.out?.aim?.wind || null,
    });
    if (s.dial) drawDial(this.ctx, this.L.dial, { ...s.dial, prompt: null });
    // the bursts at their anchors, in real time
    const size = Math.max(90, Math.min(this.W, this.H) * 0.3);
    for (const b of p.bursts) {
      if (!(b.realAt > 0)) continue;
      const pt = projectView(
        this.view,
        s.camera,
        b.anchor.x,
        b.anchor.y,
        b.anchor.z,
      );
      if (!pt) continue;
      drawBurst(this.ctx, pt[0], pt[1], b.kind, (now - b.realAt) / 1000, {
        size,
      });
    }
    const res = this.result;
    this.hud.update({
      aim: this.out?.aim,
      need: this.need,
      playing: !p.done,
      slow: p.slow,
      practice: this.mode === "practice",
      flag: res && res.flag,
      verdicts: res && res.verdicts,
      restText: res && res.restText,
      layout: this.L,
    });
  }

  drawStill() {
    const n = this.need;
    if (!n) return;
    const v = this.viewData || {};
    const still = n.kind === "raise" || n.kind === "punish";
    if (still)
      this.fit = stillFit(
        this.W,
        this.H,
        n.kind === "raise" ? tune.raiseZoom : 1,
      );
    else this.pan(200, 0, true);
    this.begin();
    if (n.kind === "raise") {
      const sel = this.raiseSel;
      const end = sel != null ? n.ends[sel] : null;
      const pose = end ? { ...end.pose, standing: true } : n.pose;
      drawWorld(this.ctx, this.view, raiseCamera(n), {
        surface: v.surface,
        set: v.set,
        items: settleItems(n, pose),
        footprints: (n.ends || []).map((e, i) => ({
          x: e.pose.x,
          y: e.pose.y,
          angle: e.pose.angle,
          chosen: i === sel,
          allowed: e.ok !== false,
        })),
      });
      this.css();
      this.drawEndLabels(n);
    } else if (n.kind === "punish") {
      const at = this.punishAt || n.cursor;
      const ok = !this.punishCheck || this.punishCheck.ok !== false;
      const items = settleItems(n, null);
      items.push(
        poseItem(n.kubb, "kubb", {
          x: at.x,
          y: at.y,
          standing: true,
          angle: 0,
        }),
      );
      drawWorld(this.ctx, this.view, punishCamera(n), {
        surface: v.surface,
        set: v.set,
        items,
        keepOut: (n.keepOut || []).map((k) => ({ x: k.x, y: k.y, r: k.r })),
        footprints: [{ x: at.x, y: at.y, angle: 0, chosen: true, allowed: ok }],
      });
      this.css();
    } else {
      drawWorld(this.ctx, this.view, v.camera || this.out?.camera, {
        surface: v.surface,
        set: v.set,
        items: this.items,
      });
      this.css();
    }
    this.cards?.tick?.(this);
    this.hud.update({
      aim: n.kind === "throw" ? this.out?.aim : null,
      need: n,
      watching: this.phase === "wait",
      practice: this.mode === "practice",
      layout: this.L,
    });
  }

  // The ends' letters beside their footprints on the raise screen.
  drawEndLabels(n) {
    const ctx = this.ctx;
    const cam = raiseCamera(n);
    (n.ends || []).forEach((e, i) => {
      // a little beyond the footprint, along the kubb from its middle
      const dx = e.pose.x - n.pose.x,
        dy = e.pose.y - n.pose.y;
      const l = Math.hypot(dx, dy) || 1;
      const pt = projectView(
        this.view,
        cam,
        e.pose.x + (dx / l) * 0.07,
        e.pose.y + (dy / l) * 0.07,
        0,
      );
      if (!pt) return;
      const r = 17;
      ctx.fillStyle = "#17140f";
      ctx.beginPath();
      ctx.arc(pt[0] + 3, pt[1] + 3, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle =
        e.ok === false
          ? "#c9c2b0"
          : i === this.raiseSel
            ? "#f2b705"
            : "#fbf6ea";
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#17140f";
      ctx.stroke();
      ctx.fillStyle = "#17140f";
      ctx.font = `22px "Londrina Solid", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), pt[0], pt[1] + 1);
    });
  }

  // Where the ends' labels sit in view px (for taps and tests).
  endPoints() {
    const n = this.need;
    if (!n || n.kind !== "raise") return [];
    const cam = raiseCamera(n);
    return (n.ends || []).map((e) => {
      const p = projectView(this.view, cam, e.pose.x, e.pose.y, 0);
      return p ? { x: p[0], y: p[1], ok: e.ok !== false } : null;
    });
  }

  // ---------- input ----------

  listen(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    this.listeners.push([el, ev, fn, opts]);
  }

  bindInput() {
    const c = this.canvas;
    this.listen(c, "pointerdown", (e) => this.down(e));
    this.listen(c, "pointermove", (e) => this.move(e));
    this.listen(c, "pointerup", (e) => this.up(e, false));
    this.listen(c, "pointercancel", (e) => this.up(e, true));
    this.listen(c, "lostpointercapture", (e) => {
      if (this.ptr && this.ptr.id === e.pointerId) this.up(e, true);
    });
    this.listen(c, "contextmenu", (e) => e.preventDefault());
    this.listen(window, "keydown", (e) => this.keyDown(e));
    this.listen(window, "keyup", (e) => this.keys.delete(e.code));
    this.listen(window, "blur", () => this.releaseAll());
    this.listen(window, "resize", () => this.resize());
    this.listen(window, "orientationchange", () => this.resize());
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    this.sound?.unlock();
    if (this.modal || this.ptr) return;
    const { x, y } = this.pos(e);
    const touch = e.pointerType !== "mouse";
    let kind = null;
    if (this.phase === "aim" && this.mayAct()) {
      const g = dialGeometry(this.L.dial);
      const aim = this.out?.aim || {};
      if (hitTest(g, x, y)) kind = "dial";
      else if (
        this.near(aim.marker, x, y, touch ? tune.grabTouch : tune.grabMouse)
      )
        kind = "target";
      else if (this.near(aim.thrower, x, y, touch ? 44 : 26)) kind = "stance";
      else kind = "tap";
      if (kind === "dial") {
        this.dialArm = armAt(g, x, y);
        this.dialFresh = true;
        this.dialAcc = 0;
        this.planToggle = false;
      }
    } else if (this.phase === "raise" || this.phase === "punish") {
      kind = this.phase;
      if (kind === "punish") this.punishPointer(x, y);
    } else if (this.phase === "play") kind = "none";
    if (!kind) return;
    e.preventDefault();
    this.ptr = { id: e.pointerId, kind, x0: x, y0: y, x, y, moved: false };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
  }

  // A ground point's place on the screen (CSS px) under the aim camera.
  screenOf(pt) {
    if (!pt || !this.out?.camera) return null;
    const p = projectView(this.view, this.out.camera, pt.x, pt.y, 0);
    return p ? { x: p[0], y: p[1] } : null;
  }

  near(pt, x, y, r) {
    const p = this.screenOf(pt);
    return !!p && Math.hypot(p.x - x, p.y - y) <= r;
  }

  ground(x, y, cam = this.out?.camera) {
    return cam ? unprojectView(this.view, cam, x, y) : null;
  }

  move(e) {
    const p = this.ptr;
    if (!p || p.id !== e.pointerId) return;
    // the latest of the coalesced events: the loop samples it once a frame
    const { x, y } = this.pos(e);
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.x0, y - p.y0) > tune.tapSlop) p.moved = true;
    if (p.kind === "dial") {
      this.dialArm = armAt(dialGeometry(this.L.dial), x, y);
      this.dialFresh = true;
    } else if (p.kind === "target") {
      const g = this.ground(x, y);
      if (g) this.aimResult(this.engine.setTarget(g.x, g.y, false));
    } else if (p.kind === "stance") {
      const g = this.ground(x, y);
      if (g) this.aimResult(this.engine.setStance(g.x, g.y));
    } else if (p.kind === "punish") this.punishPointer(x, y);
  }

  up(e, cancelled) {
    const p = this.ptr;
    if (!p || p.id !== e.pointerId) return;
    this.ptr = null;
    if (p.kind === "dial")
      this.dialArm = null; // the release
    else if (p.kind === "target" && !cancelled) {
      const g = this.ground(p.x, p.y);
      if (g) this.aimResult(this.engine.setTarget(g.x, g.y, true));
    } else if (p.kind === "tap" && !p.moved && !cancelled) {
      // a tap on the pitch puts the circle there
      const g = this.ground(p.x, p.y);
      if (g && g.y > 0.5) this.aimResult(this.engine.setTarget(g.x, g.y, true));
    } else if (p.kind === "raise" && !p.moved && !cancelled) {
      const n = this.need;
      const g = this.ground(p.x, p.y, raiseCamera(n));
      let i = g ? this.raiseAt(g.x, g.y) : null;
      if (i == null) {
        // or the end's label
        this.endPoints().forEach((q, j) => {
          if (q && Math.hypot(q.x - p.x, q.y - p.y) < 40) i = j;
        });
      }
      if (i != null) this.raise(i);
    }
  }

  punishPointer(x, y) {
    const g = this.ground(x, y, punishCamera(this.need));
    if (g) this.punishMove(g.x, g.y);
  }

  aimResult(r) {
    if (r && r.aim) this.out = { ...this.out, aim: r.aim, camera: r.camera };
  }

  releaseAll() {
    this.keys.clear();
    this.planHeld = false;
    if (this.ptr) {
      this.ptr = null;
      this.dialArm = null;
    }
  }

  keyDown(e) {
    if (this.modal || e.metaKey || e.ctrlKey || e.altKey) return;
    const code = e.code;
    const aimKeys = [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "KeyA",
      "KeyD",
      "KeyW",
      "KeyS",
    ];
    if (aimKeys.includes(code)) {
      this.keys.add(code);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (code === "KeyR") this.planStep("arc", 1);
    else if (code === "KeyF") this.planStep("arc", -1);
    else if (code === "KeyQ") this.planStep("side", -1);
    else if (code === "KeyE") this.planStep("side", 1);
    else if (code === "ShiftLeft" || code === "ShiftRight" || code === "KeyB") {
      this.planHeld = true;
      const up = (u) => {
        if (u.code === code) {
          this.planHeld = false;
          window.removeEventListener("keyup", up);
        }
      };
      window.addEventListener("keyup", up);
    } else if (code === "Space" && this.phase === "play") this.skip();
    else return;
    e.preventDefault();
  }

  // PLAN VIEW: held with a mouse, a toggle on touch.
  bindPlanView(btn) {
    btn.addEventListener("pointerdown", (e) => {
      this.sound?.unlock();
      if (e.pointerType === "mouse") {
        this.planHeld = true;
        const up = () => {
          this.planHeld = false;
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointerup", up);
      } else {
        this.planToggle = !this.planToggle;
      }
    });
  }
}
