# The canvas renderer

`src/render/` draws Kubb: Throwing Wood on a 2D canvas in the look DESIGN calls **Woodcut in
color**: the Playdate game's ink outlines, hard ink shadows, a darker face away from the light,
Londrina Solid Black and the TOK! / KLAK KLAK! / KING! bursts, with flat colour where the
Playdate had white and its 50% checker. Everything is vectors drawn each frame, so it is crisp
at any size and device pixel ratio. JavaScript only draws: the cameras, poses and dial numbers
come from the Lua core, in the thrower's view frame (JS never flips the pitch).

## Modules

| File         | What it exports                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `camera.js`  | The core camera in JS: `frameScale`, `frameBounds`, `project`, `projectView`, `unproject`, `unprojectView`, `projectPoly`, `projectSegment`, `toView`, `depth`, `NEAR`. |
| `world.js`   | `drawWorld(ctx, view, camera, scene)`, plus `solid`, `frontOf`, `depthOrder`, `SIZES` and `tune`.                                                                       |
| `dial.js`    | `drawDial(ctx, rect, st)` and the input geometry `dialGeometry`, `armPoint`, `armAt`, `hitTest`, `unwrapArm`.                                                           |
| `minimap.js` | `drawMinimap(ctx, rect, st)`, `minimapGeometry`, `toMap`.                                                                                                               |
| `burst.js`   | `drawBurst(ctx, x, y, kind, phaseTime, opts)`, `burstLength`, `BURSTS`, `tune`.                                                                                         |
| `palette.js` | Every colour and both type stacks.                                                                                                                                      |

### camera.js

A camera is the table `camera.new()` makes in Lua: `{ px, py, pz, fx, fy, fz, rx, ry, rz, ux,
uy, uz, f, cx, cy, lx, ly, lz }`. The session sends it as JSON each frame; nothing in JS moves a
camera. `project(c, x, y, z)` returns `[sx, sy, d]` in the Playdate's 400 x 240 frame, or `null`
behind the near plane (`NEAR` = 0.05 m), exactly as `camera.project` does (the tests hold it to
1e-6). `projectPoly` and `projectSegment` clip at the near plane first, as the Lua does.
`unproject(c, sx, sy)` is the ground point (z = 0) under a frame pixel; `unprojectView` takes a
CSS-pixel pointer.

**The scale rule.** The frame is shown scaled by `k = min(W / 400, H / 240)` and centred:
view px = `ox + k * frame px`, with `ox = (W - 400k) / 2`, `oy = (H - 240k) / 2`
(`frameScale`). A canvas of another shape shows more of the same world round the frame, never
bars and never a stretch:

- **Landscape at 5:3** (1280 x 768): k = 3.2, the frame fills the canvas exactly.
- **Wider** (a 21:9 monitor, 2560 x 1080): k = 4.5 by height; the frame sits in the middle
  1800 px and the world carries on 380 px to each side, so more pitch and rough show at the
  edges. `frameBounds` gives the frame coordinates the canvas reaches (here -84..484 across).
- **Portrait** (a phone, 390 x 844): k = 0.975 by width; the frame is a 234 px band in the
  middle and sky shows above it, the near pitch below, where the dial and minimap sit. The pieces
  are small, as on a Playdate held at arm's length; the impact and plan cameras are the ones
  that read best there. The game client does not leave a tall canvas there: it passes its own
  mapping (below).

