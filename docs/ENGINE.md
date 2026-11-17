# The engine

The game on the web is kubb-engine (`jthingelstad/kubb-engine`, sibling checkout
`../kubb-engine`), vendored at a release tag in `vendor/engine/` and never edited: the
Playdate game's own Lua core (`core/`), the screenless session over it (`session/`, the
Playdate's match and throw scenes) and the tunes (`tune/`), running in wasmoon's Lua 5.4.
JavaScript reaches it through `src/engine/` with a few coarse calls a frame; every
argument and result crosses as JSON text. JavaScript draws, listens and talks to the
network; every rule, plan, swing, flight, ruling and camera is Lua.

The session's own reference is the engine's `docs/SESSION.md` (its calls, determinism,
tunables, tests) and `docs/VERSIONING.md` (what a version number promises). This file
is the web's side: how the site loads the engine and the `Engine` wrapper's calls. A
change to how the game plays is made in kubb-engine, released as a tag and vendored
here (`npm run vendor:sync -- --tag vX.Y.Z`).

Everything returned to JavaScript is in **the thrower's view frame** (`core/frame`): the
thrower stands at y = 0 on their own baseline, looking up the pitch toward +y (the far
baseline at y = 8), x to the right, z up, metres. JavaScript never flips the pitch. In a
match the frame is the throwing side's (the defending side's for raising and punishment).

## Files

| Path                       | What                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `vendor/engine/`           | kubb-engine at the tag in `vendor/engine.json`: `core/`, `session/`, `tune/`, `version.lua`, its `engine.json` manifest, `golden/`.    |
| `tools/vendor.mjs`         | `vendor:sync` reads a tag from the engine checkout's git objects; `vendor:check` holds every file and the bundle to the manifest.      |
| `tools/lua-bundle.mjs`     | Writes `build/lua-sources.json`: `{ "core/world": "<source>", "session/api": "<source>", ... }`, keys sorted: the engine's own bundle. |
| `src/engine/index.js`      | `Engine`: wasmoon, the `import` shim, typed wrappers over `kubbCall`. Browser and Node; no DOM.                                        |
| `tests/engine/`            | The bundle is the engine's, the start-up calls, the engine's golden corpus hash for hash under this wasmoon, and the kept fixtures.    |
| `tools/replay-fixture.mjs` | Writes `tests/fixtures/replay-north-south.json` again after an engine change that moves hashes.                                        |

Lua modules use the Playdate's `import "core/x"` convention and the `tw.*` namespace; in
wasmoon the shim in `src/engine/index.js` loads them from the sources map. `BOOT`
imports `session/api`, which defines the global `kubbCall(method, argJson) ->
resultJson`.

## Starting

```js
import { Engine } from "../engine/index.js";
const config = readConfig(); // src/site/config.js
const engine = await Engine.create({
  sources: config.luaUrl,
  wasmUrl: config.wasmUrl,
  client: clientLabel(config.version), // "web 0.1.0", src/net/sync.js
});
```

`sources` is the module map itself or a URL to fetch it from. `create` makes the
engine's start-up calls before anything else: `useTune { name = "pointer" }` (the
web's tune, `tune/pointer.lua`) and, when `client` is given, `setClient { label }` (the
game file's "Scored by", never in the hash). `engine.version` is the engine's version
(`engineVersion`), which records, reports and riders carry as `engine`. `wasmUrl` is wasmoon's
`glue.wasm`; Node finds it in `node_modules` when it is left out. Each `Engine` is its
own Lua state holding one session. A failed call throws `EngineError` with the Lua
message.

## The API

Every method below is `kubbCall(name, JSON.stringify(args))` behind a wrapper. Results
are plain objects. Angles are degrees unless named otherwise; times are seconds.

### Sessions

