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
| `/practice/`        | The open practice pitch: batons or the kubb drill, surface, reset and level.                                                                                                                                                                                                                        |
| `/p/<code>?solo=1`  | A match against the computer. The options card first (name, level, surface, opening, raising, wind, kubb set; remembered), then START.                                                                                                                                                              |
| `/p/<code>?watch=1` | The computer against itself, match after match: no options card, the solo card's saved options, North against South. The winner card stays up 10 s (NEXT MATCH, STOP, HOME), then the next match starts by itself, the other team first. Seen in the wide view by default ("The wide view", below). |
| `/p/<code>`         | A shared pitch: the lobby (name, level, Team A or B or watching, the host's match options, START), then the match with everyone on the link. docs/MULTIPLAYER.md.                                                                                                                                   |

A failure to start shows a plain error card with RELOAD and HOME. The HOW TO THROW overlay
(four steps, an animated dial) shows on the first visit and from the menu; `?nohowto` skips it.

## Files

| File                                          | What it does                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.js`                                 | Boot, the routes above, the practice tray, the solo flow; hands `/p/<code>` to `src/net/pitch.js`.                                                                        |
| `src/game/game.js`                            | `Game`: the loop, input, playback, the raise and punishment scenes, framing. The seam.                                                                                    |
| `src/game/hud.js`                             | `Hud`: the rail (who throws, what, the counts), the verdict flag and chips, the rest distance, SLOW MOTION and WATCH, the advantage, the plan buttons.                    |
| `src/game/layout.js`                          | Pure: where the dial and minimap go, the tall-canvas framing (`worldFit`, `stillFit`, `panFor`), and the wide view's box (`wideBox`).                                     |
| `src/game/scenes.js`                          | The client's own cameras for raising and punishment, and the pieces in them.                                                                                              |
| `src/game/sound.js`                           | `Sound`: the knocks and the king's chord through Web Audio; unlock on the first pointer down; mute remembered.                                                            |
| `src/game/prefs.js`                           | `prefs`: localStorage, wrapped so a blocked store only forgets.                                                                                                           |
| `src/game/draw.js`                            | The renderer's functions the game uses, in one place.                                                                                                                     |
| `src/ui/cards.js`                             | `Cards`: the engine's hand-off, pass and settle cards (naming who acts on a shared pitch), the winner, solo options, a plain notice, and the raise and punishment panels. |
| `src/ui/lobby.js`                             | `Lobby`: the shared pitch's lobby card.                                                                                                                                   |
| `src/net/pitch.js`                            | `Pitch`: the shared pitch's controller: joins the room, runs the lobby, drives the Game through the seam, aim casts, shouts, host hand-over.                              |
| `src/net/lobby.js`, `seats.js`, `sync.js`     | Pure: the room document's reducers, who acts, and how a browser stays in step (tests in `tests/net/`).                                                                    |
| `src/net/room.js`                             | The room client (docs/ROOMS.md).                                                                                                                                          |
| `src/ui/menu.js`                              | `Menu`: level, surface (practice), sound, how to throw, resign (a match), report a throw, rules, home.                                                                    |
| `src/ui/report.js`, `src/net/report.js`       | The report card, and what a report carries and how it is sent (below, and docs/ROOMS.md section 8).                                                                       |
| `src/ui/sheet.js`                             | The score sheet card (below).                                                                                                                                             |
| `src/net/record.js`, `src/net/ask.js`         | What a solo or watch match's record carries and how it is sent; `ask`, the one-message socket reports and records share.                                                  |
| `src/replay/player.js`, `src/replay/fetch.js` | The replay player (`ReplayPlayer`, `startReplay`) and `fetchReplay`, a pitch's kept replay by its code (below).                                                           |
| `src/ui/howto.js`                             | The HOW TO THROW overlay.                                                                                                                                                 |
| `src/ui/dom.js`                               | `h()` and `button()`.                                                                                                                                                     |
| `public/game.css`                             | The game pages' styles, linked by `src/site/pages.mjs` after the site's.                                                                                                  |
| `tests/game/`                                 | `layout.test.mjs` (pure), `client.test.mjs` and `multiplayer.test.mjs` (Playwright); `browser.mjs` is their helper.                                                       |

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
game page no text selection. A press is tried in this order: the dial, the target circle
(56 px round it on touch, 30 px with a mouse), the thrower, then a tap on the pitch.

- **The dial** (lower right on a wide screen, lower centre on a tall one): drag is the arm,
  letting go is the release. Pointing and throwing work touching only the dial.
- **The target**: drag the circle, tap the pitch, or the arrow keys.
- **Walking**: WALK beside the dial (the Playdate's held A) turns a drag on the pitch into a stick: right walks right, up comes forward, down steps back, full pace 60 px out. Turned off by the swing. Or A/D and W/S, or drag the thrower where it is on screen.
- **The plan**: ARC up and down and TILT (a baton) or SPIN (a kubb) left and right, each
  button labelled with its value; R/F and Q/E.
- **Plan view**: held with a mouse, a toggle on touch; Shift or B held.
- Space skips a playback.

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
  `lua/web/wide.lua` `wide.tune`.
- **Filling the window.** The client passes `engine.setWide(box)` the whole window as the
  400 x 240 frame's coordinates see it, less the HUD's margins (`layout.js` `wideBox`:
  70 px at the top for the rail, 132 on a tall window, 16 elsewhere). Lua fits the
  camera's lens and centre to that box so the pitch, a baton at the top of its flight
  (1.95 m) and the throwers' ground fill it. The frame stays only as the coordinate system:
  the ground, the rough, the pieces, the bursts and every un-projection go through the
  same camera and the same scale rule, so nothing is letterboxed. It is fitted again on
  every resize.
- **One view for both teams.** The session keeps Team B's throws in Team B's view frame
  (the pitch turned 180 degrees, core/frame). In the wide view `lua/web/api.lua` passes
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

After a throw the flag (1 DOWN, MISS, ...) and the verdict chips (POWER, RELEASE, STEADY;
only for this browser's throws) show, and the rest distance in practice.

## Match flow

- The engine's cards: the hand-off (whose turn, what they throw, both bases, a map), the
  pass and the settle cards. The computer's turn shows as WATCH.
- **Raising by hand**: the kubb lying, its two ends numbered on the pitch; tap an end, or
  END 1, END 2, AUTOMATIC.
- **Punishment**: drag or tap the kubb in the defender's half; the stakes and the king carry
  keep-out circles and a refused spot says why (TOO NEAR A STAKE); PLACE IT when allowed.
- **The winner**: REMATCH (back to the options; on a shared pitch the host's only, back to
  the lobby with the same teams), SCORE SHEET and HOME.
- **The menu**: level, sound, how to throw, score sheet (a match), resign, report a throw,
  rules, home; Escape closes it.

## Replays

A finished match on a shared pitch can be watched again (Jamie, 2026-11-16: "When a game
is finished playing on a pitch I'd like the URL to allow people to come and watch a
replay of the match."). A replay is not a video: the match is set out again from its
`newMatch` options and every committed action goes through this engine in order
(`lua/web/replay.lua`), the same throws with the same physics, so it plays with the
current engine. What the pitch keeps is `docs/MULTIPLAYER.md` "The document"; where it is
stored, `docs/ROOMS.md` section 10.

- **The engine.** `engine.replayLoad(data)` sets the replay out in a session that belongs
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

## Score sheet

MENU, SCORE SHEET during a match (solo, watch or a shared pitch; not practice), or SCORE
SHEET on the winner card, opens a card titled "Score sheet": "The match so far." or "The
whole match.", a link "How to read it" to the Planet Kubb Notation page
(thingelstad.xyz/things/planet-kubb-score/, `?ref=kubb-sheet`), the game file the
engine writes (`engine.sheet()`, `Session:sheet()` in lua/web/session.lua: the core's
score sheet as it stands), SHOW POSITIONS / HIDE POSITIONS, COPY, DOWNLOAD and BACK.

- Positions (the `{...}` lines after each turn) are hidden by default; the toggle shows
  them. COPY and DOWNLOAD always take the whole file, positions included: COPY says
  "Copied the game file." (or "Could not copy. The file is selected to copy."), DOWNLOAD
  saves the game file under its notation file name (a `.txt`) and says "Saved <file name>.".
- The text is monospaced and wraps, in a box that scrolls on its own, so it reads at
  phone width without sideways scrolling.
- Modal like the report card; Escape, BACK or a tap outside closes it. The game goes on
  underneath (watching the computer keeps playing).
- The file's header says `[Location "Playdate"]`: the core's default, left as is.

## Recording

Every solo and watch match is recorded when it ends (a winner or a resignation), the way
a shared pitch's versions are (docs/ROOMS.md section 7): `recordMatch` in
`src/net/record.js` sends one `game` message with the mode, the build, the options, the
match's first snapshot, every action and the engine's hash after each, how it ended and
the game file. Once a match (`game.trail.recorded`), including from a hidden tab while
watching; a failure is a console warning and nothing else. No user agent, address or
member id. Practice is not recorded. A build without a rooms address records nothing.

## Reports

MENU, REPORT A THROW (shown in every mode whenever the build has a rooms address) closes
the menu and opens the report card: "What happened?" and "What should have happened?"
(1000 characters each; SEND with both blank asks for one), the sentence "This sends what
you typed with this game as it stands (its options, names and throws), so the throw can be
played again and tested. It is kept privately and not published.", SEND and CANCEL
(Escape cancels). SEND shows "Sending...", then "Sent, thank you." with BACK TO THE PITCH,
or "The report was not sent." with the reason, and the answers stay to send again.

- **The game while it is open**: modal, as under the menu. Nothing typed or pressed
  reaches the pitch, and a throw this browser is aiming waits (the dial and the circle
  hold). A throw already playing back finishes, the computer's turn goes on, a shared
  pitch carries on with everyone else, and watching the computer keeps playing, its next
  match included.
- **What is sent** is read when the card opens, so a throw that plays on underneath does
  not replace the one reported. `game.trail` (src/game/game.js) is kept for it: a match's
  snapshot at its start (or at its last adopt) and every action applied in this browser
  since, with the snapshots before and after the last one; practice's options and every
  throw, RESET, DRILL and surface change since the pitch was set out. With them go the
  mode, the build (`config.version`, `commit`, the hashed Lua bundle's name, and
  `config.core`, the vendored core's commit), the viewport, the browser's clock, the turn
  and phase, the last throw's action and result, the pieces where they stand, and on a
  shared pitch the room code, `v` and the match's `n` and `seq`. Never the user agent or
  a member id: a match's players carry their member id as `key`, so `captureReport`
  swaps every member id for `member1`, `member2`, ... throughout (the snapshot strings
  too, the same way everywhere, so it still replays). It copies the history when the
  card opens, so what is played while it is open is not in the report. `reportMessage` holds it to 64 KB, dropping the history, then the
  pieces, then the snapshot after (listed in `r.dropped`); never the answers.
- `tests/net/reports.test.mjs` covers the payload and the replay; `client.test.mjs` sends
  one from a solo match, practice and watching, against `tools/rooms-dev.mjs`.

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
flick of about 1000 deg/s read SLOW, so `lua/web/tune.lua` sets it to 1200 for the web.

The Playwright mouse and CDP touch need two animation frames a step (a round trip each),
so `client.test.mjs` doubles the flick speed to make up for the 30 Hz stepping.

## Version and freshness

One version for the game: the Playdate's `source/pdxinfo` (`version`, `buildNumber`),
carried in the core as `vendor/core/version.lua` (`tw.version`) and so brought here by
`npm run vendor:sync`. There is no separate engine version; the core's identity is the
playdate-kubb commit in `vendor/core.json`, shown as a diagnostic.

- **The release** (`src/site/release.js`): `{ version, build, web, core, text }`, `text`
  as `0.9.5 (6) · web a2659b7 · core cca8012`. The build (`tools/build.mjs`) reads the
  version and build from `vendor/core/version.lua`, the web commit from `GITHUB_SHA` in
  CI or `git rev-parse HEAD`, the core commit from `vendor/core.json`; it puts the
  release in the game pages' config (`config.release`) and writes it as `/version.json`.
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

- `node --test tests/game/` (part of `npm run check`): `layout.test.mjs` is pure;
  `client.test.mjs` builds `dist/`, serves it through `tools/preview.mjs` on a free
  127.0.0.1 port and drives Playwright's Chromium: practice loads with no console errors; a
  mouse swing throws and returns to aiming; dragging the circle changes the engine's aim; a
  solo match plays our throws, the computer's WATCH turn and a hand-off back; watching the
  computer throws for both sides with no card, keeps going with `document.hidden` faked,
  and starts the next match by itself after the winner card; watching starts in the wide
  view, switches by the button and V (remembered over a reload), keeps one camera through
  both teams' throws and plays to a winner, while a solo match has no switch; a portrait
  phone (isMobile, touch) throws by touch. `multiplayer.test.mjs` runs `tools/rooms-dev.mjs`
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
