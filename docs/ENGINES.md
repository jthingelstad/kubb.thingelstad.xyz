# Engines the site carries

A match belongs to the engine it was started on: its `match.engine` major.minor, for its
whole life (the engine's `docs/VERSIONING.md`). A new minor can change how a throw goes,
so a match from an older minor only plays as it was played on that minor's engine.

## The rule

**The site carries its own engine and the engines of the iPhone builds people have, and
no others.** The owner, 2026-11-22, with every project at 1.0.0: "Web will support the
CURRENT App Store release and the CURRENT Test Flight Dev and Beta releases. At most the
web will support those three versions and whatever version it is running natively." And
of the Playdate: "Playdate is bundled so it is always with whatever it runs, it doesn't
matter."

So at most four engines: the newest (what the site plays on) and those of the three
current iPhone builds below. An engine is dropped when none of the three uses it, never
because a newer one exists. Before 1.0 the site carried the newest alone (the owner,
2026-11-21: "We should only support engines that we decide are worth supporting not just
ones that have published so that we can push players to the new engines." And: "We are
still in dev mode. Fine to push breaking changes."); support is still a decision, now with
this rule for it.

### The iPhone builds people have

The site cannot see App Store Connect, so this table is the record. Whoever uploads a
build or releases one changes its row in the same sitting (throwingwood-ios
docs/DISTRIBUTION.md says so), and a move to a new engine minor reads it first: `--keep`
for an engine a row still names, `--drop` only for one no row names.

| Build                             | App version       | Engine | As of      |
| --------------------------------- | ----------------- | ------ | ---------- |
| App Store                         | 1.0.0 (build 260) | 1.0.0  | 2026-11-24 |
| TestFlight Beta (outside testers) | 1.1.0 (build 284) | 1.4.0  | 2026-11-27 |
| TestFlight Beta, in review        | 1.1.0 (build 291) | 1.4.1  | 2026-11-27 |
| TestFlight Dev (internal)         | 1.1.0 (build 291) | 1.4.1  | 2026-11-27 |

The TestFlight rows were read from App Store Connect on 2026-11-27, the day build 291,
`1.1.0 (1.4.1)`, was uploaded. It is in the Internal group, and it was added to the Beta
group and submitted to Beta App Review that day. Until Apple passes it, the build outside
testers have is 284, `1.1.0 (1.4.0)`, which passed Beta App Review.
Whoever sees 291 pass removes the "in review" row and makes the Beta row 1.1.0 (build
291). Engine 1.4.1 is a patch that shares matches with 1.4.0 (its cameras changed, no
throw did), so the site's 1.4 plays with both builds. The App Store row stays 1.0.0 until
a new version is released there, so the site keeps 1.0 until then. Builds 284 and 291
carry 1.0 too, so a tester on either still plays a pitch with someone on the App Store
version, on the 1.0 game.

The App Store row was filled on 2026-11-24, the day Apple approved 1.0.0 and it went live
(build 260, the one submitted for App Review). The store's own lookup names the version.

- **Today the site carries two engines: 1.4 (1.4.1), the newest, and 1.0 (1.0.0).**
  1.4 came with web 1.5.0 (2026-11-26), vendored with `--keep`, and moved to the patch
  1.4.1 with web 1.5.2 (2026-11-27; `vendor:sync -- --tag v1.4.1`, no `--keep` or
  `--drop`, since a patch replaces its minor): the end camera is a person's eyes on the
  player's baseline that turn with the throw, and the held raise camera stands over the
  lying group, with no hash changed (its golden corpus is 1.4.0's), so it shares every
  match with 1.4.0 and with builds 284 and 291 alike. every iPhone build in the
  table above was on 1.0 that day, and the App Store's still is, so 1.0 stays until no
  row names it. 1.4 brings the throw levels
  (1.3), the view from one side, the computer's turn fast or skipped, raising in any
  order and the throw to go (the engine's docs/CLIENTS.md, docs/SESSION.md). 1.0 and 1.4
  share no match: a match plays on the one it was started on, and a pitch with a 1.0
  player plays 1.0, where none of 1.4's controls show (docs/MULTIPLAYER.md "Engine 1.4
  on a mixed pitch").
- 1.0 (1.0.0) replaced 0.18 (0.18.0) with
  `--drop` on 2026-11-22. 1.0.0 is the released engine, a major by declaration (the
  owner, 2026-11-22: "lets move all four projects to version 1.0.0 and tag those
  releases. We will use that version to submit to the App Store as well."): no format
  changes, but its physics differs (standing kubbs take their seat in the turf, a baton
  rocking in a groove from its first step), so it shares no match with 0.18 (the engine's
  docs/CLIENTS.md "1.0 on top" and docs/VERSIONING.md 1.0.0), and web and iPhone move
  together. Its `pitch.engineFor` leaves computer seats out itself. A kept match of 0.18
  can no longer be replayed. 0.18 had replaced 0.16 (0.16.0) the same day (the web never
  carried 0.17), 0.16 had replaced 0.15 (0.15.1), 0.15 had replaced 0.13 (0.13.4) (the
  web never carried 0.14), and 0.9 (0.9.0), 0.8 (0.8.2) and 0.7 (0.7.4) were carried
  until 2026-11-21 and were dropped then.
- The supported set is written in one place: `vendor/engine.json`, its top-level `tag`
  (the newest) and `older` (by major.minor; 1.0 today). The build, the registry and
  the reels' `REEL_ENGINES` read it; there is no other list. This page says why.
- Carrying an older minor again, or keeping one when a new minor arrives, is a decision
  made when the newer one is vendored, never an accident: `vendor:sync` stops on a new
  minor until it is told `--keep` (carry the old one in `vendor/engines/<mm>/`) or
  `--drop`. The default answer is `--drop`.
- One engine per major.minor. A patch replaces its minor's engine.

The version label a player sees names the newest: `1.5.2 (1.4.1)`, with "Also plays
..." under it in MENU only while an older engine is carried (1.0 today; docs/CLIENT.md
"Version and freshness"). A match names its own engine, never the app's version.

Engine 0.13 renamed the shared pitch's directory `room/` to `pitch/`; the bridge
(`roomCall` in `src/net/room-engine.js`) says `pitch.`, the engine's own spelling (the
file keeps its name). `tools/lua-bundle.mjs` (`DIRS`) and `tools/vendor.mjs`
(`ENGINE_DIRS`) still list `room/` too and skip a directory an engine does not have, so
an older minor could be carried again without a tool change.

## Vendoring

`vendor/engine/` is the newest engine. An older minor the site carries would be
`vendor/engines/<major.minor>/`, laid out the same way. None is ever edited by hand.

| Command                                       | What it does                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm run vendor:sync -- --tag v0.13.4`        | A patch: moves the engine of that minor to the tag.                                                           |
| `npm run vendor:sync -- --tag v0.14.0 --drop` | A new minor that replaces the newest: matches of 0.13 can then no longer be replayed (below).                 |
| `npm run vendor:sync -- --tag v0.14.0 --keep` | A new minor with 0.13 carried on beside it: only when we decide 0.13 stays supported.                         |
| `npm run vendor:sync`                         | Writes every pinned engine again at its own tag, and `backend/pitch-server/names-words.json` from the newest. |
| `node tools/vendor.mjs drop 0.9`              | Stops carrying an older engine (how 0.9, 0.8 and 0.7 were dropped).                                           |
| `npm run vendor:check`                        | Every pinned engine against its own manifest and bundle hash, and nothing unpinned under `vendor/engines/`.   |

`tests/engine/vendor.test.mjs` runs all of these against a stand-in kubb-engine made at
test time (`tests/engine/engine-fixture.mjs`), so the machinery for several engines stays
tested while the site carries one.

## In the browser

`src/engine/registry.js` holds the set from the page config's `engines` (the build
writes one entry per carried engine; today two). `src/main.js` loads the newest at boot.
`roomCall(name, args)` goes to the newest; `lobby.js`'s constants are its.

## Playing together

A pitch plays on the room's engine, the newest the host and every player carry
(`room.engineFor` on the newest; the engine's `docs/PITCH.md` "The room's engine"). With
1.4 and 1.0 carried, a pitch of web pages plays 1.4, one with an iPhone on 1.0 plays 1.0,
and one with a client on neither plays nothing:

- **What the page says.** It joins announcing what it carries,
  `me = { engine: "1.4+engines", engines: ["1.4", "1.0"] }` (`room.announce`).
- **A player on an older client** (an iPhone build on 0.9, an old tab) leaves the players
  with no engine in common. The lobby says so on both sides, and START is off
  (`Pitch.blockedText`, `src/net/pitch.js`):
  - to the host and everyone else: "Ola has an older version of the game. This pitch
    needs the newest version of the game. Ola: update to play.";
  - to the page that is the older one: "This pitch needs the newest version of the game.
    Reload the page to update." (the iPhone app shows its own words for the same answer);
  - a newer client than this page: "Ola has a newer version of the game than this page.
    Reload the page to update, or Ola can watch."
    A watcher does not count: a watcher on 0.9 never holds a pitch back. START pressed
    anyway starts nothing; the page never starts a match on an engine it does not carry.
- **A match on an engine the page does not carry** (one an older iPhone host started on
  0.9, or a newer build's) is never played here: its snapshot is drawn
  only if the newest engine can read it, and not at all when it cannot. The card says "This pitch is playing on an older version of the game,
  which this page no longer plays. This pitch needs the newest version of the game: the
  host must update to play." (or, for a newer one, "This pitch is playing on a newer
  version of the game. Reload the page to update."), and no side or the computer is given
  to it. A page like that which becomes host mid-match says so with LEAVE THE PITCH,
  RELOAD and WATCH.
- **Tests:** `tests/net/room-engines.test.mjs` (the wrappers: one engine, a 0.9 client
  blocks START, a 0.9 match is not this page's), `tests/game/room-engines.test.mjs`
  (pages in a real browser: two current pages play the newest, a watcher on 0.9 does not
  hold it back, a 0.9 player is told on both sides and START stays off, a 0.9 match is
  watched from nowhere, a host that cannot play the match).

## Looking back at a match

A finished match is looked back at on its own engine. One made on an engine the site no
longer carries cannot be played again, so every place it can be opened fails kindly,
with one sentence and nothing broken around it (`OLD_REPLAY` in `src/replay/player.js`):

> This match was made on an older version of the game and can no longer be replayed.

| Where                                          | What it does now                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| WATCH REPLAY on a winner card                  | (only offered for a match just played here, so on the newest)                                                                                     |
| WATCH THE LAST MATCH in the lobby              | Card "Cannot replay this match" with the sentence and OK; OK puts the lobby back (`Pitch.replayRefused`).                                         |
| A shared match's page, `/p/<code>` (sealed)    | Card "Cannot replay this match" with the sentence, HIGHLIGHT REEL (the reel card: its video needs no engine) and HOME.                            |
| An observer at a wiped pitch with a kept match | The same card as a shared match's page.                                                                                                           |
| The embed, `/e/<code>`                         | Its quiet card: the match's result as the title, the sentence, and OPEN THE PITCH; no engine is loaded.                                           |
| A highlight reel already made                  | Plays: it is a stored MP4 under `reels/`, served by the site; nothing runs the engine.                                                            |
| A new reel of an old match                     | The api answers `why: "engine"` (not in `REEL_ENGINES`), as before; the reel card says so.                                                        |
| Sharing an old match against the computer      | The share check refuses `why: "engine"` (an iPhone build on 0.9): "This match was played on another version of the game, so it cannot be shared." |
| A kept unfinished solo match                   | None on the web: the browser keeps no unfinished match (the iPhone app does; its port drops it).                                                  |

A kept match whose snapshot holds a name the game did not make is refused the same way,
with "This match has a name the game did not make, so it cannot be shown."
(`NAMES_REPLAY`; docs/MULTIPLAYER.md "Names").

- **Records and reports** (`src/net/record.js`, `report.js`) name the engine that played
  (`engine.version`) and the bundle it was loaded from (`luaFor` in `src/site/config.js`).
- **The tools** (`tools/engines.mjs`): `games:replay` and `reports:replay` play each
  match or report on its own engine where the checkout carries it, else on the newest
  with the throws that go differently listed (`--engine <mm>` plays all on one);
  `node tools/replay-fixture.mjs` writes the kept replay fixture,
  `tests/fixtures/replay-north-south.json` (its sides now generated names).
- **Tests**: the carried engine plays the kept replay on every check and its golden
  corpus when the engine or wasmoon changed, or when asked (`npm run golden`;
  `tests/engine/`); an old match's sentence in every place above is
  `tests/game/engines-client.test.mjs`; the machinery for several engines, with a second
  made at test time, is `tests/net/engines-replay.test.mjs` and `tests/reel/engines.test.mjs`.

Removed with the old engines (2026-11-21): `vendor/engines/0.9`, `0.8` and `0.7`, their
kept replay fixtures `tests/fixtures/replay-north-south-0.9.json`, `-0.8.json` and
`-0.7.json`, the browser tests that played 0.9, 0.8 and 0.7 matches with an iPhone
stand-in, and the Scene test for a pitch on 0.8.
