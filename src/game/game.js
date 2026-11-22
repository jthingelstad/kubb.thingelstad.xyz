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
import { stampOn } from "./clock.js";
import {
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
  linearTune,
  drawNudge,
  fingerAt,
  projectView,
  unprojectView,
  project,
} from "./draw.js";
import { Stage } from "../render/scenes.js";
import {
  Neighbours,
  neighboursWanted,
  pitchFrameOf,
  tune as neighboursTune,
} from "./neighbours.js";
import { optionRows } from "../net/lobby.js";
import { flagFor } from "./rulings.js";
import { viewFit } from "../render/camera.js";
import { FreeCamera } from "./free-camera.js";
import {
  layoutFor,
  meterRoom,
  linearFirst,
  inLinearZone,
  worldFit,
  panFor,
  isTall,
  stillFit,
  verdictBox,
  wideBox,
  tune as layoutTune,
} from "./layout.js";
import {
  settleItems,
  raiseCamera,
  punishCamera,
  poseItem,
  punishNearY,
  lookAt,
} from "./scenes.js";
import {
  raiseGeometry,
  onKubb,
  nearerEnd,
  dragOf,
  allowedEnd,
  tiltItem,
  tune as raiseTune,
} from "./raise-touch.js";
import { Hud } from "./hud.js";
import { TEAM } from "../render/palette.js";
import {
  controlOf,
  releaseAt,
  sideStepAt,
  sideStepOf,
  valueAt,
  isDrive,
} from "./plan-sliders.js";
import { standSpan, groundAt } from "./stand-pad.js";
import { prefs } from "./prefs.js";
import { pacing } from "./pacing.js";
import { loadName, saveName } from "./player-name.js";
import { namesOf } from "./names.js";
import { loadThrowLevel } from "./throw-level.js";
import { NudgeTrigger, timeline, swingOf, captionFor } from "./nudge.js";
import { coachFor, slowVerdict, shortDrive } from "./coach.js";
import {
  gainFor,
  panFor as neighbourPan,
  rateFor,
  tune as neighbourSoundTune,
} from "./neighbour-sound.js";
import {
  actionClip,
  settledClips,
  liftPace,
  tune as liftTune,
} from "./lift.js";
import {
  newAutoRaise,
  setGame,
  restOfTurn,
  refused,
  reset as resetAutoRaise,
  step as stepAutoRaise,
} from "./auto-raise.js";

// The Kid line to draw from an aim view (engine 0.15's `kidY`), or null. It is on the
// thrower's side of the middle, within 4 m of their line (`lineY`). Engine 0.15.0's wide
// view turned `lineY` for Team B but not `kidY`; 0.15.1 turns both, so the far side's
// line is drawn too. The guard stays: a kidY that is not near its line is not drawn
// rather than drawn on the wrong end (JS never turns it).
// The far baseline's frame y in an aim camera (the thrower's view frame: y = 8), held
// to a sane range; null without one (layout.js worldFit's own anchor then).
export function farFrameOf(camera) {
  if (!camera) return null;
  const p = project(camera, 0, 8, 0);
  if (!p || !Number.isFinite(p[1])) return null;
  return Math.max(40, Math.min(180, p[1]));
}

export function kidLineOf(aim) {
  const k = aim?.kidY;
  if (k == null) return null;
  return Math.abs(k - (aim.lineY ?? 0)) <= 4 ? k : null;
}

