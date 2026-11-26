# A shared pitch

What happens on `/p/<code>` (without `?solo=1`): the lobby, then a match played by
everyone on the link, each on their own screen. The contract is docs/DESIGN.md 4.3; the
pitch server and its wire are `backend/pitch-server/PROTOCOL.md` (docs/PITCH-SERVER.md);
the calls that are not live (replays, reels, shares, reports, records) are the api,
`backend/api/API.md`; the Game's seam is docs/CLIENT.md. This is the client as built.

| File                              | What it does                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/net/pitch.js`                | `Pitch`, the controller: joins the pitch, runs the lobby, drives the Game, sends aim and hollers.     |
| `src/net/pitch-client.js`         | `PitchClient`, the socket: join and resume, lobby writes, actions in flight, casts, reconnects.       |
| `src/net/aim.js`                  | The aim on the wire: the sender's rate and the watcher's buffer, drawn 100 ms behind between samples. |
| `src/net/api.js`                  | The HTTPS api's one call (`apiCall`), its address from the page's `kubb-config`.                      |
| `src/game/pacing.js`              | The match's online pacing, one named tune (see "Pace").                                               |
| `src/net/lobby.js`                | Wrappers over the engine's `pitch.*` document reducers (what `update(fn)` runs), and `setTeamName`.   |
| `src/net/seats.js`                | Cached wrappers over the engine's seat and actor rules.                                               |
| `src/net/room-engine.js`          | The bridge: `engine.call("pitch.<name>", args).value` on the newest engine or a named one.            |
| `src/ui/lobby.js`                 | `Lobby`, the lobby card.                                                                              |
| `src/ui/welcome.js`               | The welcome card a device new to the game sees before the lobby ("The welcome", below).               |
| `tools/pitch-dev.mjs`             | The pitch core and the api on this machine, for `npm run dev` and the tests (see Tests).              |
| `tests/net/pitch-client.test.mjs` | The socket against the pitch core: resume, retries, every socket dropped, refusals, two clients.      |
| `tests/net/aim.test.mjs`          | The aim maths.                                                                                        |
| `tests/game/multiplayer.test.mjs` | Playwright: real browsers against the local pitch server (see Tests).                                 |
| `tests/game/pitch-e2e.test.mjs`   | Playwright: two players and an observer complete a turn; the observer's dial moves between samples.   |

## The welcome

A device that has never played (no throw of its own kept: `firstVisit`, the `throwsMade`
pref the nudge counts) arriving on someone else's pitch sees one card before the lobby
(the Throwing Wood 1.0 design, "Pitch link welcome"; `src/ui/welcome.js`, its words in
`WELCOME_WORDS`): the game's name as a chip, "<host> invited you to a game of kubb" (the
host's name as the lobby shows it, "You’re invited to a game of kubb" until the pitch
says), the landing page's two sentences on kubb, "You will be" over the device's
generated name with SHUFFLE (a pick is sent at once, as in the lobby), JOIN THE GAME
(the lobby), and the quiet JUST WATCH (the same link with `?observe=1`,
docs/OBSERVER.md) and HOW TO THROW (the how-to, then the welcome again). The page has
joined the pitch underneath, so the host sees the name. The host who made the pitch
(`room.isHost()` at `v` 0) goes straight to the lobby, and a device that has played
before never sees it; the first visit's automatic HOW TO THROW is not shown on a pitch
link to a new device (the welcome offers it). Arriving mid-match, the match takes the
screen; JOIN THE GAME then only closes the card.

## The lobby

Arriving on the link joins the pitch (`config.pitchUrl`, `/ws?pitch=<code>`) under this
browser's member id (`kubb.member` in localStorage) as a `player` with
`me = { name, level, throw, engine, engines }`. `engine` is the
vendored engine's major.minor (`"1.4"`), read from `pitch.constants`. `throw` is the
device's throw level (engine 1.3 on: `"easy"` or `"hard"`, left out for Standard). The lobby card shows:

- **You are**: your name, this device's generated name (`kubb:name`), and SHUFFLE on one
  line (the name row, docs/CLIENT.md "Names"): a pick here or in MENU's Settings is kept
  as the device's name and sent at once (`me.name`). Under it, **Throw**: Easy, Standard
  or Hard, the device's throw level (the `throw` pref, Standard until picked; the same
  row as the solo card's and Settings'), sent at once as `me.throw` (null for Standard,
  which the pitch server takes as "remove"). Shown only while the room engine has
  `THROW_LEVELS` (1.3 on): a pitch that plays 1.0 has no throw levels. `me.level` is
  still sent, the device's stored level (`kubb:level`, Club when never chosen); it
  changes nothing since 0.13.
- **Team A** (marigold) and **Team B** (violet), up to six a side, people and computer
  players together ("Computer players", below), in throwing order, each member with a
  dot for connected and HOST and YOU tags (two with one name: the second "II", "Names"
  below). A side of several shows the name it plays as, the host's to pick in a name row
  (the name and SHUFFLE). JOIN A, JOIN B, or WATCH INSTEAD (quiet) to sit out; the
  host's ADD COMPUTER under each. On a room engine with throw levels each person's row
  ends with their throw ("Bold Birch · Standard throw"). An empty side (nobody and no computer seat) says "The
  computer plays this side." when the other has someone.
- **Watching**: everyone on the pitch on neither team.
- **SHARE THE LINK**: `navigator.share` where there is one, else the clipboard.
- **Who can join**: Invite only ("Only people with the link can join.", the default) or
  Open ("Listed under Open games on the web game’s page: anyone can join."; that list is on the landing page, `/#play`, since the 1.0 design). The host picks;
  everyone else reads it. Starting a pitch from the landing page (`/#play`) with Open picked arrives as
  `/p/<code>?open=1`, and the new pitch's host (at `v` 0) writes it open.
