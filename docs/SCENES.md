# Scenes

A scene is how a match looks, and since Kubb Engine 0.14 also where it is played: the
engine owns the scenes (its docs/SESSION.md "Scenes", docs/notes/scenes.md) and decides
each one's surfaces and kubb set. Seven, in the engine's order:

| id           | shown         | ground              | set       | the look (`src/render/`)                                                                                                                                                                                                         |
| ------------ | ------------- | ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `day`        | Park          | grass               | Classic   | the pitch as it has always been drawn (`world.js`)                                                                                                                                                                               |
| `beach`      | Beach         | sand                | Classic   | a sand pitch by the sea: a hot sky and a low sun over the water, foam 3 m past the far baseline, wet sand, striped umbrellas and towels, dune grass, a sail; sand puffs (`beach.js`)                                             |
| `night`      | Camping       | grass               | (glowing) | a moonlit clearing under the stars, glowing lines and pieces, stardust (`night.js`)                                                                                                                                              |
| `neon`       | Techno        | grid                | (neon)    | a near-black glossy floor with a faint grid that mirrors the pieces, one light per side, a ribbon of light behind the thrown piece, haze at the horizon, a ring at every strike (`neon.js`)                                      |
| `minnesota`  | Minnesota     | snow                | Minnesota | a winter park: a pale cold sky and low sun, snowbanks a metre off the sidelines, pines with snow on their tiers and bare birches, falling snow, slate-blue shadows; snow sprays (`minnesota.js`)                                 |
| `tournament` | Tournament    | grass               | USA       | the player's pitch roped off with pennants among neighbouring pitches playing live computer matches of their own ("The Tournament's live neighbours"), no people, flip scoreboards with numbers only, a canopy (`tournament.js`) |
| `bw`         | Black & White | grass, sand or snow | Classic   | the Playdate's own 1-bit look: white ground, black ink and shadows, dither patterns for every grey and for each surface's rough, the controls black and white (`mono.js`)                                                        |

Camping and Techno draw their own sets over the engine's Classic (the glowing set, the
neon solids), as they always have. Night, Neon and every new look are our own designs: no
name, logo, typeface or likeness from a film, a game, a brand or a championship. Techno
takes its qualities from the owner's private stills (near-black space, one glowing
colour per side, light from edges and rims, lingering light, haze), never their designs.

## A scene is a look, the engine's choice of ground

