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

| Piece                                  | Where                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Room logic (pure, both servers run it) | `backend/rooms/core.mjs`                                                |
| AWS Lambda handler, DynamoDB store     | `backend/rooms/handler.mjs`, `backend/rooms/dynamo-store.mjs`           |
| The recorder (every version, to S3)    | `backend/rooms/recorder.mjs`, `tools/games.mjs`                         |
| Reports (to S3)                        | `backend/rooms/reports.mjs`, `src/net/report.js`, `tools/reports.mjs`   |
| In-memory store (dev server, tests)    | `backend/rooms/memory-store.mjs`                                        |
| Local server                           | `tools/rooms-dev.mjs` (`node tools/rooms-dev.mjs`, ws://127.0.0.1:8788) |
| Browser client                         | `src/net/room.js`                                                       |
| CloudFormation                         | `infra/rooms.json`                                                      |
| Tests                                  | `node --test tests/net/`                                                |

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

`doc` events only move forward: a version older than the one held is dropped, so the
document a client holds never goes back. A client that reconnects gets the current
document in the join (unless it already holds that version) and a `doc` event if it
changed. The `with` of versions written while a client was away is not replayed: a
browser that loses its place just takes the snapshot (`DESIGN.md` 4.3).

## 2. The wire protocol

One WebSocket per browser tab. Every message is a JSON object with a type `t`, sent as
a text frame. All text is **ASCII JSON**: every character above `~` is written as a
backslash-u escape (`asciiJson` in both libraries), so a message's length in characters
is its size in bytes and it can be cut anywhere.

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
document, about 9 parts.

### 2.2 Client to server

| `t`      | Fields                                     |                                                                    |
| -------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `join`   | `room`, `member`, `me?` (or `name?`), `v?` | join (or rejoin) the room; `v` = the document version already held |
| `me`     | `me`                                       | merge own fields; `null` removes a key                             |
| `set`    | `id?`, `base`, `doc`, `with?`              | compare-and-set the document                                       |
| `cast`   | `d`                                        | relay to everyone else                                             |
| `claim`  |                                            | ask to become host                                                 |
| `leave`  |                                            | leave for good                                                     |
| `ping`   |                                            | keep-alive; answered with `pong`, needs no join                    |
| `report` | `id?`, `r`                                 | a player's report (section 8); needs no join                       |

`join` must be the first message on a connection (anything else but `ping` and `report`
answers `not-joined`).
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
castRate, castBurst, hostGraceMs }`.
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
  join moves the document's expiry along with it). An expired room code is a new, empty
  room. Connection records expire after 3 hours.
- **Origin.** On AWS `$connect` is refused (403) unless the `Origin` header is in
  `ALLOWED_ORIGINS` (default `https://kubb.thingelstad.xyz`, `http://localhost`,
  `http://127.0.0.1`; an entry without a port allows any port). The dev server applies the
  same list but also lets in connections with no `Origin` (Node tools and tests).

### 2.5 Error codes

`bad-room`, `bad-member`, `bad-message` (not JSON, unknown `t`, a bad part, a bad field),
`already-joined`, `not-joined` (no join yet, or this connection was replaced), `full`,
`busy` (the room record kept changing under the server; try again), `replaced`,
`too-big`, `rate`, `host-present`, `host-recent`, `not-next`; for `report` also
`too-many` (more than 3 on one connection), `failed` (it could not be written) and
`unavailable` (this server keeps no reports).

## 3. Limits

All in `LIMITS` in `backend/rooms/core.mjs`, the one place to change them.

| Limit                  | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| members a room         | 16                                                                 |
| document               | 256 KB as ASCII JSON (non-ASCII characters count 6 bytes each)     |
| `with` payload         | 4 KB                                                               |
| a cast message         | 2 KB                                                               |
| a member's `me` fields | 512 B                                                              |
| frame (either way)     | 30 000 B; API Gateway's quota is 32 KB                             |
| parts a message        | 16; a reassembled message at most 300 KB                           |
| cast rate              | 10 a second a connection, burst 20                                 |
| host grace             | 15 s                                                               |
| room and document TTL  | 48 h after the last write                                          |
| connection record TTL  | 3 h (API Gateway closes every connection at 2 h)                   |
| unfinished upload      | 10 min                                                             |
| room code              | 8 to 24 of `23456789abcdefghjkmnpqrstuvwxyz` (the client makes 10) |
| member id              | 8 to 40 of `A-Za-z0-9_-`                                           |
| a report               | 64 KB as ASCII JSON; each answer 1000 characters; 3 a connection   |

Fixed by API Gateway (not ours): 10 minutes idle and 2 hours total per connection (the
client pings every 4 minutes and reconnects on its own), 500 new connections a second
per account, 29 s integration timeout.

## 4. AWS shape (`infra/rooms.json`)

