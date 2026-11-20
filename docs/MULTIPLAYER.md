# A shared pitch

What happens on `/p/<code>` (without `?solo=1`): the lobby, then a match played by
everyone on the link, each on their own screen. The contract is docs/DESIGN.md 4.3; the
room server and its client are docs/ROOMS.md; the Game's seam is docs/CLIENT.md. This is
the client as built.

| File                               | What it does                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/net/pitch.js`                 | `Pitch`, the controller: joins the room, runs the lobby, drives the Game, casts, host hand-over. |
| `src/net/lobby.js`                 | Wrappers over the engine's `room.*` document reducers (what `room.update(fn)` runs).             |
| `src/net/seats.js`                 | Cached wrappers over the engine's seat and actor rules.                                          |
| `src/net/sync.js`                  | Wrappers over the engine's sync decisions and rider; JavaScript keeps `aimKey`.                  |
| `src/net/room-engine.js`           | The bridge: `engine.call("room.<name>", args).value` on the newest engine or a named one.        |
| `src/ui/lobby.js`                  | `Lobby`, the lobby card.                                                                         |
| `tests/net/room-wrappers.test.mjs` | Bridge contracts and caches; the room rules are tested by kubb-engine's vectors.                 |
| `tests/game/multiplayer.test.mjs`  | Playwright: real browsers against `tools/rooms-dev.mjs` (see Tests).                             |

## The lobby

Arriving on the link joins the room (`config.roomsUrl`) under this browser's member id
(`kubb.member` in localStorage) with `me = { name, level, engine }`. `engine` is the
vendored engine's major.minor (`"0.3"`), read from `room.constants`. The lobby card shows:

- **Your name** (remembered as `kubb:name`; sent as you type) and **your level**. Each
  player's throw level is their own.
- **Team A** (marigold) and **Team B** (violet), up to six a side, in throwing order, each
  member with a dot for connected and HOST and YOU tags. JOIN A, JOIN B, or WATCH INSTEAD
  to sit out. An empty side says "The computer plays this side." when the other has
  someone.
- **Watching**: everyone in the room on neither team.
- **SHARE THE LINK**: `navigator.share` where there is one, else the clipboard.
- **Who can join**: Invite only ("Only people with the link can join.", the default) or
  Open ("Listed under Open games on the home page: anyone can join."). The host picks;
  everyone else reads it. Starting a pitch from the home page with Open picked arrives as
  `/p/<code>?open=1`, and the new pitch's host (at `v` 0) writes it open.
- **The match** options: surface, opening, raising, wind, kubb set. The host sets them
  (and the host's choices are remembered as `kubb:pitchOptions` for their next pitch);
  everyone else reads them.
- **START** for the host, allowed with at least one player on one team; everyone else
  reads "Waiting for <host> to start." START stays in reach at the bottom while the
  card scrolls.

Teams change only between matches. A member who leaves the room for good (or gives their
place up in a full room) is taken off their team by the host's browser.

## The document

One shared document per room (`room.update` compare-and-set), written only by the
reducers in kubb-engine's `room/lobby.lua`, through `src/net/lobby.js`:

```js
{
  v: 1,
  teams:   { A: [memberId, ...], B: [...] },   // throwing order, 0 to 6 each
  options: { surface, opening, raising, wind, set },
  open:    false | true,                        // listed under Open games (docs/ROOMS.md section 9)
  started: false | true,
  n:       0,                                   // matches started on this pitch
  match:   null | {
    n,                                          // this match's number
    seq,                                        // actions committed (0 at START)
    snap,                                       // the engine's snapshot, opaque text
    hash,                                       // the engine's hash of snap
    players: { A: [{ id, name }], B: [...] },   // frozen at START
    cpu:     "A" | "B" | null,                  // the computer's side
    host,                                       // who started it
    engine,                                     // the starting engine's major.minor ("0.3")
    setup,                                      // the engine's newMatch options
    h0,                                         // the engine's hash at the start
    log:     [{ a, h }] | null,                 // every action with the hash after it
    over:    true,                              // set by the action that ended it
  }
}
```

Unknown top-level keys survive every reducer, including START, commits and REMATCH.
Empty objects, empty arrays and nulls stay distinct across the bridge.

`setup`, `h0` and `log` are the match's replay (docs/CLIENT.md "Replays"): START writes
the options and an empty log, and each commit adds its action and hash. The log stays
whole only while every commit adds to it: a gap (a browser built before replays commits
without the action) or a document past 248 KB (`LOG_BUDGET`, about 600 actions) sets it
to `null`, and that match has no replay. `replayOf(match)` gives the replay of a match
that is `over` with a whole log, else `null`.

A room's document is `null` until someone writes it, and an expired room (48 hours after
its last write, a finished one a year after its match ended) comes back empty: both read as a fresh lobby. The snapshot is carried as
the text the engine gave: it is never `JSON.parse`d and written back (that would turn
`3.0` into `3` and change the hash).

**Open games**: while the document says `open`, the host's browser tells the room server
what to list (`Pitch.publishOpen`, on every tick): `{ players, seats: 12, state }` from
`openListing` in `src/net/lobby.js` (`players` is the members connected, `state` is
`waiting`, `playing` or `over`), sent when it changes and again every 5 minutes so the
entry (15 minutes to live) stays; `null` when the host makes it invite only. A new host
sends it afresh. The home page's list and the server's rules are docs/ROOMS.md section 9.

**START** (the host): the lineup is the lobby's teams with each member's name and level;
an empty side is the computer. The host's browser makes the match
(`engine.newMatch` with a random seed, each player's `key` = their member id) and
commits `started: true`, `n + 1` and the match at `seq: 0`. Team A throws first.
The match is made on the room's engine (`docs/ENGINES.md` "Playing together"):
that engine's `room.startCheck` and `room.startMatch` receive the current members (as
`room.speakAs` gives them) and check their engines before writing `match.engine`.

## Engines

Room reducers, seat decisions and sync decisions are kubb-engine v0.3.0's `room.*`
calls over the same JSON bridge as the session (`kubbCall`). The engine's `docs/ROOM.md`
is their API; its 8,851 recorded vector steps cover the rules. There is no second
JavaScript implementation. `useRoomEngine` reads the newest engine's constants once
during boot; tools that use these wrappers initialize it too. A page can carry older
engines beside it (`docs/ENGINES.md`); their calls name the major.minor. A pitch plays
on the room's engine, the newest every player and the host carry; practice, solo and
watch on the newest.

Every web build from PR #40 sends its engine’s major.minor in join presence; from
engine 0.8.1 the page sends the room's engine marked `+engines` and every engine it
carries (`docs/ENGINES.md` "Playing together"). `LENIENT_ENGINES` is false. START
checks the host and seated players. When they share no engine the lobby says who and
what to do and START is off. A running match must also name its engine, and is played
only on it. Equal major.minor versions can play across patch releases.

Before taking control of a running match, every member calls `room.mayPlay`, including
watchers who could become host and run the computer. A refusal gives no team or CPU
control and hides the player's resignation action. The house-style card says:

- Pitch newer: "This pitch is playing on a newer version of Throwing Wood. Reload to
  join." with RELOAD and WATCH.
- This client newer: "This pitch is playing on an older version of Throwing Wood. Ask
  the host to reload." with WATCH.

A guest on a team in the lobby checks the host's announced engine too. A host whose
START is refused sees which players need to reload; no match is committed.

## Staying in step

The browser that acts applies the action to its own engine, then commits the snapshot
after it as action `seq + 1`, with the action riding along as the update's `with`:

```js
room.update((doc) => commitAction(doc, { n, seq, snap, hash }), {
  with: { n, seq, a: action, c: "web", e: "0.3.0" },
});
```

`c` names the client that committed the action, and `e` the engine's full
version: the recorder keeps them with the action, and the other browsers ignore them
(`docs/ROOMS.md` section 2.6).

`commitAction` refuses unless the document's match is `n` at `seq - 1`, so two browsers
acting at once cannot both land: the room's compare-and-set runs the reducer again on the
winner's document, it refuses, and the loser drops its action and adopts the winner's
snapshot. Every other browser gets the document with `with` and decides
(`room.decide`, through `src/net/sync.js`):

| The document                     | What this browser does                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| no match (`started` false)       | back to the lobby                                                                                                |
| a match other than ours (`n`)    | take it: adopt its snapshot (START, a late arrival)                                                              |
| the next action, with its `with` | `game.applyRemote(action)` (watch the same throw), then compare the hash; adopt on a refusal or a different hash |
| a gap, or no `with`              | adopt the snapshot                                                                                               |
| the version we hold              | compare the hash when nothing is in flight; adopt if it differs                                                  |
| older than ours                  | nothing                                                                                                          |

Remote actions that arrive while a throw is still playing back wait in a queue and play
one after another. A rejoin after a lost connection (the room's `state` event), a commit
that loses, or one that fails (`uncertain`, `busy`, `too-big`, `closed`) all re-read the
room's document the same way, which adopts. `with` is not replayed on a reconnect, so a
browser that missed actions adopts.

**Sizes**, measured: a throw's action is at most 445 B as JSON (a human throw with a long
held swing; the computer's about 357 B), raises and punishment kubbs a few dozen bytes,
all far under the 4 KB `with` limit. An action that would not fit is sent without `with`
and the others adopt instead of watching. Snapshots measured up to about 7.8 KB here and
13.2 KB in the engine's cpu-against-cpu run (docs/ENGINE.md), far under the 256 KB
document; the room client splits frames over 30 000 B by itself.

## Who acts

`room.*` seat calls through `src/net/seats.js`, from the match's players, the computer's
side, the room's host and who is connected now (`ctx.connected` is an array of ids):

- **A throw** is for the member whose player the engine names (`need.setup.thrower.key`).
  If they are not connected, the first connected member of that team in throwing order
  takes it (it is still that player's throw on the sheet); failing that, the host.
- **A raise or a punishment kubb** is for any connected member of the defending team,
  else the host. Two at once: the compare-and-set settles it.
- **The computer** is the host's browser's (`control.cpu`), and only its. The others hold
  the computer's throw until the action arrives.
- The engine's control for a browser (`engine.setControl`) is its own team's side, plus
  every human side and the computer for the host, who stands in for anyone. `seat.mayAct`
  decides need by need. Seats are recomputed when members connect or go, when the host
  changes, and five times a second, never during a playback. A host who takes over the
  computer mid-throw restarts its think from the current snapshot.

The controller keeps the same context object until the members, host or match change.
Seat and actor wrappers cache by context, need and member: repeated render-loop reads
never cross the room bridge. Name cleanup and open-listing reads are cached too. Socket
pacing and `aimKey` stay in JavaScript.

Whose turn it is shows by name: the status pill says YOUR THROW (marigold), HANNA THROWS,
COMPUTER THROWS, YOUR RAISE, TEAM B PLACES A KUBB and so on, and the hand-off card leads
with the same line. A card for someone else's turn has a WATCH button and closes itself.
A throw taken for an absent teammate says YOUR THROW FOR <NAME>.

## Being there

- **Aim**: while it is this browser's throw it casts `{ t: "aim", s: game.aimState() }`
  on the controller's 200 ms clock, only when the aim changed (at most 5 a second; the
  room allows 10). Everyone else calls `game.showRemoteAim(s)`.
- **Shouts**: SHOUT opens NICE!, OOH!, TOK!, UNLUCKY; each is a cast
  `{ t: "shout", w }` (at most one each 0.7 s from a browser) and shows for 2.6 s under
  the rail as the sender's name and the word, on every screen including the sender's.

## The edges

- **Late arrival**: a browser that arrives during a match adopts the snapshot at once,
  watches, and is told so for a few seconds ("THE MATCH IS UNDER WAY: YOU ARE WATCHING.
  PICK A SIDE FOR THE NEXT ONE."). It can pick a team in the lobby after the match.
- **Someone leaves**: their throws fall to a connected teammate, else the host.
- **The host goes**: after the host has been away 16 s by this browser's clock (the room
  allows a claim after 15 s) or has left, the earliest-joined connected member claims,
  at most every 5 s. The new host runs the computer from then on and gets REMATCH.
- **Lost connection**: RECONNECTING shows under the status pill; the room client
  reconnects by itself, and the rejoin adopts the room's snapshot.
- **Full room** (16 connected), a bad code, or the pitch open in another tab of the same
  browser (`replaced`, USE IT HERE reloads): a plain card with a way on. A build with no
  room server offers PLAY THE COMPUTER.
- **The end**: everyone gets the winner card, with WATCH REPLAY. REMATCH is the host's:
  back to the lobby with the same teams (`started: false`, the match dropped); the others
  read who can start one. HOME for everyone. The browser that committed the last action,
  and every player who saw it arrive, sends the room `keep` with `replayOf` the match
  (docs/ROOMS.md section 10): the room keeps the replay and itself a year. Someone who
  arrives at a finished pitch (or comes back to it) gets the winner card with the teams
  and WATCH REPLAY as its lead, if the room kept one: the result, the teams, the score
  sheet and nothing to act on. A match that ended before replays shows the same card
  without WATCH REPLAY. After a rematch the lobby offers WATCH THE LAST MATCH, the
  replay of the most recent finished match, until the next one ends. A match in play is
  never offered.
- **Watching a replay** (`Pitch.watch`): the room session stays joined but the pitch
  ignores documents while it plays (`ReplayPlayer`, docs/CLIENT.md "Replays"); BACK TO
  THE PITCH returns to where it was (the winner card, or the lobby) and catches up with
  the room. The replay is read only: its seat may never act, so nothing it shows reaches
  the room. A finished pitch is never listed under Open games.
- **Resign** (the menu) is for players only, not for those watching.

## Tests

- `node --test tests/net/room-wrappers.test.mjs` covers the bridge's named arguments,
  `.value` results, null-to-undefined reducer no-ops, unknown top-level fields through
  every document reducer, version admission, opaque snapshots and seat caches. The
  engine's own vector tests cover the shared rules.
- `tests/game/room-version.test.mjs` checks advertised versions, refused START,
  untagged tabs, both refusal cards, reload, disabled team/CPU control and idle
  room-bridge call counts, on desktop and phone against the local rooms server.
- `tests/game/multiplayer.test.mjs` starts `tools/rooms-dev.mjs` and the preview on free
  127.0.0.1 ports and opens each player in their own browser context on one
  `/p/<code>?rooms=<the test's room server>` (`?rooms=` is honoured only on 127.0.0.1,
  localhost or with `?test=1`; the preview's CSP allows any local WebSocket port). It
  plays: two browsers on opposite teams, the guest reads the options and waits; the host
  throws, the guest watches the same throw (applied, not adopted) and ends on the same
  hash; the turn passes and the guest throws, the host watches it; a third browser
  arrives mid-match, adopts and watches; a shout arrives; the guest's socket drops and it
  comes back in step; a resignation gives everyone the winner card and the host's
  REMATCH takes all three back to the lobby with the same teams. "a finished pitch plays
  its match again": a match against the computer ends, the room keeps its replay, a
  late visitor gets WATCH REPLAY first with the teams, and the replay is read only,
  pauses, steps one throw, goes BACK, ends at 4X on the same hash as the document with
  REPLAY AGAIN, returns to the pitch, and after REMATCH the lobby offers the last match;
  its bar fits a phone. Also one person against
  the computer through the room, the lobby on a phone (no sideways scroll) and in
  landscape, and a room server that cannot be reached. Skipped with a notice without
  Playwright's Chromium. `KUBB_MP_SHOTS=build/mp-shots` also saves screenshots.

## Not done yet

- A team picks its next thrower only as the engine's order names them; the engine's
  `thrower` action (choosing among `need.candidates`) has no control yet.
- The engine's hand-off card is written from the thrower's side ("YOUR BASE 5, THEIRS
  5"); a browser watching the other team's turn reads the bases from the thrower's view.
- A long match is played through only in part by the tests; a whole match between two
  browsers, and the host leaving mid-match, are not run automatically.
