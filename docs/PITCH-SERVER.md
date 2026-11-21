# The pitch server

The plan for the next live multiplayer server. It replaces the rooms server in
`docs/ROOMS.md` (API Gateway WebSocket, one Lambda invoke a message, DynamoDB). That
server is still the live one until the cutover below. Nothing here is built yet except a
throwaway proof of concept in `backend/room-server-poc/`.

This is a working document. It holds what was decided, what was measured and what is
still open, so the build can start on any machine without the conversation that led to
it.

## 1. Why

A two-iPhone match on 2026-11-20 (about 37 minutes) felt jittery and slow, and the
other player's throw was hard to follow. Its records showed why:

- Aim was sent about 5 times a second, with no timestamps. The watcher snapped from
  sample to sample.
- Every action re-uploaded the whole shared document with its log: up to 155 KB, 250 to
  700 ms a commit. Most commits went as 2 to 6 frames of 30 KB.
- Six cold starts, each a stall of about 2 s.
- The iPhone waits for the server's `ok` before it lets the next action go.
- The hand-off card hides the other player's dial for 2.5 s.

Inside Lambda alone an aim frame took about 36 ms, before any network.

## 2. Requirements

In Jamie's words (2026-11-21):

- "We are in dev and can break anything currently running." No backward compatibility:
  not for the protocol, the live web, or TestFlight builds.
- "I want to support 12 players (6 v 6 Kubb) and potentially observers watching too."
  Size a pitch for 12 players and a crowd, not for two.
- "I prefer server less always. ... costs need to be as low as we can but I'm okay if
  this costs something."
- "and remember we do NOT need backwards compatibility on anything… all previous stored
  games can be removed as needed." Old kept replays, shares, reels and recorded games
  need no migration. Stored keys and record formats may change freely (section 5,
  "Stored data").