- **The match** options, each a segmented bar: the computer's level, surface, opening,
  raising, wind, the throw to go (engine 1.4, "Throw to go", On or Off) and the scene; no kubb set since the 1.0 design (the scene decides the
  set, as on the solo card: `HIDDEN_ROWS` in `src/ui/lobby.js`; the room's set stays as
  it is, Classic unless an older page chose another). The host sets them
  (and the host's choices are remembered as `kubb:pitchOptions` for their next pitch);
  everyone else reads them.
- **HOME** (quiet) at the left and **START** (go) at the right for the host, allowed with
  at least one player or computer seat on one team (a START the engine's `startCheck`
  refuses for the lineup, a pitch with no person in it, says the engine's own sentence,
  its `text`, in the lobby's note); everyone else reads "Waiting for <host> to start."
  The row stays in reach at the bottom while the card scrolls.

**The throw to go** (engine 1.4) is on by default, though the engine's own default is
off: the host writes `settings.togo` "on" (or "off" when their last pitch had it off)
with `setOptions` when it makes the pitch, and, once a document, into a pitch with no
`settings.togo` that has not started while the room engine has the row (a pitch made
by an older host). A room on 1.0 has no row and never gets the setting.

Teams change only between matches. A member who leaves the pitch for good is taken off their team by the host's browser.

## Computer players

The owner, 2026-11-22: "In online play we should be able to add computer players to the
match, with a specified level. I may have three friends and we want to play a team of
three computers (two at club and one at pro). Or we want to play 2 v 2 where Tyler and I
each have a pro computer player as a partner." Since engine 0.17 (its docs/PITCH.md
"Computer seats", docs/SESSION.md "Computer players") a team holds people, computers or
both, six at most together, each computer at its own level. The numbers and words are
docs/SYSTEM.md "Computer seats".

- **The seat.** A computer player sits in its team's list in its place in the throwing
  order by a seat id no member can have (`"cpu:1"`), its record in the document's
  top-level `computers` (`{ level, name }`). The host's ADD COMPUTER writes
  `pitch.addComputer` (at Club, named by the engine from the host's own draw), the
  seat's level bar `setComputerLevel` (Beginner, Club, Pro), ↑ ↓ and TO A / TO B
  `moveComputer` (a place in the order, or last on the other team) and REMOVE
  `removeComputer`, through `src/net/lobby.js` like every lobby write. Everyone else
  reads the row, "Bold Birch · computer · Pro". A row whose id `isSeat` says is a seat is
  drawn from `computers`, never looked up as a member; its name shows only where
  `names.check({ document, members })` passes `computers.<id>.name`, else "Computer".
- **Kid.** The Computer setting is the match's: Kid there with any computer in the match
  makes a Kid match, every computer plays as the Kid computer, and the seats read Kid
  (each keeps its own level, which comes back when Kid is switched off). The Computer
  row is "An empty side plays as" while a side has nobody and no seat; with no empty
  side and a seat on the pitch it is a "Kid match" Off / On switch; with neither it is
  not shown.
- **START.** `lineup` has each seat in its place (`cpu: true`, its level); a side of
  computers only is not empty. `startCheck` refuses a lineup with no person, a team over
  six or a seat's bad level, with `why` and a sentence, `text`, which the lobby shows.
  The match header's `players` keep `cpu` and `level` on computer players, and a team of
  several (people, computers or both) plays under the host's team name.
- **Who throws.** The team's throwing order decides every throw, so a computer partner
  takes its share of the batons, and the kubbs go round a team with a computer in it
  turn by turn. A computer player's throw is the host's browser's (`control.cpu`, the
  engine's `need.cpu`): no person ever gets controls for it, and everyone else sees it
  arrive as the host's action. A host change mid-throw gives the new host's browser
  `control.cpu`: it adopts the pitch's snapshot and throws (`refreshSeat`).
- **What the rules give the team.** A team with a person on it raises and places
  punishment kubbs by its people (any of them connected); a team of computers does it
  itself, at its strongest player's level, and the raises are watched from the next
  throw need's `setup.settled` (docs/SYSTEM.md "Watching a raise").
- **What is shown.** The header's line ends "· computer · Pro" while a computer player
  throws, the status pill says "BOLD BIRCH THROWS · COMPUTER · PRO", and the hand-off
  (and the watched turn's banner) adds "Bold Birch throws first · computer · Pro" when
  the turn opens with one (`card.handoff.throwerCpu`). The winner card, the score sheet
  (`[Throw Levels]` names each computer player with its level), the replay, the embed,
  the share card and the reel name computer players by their generated names: the
  engine's, from the match.
- **Open games.** `openListing`'s `seats` is the twelve places less the seats.

## The document

One shared lobby document per pitch, written with compare-and-set (`set {v, doc}`: the
server takes it only at the version this browser read; `PitchClient.update(fn)` runs `fn`
again on the newer document when another write landed first). Only the reducers in
kubb-engine's `pitch/lobby.lua` write it, through `src/net/lobby.js`:

```js
{
  v: 1,
  teams:    { A: [memberId | seatId, ...], B: [...] },  // throwing order, 0 to 6 each
  computers: { seatId: { level, name } },      // engine 0.17: only while a seat exists
  teamNames: { A, B },                         // the host's team names (setTeamName)
  options:  { surface, opening, raising, wind, set },
  settings: { computer, scene },               // engine 0.9: the computer's level, the scene
  open:     false | true,                      // listed under Open games
  started:  false | true,
  n:        0,                                 // matches started on this pitch
  match:    null | {                           // the header only
    n,                                         // this match's number
    players: { A: [{ id, name, cpu?, level? }], B: [...] },  // frozen at START
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
(`docs/ENGINES.md` "Playing together": that engine's `pitch.startCheck` and
`pitch.startMatch` receive the current members as `pitch.speakAs` gives them), then sends
one `start { v, doc, n, h, snap, meta }`: the document with `started: true`, `n + 1` and
the header, and beside it the snapshot, its hash and `meta`. The server takes it only at
`v` (a write that crossed it means another try from the top, at most three). Team A
throws first.

## Names

Every name on a pitch is a generated one (docs/CLIENT.md "Names"; the engine's
docs/NAMES.md section 6). A client offers only generated names, but a client is not
proof, so each boundary checks:

| Where a name enters                                                                       | Who checks                                                                                                                                                   | When it fails                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| a member's `me.name` (join, `me`, waking)                                                 | the pitch server (`checkedMe`, `backend/pitch-server/core.mjs`)                                                                                              | dropped, never refused: the member stays, with no name, shown to all as "Player n"            |
| the document's `teamNames`, the header's players, a start's `meta` (players, setup teams) | the pitch server (`badNames`, on `set` and `start`)                                                                                                          | refused `bad-name`: an honest page never sends one                                            |
| any name a page shows                                                                     | the engine, for the page: `names.check({ document, members })` (`Pitch.docNames`)                                                                            | the default for its place, "Player n" or "Team A"/"Team B"                                    |
| a match's snapshot (drawn by the engine)                                                  | the engine, for the page: `names.check({ snap })` on entering, and `restore` with `names: "check"` on every adopt (entering, joining part way, every resync) | the match is not shown: "This match has a name the game did not make, so it cannot be shown." |

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

Room reducers, seat decisions and sync decisions are kubb-engine's `pitch.*`
calls over the same JSON bridge as the session (`kubbCall`). The engine's `docs/PITCH.md`
is their API; its 8,851 recorded vector steps cover the rules. There is no second
JavaScript implementation. `useRoomEngine` reads the newest engine's constants once
during boot; tools that use these wrappers initialize it too. A page can carry older
engines beside it if we decide one is supported (`docs/ENGINES.md`: today 1.4 and 1.0,
"Engine 1.4 on a mixed pitch" below); their calls name the major.minor. A pitch plays on the room's engine, the
newest every player and the host carry; practice, solo and watch on the newest. A player
on an older client leaves no engine in common: both the host and that player are told
"This pitch needs the newest version of the game", and START is off.

Every web build from PR #40 sends its engine’s major.minor in join presence; from
engine 0.8.1 the page sends the room's engine marked `+engines` and every engine it
carries (`docs/ENGINES.md` "Playing together"). `LENIENT_ENGINES` is false. START
checks the host and seated players. When they share no engine the lobby says who and
what to do and START is off. A running match must also name its engine, and is played
only on it. Equal major.minor versions can play across patch releases.

Before taking control of a running match, every member calls `pitch.mayPlay`, including
watchers who could become host and run the computer. A refusal gives no team or CPU
control and hides the player's resignation action. The house-style card says:

- Pitch newer: "This pitch is playing on a newer version of Throwing Wood. Reload to
  join." with RELOAD and WATCH.
- This client newer: "This pitch is playing on an older version of Throwing Wood. Ask
  the host to reload." with WATCH.

A guest on a team in the lobby checks the host's announced engine too. A host whose
START is refused sees which players need to reload; no match is committed.

### Engine 1.4 on a mixed pitch

The web carries 1.4 and 1.0 (`docs/ENGINES.md`). A pitch of web pages (and iPhone
builds on 1.4) plays 1.4; one with an iPhone on 1.0 in it plays 1.0, for everyone. The
lobby is drawn from the room engine's `MATCH_OPTIONS` and constants, so on a 1.0 room
there is no Throw to go row, no Throw row and no throw words in the roster, and the
host writes no `togo`. The match then runs on the 1.0 engine on every web page: no
throw to go, no view from one side (`setView` is a 1.4 call; on 1.0 the pitch turns at
a change of ends as before), raises one kubb after another with the client's own raise
camera and `{ type: "raise", choice }`, punishment kubbs without `frame`, and no throw
level (the `throw` the page announces is ignored). Nothing of 1.4 shows broken: each
control is there only when the match's engine gives it.

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

`pitch.*` seat calls through `src/net/seats.js`, from the match's players, the computer's
side, the room's host and who is connected now (`ctx.connected` is an array of ids):

- **A throw** is for the member whose player the engine names (`need.setup.thrower.key`).
  If they are not connected, the first connected member of that team in throwing order
  takes it (it is still that player's throw on the sheet); failing that, the host.
- **A raise or a punishment kubb** is for any connected member of the defending team,
  else the host. Two at once: the compare-and-set settles it. On 1.4 a raise names its
  kubb and end (`{ type: "raise", kubb, which }`, any lying kubb in any order); a raise
  the engine refuses with `not lying` (a team-mate stood that kubb first) redraws the
  raise from the need. A punishment kubb carries the need's `frame`.
- **The throw to go** (engine 1.4): each side's baton is its first player's member's,
  then a team-mate's, then the host's (`seats.actorsFor`). While the need is a `togo`
  need every browser calls `controlFor { ctx, me, need }` and passes its `togo` list to
  `setControl`, so a host throws only its own side's baton. Both batons are blind: a
  browser that has thrown, or has none to throw, shows "WAITING FOR <TEAM>" and nothing
  of a baton already in; the last baton's action brings the combined recording, played
  on every page, then the verdict ("MIGHTY MAPLE GOES FIRST", or "A TIE: THROW AGAIN" /
  "BOTH HIT THE KING: THROW AGAIN" and the second round). Both sides release at once,
  so both commits can be for the same seq: the pitch takes the first and refuses the
  other (`refused`). The refused browser keeps its baton's action, takes the pitch's
  state (`resync`), and, while the need still owes that side's baton in that round,
  applies the same action again and commits it as the next seq. Its baton is not lost
  and its player does not throw twice.
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

Each player sees the match from their own end (engine 1.4 `setView`, the side this
browser plays): their team's throws from behind, their team-mates' alongside, and the
other team's from the end camera, so the pitch never turns at a change of ends. A
browser with no side, an observer and a watcher keep the wide view. A throw this
browser aims for the other side (the host standing in for a player who left) is seen
from the thrower's end (`setView` with that side), because the aim calls (`setTarget`,
`setStance`) take the thrower's frame; the view goes back to the player's own end
after it.

Whose turn it is shows by name: the status pill says YOUR THROW (marigold), MIGHTY MAPLE THROWS,
COMPUTER THROWS, YOUR RAISE, TEAM B PLACES A KUBB and so on, and the hand-off card says
"Your turn" or the name's ("Mighty Maple’s turn"; the 1.0 design's short card with one
line, docs/CLIENT.md "Match flow"). A card for someone else's turn has a WATCH button and
closes itself.
A throw taken for an absent teammate says YOUR THROW FOR <NAME>.
When the member whose turn it is has gone (QA, 2026-11-22), everyone else's line under
the status pill says so and what happens next, from the same seats (`Pitch.awayLine`,
its words `AWAY_WORDS`): "HAPPY HAZEL IS AWAY. WAITING FOR THEM TO COME BACK." while
nobody connected may act for them (the host is away too; the pitch hands the host on
after 15 s), "HAPPY HAZEL IS AWAY. GENTLE GINKGO THROWS FOR THEM." (RAISES, PLACES for a
raise or a punishment kubb), or "... YOU THROW FOR THEM." to the one who stands in. It
clears when they are back; RECONNECTING, a browser's own drop, comes first.

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
  itself after 2.5 s. It says the same as the card does (whose turn, the one line, WATCH).
- **Pace** (`src/game/pacing.js`, one tune): the pitch rests 0.8 s after a throw lands
  (`restAfterThrow`) and an automatic raise's first kubb lies 0.4 s (`autoRaiseWait`),
  then each is watched for half a second, 4 s at most (`src/game/lift.js` `liftPace`;
  0.7 s a kubb before web 0.17.0, when raises were not watched). The rest is the value
  from before the pitch server, and online play keeps it (the owner, 2026-11-21).
- **HOLLER** (`src/ui/holler.js` over `src/net/hollers.js`): HOLLER under the rail
  opens a panel of 24 phrases in four groups (CHEERS, GROANS, BANTER, CALLS, one group
  at a time on a segmented bar) and 12 emoji; one tap on one sends it and closes the
  panel. The panel stands where it covers neither the tray nor the meter
  (`hollerPlace`, `hollerKeep`) and scrolls inside itself where it is short; Escape or
  a press outside closes it. A phrase is the cast `{ t: "shout", w }`, an emoji
  `{ t: "shout", e }` with no `w`, each with `all: true`, so the observer feed's
  thinning never drops it (at most one each 0.7 s from a browser, spending the aim's
  slot). It shows for 2.6 s under the rail as the sender's name and the phrase, or the
  emoji drawn large, on every screen including the sender's. A receiver draws only an
  exact member of the list and drops anything else without a word, so no text a player
  could write ever reaches a screen. Observers cannot cast. The list is under "What the
  iPhone app mirrors".

## The edges

- **Late arrival**: a browser that arrives during a match gets the whole match in its
  `joined` (the snapshot after the last action) and adopts it at once, watches, and is
  told so for a few seconds ("THE MATCH IS UNDER WAY: YOU ARE WATCHING. PICK A SIDE FOR
  THE NEXT ONE."). It can pick a team in the lobby after the match. A member with no side
  watches with the watcher's view: the wide view and the free camera (docs/OBSERVER.md).
- **Observers** (`/p/<code>?observe=1`, WATCH on the open games list): join with
  `role: "observer"` under a member id of their own. They never take a side, the computer
  or the host (the server never makes one host), never write the document and cannot
  cast, so they have no HOLLER; between matches they see their own card, not the lobby.
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
- Pace: 0.8 s rest after a throw; an automatic raise's first kubb 0.4 s, then half a
  second a kubb, 4 s at most.
- Engine 1.4 (web 1.5.0): `me.throw` (`"easy"`, `"hard"`, absent for Standard) and the
  roster's "· Easy throw" words; the host's `settings.togo` "on" by default, written
  when the pitch is made and once into a pitch that lacks it before START, never on a
  1.0 room; the throw to go's control from `controlFor { ctx, me, need }`, "WAITING FOR
  <TEAM>" with nothing of the other baton shown, the recording played and the verdict
  words after; a baton to go refused for its seq applied again and committed after
  the resync; raises as `{ type: "raise", kubb, which }` (AUTO: `{ type: "raise",
kubb }`, the end the engine's), a `not lying` refusal redrawn;
  `{ type: "punish", x, y, frame }`; `setView` with the player's own side (the
  thrower's while standing in for the other side's throw). On a 1.0
  room none of these: the lobby rows come from the room engine, and the match is
  played as on 1.0.
- HOLLER: the list below, in this order, exactly (its one source is
  `src/net/hollers.json`, read by the panel, the receiver and the tests; copy it from
  there). A phrase is sent as the cast `{ "t": "shout", "w": "<phrase>" }`, an emoji as
  `{ "t": "shout", "e": "<emoji>" }` with no `w`, with `all: true`, at most one each
  0.7 s, spending the aim's slot. A receiver shows a `w` only when it is exactly one of
  the 24 phrases and an `e` only when it is exactly one of the 12 emoji, and drops
  anything else silently: never draw text that is not on the list. Observers send none.
  An app on an older list (the iPhone's App Store 1.0.0 knows only NICE!, OOH!, TOK!
  and UNLUCKY) shows nothing for the others.

  | Group  | Phrases                                                                                    |
  | ------ | ------------------------------------------------------------------------------------------ |
  | Cheers | `NICE!`, `NICE STICK!`, `HOLY COW!`, `LIGHTS OUT!`, `YOU CAN DO IT!`, `NEXT ONE!`          |
  | Groans | `OOH!`, `UNLUCKY`, `OH NO!`, `TICKLED IT!`, `KNOCKERHEAD!`, `SO CLOSE!`                    |
  | Banter | `SHORT PORCH!`, `WOOD ON WOOD!`, `CHERRY PICKED!`, `NO PRESSURE`, `WATCH THIS`, `TOO EASY` |
  | Calls  | `TOK!`, `DOUBLE!`, `WOODPILE!`, `IN THE BASKET!`, `EIGHT METER!`, `KING SHOT!`             |

  Emoji: 🎯 🔥 🎉 😮 😬 😅 😭 😏 😂 👀 👑 🪵

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
- `tests/game/welcome-client.test.mjs`: a device new to the game sees the welcome, naming
  the host, with SHUFFLE, HOW TO THROW and back, and JOIN THE GAME into the lobby under
  the name picked; a device that has played, and a new host, go straight to the lobby;
  JUST WATCH reopens the link as an observer. The pitch tests' own browsers are devices
  that have played (`played` in `tests/game/browser.mjs`).
- `tests/net/computer-seats.test.mjs`: the seat wrappers (add, level, move within and
  across, remove, null to undefined), six a team counting seats, the owner's two
  lineups, the open listing's seats, START with no person refused in the engine's
  words, a Kid pitch, a refused seat name, and the words.
- `tests/game/computer-seats-client.test.mjs`: the owner's two examples in two and three
  browsers, played until every seat has thrown, a person has raised and (three people
  against two club and one pro) the computers' team has raised itself; no person is
  ever given a computer's throw; the header, pill and hand-off name the computer; then
  the host leaves mid-throw of a computer, the next host's browser throws it, and the old
  host comes back in step; the 2 v 2's winner card and score sheet name every player.
  The lobby: a seat added, re-levelled (said once; the keyboard kept), moved across and
  removed, six a team, START with no person, two full teams on a phone upright, Kid with
  seats; and the pitch server's refusal of a typed seat name.
  `KUBB_SEAT_SHOTS=<dir>` saves the screenshots; `KUBB_E2E_PITCH=ws://127.0.0.1:8797
KUBB_E2E_API=http://127.0.0.1:8798/api` runs them against `npm run dev` (the Worker in
  workerd, whose host passes on after 15 s).
- `tests/game/room-engines.test.mjs` and `tests/net/room-engines.test.mjs`: one engine
  carried; a player on an older client is told on both sides and START stays off.

## Not done yet

- **A solo team** (a person with a computer partner on one device, no pitch). The engine
  plays it already (`newMatch` with `{ cpu: true, level }` entries and no `cpu` option;
  `setControl` is not needed). What the web would need: the solo card to take a lineup
  (a team list per side with ADD COMPUTER and the seat rows, from the lobby's parts but
  with no document: local state the card owns), `startSolo` to pass those teams instead
  of `cpu: "B"`, the Game's seat for one device acting for every person and the
  computer (`seat.sides` both, `cpu` true), and the solo hand-off and pass cards for a
  team of several on one device; the kept match and its resume card (`soloKept`) to
  keep the lineup. No engine change.

- A team picks its next thrower only as the engine's order names them; the engine's
  `thrower` action (choosing among `need.candidates`) has no control yet.
- A long match is played through only in part by the tests; a whole match between two
  browsers, and the host leaving mid-match, are not run automatically.
