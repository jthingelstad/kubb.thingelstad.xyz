# Rooms: the multiplayer room service

A pitch is a link (`/p/<code>`). Everyone who opens it joins the same **room**. The room
server knows no Kubb. It keeps:

- who is in the room, in the order they joined, and who is connected now;
- a few small fields each member sets about themselves (`me`: name, team, anything);
- the **host** (the member who made the room);
- **one shared JSON document** with a version number, changed only by compare-and-set;
- a relay for short-lived messages (**casts**: aim, reactions), never stored.

The game puts the lobby (teams, options, started or not) and the match snapshot in the
shared document (`docs/DESIGN.md` section 4.3). This file is the whole contract: the wire
protocol, the client library, the limits, the cost, and what is not protected.

| Piece                                   | Where                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Room logic (pure, both servers run it)  | `backend/rooms/core.mjs`                                                |
| AWS Lambda handler, DynamoDB store      | `backend/rooms/handler.mjs`, `backend/rooms/dynamo-store.mjs`           |
| The recorder (every version, to S3)     | `backend/rooms/recorder.mjs`, `src/net/record.js`, `tools/games.mjs`    |
| Open games (the home page's list)       | `backend/rooms/core.mjs`, `public/js/open-games.js`, `src/net/pitch.js` |
| Reports (to S3)                         | `backend/rooms/reports.mjs`, `src/net/report.js`, `tools/reports.mjs`   |
| Replays (a finished match, kept a year) | `backend/rooms/core.mjs`, `src/replay/fetch.js`, `src/net/pitch.js`     |
| In-memory store (dev server, tests)     | `backend/rooms/memory-store.mjs`                                        |
| Local server                            | `tools/rooms-dev.mjs` (`node tools/rooms-dev.mjs`, ws://127.0.0.1:8788) |
| Browser client                          | `src/net/room.js`                                                       |
| CloudFormation                          | `infra/rooms.json`                                                      |
| Tests                                   | `node --test tests/net/`                                                |

## 1. The client library (`src/net/room.js`)

Use this, not the raw protocol. It handles chunking, ordering, reconnects and retries.

```js
import { connect, makeRoomCode, memberId } from "./net/room.js";

const code = makeRoomCode(); // home page: a new pitch is /p/<code>
const room = connect({
  url: ROOMS_URL,
  room: code,
  member: memberId(),
  name: "Jamie",
});

room.on("state", (s) => render(s)); // after every (re)join: the full picture
room.on("members", ({ members }) => drawLobby(members));
room.on("doc", ({ doc, v, by, with: action, mine }) =>
  adopt(doc, action, mine),
);
room.on("cast", ({ from, d }) => showAim(from, d));
room.on("status", ({ status }) => showBanner(status));

await room.ready; // the first join; rejects if the room is full or the code is bad
room.setMe({ team: "A" });
await room.update((doc) => ({ ...doc, started: true }), {
  with: { kind: "start" },
});
const aim = room.caster(150); // a throttled cast: call it every frame, it sends ~7 a second
aim({ x, y, arm });
```

### Helpers

- `makeRoomCode(length = 10)`: a random code from `23456789abcdefghjkmnpqrstuvwxyz`
  (no 0, 1, i, l, o). The server accepts 8 to 24 of these (`ROOM_CODE`).
- `memberId(storage = localStorage, key = 'kubb.member')`: this browser's member id,
  created once (16 characters of `A-Za-z0-9_-`) and kept, so a refresh or a reconnect
  is the same member. Works without storage (a new id each call).
- `throttle(fn, ms)`: calls `fn` at most once every `ms`; the latest arguments in between
  are sent at the end of the wait. `.cancel()` drops a pending call.

### `connect(options)` returns a `Room` at once

| Option      | Default                |                                                                                      |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `url`       | required               | `wss://...` (production: the stack's `WebSocketUrl` output) or `ws://127.0.0.1:8788` |
| `room`      | required               | the room code                                                                        |
| `member`    | required               | `memberId()`                                                                         |
| `name`      | none                   | shorthand for `me: { name }`                                                         |
| `me`        | `{}`                   | initial own fields, sent with every join                                             |
| `WebSocket` | `globalThis.WebSocket` | for tests                                                                            |
| `pingMs`    | 240000                 | keep-alive ping interval (API Gateway drops a connection idle 10 minutes)            |
| `backoff`   | `[500, 15000]`         | reconnect delay: doubles from the first to the second, with jitter                   |
| `retries`   | 20                     | how many times `update` re-runs `fn` after losing a race                             |
| `answerMs`  | 10000                  | a `set` with no answer by then reconnects to find out what happened                  |

### Properties (read only)

`ready` (promise of the first state), `status`, `you` (member id), `code`, `host`,
`members` (array in joined order), `v` (document version, 0 = never written), `doc`
(the document, `null` before the first write), `by` (who wrote this version), `me` (own
fields as this client holds them), `limits` (as the server announced them).

`status` is `connecting` (first connection), `open`, `reconnecting`, `closed` (by
`close()`/`leave()`, or a join that cannot succeed), or `replaced` (the same member
opened the room in another tab or device; that one wins and this one stops for good).

A member is `{ id, connected, joined, since, me }`: `joined` is when they first joined
(milliseconds, unique and increasing within the room: the order to sort by), `since` is
when they last connected or disconnected.

### Methods

- `on(type, fn)` returns an unsubscribe function; `off(type, fn)`.
- `state()`: `{ room, you, host, members, v, doc, by, status, limits }`.
- `isHost()`: `host === you`.
- `setMe(fields)`: merge into own fields (`null` removes a key). Remembered and sent
  again on every reconnect. Everyone, this client included, gets a `member` event.
- `update(fn, { with })`: change the shared document. `fn(doc)` receives a private copy
  of the current document (`null` before the first write) and returns the whole new
  document, or `undefined` to change nothing (resolves `null`). If another member wrote
  first, the client adopts their document and calls `fn` again on it. Updates from one
  client run one at a time, in call order. Resolves `{ v, doc }` when the room has it.
  `with` is a small payload (4 KB) that rides along to everyone else with this version:
  the game sends the action that produced the document (a throw's launch). It is not
  stored, and `fn` must not depend on it.
  Rejects with a `RoomError` whose `code` is `too-big` (document or `with` over the
  limit), `busy` (lost the race `retries` times), `closed`, `replaced`, or `uncertain`:
  the connection dropped after the set was sent and before the room answered, and by the
  time it rejoined someone else had written, so the client cannot tell whether this set
  landed. It does not run `fn` again in that case (a throw must not be thrown twice):
  look at `room.doc`, which is current, and decide.
- `cast(d)`: relay `d` (any JSON, 2 KB with the envelope) to everyone else now. Returns
  false and drops it while not connected. Casts are never stored and never replayed.
- `caster(ms = 150)`: a throttled `cast` (see `throttle`). Use it for aim.
- `claimHost()`: ask to become host (rules in section 2.4).
- `setOpen(open)`: the host lists the room under Open games (`{ players, seats, state }`)
  or takes it off (`null`); section 9. False while not connected.
- `keep(replay, v)` asks the server to keep the finished match and its room for a year
  (section 10). Supply the positive integer document version at the end of the match.
  Omitting it yields `bad-message`. A true return means the client sent the request.
  It returns false while disconnected. The server sends no success acknowledgement.
- `leave()`: leave the room for good (the member is forgotten there) and close.
- `close()`: close without leaving: the member shows as disconnected and keeps their place.

### Events

| Event     | Detail                              | When                                                                            |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `status`  | `{ status }`                        | the connection status changes                                                   |
| `state`   | `state()`                           | after every join and rejoin (the full picture; redraw from it)                  |
| `members` | `{ members }`                       | the member list or any member changed (also after every join)                   |
| `member`  | `{ member, isNew, was }`            | one member joined, reconnected, disconnected, or changed `me`                   |
| `left`    | `{ id }`                            | a member left for good (or gave their place up in a full room)                  |
| `host`    | `{ host }`                          | the host changed                                                                |
| `doc`     | `{ v, doc, by, with, mine }`        | a newer document version arrived; `mine` when it was this client's own `update` |
| `cast`    | `{ from, d }`                       | another member's cast                                                           |
| `error`   | `RoomError` `{ code, message, re }` | an error not tied to an `update` (for example `rate`)                           |

Within a connection, `doc`, `ok` and `no` adopt only a higher document version.
On reconnect, the document in `joined` is authoritative. After an expired room
restarts this can be version 0 and JSON null. If the client already holds the
current positive version the server omits the document. Otherwise the client
adopts it and emits a `doc` event. The `with` of versions written while a client
was away is not replayed: a
browser that loses its place just takes the snapshot (`DESIGN.md` 4.3).

## 2. The wire protocol

The socket, chunking, retries and pacing stay in this repository. The game's shared
document reducers, seats and sync decisions are kubb-engine's `room.*` Lua calls, used
through thin web wrappers (`docs/MULTIPLAYER.md`). The room server still knows no Kubb.

One WebSocket per browser tab. Every message is a JSON object with a type `t`, sent as
a text frame. All text is **ASCII JSON**: every character above `~` is written as a
backslash-u escape per UTF-16 code unit (`asciiJson` in both libraries). An emoji
outside the BMP takes twelve ASCII bytes, a lone surrogate six. The encoded text
can be cut anywhere and its length is its byte count.

### 2.1 Frames and chunking

API Gateway WebSocket APIs (quotas page, checked 2026-11-15): a **frame** is at most
32 KB, a **message** at most 128 KB, a bigger frame closes the connection with code
1009, and the 32 KB frame quota also applies to `@connections` posts (server to client).
Browsers send each message as one frame. So both sides cut any message longer than
**30 000 bytes** (`limits.frame`) into parts:

```
~<id>.<i>.<n>~<slice i of the message text>
```

`id` is 1 to 16 characters of `[a-z0-9]`, unique per message from its sender, `i` is
0-based, `n` is 2 to 16, and every part (header included) is at most 30 000 bytes. A
whole message never starts with `~` (it starts with `{`). Parts may arrive in any order
(on AWS each frame is its own Lambda invocation); the receiver joins the slices in `i`
order when all `n` have arrived. The server keeps unfinished parts for 10 minutes. A
reassembled message is at most 300 KB. The largest message is a `set` with a 256 KB
document, about 9 parts. Senders reserve 40 bytes for the header and slice the
encoded text every 29,960 bytes. Each part is a separate WebSocket message.
The server enforces the part count, index, frame size, reassembled size and
upload expiry. The web client's incoming part reader only matches the header
pattern (even a count of 0 or 1 matches). It joins the indexed slices without
enforcing those bounds or timing out incomplete assemblies.

### 2.2 Client to server

| `t`      | Fields                                     |                                                                                                  |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `join`   | `room`, `member`, `me?` (or `name?`), `v?` | join (or rejoin) the room; `v` = the document version already held                               |
| `me`     | `me`                                       | merge own fields; `null` removes a key                                                           |
| `set`    | `id?`, `base`, `doc`, `with?`              | compare-and-set the document; the game's `with` may carry `c?`, `e?` (section 2.6)               |
| `cast`   | `d`                                        | relay to everyone else                                                                           |
| `claim`  |                                            | ask to become host                                                                               |
| `leave`  |                                            | leave for good                                                                                   |
| `ping`   |                                            | keep-alive; answered with `pong`, needs no join                                                  |
| `report` | `id?`, `r`                                 | a player's report (section 8); needs no join; `r.client?`, `r.engine?` (section 2.6)             |
| `game`   | `id?`, `g`                                 | a match played in one browser (section 7); needs no join; `g.client?`, `g.engine?` (section 2.6) |
| `list`   | `id?`                                      | the open games (section 9); needs no join                                                        |
| `open`   | `open`                                     | the host lists the room, or `null` takes it off (section 9)                                      |
| `keep`   | `v`, `replay`                              | the match has ended: keep its replay and the room (section 10)                                   |
| `replay` | `id?`, `room`                              | a room's kept replay (section 10); needs no join                                                 |
| `reel`   | `id?`, `room`                              | a finished pitch's highlight reel: start it, or how it stands (section 12); needs no join        |
| `share`  | `id?`, `g`                                 | share a finished match against the computer (section 13); needs no join                          |

`join` must be the first message on a connection (anything else but `ping`, `report`,
`game`, `list`, `replay`, `reel` and `share` answers `not-joined`).
A connection joins one room as one member; a second `join` on the same connection for
the same room and member is a rejoin, for anything else it is `already-joined`.

### 2.3 Server to client

| `t`        | Fields                                                                             |                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `joined`   | `room`, `you`, `host`, `rev`, `members`, `v`, `by`, `sid`, `now`, `limits`, `doc?` | the reply to `join`: the full room                                                                   |
| `member`   | `rev`, `member`, `isNew?`                                                          | a member joined, rejoined, disconnected, or changed `me` (to everyone; to others for one's own join) |
| `left`     | `id`, `rev`                                                                        | a member left for good                                                                               |
| `host`     | `host`, `rev`                                                                      | the host changed                                                                                     |
| `doc`      | `v`, `by`, `with?`, `doc`                                                          | a new document version (to everyone but the writer)                                                  |
| `ok`       | `id`, `v`                                                                          | your `set` landed as version `v`                                                                     |
| `no`       | `id`, `v`, `by`, `sid`, `doc`                                                      | your `set` lost: here is the current version                                                         |
| `cast`     | `from`, `d`                                                                        | another member's cast                                                                                |
| `pong`     | `now`                                                                              | answer to `ping`                                                                                     |
| `reported` | `id`                                                                               | your `report` is kept                                                                                |
| `recorded` | `id`                                                                               | your `game` is kept                                                                                  |
| `list`     | `id`, `now`, `games`                                                               | the open games: `[{ room, made, players, seats, state }]`, newest first (section 9)                  |
| `replay`   | `id`, `room`, `v`, `at`, `replay`                                                  | the room's kept replay, or `replay: null` (section 10)                                               |
| `reel`     | `id`, `room`, `v`, `reel`, `why?`                                                  | how the kept replay's reel stands, or `reel: null` and why (section 12)                              |
| `shared`   | `id`, `code`, `v`, `why?`                                                          | your `share` is kept as the pitch `code`, or `code: null` and why (section 13)                       |
| `error`    | `code`, `message`, `re?`, `id?`                                                    | `re` = the `t` that failed; `id` = the `set` id                                                      |

- `doc` is omitted from `joined` when the joiner sent `v` equal to the current version
  (and it is not 0). `doc` is `null` while `v` is 0.
- `by` is the member who wrote version `v`; `sid` is the `id` (as a string) of the `set`
  that wrote it. A client whose connection dropped with a `set` unanswered compares them
  with its own on the next `joined` to learn whether the set landed.
- `rev` is the room record's revision. It only grows. Room events can arrive out of order
  (on AWS each message is handled by its own Lambda invocation), so a client keeps the
  `rev` of the last event it applied for each member (and for the host) and drops older
  ones. `joined` resets all of them to its `rev`.
- `doc`, `ok` and `no` can likewise arrive out of order: keep the highest `v`.
- `limits` in `joined`: `{ members, docBytes, withBytes, castBytes, meBytes, frame,
castRate, castBurst, hostGraceMs }`. The server omits `parts`, `messageBytes`,
  `reportBytes`, `gameBytes` and `replayBytes` from this object. Clients use
  the fixed caps in section 3 for these.
- `now` (in `joined`, `pong`) is the server clock in milliseconds.

### 2.4 Rules

- **Members and reconnecting.** `member` is the client's own random id, kept in
  localStorage. Joining again with the same id (refresh, reconnect, the 2-hour connection
  limit) is the same member with the same place, `joined` time and fields. If that member
  is still connected elsewhere, the older connection is sent `error` `replaced` and
  closed. Every disconnect (closed tab, lost network, a send that comes back Gone) is
  broadcast as a `member` with `connected: false`; the member keeps their place.
  `leave` removes them.
- **Full room.** 16 members. When a 17th joins, the member who has been disconnected
  longest (never the host) gives up their place (`left`); if all 16 are connected the
  join is refused with `full`.
- **Host.** The member who created the room. The host stays host while away. Another
  member may `claim` when the host has left (`leave`) or has been disconnected at least
  15 seconds, and only the **earliest-joined connected member** may; everyone gets `host`.
  Refusals: `host-present`, `host-recent`, `not-next`. The game decides when to claim
  (for example: the next in line claims once the host has been gone 15 seconds).
- **Document.** `set` is accepted only when `base` equals the current version; the
  document is replaced whole, the version becomes `base + 1`, the writer gets `ok` and
  everyone else gets `doc` (with `with`). Otherwise the writer gets `no` with the current
  document, and nothing is broadcast. The first write is `base: 0`.
- **Casts.** Relayed to every other connected member; not stored. Each connection gets a
  token bucket of 20, refilled at 10 a second; a cast over the rate is dropped and the
  sender gets one `error` `rate` per burst. On AWS the bucket lives in the Lambda
  instance, so it is a best effort (parallel instances each have their own); the stage
  throttle (section 4) is the hard cap.
- **Expiry.** A room and its document expire 48 hours after the room's last write
  (DynamoDB TTL on `exp`; joins, `me`, presence and host changes write the room, and a
  join moves the document's expiry along with it). A room whose match was kept (`keep`,
  section 10) lives at least until its `keep` runs out, a year from the end of that
  match. An expired room code is a new, empty room. Connection records expire after 3 hours.
- **Origin.** On AWS `$connect` is refused (403) unless the `Origin` header is in
  `ALLOWED_ORIGINS` (the stack's `AllowedOrigins`, default `https://throwingwood.com`,
  `https://app.throwingwood.com`, `http://localhost`, `http://127.0.0.1`; an entry without a port allows any port). A connection with no
  `Origin` is refused too. `https://app.throwingwood.com` is the iPhone app: no page is
  served there, it is the `Origin` the app sends on its WebSocket handshake to
  `wss://throwingwood.com/ws`. The dev server's default list is `http://localhost`,
  `http://127.0.0.1` and the app's origin (`ROOMS_ORIGINS` replaces it), and it also lets
  in connections with no `Origin` (Node tools and tests). CloudFront's `/ws` route passes
  `Origin` through untouched (the AllViewerExceptHostHeader origin request policy, no
  cache, a viewer request function that only rewrites the path), and the shared `edge`
  web ACL has no rule on `Origin`, so the check is the rooms function's alone. That web
  ACL's managed core rule set does block a request with no `User-Agent`: a native client
  must send one (Apple's URLSession does by default). The check is a filter, not
  authentication (section 6).

### 2.5 Error codes

`bad-room`, `bad-member`, `bad-message` (not JSON, unknown `t`, a bad part, a bad field),
`already-joined`, `not-joined` (no join yet, or this connection was replaced), `full`,
`busy` (the room record kept changing under the server; try again), `replaced`,
`too-big`, `rate`, `host-present`, `host-recent`, `not-next`, `not-host` (an `open` from
anyone but the host); for `report` and `game` also `too-many` (more than 3 on one
connection), `failed` (it could not be written) and `unavailable` (this server keeps
none); for `reel` also `too-many` (a fourth render started on one connection) and
`failed` (the reel item could not be read or written, or the renderer could not be
asked); for `share` also `too-many` (a third match checked on one connection) and
`failed` (section 13.3); `sealed` (a `join`, `set` or `keep` on a shared match's
pitch, section 13.5).

### 2.6 Client and engine tags

For game admission, the client joins with `me = { name, level, engine }`, where `engine`
is the engine's major.minor (for example `"0.4"`). START passes the current members to the engine's
`room.startCheck`/`room.startMatch`, which refuses explicit mismatches and stamps
`match.engine`. `room.mayPlay` checks a running match before giving team or CPU control.
These are client rules: the server treats both fields as opaque JSON. During the web
transition `LENIENT_ENGINES` permits a missing tag from an old open tab or match; it
must become strict before the iPhone app ships (`docs/MULTIPLAYER.md` "Engines").

Recording tags are separate and carry the full version:

A record says which program made it, so a throw that went wrong can be traced to the web
page or the iPhone app and to the engine that played it. Both are optional: clients built
before them send neither, and nothing else changes when they are absent.

| Where                        | Field    | Value                                                             |
| ---------------------------- | -------- | ----------------------------------------------------------------- |
| `g` (`game`), `r` (`report`) | `client` | the program: `web`, `ios`; 1 to 32 of `a-z`, `0-9`, `.`, `-`      |
| `g` (`game`), `r` (`report`) | `engine` | the game engine's version; 1 to 64 of `a-z`, `0-9`, `.`, `-`, `+` |
| a `set`'s `with`             | `c`, `e` | the same two, for the action that rides along (section 7)         |

The server checks `client` and `engine` in `g` and `r` (`CLIENT_TAG`, `ENGINE_TAG` in
`backend/rooms/core.mjs`): any other value, a number or an empty string among them, is
`bad-message` with `re` and the `id`, and nothing is kept; `null` counts as absent. They
are kept as part of `g` or `r`. The rider is the game's and the server checks none of it
(only its size): `c` and `e` there are kept with the action as the client sent them. The
web client sends `client: "web"` and `c: "web"` (`CLIENT` in `src/net/sync.js`), and
`engine` and `e` as the vendored kubb-engine's version (`engine.version`). `npm run
games:replay` and `npm run reports:pull` print the client beside each match and report
that says one, and the replays say when a record's engine is not this checkout's.

## 3. Limits

All in `LIMITS` in `backend/rooms/core.mjs`, the one place to change them.

| Limit                   | Value                                                                       |
| ----------------------- | --------------------------------------------------------------------------- |
| members a room          | 16                                                                          |
| document                | 256 KB of encoded ASCII JSON (section 2.1)                                  |
| `with` payload          | 4 KB                                                                        |
| a cast message          | 2 KB                                                                        |
| a member's `me` fields  | 512 B                                                                       |
| frame (either way)      | 30 000 B; API Gateway's quota is 32 KB                                      |
| parts a message         | 16; a reassembled message at most 300 KB                                    |
| cast rate               | 10 a second a connection, burst 20                                          |
| host grace              | 15 s                                                                        |
| room and document TTL   | 48 h after the last write                                                   |
| a kept room and replay  | 365 days from the `keep` (the end of the match)                             |
| a kept replay           | 256 KB as ASCII JSON (stored gzipped)                                       |
| connection record TTL   | 3 h (API Gateway closes every connection at 2 h)                            |
| unfinished upload       | 10 min                                                                      |
| room code               | 8 to 24 of `23456789abcdefghjkmnpqrstuvwxyz` (the client makes 10)          |
| member id               | 8 to 40 of `A-Za-z0-9_-`                                                    |
| a report                | 64 KB as ASCII JSON; each answer 1000 code points; 3 a connection           |
| a one-browser match     | 256 KB as ASCII JSON; 4000 actions; 3 a connection                          |
| open games listed       | 20, newest first, read from at most 60 entries; made in the last 24 h       |
| an open game's entry    | 15 min after its room last changed (the host says it again every 5 min)     |
| seats an open game says | 1 to 16 (the game says 12: six a side)                                      |
| highlight reels         | 3 started a connection (asking is free); 200 started a UTC day, all pitches |
| a reel left rendering   | 25 min, then the next request may start it again (twice in all)             |
| a shared match          | 256 KB as ASCII JSON; 1000 actions; `start` 16 KB (section 13)              |
| shares                  | 2 checked a connection (a repeat is free); 200 checked a UTC day, in all    |
| a share's check         | waited for 20 s, then `busy`                                                |

Fixed by API Gateway (not ours): 10 minutes idle and 2 hours total per connection (the
client pings every 4 minutes and reconnects on its own), 500 new connections a second
per account, 29 s integration timeout.

## 4. AWS shape (`infra/rooms.json`)

One stack, deployed by the deploy tool (not by hand): an API Gateway WebSocket API with
`$connect`, `$disconnect` and `$default` routed to one Lambda function (Node.js 24,
arm64, 256 MB, 30 s timeout (a share waits up to 20 s for its check), `index.handler` from the esbuild bundle of
`backend/rooms/handler.mjs` with `@aws-sdk/*` external), its own log group (30 days),
an execution role that can only use the rooms table, write that log group, post to
this API's connections and put objects under `games/` (rooms and one-browser matches)
and `reports/` in the games bucket, and invoke the site stack's reel function (renders,
and share checks: section 13), one DynamoDB
table (on demand, TTL on `exp`), and the private games bucket (section 7).

Throttling on the `prod` stage: **50 messages a second, burst 100** for every route,
and **5 a second, burst 20** for `$connect`. One room in play sends about 7 a second
(the thrower's aim) plus reactions, so this carries several rooms at once and caps what
a misbehaving client can cost. API Gateway drops throttled messages; the client's
`answerMs` timeout covers a dropped `set`.

The table (`pk`, `sk`, both strings):

| pk             | sk               | Holds                                                                                                                                     |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `room#<code>`  | `room`           | `rev`, `exp`, `json` (host and members, with each member's connection id)                                                                 |
| `room#<code>`  | `doc`            | `v`, `doc` (ASCII JSON text), `by`, `sid`, `exp`                                                                                          |
| `room#<code>`  | `replay`         | `v`, `t`, `z` (the replay's ASCII JSON, gzipped), `exp`: a finished match's replay                                                        |
| `conn#<id>`    | `conn`           | `room`, `member`, `exp`                                                                                                                   |
| `conn#<id>`    | `part#<msg>#<i>` | `d`, `exp`: one part of an upload                                                                                                         |
| `open`         | `<made>#<code>`  | `room`, `made`, `rev`, `listed`, `players`, `seats`, `state`, `exp`: an open game's entry                                                 |
| `room#<code>`  | `reel`           | `v`, `tag`, `job`, `state`, `at`, `tries`, `tall?`, `wide?`, `edit?`, `seconds?`, `done?`, `why?`, `exp`: its highlight reel (section 12) |
| `reels#<day>`  | `count`          | `n`, `exp`: highlight reels started that UTC day (section 12)                                                                             |
| `share#<hash>` | `share`          | `code`, `exp`: the pitch a shared match was kept as, by the SHA-256 of its start and log (section 13)                                     |
| `shares#<day>` | `count`          | `n`, `exp`: shared matches checked that UTC day (section 13)                                                                              |

The room is one item, so a relay costs one read; the document is its own item under the
same key, so relays do not pay to read it. Every write that depends on a read is
conditional (room on `rev`, document on `v`), because invocations for one room run in
parallel. A `set` reads the room after writing the document and a `join` reads the
document after writing the room, so a joiner always gets either the new document or its
broadcast. Parts of one upload are stored, then each invocation queries them; the one
that sees all of them wins a conditional delete of part 0 and handles the message.
The open games share one partition, `open`, sorted by when each was made (epoch ms, 13
digits, then the code), so the list is one Query read newest first, never a scan
(section 9).

## 5. What an evening costs

A guess for one evening: four friends, two hours, three matches, about 60 throws a
match, each thrower aiming about 20 seconds at the client's 7 casts a second, and a
20 KB snapshot committed once a throw.

|                              | Count                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| casts in                     | ~25 000 (each one Lambda invocation and one DynamoDB read)    |
| casts out                    | ~75 000 posts (three other members)                           |
| document commits             | ~200 sets, ~200 x 3 broadcasts of 1 part each                 |
| joins, `me`, presence, pings | a few hundred                                                 |
| connection minutes           | ~500                                                          |
| Lambda                       | ~26 000 invocations of ~20 ms at 256 MB, about 130 GB-seconds |

At the 2026 us-east-1 list prices (API Gateway WebSocket about $1 a million messages and
$0.25 a million connection minutes, metered in 32 KB steps; Lambda arm64 requests and
duration; DynamoDB on demand) that is **around ten cents**, nearly all of it API Gateway
messages from aim casts. Nothing costs anything while nobody plays: no connections, no
invocations, the table empties itself. The cast rate is the lever: halving the aim rate
halves the bill.

## 6. What is not protected

By design, friends on a link:

- **Anyone with the link can join, and anyone in the room can write the document**,
  claim a member's id they somehow learn, set any name, and cast. The server does not
  referee Kubb; the thrower's browser decides (`DESIGN.md` 4.3). A room code is 10
  characters from 31 (about 50 bits), so rooms cannot be found by guessing, but a shared
  link is the key.
- **Member ids are bearer tokens.** Whoever presents a member id is that member. They
  live in localStorage and travel only to the room server.
- **The Origin check is a filter, not authentication.** A browser cannot lie about the
  page it is on, so the check keeps other web sites from opening the rooms from their
  pages. Anything that is not a browser sets the header itself: the iPhone app sends
  `https://app.throwingwood.com` because it chooses to, and any script can send that or
  any other listed origin. Nothing proves a connection comes from our app. The stage
  throttle and the size limits bound what such a client can do.
- **The cast rate cap is best effort** on AWS (per Lambda instance).
- **An open game can be joined by anyone who sees it on the home page.** Its entry shows
  only how many are on the pitch, whether it has started and how long ago it was made,
  with its link; no names. The host chooses open; invite only is the default. Anyone may
  ask for the list without joining a room, and a script can open many rooms to crowd it:
  the list shows the 20 newest, an entry goes when its room is full, its match is over,
  nobody is connected or the host stops saying so, and the stage throttle bounds the rest.
  A listed code is a key like any shared link: whoever has it can join.
- **One-browser matches are taken as sent.** The server checks the shape and the size of
  a `game` message, not that the match was really played; a made-up match is only noise
  in the test data. The same goes for the `client` and `engine` tags (section 2.6): they
  say what the sender claims, not what it is.
- **A finished pitch's replay can be watched by anyone with the link** for a year: the
  names the players typed and every throw. Nothing new is published; the replay is not
  listed anywhere (a finished match is off the open games list) and `replay` gives it
  only for a code the asker already has. Any member can send `keep`; the first one for a
  version wins, so a member can at worst keep a made-up replay of a match that ended in
  the document, readable only by those who hold the link.
- No accounts and no personal data beyond the name a player types; rooms vanish 48 hours
  after their last write, a finished one a year after its match ended. Lambda logs carry connection ids and error names, not
  documents or names. The games bucket keeps every document version, names included,
  every match played in one browser (section 7), and every report, with what the player
  typed (section 8).

## 7. Recording

Every committed version of a room's document is kept for good, so that real play can be
run through the engine again (Jamie, 2026-11-15: "all games should be recorded so that we
can use it to test and improve the game"). So is every match played in one browser,
against the computer or watching it (Jamie, 2026-11-16: "watch mode should record ... All
games recorded").

- **What.** After a `set` wins its compare-and-set, the core hands `{ room, v, t, by, doc,
with }` to `record` (`backend/rooms/recorder.mjs`), which writes one gzipped JSON object:
  `games/<room>/<epoch ms, 13 digits>-<v, 6 digits>.json.gz`. `doc` and `with` go in as
  the ASCII JSON text the room stored, so a snapshot's hash still matches. For the game
  that is the lobby as it fills, the match's start (seq 0) and the snapshot after every
  action with the action itself. Casts (aim, shouts) and the practice pitch are not
  recorded.
- **Where.** The stack's `GamesBucket`: private, encrypted, TLS only, no lifecycle rule,
  kept when the stack is deleted. The function may only `PutObject` under `games/`. The
  local server records nothing unless `startRoomsServer({ record })` is given one.
- **Failure.** A record that cannot be written is logged (`record failed`) and the move
  stands: recording never costs a room its game. It adds one S3 put to a `set`, run
  beside the broadcast. A snapshot is about 8 to 13 KB before gzip, so a long match is
  well under a megabyte.
- **Names.** The document carries the names players typed, and member ids. The bucket is
  never served; `tools/games.mjs pull` copies records to `build/games/`, which git
  ignores. The home page says that matches are recorded.
- **Reading them.** `npm run games:pull`, then `npm run games:replay`: each match is
  restored at its start and every recorded action applied to this checkout's engine.
  `same` means the engine ends on the hash the players' browsers committed; `differs`
  means this engine plays that action another way (expected after the physics changed,
  and the list of throws to look at); `adopted` means no action was recorded for that
  version (too big to ride along, or a version is missing). After anything but `same` the
  replay takes the recorded snapshot and carries on. A room's record does not name the
  build that played it: its time `t` against the deploy history does. Its rider may name
  the client and the engine that committed the action, as `c` and `e` (section 2.6):
  the recorder writes the rider's text as the room stored it, so whatever a client puts
  there is in the record untouched (`tests/net/recorder.test.mjs` pins it).
- **One-browser matches.** A match against the computer (`?solo=1`) or watching it
  (`?watch=1`) has no room. When it ends (a winner, or a resignation; an abandoned match
  is not sent) the browser sends it once, on a socket of its own like a report:
  `{ "t": "game", "id": 1, "g": { ... } }`, answered `{ "t": "recorded", "id": 1 }`.
  `g` is `src/net/record.js`'s: `mode` (`solo` or `watch`), `at` (the browser's clock),
  `build` (version, commit, the Lua bundle's file name, the vendored core's commit),
  `options` (the first snapshot's: seed, teams, names typed, opening, ...), `start` (the
  first snapshot, opaque text), `actions` (every action since), `hashes` (the engine's
  hash after each), `end` (`over`, `winner`, `how`, `text`, the last `hash`), `file` and
  `name` (the Planet Kubb Notation game file, positions included), and `client` and
  `engine` when the client says them (section 2.6). Over 256 KB the
  browser drops, in order, `hashes`, `file`, then `start` and `actions` (`start` becomes
  `"-"`), and lists them in `g.dropped`; a watch match is about 20 to 70 KB. The server
  requires `mode`, `start` and `actions` (objects, at most 4000), `hashes` one an action
  when present, `file` text when present, and keeps `{ t, game }` at
  `games/browser/<yyyy-mm-dd>/<epoch ms, 13 digits>-<8 random>.json.gz`. `browser` can
  never be a room code (codes have no `o`). Nothing names the sender: no connection id,
  member id, address or browser string. 3 a connection (a best effort), `failed` and
  `unavailable` as for reports. In the browser a failed send is a console warning and
  nothing else; the match goes on to the next.
- **Replaying them.** `games:pull` copies them to `build/games/browser/<day>/`, and
  `games:replay` plays each from its start: every action is `same` or `differs` against
  its hash, and after the first that differs (or is refused) the rest are `unjudged`,
  since no snapshot was kept to go on from. The local server writes them to
  `build/games-dev/browser/` (`games:replay -- --dir build/games-dev`).

## 8. Reports

A player who saw a throw go wrong says so from the game's menu (SEND FEEDBACK, "A throw
looked wrong"), or tells us anything else ("Something else"), and the browser sends what
they typed with the game as it stood, so a reported moment can be played again offline
(Jamie, 2026-11-16 and 2026-11-19; `AGENTS.md` "Reports"). The room server knows no Kubb
here either: it checks the shape and the size, keeps the report and acknowledges it.

- **The message.** `{ "t": "report", "id": 1, "r": { ... } }`, sent on any connection,
  joined to a room or not. The browser opens a socket of its own for it, waits for the
  answer (15 s at most) and closes, on a shared pitch too (the room's own socket may be
  reconnecting). A report longer than a frame goes in parts (section 2.1). The server
  requires `r.kind` absent, `null`, `"throw"` or `"feedback"` (`REPORT_KINDS`; absent
  or `null` is a throw report, the shape clients built before feedback send, the iPhone
  app's current builds among them), `r.mode` (`practice`, `solo`, `watch` or `pitch`),
  `r.room` a room code when present, `r.client` and `r.engine` tags when present
  (section 2.6), and the whole message at most 64 KB (`LIMITS.reportBytes`). By kind:
  - `throw`: `r.happened` and `r.should`, text, at most 1000 Unicode code points each
    (`LIMITS.reportChars`), at least one not blank.
  - `feedback`: `r.text`, text, 1 to 2000 Unicode code points after trimming
    (`LIMITS.feedbackChars`), and neither `happened` nor `should`.

  Everything else in `r` is the browser's (`src/net/report.js` lists it): a feedback
  report carries the same game context as a throw report. The answer is
  `{ "t": "reported", "id": 1 }` or an `error` with `re: "report"` and the `id`
  (`bad-message` for a bad kind or a missing or blank text, `too-big` for text too long).

- **What is kept.** One gzipped JSON object a report in the games bucket:
  `reports/<yyyy-mm-dd>/<epoch ms, 13 digits>-<8 random>.json.gz`, holding
  `{ t, report }`: the server's time and `r` as it came, with `kind` set (`"throw"` for
  one that came with none). The server adds nothing that
  names the sender: no connection id, member id, address or browser string (the
  browser has already swapped the players' member ids for `member1`, `member2`, ...;
  so a report joins its recorded game by `room` and `v`, not by member). Kept for
  good, like the games (no lifecycle rule on the bucket).
- **Joining a recorded game.** A shared pitch's report carries `room` and the document
  version `v` it had, so it joins `games/<room>/` at that version instead of copying it.
  It also carries its own snapshots, so it replays without the records.
- **Limits.** 3 reports a connection, of either kind, counted in the Lambda instance (a best effort, as
  the cast buckets are); the stage throttle is the hard cap. A report that cannot be
  written is answered `failed` and does not count.
- **Reading them.** `npm run reports:pull`, then `npm run reports:replay -- <file>`
  (`tools/reports.mjs`; they print the kind and a feedback's text, and a feedback report
  with no throw in it has nothing to replay). The local server (`node tools/rooms-dev.mjs`) writes them to
  `build/reports-dev/` in the same shape; `startRoomsServer({ report })` takes any
  reporter (the tests use `memoryReporter`), and without one reports are `unavailable`.

## 9. Open games

A host can make a pitch open, and it is listed on the home page under Open games so
anyone can join by showing up (Jamie, 2026-11-16: "allow a game to be created open so it
can be joined by anyone ... Open and invite only are both supported"). Invite only, the
link and nothing else, is the default.

- **The choice.** The document's `open` (`docs/MULTIPLAYER.md`): set by the host in the
  lobby (Who can join: Invite only, Open), or from the home page (Start a pitch with Open
  picked goes to `/p/<code>?open=1`, and the new pitch's host writes `open: true`). The
  link works the same either way.
- **The listing.** The room server knows nothing of the document, so the host's browser
  says it: `{ "t": "open", "open": { "players": 2, "seats": 12, "state": "waiting" } }`
  (`players`: members connected; `seats`: 12; `state`: `waiting` in the lobby, `playing`
  during a match, `over` once it has ended), or `"open": null` when it is invite only
  again. Only the host may (`not-host`). It is sent when any of it changes and again
  every 5 minutes. The server keeps it in the room record as `open` (with `made`, the
  time it was first opened) and, after every write of the room, writes the entry
  `open | <made>#<code>` with a TTL of 15 minutes: `listed` true with the counts, or
  `listed` false to take it off. Each write carries the room's `rev` and is conditional
  on being newer than the entry's, so invocations that finish out of order cannot list
  a room again after a later write took it off.
- **Listed while** the host says open and the state is `waiting` or `playing`, `players`
  is under `seats`, a newcomer could get in (fewer than 16 members, or one of them is
  away and not the host, whose place `join` would give up) and someone is connected. A full
  room, a finished match, an empty room or invite only takes the entry off at once; a
  host who vanishes without a word lets it expire. A rematch lists it again.
- **The list.** `{ "t": "list", "id": 1 }` on any connection, answered
  `{ "t": "list", "id": 1, "now": <ms>, "games": [{ "room", "made", "players", "seats",
"state" }] }`: one Query of the `open` partition, newest first, at most 60 entries
  read, those made in the last 24 hours, expired and unlisted ones skipped (they count
  toward the 60, so the list can come back short, never long), the first 20 kept. No
  names or member ids. A read that fails answers an empty list.
- **The page.** `public/js/open-games.js` on the home page asks on a socket of its own
  when the page opens and every 30 seconds while it is in view, and shows each game as
  "2 of 12 on the pitch · waiting to start · made 4 min ago" with JOIN, the pitch's link.
  Without a rooms server in the build the section is left out.
- **Old clients.** A browser built before this ignores the document's `open` (it is
  dropped when that browser rewrites the lobby, so the host's next lobby write may close
  the game again until the host's page is reloaded), never sends `open` and never asks
  for the list; everything else works as before.

## 10. Replays

A finished pitch can be watched again (Jamie, 2026-11-16: "When a game is finished playing
on a pitch I'd like the URL to allow people to come and watch a replay of the match.").
The room server stores and hands out the replay; it knows no Kubb, so what a replay is
belongs to the game (`docs/MULTIPLAYER.md`, `docs/CLIENT.md` "Replays").

- **Keep.** When the action that ends a match lands, the browser that committed it, and
  every player's browser that sees that version arrive, sends
  `{ "t": "keep", "v": 12, "replay": { ... } }` (`room.keep`, `replayOf` in
  `src/net/lobby.js`), `v` the document version the match ended at. Members only
  (`not-joined`); a `replay` that is not an object is `bad-message`, one over 256 KB
  `too-big`, and a `v` that is missing or later than the room's document
  `bad-message`. The server stores it as the item `room#<code> | replay` for that
  version, not the one the room has reached since, so a late keep of an earlier match
  never takes a newer match's place (`v`, `t` the time, `z` the JSON gzipped, `exp` a year on), conditional on no
  unexpired replay of a later or the same version: the first keep of a match wins and
  later ones change nothing. Then it writes `keep = { v, until }` into the room record
  and moves the document's `exp` to `until`. From then on every write of the room or the
  document expires at the later of 48 hours on and `keep.until`, so a finished pitch
  stays a year from the end of its match, however often it is visited, and a rematch
  played there cannot shorten it. The next match's end keeps its replay in place of the
  last one, a year from then.
- **Fetch.** `{ "t": "replay", "id": 1, "room": "<code>" }` on any connection, no join,
  is answered `{ "t": "replay", "id": 1, "room", "v", "at", "replay" }`: the kept replay
  as JSON (not a string), with the version it was kept for and when; `replay: null`
  (and `v` 0) for a room never kept, a match in play, a match from before replays, or a
  room long gone. It can be more than one frame; the client's `ask` puts the parts
  together. A read that fails answers `null`. A bad code is `bad-room`.
  `src/replay/fetch.js` (`fetchReplay({ url, code })`) is the client: a socket of its
  own, so the replay can be fetched with no pitch page or room session.
- **Old rooms.** A match that ended before this has no log in its document and no
  replay item, so its pitch shows the result and the score sheet without WATCH REPLAY.
  One can be kept after the fact from the room's records in the games bucket, room by
  room and only with Jamie's go (Jamie approved the first, for one pitch, on 2026-11-16): `npm run games:pull -- --room
<code>`, then `node tools/backfill-replay.mjs --room <code>` builds the replay from the
  match's first snapshot (`start`, in place of `setup`) and its recorded actions and
  plays it through this engine (the hash after each action against the players', the
  first that differs, whether it ends on the recorded result), writing nothing; with
  `--write`, as `cloud-engineer`, it writes what a `keep` would have (the replay item,
  `room.keep` and the document's expiry, a year from the end of the match), only while
  the room's document still shows that very match and no replay is kept. A browser that
  arrives at a finished match with no log asks the room for its replay and offers WATCH
  REPLAY when it is that match, ending on the same snapshot (`lookForKept` in
  `src/net/pitch.js`). The bucket is only read on the machine that runs the tool; the
  replay is served from the table like any other.
- **No new AWS resources.** The replay is one more item in the rooms table, gzipped (the
  log's actions repeat their shape, so it packs well); the function's role already covers the table.
  The private games bucket is never read to serve a replay.

## 11. Pitch pages

The share tags and image of one pitch (Jamie, 2026-11-16: "can we get the share preview
image to reflect the game that it is linked to?") and the embed's state are read from the
rooms table by a second function, in the site stack (`infra/site.json`), not this one.

- **What it is.** `kubb-xyz-site-pages`, a Lambda Web Function (`backend/pages/main.mjs`,
  a Node HTTP server; esbuild bundle with the AWS SDK, resvg's wasm and the Londrina font)
  behind CloudFront with origin access control. CloudFront asks it for
  `/pitch/index.html?pitch=<code>`, `/embed/index.html?pitch=<code>` and
  `/share/kubb.png?pitch=<code>`.
- **What it reads.** `room#<code> | doc` (`v`, `doc`, `exp`), and, for a finished match
  or when the document is gone, `room#<code> | replay` (`z`, `exp`). A finished match
  says "Watch the replay" only when the kept replay is that match (the same `n`, `hash`
  and `snap`, as `lookForKept` in `src/net/pitch.js` checks): a rematch that could not be
  kept leaves the one before it in the room. Its role allows
  `dynamodb:GetItem` on the rooms table and its own logs, nothing more. It never reads
  the private games bucket, never writes, never lists open games. The page's HTML is the
  site's own `/pitch/index.html` or `/embed/index.html`, fetched and kept a minute.
- **What it says.** `backend/pages/pitch.mjs`: the state (none, waiting, playing, over),
  the words and the picture. Team names come from the match (`snap.save.game.teams`);
  member ids and player names never leave the function.
- **Caching.** The cache key is the path plus `pitch` and `v`. Pages are cached 60 s at
  the edge (300 s once the match is over); images 300 s, a day once over. The page's image
  link carries the document version, so a new state gets a new image.
- **Failing.** A code the rooms do not know gives the static page and a redirect to the
  static image. A function error or a 5xx sends CloudFront to the bucket (origin group),
  which serves the same files without the pitch's tags.
- **Cost.** A share or an embed load is one or two `GetItem` reads and one short
  invocation; images are cached at the edge.

## 12. Highlight reels

A finished pitch's highlight reel: a video of its best throws, tall (1080x1920) and wide
(1920x1080), made on the server from the kept replay with this engine (Jamie,
2026-11-19; the design and what a player sees are `docs/REEL.md`, deploying it
`docs/REEL-RUNBOOK.md`). Built for online pitches, and for a match against the computer
once it is shared (section 13): its sealed pitch has a kept replay of version 1.

- **Asking.** `{ t: "reel", id, room }` on any connection, joined or not, by anyone with
  the link (a reel shows nothing the replay does not). The answer is always
  `{ t: "reel", id, room, v, reel, why? }`: `v` is the kept replay's version (0 when
  none), and `reel` is `null` or `{ state, tag, at }` with, once `done`, `tall`, `wide`
  and `edit` (site paths, `/reels/<code>/<v>-<tag>/...`) and `seconds`.
  - `reel: null`, `why: "unavailable"`: this server has no renderer (a rooms stack
    without the reel function, or a store without reel items).
  - `why: "replay"`: the pitch has no kept replay.
  - `why: "engine"`: the match was played on an engine the renderer does not carry, or
    names none (a match from before `match.engine`). Its throws could go differently on
    another engine, so it is never rendered.
  - `why: "busy"`: today's 200 renders have started.
  - `state: "rendering"`: started; ask again (a few seconds apart).
  - `state: "done"`: the files are there for good (a year).
  - `state: "failed"`: it was tried twice and did not render (`reel.why` `"render"`,
    or none when the renders timed out), or (`reel.why` `"empty"`) the match had
    nothing to show: no throw at all, as when a player
    resigned before the first, or no moment picked. Final for that version and look.
- **One render a match.** The first request for a kept replay's version writes
  `room#<code> | reel` with a conditional put and only that request invokes the reel
  function (`InvocationType: Event`); every other one reads the item. The day's counter
  (`reels#<yyyy-mm-dd> | count`, a conditional `ADD`) is taken by that request alone.
  A rematch that is kept is a new version and a new render. The room server reads only
  the replay's `engine` field: it still knows no Kubb.
- **The reel function** (`kubb-xyz-site-reels`, site stack, `backend/reels/`): given
  `{ room, v, tag }`, it adds one to the item's `tries` (only while it is that render
  and `rendering`), refuses a try past the second (`failed`, `why: "render"`, nothing
  rendered), reads the replay, refuses another version or engine (`failed`,
  `why: "replay"` or `"engine"`) and a match with no throw (`failed`, `why: "empty"`),
  renders both formats into `/tmp`, puts them and the edit list under `reels/` in the
  site bucket and marks the item `done` with the paths and duration. A renderer that
  picks no moment declines before it starts an encoder, and that too is `failed`,
  `why: "empty"`, at once and with no retry. An error on the first try is thrown back
  for Lambda's one retry; on the second it marks `failed`, `why: "render"`. It logs the
  step, the engine version and the outcome, never a name.
- **Stuck renders.** A render still `rendering` 25 minutes after it started died
  without a word (a lost invoke, or a Lambda stopped at its timeout): the next request
  starts it again, unless it was tried twice already, which is then shown as `failed`.
  The takeover keeps the item's `tries` (the conditional put names the count it read,
  and only a new version or look starts from zero), and a takeover that the day's cap
  refuses or whose invoke fails puts the item back as it was, its `at` and `tries`
  kept.
- **The bound.** Every try that reaches the renderer adds one to `tries` before it
  renders, a stale takeover never lowers it, and the renderer renders only tries 1 and 2. So one job (a version and look) costs **at most two renders in all**, Lambda's own
  retry and every takeover included; a third invoke, from a takeover or a retry, marks
  it `failed` without rendering. Invokes that never reach the renderer render nothing,
  and each takeover is counted against the day's 200. The worst job is two renders
  stopped at the 300 s timeout: about 1,800 GB-s.
- **Served** by CloudFront's default behaviour from the site bucket, like any static
  file; the viewer request function passes `/reels/...` through. The objects are
  `video/mp4` (and `application/json` for the edit) with
  `Cache-Control: public, max-age=31536000, immutable`; a lifecycle rule expires
  `reels/` after 366 days, and the reel item expires with the replay. A deploy never
  writes or deletes under `reels/`.
- **Share tags.** The pages function (section 11) reads the reel item beside a finished
  match's own kept replay; when it is `done` for that version, `/p/<code>` gains
  `og:video` (the wide MP4) and the description ends "Watch the highlights."
- **Locally.** `npm run dev`'s room server renders reels in its own process with the
  ffmpeg on the PATH into `build/reels-dev/`, and the preview serves them at
  `/reels/...` (`tools/reels-dev.mjs`).

## 13. Sharing a match against the computer

A match against the computer is played on one device and has no room. Sharing it sends
the finished match once, when the player asks; the server plays it again through the
engine, and a match that passes is kept as a **sealed** pitch under a fresh code, a
year, exactly as a finished room is kept (Jamie, 2026-11-19; the design, the card and
the reasons are `docs/REEL.md` "Sharing a match against the computer"). From then on
the code is a pitch like any other: `/p/<code>`, the `replay` and `reel` messages, the
embed and the share tags. This section is the whole contract for a client.

### 13.1 Sending

Open a socket (section 2; on AWS `wss://throwingwood.com/ws`, with an allowed `Origin`
and a `User-Agent`), send no `join`, and send one message:

```
{ "t": "share", "id": 1, "g": {
    "client": "ios",
    "engine": "0.7.3",
    "start": "<the match's first snapshot, renamed>",
    "log": [ { "a": <action> }, ... ],
    "end": { "winner": "A", "throws": 60 } } }
```

| Field          | Required | What it is                                                                                                                                                |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | no       | echoed in the answer; any JSON value                                                                                                                      |
| `g.client`     | no       | the program (section 2.6): 1 to 32 of `a-z`, `0-9`, `.`, `-`. Checked, then dropped: it is never stored or passed on                                      |
| `g.engine`     | yes      | the engine's full version, `engine.version` (section 2.6): 1 to 64 of `a-z`, `0-9`, `.`, `-`, `+`                                                         |
| `g.start`      | yes      | the snapshot text the engine gave right after `newMatch(setup)`, renamed (below); a string, at most 16 KB                                                 |
| `g.log`        | yes      | every action applied, in order, each `{ "a": <the action object> }` as the engine produced it (throws, raises, punishment kubbs, the computer's included) |
| `g.end.winner` | yes      | `"A"` or `"B"`, the side the engine says won                                                                                                              |
| `g.end.throws` | yes      | the number of throw actions in `log`, both sides; a non-negative integer                                                                                  |

The match must be:

- a person against the computer: the setup's `cpu` is `"B"` alone (side A plays first
  or not, as the setup says), as the web's and the iPhone's solo setups make it;
- side B's team and every one of its players named `Computer`, as those setups name it;
- side A's team and every one of its players named with the name from the share card:
  1 to 16 characters (code points), no spaces at either end, and not "You" in any case.
  Make it with the engine: `renameStart({ start, names = { A = "<name>" }, log })`
  returns `{ start, log }`; send both as it returns them (the log carries ids made from
  the name). The typed name never leaves the device;
- finished: the last action ends the match.

Send the text as ASCII JSON (section 2) and cut it into parts exactly as any message
(section 2.1): a share is one message, usually several frames. The whole message may be
at most 256 KB; past it, or past 1000 actions, the answer is `too-long` (13.3). A match
that fits the engine's log budget is well inside both (13.4).

Wait for the answer at least **30 s** after the last part. The server plays the match
before answering; that takes seconds and can take up to 20 s.

### 13.2 The answer

Always one message, even when nothing could be kept:

```
{ "t": "shared", "id": 1, "code": "k7mq2xh9pd", "v": 1 }
{ "t": "shared", "id": 1, "code": null, "v": 0, "why": "busy" }
```

- `code`: the pitch, `https://throwingwood.com/p/<code>`, live at once. `v` is 1 (the
  kept replay's version). To make the highlight reel, send
  `{ "t": "reel", "id": 2, "room": "<code>" }` next, on the same socket (section 12).
- `code: null`, `v: 0` and `why`:

| `why`             | Meaning                                                                                                   | What the device does                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `unavailable`     | this server does not share matches (no renderer configured)                                               | keep the match; offer again later                    |
| `engine`          | the server's renderer does not carry this engine's major.minor                                            | keep the match; it may be shareable after an update  |
| `busy`            | today's shares are used up, or the renderer could not take the check within 20 s                          | keep the match; offer again later                    |
| `too-long`        | the match is longer than a shared match may be (13.4)                                                     | final for this match: it cannot be shared            |
| `does-not-replay` | the match does not play again to the same end through the engine, or is not a person against the computer | final for this match: something on the device is off |

The same match shared again (the same `start` and `log`, so the same name) is answered
the code it got the first time, at once, without a check and without counting against
either cap. A device that lost an answer just sends the same message again. The same
match under another name is another share.

### 13.3 Errors

`{ "t": "error", "code", "message", "re": "share", "id" }`, nothing kept:

| `code`        | When                                                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bad-message` | `g` is not an object; `client` or `engine` is not a valid tag; `start` is not a non-empty string; `log` is not a list of `{ a: <object> }`; `end` is not `{ winner: "A" or "B", throws: integer at least 0 }`; or a part is malformed (section 2.1) |
| `too-big`     | the reassembled message is over 300 KB (section 2.1)                                                                                                                                                                                                |
| `too-many`    | this connection has already had 2 matches checked (a repeat answered from 13.2 does not count); a new connection may share again                                                                                                                    |
| `failed`      | the store could not be read or written, or the renderer failed to answer (not a timeout); try again later                                                                                                                                           |

### 13.4 What is checked, in order

The rooms function, which knows no Kubb, refuses on cheap signals first:

1. the shape (`bad-message`), then the size: the whole message over 256 KB, `log` over
   1000 actions, or `start` over 16 KB is `too-long`;
2. no renderer or store support: `unavailable`;
3. `engine`'s major.minor not among the renderer's (`REEL_ENGINES`): `engine`;
4. shared before: the stored code (13.2);
5. the connection's 2 checks: `too-many`; the day's 200 checks (UTC days, a conditional
   counter): `busy`;
6. then it invokes the reel function synchronously with `{ check: g }` (no `client`) and
   waits up to 20 s. A renderer that does not answer in time, or stays throttled, is
   `busy`.

The renderer (`backend/reels/check.mjs`) plays it through the engine release it carries
and answers; it writes nothing:

1. `engine`'s major.minor is the carried one: else `engine`;
2. `start` is exactly what `newMatch` makes of its own options (`checkStart`), and the
   sides and names are as 13.1 says: else `does-not-replay`;
3. the log, replayed from `start` with every check on (`replayLoad` with `checkCpu`,
   `checkThrows` and `document`): no action refused, each of the computer's throws the
   one the engine makes again from the snapshot before it, each of the person's throws
   one the dial could make, the match over at its last action with the winner and throw
   count claimed: else `does-not-replay`;
4. the finished document keeps its log: the engine drops a document's log past its log
   budget (248 KB), and such a match has no replay, so it is `too-long`. The document and
   the replay must each fit 256 KB, or it is `too-long`.

Measured on v0.7.3 (club and beginner matches as the iPhone plays them; times on an
Apple-silicon Mac under heavy load, and in Docker limited to 1.75 CPUs and 3008 MB, the
renderer's Lambda size, on the same loaded machine; v0.7.2's slower times are in
`docs/REEL.md`):

| Actions | Turns | Message (ASCII JSON) | Parts | Kept document | Kept replay | Check (Mac)  | Check (Docker) |
| ------- | ----- | -------------------- | ----- | ------------- | ----------- | ------------ | -------------- |
| 65      | 9     | 30 KB                | 2     | 37 KB         | 37 KB       | 0.9 s        | 1.5 to 1.7 s   |
| 123     | 14    | 52 KB                | 2     | 65 KB         | 64 KB       | 1.8 s        | 3.1 to 3.4 s   |
| 179     | 19    | 74 KB                | 3     | 90 KB         | 90 KB       | 2.6 to 3.0 s | 4.3 to 4.9 s   |
| 402     | 34    | 162 KB               | 6     | 198 KB        | 197 KB      | 11 to 13 s   | 7.5 to 13 s    |
| 603     | 53    | 243 KB               | 9     | (`too-long`)  |             | 11 to 15 s   | 12 to 13 s     |

The document grows about 490 bytes an action, so the engine's budget ends a shareable
match at about 505 actions (about 40 turns): a message of about 204 KB, 7 of the 16
parts. A longer match is played to its end before it is answered `too-long`; the
603-action one is about the longest message the rooms take, so the worst check is about
15 s, inside the 20 s wait.

### 13.5 The sealed pitch

What is kept, all expiring together a year on (DynamoDB TTL):

- `room#<code> | room`: `{ host: null, members: {}, sealed: true, shared: <ms>, keep:
{ v: 1, until } }`, written only if the code is new;
- `room#<code> | doc`: version 1, the engine's finished document (`replayDocument`):
  `started: true`, `open: false`, the lobby's `teams` `{ A: ["A1"], B: [] }` (the
  engine's own seat id, no member id), and `match` with `over: true`, `cpu: "B"`, the
  setup, the last snapshot, the hashes and the log;
- `room#<code> | replay`: version 1, the replay of that match (`replayOf`), gzipped;
- `share#<sha256>`: the code, keyed by the SHA-256 of the ASCII JSON of `[start, log]`.

A sealed room refuses `join`, `set` and `keep` with the error `sealed` ("This pitch is a
shared match: it can be watched, not played."): nobody plays on, rematches or replaces
it. A client that opens `/p/<code>` and gets `sealed` from its `join` shows the finished
match from the `replay` message. `replay` and `reel` answer as for any finished pitch,
and the pages function reads it as one, with the computer's title form:
"Riverside vs Computer · Kubb: Throwing Wood", "Final: Riverside won, against the
computer (club), in 9 turns. Watch the replay."

What the server never keeps: `client`, the connection id, any member id, a user agent,
or the typed name (the device sends only the name from the share card). The kept match
does carry its setup, and with it the date and time the match began, to the minute.

### 13.6 Locally

`npm run dev`'s room server (`tools/rooms-dev.mjs`) shares end to end over the memory
store: it runs the check in its own process (`devShareChecker` in
`tools/reels-dev.mjs`) and answers `busy` when it took longer than the wait, so the
pitch, replay and reel of a shared match work on a laptop.
