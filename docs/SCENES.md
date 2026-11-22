# Scenes

A scene is how a match looks: the day (the pitch as it has always been drawn), the
night (a moonlit clearing under the stars, glowing lines and pieces, stardust) and
the neon (a black world on a grid of light, pieces edged in their team's light, a
ribbon behind the thrown piece). Night and Neon are our own designs.

## A scene is a look only

The match carries its scene as an id: the engine's `scene` match option (Kubb Engine
0.9: lowercase letters, digits and hyphens, at most 24, "day" when absent), shown as
`view.scene`. The engine keeps the id and never reads it. A scene never changes the
engine, the physics, a throw, a hash or what is recorded beyond that id: the same
throw goes the same way in every scene. Anything that would change how the game
plays is not a scene.

An id this client does not know is drawn as the day, so an older client can show a
newer client's match.

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
stage.observe(items, t); // a shown frame of it, at shown time t
stage.tick(dt); // between throws
stage.draw(ctx, view, camera, scene, time); // drawWorld in the scene
```

With the day, `stage.draw` is exactly `drawWorld`'s picture: a recording of four
pictures is pinned by hash (`tests/render/scene-day.test.mjs`), for no scene, the day
by name and any unknown id.

The share image of a pitch (`/og/`, `pitchCardImage` in `src/site/art.mjs`) is a
drawing from above of its own and stays the day's for now.

## Picking one: the Scene option

Scene is a match option on engine 0.9, the way Computer level is: one row, Scene,
shown as Park, Camping and Techno for the ids `day`, `night` and `neon` (`SCENE_NAMES`
and `SCENE_ROW` in `src/render/scenes.js`, the one table of shown names since the 1.0
design; the engine takes any id and lists none, so the labels are the web's; the stored
ids never change). The day (Park) is the default and is what every match before it was.
On the solo card the choice is three picture tiles drawn by the game; in the lobby and
practice's MENU each choice carries a small picture of its scene, and the pitch
behind the card or lobby shows the pick while it is chosen (`Game.showScene`), skin
and all.

- **Play the computer**: the solo card's Scene tiles, kept with the card's options
  (prefs `solo.scene`). The match starts with `scene` (`newMatch`), so its view, its
  recording and a share of it carry it.
- **Watch the computer**: the solo card's saved Scene.
- **Practice**: MENU, Scene, kept as `practiceScene`. The engine keeps a practice's
  scene from its start, so a change starts the practice again in it, on the same
  surface and throwing the same (`Game.practiceScene`).
- **A shared pitch**: the host's row in the lobby, written with `setOptions` into the
  room's `settings.scene` and read with `optionsOf`; everyone in the lobby sees the
  word and the skin, and the match is started with it (the engine's `matchOptions`).
  The host's pick is kept for their next pitch (`pitchOptions.scene`). The row is
  shown only when the next match's engine takes a scene (`takesScene`: `scene` is in
  its `OPTION_DEFAULTS`, 0.9 on): a pitch that will play on 0.8 or 0.7 shows no row,
  shows the day, and starts its match without one.
- **`?scene=night`** (`neon`, `day`) picks one for practice, solo and watch over the
  saved one (on the solo card it sets the row), for links and testing. It is never a
  shared pitch's: there the host's choice is.

End to end: a solo match's start names its scene, the renderer's share check
(`backend/reels/check.mjs`) replays it unchanged into the sealed room's document and
replay, and the reel of that replay is drawn in it (`tests/reel/scene.test.mjs`). A
pitch's replay and embed play its match's views, which carry it.

## What a scene is made of

`sceneOf(id)` makes a scene's look, an object of three parts:

- **The look**: data and hooks `drawWorld` calls (`src/render/world.js` says when).
  Data: `groundOf` (the ground's colours by surface), `setOf` (the pieces' wood),
  `light` (the sun's direction and shadow), `paint` (the pieces' ink, and
  `litOf(item)` for a piece's own light), `clearing` (the rough round the pitch).
  Hooks, each `(ctx, cam, kx, B, ...)`: `sky`, `rough`, `lightGround`, `lines`,
  `beforePieces`, `baton`, `afterPieces`. A hook left out is the day's.
- **The skin tokens** (`skin`): the colours of everything drawn over the pitch, for
  the canvas (`ui`, `hud`, `burst`, `aim`: `useSkin` in `src/render/palette.js`) and
  for the page (`css`: custom properties on the root, and `data-scene`). The accent
  plates (SLOW MOTION, GO buttons such as BACK TO THE PITCH, the status pill) take
  `--accent` and `--on-accent`. The team colours stay the same in every scene.
- **The effects** (`makeFx`, or `dust` for the stardust's numbers): an object with
  `clear`, `watch`, `observe`, `tick` and `draw`, fed by the throw being shown.
  Night has the stardust (`src/render/stardust.js`); neon wraps it as sparks and adds
  the ribbon (`NeonFx` in `src/render/neon.js`).

## Adding a scene

1. A file in `src/render/` with `make<Name>({ reduced })` returning the look (`night.js`
   and `neon.js` are the models), its colours and skin in `palette.js`.
2. Its id in `sceneOf` and `SCENES` (`src/render/scenes.js`).
3. The tests: it draws and differs from the day, its type is 7:1 or better on its
   paper and its accent plates (`tests/render/scene-day.test.mjs`), and the day pin
   still holds.
4. Reduced motion (below), and its frame cost against the day's.

No name, logo, typeface or likeness from a film, a game or a brand.

## Reduced motion

With `prefers-reduced-motion`, a scene keeps its look and drops what moves on its
own: the night's stars do not twinkle and the stardust has no trail, a little spin
dust and small, short puffs; the neon has no ribbon and no hit flash, and few
sparks. The glows stay, still. The reel is drawn in full.

## Contrast

WCAG contrast of the type, 7:1 or better everywhere (pinned for each skin's tokens in
`tests/render/scene-day.test.mjs`):

| scene | ink on paper | muted on paper | type on an accent plate | MENU, lowest pair on the page |
| ----- | ------------ | -------------- | ----------------------- | ----------------------------- |
| day   | 16.29        | 7.51           | 10.18 (marigold)        | 7.51                          |
| night | 14.98        | 9.55           | 10.61 (`#9cc8ff`)       | 9.55                          |
| neon  | 18.42        | 10.51          | 14.97 (`#5ff0ff`)       | 10.18                         |

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
