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
| `/practice/`        | The open practice pitch: BATONS or KUBBS (the drill), surface, reset and level.                                                                                                                                                                                                                     |
| `/p/<code>?solo=1`  | A match against the computer. The options card first (name, level, surface, opening, raising, wind, kubb set; remembered), then START.                                                                                                                                                              |
| `/p/<code>?watch=1` | The computer against itself, match after match: no options card, the solo card's saved options, North against South. The winner card stays up 10 s (NEXT MATCH, STOP, HOME), then the next match starts by itself, the other team first. Seen in the wide view by default ("The wide view", below). |
| `/p/<code>`         | A shared pitch: the lobby (name, level, Team A or B or watching, the host's match options, START), then the match with everyone on the link. docs/MULTIPLAYER.md.                                                                                                                                   |
| `/e/<code>`         | The embed: a kept replay alone, for a frame on another site ("The embed", below).                                                                                                                                                                                                                   |

A failure to start shows a plain error card with RELOAD and HOME. The HOW TO THROW overlay
(four steps, an animated dial) shows on the first visit and from the menu; `?nohowto` skips it.

## Files

| File                                          | What it does                                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.js`                                 | Boot, the routes above, the practice tray, the solo flow; hands `/p/<code>` to `src/net/pitch.js`.                                                                               |
| `src/game/game.js`                            | `Game`: the loop, input, playback, the raise and punishment scenes, framing. The seam.                                                                                           |
| `src/game/hud.js`                             | `Hud`: the rail (who throws, what, the counts), the verdict flag and chips, the rest distance, SLOW MOTION and WATCH, the advantage, the plan (sliders, SIDE VIEW, STAND).       |
| `src/game/plan-sliders.js`                    | The plan's ARC and TILT/SPIN sliders (`PlanSlider`, DOM) and their scales and words (pure, `tests/game/plan-sliders.test.mjs`).                                                  |
| `src/game/layout.js`                          | Pure: where the dial (or the linear meter), the wide plan block and minimap go, the tall-canvas framing (`worldFit`, `stillFit`, `panFor`), and the wide view's box (`wideBox`). |
| `src/game/scenes.js`                          | The client's own cameras for raising and punishment, and the pieces in them.                                                                                                     |
| `src/game/auto-raise.js`                      | Pure: automatic raising for the turn (AUTO ALL) or the match (MENU, Raising).                                                                                                    |
| `src/game/raise-touch.js`                     | Pure: raising by touch, where the drawn kubb is, which end a tap or drag means, its tilt.                                                                                        |
| `src/game/sound.js`                           | `Sound`: the knocks and the king's chord through Web Audio; unlock on the first pointer down; mute remembered.                                                                   |
| `src/game/nudge.js`, `src/render/nudge.js`    | The throw's nudge: when it shows and the ghost's throw (pure), and its drawing over the meter ("The nudge", below).                                                              |
| `src/game/prefs.js`                           | `prefs`: localStorage, wrapped so a blocked store only forgets.                                                                                                                  |
| `src/game/draw.js`                            | The renderer's functions the game uses, in one place.                                                                                                                            |
| `src/ui/cards.js`                             | `Cards`: the engine's hand-off, pass and settle cards (naming who acts on a shared pitch), the winner, solo options, a plain notice, and the raise and punishment panels.        |
| `src/ui/lobby.js`                             | `Lobby`: the shared pitch's lobby card.                                                                                                                                          |
| `src/net/pitch.js`                            | `Pitch`: the shared pitch's controller: joins the room, runs the lobby, drives the Game through the seam, aim casts, shouts, host hand-over.                                     |
| `src/net/lobby.js`, `seats.js`, `sync.js`     | Thin wrappers over kubb-engine's `room.*` rules; cached seat/actor reads keep these calls out of the render loop (docs/MULTIPLAYER.md).                                          |
| `src/net/room.js`                             | The room client (docs/ROOMS.md).                                                                                                                                                 |
| `src/game/stand-pad.js`                       | STAND: where the thrower stands, the plate's map to the ground and back and its words (pure), and `StandPad`, its DOM and pointer ("Standing", below).                           |
| `src/ui/menu.js`                              | `Menu`: Your level, Meter, Meter side, Raising, View, Surface, Sound (each a row that shows its value), how to throw, resign, feedback, rules, home.                             |
| `src/ui/report.js`, `src/net/report.js`       | The report card, and what a report carries and how it is sent (below, and docs/ROOMS.md section 8).                                                                              |
| `src/ui/sheet.js`                             | The score sheet card (below).                                                                                                                                                    |
| `src/net/record.js`, `src/net/ask.js`         | What a solo or watch match's record carries and how it is sent; `ask`, the one-message socket reports and records share.                                                         |
| `src/replay/player.js`, `src/replay/fetch.js` | The replay player (`ReplayPlayer`, `startReplay`) and `fetchReplay`, a pitch's kept replay by its code (below).                                                                  |
| `src/ui/reel.js`, `src/net/reel.js`           | MAKE A HIGHLIGHT REEL: the button and its card (DOM), and the card's states, words and requests (pure, `tests/net/reel-client.test.mjs`); "Highlight reels", below.              |
| `src/ui/howto.js`                             | The HOW TO THROW overlay.                                                                                                                                                        |
| `src/ui/dom.js`                               | `h()` and `button()`.                                                                                                                                                            |
| `public/game.css`                             | The game pages' styles, linked by `src/site/pages.mjs` after the site's.                                                                                                         |
| `tests/game/`                                 | `layout.test.mjs` (pure), `client.test.mjs` and `multiplayer.test.mjs` (Playwright); `browser.mjs` is their helper.                                                              |

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
  with the engine's snapshot and hash after it, for the room to commit.
- **`game.applyRemote(action)`**: an action taken elsewhere. Applied with `engine.apply` and
  played back here; queued while a throw is still playing back. Returns the engine's result
  (`{ ok: false, ... }` on a refused action).
- **`game.showRemoteAim(state)`**: someone else's aim (their `aimState()`), shown for 1.5 s
  while it is their throw.
- **`game.adopt(snapshotText)`**: take a committed match snapshot as it is (a reconnect, a
  disagreement on the hash).
- **`game.aimState()`**: this browser's aim, for the room to send while aiming.
- **`game.whoActs(need)`** and **`cards.who(need)`** (optional): `{ text, mine }`, who acts
  for this need. The HUD's status pill shows the text (marigold when it is this browser's),
  and the engine's cards name them; a card for someone else's turn has a WATCH button and
  closes itself after 2.5 s.

Solo is only this seam with no network: `seat = { sides: ["A"], cpu: true }`, the local
player owns team A and this browser runs the computer as B (`src/main.js` `startSolo`).
A shared pitch is the same seam with the room behind it: `src/net/pitch.js` joins the
room, builds the seat from the match's teams, passes `onAction` to the room and calls the
three methods as documents and casts arrive. docs/MULTIPLAYER.md has the rules.

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
as WATCH), `play` (a recording playing back), `raise`, `punish`, `over`.

## The throw

All by Pointer Events with pointer capture; the canvas has `touch-action: none` and the
game page no text selection. A press is tried in this order: the meter (the clock's ring,
the linear meter's knob, then its body, which takes the press and does nothing), the
target circle (56 px round it on touch, 30 px with a mouse), the thrower, then
the clock's finger track (touch), the linear meter's throw zone, and last a tap on the
pitch. The plan (its sliders, SIDE VIEW and STAND) is DOM and comes before all of it. On a
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
- **The plan**: the ARC and TILT (a baton) or SPIN (a kubb) sliders, SIDE VIEW and STAND
  ("The plan's sliders", below); R/F and Q/E step them. Where the block sits is "The
  plan block on a wide screen", below.
- **Side view** (the engine's plan view: the camera out over the shoulder, the planned arc
  dashed): SIDE VIEW is a toggle for every pointer; held Shift peeks; dragging a slider
  shows it. Starting a throw turns it off.
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
  mark, a detent at each of the engine's steps: a baton's tilt 5 degrees a step to 20
  either way, a kubb's spin 1 a step to 3. The engine has only `stepSide(n)` for these, so
  the slider moves by `stepSide(target - current)`; the knob follows the finger while it is
  held and eases onto the nearest detent when let go. Fully continuous tilt would need a new
  engine call (a `setSide`), which this does not add.
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
  a second button. SIDE VIEW does not light for it.
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
- **Online**, the aim is still cast from `Pitch.tick` every `tickMs` (200 ms) and only when
  `aimKey` changed: a drag that changes the aim every frame sends at most 5 casts a second,
  as walking or dragging the circle does, under the room's 10 a second.
- **Where.** A wide screen: one block on the meter's inner side, TILT over STAND, and
  ARC over SIDE VIEW by the meter (`mirror` when the block is right of the meter). It is
  no taller than TILT and STAND, so it stays under the linear meter's prompt on a
  desktop and clear of the target circle on a phone on its side. A tall one: split
  either side of the throwing line, ARC over SIDE VIEW on the left and TILT over STAND
  on the right (`Hud.place`).
- B still peeks as Shift does (the Playdate's B button) but is not documented on the
  page.

**Standing** (Jamie, 2026-11-19: "Can you audit the control surface from a broader level
that would catch these type of odd engagements. It is all a hangover from us starting on
play date"). WALK, the Playdate's held A, was a toggle that made the next drag on the
pitch a joystick for the thrower: the same press meant something else depending on a
button pressed before it. The pitch could not take a direct drag instead: in the
thrower's view the camera stands behind the thrower, whose spot projects below the
screen's bottom edge (about 180 px below a phone's, far more on a desktop). So STAND
(`src/game/stand-pad.js`) is a plate in the plan, at least 44 px tall: the throwing line
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
  up to the advantage line."). The aria-label carries the same words.
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
  target). Grab the knob, draw back to the orange mark, fling up through the middle and let
  go on the blue mark. The body is two columns: the lane on the left carries the targets
  and the live peak, and the channel carries the knob and the last throw's ghosts, so the
  knob and the finger on it never hide a target. The prompt is a tab on its left at the
  knob's home.
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
  `minTravel` (320 px upright: a small phone's browser) or `wideMinTravel` (260 px on a wide
  screen, below) the layout's `meter` is `"clock"` and the dial is drawn; the menu says so
  under the choice. On a tall screen the plan splits either side of the throwing line, left
  of the meter.
- **A phone on its side keeps it** (Jamie, 2026-11-19, of the iPhone app: "Bug: On iPhone if
  I turn on linear and then rotate it goes back to the circular swing."). The chosen meter
  holds when the phone turns; it is never swapped for the clock because of rotation. On a
  wide canvas the box takes the whole safe height at its edge, from `tune.linearTopWide`
  (10 px) under the safe top to half a margin (7 px) over the safe bottom, at most
  `linearHMax` (450), so a desktop window's box still stands on the bottom where it was; the
  track needs `wideMinTravel` (260, `linear.js`) instead of the upright 320: 301 px on
  844 x 390, 261 on 740 x 350. A canvas under 349 px high (no insets) still gets the clock,
  and so do the browser sizes Playwright gives a 6.1-inch iPhone on its side with Safari's
  bars (750 x 342, 734 x 343). The numbers are the iPhone app's (`WideLayout`,
  `LinearMeter.layout`). Where the box comes up into the header row, the plates at that
  top corner move in beside it, `tune.meterGap` (10 px) off its body: MENU, the practice
  tray or the view tray, SKIP and the update note at the right, the rail, the shout bar
  and the shouts at the left
  (`meterRoom`; the game sets `--meter-r` and `--meter-l` for `game.css`; nothing moves in
  the wide view, which draws no meter). The plan block, the coach line and the nudge go as
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

**The plan block on a wide screen** (Jamie, 2026-11-19: "in landscape the tilt, arc,
stand controls should be pushed to the left hand side of the screen so the user can
control those with the left hand and the throw with the right hand"). On a wide canvas the
plan is one block, `tune.planW` x `tune.planH` (202 x 168 CSS px: TILT over STAND in a
124 px column, ARC over SIDE VIEW in a 70 px one), its foot 10 px above the meter's box's
foot. `layoutFor` returns it as `plan` (its rect) and `planEdge` (`planAt` in
`src/game/layout.js`):

- **A touchscreen** (`coarse`): the block is at the screen's edge away from the meter, 8 px
  inside the safe area: the left edge with the meter on the right (the default), the right
  edge with Meter side, Left (`planEdge` "left" or "right"). It is the same block slid to
  the edge, mirrored at the right edge, so TILT and STAND are always at the screen's edge
  and ARC and SIDE VIEW toward the middle. The minimap leaves its corner for the block's
  inner side, 12 px from it, its foot where it was, so it is out from under the thumb and
  far from the clock's touch zone beside the ring (2.1 radii). The clock or the linear
  meter stays where it was. On an iPhone on its side (852 x 393, 59 px insets left and
  right, 21 at the bottom) the block is at x 67 to 269 and the minimap 281 to 344, the
  throwing line at 426.
- **A mouse**: the block stays beside the meter on its inner side (`planEdge` null): one
  hand does everything there, so near is better. So does a touchscreen too narrow to keep
  the block and the minimap `tune.planClear` (24 px) short of the throwing line.
- **Beside the linear meter** the block never goes over the prompt tab (`tabRect` in
  `linear.js`, 5 tab heights wide). Where beside would reach it (a short window with a
  mouse, now that the linear meter holds there) the block goes to the far edge as on a
  touchscreen. Where the far edge cannot keep the block and the minimap off the throwing
  line, the block stays there and the minimap goes over it, 12 px above, its inner edge
  with the block's (`mapStacked`), or is not drawn (`minimap` null) where it would come
  within `tune.stackedMapGap` (10 px) of the rail's box: 600 x 420 has it, 600 x 380 not.
  Beside the clock this is as before.
- **No room, the clock** (Codex on PR #71, twice). Where no placement keeps the block off
  the tab and the minimap (`planAt` returns null), or where the plates the meter moves in
  would crowd the header row (`headerFits`), the layout is the clock's, whole, and nothing
  moves. `layoutFor` decides it in one place and never returns a linear layout with a
  known collision. The game passes what its header holds (`opts.header`: `"practice"`,
  `"watch"` or null for a match; `Game.setHeader`, set by `main.js` with the tray), and
  `headerPlates` places the two plates with the widths measured in the browser: the rail
  at its widest (practice's 140, watching's 237, the counts' nowrap widest, a match's 44% of
  the canvas, since its names are the players') must end `tune.headerGap` (8 px) short of
  the right corner's row (MENU 64 with SKIP 60 under it, or the tray: practice's BATONS |
  KUBBS and RESET 222, or the view tray 90, its right edge 100 px in). The sweep in
  `tests/game/layout.test.mjs` (360 to 1400 by 300 to 900 px, both sides, mouse and touch,
  no insets, a notch, a top bar, each header) holds every linear layout free of overlaps;
  `client.test.mjs` holds the page's plates to those widths. Of the sizes with room for the track, the clock is drawn on windows up
  to 580 px wide in practice (480 x 350 among them), 540 while watching and 460 in a match
  (400 x 350); with notch insets 660, 640 and 560. Every phone on its side keeps
  the linear meter in every mode. With a moved row the update note wraps short of the
  rail's widest (`.meter-room`), and the shout bar keeps inside the canvas.
- **A tall canvas** has no block (`plan` null): the plan splits either side of the line.

The held slider's caption grows from the block's edge at the screen's edge toward the
middle (beside the meter, away from the meter); it is lifted above the linear meter's tab
only where its span reaches the tab, and above a stacked minimap. The web's captions sit
over the block, so the iPhone's caption strip beside SHOUT (its 112 pt floor and own line
under the header row) has no web counterpart. The coach line measures the block as
before. On a short screen only the newest shout shows, above the block.

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
prompt and follows the stroke: PULL BACK TO THE ORANGE MARK at rest, NO RUSH GOING BACK
while drawing back short of the power band, and NOW FLICK FAST AND STOP ON THE BLUE MARK
from the band on (the marks are the HOW TO THROW card's words). That is the engine: the
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
- **Where.** Centred over the clock's prompt plate, or over the linear meter's tab from
  the meter's inner edge, 8 px above it, at most 280 px wide and short of any plan control
  level with it, so it never covers the sliders, the minimap or MENU. On a wide canvas
  with the plan block at the far edge (a phone on its side) it hangs 8 px under the tab
  instead, in the meter's half (`planClear` short of the centre line), as on the iPhone:
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
`view.fit` (docs/RENDER.md): `worldFit` zooms to 1.3 times the width fit, anchors the
target half a third of the way down, and pans across (eased) to keep the target circle in
sight; the pan holds while the circle is dragged. The raise and punishment scenes use
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
lying kubb from the defender's side, and high over the defender's baseline.

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
  choice is remembered as the `watchView` pref; wide is the default. Played matches
  (solo, a shared pitch, practice) always use the thrower's view and have no switch.
- **Too small.** Where the smallest base kubb would stand under 6 CSS px (`tune.wideMinPx`;
  a phone held upright, about 4.5 px), the thrower's view shows whatever is chosen and the
  button is hidden; it comes back when the window grows. A phone on its side keeps the wide
  view.

## Playback

`engine.showAt(t)` each frame with the engine's cameras. The bursts come from the
recording's `timeline.bursts` and are drawn at their anchors as they happen; the king's
burst inverts the screen. Each piece's first touch plays a knock: one of
`public/sounds/knock-1..9.wav`, a random take, never the last one and preferably not one
still sounding, at a rate of 1 +- 0.06, so knocks together overlap as different takes. The
king gets a short chord. Audio unlocks on the first pointer down; mute is remembered.

After a throw the flag (1 DOWN, MISS, ...) and the verdict chips (power, release,
steadiness and side; only for this browser's throws) show, and the rest distance in
practice. An off-target verdict is the plain word (LONG, SHORT, SLOW, LOW, HIGH, SHAKY,
PULLED LEFT, PULLED RIGHT) in a `.chip.off`: inverted like the flag (ink with paper type),
larger and heavier, and ahead of the on-target chips (POWER ON, ARC ON, STEADY, STRAIGHT),
which keep the plain paper pill (`verdictChips` in `src/game/hud.js`). Tyler's report,
2026-11-16: a long throw's POWER LONG read just like POWER ON under a MISS, and three
throws he took for perfect had been judged long.

## Match flow

- The engine's cards: the hand-off (whose turn, what they throw, both bases, a map), the
  pass and the settle cards. The computer's turn shows as WATCH.
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
  choice, one every 0.7 s so each is seen. MENU, Raising (By hand or Automatic; the row
  appears once this browser has been asked to raise) and REST OF GAME, beside BY HAND
  while AUTO ALL runs, do that for every kubb for the rest of the match. While it is
  automatic the panel only says so, with BY HAND to take it back. It is this player's
  choice, never sent or recorded apart from the raises themselves, never for the other
  team, held while a card or the menu is open, and given back to the player if the
  engine refuses a raise. It is not kept on the device: a match that always raises
  itself is the match's own Raising option (the solo card, the lobby), which never asks.
  `src/game/auto-raise.js` (pure, its 0.7 s in `tune`), `Game.autoRaiseTick`.
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
- **The winner**: REMATCH (back to the options; on a shared pitch the host's only, back to
  the lobby with the same teams), SCORE SHEET and HOME.
- **The menu**: its rows (Your level, the player's own throw tolerance; Meter; Meter side;
  Raising in a match; View when watching; Surface in practice; Sound) each show their
  value as a choice. Then how to throw, score sheet (a match), resign, send feedback,
  rules, home; Escape closes it.
- **The rail** counts in words ("5 BASE KUBBS", "2 FIELD KUBBS", "AT THE KING", practice
  kubbs "TARGET 2.3 M"; `railCount` in `hud.js`) where the engine's rail says the
  Playdate's "BASE 5". Practice's tray is a joined pair, BATONS | KUBBS, the one in use
  pressed, then RESET.

## Replays

A finished match on a shared pitch can be watched again (Jamie, 2026-11-16: "When a game
is finished playing on a pitch I'd like the URL to allow people to come and watch a
replay of the match."). A replay is not a video: the match is set out again from its
`newMatch` options and every committed action goes through this engine in order
(the engine's `session/replay.lua`), the same throws with the same physics, so it plays with the
current engine. What the pitch keeps is `docs/MULTIPLAYER.md` "The document"; where it is
stored, `docs/ROOMS.md` section 10.

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
  pitch page's lobby, room session or menu (`menu` is optional, for its View item), so an
  embed can mount it on a page of its own. It takes over the Game's seat (one that may
  never act), its cards (`game.noCards`), its view and its loop (`game.driver`, called
  every tick, and `game.timeScale`), and gives every one back on `destroy()`.
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
(`{ code, state, teams, turn, final }`); without it the embed asks the room server for a
kept replay and shows "No match here" when there is none.

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
  (`Pitch.reelFor`). Not on the embed, not when watching the computer, not in practice
  or a match against the computer: that needs sharing (docs/REEL.md), and the card
  already takes nothing but a pitch code for it. One `Reel` a finished match, so the
  winner card and the replay say the same.
- **The button follows the reel.** MAKE A HIGHLIGHT REEL, MAKING YOUR REEL while it is
  asked for or renders, WATCH THE REEL once it is done. Pressing it opens the card.
- **Asking is starting.** The first `reel` request for a kept replay starts its render,
  so the page never sends one before the button is pressed. First the card reads the
  room's kept replay (`askKept`, a `replay` message, which starts nothing) and checks it
  is the match on the screen (`n` and `hash`): a just-ended match's `keep` may still be
  on its way, so it looks again up to `reelTune.keptTries` times, 2.5 s apart, and a
  newer match kept since means this one's reel can no longer be asked for. It reads it
  afresh on every press and every TRY AGAIN (`reelRequest`), never from a replay already
  in hand: a viewer can sit in an old replay while a rematch is kept, and asking then
  would start the newer match's render. Then `askReel`, which names that version (`v`)
  on every request (the first ask, each poll, a card opened again, TRY AGAIN): a room
  that keeps another answers `why: "moved"` and starts nothing (docs/ROOMS.md section
  12). The answer's `v` is still checked against the kept one, for a rooms server from
  before `v`.
- **Making.** The card's title is "Highlight reel" in every state (the words are the
  table in docs/REEL.md "What a player sees", `REEL_WORDS`). While it renders, the state
  line MAKING YOUR REEL, a slow bar that never claims how far, and "About a
  minute. You can keep watching." The card closes with BACK, Escape or a press outside
  it. It asks again every 5 s (`reelTune.pollMs`) while it is open and the page is shown,
  and stops when either is not; opened again, or the page shown again, it asks at once.
  Each request is one message on a socket of its own (`src/net/ask.js`); asking how a
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
  room's newest match asks the server as MAKE does. The page is cached up to 5 minutes
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

## Score sheet

MENU, SCORE SHEET during a match (solo, watch or a shared pitch; not practice), or SCORE
SHEET on the winner card, opens a card titled "Score sheet": "The match so far." or "The
whole match.", a link "How to read it" to the Planet Kubb Notation page
(thingelstad.xyz/things/planet-kubb-score/, `?ref=kubb-sheet`), the game file the
engine writes (`engine.sheet()`, `Session:sheet()` in the engine's session/session.lua: the core's
score sheet as it stands), SHOW POSITIONS / HIDE POSITIONS, COPY, DOWNLOAD and BACK.

- Positions (the `{...}` lines after each turn) are hidden by default; the toggle shows
  them. COPY and DOWNLOAD always take the whole file, positions included: COPY says
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
member id. Practice is not recorded. A build without a rooms address records nothing.

## Reports

MENU, SEND FEEDBACK (shown in every mode whenever the build has a rooms address) closes
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
  watching, and feedback from practice, against `tools/rooms-dev.mjs`.

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

Two versions: the web game's own (`version` in `package.json`, 0.1.0) and the version of
kubb-engine it vendors (`vendor/engine/engine.json`, read in Lua as `engineVersion`).
The game file's "Scored by" is "Throwing Wood web <web version>" (`setClient`); records,
reports and the `with` rider carry the engine's version as `engine` / `e`.
Room joins also announce `me.engine` (major.minor), START checks the members and writes
`match.engine`, and `room.mayPlay` gates team and CPU control of a running match.
The temporary lenient policy and version refusal cards are in docs/MULTIPLAYER.md "Engines".

- **The release** (`src/site/release.js`): `{ version, web, engine, text }`, `text` as
  `0.1.0 · web a2659b7 · engine 0.2.0`. The build (`tools/build.mjs`) reads the version
  from `package.json`, the web commit from `GITHUB_SHA` in CI or `git rev-parse HEAD`,
  and the engine's version from `vendor/engine/engine.json`; it puts the release in the
  game pages' config (`config.release`) and writes it as `/version.json`.
- **Shown** small at the foot of the reading pages (home, rules, 404) and of MENU.
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
  15-degree steps and its header follows; TILT settles on steps of 5 and reaches 20 either
  way, SPIN (KUBBS) 3; a drag shows the side view and it goes after the peek; SIDE VIEW
  toggles with a mouse click; and in every layout (a wide screen with the clock right and
  left, a tall phone with the clock and with the linear meter right and left, a phone on
  its side with the meter right and left, a 390 x 664 window) the plan overlaps neither
  the meter, the minimap nor MENU, a wide screen's block is the size `layout.js` plans
  for (`tune.planW`, `planH`) and on a phone on its side at the far edge, and each
  slider's hit area, and STAND's, is at least 44 px across its drag.
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
  lifts the scene on a window too short for it). `multiplayer.test.mjs` runs `tools/rooms-dev.mjs`
  on a free port too and plays a shared pitch (docs/MULTIPLAYER.md "Tests"). Both are
  skipped with a notice when Chromium is not installed (`npx playwright install chromium`).
- `window.__kubb` (engine, game, sound, cards, menu, config, and on a shared pitch `pitch`)
  exists only with `?test=1` or on 127.0.0.1 or localhost. There too, `?rooms=ws://...`
  points a pitch at another room server.
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
