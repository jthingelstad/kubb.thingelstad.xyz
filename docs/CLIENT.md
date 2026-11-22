# The game client

The browser side of Kubb: Throwing Wood: the pages `/practice/` and `/p/<code>`, the
requestAnimationFrame loop, the throw by pointer, the HUD, playback with sound, and the
match's cards. The game itself is the Lua engine (docs/ENGINE.md); the drawing is
`src/render/` (docs/RENDER.md). JavaScript draws, listens and plays sounds; every rule is
the engine's.

## Routes

`src/main.js` shows the title while wasmoon and the Lua load (`data-test=loading`), then:

| Page                | What it is                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/practice/`        | The open practice pitch: BATONS or KUBBS (the drill), surface and reset.                                                                                                                                                                                                                            |
| `/settings/`        | The device's settings alone (your name in its name row, meter, meter side, sound): the same rows as MENU's, from Settings on the web game's page, with DONE back to it. The engine is loaded for the names only.                                                                                    |
| `/p/<code>?solo=1`  | A match against the computer. The options card first (your name and SHUFFLE; Scene as seven picture tiles; the engine's rows for it: Surface for Black & White only, Computer level with Kid first, opening, raising, wind; remembered), then START.                                                |
| `/p/<code>?watch=1` | The computer against itself, match after match: no options card, the solo card's saved options, North against South. The winner card stays up 10 s (NEXT MATCH, STOP, HOME), then the next match starts by itself, the other team first. Seen in the wide view by default ("The wide view", below). |
| `/p/<code>`         | A shared pitch: the lobby (your name, Team A or B or watching, a side of several's team name, the host's match options, START), then the match with everyone on the link. docs/MULTIPLAYER.md.                                                                                                      |
| `/e/<code>`         | The embed: a kept replay alone, for a frame on another site ("The embed", below).                                                                                                                                                                                                                   |

`/p/<code>?observe=1` is a shared pitch watched without a seat (WATCH on the open games
list): in step at once, mid-match or not, it never acts or hosts and has its own card
between matches. docs/OBSERVER.md.

A failure to start shows a plain error card with RELOAD and HOME. HOME, on every card, is
the landing page's `/#play` (`/` is the landing page and the web game's page in one since
the 1.0 design; `/web/` answers 301 there for links from before). PLAY NOW there opens `/p/<code>?solo=1&play=1`:
with no kept match options (`soloKept`) the match starts at once on `FIRST_MATCH` (Park, a
Beginner computer, 2-4-6, by hand, no wind) and those options are kept; otherwise the
options card, as `?solo=1`. The HOW TO THROW overlay
(four steps, an animated dial) shows on the first visit and from the menu; `?nohowto` skips it.

## Files

