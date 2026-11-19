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
//   game.whoActs(need)        optional { text, mine } for the HUD (a shared
//                             pitch, src/net/pitch.js)
//   game.trail                what a report replays from (src/net/report.js):
//                             a match's starting snapshot and every action
//                             applied here since (with the engine's hash
//                             after each), the snapshot before the
//                             last one; practice's options and every throw
//                             and pitch change since it was set out
//
// Solo is only this: the local seat owns team A and runs the computer, B.
// The computer against itself: the seat owns no side and runs the computer,
// and `unattended` is set, so the match goes on in a hidden tab too.
import {
  drawWorld,
  drawDial,
  drawMinimap,
  drawBurst,
  burstLength,
  dialGeometry,
  armAt,
  hitTest,
  trackHit,
  drawLinear,
  linearGeometry,
  armAtY,
  knobHit,
  bodyHit,
  linearTune,
  drawNudge,
  fingerAt,
  projectView,
  unprojectView,
  project,
} from "./draw.js";
import {
  layoutFor,
  worldFit,
  panFor,
  isTall,
  stillFit,
  wideBox,
} from "./layout.js";
import { settleItems, raiseCamera, punishCamera, poseItem } from "./scenes.js";
import { Hud } from "./hud.js";
import { releaseAt, sideStepAt, sideStepOf } from "./plan-sliders.js";
import { prefs } from "./prefs.js";
import { NudgeTrigger, timeline, swingOf, captionFor } from "./nudge.js";
import {
  newAutoRaise,
  setGame,
  restOfTurn,
  refused,
  reset as resetAutoRaise,
  step as stepAutoRaise,
} from "./auto-raise.js";

export const tune = {
  maxDt: 1 / 20, // s: a longer frame (a hitch, a background tab) is cut to this
  holdAfter: 0.8, // s the pitch rests after a throw before play goes on
  raiseZoom: 1.8, // a tall canvas's raise scene, over the whole frame across
  grabTouch: 56, // px round the target circle a finger grabs it
  grabMouse: 30,
  tapSlop: 10, // px a press may move and still be a tap
  // s the side view stays out after a plan slider is let go, so the player
  // sees what the change did without a second button
  slidePeek: 0.5,
  // The linear meter's throw zone (Jamie, 2026-11-19: "if you can have the
  // control and the touch be slightly distant from each other"): a drag
  // that starts this far down the canvas or lower drives the knob as a grab
  // of the knob does, so the finger works away from the meter it watches.
  // Targets are always in the far half of the pitch: on a phone held
  // upright the centre line is at 0.54 of the height (0.59 in the browser
  // with its bars showing), so below 0.6 is the near half, where there is
  // nothing to aim at. On a wide canvas the view is all far half (the
  // centre line is below the bottom edge), so field kubbs may lie in the
  // zone there; only a drag throws, and a tap still aims, so nothing is lost.
  zoneFrom: 0.6,
  panEase: 5, // 1/s: how quickly a tall view pans after the circle
  remoteAimFresh: 1.5, // s a remote aim stays shown without news
  flagFor: 6, // s a result flag stays up into the next aim
  keyMove: 1, // the move and walk axes from keys
  walkStick: 60, // px a WALK drag goes for full walking pace
  walkDead: 8, // px a WALK drag goes before the thrower moves
  holdFeed: 1 / 30 - 0.002, // s: a held pointer's arm is fed again after this
  hiddenEvery: 1, // s between steps of an unattended game in a hidden tab
  hiddenCatchUp: 90, // s of missed time one such step makes up, at most
  wideMinPx: 6, // CSS px: the wide view only where its smallest base kubb is this tall
  wideBurst: 0.16, // the wide view's bursts, of the window's short side (else 0.3)
};

const ZERO = { dx: 0, dy: 0 };

// The engine's prompts are the crank's; on the linear meter they read as
// its own motion.
const LINEAR_WORDS = {
  "WIND BACK": "DRAW BACK",
  "FLICK!": "FLING!",
  "CRANK DOWN": "BACK TO MIDDLE",
};