**view.fit.** A view may carry `fit: { k, ox, oy }`, a mapping chosen by the caller in place of
the scale rule (`viewFit(view)` returns it, or the rule's when there is none). The game client
uses it on tall canvases to zoom in and pan (docs/CLIENT.md "Framing"). `projectView`,
`unprojectView`, `drawWorld` and `frameBounds(width, height, fit)` all read the same mapping, so
a pointer always un-projects through what is drawn.

### drawWorld(ctx, view, camera, scene)

`view` is `{ width, height, dpr, fit? }` (CSS px and the device pixel ratio; the canvas backing store
is `width * dpr` by `height * dpr`). `drawWorld` sets its own transform inside save/restore, so
the caller's transform does not matter and is left alone. It is a pure function of its inputs;
its only module state is a cache of the rough's texture points per surface.

`scene`:

| Field        | What                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `surface`    | `'grass'`, `'sand'` or `'snow'`.                                                                                                                                                                       |
| `set`        | `'classic'`, `'usa'`, `'sweden'`, `'minnesota'` or `'wisconsin'`.                                                                                                                                      |
| `items`      | `world.bodies` as the session sends them: `{ id, kind, x, y, z, qw, qx, qy, qz, toppled, team }`, `kind` one of `kubb`, `king`, `baton`, `stake`. When no stakes are given, the pitch's six are drawn. |
| `advantageY` | The advantage line's y, or null.                                                                                                                                                                       |
| `marker`     | `{ x, y, r }`: the target circle and its cross.                                                                                                                                                        |
| `arc`        | `[[x, y, z], ...]`: the planned throw, drawn dashed in the air (stopping `tune.arcStopShort`, 0.45 m, short of where it lands, so it never covers the kubb it aims at) with its trace on the ground.   |
| `thrower`    | `{ x, y }`: the thrower's ring and arrow.                                                                                                                                                              |
| `keepOut`    | `[{ x, y, r }]`: circles a punishment kubb may not land in.                                                                                                                                            |
| `footprints` | `[{ x, y, angle, allowed, chosen }]`: where a raised kubb would stand.                                                                                                                                 |

Back to front it draws: sky with a haze band at the horizon; the rough with its texture (grass
tufts, sand and snow dashes); the pitch with mown stripes; the lines as true-width quads with a
minimum of 2 frame px; the dashed centre and advantage lines; the marks on the ground; every hard
shadow in one ink fill (the light is the Playdate's: shadows fall `0.55` m right and `0.30` m
toward the thrower per metre of height; stakes cast none, as on the Playdate); the pieces in
depth order; the planned arc.

**Pieces.** A kubb or stake is a box with a lit top, lit sides and the side away from the light
darker (a face whose normal points within 70 degrees of away from the light). The detail grows
with a piece's height on screen (CSS px, `tune`): grain from 26 px, end-grain rings from 34, a
set's emblems from 34, the king's ring and diamond from 40, bevelled edges from 46. Every piece
has thin inner edges and a bold silhouette (1 to 3.4 px by size). A team's kubbs carry a ring
of the team colour at the foot. The king has two V cuts in each side making the crown's points,
an ink collar, and in a painted set its crown painted and the set's emblem. A baton is a
cylinder with two bands, its end grain on the end you can see.

**Depth order.** Pieces are sorted by centre depth, then every pair whose screen boxes overlap is
ordered by `frontOf`: the separating axis that parts the two boxes most (for pieces in contact,
the one that overlaps least) and the camera's side of the plane between them. A topological
sort applies the pairs; a cycle, which non-interpenetrating boxes cannot make, falls back to
depth. This gets a kubb lying against a standing one, a baton across a kubb and a pile of debris
right where centre depth alone does not.

### drawDial(ctx, rect, st)

Draws in `rect` (CSS px in the ctx's current transform; the caller applies the dpr) and returns
the geometry `{ cx, cy, r }`. Arm angles are the crank's: 0 at six o'clock, the backswing
negative up the left (-90 at nine), the forward swing positive up the right, +-180 at twelve.
`st` is the session's dial state: `phase` (`idle`, `winding`, `swinging`, `cooldown`), `arm`,
`crank`, `back`, `powerLo`/`powerHi` (backswing degrees), `releaseLo`/`releaseHi`, `deadDeg`
(the dead slice from six o'clock), `overDeg` (past it is overpowered), `lastBack`/`lastStop`
(the last throw, as hollow dots), `prompt` (`WIND BACK`, `FLICK!`, `EASE OFF`, `CRANK DOWN`,
`WATCH`; one ending in `!` is paper on ink) and `grabbed`.

Input: `dialGeometry(rect)` is the same circle `drawDial` uses; `hitTest` says whether a press
grabs it (within 1.25 radii); `armAt` turns a pointer into arm degrees; `unwrapArm(prev, raw)`
keeps the arm continuous through twelve o'clock, so a backswing can pass -180.

### drawMinimap(ctx, rect, st)

The pitch from above in the view frame, far baseline at the top, on a plaque with an ink frame
and a hard shadow. `st`: `items`, `thrower`, `aim` (the plan's landing, the line clipped to the
plaque), `marker`, `advantageY`, `wind` (`{ x, y, text }`, m/s in the view frame; an arrow
across the middle and the text on an ink plate above), `baton`, `land` and `surface`. Standing
kubbs are squares in their team's colour, the king a paper square with a crown, toppled pieces
hollow, lying batons short strokes.

### drawBurst(ctx, x, y, kind, phaseTime, opts)

`kind` is `clean` (TOK!), `double` (KLAK, then KLAK! three frames later, up and to its right) or
`king` (KING! wearing a crown). `(x, y)` is the hit in CSS px; the star sits up and to the left
with its long spike's tip on the hit. Three phases, at the Playdate's timings: the flash (2
frames at 30 fps: a pale disc with ink rays; the king's flash also inverts the whole canvas),
the burst (12 frames: the star pops in over 60 ms, the word upright Londrina Solid Black, white
in an ink edge) and the break-up (4 frames: chips of wood and ink fly out and fall).
`opts.size` is the star's width (default 150 px). It returns false once the burst is over.

## Palette

All in `palette.js`; the rest of the client takes its colours from there too.

| Role                                     | Colour                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Ink (outlines, shadows, the type's edge) | `#17140f`, a warm near-black                                                                         |
| Paper (plates, the dial's face)          | `#fbf6ea`                                                                                            |
| Team A                                   | marigold `#f2b705` (deep `#b98500`)                                                                  |
| Team B                                   | violet `#8e44ad` (deep `#5e2777`)                                                                    |
| Grass                                    | pitch `#5fa43c`, stripe `#6bb146`, rough `#3f7a2a`, sky `#d8ecf2`                                    |
| Sand                                     | pitch `#e8cf98`, stripe `#efd8a6`, rough `#d2b277`, sky `#f3e6cf`                                    |
| Snow                                     | pitch `#eef3f8`, stripe `#f7fafd`, rough `#d3dfec`, sky `#c9d9ea`                                    |
| Lines                                    | white `#ffffff`; on snow blue `#4f86c6`, since white vanishes there                                  |
| Wood (birch)                             | top `#f6e4bf`, lit side `#ecd2a0`, shade `#b88a4f`, end `#e2bf86`, grain `#c79d63`                   |
| Stakes                                   | `#c9a06a` / `#8a6234`, older and darker than the pieces                                              |
| Baton bands, king's marks                | `#6b4a2b`, `#2a2118`                                                                                 |
| Dial                                     | power target `#ff7a3d`, release target `#33b6e8`, overpowered `#e5484d`, dead slice `#c9bfa9` dotted |
| Bursts                                   | star ink with a `#ffd23f` inside, the word white, the flash `#fff6c8`                                |

The team accents are not the sites' colours (`#1a5eb6`, `#b3123f`, `#b5461a`, `#1d7348`).
Marigold against violet is a yellow-against-purple pair, which stays apart for the common forms
of colour blindness and reads on all three grounds. The painted sets paint only a kubb's head
and the king's crown, the bodies stay bare wood: USA (navy head with white stars, two red
bands), Sweden (blue with a yellow cross band), Minnesota (deep blue with a light wave and a
north star on the king), Wisconsin (cheese yellow over a red band). Type is Londrina Solid
Black for bursts and prompts and Inter for labels, never italic.

## The gallery, fixtures and screenshots

- `dev/fixtures/generate.mjs` plays real matches with `vendor/core` under wasmoon and writes
  the fixtures in `dev/fixtures/` (cameras, items, plans and dial numbers as the core made them):
  `node dev/fixtures/generate.mjs`, about 3 seconds.
- `dev/render.html`, served from the repository root, draws every fixture plus the dial in each
  phase, the minimap with wind, and each burst in each phase. `?only=<name>` draws one picture
  over the whole window (the dial lower right in landscape, lower centre in portrait; the
  minimap lower left); `?bench` measures draw times.
- `node tools/render-shots.mjs [name ...]` serves the repository on 127.0.0.1 at a free port,
  saves every picture at 1280 x 768 (dpr 2) and 390 x 844 (dpr 3) and the gallery page to
  `build/render-shots/`, prints the bench, and stops the server and browser.
- `node --test tests/render/` checks the camera against the Lua, the dial's angle helpers and
  the depth order.

## Draw times

Measured by `?bench` in Playwright's Chromium (headless, Apple silicon), 1280 x 768 CSS px at
dpr 2 (a 2560 x 1536 backing store), 40 pieces plus the 6 stakes (the field-impact turn padded
with lying kubbs and batons), 200 draws each:

| Camera                    | `drawWorld` mean | median  | p95     | with a pixel read back each draw |
| ------------------------- | ---------------- | ------- | ------- | -------------------------------- |
| First person (field turn) | 0.27 ms          | 0.30 ms | 0.40 ms | 4.2 ms                           |
| Impact                    | 0.23 ms          | 0.20 ms | 0.30 ms | 4.4 ms                           |

The plain times are the JavaScript and command recording; the read-back column forces the GPU
to finish each frame and so is the honest upper bound, a quarter of a 60 fps frame. Redrawn
every `requestAnimationFrame`, the impact view runs at 60.0 fps (16.67 ms a frame). A real phone
will be slower; the budget leaves room.

## Left out

- **A flash on the struck piece itself**: the burst carries the hit.
- **Motion blur or speed lines** on a baton in flight.
- **Sky and rough detail beyond the horizon** (no trees or fence): the rough's texture is
  placed on the ground plane, thinning toward the horizon, and the sky is flat with a haze
  band.
- **Dust or snow puffs** where pieces land.
- **The raising view's ghost kubb** standing in the chosen footprint: the footprints are drawn,
  the ghost is not.
- **Text on the pitch** (player names, the score): that is the HUD's, outside the renderer.