One stack, deployed by the deploy tool (not by hand): an API Gateway WebSocket API with
`$connect`, `$disconnect` and `$default` routed to one Lambda function (Node.js 24,
arm64, 256 MB, 10 s timeout, `index.handler` from the esbuild bundle of
`backend/rooms/handler.mjs` with `@aws-sdk/*` external), its own log group (30 days),
an execution role that can only use the rooms table, write that log group, post to
this API's connections and put objects under `games/` and `reports/` in the games bucket,
one DynamoDB
table (on demand, TTL on `exp`), and the private games bucket (section 7).

Throttling on the `prod` stage: **50 messages a second, burst 100** for every route,
and **5 a second, burst 20** for `$connect`. One room in play sends about 7 a second
(the thrower's aim) plus reactions, so this carries several rooms at once and caps what
a misbehaving client can cost. API Gateway drops throttled messages; the client's
`answerMs` timeout covers a dropped `set`.

The table (`pk`, `sk`, both strings):

| pk            | sk               | Holds                                                                     |
| ------------- | ---------------- | ------------------------------------------------------------------------- |
| `room#<code>` | `room`           | `rev`, `exp`, `json` (host and members, with each member's connection id) |
| `room#<code>` | `doc`            | `v`, `doc` (ASCII JSON text), `by`, `sid`, `exp`                          |
| `conn#<id>`   | `conn`           | `room`, `member`, `exp`                                                   |
| `conn#<id>`   | `part#<msg>#<i>` | `d`, `exp`: one part of an upload                                         |

The room is one item, so a relay costs one read; the document is its own item under the
same key, so relays do not pay to read it. Every write that depends on a read is
conditional (room on `rev`, document on `v`), because invocations for one room run in
parallel. A `set` reads the room after writing the document and a `join` reads the
document after writing the room, so a joiner always gets either the new document or its
broadcast. Parts of one upload are stored, then each invocation queries them; the one
that sees all of them wins a conditional delete of part 0 and handles the message.

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
- **The Origin check is a light filter**, not authentication: a non-browser client can
  send any Origin. The stage throttle and the size limits bound what such a client can do.
- **The cast rate cap is best effort** on AWS (per Lambda instance).
- No accounts and no personal data beyond the name a player types; rooms vanish 48 hours
  after their last write. Lambda logs carry connection ids and error names, not
  documents or names. The games bucket keeps every document version, names included
  (section 7), and every report, with what the player typed (section 8).

## 7. Recording

Every committed version of a room's document is kept for good, so that real play can be
run through the engine again (Jamie, 2026-11-15: "all games should be recorded so that we
can use it to test and improve the game").

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
  replay takes the recorded snapshot and carries on. A record does not name the build
  that played it: its time `t` against the deploy history does.

## 8. Reports

A player who saw a throw go wrong says so from the game's menu (REPORT A THROW), and the
browser sends what they typed with the game as it stood, so the moment can be played again
offline (Jamie, 2026-11-16; `AGENTS.md` "Reports"). The room server knows no Kubb here
either: it checks the shape and the size, keeps the report and acknowledges it.

- **The message.** `{ "t": "report", "id": 1, "r": { ... } }`, sent on any connection,
  joined to a room or not. The browser opens a socket of its own for it, waits for the
  answer (15 s at most) and closes, on a shared pitch too (the room's own socket may be
  reconnecting). A report longer than a frame goes in parts (section 2.1). The server
  requires `r.mode` (`practice`, `solo`, `watch` or `pitch`), `r.happened` and
  `r.should` (text, 1000 characters each, at least one not blank), `r.room` a room code
  when present, and the whole message at most 64 KB (`LIMITS.reportBytes`); everything
  else in `r` is the browser's (`src/net/report.js` lists it). The answer is
  `{ "t": "reported", "id": 1 }` or an `error` with `re: "report"` and the `id`.
- **What is kept.** One gzipped JSON object a report in the games bucket:
  `reports/<yyyy-mm-dd>/<epoch ms, 13 digits>-<8 random>.json.gz`, holding
  `{ t, report }`: the server's time and `r` as it came. The server adds nothing that
  names the sender: no connection id, member id, address or browser string. Kept for
  good, like the games (no lifecycle rule on the bucket).
- **Joining a recorded game.** A shared pitch's report carries `room` and the document
  version `v` it had, so it joins `games/<room>/` at that version instead of copying it.
  It also carries its own snapshots, so it replays without the records.
- **Limits.** 3 reports a connection, counted in the Lambda instance (a best effort, as
  the cast buckets are); the stage throttle is the hard cap. A report that cannot be
  written is answered `failed` and does not count.
- **Reading them.** `npm run reports:pull`, then `npm run reports:replay -- <file>`
  (`tools/reports.mjs`). The local server (`node tools/rooms-dev.mjs`) writes them to
  `build/reports-dev/` in the same shape; `startRoomsServer({ report })` takes any
  reporter (the tests use `memoryReporter`), and without one reports are `unavailable`.