The match carries its scene as an id: the engine's `scene` option, shown as `view.scene`.
A scene never changes the physics of a throw beyond the ground it decides: the same throw
on the same surface goes the same way in every scene. Every options card names the scene
with every `newMatch`, `newPractice` and `setOptions`, and draws what the view says
(`scene`, `surface`, `set`). The engine reads an id it does not list as Park and does not
keep it; an id this client does not draw (a newer engine's) is drawn as Park too.

## One entry: the Stage

Every surface that draws a match draws it through one `Stage`
(`src/render/scenes.js`):

- the game, and with it its replay player and the embed (`Game.world` takes the
  scene from the session's view, `viewData.scene`)
- the highlight reel and its stills on the server (`backend/reels/render.mjs`)

```js
const stage = new Stage({ reduced, skin }); // skin: also skin the page
stage.use(view.scene); // "day" or an unknown id: the day
stage.watch(rec); // a throw starts playing
stage.observe(items, t); // a shown frame of it, at shown time t (and each piece's spin)
stage.tick(dt); // between throws
stage.draw(ctx, view, camera, scene, time); // drawWorld in the scene
```

With the day, `stage.draw` is exactly `drawWorld`'s picture: a recording of four
pictures is pinned by hash (`tests/render/scene-day.test.mjs`), for no scene, the day
by name and any unknown id.

The share image of a pitch (`/og/`, `pitchCardImage` in `src/site/art.mjs`) is a
drawing from above of its own, on the scene's ground (`CARD_GROUNDS`).

## Picking one: scene first

Every options card is the engine's card for the scene picked, `pitch.optionRows({ scene
})`: the Scene first as picture tiles (`src/ui/scene-tiles.js`; seven, three a row on a
phone with the seventh centred, four a row on a wide card, each the game's own postcard
of the pitch in that scene, `Game.sceneThumb`, on the scene's own ground and set), a
Surface row only where the scene leaves one (Black & White), no Kubbs row, then Computer
level, Opening, Raising and Wind. The pitch behind the card or lobby is started again in
the pick (`Game.showScene`), skin and ground.

- **Play the computer**: the solo card (prefs `solo`), so its view, its recording and a
  share of it carry the scene. Kept options go through the scene (`soloSaved`,
  `throughScene`): a sand surface kept on Park comes back grass.
- **Watch the computer**: the solo card's saved Scene.
- **Practice**: MENU's Scene tiles and, for Black & White, its Surface, kept as
  `practiceScene` and `practiceSurface`. A change starts the practice again in it.
- **A shared pitch**: the host's tiles in the lobby, written with `setOptions` (with the
  scene named every time) into the room's `settings.scene`; a guest reads its name. The
  host's pick is kept for their next pitch (`pitchOptions.scene`).
- **`?scene=beach`** (any id) picks one for practice, solo and watch over the saved one,
  for links and testing. Never a shared pitch's.

End to end: a solo match's start names its scene, the renderer's share check
(`backend/reels/check.mjs`) replays it unchanged into the sealed room's document and
replay, and the reel of that replay is drawn in it (`tests/reel/scene.test.mjs`). A
pitch's replay and embed play its match's views, which carry it. A pitch's share card
(`/og/`, `pitchCardImage` in `src/site/art.mjs`) takes the scene's ground
(`CARD_GROUNDS`).

## What a scene is made of

`sceneOf(id)` makes a scene's look, an object of three parts:

- **The look**: data and hooks `drawWorld` calls (`src/render/world.js` says when).
  Data: `groundOf` (the ground's colours by surface), `setOf` (the pieces' wood),
  `light` (the sun's direction and shadow), `paint` (the pieces' ink, and
  `litOf(item)` for a piece's own light), `clearing` (the rough round the pitch).
  Hooks, each `(ctx, cam, kx, B, ...)`, in drawing order: `sky`, `rough` (with a
  clearing), `beyond` (ground past the rough: the sea), `lightGround`, `lines`,
  `scenery` (what stands round the pitch, before every mark and piece), `beforePieces`,
  `baton`, `afterPieces`. Data besides: `reflect` (a glossy floor's reflections, from the
  ground's paint), `cone` (the Kid line's cones), `spinOpaque` (Black & White: a spinning
  piece's own pose is never faded). A hook left out is the day's.
- **The skin tokens** (`skin`): the colours of everything drawn over the pitch, for
  the canvas (`ui`, `hud`, `burst`, `aim`: `useSkin` in `src/render/palette.js`) and
  for the page (`css`: custom properties on the root, and `data-scene`). The accent
  plates (SLOW MOTION, GO buttons such as BACK TO THE PITCH, the status pill) take
  `--accent` and `--on-accent`. The team colours stay the same in every scene.
- **The effects** (`makeFx`, or `dust` for the stardust's numbers): an object with
  `clear`, `watch`, `observe`, `tick` and `draw`, fed by the throw being shown.
  Night has the stardust (`src/render/stardust.js`); neon wraps it as sparks and adds
  the ribbon (`NeonFx` in `src/render/neon.js`).

## What stands round a pitch

The cameras look down at the pitch: the aim view on a wide screen sees about 6 m past
the far baseline and little past the sidelines, the impact camera less. So what tells a
scene apart stands near: the sea 3 m past the far baseline, snowbanks a metre off the
sidelines, the rope 1.2 m off them and scoreboards just past the far rope; the trees, the
neighbouring pitches and the canopy are for a tall screen's aim view, the wide view and
the throw's wider shots. Things are flat pictures standing at their place
(`src/render/scenery.js`: `standAt`, `pine`, `birch`, `cone`), scaled by
their distance, with the ink line (3 CSS px up close, never under 1). Anything nearer
the camera than the pitch's middle is left out, so the wide view never has a tree
between it and the pitch. (The Tournament had people too, players and watchers, until web
0.17.0: the owner, 2026-11-22, "Tournament mode should not have people. Just pitches
with live play.")

The Tournament's neighbours are data drawn by one function, `drawNeighbours(ctx, cam,
kx, B, pitches)` (`NEIGHBOURS`, or a scene's own `neighbours`): each pitch's place and
its pieces in its own frame. Since web 0.16.0 they are live (below); since 0.17.0 they
have no people.

## The Tournament's live neighbours

The pitches round the player's play real computer-against-computer matches, as scenery
(the owner, 2026-11-21: "a grid of pitches that are all live"; engine 0.15.1's
`neighbours.*`, its docs/SESSION.md "Neighbours", docs/CLIENTS.md "0.15.1 on top" and
docs/notes/tournament.md). Nothing in them touches the player's match, its engine, its
snapshot or its hashes.

- **A second engine in a Web Worker.** `src/engine/neighbours-worker.js` is its own
  esbuild entry, a same-origin hashed module (`/assets/neighbours-<hash>.js`, the
  pages' config `neighboursUrl`), started with `new Worker(url, { type: "module" })`.
  It loads wasmoon and the same Lua bundle and import shim as the page
  (`Engine.create` with `tune: null`: no `useTune`, no `setClient`) and sets
  `__kubbClock` to `performance.now`. Its messages are in
  `src/engine/neighbours-host.js`: `open`, `advance`, `view`, `close`, each answered
  once, in order, with the engine's own JSON text. The site's CSP needed nothing new:
  `worker-src 'self'` lets the module in, and under the same policy the worker
  compiles wasmoon by `'wasm-unsafe-eval'` and fetches the VM and the bundle from
  `'self'` (`tests/site/site.test.mjs` pins it).
- **When.** On entering a match, practice, replay or watch in the Tournament scene the
  Game (`sceneryTick`, gated by `neighboursWanted` in `src/game/neighbours.js`) opens
  `neighbours.open({ seed: <the match's seed>, scene: "tournament" })`: the ring of 8
  round the pitch (`layout: "grid"`) in every window and view. The engine's `"row"` is
  never asked for: with the thrower's camera it puts every neighbour outside the aim
  picture, so a phone on its side would show no tournament at all, and the wide view
  reads better across the grid's nearer side row too. A new match or a restored one
  with another seed opens it again. Leaving the scene or the match closes it and ends
  the worker. No worker is ever started for another scene,
  under a card (a card over an open field only stops its clock), with
  `prefers-reduced-motion` (the still `NEIGHBOURS` as before), or once the worker has
  failed.
- **The clock.** Once a frame the page posts the match clock (seconds since the field
  opened), stopped under a card, in a hidden tab (no frames, or the unattended timer's
  quiet ticks) and while a replay is paused, at real speed whatever the replay's speed.
  The worker answers with `neighbours.advance({ now, budgetMs: 2 })`'s events. The page
  never waits: one advance is in flight at a time (the clock keeps moving and the next
  ask carries it), a field not open within 20 s or an answer not back within 10 s ends
  the worker, and until the field is open, or after a failure, the still pitches are
  drawn.
- **The model** (`Field`): each pitch's items from the events; a `throw` plays its
  recording with `playRecording`, copied line for line from the engine's
  `tests/node/neighbours.test.mjs`, at `t = now - event.at`, its last poses kept as
  the items at its end (`tests/engine/neighbours.test.mjs` holds the page's model to
  `neighbours.view`). Team names are never drawn.
- **No people** (web 0.17.0; the owner, 2026-11-22: "Tournament mode should not have
  people. Just pitches with live play."). No thrower, no teams walking, no one at the
  kubbs, no cheer, and no one watching past the rope or beside the pitches, in every
  view, the still pitches, the options tile, the share card and the reel. Without a
  thrower the baton is seen only once it is in the air (the recording's thrown piece),
  and the pieces never pop: on `raise` each kubb raised stands up over **0.6 s**, **0.15
  s** after the one before, from where it lay, and on `setup` a fresh pitch's kubbs and
  king stand up where they will stand over **0.5 s**, **0.07 s** apart (`Field.shownAt`,
  `riseOf`; drawing only, `itemsAt` stays the engine's model). What stood behind the
  target went with the people: the scoreboards stand off to the sides past the far rope
  (x -4.9 and 8), and the canopy beyond the grid's far row moved from straight behind the
  pitch ahead (x 0, where its legs stood over the far kubbs at the top of an upright
  phone) into the gap between two columns of pitches (x 12, y 26).
- **Sounds** (web 0.17.0; "We should hear the sounds from the other pitches.";
  `src/game/neighbour-sound.js`, `Field.takeCues`, `Game.neighbourSounds`,
  `Sound.distant`). The game's own knock takes, cued on the match clock from each
  neighbour throw's recording, by its `hits` and `landing` (engine 0.16.0; web 0.19.0):
  each body struck knocks once, at its first contact's `t`; one that toppled at a share
  of the full knock by the hit's `strength` (0.35 + 0.65 x strength: a graze is quiet, a
  hard hit full; a king's half as loud again), one struck and left standing (a kubb, a
  stake) at 0.45 of that and at 1.05 the rate, a tap; the thrown piece's landing at
  `landing.t`, 0.55 as loud times its strength's share and played at 0.72 the rate, a
  thud; every neighbour knock at 0.9 the rate. Nothing is read from the poses (a body
  that toppled with no hit listed still knocks at its `toppleT`). Loudness by the distance d between the pitch origins: **0.22 at 8 m** (the
  pitch beside), falling as (8 / d)^1.5: 0.12 at 12 m (ahead), 0.09 at 14.4 m (the
  corners), 0.04 at 24 m (the far row), nothing under 0.02; the player's own knock is
  0.72, so the pitch beside is about 10 dB under it and a king there still under half of
  it. Left or right by where the pitch lies across the camera drawn (a stereo panner,
  at most 0.8 to a side; turned with the field in Team B's frame). At most **3** at
  once: a louder one replaces the faintest (faded in 20 ms), a fainter one is dropped. A
  cue that reaches the page more than 0.3 s late is dropped. Silent with the Sound off,
  in a hidden tab, under a card, while paused (the clock stops), under reduced motion
  (no field), in the embed (no sound), and for a quarter second either side of the
  player's own knock. Replays play sound, so their neighbours do too.
- **The frame.** Each pitch is drawn at its `offset`, in the frame of whatever the Game
  is drawing, decided in one place (`pitchFrameOf` in `src/game/neighbours.js`,
  `Game.pitchFrame`): the raise and punishment screens are the defender's frame
  (`need.side`) in every view, the engine giving their poses that way
  (`Session:raiseInfo`, `punishInfo`) and the wide view leaving a need as it is;
  otherwise the wide view is the world frame (session/wide.lua) and never turns; a throw
  being aimed or played back, with its hand-off, is its thrower's (`need.side`); between
  throws (the winner card over the pitch) it is the last throw's thrower's (the
  engine's `Session.frameSide`), which an adopted snapshot gives as its own `side`;
  practice is Team A's. Replays and watching go through the same function. In Team B's
  frame the whole field turns half about (0, 4): `(ox + x, oy + y)` is drawn at
  `(-(ox + x), 8 - (oy + y))`, axes turned with it (`fieldFor`).
  `tests/engine/pitch-frame.test.mjs` walks a match through both sides' throws and
  playbacks, raises, punishment kubbs, the end and a restored raise, in the thrower's
  view and the wide view, and checks the frame against the engine's own poses at each.
- **Far detail.** A live piece is its long axis drawn as a thick stroke in the wood's
  colour over a thin ink one, with the USA set's head on a kubb and the crown on the
  king (`posedPiece` in `src/render/tournament.js`): three strokes at most, no shadow,
  no faces, whatever way it lies or flies. A pitch whose middle is in front of the
  camera and wholly off the frame is not drawn. The engine's spacing stands (8 m across,
  12 m ahead).
- **Not here.** The reel renderer and its stills (`backend/reels/`) and the share cards
  keep the still neighbours: they build no worker, pass no `neighbours` and play no
  sound.
- **Where it shows.** The cameras look down at the player's pitch, so the field is
  mostly round the edges: the pitch ahead playing on behind the bunting at the top of
  the thrower's view (upright; on its side only once the camera follows a throw), the pitch beside it across the top of the wide view on a wide window, and all
  of it once a watcher zooms the free camera out. That is on purpose: they are a
  tournament going on round you, not a second thing to watch.
- **Costs** (headless Chromium, an M-class Mac, watching in the wide view): drawing the
  eight live pitches adds 0.05 to 0.2 ms a frame over none (the still pitches cost
  about half that), the free camera zoomed out to show them all included, at 1280x800
  and at 390x844, in the wide view and the thrower's; the
  worker's answers average about 95 bytes (one a frame: about 6 KB a second at 60
  frames), the largest about 4.5 KB (a throw's recording), and the opening is 12 KB.

## Ground impacts, the spin

Techno rings where a piece strikes the floor, Beach puffs sand and Minnesota sprays snow,
all from the engine's ground impacts (`setImpacts`, `timeline.impacts`), each started
when playback reaches its `t` and aged by the throw's own clock (slow motion included):
`src/render/impacts.js`. A ring grows to 0.22 m plus 0.17 m for each m/s the piece came
down at (0.95 m at most) over 0.75 s, in its side's light (the king's own, a baton's
cyan); none nearer the camera than 2.2 m. A puff is a small inked cloud, never more
than 11 CSS px a disc on the screen.

A piece that turns faster than the frames can show is drawn with four solid in-between
poses under its own, faded (`spinAmount` and `Stage.observe` in `src/render/scenes.js`,
`drawSpin` in `world.js`): from 30 degrees a frame about its long axis (a square section
repeats every quarter turn), fully at 50; end over end from 60 to 100.

## Adding a scene

1. A file in `src/render/` with `make<Name>({ reduced })` returning the look (`night.js`
   and `beach.js` are the models), its colours and skin in `palette.js`. The engine must
   list its id first (core/scenes).
2. Its id in `MAKERS`, `SCENES` and `SCENE_NAMES` (`src/render/scenes.js`), and its ground
   in `CARD_GROUNDS` (`src/site/art.mjs`).
3. The tests: it draws and differs from the day, its type is 7:1 or better on its
   paper and its accent plates (`tests/render/scene-day.test.mjs`), and the day pin
   still holds.
4. Reduced motion (below), and its frame cost against the day's.

No name, logo, typeface or likeness from a film, a game or a brand.

## Reduced motion

With `prefers-reduced-motion`, a scene keeps its look and drops what moves on its
own: the night's stars do not twinkle and the stardust has no trail, a little spin
dust and small, short puffs; the neon has no ribbon and no hit flash, and few
sparks; Techno's rings do not grow (a ring fades where it struck); no snow falls in
Minnesota and puffs only shrink where they struck. The glows stay, still. The reel is
drawn in full.

## Contrast

WCAG contrast of the type, 7:1 or better everywhere (pinned for each skin's tokens in
`tests/render/scene-day.test.mjs`). Beach, Minnesota and Tournament keep the day's
controls, so the day's numbers are theirs:

| scene               | ink on paper | muted on paper | type on an accent plate   | MENU, lowest pair on the page |
| ------------------- | ------------ | -------------- | ------------------------- | ----------------------------- |
| day (and the three) | 16.29        | 7.51           | 10.18 (marigold)          | 7.51                          |
| night               | 14.98        | 9.55           | 10.61 (`#9cc8ff`)         | 9.55                          |
| neon                | 18.42        | 10.51          | 14.97 (`#5ff0ff`)         | 10.18                         |
| bw                  | 21.00        | 21.00          | 21.00 (black, white type) | 21.00                         |

The focus ring is 3 px of `--ink` 2 px off every control: 21:1 on Black & White's white,
as the day's on its paper. On the pitch the Kid line's cones are orange (`#ff7a1f`) with
a white band and the ink line, white with black in Black & White.

## Frame cost

The mean gap between frames while a throw plays in practice, a busy field, Chrome
headless under a 4x CPU throttle (`build/scratch/timing.mjs`, not committed;
2026-11-20, ms):

| window               | day  | night before | night now    | neon         |
| -------------------- | ---- | ------------ | ------------ | ------------ |
| desktop 1280x768, 1x | 19.5 | 34.6 to 35.9 | 28.4 to 29.7 | 22.1 to 23.9 |
| phone 844x390, 2x    | 20.5 | 36.6         | 26.8 to 30.3 |              |

Nearly all the night's extra is its sky, redrawn every frame while a throw's
camera turns (with every hook but the sky drawn, the night is the day's cost
within a millisecond or two). Two changes keep its look:

- the sky is drawn only in the rows it can show, down to the clearing's lowest
  corner, and not at all when the camera looks at the ground (most reel shots);
- its gradient is drawn as solid bands one colour level apart, which a slow
  canvas fills far faster than a gradient and the eye cannot tell apart.

(The phone's 34 ms first measured was on a busy machine; on a quiet one the same
code is 27 to 30.)

What is left is the milky haze's 28 wide glows (about 6 ms on the phone) and the
moon's halo (2 to 3 ms); the stars and the twinklers are a millisecond each. Three
ways to draw the same picture for less were tried and dropped, as each cost more
than it saved on the phone:

- the soft part of the sky (gradient, haze, halo) at half resolution, stretched;
- the haze and the halo alone at half size, added on;
- the soft sky drawn once and slid as the camera turns (a throw's camera turns about
  2 degrees and zooms several percent a frame, so it was drawn again nearly every
  frame).

What is left would change the look: fewer haze glows, or no haze and halo while the
camera turns fast.