The build is approved (Jamie, 2026-11-21: "yeah… lets land the pitch server
migration"). It follows this document, step by step (section 10).

## 3. The decision

Live pitches run on Cloudflare Durable Objects. Everything else stays in AWS.

Jamie, 2026-11-21: "Love this. And I'm totally fine with cloudflare doing this. Sounds
perfect. And keeping the other stuff in AWS makes sense."

Why not the others:

- **API Gateway WebSocket, AppSync Events, IoT Core** each bill every delivered message.
  A 75-minute 6 v 6 match with 20 watchers is about $1 a match.
- **Lambda Web Functions** has no WebSocket upgrade.
- **Lambda MicroVMs** can hold sockets, but has an undocumented request limit per
  MicroVM and short-lived connection tokens (60 minutes).
- **Durable Objects**: about $5 a month flat (Workers Paid) up to roughly 100 matches a
  day with hibernation. Outgoing WebSocket messages are not billed. The free plan is
  enough for development.

## 4. Naming

Jamie, 2026-11-21: "changing "room" to "pitch" it is a more accurate Kubb word… players
play on a pitch." and "queue it for a rename in the new build".

- "Pitch" in everything new: the Worker, the Durable Object (`PitchDO`), the wire
  protocol (`/ws?pitch=<code>`), the docs and the rewritten client networking.
- The engine's `room.*` module is renamed with the engine's next minor. No engine
  release is cut only for the name.
- AWS stack, table and bucket names stay (`kubb-xyz-rooms` and the rest) unless there
  is a reason: renaming one replaces the resource.
- Stored keys may change. The new store may use `pitch#<code>` keys and a new record
  format if that is simpler (section 5, "Stored data").
- The proof of concept keeps "room". It is thrown away.

## 5. Architecture

At Cloudflare:

- One Worker. It checks the request and hands the socket to the pitch's object.
- One `PitchDO` per pitch, named by the pitch code (`idFromName`).
  - WebSocket Hibernation API (`ctx.acceptWebSocket`), so an idle pitch costs nothing.
  - SQLite storage (`ctx.storage.sql`): the action log, the head (sequence and hash), the
    lobby document.
  - In-memory state is rebuilt in the constructor after every wake
    (`blockConcurrencyWhile`). Nothing may live only in memory.
  - Timers are alarms (`ctx.storage.setAlarm`), never `setTimeout`, which would keep the
    object awake.
  - `setWebSocketAutoResponse` answers a literal `ping` without waking the object.
- One `LobbyDO` holds the open-games list (today's `open` partition in DynamoDB).

In AWS, unchanged: the site and CloudFront, the rooms table (kept replays, shares,
reels), the private games bucket, the pitch pages function and the reels function.

Between them:

- The pitch pushes each committed action record, and the kept replay at the end, to a
  new Lambda function URL (working name `kubb-xyz-api`). Each request is signed with an
  HMAC over the body using a shared secret. No AWS keys live at Cloudflare.
- The function writes the recorder's objects to the games bucket and the kept replay to
  the rooms table, as the rooms function does today.
- Messages that are not live play become plain HTTPS calls to that function: `report`,
  `game`, `replay`, `reel`, `share`.

Stored data:

- No backward compatibility. Old kept replays, shares, reels and recorded games are not
  migrated, and nothing new has to read them.
- Keys and formats may change freely: `pitch#<code>` keys and a new record format are
  fine if simpler. Stack, table and bucket names stay (renaming replaces resources).
- Deleting old stored games is a separate, named step for the owner at cutover. No pull
  request deletes stored data on its own.

## 6. Protocol

The full contract is written in build step 1. What it must do:

- **Stamps.** Every relayed frame carries the pitch's sequence `s` and the server's
  clock `ts` in ms.
- **Actions only.** A commit is `{ t: "act", id, n, seq, a, h, snap }`: the match
  number, the next sequence, the action, the hash after it and the snapshot after it.
  About 10 to 14 KB in. The relay to everyone else drops the snapshot: about 600 B.
  Then `ok` goes to the sender.
- **One wins.** `seq` must be the head plus one. Two players acting at once: one is
  stored, the other is refused with the head, and both see the same log.
- **Duplicates.** An `id` already stored is acked again with its stored sequence, not
  stored twice. A client may resend freely after a drop.
- **Lobby writes** are compare-and-set on the lobby document, without the log.
- **The full state** (lobby, last snapshot) goes only on join or on a resync.
- **Resume.** A client that comes back sends the last sequence it has. The pitch sends
  back exactly the actions it missed.
- **Aim** casts at up to 15 Hz. Receivers keep about 100 ms of buffer and interpolate
  between samples by `ts`.
- **Observers** are read-only. They get a thinned feed: at most one cast per sender per
  100 ms.
- **No engine on the server.** The pitch relays and keeps the log. It does not run the
  Lua engine. Clients cross-check hashes, as they do today. So the server needs no
  engine release and carries no engine list.

Recommended, still to confirm: relay an action first and write it right after.
Measured 25 ms median against 42 to 51 ms for writing first. The cost: an action could be
shown and then lost if the object dies between the two. The next commit's sequence or the
hash check catches it, and the client resyncs.

## 7. Client work

Web: `src/net/room.js` (rewritten as the pitch client), `src/net/pitch.js`,
`src/net/ask.js`.

iPhone (`throwingwood-ios`): `RoomsClient.swift`, `Transport.swift` (its
`maximumMessageSize = 32 * 1024` must be raised: a join with the full state is larger),
`PitchController.swift`, `OnlinePitch.swift`.

Both:

- Send aim at up to 15 Hz with timestamps, and keep sending through the release.
- Interpolate the other player's aim on the watcher.
- iPhone: do not block the next action on `ok`.
- Show the other player's dial during the hand-off.

## 8. What the proof of concept measured

2026-11-21, deployed on workers.dev, driven from one Mac about 15 ms round trip from
Cloudflare. Synthetic payloads sized like real ones. Phones on mobile networks were not
measured, nor many pitches at once.

Times are median / p95 / p99 in ms.

| Measure                                      | 32 sockets (12 + 20) | 112 sockets (12 + 100) |
| -------------------------------------------- | -------------------- | ---------------------- |
| Aim relay, sender to receiver                | 21.1 / 26.7 / 30.3   | 23.4 / 29.0 / 32.6     |
| Action commit to other players (write first) | 46.6 / 52.9 / 58.7   | 50.7 / 57.0 / 246      |

- Write first 41.6 ms median against relay first 24.8 ms.
- The action log was identical on every client in every run.
- Simultaneous actions: settled correctly 10 times of 10.
- Hibernation: the object slept in both 30 s idle gaps. The first message after a wake
  was about 20 ms slower. Pings were answered by the runtime without waking it.
- Resume: three dropped players each got back exactly the 4 actions they missed.
- No stall over 1 s in any run.
- Observers got about 7.5 aim frames a second. The target was 10.
- A deploy reached a busy pitch about 300 s after it was made. It dropped all 32
  sockets at once. All were back in under half a second, and nothing was lost.
- The whole session used an estimated 2 to 3% of the free plan's daily limits.

Against the old server: 36 ms inside Lambda alone for an aim frame, 250 to 700 ms a
commit, stalls of about 2 s.

## 9. Tooling facts

- Deploys use the `cf` CLI. It reads `cloudflare.config.ts` only, not `wrangler.jsonc`.
  `wrangler` is still used for `wrangler dev` and the Workers test pool.
- Durable Objects are declared in `cloudflare.config.ts` as
  `exports: { X: exports.durableObject({ storage: "sqlite" }) }`, with a binding in
  `env` (`bindings.durableObject({ worker, exportName })`).
- There is no setting for how fast a deploy reaches a busy object. Expect about 300 s
  and a drop of every socket.
- Secrets go with `cf deploy --secrets-file <file>`.
- Sign in: `cf auth login --scopes challenge-widgets.write workers-scripts.write
workers-scripts.read workers-tail.read` (a device code the account owner enters).
- The account's workers.dev subdomain is `throwingwood`.
- The proof of concept is deployed as `throwingwood-rooms-poc`. Delete it once the real
  server exists. Its storage holds one orphan test pitch of made-up data.

## 10. Build order

Each step is its own pull request.

1. Pitch core as pure, tested logic: the protocol, sequencing, duplicates, resume,
   lobby compare-and-set, observer thinning. No Workers APIs.
2. `PitchDO`, the Worker and `LobbyDO`, with tests in the Workers pool.
3. The AWS function the pitch reports to (`kubb-xyz-api`): HMAC check, records, kept
   replay, and the HTTPS calls (`report`, `game`, `replay`, `reel`, `share`).
4. The web client.
5. The iPhone client.
6. Cutover, then remove the old WebSocket API and its function. Deleting old stored
   games, if wanted, is the owner's own named step here.

## 11. Open: the owner's calls

- Which address the apps connect to:
  - keep `wss://throwingwood.com/ws` with CloudFront forwarding to the Worker (untested),
  - or the workers.dev name,
  - or move the whole zone to Cloudflare.
- Turnstile on create and join. It has no native iPhone path.
- Whether a dead code answers "no such pitch" instead of opening an empty one.
- The cap on observers: 20 or 100.
- Deploys only in quiet hours, or a "reconnecting" state the apps show.
- A line on the privacy page that names Cloudflare.
- A CI token for deploys.
- The hand-off card and online pacing (0.8 s rest, 0.7 s per auto-raise).