| Call                         | Returns           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `newPractice(opts)`          | view              | `{ surface: "grass" \| "sand" \| "snow", level, set, drill }`. The practice pitch (scenes/drills.lua's free throw); `drill: true` throws kubbs at the circle.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `newMatch(opts)`             | view              | `{ seed, teams, cpu, first, opening, raising, wind, surface, set, start, maxTurns, modeName }`. `teams: { A: { name, players: [{ name, level, key }] }, B: ... }`, 1 to 6 players a side (strings work as names). `cpu`: `"A"`, `"B"`, `"both"` or a list. `first: "A" \| "B"`. `opening: "2-4-6" \| "six"`. `raising: "hand" \| "auto"`. `wind: "off"` or a core/wind level (`"light"`, `"strong"`, ...). `start: { year, month, day, hour, min }`: the match clock's start (the game file's date; pass the host's local time). `maxTurns`: the side to throw at that turn resigns (tests, quick games). |
| `restore(snapshotText)`      | view              | A match from a snapshot. The restored session acts for every side and the computer until `setControl` says otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `snapshot()`                 | text              | The whole match as JSON text. Opaque: store and send it as it is, byte for byte. Matches only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `hash()`                     | `{ hash, bytes }` | FNV-1a 32 of the snapshot text (8 hex digits) and its length. Equal hashes mean equal matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `setControl({ sides, cpu })` | need              | Which sides this browser plays (`sides: ["A"]`, `[]` for a spectator) and whether it throws for the computer (`cpu`, default true). One browser in a room has `cpu: true`.                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Reading

| Call          | Returns                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view()`      | `{ need, items, minimap, aim, camera, dial, surface, set }`: everything the screen needs when nothing plays back.                                              |
| `frameView()` | The same view, in the thrower's view frame even while the wide view is on: what a report records (`src/net/report.js`), so its replay compares like with like. |
| `need()`      | What happens next (below).                                                                                                                                     |
| `aim()`       | `{ aim, camera }`.                                                                                                                                             |
| `recording()` | The last throw's recording (below), or `{}`.                                                                                                                   |

**need** is one of:

- `{ kind: "throw", side, setup, cpu, local, candidates?, wind, ... }`. `setup` is the
  throw (`kind`, `projectile` "baton" or "kubb", `n` of `of`, `label`, `kingShot`,
  `rethrow`, `lineY`, `forwardY`, `advY`, `targets`, `thrower { id, name, level, key }`;
  `key` is the lineup's key for that player, on a shared pitch the room member it
  belongs to).
  `cpu`: the computer throws. `local`: this browser acts for it. `candidates`: the team's
  players when a human team has more than one (for the `thrower` action). Practice:
  `{ kind: "throw", practice: true, drill, surface, level, set }`.
- `{ kind: "raise", side, kubb, pose, mode, choices, ends, default, others, king, n, of,
team, local }`: a kubb to raise by hand. `choices[i] = { which, pose, displaced,
crowded }`; `ends[i] = { which, pose, inBounds, obstructedBy, ok, why }` (`why`: "THAT
  END IS OUT" or "THAT END IS BLOCKED"); `default` is the index the computer would pick.
- `{ kind: "punish", side, kubb, cursor {x, y}, bounds {xMin, xMax, yMin, yMax}, keepOut
[{ kind, id, x, y, r }], others, n, of, team, local }`: a punishment kubb to place.
- `{ kind: "over", winner, how, file { text, name }, text, short }`: the match is over;
  `file` is the game file (match.file, `version` "web 0.1.0").

Every match need also carries `card` (informational: `{ kind: "settle" | "handoff" |
"pass", ... }`, the Playdate's cards; nothing waits on them), `turn`, `throws`, `teams`,
`standing`, `last { text, short }` (the last ruling) and `resignPending`.

**items** are the pieces as the renderer draws them: `{ id, kind, team, x, y, z, qw, qx,
qy, qz, toppled }`, kinds `kubb`, `king`, `baton`, `stake`. **camera** is core/camera's
table: position `px py pz`, unit `f*` forward, `r*` right and `u*` up, `lx ly lz` the
point looked at, focal length `f` with principal point `cx cy` for the Playdate's 400 x
240 screen (scale `f` by the canvas width over 400). **aim** is `{ marker { x, y, r, on,
set, kind, shown }, thrower { x, y, swivel, set }, plan { release, arcSet, tilt, spin,
level, speed, loft, swivel, dist, back, powerLo, powerHi, releaseLo, releaseHi }, arc
[{x, y, z}]?, projectile, drill, lineY, forwardY, advY, advText, halfWidth, backMax,
rail { name, kind, n, of, r1, r2 }, flag, restText, verdicts?, wind?, mix, watching }`.
**dial** is hud.clock's state: `{ phase, arm, crank, back, powerLo, powerHi, releaseLo,
releaseHi, deadDeg, overDeg, lastBack, lastStop, prompt }`. **minimap** is `{ pieces,
aim { x0, y0, x1, y1 }, advY, lineY, wind }`.

### Each frame

| Call           | Returns                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `frame(input)` | `{ dial, camera, aim, event?, action?, recording?, need? }`. `input = { dt, arm, plan, move: {dx, dy}, walk: {dx, dy} }`. |
| `showAt(t)`    | `{ t, done, speed, camera, items, burst, dial }`: the last throw at `t` seconds after the release.                        |

**The wide view** (docs/CLIENT.md "The wide view"): `setWide(box)` with a box `{ left,
top, right, bottom }` in frame px fits one fixed camera to it and returns `{ camera, kind,
farPx }` (`kind` "side" or "end"; `farPx` the smallest base kubb's height in frame px).
From then on every call's `camera` is that camera, and what a call gives in Team B's view
frame (items, aim, minimap, a recording's bursts) comes un-turned into the world frame,
with `wide` set to the kind. `setWide(null)` turns it off. The setting outlasts `new` and
`restore`.

`arm` is the pointer on the dial as **forward degrees from 6 o'clock** in (-180, 180]:
0 at the bottom, negative up the left side (the backswing: 7 o'clock is -30, 9 is -90,
12 is -180), positive up the right (the throw: 5 is +30, 3 is +90). Leave it out (or
null) while the pointer is not on the dial. `plan`: the plan view is held (the dial
does nothing, the camera eases to the overhead view). `move` and `walk`: the circle's
and the stance's keys, -1..1 per axis. `event` is `"letdown"` or `"release"`. On a
release that this browser acts for, `action` is the throw to send to the room,
`recording` is its recording, and `need` is what comes next (the throw has already been
applied here).

The optional `frame({ dt, touch: samples })` input carries the contact for the
pendulum. Each sample gives x and y in short-edge units and time in seconds.
Down and up carry `phase`, and cancel abandons the contact. The engine's
`docs/SESSION.md` specifies the sampling and tuning. A human throw action and
its recording carry the optional input tag for tuning.

### Aiming

All return `{ aim, camera }`, and do nothing unless this browser may aim now.

| Call                           | What                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `setTarget(x, y, snap)`        | The circle at (x, y); `snap` puts it on the nearest piece within `snapRadius`.                                       |
| `nudgeTarget(dx, dy)`          | The circle moved by (dx, dy) metres.                                                                                 |
| `setStance(x, y)`              | The thrower stands there (behind the line, inside the pitch). `setStance()` lets the stance follow the target again. |
| `stepArc(step)`, `setArc(deg)` | The release angle (the plan's arc).                                                                                  |
| `stepSide(step)`               | The baton's side spin step.                                                                                          |
| `freshPlan()`                  | Back to the plan's own release and arc.                                                                              |
| `setLevel(level)`              | The thrower's level (practice: the default level).                                                                   |

Practice also has `setDrill(on)`, `reset()` and `setSurface(name)`, which return a view.

### Actions (a match among browsers)

| Call                | Returns                                                 |
| ------------------- | ------------------------------------------------------- |
| `apply(action)`     | `{ ok, recording?, need, why?, label? }`                |
| `checkPunish(x, y)` | `{ ok, why, label }` without placing.                   |
| `aimState()`        | This browser's aim, to send while aiming.               |
| `showAim(state)`    | Someone else's aim shown here: `{ aim, camera, dial }`. |

The actions:

- `{ type: "throw", seq, how, launch, stance, target, scripted, swing?, verdicts?, at? }`:
  what `frame` returned. `seq` is the number of throws before it; a throw out of step is
  an error, never applied.
- `{ type: "raise", choice }`: the index into `need.choices` (leave it out for the
  computer's default).
- `{ type: "punish", x, y }`: the spot in the defender's view frame. Refused spots come
  back `{ ok: false, why, label }` (label e.g. "TOO NEAR THE KING") and change nothing.
- `{ type: "resign", side, at? }`: waits for that side's own turn (the rules allow it
  only then), as on the Playdate.
- `{ type: "thrower", id }`: who throws next for the side to throw (`need.candidates`).

`at` (optional) is the finish time stamp the game file uses.

## The frame (per-frame call pattern)

A browser makes one or two calls a frame:

1. **Aiming** (`need.kind == "throw"`): `frame({ dt, arm, plan, move, walk })` once a
   frame, and the aim calls (`setTarget`, `setStance`, ...) when input asks. Draw
   `view().items` (cache them; they change only after a throw), `out.aim`, `out.camera`
   and `out.dial`. When this browser plays the side, send `aimState()` to the room a few
   times a second; the others call `showAim(state)` when it arrives and keep calling
   `frame({ dt })` for their camera.
2. **The release**: `out.action` is set. Send it to the room, then play the recording.
3. **Playback**: `showAt(t)` once a frame with `t += dt * out.speed` (the returned
   `speed`: 1, slowing to the recording's `slow.rate` around the hit), until `done`.
   Draw `items`, `camera`, and the `burst` named ("clean", "king", ...). Skipping is
   `showAt(recording.duration)`.
4. **Then** `view()` and `need()` once, and back to 1, or to the raise or punishment
   screen, or the end.

A computer side runs through `frame({ dt })` as well: its aim shows for `cpuThink`, its
arm plays on the dial, and on release the browser with `cpu: true` gets the `action`.
Other browsers see the same think and arm and then hold at the release until the action
arrives.

Calls are cheap: `frame` is well under a millisecond; the release (the whole throw is
simulated to rest) is a few milliseconds natively.

### Example: a practice throw

```js
const engine = await Engine.create({ sources, wasmUrl });
let view = engine.newPractice({ surface: "grass" });
// each frame, while aiming:
const out = engine.frame({ dt, arm: pointerOnDial ? armDegrees : null });
draw(view.items, out.camera, out.aim, out.dial);
if (out.event === "release") {
  const rec = out.recording;
  let t = 0;
  // each frame, while playing back:
  const p = engine.showAt(t);
  draw(p.items, p.camera, null, p.dial, p.burst);
  t += dt * p.speed;
  // when p.done:
  view = engine.view(); // the flag, the verdicts, the circle on the next kubb
}
```

### Example: a match between two browsers

```js
// Browser 1 (hosts, plays A, throws for the computer)
a.newMatch({ seed: 42, cpu: "B", teams, start, raising: "hand" });
a.setControl({ sides: ["A"], cpu: true });
room.send({ type: "start", snapshot: a.snapshot() });

// Browser 2 (joins, a spectator here)
b.restore(msg.snapshot);
b.setControl({ sides: [], cpu: false });

// Browser 1, a frame of its own throw or the computer's:
const out = a.frame({ dt, arm });
if (out.action)
  room.send({ type: "action", action: out.action, hash: a.hash().hash });

// Browser 2, on that message:
const r = b.apply(msg.action); // the same recording, byte for byte
if (b.hash().hash !== msg.hash) resync(); // never happens unless a message was lost
play(r.recording);
```

Raising and punishment by hand work the same: the side's own browser sends `{ type:
"raise", choice }` or `{ type: "punish", x, y }`, everyone applies it. A late joiner
restores from any browser's current `snapshot()` and applies what follows; the tests
prove it stays in step.

## Determinism

Every browser runs the same wasm and the same Lua, so the same action on the same state
gives the same floats everywhere. What the session adds:

- **The action path is the remote path.** The actor's own throw is turned into JSON and
  back before it is applied (`json.decode(json.encode(action))` in `Session:frame`), so
  the actor and every other browser run exactly the same numbers. JSON numbers are read
  back with their kind: `F` makes floats, `I` integers (JavaScript writes 3.0 as 3).
- **No sequential random stream.** The Playdate's match keeps random generators that
  advance as the game goes; the web's every random draw is seeded from the match seed
  and a counter, so restoring needs no generator state:
  `mix(seed, purpose, n) = ((seed * 0x9E3779B1) ~ (purpose * 0x85EBCA6B) ~ (n *
0xC2B2AE35)) & 0x7fffffff`, fed to `core/autothrow.rng`. Purposes: 1 the computer's
  choice (n = throws so far), 2 the wind's turn (n = turn), 3 the gusts (n = throws).
  The computer chooses with `autothrow.choose(setup, rng, cpuScatter)`, with no level,
  as the Playdate's match does.
- **JSON is deterministic.** Sorted keys, integers as integers, floats as the shortest
  text that reads back to the same double (with `.0` when integral), so equal states
  give equal text and equal hashes.
- **The snapshot is the state before the throw is set up.** It holds `{ v, opts, save
(core/save.pack of the match), throws, finish, resignPending, side, lastThrower, mem
(the aim memory the set-up reads), settle }`; `restore` unpacks it and runs the same
  set-up (`advance`) again, so the restored throw is the very throw the others have.
  The aim memory is normalised (floats, booleans) as it is captured, so the acting
  browser and a restored one hold identical values. Cards are not in it; they are
  recomputed.

Native Lua and wasmoon are not mixed in one match: the desktop libm may round sin and
cos differently from the wasm's. The tests check each on its own.

Measured (cpu against cpu, 228 throws, 28 turns): snapshots average 8.4 KB, at most
13.2 KB. A baton throw's recording is about 12 KB of JSON (142 frames, 2 moving bodies);
a big knock is larger, since every moving body has 7 numbers a frame.

## The recording

What a throw did, for the renderer and for a replay:

```
{
  frameDt, frames, duration, poseScale, seq,
  projectile { id, kind, how },          // how: "baton" | "drill" | "lob"
  items   [{ id, kind, team, x, y, z, qw, qx, qy, qz, toppled }],   // the pitch at the release
  bodies  [{ id, kind, team, start, frames, poses, touchT, toppleT, thrown }],
  launch  { x, y, speed, loft, swivel, tilt, tumble, legal },
  landing { x, y, T },
  result  { flag, legal, down, toppled [ids], hit, distance, landX, landY,
            restCm, restText, restX, restY,
            verdicts { power, release, steady, side?, powerV, releaseV, sideV? }, back, stop,
            ruling { text, short } },     // ruling: matches
  timeline {
    firstContact { t, x, y, z, with }, firstHit { t, x, y, z, with },
    touches [{ id, kind, t }],
    bursts  [{ kind, id, start, anchor { x, y, z }, sure, takenBack, second? }],
    slow    { hit, from, full, to, rate },
  },
  marker { x, y, r }                       // a drill's circle
}
```

`bodies` holds every body that moved, from its first moving frame. `poses` is a flat
array of integers, 7 a frame (`x y z qw qx qy qz` times `poseScale`, 1e5): pose j is
frame `start + j`, at time `(start + j) * frameDt`. Before `start` a body is where
`items` has it; after its last pose it stays there. `showAt` does this interpolation and
the cameras for you; the raw track is for a renderer that wants it. `slow` is the
playback speed curve: full speed until `from`, `rate` from `hit` to `full`, back to full
speed by `to`. `bursts` are known in full at the release (see below), so `sure` is true
and `takenBack` false on the web; the fields stay so the format matches render/burst.

## Tunables

The web plays the engine's `pointer` tune (`vendor/engine/tune/pointer.lua`, each value
with its reason; the engine's `docs/SESSION.md` "Tunables"): a pointer instead of a
crank, 60 fps instead of the device's pace. Physics is the core's default, unchanged.

## Differences from the Playdate

- **The whole throw is known at the release.** The Playdate simulates the flight while
  it plays it, paced by the device; the web runs it to rest in the release call and
  plays the recording back in real time. So bursts are decided with the end known: a
  burst is shown only for a piece that ends toppled (never shown and then taken back),
  and a later king fall is a second burst.
- **Real-time playback.** `showAt(t)` is a pure function of shown time: the impact
  camera's slew toward the hit is integrated in fixed `slewDt` steps from the start, not
  frame by frame, so every browser shows the same picture at the same `t`, and seeking
  works.
- **Absolute pointer aim.** The dial takes the pointer's angle each frame instead of the
  crank's change; a press inside the dead zone arms at once (`pressArmDeg`); lifting the
  pointer while swinging forward releases; lifting it while winding lets the arm down.
  The circle and the stance can be placed directly (`setTarget`, `setStance`) as well as
  moved by keys.
- **Seeded draws instead of running generators** (see "Determinism").
- **Actions.** Every change to a match is an action any browser can apply; the Playdate
  has one player at one device.
- **Cards don't block.** The handoff, pass and settle cards are in `need.card` for the
  screen to show; no call waits on them.
- **The computer's think and swing** play the same, but a browser that does not throw
  for the computer holds at the release until the action arrives.

Not carried over: the Playdate's device pacing, frame telemetry and time budget; render
bursts' provisional states; the readout and trace overlays; the sheet viewer; saving to
the datastore and the persisted history (the web keeps its own); the how-to; the raise
screen's crank-tip camera and look-around (the web gets the poses and draws its own);
the sequential random generators.

## Tests

```sh
node --test tests/engine/
```

The session's own tests (aim, dial, matches, raising, snapshot and restore, the
multiplayer proof) and its golden corpus live in kubb-engine. Here `tests/engine` checks
that the shipped bundle is the engine's byte for byte, that `Engine.create` makes the
start-up calls, that the engine's golden corpus (`vendor/engine/golden`) comes out hash
for hash under this repository's wasmoon (pinned at exactly 1.16.0), and that the kept
replay fixture still plays to its hashes.
