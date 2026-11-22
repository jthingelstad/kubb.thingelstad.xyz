# A shared pitch

What happens on `/p/<code>` (without `?solo=1`): the lobby, then a match played by
everyone on the link, each on their own screen. The contract is docs/DESIGN.md 4.3; the
pitch server and its wire are `backend/pitch-server/PROTOCOL.md` (docs/PITCH-SERVER.md);
the calls that are not live (replays, reels, shares, reports, records) are the api,
`backend/api/API.md`; the Game's seam is docs/CLIENT.md. This is the client as built.

| File                              | What it does                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/net/pitch.js`                | `Pitch`, the controller: joins the pitch, runs the lobby, drives the Game, sends aim and shouts.      |
| `src/net/pitch-client.js`         | `PitchClient`, the socket: join and resume, lobby writes, actions in flight, casts, reconnects.       |
| `src/net/aim.js`                  | The aim on the wire: the sender's rate and the watcher's buffer, drawn 100 ms behind between samples. |
| `src/net/api.js`                  | The HTTPS api's one call (`apiCall`), its address from the page's `kubb-config`.                      |
| `src/game/pacing.js`              | The match's online pacing, one named tune (see "Pace").                                               |
| `src/net/lobby.js`                | Wrappers over the engine's `pitch.*` document reducers (what `update(fn)` runs), and `setTeamName`.   |
| `src/net/seats.js`                | Cached wrappers over the engine's seat and actor rules.                                               |
| `src/net/room-engine.js`          | The bridge: `engine.call("pitch.<name>", args).value` on the newest engine or a named one.            |
| `src/ui/lobby.js`                 | `Lobby`, the lobby card.                                                                              |
| `tools/pitch-dev.mjs`             | The pitch core and the api on this machine, for `npm run dev` and the tests (see Tests).              |
| `tests/net/pitch-client.test.mjs` | The socket against the pitch core: resume, retries, every socket dropped, refusals, two clients.      |
| `tests/net/aim.test.mjs`          | The aim maths.                                                                                        |
| `tests/game/multiplayer.test.mjs` | Playwright: real browsers against the local pitch server (see Tests).                                 |
| `tests/game/pitch-e2e.test.mjs`   | Playwright: two players and an observer complete a turn; the observer's dial moves between samples.   |

## The lobby

Arriving on the link joins the pitch (`config.pitchUrl`, `/ws?pitch=<code>`) under this
browser's member id (`kubb.member` in localStorage) as a `player` with
`me = { name, level, engine, engines }`. `engine` is the
vendored engine's major.minor (`"0.3"`), read from `room.constants`. The lobby card shows:

- **You**: your name, this device's generated name (`kubb:name`), in its name row
  (docs/CLIENT.md "Names"): a pick here or in MENU is kept as the device's name and sent
  at once (`me.name`). No level is shown: from engine 0.13 every person throws on one
  meter. `me.level` is still sent, the device's stored level (`kubb:level`, Club when
  never chosen); it changes nothing on 0.13.
- **Team A** (marigold) and **Team B** (violet), up to six a side, in throwing order, each
  member with a dot for connected and HOST and YOU tags (two with one name: the second
  "II", "Names" below). A side of several shows the name it plays as, the host's to pick
  in a name row. JOIN A, JOIN B, or WATCH INSTEAD to sit out. An empty side says "The computer plays this side." when the other has
  someone.
- **Watching**: everyone in the room on neither team.
- **SHARE THE LINK**: `navigator.share` where there is one, else the clipboard.
- **Who can join**: Invite only ("Only people with the link can join.", the default) or
  Open ("Listed under Open games on the web game’s page: anyone can join."). The host picks;
  everyone else reads it. Starting a pitch from the web game's page (`/web/`) with Open picked arrives as
  `/p/<code>?open=1`, and the new pitch's host (at `v` 0) writes it open.
- **The match** options: surface, opening, raising, wind, kubb set. The host sets them
  (and the host's choices are remembered as `kubb:pitchOptions` for their next pitch);
  everyone else reads them.
- **START** for the host, allowed with at least one player on one team; everyone else
  reads "Waiting for <host> to start." START stays in reach at the bottom while the
  card scrolls.

Teams change only between matches. A member who leaves the pitch for good is taken off their team by the host's browser.

## The document

One shared lobby document per pitch, written with compare-and-set (`set {v, doc}`: the
server takes it only at the version this browser read; `PitchClient.update(fn)` runs `fn`
again on the newer document when another write landed first). Only the reducers in
kubb-engine's `room/lobby.lua` write it, through `src/net/lobby.js`:

```js
{
  v: 1,
  teams:    { A: [memberId, ...], B: [...] },  // throwing order, 0 to 6 each
  options:  { surface, opening, raising, wind, set },
  settings: { level, scene },                  // engine 0.9: the computer's level, the scene
  open:     false | true,                      // listed under Open games
  started:  false | true,
  n:        0,                                 // matches started on this pitch
  match:    null | {                           // the header only
    n,                                         // this match's number
    players: { A: [{ id, name }], B: [...] },  // frozen at START
    cpu:     "A" | "B" | null,                 // the computer's side
    host,                                      // who started it
    engine,                                    // the match's engine, major.minor ("0.9")
  }
}
```

The match itself is not in the document. The pitch server holds it: its number `n`, the
actions committed `seq`, the hash after the last `h`, its log of actions, the snapshot
the last action carried, and `meta` (below). Every `joined` and `state` frame carries the
document and the match's head together.

Unknown top-level keys survive every reducer, including START and REMATCH. Empty
objects, empty arrays and nulls stay distinct across the bridge. A snapshot is carried as
the text the engine gave: it is never `JSON.parse`d and written back (that would turn
`3.0` into `3` and change the hash).

A pitch nobody has written is `v: 0` with no document; it reads as a fresh lobby. Before
treating it so, the page asks the api whether the code is a sealed match against the
computer (`GET /api/replay`, docs/CLIENT.md "Sharing a match"), in parallel with the join.

**`meta`**, sent once with START and kept by the server beside the log: what a replay
needs besides the actions, in the engine's own replay shape (`replayOf`, `isReplay`):

```js
{
  v: (1, setup, engine, version, players, cpu);
}
```

`setup` is the engine's `newMatch` options, `engine` the match's major.minor ("0.9",
which picks the engine a replay plays on), `version` the full version the host started it
on ("0.9.0", for the records), `players` and `cpu` as in the header. The server adds `n`, `h0` (the hash at START) and
the log `[{ a, h, ts }]`; the api keeps `{ ...meta, n, h0, log, hash, snap }` once the
match is over (API.md). Nothing about `meta` is read by the server.

**Open games**: while the document says `open`, the host's browser tells the pitch what
to list, `open { open: { seats: 12, state } }` from `openListing` (`state` is `waiting`,
`playing` or `over`; the server counts the players itself), sent when it changes; `open:
null` when the host makes it invite only. A new host sends it afresh. The web game's list
reads the pitch server's `GET /open` (`public/js/open-games.js`).

**START** (the host): the lineup is the lobby's teams with each member's name and level,
each name checked ("Names" below); a side of several plays under the document's
`teamNames` (rolled now if missing), a side of one under its player's name; an empty
side is the computer. The host's browser makes the match (`engine.newMatch` with
a random seed, each player's `key` = their member id) on the room's engine
(`docs/ENGINES.md` "Playing together": that engine's `room.startCheck` and
`room.startMatch` receive the current members as `room.speakAs` gives them), then sends
one `start { v, doc, n, h, snap, meta }`: the document with `started: true`, `n + 1` and
the header, and beside it the snapshot, its hash and `meta`. The server takes it only at
`v` (a write that crossed it means another try from the top, at most three). Team A
throws first.

## Names

Every name on a pitch is a generated one (docs/CLIENT.md "Names"; the engine's
docs/NAMES.md section 6). A client offers only generated names, but a client is not
proof, so each boundary checks:

| Where a name enters                                                                       | Who checks                                                            | When it fails                                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| a member's `me.name` (join, `me`, waking)                                                 | the pitch server (`checkedMe`, `backend/pitch-server/core.mjs`)       | dropped, never refused: the member stays, with no name, shown to all as "Player n"            |
| the document's `teamNames`, the header's players, a start's `meta` (players, setup teams) | the pitch server (`badNames`, on `set` and `start`)                   | refused `bad-name`: an honest page never sends one                                            |
| any name a page shows                                                                     | the page (`names.valid`: `ok` or `default`)                           | the default for its place, "Player n" or "Team A"/"Team B"                                    |
| a match's snapshot (drawn by the engine)                                                  | the page, on entering the match (`badNames` of the snapshot's `opts`) | the match is not shown: "This match has a name the game did not make, so it cannot be shown." |

"Player n" is the engine's own name for a player with none: n is their place on their
side, as `lineup` numbers them, so the lobby, the host's START and every page agree.

**What a client that sends a typed name sees** (an old build, or anyone sending their own
messages; no older iPhone build can join a web pitch since the site carries only the
newest engine): the pitch takes its join, drops the name, and every page, its own
included, shows it as "Player 1" (its place on its side; a watcher, its place on the
pitch). Its own name row, if it has one, still shows what it sent: that text goes
nowhere. It can sit on a side and play; START puts it in the match as "Player n". If it
writes a team name or starts a match naming a typed name, the pitch refuses the write
(`error bad-name`). Others never see its text.

**Two members with one name** are told apart in the lobby only: the second (by the
pitch's join order) shows "II", the third "III" (`apartNames`); the name itself is
never changed.

## Engines

Room reducers, seat decisions and sync decisions are kubb-engine's `room.*`
calls over the same JSON bridge as the session (`kubbCall`). The engine's `docs/ROOM.md`
is their API; its 8,851 recorded vector steps cover the rules. There is no second
JavaScript implementation. `useRoomEngine` reads the newest engine's constants once
during boot; tools that use these wrappers initialize it too. A page can carry older
engines beside it if we decide one is supported (`docs/ENGINES.md`: today it carries the
newest alone); their calls name the major.minor. A pitch plays on the room's engine, the
newest every player and the host carry; practice, solo and watch on the newest. A player
on an older client leaves no engine in common: both the host and that player are told
"This pitch needs the newest version of the game", and START is off.

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

The browser that acts applies the action to its own engine, then sends it at once:

```js
pitch.act({ n, seq, a: action, h: hash, snap, over, c: "web" });
```

`seq` is the action's number in the match (the last one held + 1), `h` the engine's hash
after it, `snap` the snapshot after it (the server keeps the newest, for anyone who
arrives later), `over` true on the action that ends the match, `c` the client. The
client gives it an `id` and keeps it in flight until the server answers `ok { re: id }`.
**Nothing waits for `ok`**: the next throw, the winner card and every control go on at
once. A retry after a reconnect sends the same `id`; the server answers a duplicate `ok`
with `dup: true` and does nothing more, so an action is never committed twice. The log is
never sent again: the server already has every action it said `ok` to.

Two browsers acting at once cannot both land: the server takes `seq` only as the next
one. The loser gets `refused { why: "seq" }` and the whole pitch; its client drops that
action and every later one in flight, and the game adopts the pitch's snapshot.

Every other browser gets each action as `act { m, n, seq, a, h, over, ts }` in order and
plays it (`game.applyRemote`, watching the same throw), then compares its hash with `h`.
A hash that differs, or an action the engine refuses, asks for the whole pitch again
(`resync`) and adopts its snapshot. Actions that arrive while a throw is still playing
back wait in a queue and play one after another; a throw also waits for its own aim to
be drawn (see "Aim").

**Sizes**, measured: a throw's action is at most 445 B as JSON, raises and punishment
kubbs a few dozen bytes; snapshots up to about 13 KB; all far under the server's frame
limit (PROTOCOL.md).

## Reconnecting

`PitchClient` reconnects by itself for as long as the page is open, and nothing a player
did is lost or doubled:

- **When**: a socket that closes or errors is tried again at a random wait under 300 ms
  (so a deploy that drops every socket at once does not bring them all back in the same
  instant), then 1 s, doubling to 10 s, each with a quarter of jitter either way. The
  page coming back online or becoming visible tries at once.
- **Dead sockets**: after 20 s with nothing heard the client sends the literal `ping`;
  no answer in 10 s and it connects again. A lobby write with no answer in 10 s is
  `uncertain` and it connects again to find out.
- **Resume**: the join carries `n` and `seq`, the last action this browser holds (its own
  that are still in flight not counted). The server answers `joined` with the whole
  document and either the actions after that point (`match.full: false`, `acts`), or the
  whole match with its snapshot (`match.full: true`) when it cannot. Resumed actions that
  are this browser's own in-flight ids count as their `ok`; every other one plays as it
  would have live. Then the actions still in flight are sent again (a duplicate is
  answered `dup`). Live or after a drop, this browser's actions go one at a time: each
  waits for the answer to the one before, so none goes on top of a predecessor the
  pitch refuses (someone else committed that seq first), and a long backlog stays
  under the server's message limit (at most 15 a second after the first 20). Told
  `rate` all the same, the client sends the one out again a second later. When the
  full snapshot lacks this browser's own unanswered actions, which follow on from its
  head, the page keeps them played rather than taking the snapshot (`Pitch.ownAhead`).
- **Gaps**: every stamped frame moves the pitch's sequence `s` on by one; a jump (a frame
  missed) sends `resync` and waits for the whole pitch (`state`).
- **What a player sees**: RECONNECTING under the status pill (and in the lobby and the
  observer's card) from the first drop until `joined`; the match stays on screen and
  playable. An action made while away is held and goes when the socket is back. After 8 s
  never connected the page says so.
- **For good**: `replaced` (the same member opened the pitch elsewhere: close code 4001),
  and a first join refused as `full`, `no-pitch`, `bad-member`, `bad-role`,
  `already-joined` or `bad-message`, end the reconnects with a plain card.

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

**The host is the server's**: the pitch server names the host in every `joined` and
`state` and moves it with `host` frames. When the host has been disconnected for 15 s the
server hands it to the earliest-joined connected player; an observer is never host. The
browser never claims.

The controller keeps the same context object until the members, host or match change.
Seat and actor wrappers cache by context, need and member: repeated render-loop reads
never cross the room bridge. Name cleanup and open-listing reads are cached too.

Whose turn it is shows by name: the status pill says YOUR THROW (marigold), MIGHTY MAPLE THROWS,
COMPUTER THROWS, YOUR RAISE, TEAM B PLACES A KUBB and so on, and the hand-off card leads
with the same line. A card for someone else's turn has a WATCH button and closes itself.
A throw taken for an absent teammate says YOUR THROW FOR <NAME>.

## Being there

- **Aim** (`src/net/aim.js`; the iPhone follows the same numbers). While it is this
  browser's throw, the engine's `aimState()` is sampled 15 times a second and cast as
  `{ t: "aim", s, k, c }` when it changed (`k` counts this browser's samples and starts
  again when the page reloads, so a watcher drops a lower `k` only when it is also stamped
  earlier; `c` is its clock), through the stroke and the release: the release's own frame, the aim as it
  stood just before the throw went, goes at once with `all: true`, which the server
  never thins (observers' casts are thinned to about 10 a second otherwise). A shout
  spends a slot too, so the two stay under the server's 16 casts a second.
  The watcher keeps each sample with the server's `ts` and draws the aim 100 ms behind
  the newest the network could have brought: the clock offset is the smallest
  `arrival - ts` over the last 40 samples, and the render time is `now - offset - 100`.
  Between the two samples around it the continuous fields (`x`, `y`, `tx`, `ty`,
  `release`, `tilt`, `spin`, `back`, `mix`) go in a straight line and `arm` the short
  way round (a jump of half a turn or more is not drawn between); the rest are the
  earlier sample's. Never between two throws (`seq`) or two senders. Past the newest it
  holds the newest. A throw arriving from elsewhere waits until its aim has been drawn:
  `min(250, ts + offset + 100 - now)` ms, or not at all when the last aim is more than
  1.5 s older than the throw.
- **The hand-off while watching**: a card for someone else's turn is a banner at the
  top of the pitch, not a modal: no dimming, the thrower's dial drawn under it, closing
  itself after 2.5 s. It says the same as the card did (whose turn, the bases, WATCH).
- **Pace** (`src/game/pacing.js`, one tune): the pitch rests 0.8 s after a throw lands
  (`restAfterThrow`) and an automatic raise waits 0.7 s per kubb (`autoRaiseWait`). These
  are the values from before the pitch server, and online play keeps them (the owner,
  2026-11-21).
- **Shouts**: SHOUT opens NICE!, OOH!, TOK!, UNLUCKY; each is a cast `{ t: "shout", w }`
  with `all: true`, so the observer feed's thinning never drops it (at most one each
  0.7 s from a browser) and shows for 2.6 s under the rail as the
  sender's name and the word, on every screen including the sender's. Observers cannot
  cast.

## The edges

- **Late arrival**: a browser that arrives during a match gets the whole match in its
  `joined` (the snapshot after the last action) and adopts it at once, watches, and is
  told so for a few seconds ("THE MATCH IS UNDER WAY: YOU ARE WATCHING. PICK A SIDE FOR
  THE NEXT ONE."). It can pick a team in the lobby after the match. A member with no side
  watches with the watcher's view: the wide view and the free camera (docs/OBSERVER.md).
- **Observers** (`/p/<code>?observe=1`, WATCH on the open games list): join with
  `role: "observer"` under a member id of their own. They never take a side, the computer
  or the host (the server never makes one host), never write the document and cannot
  cast, so they have no SHOUT; between matches they see their own card, not the lobby.
  Listed under Watching like anyone on neither team. An observer arriving at a pitch with
  no player connected, or refused `no-pitch` (the pitch server keeps no pitch for the
  code), leaves at once and looks at the api's answer for the code (asked beside the
  join): a kept match, shared (sealed) or a finished pitch's since wiped, is shown as a
  finished match (the result, WATCH REPLAY; JOIN THIS PITCH too when not sealed); only a
  code with nothing kept says "No game here". docs/OBSERVER.md.
- **Someone leaves**: their throws fall to a connected teammate, else the host.
- **The host goes**: the server hands the host on after 15 s (above). The new host runs
  the computer from then on and gets REMATCH.
- **Every socket drops at once** (a deploy, a network change): every browser shows
  RECONNECTING, comes back within a second or so at a random time, resumes from its last
  action, and its actions in flight are sent again and answered once.
- **Full pitch**, a bad code, or the pitch open in another tab of the same browser
  (`replaced`, USE IT HERE reloads): a plain card with a way on. A build with no pitch
  server offers PLAY THE COMPUTER.
- **The end**: the action that ends the match goes with `over: true`; there is nothing
  else to send. Everyone gets the winner card at once (it never waits on `ok`), with
  WATCH REPLAY played from the actions this browser holds. REMATCH is the host's: back to
  the lobby with the same teams (`started: false`, the header dropped); the others read
  who can start one. HOME for everyone. The pitch server pushes the log, `meta` and the
  final snapshot to the api, which keeps the replay (API.md); the page looks for it there
  (`GET /api/replay`) for the reel, the embed and anyone who arrives later. Someone who
  arrives at a finished pitch gets the winner card with the teams and WATCH REPLAY as its
  lead, if the api kept one. After a rematch the lobby offers WATCH THE LAST MATCH until
  the next one ends. A match in play is never offered. A pitch left empty for 48 hours
  is wiped on the pitch server while the api keeps its replay a year: whoever opens the
  link after that gets a new lobby that offers WATCH THE LAST MATCH; an observer's link
  shows that match itself (Observers, above).
- **Watching a replay** (`Pitch.watch`): the pitch stays joined but news waits while the
  replay plays (`ReplayPlayer`, docs/CLIENT.md "Replays"); BACK TO THE PITCH returns to
  where it was and catches up with the pitch. The replay is read only: its seat may never
  act.
- **Resign** (the menu) is for players only, not for those watching.

## What the iPhone app mirrors

The iPhone app (`../throwingwood-ios`, its docs/ONLINE.md) speaks the same wire and must
keep these the same, or the two disagree on screen:

- The message flow above: `join` with `n` and `seq`; `set` for lobby writes; `start` with
  `doc`, `n`, `h`, `snap` and `meta { v: 1, setup, engine, version, players, cpu }`; `act` with
  `id`, `n`, `seq`, `a`, `h`, `snap` (and `over` on the last), resent with the same `id`
  after a reconnect and never waited for; `open` with `{ seats, state }`; `resync` on a
  gap in `s` or a hash that differs; no `keep`, no host claims.
- Reconnects: first try at a random wait under 300 ms, then 1 s doubling to 10 s with a
  quarter of jitter; `ping` after 20 s idle, 10 s to answer.
- Aim: 15 samples a second at most, sent when changed, the release's frame with `all`;
  the watcher's offset (smallest `arrival - ts` over 40), 100 ms behind, the straight
  lines and the arm's short way, never across `seq` or a sender, a throw held at most
  250 ms for its aim.
- Pace: 0.8 s rest after a throw, 0.7 s per automatic raise, until the owner decides.

## Tests

- `tests/net/pitch-client.test.mjs` runs `PitchClient` against the pitch core
  (`tools/pitch-dev.mjs`, in process): codes and addresses; lobby writes that cross;
  actions both ways without waiting for `ok`; a player away resumes exactly the actions
  missed; an `ok` lost and the action resent is answered once (`dup`); every socket
  dropped mid-play with an observer on, nothing lost or repeated; two acting at once
  (`refused`, the whole pitch); a jump in `s`; observers cannot cast and never become
  host; `replaced`; an observer refused at an unknown pitch.
- `tests/net/aim.test.mjs`: the sender's rate and release frame, the straight lines and
  the arm's short way, the offset and the render time, never across a throw or a sender,
  how long a throw waits for its aim.
- `node --test tests/net/room-wrappers.test.mjs` covers the bridge's named arguments,
  `.value` results, null-to-undefined reducer no-ops, unknown top-level fields through
  every document reducer, version admission, opaque snapshots and seat caches. The
  engine's own vector tests cover the shared rules.
- `tests/game/room-version.test.mjs` checks advertised versions, refused START,
  untagged tabs, both refusal cards, reload, disabled team/CPU control and idle
  room-bridge call counts, on desktop and phone against the local pitch server.
- `tests/game/multiplayer.test.mjs` starts `tools/pitch-dev.mjs` and the preview on free
  127.0.0.1 ports and opens each player in their own browser context on one
  `/p/<code>?pitchserver=<ws>&api=<http>` (both honoured only on 127.0.0.1, localhost or
  with `?test=1`; the preview's CSP allows any local port). It plays: two browsers on
  opposite teams, the guest reads the options and waits; the host throws, the guest
  watches the same throw (applied, not adopted) and ends on the same hash; the turn
  passes and the guest throws, the host watches it; a third browser arrives mid-match,
  adopts and watches; a shout arrives; the guest's socket drops and it comes back in
  step; a resignation gives everyone the winner card and the host's REMATCH takes all
  three back to the lobby with the same teams; a finished pitch plays its match again
  from the api's kept replay. Skipped with a notice without Playwright's Chromium.
  `KUBB_MP_SHOTS=build/mp-shots` also saves screenshots.
- `tests/game/pitch-e2e.test.mjs`: two players and an observer in three browsers
  complete a turn in step, and the observer's dial is drawn between the aim samples, not
  only on them. `KUBB_E2E_PITCH=ws://127.0.0.1:8797 KUBB_E2E_API=http://127.0.0.1:8798/api`
  runs it against `wrangler dev` and the api stand-in (`npm run dev` starts both).
- `tests/game/names-client.test.mjs` ("Names"): a page sending a typed name is "Player 1"
  to everyone and plays; two with one name show "II"; the host's team name is seen by
  all and carried by the match; a forged snapshot is not shown and a start naming a typed
  name is refused. `tests/pitch-server/names.test.mjs`: the server's word lists are the
  engine's, its check agrees with `names.valid` on every name and thousands of near
  misses, and the drop and refusals.
- `tests/game/room-engines.test.mjs` and `tests/net/room-engines.test.mjs`: one engine
  carried; a player on an older client is told on both sides and START stays off.

## Not done yet

- A team picks its next thrower only as the engine's order names them; the engine's
  `thrower` action (choosing among `need.candidates`) has no control yet.
- The engine's hand-off card is written from the thrower's side ("YOUR BASE 5, THEIRS
  5"); a browser watching the other team's turn reads the bases from the thrower's view.
- A long match is played through only in part by the tests; a whole match between two
  browsers, and the host leaving mid-match, are not run automatically.