export const tune = {
  // a scene tile's postcard camera (sceneThumb): lookAt's eye, target, focal length
  thumbCam: [[0.6, -5.2, 1.5], [0, 9, 0.9], 330],
  maxDt: 1 / 20, // s: a longer frame (a hitch, a background tab) is cut to this
  holdAfter: pacing.restAfterThrow, // s the pitch rests after a throw (src/game/pacing.js)
  raiseZoom: 1.8, // a tall canvas's raise scene, over the whole frame across
  grabTouch: 56, // px round the target circle a finger grabs it
  grabMouse: 30,
  tapSlop: 10, // px a press may move and still be a tap
  // a finger's aim drag moves the circle this much of its own travel (finger
  // 2 : circle 1, the iPhone's; a tester, 2026-11-19: aiming is "very touchy
  // and hard to place")
  touchAim: 0.5,
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
  // s a result flag and its verdict chips stay up after the throw comes to rest
  // (6 until web 0.17.0; the owner, 2026-11-22: "the display stays on the screen for
  // a while keeping the player from being able to aim at times"): long enough to read
  // the flag and four chips, about 2.7 s of the next aim after the pitch's 0.8 s rest.
  // The first aim input takes it away at once (Game.aimInput).
  flagFor: 3.5,
  keyMove: 1, // the move and walk axes from keys
  standPeek: 1, // s STAND's caption stays up after it is let go
  holdFeed: 1 / 30 - 0.002, // s: a held pointer's arm is fed again after this
  hiddenEvery: 1, // s between steps of an unattended game in a hidden tab
  hiddenCatchUp: 90, // s of missed time one such step makes up, at most
  wideMinPx: 6, // CSS px: the wide view only where its smallest base kubb is this tall
  // a watcher's (Game.observing): lower, because the free camera can come closer
  // (a phone held upright gets the wide view and its free camera; docs/OBSERVER.md)
  observeMinPx: 2,
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
    look = null,
    neighbours = null,
  }) {
    this.engine = engine;
    // The Tournament's live neighbours (src/game/neighbours.js): { workerUrl, luaUrl,
    // wasmUrl } where the page can run them, else null (the still pitches). `nb` is
    // the field while one is live, `nbSeed` the match's seed it is opened with (null:
    // read it again), `lastThrower` the side of the last throw set up (the frame the
    // pitch stands in between throws: pitchFrame).
    this.nbOpts =
      neighbours?.workerUrl && typeof Worker === "function" ? neighbours : null;
    this.nb = null;
    this.nbFailed = false;
    this.nbSeed = null;
    this.lastThrower = "A";
    // the scenes draw where pieces strike the ground (src/render/impacts.js)
    engine?.setImpacts?.(true);
    // the match's scene (src/render/scenes.js), from its view's `scene`;
    // a scene being picked (showScene) or a look given here (useLook) is
    // kept over it
    this.stage = new Stage({ skin: true });
    this.pinnedLook = false;
    this.shownScene = null;
    if (look) this.useLook(look);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ui = ui;
    this.sound = sound;
    this.seat = seat;
    this.onAction = onAction;
    this.cards = cards; // the card host (src/ui/cards.js), set by main
    this.mode = null; // "practice" | "match"
    // what the page's header row holds beside MENU (layout.js headerPlates):
    // "practice" (its tray), "watch" (the view tray) or null; main sets it
    this.header = null;
    this.phase = "idle"; // aim | play | raise | punish | over | idle
    this.need = null;
    this.viewData = null;
    this.out = null;
    this.items = [];
    this.queue = [];
    this.modal = 0; // cards and overlays open: no input, no engine time
    this.keys = new Set();
    // the engine's plan view, which the screen calls the side view: held
    // (Shift), shown while ARC's plate is open (the tray, src/game/tray.js;
    // SIDE VIEW is no longer a button), or while a plan slider is dragged and
    // `tune.slidePeek` after (`slidePeekUntil`)
    this.planHeld = false;
    this.planOpen = false;
    this.slide = null; // a plan slider held: { what, f, dirty }
    this.slidePeekUntil = 0;
    this.slideLast = null; // the last slider held: its caption shows through the peek
    // STAND held (src/game/stand-pad.js): { span, fx, fy, dirty }; its
    // caption stays up `tune.standPeek` after it is let go
    this.standDrag = null;
    this.standPeekUntil = 0;
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
    this.coachSlow = false; // this player's last throw was SLOW (coach.js)
    this.coachShort = false; // ... was a drive that fell SHORT (coach.js)
    this.shownCards = new Set();
    this.listeners = [];
    this.panX = 200;
    // the device's stored throw level (src/game/throw-level.js): no longer picked
    // (from engine 0.13 a person throws on one meter whatever level is named), but
    // still passed and kept, so a match on a carried 0.9 engine, a shared pitch's
    // presence and older records see the value they always had
    this.level = loadThrowLevel(prefs);
    // the player's name, this device's too (src/game/player-name.js): a generated
    // name, rolled on the first run (the engine's names.*, src/game/names.js); the
    // solo card, the lobby and MENU hear a change through onPlayerName
    this.names = namesOf(this.engine);
    this.playerName = loadName(prefs, this.names);
    this.nameWatch = new Set();
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
    // the raise screen's touch (src/game/raise-touch.js): `raiseDrag` the kubb being
    // tipped up, { i, t }; `raiseHint` the allowed end lit after a tap on a refused one
    this.raiseDrag = null;
    this.raiseHint = null;
    this.autoRaise = newAutoRaise(); // src/game/auto-raise.js
    // a raise being watched (src/game/lift.js): { clips, k, t, lead, beat, then }
    // while the phase is "lift"; liftSkip: the player skipped it, so the rest of this
    // turn's automatic raises stand at once
    this.liftState = null;
    this.liftSkip = false;
    // () => number: actions a shared pitch holds behind a watched raise (src/net/pitch.js)
    this.backlog = null;
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
    // A watcher's free camera (docs/OBSERVER.md): `observing` is set by whoever runs a
    // watched match (watching the computer, a watcher on a shared pitch, a replay);
    // while it is on and the wide view shows, the canvas's pointers, the wheel and the
    // camera keys move the view, and the pitch is drawn through freeCam.camera().
    this.observing = false;
    this.wideCam = null; // the engine's wide camera, the free camera's lens
    this.freeCam = new FreeCamera({ reduced: this.reducedMotion });
    // A replay (src/replay/player.js) drives the Game from outside: the time it
    // runs at, frozen while paused, no engine cards, and its own step each tick.
    this.timeScale = 1;
    this.frozen = false;
    this.noCards = false;
    this.driver = null; // (dt) => void, after each tick with the replay's dt
    // A shared pitch (src/net/pitch.js): someone else's aim to draw, asked each frame of
    // their throw (null: nothing new), and this browser's aim just before its throw went.
    this.remoteFeed = null; // () => aimState | null
    this.onRelease = null; // (aimState | null) => void, before onAction

    this.hud = new Hud(ui, {
      slide: (what, f, phase) => this.planSlide(what, f, phase),
      step: (what, s, fine) => this.planStep(what, s, fine),
      skip: () => this.skip(),
      stand: (fx, fy, phase) => this.standAt(fx, fy, phase),
      standKey: (dx, dy) => this.standStep(dx, dy),
      open: (key) => this.plateOpened(key),
      railHeight: (h) => this.setRailH(h),
    });
    this.bindInput();
    this.resize();
  }

  // ---------- starting ----------

  newPractice(opts = {}) {
    this.mode = "practice";
    this.nbSeed = null;
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
    this.nbSeed = null;
    // MENU's Raising row is shown for a match that raises by hand (src/ui/menu.js)
    this.matchRaising = opts?.raising === "auto" ? "auto" : "hand";
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

  // Draw from another engine (a replay of a match from an older engine the site
  // carries, docs/ENGINES.md), or back from it. The engine left keeps its session;
  // the one taken is told the wide box afresh.
  useEngine(engine) {
    if (!engine || engine === this.engine) return;
    if (this.engineWide) {
      try {
        this.engine.setWide(null);
      } catch {
        // the engine has gone
      }
      this.engineWide = false;
    }
    this.engine = engine;
    engine?.setImpacts?.(true);
    this.wide = null;
    this.applyWide();
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
      const min = this.observing ? tune.observeMinPx : tune.wideMinPx;
      if (r.farPx * box.k >= min)
        next = { kind: r.kind, key, camera: r.camera };
    }
    if (!next && this.engineWide) {
      this.engine.setWide(null);
      this.engineWide = false;
    }
    const was = this.wide;
    this.wide = next;
    this.freeCam.setLens(next?.camera ?? null);
    if (was?.key !== next?.key) this.refetch();
    this.placeRoom();
    this.onWide?.(this);
  }

  // A watched match (docs/OBSERVER.md): the free camera may move the wide view. The
  // gate for the wide view is lower for a watcher, so it is asked again.
  setObserving(on) {
    on = !!on;
    if (this.observing === on) return;
    this.observing = on;
    if (!on) this.freeCam.cancel();
    this.wide = null; // the gate changed: applyWide decides afresh
    this.applyWide();
  }

  // The free camera takes the pointers and keys: a watcher, in the wide view, with no
  // card over the pitch.
  freeOn() {
    return this.observing && !!this.wide && !this.modal;
  }

  // The camera the pitch is drawn through: the free camera's while a watcher has moved
  // it in the wide view, else the one given (the engine's).
  viewCam(c) {
    return this.observing && this.wide ? this.freeCam.camera(c) : c;
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
      this.stage.clear();
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
    if (this.phase === "play" || this.phase === "lift") {
      this.queue.push(action);
      return;
    }
    const before = this.need;
    const r = this.engine.apply(action);
    if (r && r.ok === false) return r;
    this.track(action);
    this.remote = null;
    if (r.recording) this.startPlayback(r.recording, false);
    else this.showAction(before, action, this.engine.view());
    return r;
  }

  // ---------- watching a raise (src/game/lift.js) ----------

  // Whether a raise is shown being made: in a match that is drawn (not a hidden tab's
  // quiet steps), unless the player skipped this turn's.
  watchLifts() {
    return this.mode === "match" && !this.quiet && !this.liftSkip;
  }

  get reduced() {
    return !!this.reducedMotion?.matches;
  }

  // After an action that did not throw: a raise is watched, one kubb tipped up, then
  // `view` is entered; anything else enters `view` at once.
  showAction(before, action, view, { lead = 0 } = {}) {
    if (
      action?.type === "raise" &&
      before?.kind === "raise" &&
      this.watchLifts()
    ) {
      const clip = actionClip(before, action, { reduced: this.reduced });
      if (clip) {
        const { beat } = liftPace(before.of);
        return this.startLifts([clip], { lead, beat }, view);
      }
    }
    this.enter(view);
  }

  startLifts(clips, { lead = 0, beat }, then) {
    this.liftState = { clips, k: 0, t: 0, lead, beat, then };
    this.phase = "lift";
    this.raiseDrag = null;
    this.raiseSel = null;
    this.cards?.tick?.(this);
  }

  // One frame of a raise being watched: the lead, then each kubb's beat; a hidden tab
  // ends it at once. Actions waiting behind it hurry it (lift.js tune.catchUp), so a
  // shared pitch never falls behind the browser that raised.
  liftFrame(dt) {
    const L = this.liftState;
    if (!L) return;
    if (this.quiet) return this.finishLifts();
    // actions waiting here, or in a shared pitch's own queue (src/net/pitch.js `backlog`)
    const waiting = this.queue.length + (this.backlog?.() || 0);
    const k = 1 + liftTune.catchUp * waiting;
    let step = dt * k;
    if (L.lead > 0) {
      const used = Math.min(L.lead, step);
      L.lead -= used;
      step -= used;
    }
    L.t += step;
    while (L.t >= L.beat) {
      L.t -= L.beat;
      L.k += 1;
      if (L.k >= L.clips.length) return this.finishLifts();
    }
    this.drawLift(L.clips[L.k], L.lead > 0 ? 0 : L.t / L.beat);
  }

  drawLift(clip, u) {
    if (this.quiet) return;
    const v = this.viewData || {};
    this.fit = stillFit(this.W, this.H, tune.raiseZoom);
    this.begin();
    this.world(raiseCamera(clip.need), {
      surface: v.surface,
      set: v.set,
      items: clip.items(u),
      footprints: clip.footprints,
    });
    this.css();
    this.cards?.tick?.(this);
    this.hud.update({
      aim: null,
      need: this.need,
      watching: false,
      practice: false,
      layout: this.L,
      who: null,
      wide: !!this.wide,
    });
  }

  // The watched raise is over (or skipped): the view after it, and any actions that
  // came in meanwhile.
  finishLifts() {
    const L = this.liftState;
    this.liftState = null;
    if (!L) return;
    this.phase = "idle";
    this.enter(L.then || this.engine.view());
    while (this.queue.length && this.phase !== "play" && this.phase !== "lift")
      this.applyRemote(this.queue.shift());
  }

  // A tap or a key while a raise is watched: to its end, and the rest of this turn's
  // automatic raises at once.
  skipLifts() {
    if (this.phase !== "lift") return false;
    this.liftSkip = true;
    this.finishLifts();
    return true;
  }

  // (A match's snapshot: the seam is for matches.)
  // A snapshot the pitch hands over goes through the engine's strict door: one whose
  // names the game did not make throws a NamesRefused and changes nothing.
  // trail: the match's own trail to carry on with (a kept match, resumeMatch): checked
  // against the restored hash and in place before the view is entered, so a listener
  // that runs on entering (a match that is over records itself) sees the whole match.
  adopt(snapshotText, trail = null) {
    this.engine.restoreChecked(snapshotText);
    this.mode = "match";
    this.nbSeed = null;
    try {
      const snap = JSON.parse(snapshotText);
      // the frame a restored pitch stands in until its next throw (Session.frameSide)
      this.lastThrower = snap?.side === "B" ? "B" : "A";
      const r = snap?.opts?.raising;
      if (r) this.matchRaising = r === "auto" ? "auto" : "hand";
    } catch {
      // the snapshot was checked by the engine; a raising it does not say is by hand
    }
    this.engine.setControl(this.seat);
    if (trail) {
      if (
        trail.hashes.length &&
        this.engine.hash().hash !== trail.hashes.at(-1)
      )
        throw new Error("the kept match does not end on its own hash");
      this.trail = trail;
    } else this.startTrail(snapshotText);
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
    this.onTracked?.();
    return snap;
  }

  // A kept match against the computer, back (src/game/solo-save.js): its snapshot through
  // the engine's strict door (adopt), and its trail from the match's own start, so the
  // record it sends when it ends is the whole match. Throws when the snapshot is refused
  // or does not end on the kept hash; the caller drops the save then.
  // The match's start table (its first snapshot's opts.start), or null.
  matchStart() {
    const text = this.trail?.start ?? null;
    if (this.startOf?.text === text) return this.startOf.start;
    let start = null;
    try {
      start = JSON.parse(text ?? "null")?.opts?.start ?? null;
    } catch {
      start = null;
    }
    this.startOf = { text, start };
    return start;
  }

  // The stamp an action made now carries (engine 0.18.0, its docs/SESSION.md "Actions"
  // `at`): the sender's UTC clock on the start's basis (clock.js stampOn), or undefined
  // where none can be true (practice, a start with no offset). Every frame passes it, so
  // the throws the engine makes (a person's, the computer's) carry it; the raise, punish
  // and resign actions the page makes carry it themselves. One place: here.
  stamp() {
    if (this.mode !== "match") return undefined;
    return stampOn(this.matchStart()) ?? undefined;
  }

  resumeMatch(save) {
    this.shownCards.clear();
    this.result = null;
    resetAutoRaise(this.autoRaise);
    this.adopt(save.snap, {
      kind: "match",
      start: save.start,
      actions: [...save.actions],
      hashes: [...save.hashes],
      before: null,
      now: save.snap,
      recorded: false,
    });
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
    this.liftState = null;
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
    if (n.kind !== "raise") this.liftSkip = false;
    // the last throw set up: the pitch's frame between throws (pitchFrame)
    if (n.kind === "throw" && n.side) this.lastThrower = n.side;
    // where its aim camera puts the far baseline (frame y), so a tall canvas fits
    // that line at layout.js anchorAt whoever throws from where (worldFit)
    if (n.kind === "throw") this.farFrameY = farFrameOf(view.camera);
    if (n.kind === "throw") {
      this.phase = "aim";
      this.nudge.aimBegan();
      this.zenPause = this.zenPauseFor(n);
      if (this.mode === "match" && this.mayAct())
        this.engine.setLevel(this.level);
    } else if (n.kind === "raise") {
      this.phase = "raise";
      this.raiseSel = null;
      this.raiseDrag = null;
      this.raiseHint = null;
      if (this.mode === "match" && !this.mayAct()) this.phase = "wait";
    }
    // the raise screen labels the canvas with its ends (describeRaise)
    if (n.kind !== "raise" && this.canvas?.dataset.raiseLabel) {
      delete this.canvas.dataset.raiseLabel;
      this.canvas.setAttribute("aria-label", "The pitch");
    }
    if (n.kind === "punish") {
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
    this.endNeighbours();
    for (const [el, ev, fn, o] of this.listeners)
      el.removeEventListener(ev, fn, o);
    this.listeners = [];
  }

  tick(dt, now) {
    if (!this.quiet) this.resizeIfNeeded();
    this.sceneryTick(this.frozen ? 0 : dt);
    if (!this.quiet && this.observing) {
      // real time: a paused or sped-up replay's camera moves as the viewer does
      this.freeCam.k = viewFit(this.view).k;
      this.freeCam.tick(dt);
    }
    dt = this.frozen ? 0 : dt * this.timeScale;
    if (this.phase !== "play") this.stage.tick(dt);
    if (this.phase === "aim") this.aimFrame(dt, now);
    else if (this.phase === "play") this.playFrame(dt, now);
    else if (this.phase === "lift") this.liftFrame(dt);
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
      this.applyStand();
      input.plan = this.planWanted();
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
    let fed = false; // the engine was fed with no arm: a press's end is judged
    // the aim as it stood before this frame, for the release's own cast (onRelease):
    // on a dial or swipe frame, and on the frame after the finger lifted from the clock
    // or the meter (nudgeEnd), which is the one that throws
    const pre =
      this.onRelease &&
      may &&
      !paused &&
      (input.arm != null || input.touch || this.nudgeEnd)
        ? this.engine.aimState()
        : null;
    if (paused) out = { ...this.out, event: undefined };
    else if (this.modal && may) out = this.out;
    else if (input.arm != null) {
      this.dialAcc += dt;
      if (this.dialFresh || this.dialAcc >= tune.holdFeed) {
        out = this.engine.frame({
          ...input,
          dt: this.dialAcc,
          at: this.stamp(),
        });
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
      out = this.engine.frame({ ...input, at: this.stamp() });
      fed = true;
    }
    if (out.event === "release" && out.action) {
      if (may && (this.nudgeEnd || this.ptr?.kind === "dial"))
        this.nudgeThrown();
      if (may) this.onRelease?.(pre);
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
    if (out.dial && out.dial.phase !== "idle") this.aimInput();

    if (!may && this.remoteFeed) {
      const s = this.remoteFeed();
      if (s) this.showRemoteAim(s);
    }
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

  // STAND (src/game/stand-pad.js): pressed, dragged, let go at (fx, fy) on
  // its picture of the line, or cancelled. The place is kept and aimFrame
  // sends it once a frame (applyStand) as the engine's setStance, the same
  // call a drag of the thrower on the pitch makes. The ground the picture
  // shows is fixed at the press, so it never shifts under the finger.
  // Returns false when the press is not taken.
  // The player has started to aim (a press on the pitch, the meter or a tray plate,
  // a slider, STAND or an aim key): the last throw's verdict goes at once, so it never
  // stands over what is aimed at (docs/SYSTEM.md "The verdict").
  aimInput() {
    if (this.phase === "aim" && this.result && this.mayAct())
      this.result.age = Math.max(this.result.age, tune.flagFor);
  }

  standAt(fx, fy, phase) {
    this.aimInput();
    if (phase === "down") {
      if (this.phase !== "aim" || !this.mayAct() || this.modal) return false;
      this.sound?.unlock();
      this.nudge.input();
      this.standDrag = { span: standSpan(this.out?.aim), fx, fy, dirty: true };
      return true;
    }
    const d = this.standDrag;
    if (!d) return false;
    if (phase === "cancel") {
      this.standDrag = null;
      return true;
    }
    d.fx = fx;
    d.fy = fy;
    d.dirty = true;
    if (phase === "up") {
      this.applyStand();
      this.standDrag = null;
      this.standPeekUntil = performance.now() + tune.standPeek * 1000;
    }
    return true;
  }

  applyStand() {
    const d = this.standDrag;
    if (!d || !d.dirty) return;
    d.dirty = false;
    if (this.phase !== "aim" || !this.mayAct()) return;
    const g = groundAt(d.span, d.fx, d.fy);
    this.aimResult(this.engine.setStance(g.x, g.y));
  }

  // STAND's arrow keys: a step along the line (dx) or up and back (dy), m.
  standStep(dx, dy) {
    this.aimInput();
    if (this.phase !== "aim" || !this.mayAct() || this.modal) return;
    this.nudge.input();
    const t = this.out?.aim?.thrower;
    if (!t) return;
    this.aimResult(this.engine.setStance(t.x + dx, t.y + dy));
    this.standPeekUntil = performance.now() + tune.standPeek * 1000;
  }

  keyAxes(left, right, down, up) {
    const k = this.keys;
    const dx = (k.has(right) ? 1 : 0) - (k.has(left) ? 1 : 0);
    const dy = (k.has(up) ? 1 : 0) - (k.has(down) ? 1 : 0);
    return dx || dy ? { dx: dx * tune.keyMove, dy: dy * tune.keyMove } : ZERO;
  }

  // A step of ARC or TILT/SPIN (R/F, Q/E, PageUp/PageDown on a slider), or with
  // `fine` a tick (an arrow key on a slider) where the engine has ticks (0.9 on,
  // `aim.controls`); an older engine steps.
  planStep(what, step, fine = false) {
    this.aimInput();
    if (this.phase !== "aim" || !this.mayAct()) return;
    this.nudge.input();
    const aim = this.out?.aim;
    const kubb = aim?.projectile === "kubb";
    const c = fine ? controlOf(aim?.controls, what, kubb) : null;
    const r = c
      ? this.setControl(what, kubb, (c.value ?? c.default) + step * c.tick)
      : what === "arc"
        ? this.engine.stepArc(step)
        : this.engine.stepSide(step);
    if (r && r.aim) this.out = { ...this.out, aim: r.aim, camera: r.camera };
  }

  // A value for ARC, TILT or SPIN, any in range (engine 0.9 on; it clamps).
  setControl(what, kubb, v) {
    if (what === "arc") return this.engine.setArc(v);
    return kubb ? this.engine.setSpin(v) : this.engine.setTilt(v);
  }

  // Is the side view (the engine's plan view) wanted this frame?
  planWanted(now = performance.now()) {
    return (
      this.planHeld ||
      this.planOpen ||
      !!this.slide ||
      now < this.slidePeekUntil
    );
  }

  // A throw begins (a press on the meter, its finger track or throw zone):
  // the side view goes at once, an open plate's and the half second after a
  // slider's. The engine takes no swing while the plan view is wanted
  // (session/throw aimFrame), so a throw started right after a slider was
  // let go would lose its backswing otherwise. (A press outside the tray has
  // already closed an open plate: tray.js.)
  planOff() {
    if (this.planOpen) this.hud.tray.setOpen(null);
    this.planOpen = false;
    this.slidePeekUntil = 0;
  }

  // A plate opened or closed in the tray (key: "arc", "side", "stand" or
  // null): ARC open is the side view, until it closes.
  plateOpened(key) {
    this.aimInput();
    this.sound?.unlock();
    this.nudge.input();
    this.planOpen = key === "arc";
  }

  // The header's height as the page draws it (hud.js): the minimap stands
  // under it (layout.js minimapBox), so a new height lays the screen out again.
  setRailH(h) {
    if (!(h > 0) || h === this.railH) return;
    this.railH = h;
    if (this.W) this.resize();
  }

  // A plan slider (src/game/plan-sliders.js): pressed, dragged, let go at f
  // on its track, or cancelled (hidden while held). Nothing reaches the engine here: aimFrame applies the
  // latest place once a frame (applySlide), so a fast drag costs one engine
  // call a frame at most. Returns false when the press is not taken.
  planSlide(what, f, phase) {
    this.aimInput();
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

  // The held slider's place, to the engine. Engine 0.9 on gives each control's
  // range (`aim.controls`) and takes any value in it: setArc, setTilt, setSpin.
  // Before 0.9, ARC is setArc's release, a continuous value; TILT and SPIN have
  // only steps (stepSide), so the nearest detent is reached by the steps between
  // it and the plan's own.
  applySlide() {
    const sl = this.slide;
    if (!sl || !sl.dirty) return;
    sl.dirty = false;
    if (this.phase !== "aim" || !this.mayAct()) return;
    const aim = this.out?.aim;
    const kubb = aim?.projectile === "kubb";
    const c = controlOf(aim?.controls, sl.what, kubb);
    let r = null;
    if (c) r = this.setControl(sl.what, kubb, valueAt(c, sl.f));
    else if (sl.what === "arc") r = this.engine.setArc(releaseAt(sl.f));
    else {
      const d = sideStepAt(sl.f, kubb) - sideStepOf(aim?.plan, kubb);
      if (d) r = this.engine.stepSide(d);
    }
    if (r && r.aim) this.out = { ...this.out, aim: r.aim, camera: r.camera };
  }

  // ---------- playback ----------

  startPlayback(rec, local, out = null) {
    this.liftState = null;
    const tl = rec.timeline || {};
    const pid = rec.projectile && rec.projectile.id;
    const aim = this.out?.aim;
    this.play = {
      rec,
      local,
      // a drive (engine 0.16, ARC under its knee): its SHORT verdict is coached
      drive: !!local && isDrive(aim?.plan, aim?.controls?.arc),
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
    this.stage.watch(rec);
    this.phase = "play";
    this.planOff();
    this.slide = null;
    this.standDrag = null;
    this.dialArm = null;
    this.dialNext = null;
    if (["dial", "swipe"].includes(this.ptr?.kind)) this.ptr = null;
    this.touchSamples.length = 0;
    this.result = null;
  }

  // A watcher (an observer, a member with no side) with others' actions waiting behind
  // the one playing plays it skipped, until it is within one throw of live, then at
  // full length again: players SKIP and move on, and a watcher who played every throw
  // through fell turns behind (QA, 2026-11-22). Players are never hurried.
  catchingUp() {
    if (this.mode !== "match" || this.localSide || this.seat?.sides?.length)
      return false;
    return (this.backlogOf?.() ?? 0) + this.queue.length > 0;
  }

  skip() {
    const p = this.play;
    if (!p) return;
    p.t = p.rec.duration;
    p.knocks.length = 0;
    for (const b of p.bursts) b.realAt = -1;
    p.skipped = true;
    this.stage.clear();
  }

  playFrame(dt, now) {
    const p = this.play;
    if (this.quiet && !p.skipped) this.skip();
    else if (!p.skipped && !p.local && this.catchingUp()) this.skip();
    if (!p.done) {
      const s = this.engine.showAt(p.t);
      p.last = s;
      if (!this.quiet) this.stage.observe(s.items, p.t);
      p.slow = s.speed < 0.99;
      // the knocks: one take each, at each piece's first touch
      while (p.ki < p.knocks.length && p.knocks[p.ki].t <= p.t) {
        const k = p.knocks[p.ki++];
        this.sound?.knock(k.kind === "king" ? 1 : 0.9);
        this.ownKnockAt = performance.now();
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
          flag: flagFor(r),
          verdicts: p.local ? r.verdicts : null,
          restText: r.restText,
          age: 0,
        };
        if (p.local) {
          this.coachSlow = slowVerdict(r.verdicts);
          this.coachShort = shortDrive(r.verdicts, p.drive);
        }
      } else p.t += dt * (s.speed || 1);
    } else {
      p.hold += dt;
      p.slow = false;
      this.stage.tick(dt);
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
    const p = this.play;
    this.play = null;
    this.phase = "idle";
    const v = this.engine.view();
    // the kubbs the engine raised itself before the next throw (Raising: Automatic, the
    // computer's own raises, watching the computer) are watched being raised
    const clips = this.settledLifts(p, v);
    if (clips.length) {
      this.startLifts(clips, liftPace(clips.length), v);
      return;
    }
    this.enter(v);
    // actions that came in while the throw played
    while (this.queue.length && this.phase !== "play") {
      this.applyRemote(this.queue.shift());
    }
    // a practice press made while the throw played (whilePlaying)
    const after = this.afterPlay;
    this.afterPlay = null;
    if (after && this.phase === "aim") after();
  }

  // The engine's own raises between the throw just played and the next, as clips, from
  // the engine's `setup.settled` (lift.js settledClips); the page never works them out
  // by turning the pitch itself. Since engine 0.17.0 each entry carries its own
  // surroundings (`others`, `king`), drawn as given; `around` (the view's items where
  // they are in the list's frame, else the king alone) is for an entry without them.
  settledLifts(p, v) {
    const n = v?.need;
    if (!p || n?.kind !== "throw" || !this.watchLifts()) return [];
    const st = n.setup?.settled;
    if (!st?.list?.length) return [];
    const items = v.items || [];
    const world = !!this.wide && st.list.every((e) => e.frame === "world");
    const around = world ? items : items.filter((it) => it.id === "king");
    return settledClips(st, { around, reduced: this.reduced });
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

  // The lying kubb as drawn on the raise screen (CSS px), or null.
  raiseShape() {
    const n = this.need;
    if (!n || n.kind !== "raise") return null;
    return raiseGeometry(this.view, raiseCamera(n), n);
  }

  // Which end a tap at (x, y) means: an end's numbered label, anywhere on the
  // drawn kubb (the end nearer the tap), or near an end's footprint on the
  // ground. null for a tap on none of them.
  raisePick(x, y) {
    let i = null;
    this.endPoints().forEach((q, j) => {
      if (q && Math.hypot(q.lx - x, q.ly - y) < raiseTune.labelR) i = j;
    });
    if (i != null) return i;
    const g = this.raiseShape();
    if (onKubb(g, x, y)) return nearerEnd(g, x, y);
    const p = this.ground(x, y, raiseCamera(this.need));
    return p ? this.raiseAt(p.x, p.y) : null;
  }

  // A tap or a drag let go on end i: stand it there, or, when the rules
  // refuse that end, light the one they allow for a moment and send nothing.
  raiseTap(i) {
    const pick = allowedEnd(this.need, i);
    if (pick.ok) return this.raise(pick.i);
    if (pick.i != null)
      this.raiseHint = {
        i: pick.i,
        until: performance.now() + raiseTune.hintMs,
      };
    return null;
  }

  // A drag that started on the kubb: tip it up toward the end the finger
  // moves to (never toward a refused end: that lights the allowed one).
  raiseDragTo(p) {
    const g = p.raiseShape;
    const d = dragOf(g, p.x0, p.y0, p.x, p.y);
    if (this.need.ends[d.i]?.ok === false) {
      this.raiseDrag = null;
      this.raiseSel = null;
      const pick = allowedEnd(this.need, d.i);
      if (pick.i != null)
        this.raiseHint = {
          i: pick.i,
          until: performance.now() + raiseTune.hintMs,
        };
      return;
    }
    this.raiseDrag = d;
    // past half way the footprint it will stand on is lit
    this.raiseSel = d.t >= raiseTune.stand ? d.i : null;
  }

  // Stand the kubb on end i (an index into need.ends), or the engine's own
  // choice with null.
  raise(i, { watch = false, lead = 0 } = {}) {
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
    const at = this.stamp();
    if (at) action.at = at;
    const r = this.engine.apply(action);
    if (r.ok === false) return r;
    this.emit(action);
    // an automatic raise is watched (lift.js); one by hand was already seen
    if (watch) this.showAction(n, action, this.engine.view(), { lead });
    else this.enter(this.engine.view());
    return r;
  }

  // The raise panel's AUTO: this kubb, on the engine's choice, watched.
  raiseAuto() {
    return this.raise(null, { watch: true });
  }

  // The raise panel's BY HAND and REST OF GAME: "auto" raises
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
    const st = {
      phase: this.phase,
      need: this.need,
      modal: this.modal,
      rush: this.liftSkip || this.quiet,
    };
    if (!stepAutoRaise(this.autoRaise, dt, st)) return;
    const r = this.raise(null, { watch: true });
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
    const at = this.stamp();
    const action = at ? { type: "punish", x, y, at } : { type: "punish", x, y };
    const r = this.engine.apply(action);
    if (r.ok === false) {
      this.punishCheck = r;
      return r;
    }
    this.emit(action);
    this.enter(this.engine.view());
    return r;
  }

  // A resign carries the clock (`at`): the sender's UTC clock on the match's start's
  // basis (src/game/clock.js stampOn: the host's offset at the start, which the start
  // carries), so the length is right whoever resigns and wherever they are; a start
  // without that offset, or a stamp that cannot be true, sends none. The engine takes it
  // as the finish, and every browser on a pitch applies the same stamp (it is part of
  // the action). Since engine 0.18.0 the throws the engine makes carry one too, from the
  // `at` every frame passes (Game.stamp).
  resign(side) {
    const at = this.stamp();
    const action = at ? { type: "resign", side, at } : { type: "resign", side };
    const r = this.engine.apply(action);
    if (r.ok === false) return r;
    this.emit(action);
    if (this.phase !== "play") this.enter(this.engine.view());
    return r;
  }

  // ---------- practice ----------

  // op: what fn does, for the trail ({ type: "reset" }, { type: "drill", on },
  // { type: "surface", surface }).
  // done: called once the change is made (the practice tray marks its buttons).
  practiceDo(fn, op = null, done = null) {
    if (this.mode !== "practice") return;
    if (this.whilePlaying(() => this.practiceDo(fn, op, done))) return;
    if (this.phase !== "aim") return;
    const v = fn();
    if (op && this.trail?.kind === "practice") this.trail.ops.push(op);
    this.result = null;
    this.enter(v && v.need ? v : this.engine.view());
    done?.();
  }

  // A practice press (BATONS, KUBBS, RESET, a scene or surface) while a throw plays:
  // the throw is skipped to its end and the press made then, never dropped unseen.
  whilePlaying(fn) {
    if (this.phase !== "play" || !this.play) return false;
    this.afterPlay = fn;
    this.skip();
    return true;
  }

  // The practice pitch in another scene (MENU's Scene). The engine keeps a scene
  // from the start and has no setter for a look, so the practice starts again in
  // it, on the same surface, throwing what it threw.
  practiceScene(scene) {
    if (this.mode !== "practice") return;
    if (this.whilePlaying(() => this.practiceScene(scene))) return;
    if (this.phase !== "aim") return;
    this.newPractice({
      surface: this.viewData?.surface ?? this.trail?.opts?.surface,
      scene,
      ...(this.need?.drill ? { drill: true } : {}),
    });
  }

  // The device's name, picked in a name row (src/ui/name-row.js): Settings, the solo
  // card or the lobby. Only a generated name is kept.
  setPlayerName(text) {
    const name = saveName(prefs, this.names, text);
    if (name === this.playerName) return;
    this.playerName = name;
    for (const f of this.nameWatch) f(name);
  }

  // f(name) on every change of the device's name; returns the way to stop.
  onPlayerName(f) {
    this.nameWatch.add(f);
    return () => this.nameWatch.delete(f);
  }

  // The throw's meter: "clock" (the dial) or "linear" (the straight track).
  // A preference of this device's; the engine is fed the same arm by both.
  setMeter(meter) {
    this.meter = meter === "linear" ? "linear" : "clock";
    prefs.set("meter", this.meter);
    if (this.W) this.resize();
  }

  // What the header row holds beside MENU ("practice", "watch" or null):
  // a linear meter that moves the row in must leave it room (layoutFor).
  setHeader(header) {
    this.header = header || null;
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
    // what the meter says, for the HUD's stand-ins (a screen reader, the
    // keyboard's Tab order) and for tests (window.__kubb.game.meterShown)
    this.meterShown = {
      prompt:
        this.L.meter === "linear"
          ? LINEAR_WORDS[st.prompt] || st.prompt || null
          : st.prompt || null,
      distance: st.distance || null,
      faded: !!st.faded,
      promptFill: st.promptFill || null,
    };
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
  // nothing over the pitch and nothing held (a slider through the side view
  // it brings, STAND by its own drag). Its caption goes on the plate
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
      !this.standDrag &&
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
      // the header row's foot: the fingertip stays under it on a wide canvas
      ceiling: this.L.safe.top + layoutTune.railH + layoutTune.margin * 1.5,
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
      {
        side: this.meterSide,
        coarse: this.coarse,
        header: this.header,
        railH: this.railH,
      },
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
    this.fit = worldFit(W, H, this.panX, this.farFrameY);
    if (this.engine) this.applyWide();
    this.placeRoom();
  }

  // The top corner's plates (MENU and the practice tray, or the rail and the
  // shouts) move in beside a wide canvas's linear meter where it comes up
  // into the header row (layout.js meterRoom; game.css --meter-l, --meter-r).
  // The wide view draws no meter, so they stay put there.
  placeRoom() {
    const root = typeof document !== "undefined" && document.documentElement;
    if (!root?.style) return;
    const r = this.wide ? { left: 0, right: 0 } : meterRoom(this.L);
    // the header's fixed width (layout.js headerBox): the minimap stands
    // under its right end
    const rw = this.L?.header ? Math.round(this.L.header.width) : null;
    // the flag and the verdicts keep off the header, the minimap, the tray and the
    // meter, and above what is aimed at (layout.js verdictBox)
    const vb = this.wide ? null : verdictBox(this.L, { adv: !!this.advShown });
    const verdictCompactW = layoutTune.verdictCompactW;
    const cl = vb ? vb.x : null;
    const cw = vb ? vb.width : null;
    const ct = vb ? vb.y : null;
    const ck =
      cl == null ? "" : `${Math.round(cl)}:${Math.round(cw)}:${Math.round(ct)}`;
    const L = this.L;
    const key = `${r.left}:${r.right}:${rw}:${L?.tall}:${L?.meter}:${L?.meterSide}:${ck}:${!!this.advShown}`;
    if (this.roomKey === key) return;
    this.roomKey = key;
    root.classList?.toggle("center-placed", !!ck);
    // a wide screen lays the flag and its chips in a row, so the verdict is short; a
    // narrow box (beside the tray upright) takes the compact chips (game.css)
    root.classList?.toggle("verdict-row", !!vb && !L?.tall);
    root.classList?.toggle(
      "verdict-compact",
      !!vb && vb.width < verdictCompactW,
    );
    if (ck) {
      root.style.setProperty("--center-l", `${Math.round(cl)}px`);
      root.style.setProperty("--center-w", `${Math.round(cw)}px`);
      root.style.setProperty("--center-t", `${Math.round(ct)}px`);
    }
    if (rw) root.style.setProperty("--rail-w", `${rw}px`);
    // upright, SKIP takes the bottom corner away from a linear meter
    root.classList?.toggle(
      "skip-left",
      !!this.L?.tall &&
        this.L.meter === "linear" &&
        this.L.meterSide === "right",
    );
    root.classList?.toggle("meter-room", !!(r.left || r.right));
    root.style.setProperty("--meter-l", `${r.left}px`);
    root.style.setProperty("--meter-r", `${r.right}px`);
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
    this.fit = worldFit(this.W, this.H, this.panX, this.farFrameY);
  }

  // A scene id shown over the pitch's own while it is being picked (the solo
  // card, the lobby), so the pitch and the page show what the choice will
  // look like; null goes back to the view's scene.
  showScene(id) {
    this.shownScene = id ?? null;
    // the practice pitch behind a card is started again in the scene, so it stands
    // on the scene's own ground too (engine 0.14: a scene decides the surface)
    if (
      id &&
      this.mode === "practice" &&
      this.phase === "aim" &&
      this.viewData &&
      this.viewData.scene !== id
    ) {
      try {
        this.practiceScene(id);
      } catch {
        // the look alone, as before
      }
    }
  }

  // The pitch as it stands, drawn small in scene `id` into `canvas` through a Stage
  // of its own (the solo card's scene tiles: the game's own picture of each scene,
  // not a sketch). W x H CSS px at 2x. False when there is no picture yet (before
  // the first frame), so the caller may try again.
  sceneThumb(canvas, id, W = 96, H = 56) {
    // a postcard of the scene: from behind the near baseline, low, looking down the
    // pitch to past the far end, so its sky and what stands round it show
    const camera = this.out?.camera ? lookAt(...tune.thumbCam) : null;
    if (!camera || !canvas?.getContext) return false;
    const dpr = 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const stage = new Stage({ skin: false, reduced: true });
    stage.use(id);
    const v = this.viewData || {};
    // the scene on its own ground and with its own set (engine 0.14: the scene
    // decides them), the surface shown where the scene allows it
    let ground = { surface: v.surface, set: v.set };
    try {
      const card = optionRows(id);
      const row = card.rows.find(([k]) => k === "surface");
      ground = {
        surface: row?.[2].some(([s]) => s === v.surface)
          ? v.surface
          : card.defaults.surface,
        set: card.defaults.set,
      };
    } catch {
      // no room engine: the pitch's own
    }
    stage.draw(ctx, { width: W, height: H, dpr }, camera, {
      ...ground,
      items: this.items,
    });
    return true;
  }

  // A look object kept over the match's own scene (tests and tools).
  useLook(look) {
    this.pinnedLook = !!look;
    this.stage.useLook(look);
  }

  // The pitch through a camera in the match's scene: the day is exactly
  // drawWorld's picture (tests/render/scene-day.test.mjs).
  world(camera, scene) {
    camera = this.viewCam(camera);
    if (!this.pinnedLook)
      this.stage.use(this.shownScene ?? this.viewData?.scene);
    // the live neighbours, turned with the pitch while it is in Team B's frame
    const field =
      this.nb && this.stage.id === "tournament"
        ? this.nb.field(this.pitchFrame() === "B")
        : null;
    if (field) scene = { ...scene, neighbours: field };
    this.nbDrawn = field ? { camera, field } : null;
    this.stage.draw(
      this.ctx,
      this.view,
      camera,
      scene,
      performance.now() / 1000,
    );
  }

  // ---------- the Tournament's neighbours ----------

  // Once a tick, with the match's own dt (0 while a replay is paused): open the live
  // field on entering a Tournament match, practice, replay or watch; close it, and end
  // its worker, on leaving; post the clock, stopped under a card and in a hidden tab
  // (whose ticks are `quiet`, or none at all). docs/SCENES.md "Tournament".
  sceneryTick(dt) {
    const scene = this.pinnedLook
      ? this.stage.id
      : (this.shownScene ?? this.viewData?.scene);
    const want = neighboursWanted({
      scene,
      mode: this.mode,
      reduced: !!this.reducedMotion?.matches,
      available: !!this.nbOpts,
      failed: this.nbFailed,
      modal: this.modal > 0,
      open: !!this.nb,
    });
    if (!want) return this.endNeighbours();
    if (this.nbSeed == null) this.nbSeed = this.seedNow();
    const key = String(this.nbSeed);
    if (!this.nb) this.nb = new Neighbours(this.nbOpts);
    if (this.nb.key !== key)
      this.nb.open({ seed: this.nbSeed, layout: neighboursTune.layout }, key);
    this.nb.tick(this.modal > 0 || this.quiet ? 0 : dt);
    this.neighbourSounds();
    if (this.nb.failed) {
      this.nbFailed = true;
      this.endNeighbours();
    }
  }

  // The other pitches heard (src/game/neighbour-sound.js): the cues due by the match
  // clock, quiet and far, panned from where each pitch lies in the view. Taken every
  // tick; played only with the Sound on, in a visible tab, with no card up, not paused
  // and not within ownGap of this pitch's own knock.
  neighbourSounds(now = performance.now()) {
    const cues = this.nb?.takeCues?.() || [];
    if (!cues.length || !this.sound || this.sound.muted) return 0;
    if (this.quiet || this.modal > 0 || this.frozen) return 0;
    if (typeof document !== "undefined" && document.hidden) return 0;
    if (this.ownKnockNear(now)) return 0;
    const turned = this.pitchFrame() === "B";
    const cam = this.nbDrawn?.camera || null;
    let n = 0;
    for (const c of cues) {
      if (!c.offset) continue;
      const g =
        gainFor(Math.hypot(c.offset.x, c.offset.y), c.kind) * (c.level ?? 1);
      if (!g) continue;
      const x = turned ? -c.offset.x : c.offset.x;
      const y = (turned ? -c.offset.y : c.offset.y) + 4;
      if (this.sound.distant(g, neighbourPan(cam, x, y), rateFor(c.kind)))
        n += 1;
    }
    return n;
  }

  // This pitch's own knock just sounded or is about to (half of ownGap either side).
  ownKnockNear(now = performance.now()) {
    const half = neighbourSoundTune.ownGap / 2;
    if (now - (this.ownKnockAt ?? -Infinity) < half * 1000) return true;
    const p = this.play;
    return !!(
      p &&
      !p.done &&
      p.ki < p.knocks.length &&
      p.knocks[p.ki].t - p.t < half
    );
  }

  // Where each live neighbour's piece in the air is on the canvas, CSS px, as last
  // drawn: [{ id, kind, x, y }] (the tests and the screenshots look for a throw).
  neighboursInFlight() {
    const d = this.nbDrawn;
    if (!d || !this.view) return [];
    const out = [];
    for (const p of d.field) {
      const rec = this.nb?.fieldData?.byId.get(p.id)?.rec;
      if (!rec) continue;
      for (const q of p.pieces) {
        if (q.z < 0.2) continue;
        const v = projectView(this.view, d.camera, p.x + q.x, p.y + q.y, q.z);
        if (v && v[0] >= 0 && v[1] >= 0 && v[0] <= this.W && v[1] <= this.H)
          out.push({ id: p.id, kind: q.kind, x: v[0], y: v[1] });
      }
    }
    return out;
  }

  endNeighbours() {
    if (!this.nb) return;
    this.nb.destroy();
    this.nb = null;
  }

  // The match's seed, so a shared match's phones can show the same tournament; 1
  // where there is none to read (practice).
  seedNow() {
    try {
      const seed = JSON.parse(this.engine.snapshot())?.opts?.seed;
      if (Number.isInteger(seed)) return seed;
    } catch {
      // practice, or no session yet
    }
    return 1;
  }

  // The frame the pitch is drawn in now, "A" or "B": one decision for every drawing
  // path (pitchFrameOf in src/game/neighbours.js says which is which).
  pitchFrame() {
    return pitchFrameOf({
      need:
        this.phase === "lift" && this.liftState
          ? this.liftState.clips[this.liftState.k]?.need || this.need
          : this.need,
      wide: !!this.wide,
      mode: this.mode,
      thrower: this.lastThrower,
    });
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
    this.world(camera, {
      surface: v.surface,
      set: v.set,
      items: this.items,
      advantageY: aim.advY ?? null,
      // the Kid line (a Kid match, engine 0.15): dots and two cones
      kidY: kidLineOf(aim),
      marker: marker ? { x: marker.x, y: marker.y, r: marker.r } : null,
      arc,
      thrower: aim.thrower
        ? { x: aim.thrower.x, y: aim.thrower.y, facing: aim.thrower.facing }
        : null,
    });
    this.css();
    const watching = !may || !!aim.watching;
    let coach = null;
    // a card that dims the pitch (the hand-off, the lobby, the options card):
    // nothing of the aim's controls round it, the meter included
    const covered = this.modal > 0 || !!(this.cards?.open && this.cards.dims);
    if (!wide && covered) {
      this.drawMap(aim, this.viewData?.minimap?.pieces || this.items);
      this.meterShown = null;
    } else if (!wide) {
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
      if (watching) {
        // a turn this player watches (the computer's, or someone else's on
        // a shared pitch): the meter faded, its WATCH on the thrower's team
        // colour (the 1.0 design: "the header, a WATCH tab in the computer's
        // colour and the faded meter")
        const team = TEAM[this.need?.side];
        st.faded = true;
        if (team && st.prompt === "WATCH") {
          st.promptFill = team.fill;
          st.promptInk = team.text;
        }
      } else st.distance = distanceWords(aim);
      this.drawMeter(st);
      if (nudge) this.drawNudgeOn(nudge, st);
      // the coach is words for the thrower: not while watching, nor over
      // the nudge's ghost, which shows the same stroke
      coach =
        watching || this.nudgeShown
          ? null
          : coachFor({
              throws: this.nudge.throws,
              slow: this.coachSlow,
              short: this.coachShort,
              dial,
            });
    }
    const res =
      this.result && this.result.age < tune.flagFor ? this.result : null;
    this.hud.update({
      aim,
      need: this.need,
      aiming: !this.modal && !this.cards?.open,
      mayAct: may && !watching,
      practice: this.mode === "practice",
      watching,
      // the meter says WATCH itself (on the thrower's colour): no pill too
      meterWatch: watching && !wide,
      meter: wide ? null : this.meterShown,
      flag: res && res.flag,
      verdicts: res && res.verdicts,
      restText: res && res.restText,
      layout: this.L,
      who: this.whoActs?.(this.need) ?? null,
      wide,
      caption: this.captionWanted(),
      coach,
    });
    // the Kid or advantage line's chip under the header: the verdict stands under it
    const adv = !wide && !!aim?.advText;
    if (adv !== !!this.advShown) {
      this.advShown = adv;
      this.placeRoom();
    }
  }

  // Which slider's caption shows: the one held, or the last one through the
  // side view's peek after it is let go (hud.js showCaption).
  captionWanted(now = performance.now()) {
    if (this.standDrag) return "stand";
    if (this.slide) return this.slide.what;
    if (now < this.standPeekUntil) return "stand";
    return now < this.slidePeekUntil ? this.slideLast : null;
  }

  drawMap(aim, pieces, extra = {}) {
    // not drawn where a narrow wide canvas has no room for it (layout.js planAt)
    if (!this.L.minimap) return;
    const v = this.viewData || {};
    drawMinimap(this.ctx, this.L.minimap, {
      items: pieces,
      thrower: aim?.thrower || null,
      aim: aim?.marker ? { x: aim.marker.x, y: aim.marker.y } : null,
      marker: aim?.marker?.shown !== false ? aim?.marker : null,
      advantageY: aim?.advY ?? v.minimap?.advY ?? null,
      kidY: aim ? kidLineOf(aim) : (v.minimap?.kidY ?? null),
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
    this.world(s.camera, {
      surface: v.surface,
      set: v.set,
      items: s.items,
      advantageY: this.out?.aim?.advY ?? null,
      kidY: kidLineOf(this.out?.aim),
    });
    this.css();
    const wide = !!this.wide;
    if (!wide) {
      const pid = p.rec.projectile && p.rec.projectile.id;
      const proj = s.items.find((it) => it.id === pid);
      this.drawMap(null, s.items, {
        baton: proj ? { x: proj.x, y: proj.y } : null,
        advantageY: this.out?.aim?.advY ?? null,
        kidY: kidLineOf(this.out?.aim),
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
        this.viewCam(s.camera),
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
        // a phone on its side: the near baseline above the panel's bar
        n.kind === "punish"
          ? { lowest: punishNearY(), bottom: this.L?.safe?.bottom || 0 }
          : undefined,
      );
    else this.pan(200, 0, true);
    this.begin();
    if (n.kind === "raise") {
      if (this.raiseHint && performance.now() > this.raiseHint.until)
        this.raiseHint = null;
      const hint = this.raiseHint?.i ?? null;
      const sel = this.raiseSel ?? hint;
      const drag = this.raiseDrag;
      // the kubb: tipped part way up while it is dragged, else lying
      const items = settleItems(n, drag ? null : n.pose);
      if (drag) items.push(tiltItem(n, drag.i, drag.t));
      this.world(raiseCamera(n), {
        surface: v.surface,
        set: v.set,
        items,
        footprints: (n.ends || []).map((e, i) => ({
          x: e.pose.x,
          y: e.pose.y,
          angle: e.pose.angle,
          chosen: i === sel,
          allowed: e.ok !== false,
        })),
      });
      this.css();
      this.drawEndLabels(n, sel);
      if (this.phase === "raise") this.describeRaise(n);
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
      this.world(punishCamera(n), {
        surface: v.surface,
        set: v.set,
        items,
        keepOut: (n.keepOut || []).map((k) => ({ x: k.x, y: k.y, r: k.r })),
        footprints: [{ x: at.x, y: at.y, angle: 0, chosen: true, allowed: ok }],
      });
      this.css();
    } else {
      this.world(v.camera || this.out?.camera, {
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

  // The ends' numbers beside their footprints on the raise screen; `lit`
  // the end drawn chosen (a drag past half way, or the allowed end's hint).
  drawEndLabels(n, lit = this.raiseSel) {
    // a watcher's moved camera shows the whole pitch, not the close-up they label
    if (this.viewCam(null) !== null) return;
    const ctx = this.ctx;
    this.endPoints().forEach((q, i) => {
      const e = n.ends[i];
      if (!q) return;
      const pt = [q.lx, q.ly];
      const r = raiseTune.labelR0;
      ctx.fillStyle = "#16130f";
      ctx.beginPath();
      ctx.arc(pt[0] + 3, pt[1] + 3, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle =
        e.ok === false ? "#c9c2b0" : i === lit ? "#f2b705" : "#fbf6ea";
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#16130f";
      ctx.stroke();
      ctx.fillStyle = "#16130f";
      ctx.font = `22px "Londrina Solid", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), pt[0], pt[1] + 1);
    });
  }

  // Where the ends' footprints (x, y) and their numbered labels (lx, ly)
  // sit in view px (for taps and tests).
  endPoints() {
    const n = this.need;
    if (!n || n.kind !== "raise") return [];
    const cam = raiseCamera(n);
    return (n.ends || []).map((e) => {
      const p = projectView(this.view, cam, e.pose.x, e.pose.y, 0);
      // the label: just past the footprint's outer edge, along the kubb from its
      // middle, its circle clear of the footprint (raiseTune.labelGap px) however
      // small the camera draws it
      const dx = e.pose.x - n.pose.x,
        dy = e.pose.y - n.pose.y;
      const l = Math.hypot(dx, dy) || 1;
      const q = projectView(
        this.view,
        cam,
        e.pose.x + (dx / l) * 0.035,
        e.pose.y + (dy / l) * 0.035,
        0,
      );
      if (!p || !q) return null;
      const ex = q[0] - p[0],
        ey = q[1] - p[1];
      const el = Math.hypot(ex, ey) || 1;
      const out = raiseTune.labelR0 + raiseTune.labelGap;
      return {
        x: p[0],
        y: p[1],
        lx: q[0] + (ex / el) * out,
        ly: q[1] + (ey / el) * out,
        ok: e.ok !== false,
      };
    });
  }

  // The canvas's label while raising, for a screen reader: which end lies
  // where, which the rules refuse, and how to choose.
  describeRaise(n) {
    const pts = this.endPoints();
    const parts = (n.ends || []).map((e, i) => {
      const q = pts[i];
      const other = pts[1 - i];
      const where =
        q && other ? (q.lx < other.lx ? " on the left" : " on the right") : "";
      return `end ${i + 1}${where}${e.ok === false ? ` (${(e.why || "blocked").toLowerCase()})` : ""}`;
    });
    const label = `The pitch. A kubb lying, to be stood up: ${parts.join(", ")}. Tap the kubb nearer the end to stand it on, or use the END buttons.`;
    if (this.canvas.getAttribute("aria-label") !== label) {
      this.canvas.setAttribute("aria-label", label);
      this.canvas.dataset.raiseLabel = "1";
    }
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
    this.listen(c, "wheel", (e) => this.wheel(e), { passive: false });
    this.listen(window, "keydown", (e) => this.keyDown(e));
    this.listen(window, "keyup", (e) => {
      this.keys.delete(e.code);
      this.freeCam.key(e.code, false);
    });
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
    // a watched raise: a tap skips to its end
    if (this.phase === "lift" && !this.freeOn()) {
      e.preventDefault();
      this.skipLifts();
      return;
    }
    this.aimInput();
    const { x, y } = this.pos(e);
    // a watcher's free camera takes every press on the pitch (docs/OBSERVER.md)
    if (this.freeOn()) {
      const mouse = e.pointerType === "mouse";
      if (
        this.freeCam.down({
          id: e.pointerId,
          x,
          y,
          button: e.button,
          shift: e.shiftKey,
          mouse,
        })
      ) {
        e.preventDefault();
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* a synthetic pointer has nothing to capture */
        }
        return;
      }
    }
    const touch = e.pointerType !== "mouse";
    let kind = null;
    let grab = 0;
    let outside = false;
    let raiseShape = null;
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
      // On a wide canvas a finger grabs the knob across its channel only, and
      // the rest of the body is throw zone (layout.js linearFirst).
      const onLinear = linear
        ? linearFirst(this.L, g, x, y, {
            touch,
            reach: touch ? linearTune.grabTouch : linearTune.grabMouse,
          })
        : null;
      const onDial = linear
        ? onLinear === "dial"
        : swipe
          ? Math.hypot(x - g.cx, y - g.cy) <= g.r
          : hitTest(g, x, y);
      if (onDial) kind = swipe ? "swipe" : "dial";
      else if (onLinear) kind = onLinear;
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
      else if (
        linear &&
        inLinearZone(this.L, x, y, { touch, zoneFrom: tune.zoneFrom })
      )
        kind = "zone";
      else kind = "tap";
      if (kind === "swipe") {
        this.sampleTouch(e, "down");
        this.planOff();
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
      }
    } else if (this.phase === "raise" || this.phase === "punish") {
      kind = this.phase;
      if (kind === "punish") this.punishPointer(x, y);
      // a press on the kubb may become a drag that tips it up (move)
      if (kind === "raise") {
        const g = this.raiseShape();
        raiseShape = onKubb(g, x, y) ? g : null;
      }
    } else if (this.phase === "play") kind = "none";
    if (!kind) return;
    e.preventDefault();
    // a finger moves the circle relatively, at half its own travel, from
    // where the circle was: it never jumps under the finger and the finger
    // never hides it (relAim). Kept: the circle's screen point and the camera
    // at the press. A mouse drags the circle itself, as before.
    let rel = null;
    if (touch && (kind === "target" || kind === "tap")) {
      const at = this.screenOf(this.out?.aim?.marker);
      if (at) rel = { x: at.x, y: at.y, cam: this.out.camera };
    }
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
      rel,
      raiseShape,
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

  // Where a finger's aim drag puts the circle: the circle's screen point at
  // the press plus half the finger's travel since (tune.touchAim), on the
  // ground under the camera of the press (the aim camera follows the circle,
  // so the press's camera keeps the drag steady). As the iPhone's: a tap
  // places, a drag nudges.
  relAim(p) {
    const k = tune.touchAim;
    return this.ground(
      p.rel.x + (p.x - p.x0) * k,
      p.rel.y + (p.y - p.y0) * k,
      p.rel.cam,
    );
  }

  move(e) {
    if (this.freeCam.pointers.has(e.pointerId)) {
      const { x, y } = this.pos(e);
      if (this.freeOn()) this.freeCam.move({ id: e.pointerId, x, y });
      e.preventDefault();
      return;
    }
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
    } else if (p.kind === "dial") {
      const arm =
        this.L.meter === "linear"
          ? armAtY(this.linearG(), y - p.grab)
          : armAt(dialGeometry(this.L.dial), x, y);
      if (this.dialNext != null) this.dialNext = arm;
      else this.dialArm = arm;
      this.dialFresh = true;
    } else if (p.kind === "tap" && p.moved && p.rel) {
      // a finger's drag anywhere on the pitch moves the circle (relAim)
      p.kind = "target";
      const g = this.relAim(p);
      if (g) this.aimResult(this.engine.setTarget(g.x, g.y, false));
    } else if (p.kind === "target") {
      if (p.rel && !p.moved) return; // a finger on the circle: a tap, so far
      const g = p.rel ? this.relAim(p) : this.ground(x, y);
      if (g) this.aimResult(this.engine.setTarget(g.x, g.y, false));
    } else if (p.kind === "stance") {
      const g = this.ground(x, y);
      if (g) this.aimResult(this.engine.setStance(g.x, g.y));
    } else if (p.kind === "punish") this.punishPointer(x, y);
    else if (p.kind === "raise" && p.moved && p.raiseShape) this.raiseDragTo(p);
  }

  up(e, cancelled) {
    if (this.freeCam.up({ id: e.pointerId })) return;
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
      // a finger's tap on the circle places it there, as any tap does
      const g = p.rel && p.moved ? this.relAim(p) : this.ground(p.x, p.y);
      if (g && (p.moved || !p.rel || this.aimable(p.x, p.y)))
        this.aimResult(this.engine.setTarget(g.x, g.y, true));
    } else if (
      ["tap", "zone", "track"].includes(p.kind) &&
      !p.moved &&
      !cancelled
    ) {
      // a tap on the pitch puts the circle there
      const g = this.ground(p.x, p.y);
      if (this.aimable(p.x, p.y))
        this.aimResult(this.engine.setTarget(g.x, g.y, true));
    } else if (p.kind === "raise") {
      // a drag on the kubb: past half way it stands on the end it was tipped
      // toward; short of that it lies back down and nothing is sent
      const drag = this.raiseDrag;
      this.raiseDrag = null;
      this.raiseSel = null;
      if (cancelled || this.phase !== "raise") return;
      if (!p.moved) {
        const i = this.raisePick(p.x, p.y);
        if (i != null) this.raiseTap(i);
      } else if (drag && drag.t >= raiseTune.stand) this.raiseTap(drag.i);
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

  // The wheel over the pitch: the free camera's closer and farther, and nothing else.
  wheel(e) {
    if (!this.freeOn()) return;
    e.preventDefault();
    this.freeCam.wheel(e.deltaY, e.deltaMode);
  }

  releaseAll() {
    this.freeCam.cancel();
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
    // a watched raise: a key skips to its end
    if (
      this.phase === "lift" &&
      !isTyping(e.target) &&
      !e.repeat &&
      !["Tab", "ShiftLeft", "ShiftRight"].includes(code)
    ) {
      if (this.skipLifts()) {
        e.preventDefault();
        return;
      }
    }
    // a watcher's camera keys (docs/OBSERVER.md); never while typing
    if (this.freeOn() && !isTyping(e.target) && this.freeCam.key(code, true)) {
      e.preventDefault();
      return;
    }
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
    if (!isTyping(e.target)) this.aimInput();
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
}

// The throw's distance as the meter shows it beside the prompt (the 1.0
// design: "the throw's distance to the nearest metre on an inverted tab"):
// the plan's own distance, from the stance to the circle (session aimView's
// plan.dist), else the two points' (an older engine), in the canvas's capitals.
export function distanceWords(aim) {
  const p = aim?.plan;
  let d = Number.isFinite(p?.dist) ? p.dist : null;
  if (d == null && aim?.marker && aim?.thrower)
    d = Math.hypot(aim.marker.x - aim.thrower.x, aim.marker.y - aim.thrower.y);
  if (!Number.isFinite(d)) return null;
  return `${Math.max(1, Math.round(d))} M`;
}

// A key pressed in a text box is the text's, not the camera's.
function isTyping(t) {
  const tag = t?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || !!t?.isContentEditable;
}
