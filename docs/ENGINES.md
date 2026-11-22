# Engines the site carries

A match belongs to the engine it was started on: its `match.engine` major.minor, for its
whole life (the engine's `docs/VERSIONING.md`). A new minor can change how a throw goes,
so a match from an older minor only plays back as it was played on that minor's engine.
The web is the client that carries more than one (Jamie: "it feels like the web version
needs to support a wide variety ... the iPhone, if it were running an older version than
what web runs, could just request the match out of certain version."). The iPhone app
carries one engine; the site carries the newest and the older minors it still plays
back. Today that is 0.13 (the newest, 0.13.1), 0.9 (0.9.0), 0.8 (0.8.2) and 0.7 (0.7.4):
0.8.0 changed short batons under 2 m, so a 0.7 match plays differently on 0.8; 0.9.0 made
the sliders take any value, keeps a kubb's spin for the turn and lets the computer throw
at a kubb a step away, so a 0.8 match plays differently on 0.9; and 0.10 to 0.13 each
changed what a seeded match does (the arc by distance, the kubb's dead landing and roll,
raising by side, one meter for every person with the bars by distance), so a 0.9 match
plays differently on 0.13. No client shipped 0.10 to 0.12, so none is carried. The
iPhone app on 0.9 carries 0.9, 0.8 and 0.7, so a pitch with it plays 0.9; an older
tester's build carries 0.8 and 0.7, so a pitch with it plays 0.8.

Engine 0.13 renamed the shared pitch's directory `room/` to `pitch/` (its calls are
`pitch.<name>`, and `room.<name>` stays as their old spelling). `tools/lua-bundle.mjs`
(`DIRS`) and `tools/vendor.mjs` (`ENGINE_DIRS`) list both and skip a directory an engine
does not have, so 0.13's bundle has `pitch/lobby` and the rest and 0.7 to 0.9 keep
`room/lobby`. The bridge (`roomCall` in `src/net/room-engine.js`) still says `room.`,
which 0.13 answers and the carried engines are the only spelling of; it moves to `pitch.`
once 0.7 to 0.9 are dropped, or per engine before then.

The version label a player sees names only the newest: `0.10.0 (0.13.1)`, with "Also
plays 0.9.0, 0.8.2 and 0.7.4" where detail is shown (docs/CLIENT.md "Version and freshness"). A match names its
own engine, never the app's version.

## The rule

- One engine per major.minor. A patch replaces its minor's engine; a new minor is a new
  engine beside the others.
- Practice, a solo match and watch always play on the newest. A shared pitch plays its
  next match on the room's engine: the newest every player and the host carry, so a
  pitch with the iPhone app on 0.9 plays 0.9, one with a build that carries 0.8 and 0.7
  plays 0.8, an older tab that carries only 0.7 plays 0.7, and two current pages play
  0.13 ("Playing together" below).
- Carrying an older minor is a decision made when the newer one is vendored, never an
  accident: `vendor:sync` stops on a new minor until it is told `--keep` or `--drop`.

## Vendoring

`vendor/engine/` is the newest engine. Each older minor the site carries is
`vendor/engines/<major.minor>/`, laid out the same way. `vendor/engine.json` pins them
all: its top-level `tag`, `commit` and `files` are `vendor/engine/`'s, and `older` holds
the others by major.minor (`{ "0.7": { tag, commit, files } }`). None of them is ever
edited by hand.

| Command                                      | What it does                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run vendor:sync -- --tag v0.7.5`        | A patch: moves the engine of that minor to the tag, the newest or an older one.                                       |
| `npm run vendor:sync -- --tag v0.8.0 --keep` | A new minor: the newest moves to `vendor/engines/0.7/` and is carried on, and 0.8.0 is the newest.                    |
| `npm run vendor:sync -- --tag v0.8.0 --drop` | A new minor that replaces the newest: matches from 0.7 then play back on 0.8, with the note a disagreeing hash shows. |
| `npm run vendor:sync`                        | Writes every pinned engine again at its own tag.                                                                      |
| `node tools/vendor.mjs drop 0.7`             | Stops carrying an older engine.                                                                                       |
| `npm run vendor:check`                       | Every pinned engine against its own manifest and bundle hash, and nothing unpinned under `vendor/engines/`.           |

An older minor the site has dropped is not added back. `tests/engine/vendor.test.mjs`
runs all of these against a stand-in kubb-engine made at test time
(`tests/engine/engine-fixture.mjs`: the vendored engine with only its version changed).

## The build and the page

`tools/lua-bundle.mjs` writes one bundle per carried engine,
`build/lua-sources-<major.minor>.json`. The build publishes each as a hashed asset (the
newest as `lua-sources-<hash>.json`, as it always was; an older one as
`lua-sources-<major.minor>-<hash>.json`) and the game pages' config names them all:

```json
"luaUrl": "/assets/lua-sources-<hash>.json",
"engine": "0.13.1",
"engines": {
  "0.13": { "version": "0.13.1", "luaUrl": "/assets/lua-sources-<hash>.json" },
  "0.9": { "version": "0.9.0", "luaUrl": "/assets/lua-sources-0.9-<hash>.json" },
  "0.8": { "version": "0.8.2", "luaUrl": "/assets/lua-sources-0.8-<hash>.json" },
  "0.7": { "version": "0.7.4", "luaUrl": "/assets/lua-sources-0.7-<hash>.json" }
}
```

`luaUrl` and `engine` stay the newest's. `readConfig` gives a page without `engines` the
set of one.

## In the browser

`src/engine/registry.js` holds the set: `loadEngine(mm)` fetches that engine's bundle
and makes its wasmoon state the first time it is asked for, and keeps it, so a page
that never looks back at an older match never loads an older engine. `src/main.js` makes
the registry from the config and loads the newest at boot.

Each engine is registered with the room bridge as it loads (`src/net/room-engine.js`):
`roomCall(name, args)` goes to the newest, `roomCall(name, args, mm)` to the one named.
`lobby.js`'s constants (`ENGINE`, `REPLAY_VERSION`, ...) are the newest's;
`engineConstants(mm)` reads any carried engine's, once each.

## Playing together

A pitch is played the way the engine's `docs/ROOM.md` "The room's engine" and "Speaking
down" set out, so that clients carrying one engine (the iPhone app, a tab from before
this deploy) agree with the page without any change to them. In `src/net/pitch.js`:

- **What the page says.** It joins announcing everything it carries,
  `me = { engine: "0.13+engines", engines: ["0.13", "0.9", "0.8", "0.7"] }`
  (`room.announce`), and
  announces again whenever the room's engine changes: on every member, seat and host
  change in the lobby (`Pitch.lobbyEngine`, `speak`), and the match's engine when a
  match starts. An older client reads `"0.13+engines"` as `0.13`.
- **The room's engine** is `room.engineFor(doc, members, host, me, carries)` on the
  newest: the newest major.minor the host and every lineup player carry; watchers do not
  count, so a watcher on 0.7 never pulls a 0.13 pitch down. A member's `engines` is
  believed only while its `engine` carries the `+engines` mark, so an older tab rejoining
  under the same member id (which overwrites `engine` and leaves the list) counts as
  0.7 alone.
- **The lobby** fetches the room engine's bundle ahead of START, and says nothing about
  versions while the pitch can start. When the players share no engine it says who
  stands in the way and what to do, with the version numbers, and START is off:
  "Ola has an older version of Throwing Wood (0.3) than this pitch plays (0.8), so the
  match cannot start. Ola: reload the page or update the app." (also a newer one, and
  one too old to name its engine).
- **START** (the host) makes the match on the room's engine (`Game.useEngine`, then
  `newMatch` with that engine's `matchOptions`) and writes it with that engine's
  `startMatch`, passing `room.speakAs(members, engine)` so a player whose new
  announcement is still on its way is not refused. The write works the room's engine
  and the lineup out again on the document it goes on; when a member joined, left or
  changed seat meanwhile they differ, nothing is written, and START begins again (three
  times at most). The match is stamped with that engine (`match.engine`).
- **In the match** every page plays or watches on `match.engine`: `enterMatch` loads it
  when it is not loaded yet, and the room's documents wait until it has (`waitFor`),
  then the document as it is by then is taken. The Game draws from that engine for the
  whole match; commits, `decide` and the rider are that engine's calls
  (`roomMinor`). Back in the lobby the Game is on the newest again.
- **A match on an engine the page does not carry** (a newer iPhone build's, or one the
  site has dropped) is watched, never played: the page's card says so ("This pitch is
  playing on a newer version of Throwing Wood. Reload to join."), and no side or the
  computer is given to it. A page like that which becomes host mid-match (the host
  left) cannot run the computer's turns: it says so ("You are the host now ... Leave
  the pitch and another player becomes the host") with LEAVE THE PITCH, RELOAD and
  WATCH.
- The lobby's reducers and the seat rules stay on the newest: `room/` is the same Lua in
  0.7.4, 0.8.2 and 0.9.0 but for the calls each added, 0.9's `settings` (below) and
  `startMatch`'s stamp, and 0.13's `pitch/` is 0.9's `room/` renamed. START, `matchOptions`, commits and `mayPlay` are the room
  engine's.
- **The match options** are read with `optionsOf(doc)` (`src/net/lobby.js`): since 0.9
  the engine's `room.optionsOf`, which adds the computer's level and the scene from the
  document's top-level `settings`; before 0.9, which has no such call, `lobbyOf(doc)`'s
  five. The lobby's rows are the room engine's `MATCH_OPTIONS`, so the Computer level
  row shows only on a pitch on 0.9 or newer; the Scene row, the web's own (the engine lists no
  scenes), shows when the room engine's `OPTION_DEFAULTS` has `scene` (docs/SCENES.md). A 0.8 client's writes keep `settings` as the host set
  it (a top-level key it does not know), and a 0.8 match's `matchOptions` leaves it out:
  the match it always started.
- **Tests:** `tests/net/room-engines.test.mjs` (the wrappers with both engines),
  `tests/game/room-engines.test.mjs` (pages in a real browser: 0.13 by default, 0.9 with
  the iPhone app on 0.9, 0.8 with an iPhone build that carries 0.8 and 0.7, 0.7 for a player who carries only 0.7, the blocked lobby, a page arriving at a 0.7 match, a
  host that cannot play the match).

## Looking back at a match

Everything that looks back at a finished match uses the match's own engine when the
site carries it, and otherwise the newest, which notes a hash that disagrees as it
always has:

- **A replay** (the pitch's WATCH REPLAY and WATCH THE LAST MATCH, a shared match's
  page, the embed): the replay names `engine` (`room.replayOf` copies `match.engine`).
  `src/replay/player.js` takes the engine and the Game draws from it while it plays
  (`Game.useEngine`), then from the newest again. A page that never looks back at an
  older match never loads one.
- **The score sheet** of a finished match on a pitch or a shared match's page: read from
  the match's engine set to its last snapshot (`Pitch.openSheet`); a replay's sheet is
  the replay engine's.
- **Records and reports** (`src/net/record.js`, `report.js`) name the engine that played
  (`engine.version`) and the bundle it was loaded from (`luaFor` in
  `src/site/config.js`). On a shared pitch that is the match's engine; in practice,
  solo and watch the newest. The rider names it too (`e`).
- **The share card** sends the match the Game played (`renameStart` on the Game's
  engine, the newest). The server checks it on the engine it names.
- **Highlight reels and the share check** (`backend/reels/`): the reel function's
  package carries one Lua bundle per carried engine (`engines/<major.minor>.json`), and
  `REEL_ENGINES` names them, newest first. A reel renders on the match's own engine and
  is tagged with it (`r1-0.7`), so a reel made before a new minor keeps its key. A
  shared match is checked on the engine it names, so an iPhone build on an older minor
  can share while the site carries that minor. A match of an engine not carried is
  refused, `why: "engine"`. `docs/REEL.md` "Engines"; deploying a new set is
  `docs/REEL-RUNBOOK.md` "Adding or dropping an engine".
- **The tools** (`tools/engines.mjs`): `games:replay` and `reports:replay` play each
  match or report on its own engine where the checkout carries it (`--engine <mm>` plays
  all on one: after a new minor, the throws it changes); `replay-fixture --engine <mm>` writes an older engine's kept replay,
  `tests/fixtures/replay-north-south-<mm>.json`.
- **Tests**: every carried engine plays its own golden corpus and its own kept replay
  (`tests/engine/`). The two-engine paths are tested with a second engine made at test
  time (`tests/net/engines-replay.test.mjs`, `tests/game/engines-client.test.mjs`,
  `tests/reel/engines.test.mjs`).