| File                                                                                         | What it does                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.js`                                                                                | Boot, the routes above, the practice tray, the solo flow; hands `/p/<code>` to `src/net/pitch.js`.                                                                                                                                                           |
| `src/game/game.js`                                                                           | `Game`: the loop, input, playback, the raise and punishment scenes, framing. The seam.                                                                                                                                                                       |
| `src/game/hud.js`                                                                            | `Hud`: the rail (who throws, what, the counts), the verdict flag and chips, the rest distance, SLOW MOTION and WATCH, the advantage, the tray's place, the stand-ins.                                                                                        |
| `src/game/tray.js`                                                                           | The tray (the 1.0 design): ARC, TILT/SPIN and STAND as plates of one size, opened one at a time; their words and pictures (pure, `tests/game/tray.test.mjs`).                                                                                                |
| `src/game/plan-sliders.js`                                                                   | The plan's ARC and TILT/SPIN sliders (`PlanSlider`, DOM) and their scales and words (pure, `tests/game/plan-sliders.test.mjs`).                                                                                                                              |
| `src/game/layout.js`                                                                         | Pure: where the dial (or the linear meter), the tray, the header and the minimap go, the tall-canvas framing (`worldFit`, `stillFit`, `panFor`), and the wide view's box (`wideBox`).                                                                        |
| `src/game/scenes.js`                                                                         | The client's own cameras for raising and punishment, and the pieces in them.                                                                                                                                                                                 |
| `src/game/auto-raise.js`                                                                     | Pure: automatic raising for the turn (AUTO ALL) or the match (REST OF GAME on the raise panel).                                                                                                                                                              |
| `src/game/player-name.js`                                                                    | Pure: the device's name (the `name` pref), a generated one: rolled on the first run, a typed name from before replaced on load ("Names").                                                                                                                    |
| `src/game/names.js`                                                                          | The engine's `names.*` door: roll, step, choices, the single-name check (`passes`, `shown`), the lobby's "II" (`apartNames`) ("Names").                                                                                                                      |
| `src/ui/name-row.js`                                                                         | The name row: the name and SHUFFLE; in Settings a stepper per word; `NAME_FIT` ("Names").                                                                                                                                                                    |
| `src/ui/seg.js`                                                                              | The segmented bar: every two to four way choice, one Tab stop with the arrow keys inside ("The 1.0 system", below).                                                                                                                                          |
| `src/ui/welcome.js`                                                                          | The pitch link's welcome for a device new to the game (docs/MULTIPLAYER.md "The welcome").                                                                                                                                                                   |
| `src/game/raise-touch.js`                                                                    | Pure: raising by touch, where the drawn kubb is, which end a tap or drag means, its tilt.                                                                                                                                                                    |
| `src/game/sound.js`                                                                          | `Sound`: the knocks and the king's chord through Web Audio; unlock on the first pointer down; mute remembered.                                                                                                                                               |
| `src/game/nudge.js`, `src/render/nudge.js`                                                   | The throw's nudge: when it shows and the ghost's throw (pure), and its drawing over the meter ("The nudge", below).                                                                                                                                          |
| `src/game/prefs.js`                                                                          | `prefs`: localStorage, wrapped so a blocked store only forgets.                                                                                                                                                                                              |
| `src/game/draw.js`                                                                           | The renderer's functions the game uses, in one place.                                                                                                                                                                                                        |
| `src/ui/cards.js`                                                                            | `Cards`: the engine's hand-off, pass and settle cards (naming who acts on a shared pitch), the winner, solo options, a plain notice, and the raise and punishment panels.                                                                                    |
| `src/ui/lobby.js`                                                                            | `Lobby`: the shared pitch's lobby card.                                                                                                                                                                                                                      |
| `src/ui/watching.js`                                                                         | `WatchCard`: an observer's card between matches, in place of the lobby (docs/OBSERVER.md).                                                                                                                                                                   |
| `src/ui/watch-view.js`                                                                       | `WatchView` (WIDE VIEW or THROWER'S VIEW, MENU's View, V) and `CamBar` (the hint, RESET VIEW) for anyone watching.                                                                                                                                           |
| `src/render/freecam.js`                                                                      | The free camera's orbit and its limits (pure, docs/OBSERVER.md).                                                                                                                                                                                             |
| `src/render/scenes.js` and its looks                                                         | The `Stage` and the seven scenes (`beach.js`, `night.js`, `neon.js`, `minnesota.js`, `tournament.js`, `mono.js`; the day is world.js), the things round a pitch (`scenery.js`), the rings and puffs (`impacts.js`), the spin (`spinAmount`). docs/SCENES.md. |
| `src/game/neighbours.js`, `src/engine/neighbours-worker.js`, `src/engine/neighbours-host.js` | The Tournament's live neighbours: the page's half (when, the clock, the model, `playRecording`, the people, the turn) and the worker running a second engine (docs/SCENES.md "The Tournament's live neighbours").                                            |
| `src/game/rulings.js`                                                                        | The flag after a throw, with a Kid match's rulings in their own words.                                                                                                                                                                                       |
| `src/game/free-camera.js`                                                                    | `FreeCamera`: the mouse, fingers, wheel and keys that move the free camera (docs/OBSERVER.md).                                                                                                                                                               |
| `src/net/pitch.js`                                                                           | `Pitch`: the shared pitch's controller: joins the pitch, runs the lobby, drives the Game through the seam, aim casts, shouts.                                                                                                                                |
| `src/net/lobby.js`, `seats.js`, `sync.js`                                                    | Thin wrappers over kubb-engine's `room.*` rules; cached seat/actor reads keep these calls out of the render loop (docs/MULTIPLAYER.md).                                                                                                                      |
| `src/net/pitch-client.js`, `src/net/aim.js`                                                  | The pitch server's client (`backend/pitch-server/PROTOCOL.md`) and the aim on the wire (docs/MULTIPLAYER.md).                                                                                                                                                |
| `src/net/api.js`                                                                             | `apiCall`: the HTTPS api (`backend/api/API.md`) that replays, reels, shares, reports and records go through.                                                                                                                                                 |
| `src/game/stand-pad.js`                                                                      | STAND: where the thrower stands, the plate's map to the ground and back and its words (pure), and `StandPad`, its DOM and pointer ("Standing", below).                                                                                                       |
| `src/ui/settings.js`                                                                         | The device's settings rows (Your name, Meter, Meter side, Sound), shared by MENU and the `/settings/` page ("Settings", below).                                                                                                                              |
| `src/ui/menu.js`                                                                             | `Menu`: the device's rows (`src/ui/settings.js`), View when watching, Scene (and Surface where the scene leaves one) in practice, then how to throw, resign, feedback, rules, home.                                                                          |
| `src/ui/scene-tiles.js`                                                                      | The Scene as picture tiles (the solo card, the lobby, practice's MENU), from the engine's Scene row.                                                                                                                                                         |
| `src/ui/report.js`, `src/net/report.js`                                                      | The report card, and what a report carries and how it is sent (below, and docs/ROOMS.md section 8).                                                                                                                                                          |
| `src/ui/sheet.js`                                                                            | The score sheet card (below).                                                                                                                                                                                                                                |
| `src/net/record.js`                                                                          | What a solo or watch match's record carries and how it is sent (`POST /api/game`).                                                                                                                                                                           |
| `src/replay/player.js`, `src/replay/fetch.js`                                                | The replay player (`ReplayPlayer`, `startReplay`) and `fetchReplay`, a pitch's kept replay by its code (below).                                                                                                                                              |
| `src/ui/reel.js`, `src/net/reel.js`                                                          | MAKE A HIGHLIGHT REEL: the button and its card (DOM), and the card's states, words and requests (pure, `tests/net/reel-client.test.mjs`); "Highlight reels", below.                                                                                          |
| `src/ui/howto.js`                                                                            | The HOW TO THROW overlay.                                                                                                                                                                                                                                    |
| `src/ui/dom.js`                                                                              | `h()` and `button()`.                                                                                                                                                                                                                                        |
| `public/game.css`                                                                            | The game pages' styles, linked by `src/site/pages.mjs` after the site's.                                                                                                                                                                                     |
| `tests/game/`                                                                                | `layout.test.mjs` (pure), `client.test.mjs` and `multiplayer.test.mjs` (Playwright); `browser.mjs` is their helper.                                                                                                                                          |

## The multiplayer seam

A `Game` knows nothing of networks. It is told who may act in this browser, reports every
action taken here, and plays actions taken elsewhere.

```js
const game = new Game({ engine, canvas, ui, sound, cards, seat, onAction });
```

- **`seat`** `{ sides: ["A"], cpu: true }`: the sides this browser plays and whether it runs
  the computer's side, passed to `engine.setControl`. An optional `seat.mayAct(need)`
  overrides the engine's `need.local`. `game.setSeat(seat)` changes it mid-match.
- **`onAction(action, snapshotText, hash)`**: called after every action applied here (a
  throw, the computer's throw when `cpu` is true, a raise, a punishment kubb, a resignation),
  with the engine's snapshot and hash after it, for the pitch to commit.
- **`game.applyRemote(action)`**: an action taken elsewhere. Applied with `engine.apply` and
  played back here; queued while a throw is still playing back. Returns the engine's result
  (`{ ok: false, ... }` on a refused action).
- **`game.showRemoteAim(state)`**: someone else's aim (their `aimState()`), shown for 1.5 s
  while it is their throw.
- **`game.remoteFeed`** (optional): a function the game calls every frame while it is not
  this browser's turn; what it returns (an aim state, or nothing) is drawn with
  `showRemoteAim`. The pitch hands it the aim buffer's picture, 100 ms behind and between
  samples (docs/MULTIPLAYER.md "Being there").
- **`game.onRelease`** (optional): called with the aim as it stood the frame before this
  browser's throw went, before `onAction`; the pitch sends it as the release's frame.
- **`game.adopt(snapshotText)`**: take a committed match snapshot as it is (a reconnect, a
  disagreement on the hash).
- **`game.aimState()`**: this browser's aim, for the pitch to send while aiming.
- **`game.whoActs(need)`** and **`cards.who(need)`** (optional): `{ text, mine }`, who acts
  for this need. The HUD's status pill shows the text (marigold when it is this browser's),
  and the engine's cards name them; a card for someone else's turn has a WATCH button and
  closes itself after 2.5 s.

Solo is only this seam with no network: `seat = { sides: ["A"], cpu: true }`, the local
player owns team A and this browser runs the computer as B (`src/main.js` `startSolo`).
A shared pitch is the same seam with the pitch server behind it: `src/net/pitch.js` joins
the pitch, builds the seat from the match's teams, sends what `onAction` gives it and
calls the three methods as actions, states and casts arrive. docs/MULTIPLAYER.md has the rules.

## The loop

One requestAnimationFrame loop (`Game.start`, `stop`, `destroy`). The canvas fills the
window at `devicePixelRatio` (capped at 3), is measured every frame so a resize or an
orientation change is picked up at once, and the safe-area insets come in through CSS
variables. The loop skips frames while the page is hidden and resets its clock when it
comes back; `dt` is capped at 1/20 s. An unattended game (`game.unattended`, the
computer against itself) keeps going while hidden: requestAnimationFrame stops there, so
a one-second timer steps it in 1/20 s steps over the time since (up to 90 s a step:
browsers slow a hidden tab's timers to once a minute after a few minutes), drawing
nothing and skipping each throw's playback.

Phases (`game.phase`): `aim` (a throw is wanted: this browser's, or the computer's shown
as WATCH), `play` (a recording playing back), `raise`, `punish`, `lift` (a raise being
watched: "Match flow"), `over`. Actions from elsewhere wait behind `play` and `lift`: a
shared pitch's own queue is held through both (`Pitch.drain`).

In the Tournament scene each tick also posts the match clock to the neighbours' worker
(`Game.sceneryTick`): stopped under a card, in a hidden tab and while a replay is paused,
never waited on, and plays the other pitches' sounds that are due
(`Game.neighbourSounds`; docs/SCENES.md "The Tournament's live neighbours").

## The throw

All by Pointer Events with pointer capture; the canvas has `touch-action: none` and the
game page no text selection. A press is tried in this order: the meter (the clock's ring,
the linear meter's knob, then its body, which takes the press and does nothing), the
target circle (56 px round it on touch, 30 px with a mouse), the thrower, then
the clock's finger track (touch), the linear meter's throw zone, and last a tap on the
pitch. The tray (ARC, TILT and STAND, "The tray" below) is DOM and comes before all of it;
a press outside it first closes an open plate. On a
wide canvas a finger grabs the linear meter's knob across its channel only, and the rest
of its body is throw zone (a tap aims, a drag strokes): `linearFirst` and `inLinearZone`
in `src/game/layout.js`, "A phone on its side" below.

- **The dial** (lower right on a wide screen, lower left with MENU, Meter side, Left; lower
  centre on a tall one): drag is the arm, letting go is the release. Pointing and
  throwing work touching only the dial.
- **The target**: drag the circle, tap the pitch, or the arrow keys. A finger aims as on
  the iPhone (a tester, 2026-11-19: aiming is "very touchy and hard to place"): a tap
  places the circle, and a drag from the circle or from anywhere on the pitch moves it
  relatively at half the finger's travel (`tune.touchAim` 0.5, finger 2 : circle 1),
  measured under the camera of the press (`Game.relAim`), so it never jumps under the
  finger and the finger never hides it. A mouse drags the circle itself, as before. The
  meter's presses come first: a tap in the linear meter's throw zone still aims and a
  drag there strokes the meter; a drag on the clock's finger track still turns the arm.
- **Standing**: STAND in the plan, a drag on a picture of the line ("Standing", below).
  Or A/D and W/S, or STAND's arrow keys. There is no WALK.
- **The plan**: the ARC and TILT (a baton) or SPIN (a kubb) sliders and STAND, each a
  plate of the tray opened by a tap ("The tray" and "The plan's sliders", below); R/F and
  Q/E step them without opening anything.
- **Side view** (the engine's plan view: the camera out over the shoulder, the planned arc
  dashed): shown while ARC's plate is open (SIDE VIEW is no longer a button: the 1.0
  design); held Shift peeks; dragging TILT shows it. Starting a throw turns it off (the
  press closes the plate).
- Space skips a playback.

**The plan's sliders** (2026-11-19, `src/game/plan-sliders.js`). Jamie: "I'd like to make
arc and tilt less buttons and more a slider with continuous movement. "Plan View" is also
a super weird label. Need a different word. ... It is all a hangover from us starting on
play date". The four step buttons were the Playdate's "hold B and press the d-pad"; they
are two sliders now, and PLAN VIEW is SIDE VIEW.

- **ARC** is vertical, up a higher arc, and continuous: the track is the engine's planned
  release, 15 to 165 degrees on the clock (`plan.tune.releaseMinDeg/MaxDeg`), fed through
  `engine.setArc`. A higher release is a higher loft, and the header reads the loft as
  before (`ARC 32°`). The knob sits where `aim.plan.release` says, so the engine's clamp
  and a fresh plan move it. Its marks are the clock's hours from 1 to 5, 3 o'clock (the
  normal throw, loft 32) long.
- **TILT** (a baton) or **SPIN** (a kubb) is horizontal, 0 in the middle with a long heavy
  mark, to 20 degrees either way for a baton's tilt and 3 for a kubb's spin.
- **Any value** (engine 0.9 on; Jamie, 2026-11-20: "sliders, not step buttons"). The
  engine gives each slider's range in `aim.controls` (`{ min, max, value, default, tick,
step, unit, scope }` for `arc`, `tilt` and `spin`), and the slider takes any value in it:
  `setArc`, `setTilt {deg}` and `setSpin {spin}`. Its marks are drawn from `tick` (a small
  one at every tick, a full one at every `step`), and the value is free between them. The
  header reads whole degrees and a spin to a tenth (`TILT 7R`, `SPIN 1.3L`). An arrow key
  moves a tick from where it is; PageUp and PageDown, R/F and Q/E move a step.
- **On 0.8 and 0.7** (a match played or replayed on its own engine) there is no
  `aim.controls`: TILT and SPIN settle on the engine's steps, 5 degrees and 1, through
  `stepSide(target - current)`, the knob easing onto the nearest when let go, as before.
- **Spin is kept for the turn** (engine 0.9): the spin a kubb was thrown with is where the
  same side's next kubb starts (`aim.plan.spin`, `controls.spin.value`; in practice, throw
  to throw). The slider shows the kept value when the next kubb comes up, and nothing on
  the page resets it.
- **Read it while you drag.** Each slider is a plate in the game's look (paper, ink rim,
  hard shadow, the linear meter's wooden knob) with its value on a wooden header above
  the track, and its marks in a lane beside the slot: above it for TILT, on ARC's inner
  side (toward the screen's centre, away from the thumb). The finger is under the knob,
  never on the words or the marks. The whole body takes the press (at least 44 px across
  the drag): a press anywhere jumps the knob there and keeps dragging. `role="slider"`
  with `aria-valuemin/max/now` and `aria-valuetext`; the arrow keys step it while it has
  the focus.
- **Dragging shows the arc.** While a slider is held, and `tune.slidePeek` (0.5 s) after,
  the engine is fed `plan` (the side view), so the player sees what the change did without
  a second button; ARC's open plate shows it the whole time it is open.
- **The slider says what it does** (a tester, 2026-11-19: "I can't tell what tilt does at
  all", and nothing said how arc and tilt affect the toss; Jamie: "Have the UI show it not
  a separate how to page"). While a slider is held, and through the peek after, one line
  above the plan says what it does, in the iPhone's words set in the HUD's capitals:
  ARC "A higher arc drops in steeper. A lower one skids in.", TILT "Tilt leans the baton
  to steer it through a group.", SPIN "Spin keeps a drilled kubb steady in the air."
  (`plan-sliders.js` `CAPTIONS`, `Hud.showCaption`). It sits above the plan's block (and
  above the linear meter's prompt tab), where the finger on the slider is not, below the
  far half where the targets are. While TILT is held a small baton beside the words leans
  by the plan's tilt (`leanOf`, 5 degrees a step, against a dashed upright): the web draws
  no baton in the thrower's hand while aiming, so this is where the lean shows.
- **Once a frame.** A drag only records where the finger is (`Game.planSlide`); `aimFrame`
  sends the latest place to the engine once a frame (`applySlide`), before its `frame`
  call. `setArc` replans and refits the camera at once (`throw.setArc` calls `replan`), so
  the dashed arc and the dial's release band follow the drag; it does not set `planDirty`,
  and needs not.
- **Online**, the aim is cast on its own clock, 15 a second at most and only when it
  changed (`src/net/aim.js`): a drag that changes the aim every frame sends no more than
  walking or dragging the circle does, under the pitch server's 16 a second.
- **Where.** In the tray ("The tray", below): each slider is the inside of its plate,
  shown while the plate is open. ARC's lane of marks is toward the screen's centre.
- B still peeks as Shift does (the Playdate's B button) but is not documented on the
  page.

**Standing** (Jamie, 2026-11-19: "Can you audit the control surface from a broader level
that would catch these type of odd engagements. It is all a hangover from us starting on
play date"). WALK, the Playdate's held A, was a toggle that made the next drag on the
pitch a joystick for the thrower: the same press meant something else depending on a
button pressed before it. The pitch could not take a direct drag instead: in the
thrower's view the camera stands behind the thrower, whose spot projects below the
screen's bottom edge (about 180 px below a phone's, far more on a desktop). So STAND
(`src/game/stand-pad.js`) is a plate in the tray, at least 44 px tall open: the throwing line
seen from above, the ground behind it the rules allow (light), the advantage line dashed
when there is one, and a ring where the thrower stands.

- A press anywhere on it puts the ring under the finger and the thrower there; a drag
  follows by position, not speed. The plate spans the line's width (`halfWidth` either
  way), from `backMax` behind it to `tune.front` (0.6 m) in front of the forward limit
  (the advantage line for a baton, the line for a kubb). `groundAt` and `fractionOf` map
  both ways. The span is frozen at the press, so the plate does not slide under the
  finger as the stance moves.
- Once a frame (`applyStand`, after `applySlide`) the latest place goes to the engine's
  `setStance`, which clamps it to the line's ends, `backMax` and the forward limit, as its
  walk keys are. JS does not clamp. Nothing is thrown and the target circle stays.
- While held, and `tune.standPeek` (1 s) after, the caption above the plan says where and
  what: "1.2 M LEFT, 0.5 M BACK. Stand on your line or behind it." (or "... or
  up to the advantage line."). The aria-label carries the same words. STAND is the tray's
  third plate: closed, the line from above with the ring; open, this plate.
- With the focus, the arrow keys step it `tune.keyStep` (0.25 m). A/D/W/S still walk as
  the engine's keys do. The pitch's presses (a tap aims, a drag moves the circle, the
  linear zone's stroke) never walk.
- The pitch's own "stance" press (on the thrower where it is drawn) is still in the press
  order, and only matters in a view where the thrower is on screen.

**The meter is the player's choice** (MENU, Meter: Clock or Linear; the `meter` pref, this
device's, the clock by default). Jamie, 2026-11-19: "I'm considering a player preference
for a circular meter (clock) versus a linear meter ... The logic is the same to me. Just a
choice if you want to spin your thumb or crank -- or use a different hand to flick." Tyler
strongly prefers the circle, so the dial stays and stays the default.

- **The linear meter** (`src/render/linear.js`) is the dial unrolled into a straight track
  at the right edge of the screen: the knob's home in the middle is the clock's 6, the
  backswing runs down from it (toward the player) and the forward swing up (toward the
  target). Grab the knob, draw back to the stripes (the power band), fling up through the
  middle and let go on the solid mark (the release band). The body is two columns: the lane on the left carries the targets
  and the live peak, and the channel carries the knob and the last throw's ghosts, so the
  knob and the finger on it never hide a target. The prompt is a tab on its left at the
  knob's home.
- **The marks by pattern** (the 1.0 design, "Meter"): the power band is striped (its
  colour in stripes on paper, the deep colour the same across the ring or the lane), the
  release band solid, both with heavy ink end-marks; on the clock's finger track the power
  band is dashed. Colour stays, but it is no longer the only signal, in every scene. The
  overpowered zone is cross-hatched (it was hatched one way), so the stripes are the
  power band's alone, as the coach's "the stripes" needs.
- **The distance** (the 1.0 design): beside the prompt (WIND BACK, DRAW BACK, FLICK!) an
  inverted tab with the throw's distance to the nearest metre, "8 M", from the plan's own
  distance (stance to circle, the session's `plan.dist`): on the clock the two centred over
  it, on the linear meter at the prompt tab's free end (`tabRect` allows 7 of its heights
  for the two). Only on this player's own throw.
- **A watched turn** (the computer's, or another player's on a shared pitch): the meter at
  half strength, its prompt a WATCH tab on the thrower's team colour, and no WATCH pill
  over the pitch (the 1.0 design's computer's turn: "the header, a WATCH tab in the
  computer's colour and the faded meter"). Round a card that dims the pitch the meter is
  not drawn at all.
- **The last throw's marks are ghosts, not targets** (a tester, 2026-11-19, of the hollow
  ink rings that marked it: "the target dot is in the red"). Where the last throw's back
  and stop were, both meters draw a faded ghost of the knob (and on the clock the outer
  part of the arm): the knob's wood at 60% of its size and 45% opacity, edged in the
  stem's brown and never in ink (`dial.js` `tune.ghost`, `ghostAlpha`, `ghostKnob`). It
  reads as where the arm went; the power and release bands stay the strongest things on
  the meter. On the linear meter they lie in the channel, under the stem and the knob.
- **Red never covers the target.** The overpowered zone starts at the session's fixed
  `overDeg` (150, 11 o'clock) or past the power band, whichever is further back
  (`dial.js` `overFrom`, both meters), because the engine's overpower cost counts from
  the band's far edge (`throwplan.lua`: `past = back - sol.powerHi`). A low arc at the far
  baseline wants 154 to 170 degrees, which the fixed zone used to paint red.
- **It feeds the engine what the dial does**: the same `arm` in degrees
  (`armAtY`: one scale both ways, because the flick's speed is degrees a second), through
  the same feed below. So power, the flick's speed, the release and steadiness are judged
  exactly as on the clock, a throw's action is the same on a shared pitch, and the choice
  needs no engine release. A press on the knob is the arm at 6 wherever on the knob it
  lands (the grab is relative); a press elsewhere on the body only keeps the press from
  the pitch behind it.
- **Room is the point.** The straight-through trial of 2026-11-18 was removed because,
  in Jamie's words, "it was too cramped and visually looked janky": it had 150 px for
  the whole backswing inside the dial's box (0.8 px a degree). The linear meter is the
  height the screen can give it up to a cap (`layoutFor`'s `meter`, `linearBox`). The first
  build took 60% of a tall screen (447 px of travel on 390 x 844); a tester, 2026-11-19:
  "Make it 1/4 shorter", and Jamie agreed. It is 47% now (`linearH` 0.47, never under
  `linearHMin` 390 px, never over `linearHMax` 450): 338 px of travel there, 0.94 px a
  degree, 0.92 in a phone's browser with its bars showing, 1.05 with a mouse. Its foot
  stays where the thumb is, so the quarter came off the top. Where the track would be shorter than
  `minTravel` (320 px upright: a small phone's browser) or `wideMinTravel` (210 px on a wide
  screen, below) the layout's `meter` is `"clock"` and the dial is drawn; the menu says so
  under the choice. On a tall screen the plan splits either side of the throwing line, left
  of the meter.
- **A phone on its side keeps it** (Jamie, 2026-11-19, of the iPhone app: "Bug: On iPhone if
  I turn on linear and then rotate it goes back to the circular swing."). The chosen meter
  holds when the phone turns; it is never swapped for the clock because of rotation. On a
  wide canvas the box takes the whole safe height at its edge, from `tune.linearTopWide`
  (10 px) under the safe top to half a margin (7 px) over the safe bottom, at most
  `linearHMax` (450), so a desktop window's box still stands on the bottom where it was; the
  track needs `wideMinTravel` (210, `linear.js`) instead of the upright 320: 301 px on
  844 x 390, 261 on 740 x 350. A shorter screen may have a shorter track (Jamie,
  2026-11-20, asked whether to lower the floor for a 6.1-inch iPhone in Safari: "Yes lower
  the linear track for that one. It doesn't have to be same size for all. Diff phone size
  can change it."). The floor was 260, the iPhone app's, and Safari with its bars showing
  gave a 6.1-inch phone on its side the clock. What Safari gives on its side, with the
  page's `viewport-fit=cover` (heights from Playwright's device list, which records real
  Safari; the side and home-indicator insets and the heights with the bars hidden are best
  knowledge, not measured here; the SE's height with its bars is a guess):

  | Phone (screen, points)   | Bars showing: viewport, track | Bars hidden: viewport, track |
  | ------------------------ | ----------------------------- | ---------------------------- |
  | 6.1-inch, 844 x 390      | 844 x 340 to 342, 230 to 232  | 844 x 390, 280               |
  | 6.1-inch, 852 x 393      | 852 x 343, 233                | 852 x 393, 283               |
  | 6.3-inch, 874 x 402      | 874 x 352, 243                | 874 x 402, 293               |
  | 6.7-inch, 932 x 430      | 932 x 380, 270                | 932 x 430, 320               |
  | 6.9-inch, 956 x 440      | 956 x 390, 281                | 956 x 440, 331               |
  | 5.4-inch mini, 812 x 375 | 812 x 325 to 327, 215 to 217  | 812 x 375, 265               |
  | SE, 667 x 375            | about 667 x 325, about 236    | 667 x 375, 286               |

  The insets: 47 px a side on 844 x 390, 59 on 852 and 932, 62 on 874 and 956, 50 on the
  mini, 20 or 21 at the bottom, none on the SE. So 210 keeps 20 px under the 6.1-inch
  phone's 230 and the mini keeps the linear meter too, by 5 px: Safari a few px taller
  there gives it the clock, as before. Every phone in the table keeps it, in every header
  and on both sides. The box needs a canvas 299 px high with no insets (320 with a 6.1-inch
  phone's); under that it is the clock, and so is the first 4-inch SE (568 x 320) in
  practice, where the tray meets the rail. The short track is the same instrument at a
  finer scale (0.64 px a degree at 230, 0.58 at 210, against 0.84 at 301): the arm is
  degrees, so the flick's speed (degrees a second), the bands, the SLOW verdict, the
  coach line and the nudge's ghost all follow it, and the knob, the tab and the grab are
  the body's width, not its length. The narrowest target, the pro level's power band (8
  degrees), is 4.7 px at the floor. The iPhone app is unchanged: every iPhone on its side
  gives it at least 265 pt, over its 260. The other numbers are the iPhone app's
  (`WideLayout`, `LinearMeter.layout`). Where the box comes up into the header row, the plates at that
  top corner move in beside it, `tune.meterGap` (10 px) off its body: MENU, the practice
  tray or the view tray, SKIP and the update note at the right, the rail, the shout bar
  and the shouts at the left
  (`meterRoom`; the game sets `--meter-r` and `--meter-l` for `game.css`; nothing moves in
  the wide view, which draws no meter). The tray, the coach line and the nudge go as
  below.

- **Not yet**: the meter in use is not recorded with the throw (that needs an engine
  field), there is no steering from the stroke's straightness (an engine change too), and
  the touch pendulum trial (below) keeps the clock.

**The finger and the meter apart** (2026-11-19). Jamie: "When you're touching the ring,
you can't see where you are on the ring. So it would almost be helpful to be able to
touch outside the ring so that you can see where the movement is. Think of the same thing
for the other control. There's visual nudges there that help you know what to do, but you
can't see them if you're touching them. So if you can have the control and the touch be
slightly distant from each other, that could make that better." Nothing fed to the
engine changes in kind: both still send `arm` in degrees through the dial feed.

- **Stroke anywhere on the linear meter.** A drag that starts in the throw zone, the
  canvas below `tune.zoneFrom` (0.6 of its height, `src/game/game.js`), drives the knob
  exactly as a grab of the knob does: the press point is the knob's home and the arm is
  `(y0 - y) / scale` at the meter's own scale, clamped. Targets are always in the far half
  of the pitch, and on a phone held upright the centre line is at 0.54 of the height
  (0.59 in the browser with its bars showing), so the zone is the near half, with nothing
  to aim at; the meter becomes a gauge watched while the finger works below the pitch. On
  a wide canvas the whole view is far half (the centre line is below the bottom edge), so
  field kubbs can lie in the zone there; only a drag throws, so nothing is lost. With a
  finger on a wide canvas the zone is the meter's half instead, top to bottom (the lower
  40% of a phone on its side is about 156 px, too shallow for a whole draw back and flick;
  the plan block and the minimap are on the other half), and the meter's body away from
  the knob's channel is zone too (the whole-height body stands over the far baseline's
  outer kubb); the knob's channel and 6 px past the body's outer edge (`chanOuter`) grab
  at once. A mouse keeps the lower band and the body as before. The
  press starts as a tap: released within `tapSlop` (10 px) it puts the circle there as any
  tap does. Moved past it, it becomes the stroke: the engine is fed arm 0 for the press
  first (`dialNext` holds the finger's arm until that frame), then where the finger is,
  so the engine's arming rule (a press at 0, then back) holds as for a grab. Every
  pointer, the mouse too. The plan's sliders, buttons and STAND, the knob and the meter's body,
  the circle and the thrower all come first, and `?throw=swipe` keeps the clock.
- **Touch beside the clock's ring.** On touch and pen a press may land on the ring as
  before (within 1.25 radii of the centre, `grabSlop`) or outside it, out to 2.1 radii
  (`dial.js` `touchReach`), and the arm is the angle about the centre at any radius, so a
  finger can go round outside the rim and leave the marks and the knob in view. Where a
  tap out there could aim (ground the circle can go to lies under the track: all of it on
  a wide canvas), the press waits (`track`): let go within `tapSlop` it is the tap, and
  the circle goes there; moved, it is the dial's, fed to the engine as the press where it
  landed and then where the finger is. A press
  on the ring is exactly as before (Tyler plays the circle on a phone). A mouse is as
  before. On a touchscreen held upright (`layoutFor`'s `coarse`, from
  `(pointer: coarse)`) the clock is 13% smaller (`tune.trackShrink` 0.87) and raised until
  the finger track (1.1 to 1.55 radii, `st.track`) clears the bottom: on 390 x 844 the
  radius goes from 101 to 88 px and the centre up 20 px. The track is drawn as a thin ink
  rail on a paper casing along its middle, only where a finger goes (12 o'clock down the
  back side, round 6 and up the forward side to `tune.trackPast`, 14 degrees, past the
  release band), with an hour pip every 30 degrees and the two targets laid on it; it
  stops short of the prompt plate. While a finger holds the dial from outside the ring
  (`st.finger`, the pointer's place), a thin spoke runs from the knob out to a ring at the
  finger. The plan then stands above the track (`plansFoot`), in two columns
  either side of the throwing line. A phone on its side has no room for the track:
  touches outside the ring work where there is screen (with the spoke), and no track is
  drawn.

**Left or right** (Jamie, 2026-11-19, about the linear meter: "Can you flick anywhere?
Left and right handed folks may want it on one side or the other."). MENU, Meter side, Left or
Right (the `meterSide` pref, the right by default; `game.setMeterSide`). The linear meter
sits at that edge on every canvas, mirrored: its lane toward the screen's centre and its
prompt tab hanging toward it (`linearGeometry(rect, side)` returns `side`, `laneLeft`,
`chanX`, `divX` and `tabDir`). On a wide canvas the clock goes lower left, and with a
mouse the minimap goes to the bottom right and the plan to the dial's inner side (a
touchscreen's plan and minimap are at the other edge, below); on the left a wide
canvas's linear meter whose box reaches the header row moves the rail in beside it. On a tall canvas the
clock is centred and the side has no effect on it (the menu says so); the linear meter's
plan splits across what the meter leaves.

**The tray** (the Throwing Wood 1.0 design, "Aim layout", the owner's choice of
2026-11-21: "the set-up tray (ARC, TILT, STAND as three equal plates) stays visible at
the edge away from the meter; SIDE VIEW is no longer a button"; it carries on Jamie's two
hands of 2026-11-19: "in landscape the tilt, arc, stand controls should be pushed to the
left hand side of the screen so the user can control those with the left hand and the
throw with the right hand"). `src/game/tray.js` is the DOM and the keys, `layout.js`
`trayAt` the place, `hud.js` `place` the sizes; docs/SYSTEM.md "Play screens" has every
number.

- **Three plates of one size**, ARC, TILT (SPIN for a kubb) and STAND top to bottom, 86
  by 60 on a phone (a short side under 520 px) and 104 by 70 wider, 8 px apart, each its
  value on a wood band over a small picture of it (the planned arc dashed, the leaning
  baton, the line with the ring). A plate is a button (`aria-expanded`, its value
  spoken: "Arc, 22 degrees"); the column is the group "Throw set-up".
- **Where.** At the screen's edge away from the meter, 12 px inside the safe area:
  upright the left edge beside the clock or the linear meter (the right edge with Meter
  side, Left), wide the left edge with the meter at the right and the right with it at
  the left. A mouse too: the block beside the meter went (one hand did everything there,
  but the design gives one place). The foot is 10 px above the meter's box's foot;
  upright beside the clock it stands above the clock's face and, on a touchscreen, its
  finger track where its inner edge is (the throwing thumb's ground stays clear: on 390 x
  844 the column is at 12, 340 to 536 while the clock's centre is at 667), and above the
  prompt. On a short screen the column comes down toward the safe bottom, then its
  plates grow shorter, never under 48 px to a finger.
- **Open.** A tap opens a plate, one at a time: it grows up from its place, the column's
  foot staying, into its control: ARC's slider, TILT's or SPIN's, STAND's line from above
  (TILT and STAND also grow in toward the middle, short of the screen's centre by 24 px
  and of the minimap where it stands lower beside the column). Where the room under the
  header (or the minimap, or a corner's plates) leaves an open plate under 100 px with
  the others showing, it covers them from the foot up. ARC open is the side view until it
  closes. The band of the open plate closes it, and so do Escape (the focus back on the
  plate), a press anywhere outside the tray (which then does what it does: a tap still
  aims, a press on the meter throws) and opening another. From the keyboard: Tab reaches
  each plate, Enter or Space opens it and gives its control the focus, the arrows step
  it; the arrows on a closed plate step it too.
- **What went.** `planAt`'s block beside the meter for a mouse, the split either side of
  the throwing line upright, SIDE VIEW, the minimap stacked over the block or left out on
  a narrow canvas, and the plan's own size (202 x 168). What stayed: the clock where a
  screen cannot give the linear track its travel (`minTravel`, `wideMinTravel`), and
  where the header row would be crowded (`headerFits`); the far edge for the other hand
  on a phone on its side (now everywhere); nothing on the throwing line on a wide screen.
- **The minimap** hangs under the header's right end in every layout, 8 px under it, so it
  never moves while a control is held: the header has a fixed width for the layout
  (`headerBox`; tall the safe width, wide 40% of it, 260 to 400 px). Since the minimap
  can meet a narrow window's prompt tab, the linear meter now holds from 560 px wide in a
  match (it was 480), 580 in practice and 540 watching as before; with notch insets 640,
  680 and 640.

The held slider's caption stands over the tray, growing from the screen's edge the tray
is at toward the middle, at least 330 px wide where there is room (never onto a tall
canvas's linear meter, and lifted above a wide canvas's prompt tab where its span reaches
it); where an open plate has taken the room over the tray it stands beside that plate's
top on its inner side. The iPhone's caption strip beside SHOUT has no web counterpart. On
a short screen only the newest shout shows.

**The nudge** (2026-11-19). Jamie: "A couple of users have had a lot of confusion on how
to throw. It would be awesome if we see the user not making progress on a throw to
animate a nudge in the screen on what to do. Have the UI show it not a separate how to
page." When a player is stuck, a ghost of the knob makes one good throw on the real meter,
in place, and a ghost fingertip shows where the finger goes. `src/game/nudge.js` is the
pure part (the trigger and the timeline, every number in its `tune`), `src/render/nudge.js`
draws it from the meters' own geometry, and `Game.nudgeFor` and `drawNudgeOn` are the
hooks, right after `drawMeter`. The HOW TO THROW card is unchanged.

- **When.** Only while it is this player's own throw: the aim, `mayAct()`, no card or
  menu (`modal`, `cards.open`), no pointer down, the dial idle, no plan view; never
  watching, in the wide view, a replay or the embed (`driver`), the computer's or another
  player's turn, or the `?throw=swipe` trial. Its waits count only that time. A device
  that has made fewer than `learnedAt` (3) throws (the `throwsMade` pref, capped at 9) is
  nudged after `wait` (8 s) in the aim without a press on the meter (taps that move the
  circle do not count). A learned one is nudged after `fumbles` (2) presses on the meter
  in a row that made no throw (a press let go unarmed, a release in the dead zone, a
  press on the linear meter's body), `fumbleDelay` (0.8 s) after the last, or after
  `idle` (30 s) with no input of any kind. Two fumbles bring it on a new device too. A
  throw clears the fumbles. Whether a press threw is the engine's answer on the frame
  after it ends (`nudgeEnd`).
- **Stops** at once (a `fadeOut` of 0.15 s) on a press on the meter, the finger track or
  the throw zone; a tap in the zone that stays a tap keeps it away `tapResume` (1.5 s).
  While nothing changes it loops: pressed at home (0.4 s: the fingertip comes down, a ring
  closes in), drawn back to the middle of the power band (0.9 s, eased), a beat (0.25 s),
  the flick to the middle of the release band (0.25 s), let go (0.35 s: a ring opens out,
  the ghost fades), a second's rest.
- **Where.** The ghost knob and arm are dashed ink over a light paper fill; the real knob
  stays home under it. On the clock with the finger track the fingertip rides the track at
  the ghost's angle; otherwise it is on the ghost knob (a mouse pointer with a mouse). On
  the linear meter on touch it is in the throw zone on the meter's inner side, clear of
  the prompt tab and the plan (between their columns on a tall screen; on a wide one in
  the meter's half, halfway from the centre line to the tab, level with the knob's home,
  its flick's top under the header row's foot), moving down and up with the ghost knob; a mouse's pointer rides
  the ghost knob, which a mouse grabs. The plate follows the ghost in its
  own words: WIND BACK, then FLICK! from the beat on (DRAW BACK, FLING! on the linear
  meter). With `prefers-reduced-motion: reduce` it is a still picture: the ghost at the
  back with an orange arrow for the draw back and a blue one for the flick.
- **Drawing only.** The ghost's arm is never fed to the engine, sent or recorded.
- **Tests.** `tests/game/nudge.test.mjs` (the trigger and the timeline) and
  `tests/game/nudge-client.test.mjs` (Playwright: the wait on a fresh device for both
  meters, portrait and desktop and Side Left, a press stops it, learned after 3 throws,
  two fumbles, watching and the menu hold it off, reduced motion). They shorten the
  waits through `window.__kubb.game.nudge.tune`, which exists only on test hosts;
  `game.nudgeFreeze` holds the timeline at a time and `game.nudgeState()` reads it.
  `KUBB_NUDGE_SHOTS=build/shots-nudge` saves screenshots of three moments.

**The coach line** (2026-11-19). A tester: "Does it matter how quickly or slowly I track
my finger". It does, but only one way, and the meter now says so in place (Jamie: "Have
the UI show it not a separate how to page"). A line of words sits just over the meter's
prompt and follows the stroke: PULL BACK TO THE STRIPES at rest, NO RUSH GOING BACK
while drawing back short of the power band, and NOW FLICK FAST AND STOP ON THE SOLID MARK
from the band on (the 1.0 design names the marks by their shape, not their colour: the
owner's decision of 2026-11-21, with the iPhone's Coach.swift). It is one inverted ink
chip, the SLOW lead on its own line inside it, never pills of their own. That is the engine: the
pull back sets the power at any speed, a flick slower than `fullFlickDps` delivers only
part of it (the verdict SLOW), and the throw leaves where the flick stops.
`src/game/coach.js` is the pure part (`coachFor`, `stageOf`, `slowVerdict`; tested in
`tests/game/coach.test.mjs`); `Hud.showCoach` places it.

- **When.** On a device with fewer than 3 throws (the nudge's `throwsMade` count), and on
  the throw after one of this player's own the engine called SLOW, whatever the count;
  that throw's line is led by SLOW FLICK. FLICK FASTER. in the SLOW chip's ink. Only on
  this player's own aim (the plan showing), never while watching, in the wide view, while
  the nudge's ghost plays the same stroke, or while a slider's caption is up (one voice at
  a time).
- **Where.** Centred over the clock's prompt plate (moved over, not squeezed, by an open
  plate beside it), or over the linear meter's tab from the meter's inner edge, 8 px above
  it, at most 280 px wide and short of any plate level with it, so it never covers the
  tray, the minimap or MENU. Beside a wide canvas's linear meter (the tray is always at the
  far edge now) it hangs 8 px under the tab instead, in the meter's half (`planClear` short of the centre line), as on the iPhone:
  over the tab it would meet the verdicts and the header on a short screen. It takes no presses:
  a tap through it still aims.
- **Drawing only.** Never fed to the engine, sent or recorded.

**The dial feed.** While the dial is held, the engine is fed once per pointer sample with
the time since the last one (and, when the pointer is held still, every 1/30 s), not once
per display frame. A pointer that reports at half the frame rate (a busy page, a 120 Hz
screen) would otherwise read as a stop-start, shaky swing; the core's swing speeds are
delta over dt, so a varying dt is honest.

## Framing

On a landscape screen the renderer's scale rule holds. A tall canvas (a phone upright)
would show the 400 x 240 frame as a thin band, so the client passes its own mapping as
`view.fit` (docs/RENDER.md): `worldFit` zooms to 1.3 times the width fit, places the far
baseline at 41% of the height (its frame y read from each throw's aim camera,
`Game.farFrameY`; 33% of a fixed frame y until web 0.17.0, which left the far kubbs at
30% and under the verdict), and pans across (eased) to keep the target circle in sight;
the pan holds while the circle is dragged. The raise and punishment scenes use
`stillFit`, the whole width (the raise zoomed 1.8 on its kubb). Every un-projection goes
through the same `view.fit`, so a finger lands where it points (tested in
`layout.test.mjs`).

On a short wide canvas (a phone on its side, 460 px high or less) the raise and
punishment panel is a bar along the bottom (see "Match flow"), and the scenes keep the
renderer's rule: on the phones measured the near baseline is already clear of it. The
rule `stillFit` holds is that the punishment scene's near baseline (`punishNearY()`,
frame y 164.0: the camera looks straight down the pitch, so the whole baseline is level)
sits at least `tune.stillClear` (8 px) above the bar's top, taken as `tune.stillBar`
(80 px: the bar's two-line height, 71 px, with its 8 px off the safe area) above the
safe area's bottom inset. Where the renderer's rule would bring the baseline lower, as on
a 640 x 300 window, the scene is lifted by just the difference at the same scale and
nothing else moves. The raise needs no lift: its kubb, both numbers and a drag along it
sit near frame y 91, far above the bar. Taller canvases and tall screens are unchanged.

The raise and punishment cameras are the client's own (`src/game/scenes.js`): across the
lying kubb from the defender's side, and high over the defender's baseline. Since web
0.17.0 the raise camera stands twice as far off (2.3 m back, 2.1 m up), so twice the
ground shows round the kubb: its numbers in docs/SYSTEM.md "The raise view".

## The wide view

Watching the computer is seen from one fixed place by default (Jamie, 2026-11-16: "It'd be
fun to actually do more with the camera on the web version because we could zoom out. We
have a lot more screen. We could see a lot more."): the whole pitch, both baselines, the
six stakes, the king and every kubb, with each throw watched from there, from the
thrower's end through the flight to what falls, and no aim, follow or impact cuts. It is
meant to be left running (Jamie: "Think more like Zen screensaver ... I'm just watching
some Kubb being played"), so the camera never moves.

- **Where it stands.** On a landscape window, a broadcast camera high on the sideline
  (6.5 m out, 7 m up), square to the middle of the pitch: the pitch's 8 m run across the
  window, Team A's baseline on the left and Team B's on the right, the same size, so
  neither team is nearer. On a tall window (box width under 1.05 times its height) it
  stands high behind Team A's baseline with the pitch running up the screen.
  The engine's `session/wide.lua` `wide.tune`.
- **Filling the window.** The client passes `engine.setWide(box)` the whole window as the
  400 x 240 frame's coordinates see it, less the HUD's margins (`layout.js` `wideBox`:
  70 px at the top for the rail, 132 on a tall window, 16 elsewhere). Lua fits the
  camera's lens and centre to that box so the pitch, a baton at the top of its flight
  (1.95 m) and the throwers' ground fill it. The frame stays only as the coordinate system:
  the ground, the rough, the pieces, the bursts and every un-projection go through the
  same camera and the same scale rule, so nothing is letterboxed. It is fitted again on
  every resize.
- **One view for both teams.** The session keeps Team B's throws in Team B's view frame
  (the pitch turned 180 degrees, core/frame). In the wide view the engine's `session/api.lua` passes
  every result through `wide.out`, which puts in the wide camera and un-turns the pieces,
  the aim, the minimap and the bursts' anchors into the world frame (Team A's) whenever
  the session's frame (`Session.frameSide`) or its last recording's (`Session.recSide`)
  is Team B's. JavaScript still never flips anything: it draws what Lua gives it. The
  thrower's arrow takes `facing = -1` for Team B there. Turning only the camera would show
  the same pitch, but the light and the rough are fixed in the drawn frame, so the shadows
  would swing round at every change of ends.
- **What shows.** The rail (who throws, `TURN n · BATON n OF n`, the counts), the result
  flag, SLOW MOTION, and the thrower's ring with its arrow. No dial, target circle, arc,
  minimap or advantage label: they are a thrower's tools. The bursts are drawn at 16% of
  the window's short side (30% in the thrower's view). The calm pacing and the hidden tab
  are unchanged.
- **Switching.** A button beside MENU names the other view (THROWER'S VIEW while the wide
  view shows, WIDE VIEW otherwise), MENU has View (Wide, Thrower's), and V toggles. The
  choice is remembered as the `watchView` pref; wide is the default. Players (solo,
  a side on a shared pitch, practice) always use the thrower's view and have no switch;
  a member watching a shared pitch's match has it.
- **Too small.** Where the smallest base kubb would stand under 2 CSS px for a watcher
  (`tune.observeMinPx`) or 6 otherwise (`tune.wideMinPx`), the thrower's view shows
  whatever is chosen and the button is hidden; it comes back when the window grows. Every
  wide view today has a watcher, so a phone held upright (about 4.5 px) now keeps it.
- **The free camera.** A watcher (watching the computer, a member with no side on a shared
  pitch, an observer, a replay outside the embed) may fly round in the wide view: drag,
  wheel, two fingers, the arrows, W A S D, + and -, with RESET VIEW to go back. It starts
  as the engine's wide camera, untouched. Its controls, limits and what it cannot do are
  docs/OBSERVER.md. Players never get it.

## Playback

`engine.showAt(t)` each frame with the engine's cameras. The bursts come from the
recording's `timeline.bursts` and are drawn at their anchors as they happen; the king's
burst inverts the screen. Each piece's first touch plays a knock: one of
`public/sounds/knock-1..9.wav`, a random take, never the last one and preferably not one
still sounding, at a rate of 1 +- 0.06, so knocks together overlap as different takes. The
king gets a short chord. Audio unlocks on the first pointer down; mute is remembered.
In the Tournament the other pitches are heard too, quiet and far (`Sound.distant`,
docs/SCENES.md).

After a throw the flag (1 DOWN, MISS, ...) and the verdict chips (power, release,
steadiness and side; only for this browser's throws) show, and the rest distance in
practice. An off-target verdict is the plain word (LONG, SHORT, SLOW, LOW, HIGH, SHAKY,
PULLED LEFT, PULLED RIGHT) in a `.chip.off`: inverted like the flag (ink with paper type),
larger and heavier, and ahead of the on-target chips (POWER ON, ARC ON, STEADY, STRAIGHT),
which keep the plain paper pill (`verdictChips` in `src/game/hud.js`). Tyler's report,
2026-11-16: a long throw's POWER LONG read just like POWER ON under a MISS, and three
throws he took for perfect had been judged long. The verdict never stops an aim (web
0.17.0): it takes no presses, goes at the first aim input (`Game.aimInput`), else 3.5 s
after the throw rests (`tune.flagFor`), and stands under the header upright or in the
header's row on a wide screen, clear of the target, the tray, the minimap and the meter
(`layout.js` `verdictBox`; docs/SYSTEM.md "The verdict").

## Match flow

- **The hand-off** (the 1.0 design): a short card at the foot of the screen, the header
  whole over the dim: the title ("Your turn" for this browser's own turn, else the
  name's: "Lucky Larch’s turn"), one line and one go button (THROW; WATCH for a turn it
  only watches). No turn number (the header says it), no map (the minimap is the map),
  no bases. The settle card before a raise or punishment by hand is the same card, its go
  READY. The line says what the thrower faces, from the session's need, in plain words
  (`handoffLine` in `src/ui/handoff-words.js`, the words in one table, `HANDOFF_LINES`):
  a turn of batons "Six batons. Two field kubbs to clear first." (the field kubbs standing
  in the other half, from the engine's hand-off card), "Six batons. Aim for the base
  kubbs." with none, "Six batons. Go for the king." when every base kubb of the other
  side is down; an inkast "Throw three kubbs into the other half."; a raise by hand "Stand
  your kubbs up."; and, which the design's list did not cover, punishment kubbs "Place one
  punishment kubb.". Counts are words up to ten. The pass card inside a team is as before.
  Someone else's turn on a shared pitch is the same card as a banner at the top, the pitch
  live under it, closing itself.
- **The computer's turn** shows no card: the header, the meter faded with WATCH on the
  computer's colour.
- **Raising by hand**: the kubb lying, its two ends numbered on the pitch. Tap or click
  anywhere on the kubb (its drawn outline plus `tune.margin`, 24 px) and it stands on the
  nearer end; a tap within `tune.labelR` of a number takes that end. A drag that starts on
  the kubb tips it toward the end the finger moves to (`tiltItem`, the same pivot as the
  engine's `tipPose`), and that end's footprint and number light past half way; let go
  there and it stands, short of it nothing is sent. A refused end (`ok === false`) is
  never chosen: a tap or drag toward it lights the allowed end for `tune.hintMs`. END 1
  and END 2 are hidden until focused, for the keyboard and screen readers, and the canvas
  label names the ends while the raise is up. All send the same `raise` choice
  (`src/game/raise-touch.js`, pure; `Game.raisePick`, `Game.raiseDragTo`). AUTO is the
  engine's choice for this kubb. With more than one kubb still
  to raise the panel also has AUTO ALL: the rest of this turn's are stood on the engine's
  choice, one after another, each watched (below). REST OF GAME, on the panel by hand and beside
  BY HAND while AUTO ALL runs, does that for every kubb for the rest of the match (it was
  also MENU's Raising row until the settings restructure: raising is a match option, so
  the part-way choice is on the raise controls, not in the device's settings). While it is
  automatic the panel only says so, with BY HAND to take it back. It is this player's
  choice, never sent or recorded apart from the raises themselves, never for the other
  team, held while a card or the menu is open, and given back to the player if the
  engine refuses a raise. It is not kept on the device: a match that always raises
  itself is the match's own Raising option (the solo card, the lobby), which never asks.
  `src/game/auto-raise.js` (pure, its 0.4 s in `tune`), `Game.autoRaiseTick`.
- **Watching a raise** (web 0.17.0; the owner, 2026-11-22: "When you hit auto to raise
  kubbs you should watch the computer raise them."): every raise that comes as a `raise`
  action with its need, and was not made by hand here, is shown on the raise view, each
  kubb tipped up onto its end with the hand's own tip, one after another, from the need's
  own poses: AUTO, AUTO ALL, REST OF GAME and MENU's Raising (`Game.raise(null, { watch
})`, `Game.raiseAuto`), a `raise` from another browser on a shared pitch
  (`applyRemote`) and a replay's log (`ReplayPlayer.step`). The action is applied and
  sent first, then the clip plays (`Game.showAction`, `startLifts`, `liftFrame`, phase
  `lift`), then the next view is entered: the actions and their order are what they
  were. 0.4 s before the first kubb, half a second a kubb, 4 s at most in all; actions
  arriving meanwhile wait (a shared pitch holds its queue through `lift`) and hurry it;
  a tap or a key skips to the end and stands the rest of the turn's at once; a hidden
  tab shows none; reduced motion stands each kubb without tipping, still one at a time.
  The kubbs the engine raises itself (a match raising automatically, the computer's
  raises, watching) still stand at once: they wait for the engine to hand them out
  (`lift.js` `settledClips`, engine 0.16.0's `setup.settled`). `src/game/lift.js`
  (pure), numbers in docs/SYSTEM.md "Watching a raise".
- **Punishment**: drag or tap the kubb in the defender's half; the stakes and the king carry
  keep-out circles and a refused spot says why (TOO NEAR A STAKE); PLACE IT when allowed.
- **The panel on a phone on its side** (a screen 460 px high or less): the raise and
  punishment panel is a bar across the bottom, 12 px in from the safe area's sides and 8
  px up from its bottom, at most 760 px wide and centred. The kicker sits on its first
  line and the words under it (one line, or two for raising by hand), the buttons in one
  row at the right (AUTO and AUTO ALL; BY HAND and REST OF GAME; PLACE IT), and a refused
  spot's reason beside the kicker, so the bar is 61 px tall, 71 px with two lines. It
  covers grass outside the pitch only: never the kubb being raised or its numbers, never
  the half a punishment kubb goes in (`stillFit` above). END 1 and END 2 join the row
  when the keyboard reaches them. On a shared pitch the bar shows only for the player
  who acts; the others see the status pill and no panel, as before.
- **The raise and punishment panel** keeps two slots in every state (the 1.0 design's one
  rule for it; nothing else about it changed): the automatic choices, plain, at the left
  (AUTO, AUTO ALL, REST OF GAME; BY HAND and REST OF GAME while it raises itself), and the
  one confirming action at the right (PLACE IT, go; raising by hand, END 1 and END 2, out
  of sight until focused). `slots` in `src/ui/cards.js`.
- **The winner** (the 1.0 design): REMATCH as the one go button across the card (back to
  the options; on a shared pitch the host's only, back to the lobby with the same teams;
  WATCH REPLAY leads instead for a browser that arrived after the end), then WATCH REPLAY
  and SCORE SHEET plain side by side, one SHARE, and HOME quiet at the foot. SHARE on a
  match against the computer is the share card (src/ui/share.js), which makes the link and
  the reel; on a finished pitch it opens "Share this match" over the winner card
  (`openShareCard`): the pitch's link with COPY LINK, MAKE A HIGHLIGHT REEL (its words follow
  the reel) and EMBED, BACK quiet. Watching the computer: NEXT MATCH, SCORE SHEET, STOP and
  HOME.
- **The menu** (the 1.0 design), from MENU, a word inside the header's plate: a two by two
  grid of plain buttons, SETTINGS, SCORE SHEET (a match), HOW TO THROW and FEEDBACK (with
  an api address); Raising (By hand, Automatic) in a match that raises by hand, for the
  side this browser plays: Automatic is the raise panel's REST OF GAME, By hand its BY
  HAND (`Game.setRaise`; `Game.matchRaising` says the match's option); View when
  watching, and on the practice pitch that pitch's own Scene and, for Black & White, Surface (the practice
  menu was not drawn: its rows stay under the grid); BACK TO THE MATCH as the one go
  button (BACK TO THE PITCH in practice), RESIGN and HOME quiet, and the release label at
  its foot. SETTINGS opens the device's settings as their own card in the menu's place
  (`settingsCard`), DONE at its bottom right (or Escape) back to the menu; Escape closes
  the menu. RULES left the menu with the design (the rules are on the site). A match's
  options are never in it.
- **Settings** (the owner's settings sheet, 2026-11-20: each setting lives where its
  scope says). Device settings are kept on the device and never asked per match: your
  name (prefs `name`, `src/game/player-name.js`; a generated name, "Names" below), the meter
  (`meter`), its side (`meterSide`) and the sound (`muted`). They are one set of rows,
  `deviceRows` in `src/ui/settings.js`, shown at the top of MENU in every mode and as the
  `/settings/` page, linked as Settings on the web game's page (`prefsDevice` reads and
  writes the same prefs there; the page loads the engine for the name row only). Game settings (Computer level,
  surface, opening, raising, wind, kubb set, scene, and online who can join) live on the
  match options only: the solo card, the practice MENU (surface and scene) and the lobby.
  Turn and throw settings (stand, spin; arc, tilt) live on the throw controls and the
  engine keeps their scope. The solo card and the lobby show your name as one row, You,
  holding the name row (`youRow` in `src/ui/settings.js`): a pick there is the device's
  name everywhere (`Game.setPlayerName`, heard through `Game.onPlayerName`; the pitch
  sends it to the room), and a pick in MENU shows in the card's row. The solo card no
  longer saves a name in `solo`, and its old `solo.name` is dropped unread.
- **One level: the computer's** (the owner, 2026-11-21, with engine 0.13;
  `src/game/throw-level.js`). From engine 0.13 a level is the computer's standard only:
  every person throws on one meter, the bars going by the throw's distance (the engine's
  docs/notes/throw.md "The person's meter"), so nobody is asked for their own level. The
  device's stored level (prefs `level`) is still read and passed as before (practice's
  `level`, a player's `level` in a start, `setLevel` before each of a person's throws,
  `me.level` on a pitch), never reset: it changes nothing on 0.13 (the 0.9 engine where it
  counted is no longer carried). A device that never chose one throws at Club. The
  computer's level is a match option, Computer level (Kid, Beginner, Club, Pro; Kid since
  engine 0.15, which makes the match a Kid match, below): the solo
  card's row (prefs `solo.computer`, passed as `computer` and on the computer's player),
  and on a pitch the host's row (engine 0.9 on). A device's older choices move across
  once: the device level is the `level` pref, else the solo card's old Level, else Club;
  the solo card's old Level becomes its Computer level.
- **The scene, first** (docs/SCENES.md; engine 0.14). The engine owns the scenes and
  decides each one's surface and set: Park (`day`), Beach (`beach`), Camping (`night`),
  Techno (`neon`, the `grid` floor), Minnesota (`minnesota`, snow and the Minnesota set),
  Tournament (`tournament`, the USA set) and Black & White (`bw`, grass, sand or snow).
  Every options card is scene first and builds its rows from `pitch.optionRows({ scene
})` (`optionRows` in `src/net/lobby.js`): the Scene as picture tiles with the engine's
  names (`src/ui/scene-tiles.js`), a Surface row only where the rows carry one, no Kubbs
  row, then Computer level, Opening, Raising and Wind (`ROW_ORDER` in `src/ui/cards.js`:
  the engine's rows, the design's order). Picking a scene takes its rows and defaults
  (`throughScene`). The solo card (prefs `solo`, watching the computer takes it), the
  lobby (the host's tiles; a guest reads the name) and MENU on the practice pitch (prefs
  `practiceScene`; a change starts the practice again in it) all use it. Every
  `newMatch`, `newPractice` and `setOptions` names the scene, and the page draws what the
  view says (`scene`, `surface`, `set`); kept options go through the scene and may come
  back changed (`soloSaved`). The pitch behind the card or lobby is started again in the
  pick (`Game.showScene`); a match draws its view's `scene` through the `Stage`. `?scene=`
  sets it off a pitch. An id the page does not draw is Park.
- **Kid matches** (engine 0.15, the engine's docs/notes/kid-mode.md). Kid on the Computer
  row makes the match a Kid match (the engine does the rest: three base kubbs a side, the
  Kid line, the king stood back up, no punishment kubbs, a helicopter counts, the wide
  meter). The page draws the Kid line from `aim.kidY` and `minimap.kidY` (dots across the
  pitch and an orange cone at each end, `drawKidCones` in `src/render/world.js`; on the
  minimap the same dots and cones), the hand-off says "Kid match · throw from the cones"
  (the king shot: "Kid match · the king from your line"; `handoffKid`), STAND's caption
  speaks of the Kid line, and the flag after a throw follows the ruling's codes
  (`flagFor` in `src/game/rulings.js`): KING BACK UP (`kingUp`), OUT TWICE: PLACED
  (`placed`), and a counted helicopter shows what it knocked down (`helicopterCounts`).
  Nothing tells a child they got a punishment or lost when they did not. A kept
  `computer: "kid"` stays Kid (`soloOptions`).
- **Ground impacts and the spin** (engine 0.14; `src/render/impacts.js`). The game asks
  the engine for ground impacts once per engine (`Engine.setImpacts`): Techno rings at
  each `timeline.impacts` entry when playback reaches its `t` (still, fading, with reduced
  motion; none nearer the camera than 2.2 m), Beach puffs sand and Minnesota sprays snow.
  A piece turning faster than the frames can show (a kubb's twist past 30 degrees a frame,
  fully past 50; end over end twice that) is drawn with four solid in-between poses under
  its own, faded (`spinAmount`, `Stage.observe`; world.js `drawSpin`): at full SPIN a
  kubb turns about 56 to 66 degrees a frame and a square section looks the same every
  quarter turn, so it seemed to stand or turn back. Slow motion turns less a frame and is
  drawn plain.
- **The header** (the 1.0 design; `hud.js`, `headerLine`, `headerName`): one plate at the
  top left. Over the name, in the label's capitals, "Turn 4 · baton 2 of 6" ("kubb 1 of 3"
  throwing kubbs in), with what the thrower aims at when it is not the base kubbs ("· 2
  field kubbs", "· at the king"); practice: "Batons · 5 base kubbs", "Kubbs · target 2.3
  m". The name in sentence case (the engine's rail says it in capitals; the header takes
  the team's and the thrower's names from the need). Then the kubbs standing in each half
  as two numbers on the team colours, A marigold and B violet (the need's `standing`,
  field and base kubbs together: the engine gives no base-only count), with the spoken
  label "Kubbs standing: Mighty Maple 5, Computer 5", and MENU as a word inside the plate
  (`hud.menuSlot`). Under a card that dims the pitch it is not shown (the hand-off's short
  card excepted: there it stands whole over the dim). Its width is fixed for the layout
  (`layout.js` `headerBox`, `--rail-w`): a tall screen's safe width, a wide one's 40%
  (260 to 400 px); the minimap hangs under its right end, and the page's measured height
  (`--rail-h`, `railH`) moves both. Nothing of the aim's controls (the tray, SKIP, the
  coach, the caption, the meter) shows round a card that dims the pitch. The counts in words (`railCount`) are the engine's Playdate "BASE 5" made
  plain. Practice's tray is a joined pair, BATONS | KUBBS, the one in use pressed, then
  RESET, at the top right.

## The 1.0 system

The Throwing Wood 1.0 design (the owner's review of 2026-11-21) on the game's own
screens; docs/SYSTEM.md has its numbers and words in one place for the iPhone, which
matches them.

- **Tokens** (`public/style.css` and `public/game.css`; the canvas's `INK` in
  `src/render/palette.js`): ink `#16130f` (the canvas's `#17140f` went), paper, baton,
  wood for title bands only, muted for helper text, marigold the one go colour; a 3 px
  ink line, radius 6 on controls and 8 on cards, shadow 3 on controls and 5 on cards;
  chips 2 px with no shadow. A scene's skin keeps its own go colour (`--accent`) at 7:1.
