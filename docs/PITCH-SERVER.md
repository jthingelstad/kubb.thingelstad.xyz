# The pitch server

The plan for the next live multiplayer server. It replaces the rooms server in
`docs/ROOMS.md` (API Gateway WebSocket, one Lambda invoke a message, DynamoDB). That
server is still the live one until the cutover below. Built so far: the pitch core
(build step 1, `backend/pitch-server/core.mjs`, its wire protocol in
`backend/pitch-server/PROTOCOL.md`), the Worker with `PitchDO` and `LobbyDO` (build step
2, `backend/pitch-server/src/`, deployed to dev as `throwingwood-pitches-dev`; deploying
and operating it: `backend/pitch-server/README.md`), and a throwaway proof of concept in
`backend/room-server-poc/`. The web client is moved onto them in its cutover pull
request (build step 4, docs/MULTIPLAYER.md); until that merges no live client uses them.

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
- AWS names (Jamie, 2026-11-21: "abandon the xyz nomenclature. This is now Throwing
  Wood."): everything new is `throwing-wood-*` (`tw` where a short prefix is needed),
  starting with the pitches stack (section 12). The live `kubb-xyz-*` stacks, buckets
  and functions keep their names until each is replaced or retired: renaming one
  replaces the resource.
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

In AWS, unchanged: the site and CloudFront, the pitch pages function and the reels
function. New, in the `throwing-wood-pitches` stack: the api function, its own table
(kept replays, shares, reels) and its own private games bucket. The rooms stack, with
its table and games bucket, goes at cutover.

Between them:

- The pitch pushes each committed action record, and the kept replay at the end, to a
  new Lambda function URL (`throwing-wood-api`, `backend/api/`). Each request is signed with an
  HMAC over the body using a shared secret. No AWS keys live at Cloudflare.
- The function writes the recorder's objects to its games bucket and the kept replay to
  its table, as the rooms function does to the old ones today.
- Messages that are not live play become plain HTTPS calls to that function: `report`,
  `game`, `replay`, `reel`, `share`.

Stored data:

- No backward compatibility. Old kept replays, shares, reels and recorded games are not
  migrated, and nothing new has to read them.
- Keys and formats may change freely: `pitch#<code>` keys and a new record format are
  fine if simpler. The new records go to a new table and bucket, so the old ones go
  whole with the rooms stack.
- Deleting old stored games is a separate, named step for the owner at cutover. No pull
  request deletes stored data on its own.

## 6. Protocol

The full contract, as built, is `backend/pitch-server/PROTOCOL.md`. What it does:

- **Stamps.** Every relayed frame carries the pitch's sequence `s` and the server's
  clock `ts` in ms. `s` goes up with every frame that changes the pitch for everyone
  (members, host, lobby, start, actions) and survives sleeps, so a jump means a client
  missed something. A cast carries the current `s` and its own `ts`.
- **Actions only.** A commit is `{ t: "act", id, n, seq, a, h, snap }`: the match
  number, the next sequence, the action, the hash after it and the snapshot after it,
  with an optional `over: true` on the action that ends the match. About 10 to 14 KB
  in. The relay to everyone else drops the snapshot: about 600 B. Then `ok` goes to the
  sender.
- **Starting a match** is `start`: a lobby write (compare-and-set) from the host that
  also sets the next match's number, its first hash and snapshot and an opaque `meta`
  (setup, engine, players). It drops the previous match's log.
- **One wins.** `seq` must be the head plus one. Two players acting at once: one is
  stored, the other is refused with the head, and both see the same log.
- **Duplicates.** An `id` already stored is acked again with its stored sequence, not
  stored twice. A client may resend freely after a drop.
- **Lobby writes** are compare-and-set on the lobby document, without the log.
- **The full state** (lobby, last snapshot) goes only on join or on a resync.
- **Resume.** A client that comes back sends the match and the last action sequence it
  has. The pitch sends back exactly the actions it missed, or the whole state when it
  is more than 64 actions behind, ahead of the pitch, or on another match.
- **Aim** casts at up to 15 Hz. Receivers keep about 100 ms of buffer and interpolate
  between samples by `ts`.
- **Observers** are read-only. They get a thinned feed: about one cast per sender per
  100 ms on average, never two within 50 ms (the proof of concept's "at most one per
  100 ms" could only give 7.5 Hz from 15 Hz aim). A cast marked `all` (a shout, the
  release) reaches them unthinned.
- **The host** is the pitch's decision: kept 15 s while away, then passed to the
  earliest-joined connected player. Observers are never host, so they no longer leave
  and join again. There is no `claim`.
- **The kept replay** is built by the pitch from its own log when the `over` action
  lands, and pushed to AWS. No client uploads it (`keep` is gone).
- **No engine on the server.** The pitch relays and keeps the log. It does not run the
  Lua engine. Clients cross-check hashes, as they do today. So the server needs no
  engine release and carries no engine list. It cannot tell whose turn it is: "out of
  turn" on the server means the wrong match, a finished match or the wrong sequence;
  seats stay the engine's rules in the clients.

Recommended, still to confirm: relay an action first and write it right after
(`commitOrder: "relay-first"`, the core's default; `write-first` is the other).
Measured 25 ms median against 42 to 51 ms for writing first. The cost: an action could be
shown and then lost if the object dies between the two. The next commit's sequence or the
hash check catches it, and the client resyncs (a test in `tests/pitch-server/` shows it).

## 7. Client work

Web (done in step 4): `src/net/pitch-client.js` (the pitch client, replacing
`src/net/room.js`), `src/net/aim.js`, `src/net/pitch.js`, and `src/net/api.js` for the
HTTPS calls (replacing `src/net/ask.js`). docs/MULTIPLAYER.md "What the iPhone app
mirrors" is the list for the iPhone.

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

### The real server (build step 2)

2026-11-21, the same Mac, against `throwingwood-pitches-dev` on workers.dev, with the
driver in `backend/pitch-server/driver/` (synthetic data only: casts padded to 300 B,
actions with 12 KB snapshots). Round trip to the Worker's `/health`: 30 ms median, 97 ms
p95. Times are median / p95 / p99 in ms, 12 players and 20 observers.

| Measure                        | relay first        | write first        |
| ------------------------------ | ------------------ | ------------------ |
| Aim relay to players           | 22.2 / 28.8 / 33.2 | 22.5 / 34.8 / 45.7 |
| Aim relay to observers         | 22.1 / 29.2 / 33.9 | 24.0 / 38.0 / 48.3 |
| Action commit to other players | 25.8 / 32.0 / 35.0 | 48.5 / 71.9 / 76.7 |
| Action commit to observers     | 24.9 / 32.4 / 36.5 | 49.4 / 73.2 / 77.4 |
| `ok` back to the actor         | 24.7 / 35.2        | 47.6 / 77.9        |

- Three minutes of 6 v 6 with 20 observers (55 actions): aim 20.5 / 25.8 / 28.9,
  actions 23.1 / 28.6 / 33.4, ten aim frames of about 9 400 over 250 ms (the worst 383),
  none over 1 s. Joining took about 120 ms.
- Observers got 10.2 aim frames a second from 15 Hz, never two closer than 53 ms (the
  target was 10; the proof of concept gave 7.5).
- The action log was identical on all 32 clients in every run, with no jump in `s`.
- Simultaneous actions: one stored and the same log everywhere, 10 times of 10.
- Resume: three dropped players each got back exactly the 4 actions they missed.
- Hibernation: the object slept and was rebuilt from storage in both 30 s idle gaps,
  with literal pings and without; the first aim after a wake took 23 to 25 ms.
- A deploy 30 s into a two minute match (`dev-1` to `dev-2`) dropped nothing: no socket
  closed, the busy pitch kept running the old code to the end, new requests got the
  new one at once.
- The SQLite store held about 15 KB an action at these sizes (the head's snapshot and
  the outbox's copies; nothing was pushed, there is no receiver yet).
- Every run, the tests included, used well under 1% of the free plan's daily Durable
  Object requests (about 700 billed requests in all).

Against the old server: 36 ms inside Lambda alone for an aim frame, 250 to 700 ms a
commit, stalls of about 2 s.

## 9. Tooling facts

- Deploys use the `cf` CLI. It reads `cloudflare.config.ts` only, not `wrangler.jsonc`.
  `wrangler` is still used for `wrangler dev` and the Workers test pool.
- Durable Objects are declared in `cloudflare.config.ts` as
  `exports: { X: exports.durableObject({ storage: "sqlite" }) }`, with a binding in
  `env` (`bindings.durableObject({ worker, exportName })`).
- There is no setting for how fast a deploy reaches a busy object. The proof of
  concept saw about 300 s and a drop of every socket; step 2's two minute run saw no
  drop at all. Clients must handle both.
- `cf deploy` with `</dev/null` never prompts; it printed no question in any deploy.
- Secrets go with `cf deploy --secrets-file <file>`.
- Sign in: `cf auth login --scopes challenge-widgets.write workers-scripts.write
workers-scripts.read workers-tail.read` (a device code the account owner enters).
- The account's workers.dev subdomain is `throwingwood`.
- The proof of concept is deployed as `throwingwood-rooms-poc`. Delete it once the real
  server exists. Its storage holds one orphan test pitch of made-up data.

## 10. Build order

Each step is its own pull request.

1. Pitch core as pure, tested logic: the protocol, sequencing, duplicates, resume,
   lobby compare-and-set, observer thinning. No Workers APIs. Built:
   `backend/pitch-server/core.mjs`, tests in `tests/pitch-server/`.
2. `PitchDO`, the Worker and `LobbyDO`, with tests in the Workers pool. Built:
   `backend/pitch-server/src/`, tests in `backend/pitch-server/test/` (CI runs them) and
   `tests/pitch-server/edge.test.mjs`; deployed to dev.
3. The AWS function the pitch reports to: HMAC check, records, kept replay, and the
   HTTPS calls (`report`, `game`, `replay`, `reel`, `share`). Built, not deployed:
   `backend/api/` (its contract `backend/api/API.md`), tests in `tests/api/`, the
   function `throwing-wood-api` in its own stack (`infra/pitches.json`) and `/api/*` in
   `infra/site.json`, off behind `"pitchesStack"` (section 12). The pitch pages and the
   reels read its `pitch#` records.
4. The web client: built in its cutover pull request, `tools/pitch-dev.mjs` and
   `wrangler dev` for local play. Merging it is the cutover.
5. The iPhone client.
6. Cutover, then delete the whole old rooms stack (section 12, "What cutover deletes").
   Deleting old stored games is the owner's own named step here.

## 11. Open: the owner's calls

- Which address the apps connect to:
  - keep `wss://throwingwood.com/ws` with CloudFront forwarding to the Worker (untested),
  - or the workers.dev name,
  - or move the whole zone to Cloudflare.
- Turnstile on create and join. It has no native iPhone path.
- Whether a dead code answers "no such pitch" instead of opening an empty one (the
  core's `unknownPitch`: `open`, today's behaviour, by default; `refuse` needs
  `create: true` on the join that makes a pitch). An observer never opens one either way.
- The cap on observers: 20 or 100 (the core's `limits.observers`, 20 by default).
- Deploys only in quiet hours, or a "reconnecting" state the apps show.
- A line on the privacy page that names Cloudflare.
- A CI token for deploys.
- The hand-off card and online pacing (0.8 s rest, 0.7 s per auto-raise).
- How long an unconfirmed push is retried. Today: for as long as the pitch lives, at
  most every 5 minutes, and a pitch with pending pushes is never wiped.
- Rate limits beyond each connection's own (section 9 of the protocol) and the 5 s cache
  on `/open`: per address at the Worker, if abuse ever shows.
- The Worker's name for production (`throwingwood-pitches`?) and whether dev stays.

## 12. Step 3: turning it on

Steps 1 to 3 of the order below were done on 2026-11-21: the pitches stack is up, the
delivery role may update `throwing-wood-api`, and `"pitchesStack"` is on. The site stack
is not applied, so nothing players reach points at it yet. Before that the api function
was in the repository and off, and merging it changed nothing live:
`tools/deploy.mjs` updates its code only once a pitches apply has created it and
`"pitchesStack"` is on, and the pitch pages and reels code that read `pitch#` records
goes live only with a site apply.

### What turning it on creates

One new stack, `throwing-wood-pitches` (`infra/pitches.json`, tags as the other stacks
but `Project: throwing-wood`). It owns everything the new system keeps, so the old rooms
stack can later go whole:

- `throwing-wood-api`: Node 24, arm64, 256 MB, 30 s, at most 10 at once, its code
  `api/<sha256>.zip` in the site stack's code bucket (`kubb-xyz-site-code-<account>`,
  which keeps its old name).
- Its function URL, public (`AuthType NONE`): the pitch server pushes to it, and
  CloudFront's `/api/*` sends the apps' calls to it.
- `/aws/lambda/throwing-wood-api`, 30 days.
- `ApiRole`, its execution role (a generated name), which may only:
  - `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem` on the pitches table, for keys that
    start `pitch#`, `share#`, `reels#` or `shares#`;
  - `PutObject` under `games/pitch/`, `games/browser/` and `reports/` in the pitches
    games bucket (no reads, no deletes);
  - `GetSecretValue` on the push secret only;
  - write its own log group;
  - invoke the reels function, when the renderer is on.
- `throwing-wood/push-secret`: the shared secret, made by Secrets Manager (64 letters and
  digits). Nobody types it and it is never in a template, a parameter or a log. The
  function reads it when it runs.
- The pitches table (a generated name, `throwing-wood-pitches-PitchesTable-...`): `pk`
  and `sk` strings, TTL on `exp`, on demand, no point-in-time recovery, deleted with the
  stack: as the rooms table.
- `throwing-wood-pitches-games-<account>`: the private games bucket, kept when the stack
  goes; public access blocked, SSE-S3, bucket owner enforced, TLS only, no versioning or
  lifecycle: as the rooms games bucket.
- Outputs `ApiUrl`, `ApiFunctionName`, `PushSecretArn`, `TableName`, `GamesBucket`,
  exported as `throwing-wood-api-url`, `throwing-wood-api-function`,
  `throwing-wood-push-secret-arn`, `throwing-wood-pitches-table` and
  `throwing-wood-pitches-games-bucket`.

The site stack then adds an origin for the function URL and the `/api/*` behaviour (no
caching, every header but `Host` forwarded, the site's web ACL), and points the pitch
pages and the reels function (their `PitchTable`, roles and `TABLE`) at the pitches
table's `pitch#` keys. The delivery stack lets `main` update `throwing-wood-api`'s code.

### The secret: the owner's steps

The simplest scheme: one secret, made in AWS, copied once into the Worker. Claude never
reads, prints or moves its value.

1. After the pitches apply, open Secrets Manager in the console (us-east-1),
   `throwing-wood/push-secret`, "Retrieve secret value", and copy it.
2. In `backend/pitch-server/`, add the line `PUSH_SECRET=<value>` to `.dev.vars`
   (gitignored, beside `DEV_KEY`) and deploy the Worker with
   `npx cf deploy --secrets-file .dev.vars </dev/null` (its README.md "Deploy").
3. Set the Worker's plain variable `PUSH_URL` (`env` in `cloudflare.config.ts`) to the
   pitches stack's `ApiUrl` output followed by `push` (the output ends in `/`, so
   `https://<id>.lambda-url.us-east-1.on.aws/push`), in a pull request, and deploy
   again. The outbox then drains: every push it held is sent.
   Done for the dev Worker on 2026-11-21 (`dev-3`), with a synthetic match's pushes,
   objects, `state` and `replay` items and served replay all checked.
4. To rotate: "Rotate secret immediately" is not set up (no rotation function); instead
   put a new value in the console ("Edit"), then repeat step 2. Pushes signed with the
   old value fail with 401 until the Worker has the new one and are retried, so nothing
   is lost; the function reads the new value within 5 minutes of the first failure.

### Order

As `cloud-engineer` (`AWS_PROFILE=cloud-engineer`), plan first each time. A plan
creates nothing: for a stack that does not exist yet it lists the template's resources
without a change set, and every change set it makes is deleted once printed.

1. `"pitchesStack": true` in `infra/deployment.json`, in a pull request.
2. `npm run infra:plan -- pitches`, then `npm run infra:apply -- pitches`: the stack
   above. `infra/deployment.json` gains a `pitches` block.
3. `npm run infra:plan -- delivery`, then `infra:apply -- delivery`: `main` may update
   `throwing-wood-api`'s code. Commit the rewritten `infra/deployment.json` only after
   this (a deploy from `main` with the `pitches` block and no delivery grant fails).
4. The secret's steps above.
5. At cutover only: `npm run infra:plan -- site`, then `infra:apply -- site`. This adds
   `/api/*` and points the pitch pages and reels at the pitches table, so every pitch
   played on the old rooms server loses its preview, replay embed card and reel. Do it
   with step 4 of the build order (the web client), not before. Until then, name the
   stacks on every apply: with the flag on and the stack there, a bare `infra:apply`
   includes site.

`npm run games:pull` and `reports:pull` read the pitches games bucket once
`"pitchesStack"` is on and the stack is there (pushes land in
`build/games/pitch/<code>/<made>/`; `games:replay` does not play them yet), the rooms
games bucket before.

Roll back by setting `"pitchesStack": false` and applying site and delivery (the site
goes back to the rooms table and loses `/api/*`). The stack itself stays until the
owner deletes it (`aws cloudformation delete-stack --stack-name throwing-wood-pitches`:
the function, URL, role, logs, table and secret go, Secrets Manager keeping a deleted
secret 7 to 30 days; the games bucket stays and is emptied and deleted by hand).

### What cutover deletes

The owner's own named step, once the web and iPhone clients are on the pitch server and
nothing reaches `/ws`: `"wsRoute": false`, `infra:apply -- site` (the `/ws` route goes),
then delete the whole `kubb-xyz-rooms` stack (`aws cloudformation delete-stack
--stack-name kubb-xyz-rooms`): the WebSocket API, `kubb-xyz-rooms-rooms`, its role and
log group, and the rooms table with every old room, kept replay, share and reel in it.
Its games bucket, `kubb-xyz-rooms-games-<account>`, is kept by its `Retain` policy:
deleting the old recorded games and reports is emptying and deleting that bucket by
hand, a separate named step. Then drop `rooms` from `infra/deployment.json` and the
delivery stack's rooms grant (`RoomsFunctionName`) in a pull request.

### Owner's calls for step 3

- Daily caps for reports and one-device matches (none today beyond size and the 10
  concurrent runs; the old 3 a connection has no connection to hang on).
- The function URL is public and outside the web ACL for the apps' calls too. A
  CloudFront origin access control for Lambda would close that, but the pitch server
  must still reach `push`.
- A signed push this function cannot read is answered 400 and retried for as long as
  the pitch lives; a replay over the limit is 200 `kept: false`.
- `meta`, settled in step 4: the host sends it with `start` as
  `{ v: 1, setup, engine, version, players, cpu }` (`engine` the major.minor, `version`
  the full engine version; the computer's level is in `setup`); the api only copies it.
- `tools/games.mjs` pulls `games/pitch/` but does not replay it yet.
