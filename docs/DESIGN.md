# Kubb: Throwing Wood on the web: design

The Playdate game (`playdate-kubb`, private) brought to the browser at
https://kubb.thingelstad.xyz, with one thing the Playdate cannot do: friends on one
pitch, each in their own browser. Written 2026-11-15, before any code. Decisions marked
(Jamie) were Jamie's on 2026-11-15; the rest are the builder's.

Read the Playdate game's `docs/DESIGN.md` first (sibling checkout
`../playdate-kubb/`): dimensions, camera, the clock throw, physics, rules, notation.
This document only says what is different on the web.

## 1. What it is

- **A pitch is a link** (Jamie). The web game's page (`/web/`; `/` was the web game's
  home until 2026-11-20 and is now the landing page for the whole game) starts a pitch at a random link
  (`/p/<code>`). Whoever opens the link arrives on the same pitch, in a lobby, types a
  name and picks Team A or Team B, up to six a side (Jamie). The host starts the match.
  An empty side is played by the computer.
- **Three ways to play** (Jamie): the multiplayer match on a link, a solo match against
  the computer (a pitch with the computer on the other side: the same code path), and an
  open practice pitch (batons and drilling, no rules). The Playdate's scored drills,
  saved players and games list wait.
- **Same game.** Geometry, physics, rules, throw plan, throwing order, computer thrower,
  drilling, wind, surfaces and notation are the Playdate game's own Lua, unchanged.
- **Woodcut in color** (Jamie): the Playdate game's look (bold black outlines, hard
  shadows, Londrina display type, TOK! / KLAK! bursts) with flat color.
- **Live and listed** (Jamie): deployed at kubb.thingelstad.xyz and listed on
  thingelstad.xyz and the Playdate games site.

## 2. Reuse: the core runs unchanged

The game is kubb-engine (`jthingelstad/kubb-engine`, the sibling checkout
`../kubb-engine`): the Playdate game's pure Lua core, the session over it, and the tunes.
`vendor/engine/` is one tagged release of it, byte for byte (`npm run vendor:sync -- --tag
vX.Y.Z` reads the tag from the engine's git objects; `npm run vendor:check` holds every
file and the bundle to the engine's `engine.json`; `vendor/engine.json` pins the tag and
commit). Never edit it. Older minors the site still plays back sit beside it in
`vendor/engines/<major.minor>/` (`docs/ENGINES.md`). It is pure Lua 5.4 and runs in the browser in WebAssembly
(wasmoon 1.16.0, MIT: the reference Lua 5.4 VM compiled to wasm, pinned exactly: it is
the engine's reference platform). Measured 2026-11-15 under Node: whole physics matches,
about 5 ms a throw.

Why not port to JavaScript: a port drifts from the Playdate game the day it is written,
and every fix there would have to be made twice. Why it also matters for multiplayer:
WebAssembly arithmetic is the same in every browser, so the same launch on the same pitch
is the same throw on every screen.

Tuning for the web is the engine's `pointer` tune (`tune/pointer.lua`), chosen at
start-up with `useTune`; the core's defaults were tuned for a crank and a slow device.
A change to how the game plays is made in kubb-engine, released as a tag and vendored.

## 3. Layers

```
vendor/engine/   kubb-engine at a tag (never edited): core/, session/ (match + throw
                 scene logic without a screen, JSON in and out), tune/, golden/
src/engine/      loads wasmoon and the engine's bundle; a small typed JS API over the
                 session
src/render/      canvas renderer: the pitch and pieces through the core's camera, in color
src/game/        the client: frame loop, input (the dial, the pitch, keys, touch), HUD,
                 playback, sound, bursts
src/net/         the room client (WebSocket), and how a match is shared
src/ui/          home, lobby, cards (hand-off, winner), options, how to throw
backend/rooms/   the room server (one Lambda behind an API Gateway WebSocket API)
infra/           CloudFormation: site (S3, CloudFront, certificate, DNS), rooms, delivery
tools/           build, preview, local room server, vendor, deploy
```

Rules that keep it honest:

- Game logic lives in Lua, in kubb-engine, wherever the Playdate game has it in Lua, so it
  is tested there without a browser. JavaScript draws, listens
  and talks to the network.
- JS and Lua talk in coarse calls with JSON strings (a few a frame at most), never
  per-vertex or per-body calls.
- Everything Lua gives JS is in the **thrower's view frame** (core/frame): the throw is
  always from y = 0 toward +y, Team B's pitch turned 180 degrees. JS never flips anything.

## 4. Contracts between the layers

### 4.1 Camera and the picture (renderer contract, fixed)

The core's cameras work in a 400 x 240 frame (the Playdate's): a camera is the table of
`core/camera.lua` `camera.new()`:
`{ px, py, pz, fx, fy, fz, rx, ry, rz, ux, uy, uz, f, cx, cy, lx, ly, lz }`, and
`camera.project` is the projection. The web keeps those numbers and scales the picture:
the canvas shows the 400 x 240 frame scaled by `k = min(W / 400, H / 240)` and centred;
the area outside that frame (a wider or taller canvas) shows more of the same world, never
bars. So framing rules proven on the Playdate (a far base kubb at least 12 px tall, now
times `k`) hold on any screen.