- **Type**: Londrina Solid Black for titles (sentence case), buttons, prompts and flags
  (capitals), never a body sentence; Inter for the rest; row labels Inter bold 14
  capitals at 0.06em; nothing under 14 px in `#ui`.
- **Three buttons** (`button(label, fn, kind)` in `src/ui/dom.js`): go (`"go"`,
  marigold, last in its row), plain (`""`, paper) and quiet (`"quiet"`, underlined
  display capitals with the full 44 px target) for leaving: HOME, RESIGN, NOT NOW, JUST
  WATCH, WATCH INSTEAD, CLOSE.
- **The segmented bar** (`segBar` in `src/ui/seg.js`): every two to four way choice, one
  joined bar, the chosen part ink with paper type, the others white; a radio group that
  is one Tab stop, the arrow keys (and Home, End) moving the choice inside it; its focus
  ring round the whole bar and the part ringed inside.
- **Focus and touch**: a 3 px ink ring 2 px off every control; Escape closes an open card
  (the menu, Settings back to the menu, the share, sheet, reel, embed and report cards, the
  how-to), and an open plate of the tray; every control 44 px tall, 48 on a touchscreen,
  the steppers and quiet links included, the tray's plates 86 by 60 at their smallest.
- **The play screens** (stage 3; docs/SYSTEM.md "Play screens"): the tray ("The tray"
  under "The throw"), the minimap under the header's right end with Team A's kubbs
  circles and Team B's squares, the meter's striped and solid marks and the distance tab,
  the verdict (the off word first, inverted, 18 px, with an arrow: down for SHORT and
  LOW, up for LONG and HIGH, left and right for PULLED, a wavy line for SHAKY, a clock
  hand for SLOW; the on-target words small after it; said once to a screen reader, the
  off word first), SKIP a plain button of normal size, the hand-off and the computer's
  turn ("Match flow"), and the coach as one ink chip. Stand-ins over the canvas
  (`hud.js` `proxies`) give the keyboard and a screen reader the design's order: the
  header, the prompt and distance, the meter, the tray, the minimap as one image with a
  spoken summary.

