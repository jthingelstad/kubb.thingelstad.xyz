# The pitch protocol

The wire protocol of a live pitch, as built in `core.mjs` beside this file. The web and
iPhone clients are written from it. The design and the reasons are
[`docs/PITCH-SERVER.md`](../../docs/PITCH-SERVER.md); where the two differ, this file is
what the server does. The Cloudflare Worker and Durable Objects that serve it are
`src/` beside this file (deploying and operating them: [`README.md`](README.md)). It is
the live server since 2026-11-21; the rooms server it replaced (`docs/ROOMS.md`) is
deleted.

The pitch knows no Kubb. It keeps who is on the pitch, the host, one lobby document,
the current match's head and its action log, and relays casts. It never runs the
engine: clients run it and cross-check hashes, as they do today. The one thing it reads
is names (section 6a): it checks every name it can see against the engine's own word
lists.

## 1. Connecting

One WebSocket per pitch: `wss://<host>/ws?pitch=<code>` (the address is still the
owner's call, section 11 of the spec). A code is 8 to 24 of
`23456789abcdefghjkmnpqrstuvwxyz`. Every message both ways is one JSON object as one
text frame, with a type `t`. There is no splitting into parts: a frame may be as large
as the limits below (the iPhone's `maximumMessageSize` of 32 KB must be raised; a join
with the full state is larger).

The upgrade is refused before it reaches the pitch with HTTP 426 (not a WebSocket
upgrade), 400 (no code, or not a code) or 403 (an `Origin` header that is not one of the
site's origins). A request with no `Origin` at all, as the iPhone app's
`URLSessionWebSocketTask` sends it, is let through: the Origin check keeps other web
pages out, not other programs.

A literal text frame `ping` (not JSON) is answered `pong` by the runtime without waking
the pitch: use it as the keep-alive. `{ "t": "ping" }` is answered by the pitch with
`{ "t": "pong", "ts" }`, its clock in ms.

A connection must `join` before anything but `ping`. One connection is one member.

## 2. Stamps

- `s`, the pitch sequence. It goes up by one with every frame that changes the pitch
  for everyone: `member`, `left`, `host`, `doc`, `start` and `act`. Every connected
  member sees each of those exactly once, either as the frame or (for its own write) as
  its `ok`, so a jump in `s` means something was missed: send `resync`. `joined` and
  `state` carry the current `s`. `s` survives the pitch sleeping and restarting.
- `ts`, the server's clock in ms when it handled the message.
- A `cast` carries the current `s` (not a new one) and its own `ts`. Interpolate aim by
  `ts`, about 100 ms behind.

## 3. Members and roles

A member is a member id (8 to 40 of `A-Z a-z 0-9 _ -`) with a role, fixed for as long
as the member is on the pitch:

- `player`: may write the lobby, act, cast and host. Up to 16 (12 seats and 4 more in
  the lobby).
- `observer`: read only. Never acts, writes the document, casts or hosts. Gets every
  frame but a thinned cast feed. Up to 20 (an option; the cap is the owner's call). An
  observer's member id must be its own, never the device's player id.

A member view: `{ id, role, connected, joined, since, me }`. `joined` orders members (it
is the join time, made unique); `since` is when the member last connected or went away;
`me` is the member's own small object (name, level, engines; at most 512 bytes as JSON).
Its `name`, when it is not a generated name or a default, is dropped (section 6a).

When a role is full, the member of that role away longest gives up their place (never
the host) and the others get `left`. With nobody away, the join is refused `full`.

The same member on a second connection replaces the first: the first gets
`error replaced` and is closed with code 4001.

## 4. The host

The first player on the pitch is its host. The host starts matches and keeps the open
listing; the clients' own rules give it the computer and absent players' turns.

- When the host's connection goes, the host is kept for `hostGraceMs` (15 s). If it is
  back by then, nothing changes.
- After that, the host passes to the earliest-joined connected player, and everyone
  gets `host`. With no player connected it waits, and passes to the next player who
  connects.
- A host who sends `leave` passes it at once (`left` carries the new host, or `null`
  when no player is on).
- Observers are never host. The pitch decides all this itself: there is no `claim`,
  and an observer never needs to leave and join again.

`member` and `left` frames carry `host`, so a client always knows it.

## 5. Client to pitch

`id`, where a message has one, is the client's own: a string of 1 to 64 of
`A-Z a-z 0-9 _ -` (or, outside `act`, a safe integer). It comes back on the answer.

### join

```json
{
  "t": "join",
  "member": "<id>",
  "role": "player",
  "me": { "name": "Mighty Maple" },
  "v": 3,
  "n": 2,
  "seq": 41,
  "create": true
}
```

- `role`: `player` (the default) or `observer`.
- `me`: merged into the member's fields (a `null` value removes a field). A `name` that
  fails the names check is dropped, never refused (section 6a).
- `v`: the lobby document version this client holds; when it is the current one the
  answer leaves the document out.
- `n`, `seq`: the match and the last action this client holds, to resume (section 7).
- `create`: only read when the pitch option `unknownPitch` is `refuse`: a join to a code
  nobody has used is refused `no-pitch` unless it says `create: true`.

An observer's join to a pitch nobody has used is always refused `no-pitch`, and leaves
nothing behind. Answered `joined`; the others get `member`.

### me

`{ "t": "me", "me": { "level": "club" } }`: merged as in join, the name checked as in
join. Everyone (the sender too) gets `member`, with the member as the pitch keeps it.

### set: a lobby write

```json
{ "t": "set", "id": "w7", "base": 3, "doc": { "teams": {}, "options": {} } }
```

Compare-and-set: written as version `base + 1` only when the pitch's version is `base`.
A document whose `teamNames` or `match.players` holds a name that fails the names check
is refused `bad-name` (section 6a).
Answered `ok` (`re: "set"`) with the others getting `doc`, or `no` with the current
document. The document is the lobby only: never the match's snapshot or log. At most
64 KB as JSON. Players only.

### start: a lobby write that starts the next match

```json
{
  "t": "start",
  "id": "go",
  "base": 4,
  "doc": { "started": true },
  "n": 3,
  "h": "<hash at the start>",
  "snap": "<the engine's first snapshot>",
  "meta": { "engine": "0.13", "setup": {}, "players": {}, "cpu": null }
}
```

The host only. `n` must be the next match number (the last match's plus one; 1 on a new
pitch). `base` as for `set`. `snap` is the engine's text, carried as given and never
parsed. `meta` is opaque to the pitch (at most 16 KB): put in it what a replay needs
besides the log (the engine's `setup`, the engine version, the players). The previous
match's log is dropped. Answered `ok` (`re: "start"`); the others get `start` with the
snapshot; a stale `base` is answered `no`. A start whose document (as for `set`) or
`meta` (`players`, `setup.teams`: a team's name, or on a side of one player that player's,
and each player's) holds a name that fails the names check is refused `bad-name` (section
6a). The snapshot is opaque and not read: the clients check its names through the engine
(`names.check`, and `restore` with `names: "check"`), and do not show a match whose
snapshot holds one that fails.

### act: commit one action

```json
{
  "t": "act",
  "id": "<unique>",
  "n": 3,
  "seq": 42,
  "a": {},
  "h": "<hash after>",
  "snap": "<snapshot after>",
  "over": true,
  "c": "web"
}
```

- `id`: the action's own id, unique within the match. Resend freely after a drop.
- `n`, `seq`: the match and its next sequence (the head's plus one).
- `a`: the action, a JSON object (at most 4 KB). `h`: the hash after it (a string of at
  most 128 characters, or a number). `snap`: the snapshot after it (at most 64 KB),
  kept as the head and never relayed.
- `over`: true on the action that ends the match. The pitch then takes no more actions
  for it and reports the kept replay.
- `c`: optional client tag (`web`, `ios`), kept in the record only.

Decided in this order:

1. `id` already in this match's log: answered `ok` again with its stored `seq`, `s`
   and `ts` and `dup: true`. Not stored or relayed again, whatever `seq` it claims now.
2. Refused, with `why` and the head: `no-match` (no match started), `match` (`n` is not
   the current match), `over` (the match has ended), `seq` (not the head plus one: two
   players acted at once and the other was first, or this client is behind), `full`
   (the match has logged `actsMax` actions).
3. Stored: the others get `act` (without the snapshot) and the sender `ok`.

Players only; the pitch does not know whose turn it is (that is the engine's, in the
clients). Two players acting at once: the pitch handles one message at a time, so the
first is stored and relayed, and the second is refused with the new head; the loser has
already received the winner's `act`, so both hold the same log.

### cast: aim and shouts

```json
{ "t": "cast", "d": { "t": "aim", "s": {} }, "all": true }
```

`d` is opaque. Relayed at once to every other player. Observers get a thinned feed
(section 8), unless `all` is true (a shout, the last aim before a release), which
reaches them whatever the thinning. At most 2 KB a message and 16 a second (a burst of
24); over that, casts are dropped and the sender gets one `error rate` (`re: "cast"`)
until it slows. Never persisted. Players only.

### open: the open games list

`{ "t": "open", "open": { "seats": 12, "state": "waiting" } }`, or `"open": null` to
take it off. The host only. `seats` 1 to 12; `state` `waiting`, `playing` or `over`.
Not answered. The pitch counts the players and watchers itself and lists the game while
it is open, not `over`, someone is on it, a seat is free and a player could get in.

The list itself is plain HTTPS, not the socket: `GET https://<host>/open` answers

```json
{
  "now": 1795280938959,
  "games": [
    {
      "pitch": "k7mpq2rstw",
      "made": 1795280000000,
      "age": 938959,
      "players": 3,
      "watchers": 1,
      "seats": 12,
      "state": "waiting"
    }
  ]
}
```

the newest 20 games made in the last 24 hours, newest first: counts, state and age (ms
since the pitch was made), never names or member ids. CORS lets the site's origins read
it; it may be up to 5 s old (`cache-control: public, max-age=5`). A listing the pitch
has not refreshed for 15 minutes drops off by itself, so a pitch that dies unseen leaves
the list within 15 minutes. Poll it every 30 s or so while the list is on screen.

### resync

`{ "t": "resync" }`: answered `state`, the whole pitch. Send it on a hash that
disagrees, a jump in `s`, or a refusal this client cannot explain.

### leave

`{ "t": "leave" }`: off the pitch for good (the member is forgotten; joining again later
makes a new member, last in line). Answered `bye`; the others get `left`. Close the
socket after it. Closing without `leave` keeps the member, marked away.

## 6. Pitch to client

| `t`       | To                                          | Fields                                                                                                |
| --------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `joined`  | the joiner                                  | `pitch, you, role, host, s, ts, members, limits, v, by, doc?, match`                                  |
| `state`   | the asker (`resync`)                        | `s, ts, host, members, v, by, doc, match` (always full)                                               |
| `member`  | everyone else (join), everyone (`me`, away) | `member, host, s, ts`                                                                                 |
| `left`    | everyone left                               | `id, host, s, ts`                                                                                     |
| `host`    | everyone                                    | `host, s, ts`                                                                                         |
| `doc`     | everyone but the writer                     | `v, by, doc, s, ts`                                                                                   |
| `start`   | everyone but the host                       | `m, v, by, doc, n, h, snap, meta, s, ts`                                                              |
| `act`     | everyone but the actor                      | `m, s, ts, id, n, seq, a, h, over?`                                                                   |
| `cast`    | other players; observers thinned            | `m, s, ts, d`                                                                                         |
| `ok`      | the writer                                  | `re: "set"`: `id, v, s, ts`. `re: "start"`: `id, v, n, s, ts`. `re: "act"`: `id, n, seq, s, ts, dup?` |
| `no`      | the writer                                  | `re, id, v, by, sid, doc`: the current document                                                       |
| `refused` | the actor                                   | `id, n, seq, why, head: { n, seq, h, over } \| null`                                                  |
| `bye`     | the leaver                                  | `ts`                                                                                                  |
| `pong`    | the asker                                   | `ts`                                                                                                  |
| `error`   | the sender                                  | `code, message, re?, id?` (and `n` on `bad-match`)                                                    |

`by` is the member id of the document's last writer (null before any write); `sid` the
`id` of that write. `m` is the member id of the sender. `members` is sorted by `joined`.

`match` in `joined` and `state` is `null` before the first start, or:

- `{ n, seq, h, over, full: false, acts: [<act frames>] }`: resuming, the actions after
  the client's `seq`, as they were first relayed (their own `s` and `ts`);
- `{ n, seq, h, over, full: true, at, h0, meta, snap }`: the whole match: its start
  info, the hash at the start, and the snapshot at the head.

`limits` in `joined`: `players, observers, messageBytes, docBytes, metaBytes, snapBytes,
actionBytes, meBytes, castBytes, msgRate, msgBurst, castRate, castBurst, observerCastMs,
resumeMax, seatsMax, hostGraceMs`.

### Error codes

| `code`           | When                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `bad-message`    | not JSON, not `{ t }`, an unknown `t`, or a field of the wrong shape                       |
| `too-big`        | over a size limit (the message, the document, a snapshot, an action, `me`, `meta`, a cast) |
| `rate`           | over the message or cast rate (said once until it slows)                                   |
| `not-joined`     | anything but `ping` or `join` before joining                                               |
| `bad-member`     | not a member id                                                                            |
| `bad-role`       | the member is on the pitch with the other role                                             |
| `already-joined` | this connection is another member                                                          |
| `no-pitch`       | an observer at a pitch nobody has used; or `unknownPitch: "refuse"` without `create`       |
| `full`           | that role is full and nobody is away                                                       |
| `replaced`       | this member connected somewhere else (then closed, 4001)                                   |
| `observer`       | an observer tried to act, write or cast                                                    |
| `not-host`       | `start` or `open` from someone not host                                                    |
| `bad-name`       | a `set` or `start` naming a name the game does not make (section 6a)                       |
| `bad-match`      | `start` with a match number that is not the next one                                       |

## 6a. Names

Every player and team name is generated from the engine's word lists (the engine's
docs/NAMES.md); none is typed. A client is not proof, so the pitch checks every name it
can see, in JavaScript (`names.mjs`), against `names-words.json`, the engine's own
`names.words` answer (written from the vendored engine by `tools/names-words.mjs` and
held to it by `npm run check`; its `hash` is the engine's, so a client can tell it holds
the same words). The rule is the engine's: a name is valid for a kind (`player` or
`team`) when it is a string of at most `max[kind]` characters (16), its words split on
single spaces, it is not in `never`, no word begins with the word before it, and it
matches one of the kind's shapes word for word. The engine's own names for no name
(`defaults`: "Computer", "Team A", "Team B", "Player 1" to "Player 6") pass too.

| Name                                                                         | Checked as                                  | When it fails                              |
| ---------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| a member's `me.name` (`join`, `me`, and members kept from before, on waking) | a player name                               | dropped: the member is kept with no `name` |
| the document's `teamNames` (`set`, `start`)                                  | a team name                                 | the write is refused `bad-name`            |
| the document's `match.players[side][i].name` (`set`, `start`)                | a player name                               | refused `bad-name`                         |
| `start`'s `meta.players[side][i].name`                                       | a player name                               | refused `bad-name`                         |
| `start`'s `meta.setup.teams[side].name`                                      | a team name, or on a side of one a player's | refused `bad-name`                         |
| `start`'s `meta.setup.teams[side].players[i].name`                           | a player name                               | refused `bad-name`                         |

A member with no name is shown by every client as "Player n", the engine's name for a
player with none (n their place on their side). So a client that sends a typed name (an
old build, or anyone writing their own messages) joins and plays, and everyone, itself
included, sees it as "Player n". Refusing it would lock it out; dropping it keeps it in
without its text. A document or a start naming a typed name is refused, because no
honest client sends one: a page checks its lineup and team names before START.

## 7. Resume

A client that comes back joins again with `v` (the document version it holds) and `n`
and `seq` (the match and the last action it holds). The pitch answers:

- the document only if the client's `v` is not the current one;
- with `n` the current match and `seq` at most `resumeMax` (64) behind the head: exactly
  the actions it missed (`full: false`), nothing when it holds the head;
- otherwise (another match, too far behind, ahead of the head, no `n`): the whole match
  (`full: true`).

Then compare `h` with your own hash at that `seq`: if it differs, `resync`.

The members list in `joined` is always whole. Casts are never replayed.

## 8. The observer feed

Each player's casts reach observers about 10 times a second at most, decided as each
cast arrives (no timers, so the pitch can sleep): a cast passes when it arrives at or
after its sender's due time, and each one passed moves the due time on by
`observerCastMs` (100 ms) from the last due time, but never to less than
`observerCastGapMs` (50 ms) after now. So aim sent at 15 Hz reaches observers at 10 Hz
on average, never two closer than 50 ms, and never more than `T / 100 + 2` in any span
of `T` ms. Thinned casts are dropped, not delayed. (The proof of concept's rule, at most
one per 100 ms, gave 7.5 Hz from 15 Hz input.) `all: true` passes regardless.

## 9. Limits

| Limit                 | Value                                |
| --------------------- | ------------------------------------ |
| players / observers   | 16 / 20 (option)                     |
| one message           | 128 KB (UTF-8)                       |
| lobby document        | 64 KB as JSON                        |
| snapshot              | 64 KB                                |
| action                | 4 KB as JSON                         |
| `meta`                | 16 KB as JSON                        |
| `me`                  | 512 B as JSON                        |
| cast                  | 2 KB                                 |
| messages a connection | 30 a second, a burst of 60           |
| casts a connection    | 16 a second, a burst of 24           |
| resume by actions     | 64 behind at most                    |
| actions a match       | 10 000                               |
| open listing seats    | 1 to 12                              |
| host grace            | 15 s                                 |
| open listing refresh  | every 5 minutes while listed         |
| a pitch nobody is on  | wiped 48 hours after its last change |

Rates and the thinning are kept in memory only: they start afresh when the pitch wakes,
which happens only after it has been idle longer than any of their windows.

## 10. For the Durable Object

`core.mjs` exports:

- `rebuildPitch({ code, stored, conns, now, options, alarm }) -> { state, effects }`:
  build the pitch from storage (in the constructor, inside `blockConcurrencyWhile`).
  `stored` is the six records below (all absent for a new code); `conns` is
  `ctx.getWebSockets()` as `{ conn, member, role }` from each socket's attachment;
  `alarm` is `await ctx.storage.getAlarm()` (null for none). The saved `alarmAt` can be
  ahead of the real alarm when the object died between a persist and its alarm effect,
  so the core compares the deadline it needs with the real one and returns an `alarm`
  effect when they differ; left out, it always returns one. A member written as
  connected whose socket is gone is marked away and the others are told, so carry out
  the effects.
- `step(state, event) -> { state, effects }`, with `event` one of
  `{ type: "frame", conn, text, now }` (`webSocketMessage`),
  `{ type: "close", conn, now }` (`webSocketClose` and `webSocketError`),
  `{ type: "tick", now }` (`alarm`) and `{ type: "pushed", k, now }` (the AWS function
  confirmed push `k`). It changes `state` in place.
- `createPitch`, `resolveOptions`, `LIMITS`, `OPTIONS`, `thinAllow`, `matchView`,
  `listingEntry`, `keptReplay`, `utf8Length`, `PITCH_CODE`, `MEMBER_ID`, `ACT_ID`.

`conn` is any string the object gives each socket (kept in its attachment). Options:
`{ commitOrder, unknownPitch, limits: { ...overrides } }`.

### Effects

Carry them out in the order given, synchronously where the platform allows (SQLite in a
Durable Object is synchronous), and serialize each `send` frame once.

| `kind`    | Fields                                                                    | The object does                                                                |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `send`    | `to: [conn], frame`                                                       | `JSON.stringify(frame)` once, send it to each socket (ignore one that is gone) |
| `close`   | `conn, code, reason`                                                      | close that socket                                                              |
| `attach`  | `conn, member, role`                                                      | `serializeAttachment({ conn, member, role })` (`member: null` after a leave)   |
| `persist` | any of `pitch, doc, members, match, head, acts, clearActs, outbox, unbox` | one transaction (below)                                                        |
| `push`    | `k, made, topic, body`                                                    | send to the AWS function, signed (topics below); retry, never block the pitch  |
| `listing` | `pitch, entry \| null`                                                    | tell the `LobbyDO`: list `entry`, or take the pitch off                        |
| `alarm`   | `at \| null`                                                              | `setAlarm(at)`, or `deleteAlarm()`                                             |
| `wipe`    | none                                                                      | `deleteAll()`: the pitch is new again                                          |

With `commitOrder: "relay-first"` (the default) the `persist` comes after the frames;
with `write-first` before them. `push`, `listing` and `alarm` always come last.

### Persisted records

All small but `head` (one snapshot) and `doc`. Written whole when present, except the
log:

| Record      | Shape                                                                | Written                                              |
| ----------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| `pitch`     | `{ code, made, s, host, hostAway, open, listing, alarmAt, touched }` | every change                                         |
| `doc`       | `{ v, by, sid, text }` (`text`: the document as JSON)                | each lobby write                                     |
| `members`   | `[{ id, joined, since, role, me, on }]` (`on`: connected)            | member changes                                       |
| `match`     | `{ n, meta, h0, at }`                                                | each start                                           |
| `head`      | `{ n, seq, h, snap, over }`                                          | each start and action                                |
| `acts`      | a list of `{ n, seq, id, m, a, h, s, ts, over, c? }` to append       | each action                                          |
| `clearActs` | `true`: drop every stored action before appending                    | each start                                           |
| `outbox`    | a list of `{ k, topic, body }` to append: pushes not yet confirmed   | the join that makes the pitch, each start and action |
| `unbox`     | a list of `k` to delete from the outbox                              | each `pushed` event                                  |

### Pushes

| `topic` | `body`                                                     | When                   |
| ------- | ---------------------------------------------------------- | ---------------------- |
| `start` | `{ pitch, n, m, ts, v, doc, meta, h0, snap }`              | each start             |
| `act`   | `{ pitch, n, id, seq, m, a, h, s, ts, over, c?, snap }`    | each stored action     |
| `keep`  | `{ pitch, n, at, started, meta, h0, log: [{ a, h, ts }] }` | the action with `over` |
| `open`  | `{ pitch, host }`                                          | the pitch is made      |

Every push goes through the outbox: it is in the same `persist` as the change it
reports, and stays there until the object sends `{ type: "pushed", k }` once the AWS
function has taken it. On waking, `rebuildPitch` sends every pending push again, so a
restart between the write and the push loses nothing. The function must take a push
idempotently by `(pitch, made, k)` (`made` is on every `push` effect: a code wiped and
used again starts its keys over). Keys: `start:<n>`, `act:<n>:<seq>`, `keep:<n>`, `open`. The
object retries an unconfirmed push itself, with backoff; while any push is pending the
pitch is never wiped.

`start` and `act` are the recorded game (every match is recorded). `keep` is the kept
replay, built by the pitch from its own log (no client uploads it): `{ ...meta, h0, log }`
is the engine's replay when `meta` carries the match's `setup` and `engine`. It has no
member ids.

`open` is sent once, by the join that makes the pitch (a fresh object, or a code wiped
and used again): `host` is that player's checked name (a generated player name; null
when its `me` has none). It is only for the pitch link's preview before a match exists
(backend/pages: "CHEERFUL CEDAR IS WAITING FOR PLAYERS"). No member id, nothing else of
the lobby. The AWS function must take this topic before this pitch server is deployed:
an untaken push is retried for as long as the pitch lives.

### On the wire to AWS

`src/push.mjs` and `src/pitch-do.mjs`. Each push is one `POST` to `PUSH_URL`:

| Header              | Value                                                         |
| ------------------- | ------------------------------------------------------------- |
| `content-type`      | `application/json`                                            |
| `x-pitch-signature` | `sha256=<hex HMAC-SHA256 of the raw body, keyed PUSH_SECRET>` |
| `idempotency-key`   | `<pitch>:<made>:<k>`, e.g. `k7mpq2rstw:1795280000000:act:1:4` |

The body is the envelope `{ "v": 1, pitch, made, k, topic, sent, body }`: `topic` and
`body` as in the table above, `sent` the object's clock when this attempt was made (it
changes between retries; the key does not). Verify the signature over the exact bytes
received, before parsing, with a constant-time compare.

Any 2xx means taken, a duplicate included: answer 200 to a key already stored. Anything
else (a 4xx too), a network error or no answer within 10 s is retried: after 1 s, then
doubling to at most 5 minutes, each wait up to 20% shorter at random, for as long as the
pitch lives. A retry is woken by the object's alarm, so a sleeping pitch still retries;
pending pushes are kept in its SQLite outbox and survive restarts and deploys. With no
`PUSH_URL` or `PUSH_SECRET` set the object pushes nothing and the outbox keeps growing,
and such a pitch is never idle-wiped (the core's rule). Pushes are not ordered across
keys: a retried `start` can arrive after the first `act`.
