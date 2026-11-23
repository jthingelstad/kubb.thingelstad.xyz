# The api function: its contract

`throwing-wood-api` (the Lambda function in `infra/pitches.json`, stack
`throwing-wood-pitches`, code in this folder) is
what the pitch server reports to and what the apps call for everything that is not live
play. It replaces the old rooms function's non-play messages (`report`, `game`,
`replay`, `reel`, `share`) with plain HTTPS. The design is `docs/PITCH-SERVER.md`; the
pitch server's side of a push is `backend/pitch-server/PROTOCOL.md`.

It is on: `"pitchesStack": true` in `infra/deployment.json` since 2026-11-21 (docs/PITCH-SERVER.md
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
dropped (the path says what it is) and `room` spelled `pitch`. Each call below is its
whole contract: nothing here needs the retired `docs/ROOMS.md`.

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

A finished pitch's highlight reel: two videos of its best throws, tall (1080x1920) and
wide (1920x1080), made by the reel function (the site stack's, `backend/reels/`)
from the kept replay, on the engine the match was played on. Anyone with the code may
ask, joined or not: a reel shows nothing the replay does not. The design and what a
player sees are `docs/REEL.md`; this section is the whole contract for a client.

**Asking is starting.** The first request for a kept replay starts its render, so a
client asks only when a player asks for the reel, never on load. It then asks again
every few seconds while the answer is `rendering` (the web: every 5 s while its card is
open); asking how a render stands starts nothing more and counts against nothing.

The request:

| Field   | Required | What it is                                                                                                    |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `pitch` | yes      | the pitch's code                                                                                              |
| `v`     | no       | the kept replay's version the asker means, as `replay` answers it: a positive integer or left out, never null |

Send `v` with every request. A pitch that has kept a newer match since (a rematch) is
then answered `moved`, and a card left open over an old match never starts the newer
one's render. Without `v` the answer is for whatever the pitch keeps. So a client reads
`replay` first (which starts nothing), checks that the kept replay is the match on its
screen (the same `n`, and the same `hash` when both have one), and asks with that `v`.

The answer, always 200 for a well formed request:

```json
{ "pitch": "<code>", "v": 1764000000000, "reel": { "state": "rendering", "tag": "r1-1.0", "at": 1764000050000 } }
{ "pitch": "<code>", "v": 0, "reel": null, "why": "replay" }
```

`v` is the kept replay's version (the time its match ended; 0 when none is kept).
`reel` is `null` with a `why`, and nothing was started:

| `why`         | Meaning                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unavailable` | this function has no renderer (`v` is 0)                                                                                                            |
| `replay`      | the pitch has no kept replay (`v` is 0)                                                                                                             |
| `moved`       | the request's `v` is not the version the pitch keeps now; the answer's `v` is the one it keeps                                                      |
| `engine`      | the match names no engine, or one the renderer does not carry (`REEL_ENGINES`). Its throws could go differently on another, so it is never rendered |
| `busy`        | the day's 200 renders have started (UTC days), or another request took the reel item for another render in the same moment. Ask again later         |

or `{ state, tag, at }`: `tag` names the render's look and engine (`r1-1.0`), `at` is
when the render was started.

| `state`     | Meaning                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rendering` | started, by this request or an earlier one; ask again                                                                                                                                                                                                                                                      |
| `done`      | adds `tall`, `wide` and `edit`, site paths (`/reels/<code>/<v>-<tag>/tall.mp4`, `wide.mp4`, `edit.json`, on `https://throwingwood.com`), and `seconds`, the reel's length to a tenth (or null)                                                                                                             |
| `failed`    | final for that version and look. `why` says which: `empty` (the match has nothing to show: no throw at all, as when a player resigned before the first, or no moment picked), `names` (the kept replay holds a name the game did not make), `render`, `replay` or `engine`; none when both tries timed out |

The clients tell `empty` apart ("There are no highlights to show in this match.") and
treat every other `failed` alike. A state a client does not know it reads as
`rendering`.

Refusals (`{ error, message }`, "Refusals" below): `bad-pitch` for a `pitch` that is
not a code, `bad-message` for a `v` that is not a positive integer, and `failed` (500)
when the records could not be read or written or the render could not be started.
After `failed` nothing is left started, so asking again really starts again; the web
offers TRY AGAIN once.

What the function holds to:

- **One render a kept replay.** The request that first writes the pitch's `reel` item
  (a conditional put) is the only one that invokes the reel function, asynchronously,
  and the only one counted against the day. Every other request reads the item. A
  rematch that is kept is a new version and a new render.
- **The match's own engine.** The function reads only the replay's `engine` field. A
  done reel is answered even after its engine has left `REEL_ENGINES`; nothing new is
  started for one.
- **Two tries at most.** A render that fails is tried once more by Lambda's own retry.
  A render still `rendering` 25 minutes after it started died without a word: the next
  request starts it again, keeping its count of tries, unless it was tried twice
  already, which is answered `failed`. So one job (a version and a look) renders twice
  at most in all, retries and takeovers included. A takeover that the day's cap
  refuses, or whose invoke fails, puts the item back as it was.
- **The files** are served from the site bucket like any static file, `video/mp4`
  (`application/json` for the edit list) with
  `Cache-Control: public, max-age=31536000, immutable`, and expire after 366 days; the
  reel item expires with its replay. Once the reel is done, `/p/<code>` carries
  `og:video` (the wide file) and its description ends "Watch the highlights."

Locally (`npm run dev`) the api stand-in has no renderer and answers `unavailable`.

### share

A match against the computer is played on one device and has no pitch. Sharing it sends
the finished match once, when the player asks; the reel function plays it again through
the engine, and a match that passes is kept as a **sealed** pitch under a fresh code,
for a year. From then on the code is a pitch like any other to look at (`/p/<code>`,
`replay`, `reel`, the embed, the share tags), and one nobody plays on. The design, the
card and its words are `docs/REEL.md` "Sharing a match against the computer" and "The
share card"; this section is the whole contract for a client.

The request, `{ "g": { ... } }`:

```json
{
  "g": {
    "client": "ios",
    "engine": "1.0.0",
    "start": "<the match's first snapshot, renamed>",
    "log": [{ "a": { "type": "throw", "...": "..." } }],
    "end": { "winner": "A", "throws": 60 }
  }
}
```

| Field          | Required | What it is                                                                                                                                           |
| -------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `g.client`     | no       | the program (`web`, `ios`): 1 to 32 of `a-z`, `0-9`, `.`, `-`. Checked, then dropped: it is never stored or passed on                                |
| `g.engine`     | yes      | the full version of the engine that played the match (`engine.version`): 1 to 64 of `a-z`, `0-9`, `.`, `-`, `+`                                      |
| `g.start`      | yes      | the snapshot text the engine gave right after `newMatch`, renamed (below); a string, at most 16 KB                                                   |
| `g.log`        | yes      | every action applied, in order, each `{ "a": <the action object> }` as the engine produced it (throws, raises, punishment kubbs, the computer's too) |
| `g.end.winner` | yes      | `"A"` or `"B"`, the side the engine says won                                                                                                         |
| `g.end.throws` | yes      | the number of throw actions in `log`, both sides; a non-negative integer                                                                             |

The match must be:

- a person against the computer: the computer plays side B alone, as the web's and the
  iPhone's solo setups make it;
- side B's team and every one of its players named `Computer`;
- side A's team and every one of its players named with the name picked on the share
  card: a generated player name or one of the engine's defaults (`names.valid`'s `ok`
  or `default` on the match's own engine). Make it with the engine:
  the session call `renameStart` with `{ start, names: { A: "<name>" }, log }` returns
  `{ start, log }`;
  send both as it returns them (the log carries ids made from the name);
- finished: the last action ends the match.

Send the body as ASCII JSON (every character above `~` as a backslash-u escape), so
its length is its size. The whole body may be at most 256 KB, the log 1000 actions and
`start` 16 KB; past any of them the answer is `too-long`. Send no hashes: the check
works them out. The function waits up to 20 s for the check and itself runs 30 s at
most, so wait for the answer longer than that (the web and the iPhone: 45 s).

The answer, always 200 once the request is well formed, even when nothing was kept:

```json
{ "code": "k7mq2xh9pd", "v": 1 }
{ "code": null, "v": 0, "why": "busy" }
```

`code` is the pitch, `https://throwingwood.com/p/<code>`, live at once. `v` here says
only that the match was kept (1) or not (0); it is not the kept replay's version. To
make the reel, read `replay` for the code and ask `reel` with the `v` it answers.

| `why`             | Meaning                                                                                                                           | What the device does                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `unavailable`     | this function does not share matches (no renderer)                                                                                | keep the match; offer again later                    |
| `engine`          | the renderer does not carry this engine's major.minor                                                                             | keep the match; it may be shareable after an update  |
| `busy`            | the day's 200 checks are used (UTC days), or the renderer could not take the check within 20 s                                    | keep the match; offer again later                    |
| `name`            | a name or line in the shared start that the engine's `names.check` refuses, or side A's name is not one the share card could give | "Pick a name for your side."; share again            |
| `too-long`        | the match is longer than a shared match may be                                                                                    | final for this match: it cannot be shared            |
| `does-not-replay` | the match does not play again to the same end through the engine, or is not a person against the computer                         | final for this match: something on the device is off |

The same match shared again (the same `start` and `log`, so the same name) is answered
the code it got the first time, at once, without a check and without counting against
the day. A device that lost an answer just sends the same request again. The same
match under another name is another share.

Refusals (`{ error, message }`, "Refusals" below), nothing kept:

| `error`       | When                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bad-message` | the body is not a JSON object; `g` is not an object; `client` or `engine` is not a valid tag; `start` is not a non-empty string; `log` is not a list of `{ a: <object> }`; `end` is not `{ winner: "A" or "B", throws: integer at least 0 }` |
| `too-big`     | the body is over 300 KB                                                                                                                                                                                                                      |
| `failed`      | the records could not be read or written, or the renderer failed to answer (not a timeout); try again later. A share that could not be kept leaves nothing; its check still counts for the day                                               |

What is checked, in order. The function, which knows no Kubb, refuses on cheap signals
first:

1. the shape (`bad-message`), then the size (`too-long`);
2. no renderer: `unavailable`;
3. `engine`'s major.minor not among the renderer's (`REEL_ENGINES`, every engine the
   site carries; `docs/ENGINES.md`): `engine`;
4. shared before: the stored code, if its sealed state and its whole replay are there;
   an incomplete share is never answered, and is replaced;
5. the day's 200 checks (a conditional counter): `busy`;
6. then it invokes the reel function synchronously with `{ check: g }` (no `client`)
   and waits up to 20 s, asking again every 2 s while it is throttled. A renderer that
   does not answer in time is `busy`.

The renderer (`backend/reels/check.mjs`) plays it through the engine of that
major.minor and answers; it writes nothing:

1. the engine is one it carries: else `engine`;
2. the engine's `names.check` passes every name and line of the start and the log:
   else `name`;
3. `start` is exactly what `newMatch` makes of its own options (`checkStart`): else
   `does-not-replay`; the sides and names are as above: else `name` for side A's name,
   `does-not-replay` for the rest;
4. the log, replayed from `start` with every check on (`replayLoad` with `checkCpu`,
   `checkThrows`, `document` and `names: "check"`): no action refused, each of the
   computer's throws the one the engine makes again from the snapshot before it, each
   of the person's throws one the dial could make, the match over at its last action
   with the winner and throw count claimed: else `does-not-replay`;
5. the finished document keeps its log: the engine drops a document's log past its
   log budget, and such a match has no replay, so it is `too-long`. The document and
   the replay must each fit 256 KB, or it is `too-long`.

What the check cannot prove is in the engine's docs/SESSION.md ("What a server can
prove"): that a person made the throws, among others. A client may know `too-long`
before it sends (the same three sizes, and the log as the document would hold it
against the engine's log budget) and then sends nothing.

**The sealed pitch.** What is kept, written in one transaction so all of it is kept or
none is, and expiring together a year on:

- `pitch#<code> | state`: the finished match, `over` and `sealed`, with its last
  snapshot, names, `cpu` and `level`;
- `pitch#<code> | replay`: the replay the check made (the engine's `replayOf`),
  `sealed`, its version the time it was shared;
- `share#<sha256> | share`: the code, keyed by the SHA-256 of the ASCII JSON of
  `[start, log]`, written only if there is none or it names an incomplete share.

The code is 10 characters of the pitch alphabet, made by the function. `replay`
answers it with `sealed: true`: a client that opens `/p/<code>` shows the finished
match from that replay and never joins, starts a rematch or plays on. A push for the
code is taken and ignored. The pitch pages read it as any finished pitch, with the
computer's title and description: "Mighty Maple vs Computer · Kubb: Throwing Wood",
"Final: Mighty Maple won, against the computer (club), in 9 turns. Watch the replay."

What is never kept: `client`, a user agent, or any id of the device or of a member. The
kept match does carry its setup, and with it the day and time the match began.

Locally (`npm run dev`) the api stand-in checks shares in its own process
(`devShareChecker` in `tools/reels-dev.mjs`), so a shared match's pitch and replay
work on a laptop.

## Refusals

`{ "error": <code>, "message": <text> }` with the status: `bad-message` and `bad-pitch`
400, `bad-signature` 401, `forbidden` 403 (an origin not allowed), `not-found` 404,
`method` 405, `too-big` 413, `failed` 500, `unavailable` 503. The message is for a
person; clients branch on `error`.

A 429 carries no JSON of this function's: it comes from in front of it, when the
function's 10 concurrent runs are all in use. The clients read it as `too-many` and say
to try again later.

## CORS

A request with an `Origin` header is answered only when that origin is in the function's
`ALLOWED_ORIGINS` (the pitches stack's `AllowedOrigins`, the same list the old
WebSocket API checked: the site, `app.throwingwood.com`, and `http://localhost` and
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

### Dev pushes

The dev Worker (`throwingwood-pitches-dev`, `PUSH_DEV` in
`backend/pitch-server/cloudflare.config.ts`) marks every push `"dev": true` inside the
signed envelope; the production Worker sends no such field, byte for byte as before. A
marked push is test play: its `start` and `act` are kept under
`games/dev/pitch/<code>/<made>/<n>-<seq>.json.gz` (expired after 14 days by the games
bucket's lifecycle rule), and nothing else is written: no `open`, no state, no final,
no kept replay. So a dev pitch is never a live pitch's page, preview, replay or reel,
whatever its code, and the pull tools leave it out unless asked (`tools/games.mjs pull
--dev`). Any other value of `dev` is refused (400). (2026-11-22: before this the dev
Worker's pushes went in with live play's; a QA pass's four pitches are there for good,
listed in `tools/games.mjs` `TEST_PITCHES`.)

## Records

The pitches stack's table (`pk`, `sk`, TTL on `exp` in seconds; nothing else is in it):

| pk                            | sk                | What                                                                                                                                                                               |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pitch#<code>`                | `state`           | the latest match: `rev`, `made`, `n`, `seq`, `over`, `z` (the last snapshot, gzipped), `hash`, `names`, `cpu`, `level`, `sealed`? ; 48 hours after the last push, a year once over |
| `pitch#<code>`                | `open`            | the pitch was made: `made`, `host` (a generated player name, or null); 48 hours, the latest `made`                                                                                 |
| `pitch#<code>`                | `half#<made>#<n>` | one match's replay being put together: `made`, `n`, `v`, `z`, `s`, `hash`, `cpu`, `level`; gone once whole                                                                         |
| `pitch#<code>`                | `replay`          | the last whole replay, the same fields; a year from its end                                                                                                                        |
| `pitch#<code>`                | `reel`            | the highlight reel of kept replay `v`: `v`, `tag`, `job`, `state`, `at`, `tries`, then `tall`, `wide`, `edit`, `seconds` and `done`, or `why`; gone with its replay                |
| `share#<hash>`                | `share`           | a shared match's `code`, by the SHA-256 of its start and log; a year                                                                                                               |
| `reels#<day>`, `shares#<day>` | `count`           | the day's counters (UTC days); 3 days                                                                                                                                              |

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