## Names

No name is typed anywhere on the web (the owner, 2026-11-21; the engine's docs/NAMES.md,
section 10). Every player and team name is a generated one, made from the engine's word
lists through its `names.*` calls (the engine's docs/SESSION.md "Names"). A name is kept
and sent as its text.

- **The device's name** (`loadName` in `src/game/player-name.js`, prefs `name`). The
  first run rolls one: `names.roll` with a seed from the browser's own randomness
  (`crypto.getRandomValues`, `randomSeed` in `src/game/names.js`), kept at once. On every
  load the kept text is checked with `names.valid`: one that is not a generated player
  name (`ok`; a default such as "Player 1" is not one) is replaced by a rolled name and
  never shown. A once-generated name that lost a word for safety keeps the word still in
  its list (`names.roll` with both words as locks). `saveName` keeps only a generated
  name. The solo card's old `solo.name` is dropped unread.
- **The name row** (`nameRow` in `src/ui/name-row.js`; the 1.0 design: "KEEP goes from
  the name row; the row is the name and SHUFFLE, word steppers only in Settings"), built
  once and used in Settings (MENU's SETTINGS, `/settings/`), the solo card, the lobby's
  "You are", the lobby's team names (the host's), the welcome card's "You will be" and
  the share card. One line: the name as it reads (the display face at 24 px) and
  SHUFFLE, which is `names.roll` with nothing kept (a whole new name; a team's may
  change its shape, `adj`, `wood`, `the`). In Settings only (`steppers`), under it one
  stepper per word, a line each: previous, the word, next (`names.step`, the Playdate's
  crank as a control; stepping one word keeps the others). There is no picker and no
  KEEP. A team's "The" is text, not a slot. The row is a labelled group (`role="group"`,
  `aria-label` "Your name"); each stepper a group "First word" with "Previous first
  word" and "Next first word"; a change is announced through an `aria-live` line ("Your
  name: Mighty Maple"); focus stays on the control that changed. Every control is a
  native button, so the keyboard and a screen reader reach each, in order: SHUFFLE, then
  each word's previous and next. `data-test`: `<key>`, `<key>-text`, `<key>-shuffle`,
  `<key>-prev-<slot>`, `<key>-word-<slot>`, `<key>-next-<slot>` (keys `settings-name`,
  `solo-name`, `lobby-name`, `welcome-name`, `team-A-name`, `share-name`).
- **Fit.** The longest name in characters is not the widest, so every name from
  `names.all` (4,133 player and 6,530 team names in 0.13.3) is measured in the game's own
  fonts by `tests/game/names-fit-client.test.mjs`: the row's text (Londrina Solid 24 px)
  within `NAME_FIT.text` (200 px; the widest is "Sumac Lawnmowers", 189 px), which
  `.name-text` keeps as its least width; each word in a stepper (700 15px Inter, the
  widest "Lawnmowers", 98 px) within `NAME_FIT.word` (120 px) with its padding; the
  lobby's team title; and the header, whose name breaks between words, so each word must
  fit the narrowest header's name beside the two numbers and MENU (a phone held upright:
  104 px; the widest, "Lawnmowers", is 102 px in Londrina Solid at 20 px). The row spans the card's width under its label, so it has
  that room on a 390 px phone.