export class Game {
  constructor({
    engine,
    canvas,
    ui,
    sound = null,
    swipeEnabled = false,
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
    // the engine's plan view, which the screen calls the side view: held
    // (Shift), toggled (SIDE VIEW), or shown while a plan slider is dragged
    // and `tune.slidePeek` after (`slidePeekUntil`)
    this.planHeld = false;
    this.planToggle = false;
    this.slide = null; // a plan slider held: { what, f, dirty }
    this.slidePeekUntil = 0;
    this.slideLast = null; // the last slider held: its caption shows through the peek
    this.walkOn = false; // WALK: a drag on the pitch walks the thrower
    this.swipeEnabled = swipeEnabled;
    this.swipeLayout =
      swipeEnabled &&
      (matchMedia("(any-pointer: coarse)").matches ||
        navigator.maxTouchPoints > 0);
    this.touchPrompts =
      this.swipeLayout && matchMedia("(pointer: coarse)").matches;
    this.touchSamples = [];
    this.ptr = null; // the pointer that is pressed: { id, kind, x, y, ... }
    this.dialArm = null;
    this.dialNext = null; // a stroke's arm waiting for its press (at 0) to be fed
    this.dialAcc = 0;
    this.dialFresh = false;
    this.remote = null;
    this.result = null; // the last throw's flag, verdicts, rest text
    this.shownCards = new Set();
    this.listeners = [];
    this.panX = 200;
    this.level = prefs.get("level", "club");
    // the throw's meter, this device's: the clock or the linear one (MENU)
    this.meter = prefs.get("meter", "clock") === "linear" ? "linear" : "clock";
    // and the screen edge it sits at (MENU, Side), for either hand
    this.meterSide =
      prefs.get("meterSide", "right") === "left" ? "left" : "right";
    // a touchscreen: the clock on a tall canvas leaves room round its rim
    // for a finger (layout.js track)
    this.coarse =
      typeof matchMedia === "function" &&
      matchMedia("(pointer: coarse)").matches;
    // the throw's nudge (src/game/nudge.js): a ghost throw on the meter for
    // a player who is stuck; `nudgeEnd`: a press on the meter has ended and
    // the next engine frame says whether it threw; `nudgeFreeze`: a fixed
    // time on its timeline (tests only, through window.__kubb)
    this.nudge = new NudgeTrigger({ throws: prefs.get("throwsMade", 0) });
    this.nudgeEnd = false;
    this.nudgeFreeze = null;
    this.nudgeShown = null;
    this.reducedMotion =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    this.raiseSel = null;
    this.autoRaise = newAutoRaise(); // src/game/auto-raise.js
    this.punishAt = null;
    this.running = false;
    this.zen = null; // a calm pace for watching (main's watchTune.zen), or null
    this.zenPause = 0; // s still to wait before the computer's next throw
    this.zenLast = null;
    this.unattended = false; // nobody plays here: keep going while hidden
    this.quiet = false; // stepping without drawing (a hidden tab)
    this.hiddenTimer = null;
    this.lastT = 0;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.onNeed = null; // (need) => void: main shows the winner card etc.
    this.whoActs = null; // (need) => { text, mine } | null: a shared pitch's HUD line
    this.trail = null; // see the seam above; reset by newPractice, newMatch, adopt
    // The wide view (docs/CLIENT.md "The wide view"): wanted (watching the
    // computer, by the viewer's choice), and shown when the window is big
    // enough for it: { kind, key } while the engine hands out its camera.
    this.wideWanted = false;
    this.wide = null;
    this.engineWide = false; // the engine hands out the wide camera
    this.onWide = null; // () => void: main's control follows what is shown
    // A replay (src/replay/player.js) drives the Game from outside: the time it
    // runs at, frozen while paused, no engine cards, and its own step each tick.
    this.timeScale = 1;
    this.frozen = false;
    this.noCards = false;
    this.driver = null; // (dt) => void, after each tick with the replay's dt

    this.hud = new Hud(ui, {
      slide: (what, f, phase) => this.planSlide(what, f, phase),
      step: (what, s) => this.planStep(what, s),
      skip: () => this.skip(),
    });
    this.bindPlanView(this.hud.sideView);
    this.bindWalk(this.hud.walk);
    this.bindInput();
    this.resize();
  }

  // ---------- starting ----------

  newPractice(opts = {}) {
    this.mode = "practice";
    const v = this.engine.newPractice({ level: this.level, ...opts });
    this.engine.setLevel(this.level);
    this.trail = {
      kind: "practice",
      opts: { level: this.level, drill: false, ...opts },
      ops: [],
    };
    this.enter(this.engine.view() || v);
  }

  newMatch(opts) {
    this.mode = "match";
    this.engine.newMatch(opts);
    this.engine.setControl(this.seat);
    this.startTrail();
    this.shownCards.clear();
    this.result = null;
    resetAutoRaise(this.autoRaise);
    this.enter(this.engine.view());
  }

  setSeat(seat) {
    this.seat = seat;
    if (this.mode === "match") this.engine.setControl(seat);
    this.enter(this.engine.view());
  }

  // ---------- the wide view ----------

  // Ask for the wide view (watching) or the thrower's view. What shows also
  // depends on the window: see applyWide.
  setWide(on) {
    this.wideWanted = !!on;
    this.applyWide();
  }

  // Tell the engine the box the wide camera fills (the window as the frame
  // sees it, less the HUD's margins), or turn it off. Called on every resize.
  // The engine gives every camera and the pitch in its fixed view from then
  // on (vendor/engine/session/wide.lua); what this Game already holds is fetched again.
  applyWide() {
    let next = null;
    if (this.wideWanted && this.W > 0) {
      const box = wideBox(this.W, this.H, this.L?.safe);
      const key = [box.left, box.top, box.right, box.bottom]
        .map((v) => v.toFixed(2))
        .join(",");
      if (this.wide && this.wide.key === key) return;
      const r = this.engine.setWide(box);
      this.engineWide = true;
      // a window too small for it (a phone held upright) keeps the thrower's
      if (r.farPx * box.k >= tune.wideMinPx) next = { kind: r.kind, key };
    }
    if (!next && this.engineWide) {
      this.engine.setWide(null);
      this.engineWide = false;
    }
    const was = this.wide;
    this.wide = next;
    if (was?.key !== next?.key) this.refetch();
    this.onWide?.(this);
  }

  // What is shown now, the wide view or the thrower's: "wide" | "thrower".
  get viewName() {
    return this.wide ? "wide" : "thrower";
  }

  // Fetch again what this Game holds from the engine in one view's frame
  // and camera: the aim and the pieces, and a throw playing back's bursts.
  refetch() {
    if (!this.mode) return;
    let v;
    try {
      v = this.engine.view();
    } catch {
      return; // no session yet
    }
    if (this.out) this.out = { ...this.out, aim: v.aim, camera: v.camera };
    const p = this.play;
    if (p) {
      const rec = this.engine.recording();
      const bs = rec?.timeline?.bursts || [];
      p.bursts.forEach((b, i) => {
        if (bs[i]?.anchor) b.anchor = bs[i].anchor;
      });
      p.last = this.engine.showAt(p.t);
    } else {
      this.viewData = v;
      this.items = v.items || [];
    }
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
    this.track(action);
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
    this.startTrail(snapshotText);
    this.queue.length = 0;
    this.play = null;
    this.enter(this.engine.view());
  }

  emit(action) {
    if (!action) return;
    const snap = this.track(action);
    if (!this.onAction) return;
    const hash =
      this.mode === "match"
        ? (this.trail?.hashes?.at(-1) ?? this.engine.hash().hash)
        : null;
    this.onAction(action, snap, hash);
  }

  // ---------- the trail (what a report replays from) ----------

  startTrail(snapshotText = this.engine.snapshot()) {
    this.trail = {
      kind: "match",
      start: snapshotText,
      actions: [],
      hashes: [],
      before: null,
      now: snapshotText,
    };
  }

  // An action applied to the engine (here or elsewhere). Returns a match's
  // snapshot after it.
  track(action) {
    const t = this.trail;
    if (!t) return null;
    if (t.kind === "practice") {
      t.ops.push(action);
      return null;
    }
    const snap = this.engine.snapshot();
    t.actions.push(action);
    t.hashes.push(this.engine.hash().hash);
    t.before = t.now;
    t.now = snap;
    return snap;
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
    this.dialNext = null;
    this.cancelSwipe();
    const n = this.need;
    if (n.kind === "throw") {
      this.phase = "aim";
      this.nudge.aimBegan();
      this.zenPause = this.zenPauseFor(n);
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

  // Watching at a calm pace: how long the computer stands before this throw.
  // A person looks, steps up and settles; longer when the turn changes hands
  // (the walk to the other baseline) and when the kubbs are in and the batons
  // come out. Nothing here touches the match: only when the throw is shown.
  zenPauseFor(n) {
    const z = this.zen;
    if (!z || !n.cpu) return 0;
    const proj = n.setup?.projectile ?? null;
    const last = this.zenLast;
    this.zenLast = { side: n.side, proj };
    const between = (a) => a[0] + Math.random() * (a[1] - a[0]);
    let t = between(z.before);
    if (!last || last.side !== n.side) t += between(z.turn);
    else if (last.proj !== proj) t += between(z.change);
    return t;
  }

  // The engine's cards (hand-off, pass, settle), each shown once.
  showCard() {
    const n = this.need;
    if (!n || !n.card || !this.cards || this.noCards) return;
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
        if (!this.unattended) this.lastT = now;
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
      this.background();
    });
    this.background();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.background();
  }

  // A hidden tab gets no animation frames. An unattended game (the computer
  // against itself) is stepped there by a timer instead, drawing nothing and
  // skipping each throw's playback, so the match keeps its pace. Browsers run
  // a hidden tab's timer about once a second, or once a minute after a few
  // minutes; each step makes up the time since, up to tune.hiddenCatchUp.
  background() {
    const want = this.running && this.unattended && document.hidden;
    if (want && !this.hiddenTimer) {
      this.hiddenTimer = setInterval(
        () => this.hiddenStep(),
        tune.hiddenEvery * 1000,
      );
    } else if (!want && this.hiddenTimer) {
      clearInterval(this.hiddenTimer);
      this.hiddenTimer = null;
    }
  }

  hiddenStep(now = performance.now()) {
    let left = Math.min(
      tune.hiddenCatchUp,
      Math.max(0, (now - this.lastT) / 1000),
    );
    this.lastT = now;
    this.quiet = true;
    try {
      while (left > 1e-6 && this.running) {
        const dt = Math.min(tune.maxDt, left);
        left -= dt;
        this.tick(dt, now);
      }
    } catch (err) {
      this.running = false;
      this.background();
      this.onError?.(err);
    } finally {
      this.quiet = false;
    }
  }

  destroy() {
    this.stop();
    for (const [el, ev, fn, o] of this.listeners)
      el.removeEventListener(ev, fn, o);
    this.listeners = [];
  }

  tick(dt, now) {
    if (!this.quiet) this.resizeIfNeeded();
    dt = this.frozen ? 0 : dt * this.timeScale;
    if (this.phase === "aim") this.aimFrame(dt, now);
    else if (this.phase === "play") this.playFrame(dt, now);
    else this.drawStill();
    this.autoRaiseTick(dt);
    if (this.result) this.result.age += dt;
    this.driver?.(dt);
  }

  // ---------- aiming ----------

  aimFrame(dt, now) {
    const may = this.mayAct();
    const input = { dt };
    if (this.zenPause > 0) {
      // a hidden tab keeps the match's pace for the data, not the watcher's
      if (this.quiet || !this.zen) this.zenPause = 0;
      else this.zenPause -= dt;
    }
    // the pause holds the engine still: a zero dt would not (the session
    // reads it as a sixtieth), so the aim as it stands is drawn again
    const paused = this.zenPause > 0 || this.frozen;
    if (this.modal || !may || paused) this.cancelSwipe();
    if (!this.modal && may && !paused) {
      if (this.touchSamples.length) input.touch = this.touchSamples.splice(0);
      if (this.ptr?.kind === "dial") input.arm = this.dialArm;
      this.applySlide();
      input.plan = this.planWanted();
      const m = this.keyAxes("ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp");
      const w = this.keyAxes("KeyA", "KeyD", "KeyS", "KeyW");
      if (m.dx || m.dy) input.move = m;
      if (w.dx || w.dy) input.walk = w;
      const s = this.ptr?.kind === "walk" ? this.walkAxes(this.ptr) : null;
      if (s) input.walk = s;
    }
    // While the dial is held, the engine is fed once per pointer sample
    // (with the time since the last), not once per display frame: a pointer
    // that reports at half the frame rate (a busy page, a 120 Hz screen)
    // would otherwise read as a stop-start, shaky swing. A pointer held still
    // sends nothing, so after `holdFeed` the same arm is fed again: the stop.
    let out;
    let fed = false; // the engine was fed with no arm: a press's end is judged
    if (paused) out = { ...this.out, event: undefined };
    else if (this.modal && may) out = this.out;
    else if (input.arm != null) {
      this.dialAcc += dt;
      if (this.dialFresh || this.dialAcc >= tune.holdFeed) {
        out = this.engine.frame({ ...input, dt: this.dialAcc });
        this.dialAcc = 0;
        this.dialFresh = false;
        // a stroke's press was fed at 0: now where the finger is
        if (this.dialNext != null) {
          this.dialArm = this.dialNext;
          this.dialNext = null;
          this.dialFresh = true;
        }
      } else out = { ...this.out, event: undefined };
    } else {
      this.dialAcc = 0;
      out = this.engine.frame(input);
      fed = true;
    }
    if (out.event === "release" && out.action) {
      if (may && (this.nudgeEnd || this.ptr?.kind === "dial"))
        this.nudgeThrown();
      this.emit(out.action);
      this.startPlayback(out.recording, may, out);
      return;
    }
    if (this.nudgeEnd && fed) {
      // a press on the meter ended with no throw: a fumble
      this.nudgeEnd = false;
      this.nudge.pressEnded(false);
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

  // A WALK drag as a stick: right walks right, up comes forward, down
  // steps back, at full pace `walkStick` px from where the press began.
  walkAxes(p) {
    const ax = (d) => {
      if (Math.abs(d) <= tune.walkDead) return 0;
      const v = (Math.abs(d) - tune.walkDead) / tune.walkStick;
      return Math.sign(d) * Math.min(1, v);
    };
    const dx = ax(p.x - p.x0);
    const dy = ax(p.y0 - p.y);
    return dx || dy ? { dx, dy } : null;
  }

  keyAxes(left, right, down, up) {
    const k = this.keys;
    const dx = (k.has(right) ? 1 : 0) - (k.has(left) ? 1 : 0);
    const dy = (k.has(up) ? 1 : 0) - (k.has(down) ? 1 : 0);
    return dx || dy ? { dx: dx * tune.keyMove, dy: dy * tune.keyMove } : ZERO;
  }

  planStep(what, step) {
    if (this.phase !== "aim" || !this.mayAct()) return;
    this.nudge.input();
    const r =
      what === "arc" ? this.engine.stepArc(step) : this.engine.stepSide(step);
    if (r && r.aim) this.out = { ...this.out, aim: r.aim, camera: r.camera };
  }

  // Is the side view (the engine's plan view) wanted this frame?
  planWanted(now = performance.now()) {
    return (
      this.planHeld ||
      this.planToggle ||
      !!this.slide ||
      now < this.slidePeekUntil
    );
  }

  // A throw begins (a press on the meter, its finger track or throw zone):
  // the side view goes at once, the toggle's and the half second after a
  // slider's. The engine takes no swing while the plan view is wanted
  // (session/throw aimFrame), so a throw started right after a slider was
  // let go would lose its backswing otherwise.
  planOff() {
    this.planToggle = false;
    this.slidePeekUntil = 0;
  }

  // A plan slider (src/game/plan-sliders.js): pressed, dragged, let go at f
  // on its track, or cancelled (hidden while held). Nothing reaches the engine here: aimFrame applies the
  // latest place once a frame (applySlide), so a fast drag costs one engine
  // call a frame at most. Returns false when the press is not taken.
  planSlide(what, f, phase) {
    if (phase === "down") {
      if (this.phase !== "aim" || !this.mayAct() || this.modal) return false;
      this.sound?.unlock();
      this.nudge.input();
      this.slide = { what, f, dirty: true };
      this.slideLast = what;
      return true;
    }
    if (!this.slide || this.slide.what !== what) return false;
    if (phase === "cancel") {
      // the slider went away under the finger (MENU, a throw): the plan
      // stays where the last frame left it, and no peek
      this.slide = null;
      return true;
    }
    this.slide.f = f;
    this.slide.dirty = true;
    if (phase === "up") {
      this.applySlide();
      this.slide = null;
      this.slidePeekUntil = performance.now() + tune.slidePeek * 1000;
    }
    return true;
  }

  // The held slider's place, to the engine: ARC is setArc's release, a
  // continuous value; TILT and SPIN have only steps (stepSide), so the
  // nearest detent is reached by the steps between it and the plan's own.
  applySlide() {
    const sl = this.slide;
    if (!sl || !sl.dirty) return;
    sl.dirty = false;
    if (this.phase !== "aim" || !this.mayAct()) return;
    const aim = this.out?.aim;
    let r = null;
    if (sl.what === "arc") r = this.engine.setArc(releaseAt(sl.f));
    else {
      const kubb = aim?.projectile === "kubb";
      const d = sideStepAt(sl.f, kubb) - sideStepOf(aim?.plan, kubb);
      if (d) r = this.engine.stepSide(d);
    }
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
    this.planOff();
    this.slide = null;
    this.walkOn = false;
    this.dialArm = null;
    this.dialNext = null;
    if (["dial", "swipe"].includes(this.ptr?.kind)) this.ptr = null;
    this.touchSamples.length = 0;
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
    if (this.quiet && !p.skipped) this.skip();
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
      // the calm rest is for a watcher: a hidden tab keeps the match's
      const rest = (!this.quiet && this.zen?.holdAfter) || tune.holdAfter;
      if (p.hold >= rest && !burstsLive) return this.endPlayback();
    }
    const s = p.last;
    if (s && !this.quiet) this.drawPlay(s, now);
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

  // MENU, Raising, and the panel's BY HAND and REST OF GAME: "auto" raises
  // every kubb of this match on the engine's choice (src/game/auto-raise.js).
  setRaise(v) {
    setGame(this.autoRaise, v === "auto");
    this.cards?.clearPanel?.();
  }

  // AUTO ALL: this kubb and the rest of this turn's, the engine's choice.
  raiseRest() {
    if (this.phase !== "raise") return;
    restOfTurn(this.autoRaise);
    this.cards?.clearPanel?.();
  }

  autoRaiseTick(dt) {
    const st = { phase: this.phase, need: this.need, modal: this.modal };
    if (!stepAutoRaise(this.autoRaise, dt, st)) return;
    const r = this.raise(null);
    if (r && r.ok === false) {
      refused(this.autoRaise);
      this.cards?.clearPanel?.();
    }
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

  // op: what fn does, for the trail ({ type: "reset" }, { type: "drill", on },
  // { type: "surface", surface }).
  practiceDo(fn, op = null) {
    if (this.mode !== "practice" || this.phase !== "aim") return;
    const v = fn();
    if (op && this.trail?.kind === "practice") this.trail.ops.push(op);
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

  // The throw's meter: "clock" (the dial) or "linear" (the straight track).
  // A preference of this device's; the engine is fed the same arm by both.
  setMeter(meter) {
    this.meter = meter === "linear" ? "linear" : "clock";
    prefs.set("meter", this.meter);
    if (this.W) this.resize();
  }

  // The screen edge the meter sits at: "right" or "left" (left-handed
  // players may want it there). The linear meter goes to that edge; the
  // clock does on a wide canvas, and is centred on a tall one either way.
  setMeterSide(side) {
    this.meterSide = side === "left" ? "left" : "right";
    prefs.set("meterSide", this.meterSide);
    if (this.W) this.resize();
  }

  // The linear meter's geometry as it is drawn (its side included).
  linearG() {
    return linearGeometry(this.L.dial, this.L.meterSide);
  }

  // ---------- drawing ----------

  // The meter on the screen: the linear one where the player chose it and it
  // has room (layout.js), else the clock.
  drawMeter(st) {
    if (this.L.meter !== "linear")
      return drawDial(this.ctx, this.L.dial, { ...st, track: this.L.track });
    const prompt = LINEAR_WORDS[st.prompt] || st.prompt;
    return drawLinear(
      this.ctx,
      this.L.dial,
      { ...st, prompt },
      this.L.meterSide,
    );
  }

  // ---------- the nudge (src/game/nudge.js) ----------

  // Step the nudge's trigger and say what to draw: null, or the timeline's
  // frame. It may show only while this player's own throw waits with
  // nothing over the pitch and nothing held. Its caption goes on the plate
  // (st.prompt) when the plate has the engine's idle words.
  nudgeFor(dt, st, mine) {
    const eligible =
      mine &&
      this.phase === "aim" &&
      !this.modal &&
      !this.cards?.open &&
      !this.wide &&
      !this.driver &&
      !this.frozen &&
      !this.unattended &&
      !this.swipeEnabled &&
      !this.ptr &&
      !this.nudgeEnd &&
      !this.planWanted() &&
      !(this.zenPause > 0) &&
      (st.phase ?? "idle") === "idle";
    const s = this.nudge.step(dt, eligible);
    this.nudgeShown = null;
    if (!s.show) return null;
    const swing = swingOf(st);
    const reduced = !!this.reducedMotion?.matches;
    const t = this.nudgeFreeze ?? s.t;
    const f = timeline(t, swing, { reduced });
    const frame = { ...f, alpha: f.alpha * s.alpha };
    if (!(frame.alpha > 0)) return { frame, swing, caption: null };
    const caption = captionFor(f.step);
    if (caption && this.nudge.showing && st.prompt === "WIND BACK")
      st.prompt = caption;
    return { frame, swing, caption };
  }

  drawNudgeOn({ frame, swing }, st) {
    const linear = this.L.meter === "linear";
    const caption = linear ? LINEAR_WORDS[st.prompt] || st.prompt : st.prompt;
    const opts = {
      swing,
      finger: this.coarse ? "touch" : "mouse",
      zoneFrom: tune.zoneFrom,
      caption,
    };
    drawNudge(this.ctx, this.L, frame, opts);
    this.nudgeShown = {
      ...frame,
      caption: st.prompt,
      finger: fingerAt(this.L, frame, opts),
    };
  }

  // A throw made by this player's own press: the nudge's count goes up
  // (kept on the device, capped) and its fumbles are forgotten.
  nudgeThrown() {
    this.nudgeEnd = false;
    this.nudge.pressEnded(true);
    prefs.set("throwsMade", this.nudge.throws);
  }

  // What the nudge is doing, for tests (window.__kubb.game).
  nudgeState() {
    const n = this.nudge;
    return {
      showing: !!this.nudgeShown,
      learned: n.learned,
      throws: n.throws,
      fumbles: n.fumbles,
      frame: this.nudgeShown,
    };
  }

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
    if (W !== this.W || H !== this.H) this.cancelSwipe();
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    const cs = getComputedStyle(document.documentElement);
    const inset = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
    const was = this.L?.meter;
    const wasSide = this.L?.meterSide;
    this.L = layoutFor(
      W,
      H,
      {
        top: inset("--safe-top"),
        right: inset("--safe-right"),
        bottom: inset("--safe-bottom"),
        left: inset("--safe-left"),
      },
      this.swipeLayout,
      this.meter,
      { side: this.meterSide, coarse: this.coarse },
    );
    // a held knob is let go when the meter under it changes (a phone turned
    // on its side mid-swing): its place on one is no angle on the other
    if (
      was &&
      (was !== this.L.meter || wasSide !== this.L.meterSide) &&
      this.ptr?.kind === "dial"
    ) {
      this.ptr = null;
      this.dialArm = null;
      this.dialNext = null;
    }
    this.fit = worldFit(W, H, this.panX);
    if (this.engine) this.applyWide();
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
    if (this.wide || !isTall(this.W, this.H)) {
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
    if (this.quiet) return;
    const v = this.viewData || {};
    const wide = !!this.wide;
    // the wide view leaves out the thrower's tools: the circle, the arc, the
    // dial and the minimap (the whole pitch is in view)
    const marker =
      !wide && aim.marker && aim.marker.shown !== false ? aim.marker : null;
    if (marker) {
      const p = project(camera, marker.x, marker.y, 0);
      this.pan(p ? p[0] : 200, dt);
    } else this.pan(200, dt, true);
    this.begin();
    const arc =
      !wide && Array.isArray(aim.arc)
        ? aim.arc.map((q) => (Array.isArray(q) ? q : [q.x, q.y, q.z]))
        : null;
    drawWorld(this.ctx, this.view, camera, {
      surface: v.surface,
      set: v.set,
      items: this.items,
      advantageY: aim.advY ?? null,
      marker: marker ? { x: marker.x, y: marker.y, r: marker.r } : null,
      arc,
      thrower: aim.thrower
        ? { x: aim.thrower.x, y: aim.thrower.y, facing: aim.thrower.facing }
        : null,
    });
    this.css();
    const watching = !may || !!aim.watching;
    if (!wide) {
      this.drawMap(aim, this.viewData?.minimap?.pieces || this.items);
      const st = {
        ...dial,
        grabbed: this.ptr?.kind === "dial" || this.ptr?.kind === "swipe",
        // a finger holding the clock from beside the ring (the track)
        finger:
          this.ptr?.kind === "dial" && this.ptr.outside
            ? [this.ptr.x, this.ptr.y]
            : null,
      };
      const nudge = this.nudgeFor(dt, st, may && !watching);
      if (this.touchPrompts && !watching && this.L.meter !== "linear") {
        if (st.prompt === "WIND BACK") st.prompt = "PULL DOWN ↓";
        if (st.prompt === "FLICK!") st.prompt = "FLICK UP!";
      }
      if (watching && !st.prompt) st.prompt = "WATCH";
      this.drawMeter(st);
      if (nudge) this.drawNudgeOn(nudge, st);
    }
    const res =
      this.result && this.result.age < tune.flagFor ? this.result : null;
    this.hud.update({
      aim,
      need: this.need,
      aiming: !this.modal && !this.cards?.open,
      mayAct: may && !watching,
      plan: this.planHeld || this.planToggle,
      walk: this.walkOn,
      practice: this.mode === "practice",
      watching,
      flag: res && res.flag,
      verdicts: res && res.verdicts,
      restText: res && res.restText,
      layout: this.L,
      who: this.whoActs?.(this.need) ?? null,
      wide,
      caption: this.captionWanted(),
    });
  }

  // Which slider's caption shows: the one held, or the last one through the
  // side view's peek after it is let go (hud.js showCaption).
  captionWanted(now = performance.now()) {
    if (this.slide) return this.slide.what;
    return now < this.slidePeekUntil ? this.slideLast : null;
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
    const wide = !!this.wide;
    if (!wide) {
      const pid = p.rec.projectile && p.rec.projectile.id;
      const proj = s.items.find((it) => it.id === pid);
      this.drawMap(null, s.items, {
        baton: proj ? { x: proj.x, y: proj.y } : null,
        advantageY: this.out?.aim?.advY ?? null,
        wind: this.out?.aim?.wind || null,
      });
      if (s.dial) this.drawMeter({ ...s.dial, prompt: null });
    }
    // the bursts at their anchors, in real time (smaller over the whole pitch)
    const size = wide
      ? Math.max(70, Math.min(this.W, this.H) * tune.wideBurst)
      : Math.max(90, Math.min(this.W, this.H) * 0.3);
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
      wide,
    });
  }

  drawStill() {
    const n = this.need;
    if (!n || this.quiet) return;
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
      who: this.whoActs?.(n) ?? null,
      wide: !!this.wide,
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
    if (this.swipeLayout) {
      this.listen(c, "pointerover", (e) => {
        this.touchPrompts = e.pointerType === "touch";
      });
    }
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
    let grab = 0;
    let outside = false;
    if (this.phase === "aim" && this.mayAct()) {
      this.nudge.input();
      const linear = this.L.meter === "linear";
      const g = linear ? this.linearG() : dialGeometry(this.L.dial);
      const aim = this.out?.aim || {};
      const swipe = !linear && this.swipeEnabled && e.pointerType === "touch";
      // The painted control is in front of the pitch. Its face keeps the
      // press even where the projected stance or target lies underneath it.
      // The linear meter is grabbed by its knob, which is home: the press is
      // the arm at 6 wherever on the knob it lands, and the rest of the body
      // only keeps the press from the pitch.
      const onDial = linear
        ? knobHit(g, x, y, touch ? linearTune.grabTouch : linearTune.grabMouse)
        : swipe
          ? Math.hypot(x - g.cx, y - g.cy) <= g.r
          : hitTest(g, x, y);
      if (onDial) kind = swipe ? "swipe" : "dial";
      else if (linear && bodyHit(g, x, y)) kind = "none";
      else if (this.walkOn) kind = "walk";
      else if (
        this.near(aim.marker, x, y, touch ? tune.grabTouch : tune.grabMouse)
      )
        kind = "target";
      else if (this.near(aim.thrower, x, y, touch ? 44 : 26)) kind = "stance";
      else if (swipe && y >= this.H / 2) kind = "swipe";
      // a finger beside the clock's ring, where it hides nothing: the arm is
      // the angle about the centre as on the ring (touch only)
      // Where a tap could aim (the far half of the pitch lies under the
      // track on a wide canvas) the press waits to see which it is: a tap
      // still aims, a drag turns the arm (move).
      else if (!linear && !swipe && touch && trackHit(g, x, y)) {
        kind = this.aimable(x, y) ? "track" : "dial";
        outside = true;
      }
      // the linear meter's throw zone: a tap there aims as any tap does; a
      // drag becomes the stroke (move)
      else if (linear && y >= this.H * tune.zoneFrom) kind = "zone";
      else kind = "tap";
      if (kind === "swipe") {
        this.sampleTouch(e, "down");
        this.planOff();
        this.walkOn = false;
      }
      // the nudge stops on any press on the meter, the finger track or the
      // throw zone
      if (kind === "dial" || kind === "swipe") this.nudge.meterPressed();
      else if (kind === "none") this.nudge.meterPressed();
      else if (kind === "zone" || kind === "track") this.nudge.zonePressed();
      if (kind === "dial") {
        if (linear) grab = y - g.y0;
        this.dialArm = linear ? 0 : armAt(g, x, y);
        this.dialNext = null;
        this.dialFresh = true;
        this.dialAcc = 0;
        this.planOff();
        this.walkOn = false;
      }
    } else if (this.phase === "raise" || this.phase === "punish") {
      kind = this.phase;
      if (kind === "punish") this.punishPointer(x, y);
    } else if (this.phase === "play") kind = "none";
    if (!kind) return;
    e.preventDefault();
    this.ptr = {
      id: e.pointerId,
      kind,
      x0: x,
      y0: y,
      x,
      y,
      moved: false,
      grab,
      outside,
      meter: this.phase === "aim" && kind === "none",
    };
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

  // Would a tap at (x, y) put the target circle there?
  aimable(x, y) {
    const g = this.ground(x, y);
    return !!g && g.y > 0.5;
  }

  ground(x, y, cam = this.out?.camera) {
    return cam ? unprojectView(this.view, cam, x, y) : null;
  }

  move(e) {
    const p = this.ptr;
    if (!p || p.id !== e.pointerId) return;
    if (p.kind === "swipe") {
      const samples = e.getCoalescedEvents?.() || [];
      for (const sample of samples) this.sampleTouch(sample);
      // Some browsers omit the dispatched event from the coalesced list.
      const last = samples.at(-1);
      if (
        !last ||
        last.timeStamp !== e.timeStamp ||
        last.clientX !== e.clientX ||
        last.clientY !== e.clientY
      )
        this.sampleTouch(e);
      return;
    }
    // The dial uses the latest event once a frame.
    const { x, y } = this.pos(e);
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.x0, y - p.y0) > tune.tapSlop) p.moved = true;
    if (p.kind === "zone" && p.moved) {
      // the stroke: from here on the press drives the knob relatively, as a
      // grab of the knob does (the press point is the knob's home). The
      // engine is fed the press, arm 0, first, then where the finger is
      // (aimFrame), so a stroke down arms the swing as a grab does.
      const g = this.linearG();
      p.kind = "dial";
      p.grab = p.y0 - g.y0;
      this.nudge.meterPressed();
      this.dialArm = 0;
      this.dialNext = armAtY(g, y - p.grab);
      this.dialFresh = true;
      this.dialAcc = 0;
      this.planOff();
      this.walkOn = false;
    } else if (p.kind === "track" && p.moved) {
      // a drag beside the ring after all: the engine is fed the press where
      // it landed, then where the finger is, as a press on the ring is
      const g = dialGeometry(this.L.dial);
      p.kind = "dial";
      this.nudge.meterPressed();
      this.dialArm = armAt(g, p.x0, p.y0);
      this.dialNext = armAt(g, x, y);
      this.dialFresh = true;
      this.dialAcc = 0;
      this.planOff();
      this.walkOn = false;
    } else if (p.kind === "dial") {
      const arm =
        this.L.meter === "linear"
          ? armAtY(this.linearG(), y - p.grab)
          : armAt(dialGeometry(this.L.dial), x, y);
      if (this.dialNext != null) this.dialNext = arm;
      else this.dialArm = arm;
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
    if (p.kind === "swipe") {
      if (cancelled) this.cancelSwipe();
      else this.sampleTouch(e, "up");
    }
    this.ptr = null;
    if (p.kind === "dial") {
      this.dialArm = null; // the release
      this.dialNext = null;
      // the next engine frame says whether it threw (aimFrame)
      if (this.phase === "aim") this.nudgeEnd = true;
    } else if (p.meter) {
      // the linear meter's body away from its knob: never a throw
      this.nudge.pressEnded(false);
    } else if (p.kind === "target" && !cancelled) {
      const g = this.ground(p.x, p.y);
      if (g) this.aimResult(this.engine.setTarget(g.x, g.y, true));
    } else if (
      ["tap", "zone", "track"].includes(p.kind) &&
      !p.moved &&
      !cancelled
    ) {
      // a tap on the pitch puts the circle there
      const g = this.ground(p.x, p.y);
      if (this.aimable(p.x, p.y))
        this.aimResult(this.engine.setTarget(g.x, g.y, true));
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

  sampleTouch(e, phase) {
    const { x, y } = this.pos(e);
    const unit = Math.min(this.W, this.H);
    this.touchSamples.push({
      phase,
      x: x / unit,
      y: y / unit,
      t: e.timeStamp / 1000,
    });
  }

  cancelSwipe() {
    if (this.ptr?.kind === "swipe" || this.touchSamples.length) {
      if (this.ptr?.kind === "swipe") this.ptr = null;
      this.touchSamples = [{ phase: "cancel" }];
    }
  }

  releaseAll() {
    this.cancelSwipe();
    this.keys.clear();
    this.planHeld = false;
    this.slide = null;
    if (this.ptr) {
      this.ptr = null;
      this.dialArm = null;
      this.dialNext = null;
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
    this.nudge.input();
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

  // WALK: a toggle for every pointer (a mouse needs its button for the drag).
  bindWalk(btn) {
    btn.addEventListener("pointerdown", (e) => {
      this.sound?.unlock();
      e.preventDefault();
      this.nudge.input();
      this.walkOn = !this.walkOn;
    });
  }

  // SIDE VIEW: a toggle for every pointer (Jamie, 2026-11-19: "Plan View"
  // is "a super weird label"; a mouse had to hold it). Shift held peeks.
  bindPlanView(btn) {
    btn.addEventListener("pointerdown", (e) => {
      this.sound?.unlock();
      e.preventDefault();
      this.nudge.input();
      this.planToggle = !this.planToggle;
    });
  }
}