The renderer is a pure function of what it is given:

```js
drawWorld(ctx, view, camera, scene);
// view   { width, height, dpr }            canvas size in CSS px
// camera the core camera table above
// scene  {
//   surface: 'grass' | 'sand' | 'snow',
//   set: 'classic' | 'usa' | 'sweden' | 'minnesota' | 'wisconsin',
//   items: [ { id, kind: 'kubb' | 'king' | 'baton' | 'stake',
//              x, y, z, qw, qx, qy, qz,     // centre and orientation, metres; local z is the long axis
//              team?: 'A' | 'B' } ],        // whose kubb (colour accent), when known
//   advantageY: number | null,              // the advantage line
//   marker: { x, y, r } | null,             // the target circle on the ground
//   arc: [ [x, y, z], ... ] | null,         // the planned throw, dashed
//   thrower: { x, y } | null,               // where the thrower stands
//   footprints: [ { x, y, angle, chosen, allowed } ] | null,   // raising view
//   keepOut: [ { x, y, r } ] | null,        // punishment view
// }
```

Piece sizes are the Playdate DESIGN section 2 (kubb 0.07 x 0.07 x 0.15, king
0.09 x 0.09 x 0.30, baton 0.30 long and 0.044 across, stake 0.019 x 0.15); the pitch is
x -2.5..2.5, y 0..8, centerline y = 4.

### 4.2 The session (engine contract, owned by the engine work)

The engine's `session/` is the Playdate's `scenes/match.lua` and `scenes/throw.lua` with
the screen taken out: the same aim (target circle, stance, plan: arc, tilt, spin), the
same plan solve, the same swing (`core/swing` fed a crank angle stream), the same launch
(`core/throwplan`), the same world run to rest, the same rules (`core/match`). It also
makes what the Playdate's scenes compute for the screen: the clock dial's state, the
cameras (first person, plan view, follow, impact, the half circle), the verdicts, the
burst pick, the knocks' times, the result flag. Its exact calls are written down in
`docs/ENGINE.md` and the engine's `docs/SESSION.md`; the client is built against that file.

A throw is computed whole at release (it takes milliseconds) and returned as a
recording: poses of every body that moved at a fixed rate, plus the events on the
timeline (first hit, each piece's first touch for the knocks, the burst). JS plays the
recording back; the session supplies the camera for any shown time.

### 4.3 A shared match (multiplayer contract)

- **The thrower's browser decides.** A match is the core's own saved match
  (`core/save`: the engine game, sheet, order, debris), as JSON: the **snapshot**. The
  browser that acts (throws, raises, places a punishment kubb, resigns) applies the
  action to its own session and commits the new snapshot to the room with the version it
  was based on. The room keeps the latest snapshot; everyone else adopts it. Friends on a
  link trust each other; the server does not referee Kubb.
- **Everyone watches the same throw.** With the commit the actor sends the action itself
  (for a throw: the launch as the session made it). Every other browser replays that
  launch on its own copy of the pitch, which gives the identical recording (section 2),
  plays it back, and then adopts the committed snapshot. A browser that arrives late or
  loses its place just takes the snapshot.
- **Being there.** While someone aims, their browser sends their aim a few times a
  second (target circle, stance, plan, the arm on the dial), and everyone else sees the
  pitch through the thrower's camera with the circle moving and the arm winding: the
  Playdate's WATCH, with a person on the other end. Reactions (a few words to shout:
  NICE!, OOH!, TOK!) go the same way.
- **Who acts.** Each engine player belongs to a member of the room. The next throw is
  for the member whose player `core/order` names; if that member is not connected, any
  connected member of that team may take it (it is still that player's throw on the
  sheet), and failing that the host. The defending team's raise or punishment kubb is for
  any connected member of that team, else the host. The computer's side is run by the
  host's browser.