- **A team of several** plays under a team name the host picks in the lobby. When a side
  first has two players the host rolls one (`Pitch.rollTeamNames`) and writes it into
  the document's own top-level `teamNames` (`setTeamName` in `src/net/lobby.js`: the
  engine's reducers keep a key they do not know; it has no reducer for it yet). The host
  sees a name row under the side's heading ("Plays as"); everyone else sees the name.
  START puts it on the side (`opts.teams[side].name`, rolled then if missing). A side of
  one plays under its player's name (the engine's `matchOptions`).
- **Two members with one name** are told apart in the lobby only: the second shows
  "Mighty Maple II", the third "III" (`apartNames`, by the order the pitch lists members).
  Never by changing a name: the wire, the device and the match keep the name as it is.
- **The display check** (a client is not proof: docs/MULTIPLAYER.md "Names"). The web
  reads no snapshot's fields to judge names: the engine does (`names.check` and its
  strict doors, since 0.13.4; the engine's docs/SESSION.md "Names"). A name not passed
  is shown as the default for its place: "Player n" for a member (n their place on their
  side, as the engine's lineup numbers a player with no name; a watcher, their place on
  the pitch), "Team A" / "Team B" for a team.
  - **The lobby** (`Pitch.docNames`): `names.check({ document, members })` on every new
    document or members list; the members' names (`nameOf`, `lobbyNameOf`, the status
    pill, shouts, the watching card), the document's `teamNames` (`teamNameOf`) and the
    match header's players (`headerName`, the winner card's "who played") are shown
    only at the places it passes.
  - **A pitch's snapshot** (entering, joining part way, every resync, the sealed page,
    back from a replay): `Pitch.enterMatch` asks `names.check({ snap })` first, and
    every adopt goes through `Pitch.adoptSnap`, which is `Game.adopt` over
    `Engine.restoreChecked` (`restore` with `{ snap, names: "check" }`): a refusal
    (`NamesRefused`) changes nothing and the page shows "Cannot show this match" with
    "This match has a name the game did not make, so it cannot be shown." and HOME. The
    score sheet of a finished pitch match restores through the same door.
  - **A kept replay** (watch, the sealed page, the embed): `replayProblem` asks
    `names.check({ replay })` with the whole kept replay, and `Engine.replayLoad` always
    passes `names: "check"`, so a replay that skipped it is refused too.
  - The engine's refusals carry `from` (the raw path, which a forged snapshot can fill
    with its own text) and `place`; neither is shown to a player.
  - `names.valid` stays the check for a single name: the name row, the share card's
    starting name (`nameFromMatch`), the host's own lineup before START
    (`checkedLineup`). This browser's own snapshots (none kept on the web) would use the
    plain `restore`. Stored documents and replays are never rewritten.
