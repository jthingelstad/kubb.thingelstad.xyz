# The api function: its contract

`throwing-wood-api` (the Lambda function in `infra/pitches.json`, stack
`throwing-wood-pitches`, code in this folder) is
what the pitch server reports to and what the apps call for everything that is not live
play. It replaces the old rooms function's non-play messages (`report`, `game`,
`replay`, `reel`, `share`) with plain HTTPS. The design is `docs/PITCH-SERVER.md`; the
pitch server's side of a push is `backend/pitch-server/PROTOCOL.md`.

It is off until `"pitchesStack": true` in `infra/deployment.json` (docs/PITCH-SERVER.md
"Step 3: turning it on").

## Addresses

| Who                       | Address                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| The web and iPhone apps   | `https://throwingwood.com/api/<call>` (CloudFront, the site's web ACL) |
| The pitch server's pushes | `<ApiUrl>push`, the function URL (a pitches stack output)              |

The function strips a leading `/api`, so `/api/report` and `/report` are the same call.
A trailing slash is ignored. Every answer is JSON with `cache-control: no-store`.

## Calls

| Call     | Method | Body or query                                             |
| -------- | ------ | --------------------------------------------------------- |
| `push`   | POST   | a signed envelope (below); only the pitch server          |
| `report` | POST   | `{ "r": <report> }`                                       |
| `game`   | POST   | `{ "g": <match played on one device> }`                   |
| `replay` | GET    | `?pitch=<code>`                                           |
| `reel`   | POST   | `{ "pitch": <code>, "v"?: <kept replay version> }`        |
| `share`  | POST   | `{ "g": { "client"?, "engine", "start", "log", "end" } }` |

A request body from an app is at most 300 KB (`413 too-big` over it); each call has its
own, smaller limit below. The shapes are the old rooms messages' with the `t` field
dropped: the path says what it is.

### report

`r` as the clients build it (`src/net/report.js`): `kind` (`"throw"`, the default, or
`"feedback"`), `mode` (`practice`, `solo`, `watch`, `pitch`), `happened` and `should`
(throw: text, 1000 characters each, at least one not blank) or `text` (feedback: 2000
characters after trimming), optional `pitch` (a code), `client`, `engine`, and the game
as it stood. At most 64 KB. Answer `{ "ok": true }`. Kept gzipped under
`reports/<yyyy-mm-dd>/` in the private games bucket, for good.

### game

`g`: `mode` (`solo` or `watch`), `start` (the first snapshot), `actions` (at most 4000),
optional `hashes` (one an action), `file`, `client`, `engine`. At most 256 KB. Answer
`{ "ok": true }`. Kept under `games/browser/<yyyy-mm-dd>/`.

### replay

Answer, always 200 for a well formed code:

```json
{ "pitch": "<code>", "v": 1764000000000, "at": 1764000000000, "sealed": false, "replay": { ... } }
```

`replay` is the engine's replay of the pitch's last finished match with its final
snapshot as `snap`, or `null` (and `v` 0) when there is none yet. `v` and `at` are when
the match ended. `sealed` is true for a shared match against the computer: such a pitch
never plays again. A replay is served only once both its halves are in (the pitch
server's `keep` and the snapshot from the action that ended the match); while a
rematch's halves arrive, the last whole replay is still the one served.

### reel

As docs/ROOMS.md section 12, on the new records. Answer
`{ "pitch", "v", "reel": <reel> | null, "why"? }`: `reel` is
`{ state: "rendering" | "done" | "failed", tag, at, ... }` (`done` adds `tall`, `wide`,
`edit`, `seconds`). `why`: `replay` (nothing kept), `moved` (`v` is not the kept one),
`engine` (the renderer does not carry the match's engine), `busy` (the day's 200
renders are used, or another request started it), `unavailable` (no renderer). At most
one render a kept replay; a render left `rendering` 25 minutes may be started again, two
tries in all.

### share

As docs/ROOMS.md section 13. Answer `{ "code": <code> | null, "v": 1 | 0, "why"? }`.
`why`: `too-long` (over 256 KB, 1000 actions or a 16 KB first snapshot), `engine`,
`name` (a name or line in the shared start that the engine's `names.check` refuses, or
side A's name not a generated player name or one of the engine's defaults: the client
says "Pick a name for your side."; since 2026-11-21), `does-not-replay`, `busy` (the day's 200 shares are used, or the renderer could not take
the check in 20 s), `unavailable`. The same match shared again gets the same code. The
code's pitch is sealed: its state is final, it has a whole replay, and a push for it is
taken and ignored.

## Refusals

`{ "error": <code>, "message": <text> }` with the status: `bad-message` and `bad-pitch`
400, `bad-signature` 401, `forbidden` 403 (an origin not allowed), `not-found` 404,
`method` 405, `too-big` 413, `failed` 500, `unavailable` 503. The message is for a
person; clients branch on `error`.

## CORS

A request with an `Origin` header is answered only when that origin is in the function's
`ALLOWED_ORIGINS` (the pitches stack's `AllowedOrigins`, the same list the old
WebSocket API checks: the site, `app.throwingwood.com`, and `http://localhost` and
`http://127.0.0.1` on any port), with `access-control-allow-origin: <origin>` and
`vary: origin`. Another origin gets `403 forbidden`. A request with no `Origin` (the
iPhone app, curl) is answered as it is. `OPTIONS` answers the preflight (204, the call's
method, `content-type`, a day's max age). `push` takes no CORS at all.

The site's pages call `/api/*` on their own origin, so the CSP's `connect-src 'self'`
already covers it.

## Pushes

The pitch server's contract (PROTOCOL.md "Pushes to AWS"): `POST` with

- `x-pitch-signature: sha256=<hex>`, the HMAC-SHA256 of the raw body under the shared
  secret;
- `idempotency-key: <pitch>:<made>:<k>`;
- the body `{ "v": 1, "pitch", "made", "k", "topic", "sent", "body" }`, `topic` one of
  `start` (`k` `start:<n>`), `act` (`act:<n>:<seq>`), `keep` (`keep:<n>`) and `open`
  (`k` `open`).

The function checks the signature over the raw bytes, in constant time, before it
parses anything. A wrong or missing signature is `401 bad-signature` and nothing is
kept. When the check fails it reads the secret once more (at most every 5 minutes), so a
rotated secret is picked up without a deploy. No secret configured: `503 unavailable`.

Then, with the envelope checked against its key and the header (`400 bad-message` when
it does not agree; the pitch keeps retrying such a push until a fixed receiver takes
it):

- `start` and `act`: the signed body byte for byte, gzipped, to
  `games/pitch/<code>/<made, 13 digits>/<n, 4 digits>-<seq, 6 digits>.json.gz` (a start
  is seq 0), only if nothing is there (`If-None-Match: *`), and folded into the pitch's
  state item. An `act` with `over: true` keeps its snapshot as one half of the replay.
- `open` (the pitch was made: `{ pitch, host }`, `host` the maker's name or null): the
  `open` item, `{ made, host }`, 48 hours, unless one for a later `made` is there. Not a
  match: nothing goes to the games bucket. It is what the pitch link's preview shows
  before any match ("CHEERFUL CEDAR IS WAITING FOR PLAYERS"). This function must take
  `open` before a pitch server that sends it is deployed (an untaken push is retried
  for as long as the pitch lives).
- `keep`: the replay (`meta`, `n`, `h0`, `log`) as the other half, gzipped, a year on.
  A replay over 256 KB is answered `200 { ok: true, kept: false, why: "too-long" }`, so
  the pitch stops sending it.

Every push that was taken answers `200 { "ok": true }`; one already had adds
`"duplicate": true`. Pushes may come in any order and any number of times:

- the state is folded by `(made, n, seq)`: a later `made` (the code wiped and opened
  again) or `n` (a rematch) starts it afresh, an older push changes nothing, a late
  `start` fills the names, `cpu` and `level`;
- the replay's halves meet in a half item of their own match (`half#<made>#<n>`, so
  the pushes of matches in a row may cross); the one that comes second makes the
  `replay` item whole, never over a later match's, the same match kept later, or a
  sealed pitch, and the half item goes. A half for a match the replay already holds,
  or one older, is not kept.

## Records

The pitches stack's table (`pk`, `sk`, TTL on `exp` in seconds; nothing else is in it):

| pk                            | sk                | What                                                                                                                                                                               |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pitch#<code>`                | `state`           | the latest match: `rev`, `made`, `n`, `seq`, `over`, `z` (the last snapshot, gzipped), `hash`, `names`, `cpu`, `level`, `sealed`? ; 48 hours after the last push, a year once over |
| `pitch#<code>`                | `open`            | the pitch was made: `made`, `host` (a generated player name, or null); 48 hours, the latest `made`                                                                                 |
| `pitch#<code>`                | `half#<made>#<n>` | one match's replay being put together: `made`, `n`, `v`, `z`, `s`, `hash`, `cpu`, `level`; gone once whole                                                                         |
| `pitch#<code>`                | `replay`          | the last whole replay, the same fields; a year from its end                                                                                                                        |
| `pitch#<code>`                | `reel`            | the highlight reel, as `room#<code> \| reel` was                                                                                                                                   |
| `share#<hash>`                | `share`           | a shared match's code                                                                                                                                                              |
| `reels#<day>`, `shares#<day>` | `count`           | the day's counters                                                                                                                                                                 |

The pitch pages (`backend/pages/`) read `state`, then (unless a match is in play) `open`
and `replay` together, a newer `open` winning over a retained finished match, then `reel`,
with `GetItem`; the
renderer (`backend/reels/`) reads `replay` and writes `reel`. The old rooms table and
its `room#` items were deleted on 2026-11-21.

The pitches stack's private games bucket (`throwing-wood-pitches-games-<account>`): the
pushes above, `games/browser/` and `reports/` as the rooms function wrote them. Nothing
in it is ever served.

## Limits that are not here

The old rooms function held 3 reports, renders and shares a connection. There is no
connection now: what is left is the day's caps (200 renders, 200 shares), the request
sizes, the function's 10 concurrent runs and, on `/api/*`, the site's shared `edge` web ACL.
The function URL itself is public (it must be, for the pushes), so a caller who learns
it can reach `report`, `game`, `reel` and `share` without CloudFront; the same checks and
caps apply there.