- **The room server is small and knows no Kubb**: who is in the room and connected, a
  few fields each member sets about themselves (name, team), one shared document with a
  version (compare and set), and relaying short-lived messages (aim, reactions, the
  action being watched). The lobby (teams, options, started or not) and the match
  snapshot both live in the shared document. Rooms expire.

The wire protocol is written down in `docs/ROOMS.md` by the rooms work.

## 5. The throw without a crank

The Playdate's crank is an arm on a clock: 6 is the arm hanging down, the backswing goes
up the left side, the forward swing up the right; how far back is the power, where the
arm stops is the arc, the flick's speed delivers the power, its steadiness keeps it
straight. On the web the **dial is the control**:

- The dial sits large at the lower right (lower centre on a phone), with the same face:
  power target on the back side, release target on the forward side, dead zone,
  overpowered slice, the last throw's ghosts (a faded arm where it went), the prompt (WIND BACK, FLICK!, EASE OFF).
- **Press on the dial and drag around it.** The pointer's angle about the dial's centre
  is the arm. Drag from the bottom up the left side to wind back; the arm follows your
  finger or mouse. Then swing down through the bottom and up the right side, and **let
  go** where the throw should leave: releasing the button or lifting the finger is the
  release, like letting go of a baton. Holding the arm still at the end also releases, as
  the crank's stop does.
- The pointer's motion is turned into the same crank stream `core/swing` reads (degrees
  a frame), so the wind-up, the flick speed, the steadiness, the let-down (bring it back
  to 6 slowly and nothing is thrown) and the sky ball are the core's, not a copy.
- A mouse is faster and steadier than a crank, so the swing's speed and shake tunables
  get web values, fitted by play; the throw levels (Beginner, Club, Pro) stay the
  Playdate's and set how wide the targets are.
- **Aiming is direct**: drag the target circle on the pitch (or arrow keys); drag the
  thrower along the line (or A/D and W/S); the plan is two sliders beside
  the dial, ARC (continuous) and TILT or SPIN (the engine's steps), and keys; a SIDE VIEW
  toggle takes the camera out over the shoulder as B does on the Playdate, and a drag of
  either slider shows it while it lasts (Jamie, 2026-11-19: "I'd like to make arc and tilt
  less buttons and more a slider with continuous movement. "Plan View" is also a super
  weird label."; docs/CLIENT.md "The plan's sliders"). Point and throw still works: touch nothing but the dial and the
  defaults are a sensible throw.

On touchscreens the optional `?throw=swipe` prototype uses a pendulum in the
lower half of the screen. Pull down to wind, flick up, then lift. The same dial
shows the arm. The default throw and mouse input remain the circular dial.

## 6. Look

Woodcut in color. Black ink outlines and hard black shadows stay; the 1-bit checker grey
becomes color: a green pitch with a darker rough (sand and snow each their own ground),
pale wood pieces with a darker face away from the light, white 2 px (scaled) lines, the
king's crown, painted kubb sets in their real colors. Type is Londrina Solid Black
(display) and Inter (labels), from the shared tokens. No italics on sans-serif type.
Bursts (TOK!, KLAK KLAK!, KING!) and the recorded knocks carry over.

## 7. Hosting

- Static site on S3 behind CloudFront with the shared `edge` web ACL, certificate and DNS
  records in the site's own stack (the `throwingwood.com` zone since 2026-11-17; the old
  kubb.thingelstad.xyz in the `thingelstad.xyz` zone redirects there), like
  `playdate.thingelstad.xyz`. Access logs IP-free, kept 731 days.
- Rooms: one API Gateway WebSocket API, one Lambda, one DynamoDB table (on demand, TTL).
  Throttled and capped (members a room, message size, document size) so it stays a hobby
  backend. No accounts, no personal data beyond the name a player types for the match.
  Every match is recorded to a private bucket, names included, to test the game against
  real play (`docs/ROOMS.md` section 7).
- Merging to `main` deploys. Tinylytics on the production hostname only.

## 8. Not in the first version

Scored practice drills, saved players and their histories, the saved games list, kubb
set detail beyond the painted heads, the Playdate's HOW TO PLAY cards as an interactive
walkthrough (a short how-to-throw overlay and a rules page stand in), spectators as a
separate role (anyone on the link can sit out by not picking a team), ice.