- Watching the computer keeps its North and South: that match never leaves the device
  but as a private record.

## Replays

A finished match on a shared pitch can be watched again (Jamie, 2026-11-16: "When a game
is finished playing on a pitch I'd like the URL to allow people to come and watch a
replay of the match."). A replay is not a video: the match is set out again from its
`newMatch` options and every committed action goes through the engine in order
(the engine's `session/replay.lua`), the same throws with the same physics, on the match's
own engine (`match.engine`, carried in the replay). One made on an engine the site no
longer carries is not played: "This match was made on an older version of the game and
can no longer be replayed." (`docs/ENGINES.md` "Looking back at a match"). What the pitch keeps is `docs/MULTIPLAYER.md` "The document"; the api keeps
the finished match's replay (`backend/api/API.md`, `GET /api/replay?pitch=<code>`), and
the page that played it builds one from the actions it holds without asking.

- **The engine.** `engine.replayLoad(data)` sets the replay out from its `setup` (the `newMatch` options),
  or from `start`, the match's first snapshot, for one kept after it was played, in a session that belongs
  to nobody: no side and not the computer. While it is loaded `apply` and `setControl`
  are refused ("a replay is read only") and frames run the aim but never throw.
  `replayStep()` takes the next logged action (`{ ok, recording, need, action, replay }`),
  `replayBack()` goes to the start of the previous turn (the start of the match from the
  first), `replayRewind()` to the start, `replayInfo()` is
  `{ i, total, turn, thrown, throws, differs, done, held }` (`held`: the computer's swing
  has reached its release and waits for the log), `replayEnd()` lets go of it. Each
  action's hash is compared with the one the players' browsers committed; one that
  disagrees (an old match after a physics change) or an action this engine refuses marks
  the replay `differs` and it plays on, a refused action passed over.
- **The player.** `new ReplayPlayer({ game, root, data, home, close, menu, onEnd })`
  drives a `Game` it is handed and puts its own bar in `root`; `startReplay({ code, url,
data, ... })` fetches a replay by its pitch code and plays it. It needs nothing of the
  pitch page's lobby, pitch session or menu (`menu` is optional, for its View item), so an
  embed can mount it on a page of its own. It takes over the Game's seat (one that may
  never act), its cards (`game.noCards`), its view and its loop (`game.driver`, called
  every tick, and `game.timeScale`), and gives every one back on `destroy()`. Given
  `engine` (the match's own, from the page's registry: `startReplay` takes `engines`,
  the pitch and the embed look it up), the Game draws from that engine while the replay
  plays (`game.useEngine`) and from its own again after.
- **The pace.** The match's own, without the zen pauses: 1.2 s after a throw lands before
  the next, 0.8 s after a raise or a punishment kubb, and the computer's swing plays out to
  its release (at most 6 s) before its logged throw goes. 1X, 2X and 4X scale all of it
  (`replayTune` in `src/replay/player.js`).
- **The bar.** THE REPLAY with "TURN 4 · THROW 2 OF 37", BACK (the start of the previous
  turn), PLAY / PAUSE, NEXT THROW (when paused, plays exactly one throw and holds), 1X 2X
  4X, the view (WIDE VIEW by default, THROWER'S VIEW; V and MENU's View too, remembered as
  `watchView`), SHEET, and BACK TO THE PITCH where there is a pitch to go back to. Space
  plays and pauses. The score sheet stands beside the pitch from 900 px wide and opens
  over it below that; on a phone the bar spans the width. The status pill names who acts
  (COMPUTER THROWS, HANNA THROWS, TEAM B RAISES); the shout bar and advice are hidden.
- **The end.** The winner card with REPLAY AGAIN (the lead), SCORE SHEET, BACK TO THE
  PITCH and HOME. A replay that differs, or that did not end on the result, shows the
  match's own last snapshot instead, with "This replay may differ from the match as
  played."

## The embed

`/e/<code>` (`src/site/pages.mjs` `embed`, mode `embed`; `bootEmbed` in `src/main.js`,
`startEmbed` in `src/embed/embed.js`). The pitch pages function writes the pitch's state
into the page as `<script type="application/json" id="kubb-pitch">`
(`{ code, state, teams, turn, final }`); without it the embed asks the api for a
kept replay (`GET /api/replay`) and shows "No match here" when there is none.

- **A kept replay** is a `ReplayPlayer` with `embedded: true` on a `Game` with no sound
  and no menu: the wide view (not remembered), no score sheet beside it (SHEET opens it),
  no BACK TO THE PITCH or HOME, REPLAY AGAIN at the end. It starts held. An
  `IntersectionObserver` on the page holds it below half in view (`embedTune.visible`)
  and lets go above; `hold()` never undoes a pause the viewer chose.
- **Cards.** In play: "Match in progress" with WATCH ON KUBB.THINGELSTAD.XYZ. Waiting:
  "Waiting for players", in a rematch's lobby too, though the last match is kept.
  Finished with nothing kept, or with only an earlier match kept (the state block's
  `match`, `{ n, hash }`, is checked against the replay): the final score. Unknown: "No match here". Each links to
  `/p/<code>` in a new tab; none loads the engine.
- **Attribution.** "Kubb: Throwing Wood ↗" in the corner, to `/p/<code>`, `target=_blank`
  `rel=noopener`.
- The page fills its frame, at least 300×188.
- **The snippet.** EMBED on the winner card and the replay bar opens it with COPY
  (`src/ui/embed.js`, `embedSnippet(code)`).

## Highlight reels

A finished pitch's highlight reel, made on the server (docs/REEL.md, docs/ROOMS.md
section 12). The card is `Reel` in `src/ui/reel.js`; what it shows and asks is a pure
reducer in `src/net/reel.js` (`reelStart`, `reelStep`, `reelView`), so every answer is
tested without a browser.

- **Where.** MAKE A HIGHLIGHT REEL beside EMBED on the winner card of a shared pitch
  and on the replay bar and the replay's end card, only when the match has a replay
  (`Pitch.reelFor`). Not on the embed, not when watching the computer, not in practice.
  A match against the computer has the same button, which shares it first ("Sharing a
  match" below); the card takes nothing but a pitch code, so a shared match's is this
  one. One `Reel` a finished match, so the winner card and the replay say the same.
- **The button follows the reel.** MAKE A HIGHLIGHT REEL, MAKING YOUR REEL while it is
  asked for or renders, WATCH THE REEL once it is done. Pressing it opens the card.
- **Asking is starting.** The first `reel` request for a kept replay starts its render,
  so the page never sends one before the button is pressed. First the card reads the
  api's kept replay (`askKept`, `GET /api/replay`, which starts nothing) and checks it
  is the match on the screen (`n` and `hash`): a just-ended match's pushes may still be
  on their way to the api, so it looks again up to `reelTune.keptTries` times, 2.5 s apart, and a
  newer match kept since means this one's reel can no longer be asked for. It reads it
  afresh on every press and every TRY AGAIN (`reelRequest`), never from a replay already
  in hand: a viewer can sit in an old replay while a rematch is kept, and asking then
  would start the newer match's render. Then `askReel`, which names that version (`v`)
  on every request (the first ask, each poll, a card opened again, TRY AGAIN): a pitch
  that keeps another answers `why: "moved"` and starts nothing (API.md `reel`). The
  answer's `v` is still checked against the kept one.
- **Making.** The card's title is "Highlight reel" in every state (the words are the
  table in docs/REEL.md "What a player sees", `REEL_WORDS`). While it renders, the state
  line MAKING YOUR REEL, a slow bar that never claims how far, and "About a
  minute. You can keep watching." The card closes with BACK, Escape or a press outside
  it. It asks again every 5 s (`reelTune.pollMs`) while it is open and the page is shown,
  and stops when either is not; opened again, or the page shown again, it asks at once.
  Each request is one HTTPS call (`POST /api/reel`, `src/net/api.js`); asking how a
  reel stands is free on the server. A lost poll while it renders adds "No connection."
  and the next one is tried.
- **Done.** The video muted, looping, `playsinline`: the tall file when the window is
  taller than wide, else the wide, swapped on a resize. DOWNLOAD TALL and DOWNLOAD WIDE
  are links with `download` (`throwing-wood-<code>-tall.mp4`, `-wide.mp4`); SHARE where
  `navigator.canShare({ files })` takes a video hands over the tall file (fetched when
  the card opens, so the share sheet opens on the press); COPY LINK copies
  `https://throwingwood.com/p/<code>`.
- **On load.** The pages function writes `og:video` (the wide file) into `/p/<code>`
  when the reel is done beside this match's kept replay (`backend/pages/pitch.mjs`).
  `reelFromPage` reads it, and only for the match the browser found finished on
  arriving: the page was written for that one. WATCH THE REEL then reads the kept
  replay and shows the video when its version is the tag's; a page older than the
  pitch's newest match asks the server as MAKE does. The page is cached up to 5 minutes
  at the edge, and the static fallback has no tag, so a reel done since shows MAKE A
  HIGHLIGHT REEL, whose press finds it done without rendering again.
- **When there is none.** `engine`: "This match was played on another version of the
  game, so it cannot have a reel." `empty`: "There are no highlights to show in this
  match." `busy`: "Reels are busy today." `unavailable`, and any why this build does not
  know: "Reels cannot be made right now." `replay` (or no kept replay after the looks):
  "This match has no replay, so it cannot have a reel." `too-many`: "Too many reels
  asked for at once. Try again later." A newer match kept, or `moved` from the server: "This pitch has moved on to
  a newer match." None offers TRY AGAIN: asking again cannot change them.
- **Failing.** A reel the server marked `failed` was tried twice there already and is
  final for that version: "The reel could not be made. Not this time.", no TRY AGAIN.
  When the server could not read, write or start it (the error `failed`), the item is
  taken back, so asking again really starts again: "The reel could not be made." with
  TRY AGAIN, once; a second such failure is "Not this time". No connection: "No
  connection." with TRY AGAIN, as often as pressed (nothing was started).

## Sharing a match

A match against the computer has no pitch, so its reel needs the match shared first:
sent once, checked by the server playing it again, and kept as a sealed pitch under a
new code (docs/REEL.md "Sharing a match against the computer", docs/ROOMS.md section
13). The button and card are `Share` in `src/ui/share.js`; the name rules, the message
and the card's states are a pure reducer in `src/net/share.js` (`shareStart`,
`shareStep`, `shareView`), tested in `tests/net/share-client.test.mjs`.

- **Where.** SHARE on the winner card of a solo match (MAKE A HIGHLIGHT REEL until the 1.0 design) (`startSolo` in
  `src/main.js`), when the page has an api address and the match is one of side A
  against the computer on B with its whole trail (`shareable`). Not when watching the
  computer against itself (docs/REEL.md "What a player sees": nobody played), not in
  practice. A rematch starts a new `Share`; the old match's is dropped with its card.
- **The share card** (words: docs/REEL.md "The share card", `SHARE_WORDS`). What sharing
  does, the name row ("Names"), what the other side is called, and that the score sheet shows
  the day and time the match was played (the start carries it, to the minute, and it is
  kept: docs/REEL.md open question 14). Then SHARE AND MAKE THE REEL and NOT NOW. Nothing
  is sent before SHARE. NOT NOW (BACK once sent), Escape and a press outside close it.
- **The name.** The name row starts with the name the match was played under (the
  device's generated name; when that is not a generated name, the device's name now:
  `nameFromMatch`). It offers only generated names, which is what the server's check takes
  (`nameProblem`, as `nameAllowed` in `backend/reels/check.mjs`: a generated player name or
  a default), so SHARE is never faded for the name; should the server refuse one (a page
  that sends its own), the line is "Pick a name for your side."
- **The message.** One `share` message: `client: "web"` (checked by the server, never
  stored), `engine` (the engine's version), `start` and `log` as the engine's
  `renameStart` gives them with side A renamed to the name picked (team and player), and `end` (`winner` from
  the `over` need, `throws` the log's throws). No hashes, member id or clock of the
  browser's. It goes as one HTTPS call (`POST /api/share`, `askShare`), and waits up to 45 s for the answer: the server plays the match first.
- **Too long, known here.** Past the server's ceilings (256 KB, 1000 actions, a 16 KB
  start), or plainly past the engine's log budget as the finished document would hold it
  (each action with its hash, and the last snapshot, against `LOG_BUDGET`), the card says
  "This match is too long to share." without sending. Short of that the server decides.
- **Answers.** `shared` with a code: the share card closes and the reel card opens for
  that code (`Reel` with `link`: the link `https://throwingwood.com/p/<code>` and COPY
  LINK in every state), and it asks for the reel at once, as a press would: SHARE AND
  MAKE THE REEL was the request. Closed while checking, the reel is asked for all the
  same and the button shows how it goes. From then on the button opens the reel card; the
  card is not shown again. A share is idempotent on the server (the same start and log
  are answered the same code, free), so TRY AGAIN after a lost answer gives one link.
- **Refusals** (`code: null` with a why): `engine`, `name`, `does-not-replay`, `too-long`,
  `busy` and `unavailable` each have a line, and an error `too-many` too; `too-big` reads as
  too long and `bad-message` as does-not-replay. None offers TRY AGAIN. Opened again,
  `name`, `busy`, `unavailable` and `too-many` start over at the name; the others stay. The error
  `failed`: "This match could not be shared." with TRY AGAIN once, then "Not this time".
  No connection: "No connection." with TRY AGAIN as often as pressed.
- **A sealed pitch.** `/p/<code>` of a shared match: the join is refused `sealed`, and
  `Pitch.showSealed` reads the kept replay (`fetchReplay`) and shows the finished match
  as a browser arriving after a pitch's end sees it: the result, who played, WATCH
  REPLAY, EMBED, MAKE A HIGHLIGHT REEL and SCORE SHEET, no lobby, seats or rematch. BACK
  TO THE PITCH from the replay puts the finished match back. The room never moves on,
  so its reel is this match's. `/e/<code>` needs nothing new: the embed reads only the
  replay. An observer's link (`?observe=1`) to a code with no live pitch gets the same
  view for any kept match (`Pitch.nothingToWatch`), with JOIN THIS PITCH when the match
  is not sealed (docs/OBSERVER.md).

## Score sheet

MENU, SCORE SHEET during a match (solo, watch or a shared pitch; not practice), or SCORE
SHEET on the winner card, opens a card titled "Score sheet": "The match so far." or "The
whole match.", a link "How to read it" to the Planet Kubb Notation page
(thingelstad.xyz/things/planet-kubb-score/, `?ref=kubb-sheet`), the game file the
engine writes (`engine.sheet()`, `Session:sheet()` in the engine's session/session.lua: the core's
score sheet as it stands), SHOW POSITIONS / HIDE POSITIONS, COPY, DOWNLOAD and BACK.

- Positions are hidden by default; the toggle shows them. From engine 0.13.1 the file is
  Planet Kubb Notation 2 (`[Notation "2"]` first) and its positions are lines of their
  own under a turn: `@a` or `@b` with where the pitch's kubbs stood in the half under
  attack, and `*a` or `*b` with where each baton's felled kubbs were (`-` for a baton
  that felled none), in the notation's frame in metres. A match on an older engine
  writes them as `(@ ...)` comments on the turn line. The engine's `shown` leaves either
  out. COPY and DOWNLOAD always take the whole file, positions included: COPY says
  "Copied the game file." (or "Could not copy. The file is selected to copy."), DOWNLOAD
  saves the game file under its notation file name (a `.txt`) and says "Saved <file name>.".
- The text is monospaced and wraps, in a box that scrolls on its own, so it reads at
  phone width without sideways scrolling.
- Modal like the report card; Escape, BACK or a tap outside closes it. The game goes on
  underneath (watching the computer keeps playing).
- The file's header says `[Location "throwingwood.com"]` (`LOCATION` in
  `src/net/sync.js`, passed to the engine's `setClient` at the start), as the iPhone
  app's does; the Playdate game keeps the engine's own "Playdate". It is in no
  snapshot or hash.

## Recording

Every solo and watch match is recorded when it ends (a winner or a resignation), the way
a shared pitch's versions are (docs/ROOMS.md section 7): `recordMatch` in
`src/net/record.js` sends one `game` message with the mode, the build, the options, the
match's first snapshot, every action and the engine's hash after each, how it ended and
the game file. Once a match (`game.trail.recorded`), including from a hidden tab while
watching; a failure is a console warning and nothing else. No user agent, address or
member id. Practice is not recorded. It goes as `POST /api/game`. A build without an api address records nothing.

## Reports

MENU, FEEDBACK (SEND FEEDBACK until the 1.0 design; shown in every mode whenever the build has an api address) closes
the menu and opens the "Send feedback" card. It starts with a choice, two real radio
inputs drawn as the site's segmented buttons in a fieldset with a hidden legend (arrow
keys move between them): "A throw looked wrong" and "Something else". The first is chosen
when this game has a last throw to report (`state.lastThrow`), otherwise the second.

- **A throw looked wrong**: "What happened?" and "What should have happened?" (1000
  characters each; SEND with both blank asks for one), the pieces to mark, and the
  sentence "This sends what you typed with this game as it stands (its options, names and
  throws), so the throw can be played again and tested. It is kept privately and not
  published." Sent as `kind: "throw"` with `happened`, `should` and `selectedPieces`.
- **Something else**: "What would you like to tell us?" with "A problem, an idea,
  something you liked or did not. Anything." under it, one box of 2000 characters (SEND
  with it blank asks for it), and the same sentence without "so the throw can be played
  again and tested". Sent as `kind: "feedback"` with `text` (trimmed) and neither answer;
  the game context goes with it just the same.

What was typed in the other kind stays in its box while the player switches, but only the
chosen kind is sent. SEND and CANCEL (Escape cancels). SEND shows "Sending...", then
"Sent, thank you." with BACK TO THE PITCH, or "The report was not sent." ("Your feedback
was not sent." for the other kind) with the reason, and what was typed stays to send
again. There is no contact field and no reply.

The throw report can mark several pieces on an overhead pitch or by name. The picker uses the last throw’s rest poses, including the baton after a handoff. The report keeps the marked IDs and poses even when the full piece list is dropped to fit.
For a long practice session, a trimmed throw report keeps an opaque checkpoint
of the pitch before the reported throw. The report reader restores it and applies
the last throw, including collisions with previously thrown wood.

- **The game while it is open**: modal, as under the menu. Nothing typed or pressed
  reaches the pitch, and a throw this browser is aiming waits (the dial and the circle
  hold). A throw already playing back finishes, the computer's turn goes on, a shared
  pitch carries on with everyone else, and watching the computer keeps playing, its next
  match included.
- **What is sent** is read when the card opens, so a throw that plays on underneath does
  not replace the one reported. `game.trail` (src/game/game.js) is kept for it: a match's
  snapshot at its start (or at its last adopt) and every action applied in this browser
  since, with the snapshots before and after the last one; practice's options and every
  throw, RESET, BATONS/KUBBS (`drill`) and surface change since the pitch was set out. With them go the
  mode, the build (`config.version`, `commit`, the hashed Lua bundle's name, and
  the vendored engine's version, also at the top as `engine`), the viewport, the browser's clock, the turn
  and phase, the last throw's action and result, the pieces where they stand, and on a
  shared pitch the room code, `v` and the match's `n` and `seq`. Never the user agent or
  a member id: a match's players carry their member id as `key`, so `captureReport`
  swaps every member id for `member1`, `member2`, ... throughout (the snapshot strings
  too, the same way everywhere, so it still replays). It copies the history when the
  card opens, so what is played while it is open is not in the report. `reportMessage` holds it to 64 KB, dropping the history, then the
  pieces, then the snapshot after (listed in `r.dropped`); never what was typed.
- `tests/net/reports.test.mjs` covers both kinds' payloads, the server's checks and the
  replay; `client.test.mjs` sends a throw report from a solo match, practice and
  watching, and feedback from practice, against the api in `tools/pitch-dev.mjs`.

## Swing feel

Measured with `swingInPage` (`tests/game/browser.mjs`: one pointer event each animation
frame, as a browser delivers a real drag), back to the middle of the power band at 450 deg/s,
on the Club level, practice plan (power band 112..128 degrees back, release at 90):

| Swing                                           | Result                               |
| ----------------------------------------------- | ------------------------------------ |
| Even flick at 700, 900, 1000 deg/s              | SLOW (a MISS)                        |
| Even flick at 1050 to 1150 deg/s and up         | ON, STEADY                           |
| Slowing into the release (sine), from 1150      | ON                                   |
| Speeding up into the release, from 1150 to 1250 | ON                                   |
| 2800 deg/s                                      | ON (speed is capped, never too fast) |
| +-3 degrees of jitter each frame                | STEADY                               |
| Release 15 degrees early or late                | RELEASE ON                           |
| Release 30 degrees early / late                 | LOW / HIGH                           |
| Held still at the release for up to 0.7 s       | registers at the stop, ON            |
| Wound 20 degrees short of / past the band       | SHORT / LONG                         |
| Back down to six slowly (150 deg/s)             | nothing thrown                       |

The back and stop angles register exactly. At the core's `fullFlickDps` of 1500 a natural
flick of about 1000 deg/s read SLOW, so the engine's `pointer` tune (`tune/pointer.lua`) sets it to 1200 for the web.

The Playwright mouse and CDP touch need two animation frames a step (a round trip each),
so `client.test.mjs` doubles the flick speed to make up for the 30 Hz stepping.

### Trying the touch pendulum

Open `/practice/?throw=swipe` on a phone. The switch lasts for this tab. Start
on the wooden knob or in the lower half, pull down to wind, then flick up and lift.
In the trial the dial sits higher on touchscreens so the full downstroke fits below
its knob, and its face takes the press ahead of scenery behind it. The dial shows the
arm and its power and release bands. Return slowly to let down. The target
and STAND keep their drag controls. A mouse or trackpad always uses the
dial. The browser sends raw pointer positions in short-edge units and monotonic
seconds (including coalesced samples) to the engine. Its `session/touch.lua`
resamples at 120 Hz and maps them to the crank. Old and new human throws are
played through the same action path.

## Version and freshness

Two versions: the web game's own (`version` in `package.json`, 0.2.0) and the version of
each kubb-engine it vendors (`vendor/engine/engine.json`, and `vendor/engines/<mm>/` for
the older ones it still plays; read in Lua as `engineVersion`).
The game file's "Scored by" is "Throwing Wood web <web version>" (`setClient`); records,
reports and the `with` rider carry the engine's version as `engine` / `e`.
Room joins also announce `me.engine` (the room's engine, marked `+engines`) and
`me.engines` (all the page carries), START checks the members and writes `match.engine`
on the room's engine, and `room.mayPlay` gates team and CPU control of a running match
(`docs/ENGINES.md` "Playing together").
The temporary lenient policy and version refusal cards are in docs/MULTIPLAYER.md "Engines".

- **The label** (`src/site/release.js`): every app shows its own version with the Kubb
  Engine's beside it, `<app version> (<engine version>)` (Jamie, 2026-11-20). On the web
  that is `package.json`'s version and the full version of the newest engine the page
  carries: `0.17.1 (0.15.1)`. Nothing but that engine's version is in the parentheses: an
  older engine the page still plays would be only in the detail, `Also plays ...` (none
  today: the site carries the newest alone, `docs/ENGINES.md`), and the
  web commit never shows. The release is `{ version, web, engine, also, text, detail }`
  (`text` the label, `detail` the older engines or null). The build (`tools/build.mjs`
  `releaseOf`) reads the version from `package.json`, the web commit from `GITHUB_SHA` in
  CI or `git rev-parse HEAD`, and the engines from the vendored set; it puts the release
  in the game pages' config (`config.release`) and writes it as `/version.json`.
- **Shown** small, in the shared type tokens: "Version 0.17.1 (0.15.1)" at the foot of
  every reading page (beside the link to the engine page), and the label at the foot of
  MENU in the game, with "Also plays ..." under it only while an older engine is carried.
- **Exact identity** is the web commit: freshness (below) compares it, and a feedback
  report carries the label (`build.label`) beside `build.version`, `build.commit` and the
  Lua bundle it played on.
- **Never on the wire or in a match.** The pitch's `me`, an action's `c: "web"`, the
  lobby document, `meta`, a kept replay, an embed, a share and a reel name only the engine a match
  was played on, never the app's version, so a web player and an iPhone player look the
  same there.
- **Freshness** (`src/net/freshness.js`): the client fetches `/version.json` with
  `cache: "no-store"` when the page becomes visible again (at most once a minute) and
  every 10 minutes while it is visible. When the deployed web commit is not the one the
  page was built from, `src/ui/update.js` shows a small notice, "A new version is out",
  with RELOAD and LATER (under MENU on a wide screen, just above the dial on a tall
  one, beneath any card). It never reloads on its own. On a shared pitch with a match
  on it offers no RELOAD ("reload after this match") until the match is over.
- **Never cached**: `tools/delivery-plan.mjs` publishes `version.json` with
  `Cache-Control: no-store, max-age=0` (the site's cache policy has `MinTTL` 0, so
  CloudFront keeps none of it), after every page, beside `revision.json`; `tools/deploy.mjs`
  checks the live bytes and that the header says no-store.

## Tests and screenshots

- `tests/game/plan-client.test.mjs` (Playwright): dragging ARC lands between the old
  15-degree steps and its header follows; TILT takes a value off its ticks, reaches 20
  either way and an arrow moves it a tick, SPIN (KUBBS) 3; a kubb's spin is the next
  kubb's; ARC open is the side view until it closes and a TILT drag peeks; the plates
  open one at a time and close on Escape, a tap outside (which still aims) and their
  band; the keyboard reaches each plate, Enter opens it with its control focused, the
  arrows step it and Escape gives the focus back, in the design's Tab order; and in every
  layout (a wide screen with the clock right and left, a tall phone with the clock and
  with the linear meter right and left, a phone on its side with the meter right and
  left, a 390 x 664 window) the column is where and as big as `layout.js` plans, at the
  edge away from the meter, and each plate, closed and open, overlaps neither the meter,
  the minimap nor the header, the minimap does not move while one is open, and each
  control's hit area is at least 44 px across its drag.
- `tests/game/settings-client.test.mjs` (Playwright): `/settings/` from the web game's
  page replaces a device's typed name with a generated one and shows no text field, has
  no match option and no level of your own, keeps the device's older level, and what it
  sets is what the game reads; the first run rolls a name, SHUFFLE rolls a whole new one
  with no KEEP or picker, a stepper steps its word and keeps the other, the keyboard
  reaches every control of the row in order and a pick is announced; a segmented bar is
  one Tab stop with the arrow keys, Home and End inside, the chosen part ink with paper
  type and the ring 3 px of ink 2 px off; MENU's grid, Settings with the device's rows and
  DONE back to the menu, the practice pitch's Scene (and Black & White's Surface) only in practice, Raising
  in a match by hand; the solo card's name row is the match's name, and a pick in MENU's
  Settings is the next card's; the lobby's "You are" row and the room hears a pick.
  `tests/render/scenes-0.15.test.mjs` is the seven scenes and the fallback, the Kid line,
  the spin threshold, rings timed from impacts (and impacts changing no hash), the Kid
  words and flags, the spoken rest, and the cards' rows from the engine per scene.
  `tests/game/player-name.test.mjs` is the first run, the typed name replaced, saveName,
  the display check, the "II" rule and `prefsDevice`.
- `tests/game/design-client.test.mjs` (Playwright): Play the computer's order (the name
  row, Scene, Computer level, Opening, Raising, Wind; Black & White adds Surface after
  the Scene; no Kubbs, and a kept set plays Classic), HOME quiet at the left and START go at the right; the header's words,
  numbers, colours and spoken label, MENU in its plate, and hidden under a dimming card;
  the winner card's buttons; and on each card nothing under 14 px, every control 44 px
  tall (48 on a touchscreen) and one go.
- `tests/game/names-fit-client.test.mjs` (Playwright): every name from `names.all`,
  measured in the game's fonts, fits the name row, its steppers, the lobby and the header.
- `tests/game/names-client.test.mjs` (Playwright, the local pitch server): a page that
  sends a typed name is "Player 1" to everyone and still plays; two members with one
  name are "Mighty Maple" and "Mighty Maple II"; the host's team name for a side of
  several is seen by all and carried by the match; a forged snapshot's match is not
  shown, and a start naming a typed name is refused `bad-name`.
- `tests/game/levels-client.test.mjs` (Playwright): a device from before keeps its
  level, passed as before though nothing shows or sets it; the solo card's Computer level
  sets the computer, and neither the card, its You row nor MENU has a level of your own;
  on a pitch the host sets the computer's
  level, a watcher reads it, and the match starts with it. `tests/game/throw-level.test.mjs`
  is the move across, `tests/game/plan-sliders.test.mjs` the controls' values and marks.
- `tests/game/stand-client.test.mjs` (Playwright): no WALK; a drag on STAND (mouse on a
  desktop, a finger on a portrait phone) puts the thrower at `groundAt` and the engine
  clamps it at the corners, with the caption shown, the circle kept and nothing thrown; a
  tap and a drag on the pitch aim and never walk; after STAND the linear meter's stroke
  throws from STAND's place; the arrow keys step 0.25 m and A still walks.
  `tests/game/stand-pad.test.mjs` is the pure map and words.
- `tests/game/labels-client.test.mjs` (Playwright): BATONS | KUBBS shows the one in use
  and the rail agrees; the menu's row labels, and Sound On/Off mutes.
- `node --test tests/game/` (part of `npm run check`): `layout.test.mjs` is pure;
  `client.test.mjs` builds `dist/`, serves it through `tools/preview.mjs` on a free
  127.0.0.1 port and drives Playwright's Chromium: practice loads with no console errors; a
  mouse swing throws and returns to aiming; dragging the circle changes the engine's aim; a
  solo match plays our throws, the computer's WATCH turn and a hand-off back; watching the
  computer throws for both sides with no card, keeps going with `document.hidden` faked,
  and starts the next match by itself after the winner card; watching starts in the wide
  view, switches by the button and V (remembered over a reload), keeps one camera through
  both teams' throws and plays to a winner, while a solo match has no switch; a portrait
  phone (isMobile, touch) throws by touch; the linear meter registers the same back and
  stop as the clock by mouse and by touch, the menu's Meter switches and remembers, and a
  phone on its side keeps the linear meter at either edge (MENU or the rail 10 px off its
  body, a tap on its lane does not throw, a stroke high in the meter's half throws with
  POWER ON and ARC ON); a stroke in the linear meter's throw zone throws with
  POWER ON and ARC ON by touch (portrait) and mouse, and a tap there still moves the
  circle; a finger's drag from the circle or from elsewhere on the pitch moves it half the
  finger's travel; a touch outside the clock's ring throws on a portrait phone, and a tap out there
  still moves the circle; with Meter side, Left the
  linear meter (portrait and desktop) and the clock (desktop) lay out clear of the plan's
  sliders and buttons, the rail, MENU and the practice tray and throw, and the menu's Meter side switches
  and remembers. `tests/render/linear.test.mjs` is the meter's geometry (both sides),
  `tests/render/dial.test.mjs` the dial's (its finger track too), and `layout.test.mjs`
  checks both sides and the finger track's room, and on a phone on its side that the
  panel's bar clears the kubb being raised and the punishment half's near baseline (and
  lifts the scene on a window too short for it). `multiplayer.test.mjs` runs `tools/pitch-dev.mjs`
  on a free port too and plays a shared pitch (docs/MULTIPLAYER.md "Tests"). Both are
  skipped with a notice when Chromium is not installed (`npx playwright install chromium`).
- `window.__kubb` (engine, game, sound, cards, menu, config, and on a shared pitch `pitch`)
  exists only with `?test=1` or on 127.0.0.1 or localhost. There too, `?pitchserver=ws://...`
  points a pitch at another pitch server and `?api=http://...` the page at another api.
- Screenshots at 1280 x 768, 390 x 844 and 844 x 390 go to `build/client-shots/`
  (gitignored); `KUBB_MP_SHOTS=build/mp-shots` makes the multiplayer test take the lobby's.

## Not done yet

- Portrait zoom crops the outer kubbs of the far baseline; the pan follows the target.
- `public/game.css` is linked by a plain path, not a hashed asset name.

## Grip comparisons for future playtests

Use forehand as the reference for baton shots and backhand as the reference for
standard kubb drilling. An experienced player may use a backhand baton from
an advantage line to reach a very close target with more end-over-end turnover.
Use that shot to calibrate the contact angle. For kubbs, compare a backhand
drill with a beginner's sideways forehand toss into the same group. Record the
first contact, bounce and final resting place.
