# Highlight reels

A video of a finished match's best throws, made by the server from the kept replay with
the engine's own physics, for players to share on TikTok, Shorts, Reels, YouTube or a
blog (Jamie, 2026-11-19: "have the server generate a video that would be rendered per
game to show highlights of the match using our physics engine to show angles and hits.
Like a highlight reel for the game.").

This is the design for the real feature. The prototype in `tools/reel/` renders reels
on a laptop from a kept replay; nothing of it ships to players or runs on AWS yet.

## The prototype (`tools/reel/`)

```
node tools/reel/matches.mjs 1 3 8      # computer-against-computer matches, by seed
node tools/reel/render.mjs --replay tests/fixtures/replay-north-south.json
node tools/reel/render.mjs --replay build/reel/matches/seed-1.json --formats tall
node tools/reel/bench.mjs              # napi-rs/canvas against Chromium, same frames
```

Output goes to `build/reel/out/`, which is never in git: `<name>-tall.mp4` (1080x1920),
`<name>-wide.mp4` (1920x1080), `<name>.edit.json` (the edit list) and a contact sheet
PNG per format. Both formats are H.264 High, yuv420p, 30 fps, AAC sound and faststart.

- `scan.mjs` plays the replay through the engine (`replayLoad`, `replayStep`, wide view)
  and writes one fact per throw: who threw, what was hit and toppled, the ruling, the
  first hit, the touches and bursts, and the pieces standing before and after.
- `highlights.mjs` is pure and tested (`tests/reel/highlights.test.mjs`), with its
  numbers in one `tune`. It rates each throw:

  | Kind                         | Score                                |
  | ---------------------------- | ------------------------------------ |
  | the winning king shot        | 100 (always in, always last)         |
  | a king hit too early         | 90                                   |
  | a baton that takes 2+ kubbs  | 30, plus 14 for each kubb over 2     |
  | a base kubb from 7 m or more | 24, plus 4 a metre over 7            |
  | an inkasted kubb that knocks | 16, plus 12 if one fell              |
  | the field cleared            | 14, plus 10 with one baton left      |
  | a near miss (touched, stood) | 6, plus 14 right before a big moment |

  Every kubb down adds 3 and every turn adds 0.25, so late hits rank higher. Picking is
  greedy. The end goes in first. Then the best throw left goes in each round, scored
  down by 0.55 for each moment of the same kind already in. A pick must be at least 4
  throws from the others and fit 25 to 40 s. That gives 4 to 6 moments, in match order,
  with the end last.

  A dull match falls back to the opening throw and its best hits. A resigned match ends
  on its last hit. A reel short of 25 s holds each moment's last beat longer.

- `cameras.mjs` are the reel's own angles, built with the game's `lookAt` and drawn
  by `drawWorld`. They are:
  - **arc**: from the side in wide; three-quarter from behind the thrower in tall.
  - **impact**: close and low on the first hit, pushing in.
  - **king**: low, looking up at the king.
  - **land**: for a miss.
  - **overview**: for the cards.
- `render.mjs` shoots each moment with `showAt(t)` at a fixed 30 fps. Slow motion
  (0.28x, from 0.22 s before the first hit to 0.75 s after) is simply more frames per
  second of flight. A moment scored 40 or more plays whole at 1x, then again close and
  slow under REPLAY. The game's bursts (TOK!, KING!) are drawn at their moment.
  `overlay.mjs` draws in the site's woodcut look:
  - a title card: KUBB: THROWING WOOD, HIGHLIGHTS and the team plates;
  - a caption per moment in plain words, with a TURN kicker;
  - STANDING, the kubbs left in each half;
  - an end card: the winner, how, and `throwingwood.com/p/<code>`.

  In the tall frame all text stays inside 14% to 80% of the height and left of 84% of
  the width, clear of the platforms' buttons.

- `audio.mjs` mixes the sound offline in plain JavaScript: the game's nine recorded
  knock takes at each touch (seeded, with the same rate spread as the game) and its
  C-G-C triangle chord for the king. It is a 16-bit WAV, muxed to AAC.

### Measured (an Apple-silicon Mac, other work running)

| Step                                         | Time                                    | Load average |
| -------------------------------------------- | --------------------------------------- | ------------ |
| a 36 s reel, tall and wide together, all in  | 24.9 to 30.6 s (four matches)           | 5.2 to 6.3   |
| a 37 s reel, tall only                       | 16.8 s                                  | 6.1          |
| scan (play the match through the engine)     | 0.7 to 3.6 s                            |              |
| napi-rs/canvas: draw 900 frames + pixels out | 7.3 s tall, 6.7 s wide                  | 11.7         |
| Chromium: draw 900 frames + getImageData     | 6.6 s tall, 6.2 s wide                  | 8.5          |
| Chromium: + each frame's pixels to Node      | 108 s tall, 107 s wide (from 90 frames) | 8.5          |
| Chromium: a screenshot per frame             | 38 s tall, 39 s wide (from 90 frames)   | 8.5          |

Both draw a frame equally fast. The difference is getting pixels to the encoder: a
Chromium page pays 40 to 120 ms a frame to hand its picture out, and Node pays about
1.5 ms. Rendered reels are 4.7 to 6.0 MB each, so about 11 MB for both formats.

**Choice: Node with `@napi-rs/canvas`** (an exact devDependency here, no install
scripts, prebuilt Skia for linux-arm64). Frames go as raw RGBA over a pipe to `ffmpeg`
(libx264). The fallback is Chromium encoding inside the page with WebCodecs
(`VideoEncoder` to H.264, muxed in Node), which skips the readback. It was not tried;
it would also need a Chromium build with H.264 encoding.

## What a player sees

- **Where.** MAKE A HIGHLIGHT REEL sits beside WATCH REPLAY and EMBED on the winner
  card and on the replay bar. It shows only when the match has a kept replay, and the
  embed does not show it.
- **Asking.** The button becomes MAKING YOUR REEL with a slow bar and "About a minute.
  You can keep watching." The card can be closed; the button shows the state when
  opened again.
- **Done.** A card with the video playing, muted, looping. It is tall on a phone held
  upright and wide otherwise.
  - DOWNLOAD TALL and DOWNLOAD WIDE save `throwing-wood-<code>-tall.mp4` and
    `-wide.mp4`.
  - SHARE, where the browser can share files, hands the tall file to the phone's share
    sheet. COPY LINK copies `throwingwood.com/p/<code>`.
  - Anyone who opens the pitch later sees WATCH THE REEL in place of MAKE.
- **No kept replay** (a match from before replays, or one whose keep failed): no
  button. The replay bar already says nothing can be replayed there, and that covers the
  reel too.
- **It failed.** "The reel could not be made. TRY AGAIN" (one retry, then "Not this
  time"). Nothing is shown to people who did not ask.

## The server

### Render once, cache for good

A reel is keyed by **pitch code, replay version and reel version**:
`reels/<code>/<v>-<reel>/tall.mp4`, `wide.mp4` and `edit.json`.

- `v` is the kept replay's document version. A rematch is a new key.
- `reel` is a short tag of the renderer (its cameras, overlays and engine major.minor),
  so a new look renders again only when asked, never in bulk.

The site stack's bucket holds them under the `reels/` prefix. They are served through
the existing CloudFront default behaviour from the existing S3 origin, so there is no
new distribution, origin or response headers policy (all 20 in the account are in use).
The site's own security headers apply.

- The objects are written with `Content-Type: video/mp4` and
  `Cache-Control: public, max-age=31536000, immutable`, because the key changes when the
  reel would.
- The viewer request function lets `/reels/` through as the static path it is.
  CloudFront answers range requests from S3, so players seek.

### Who may ask, and limits

Anyone with the link, as for a replay or an embed: a reel shows nothing the replay does
not.

1. A request is one message on the rooms socket: `{ "t": "reel", "room": "<code>" }`. It
   needs no join and sits under the stage throttle the other messages have.
2. The rooms function `GetItem`s `room#<code> | replay`. No replay is answered
   `{ reel: null }`.
3. It does a conditional `PutItem` of `room#<code> | reel`
   (`{ v, tag, state: "rendering", at, exp }`), only if there is none for that `v` and
   tag.
4. Only the request that wins invokes the renderer, with `InvocationType: Event`. Every
   later request reads the item and answers its state (`rendering`, `done` with the
   paths, or `failed`). The browser asks again every 5 s while it renders.

Limits:

- the renderer's reserved concurrency is 2, and async invokes that are throttled wait
  in Lambda's own queue for up to 6 hours;
- 3 reel requests a connection;
- a day's cap of 200 renders: a conditional counter item, `reels#<yyyy-mm-dd>`, after
  which the answer is "Reels are busy today";
- a render that fails is retried once, then marked `failed`.

At the cost below, the cap bounds a bad day at under a dollar.

### The renderer

`kubb-xyz-site-reels`, in the site stack beside the pages function. Its role may:

- `dynamodb:GetItem` the replay and `UpdateItem` the reel item, nothing else in the
  table;
- `s3:PutObject` under `reels/` in the site bucket;
- write its own logs.

It never reads the private games bucket. It renders both formats in one run, uploads
them, then marks the item `done`. A failure leaves `failed` and a log line.

### Retention

The same as the replay: **a year from the end of the match**. An S3 lifecycle rule
expires `reels/` after 366 days. The reel item's `exp` matches the replay's `keep.until`,
so once the room is gone the pitch no longer links a reel. A cheaper rule (expire after
90 days, render again on request) is an open question below.

### Links and share tags

- The pages function already reads the replay item. It also reads `room#<code> | reel`,
  and when that is `done`, `/p/<code>` gains:
  - `og:video` and `og:video:secure_url` (the wide MP4);
  - `og:video:type` `video/mp4`, `og:video:width` 1920 and `og:video:height` 1080;
  - `og:image` stays the pitch card.

  Facebook, LinkedIn, Slack, Discord and iMessage then play or preview the video. X
  shows the image card: its player card needs an iframe page and is left out. The
  description ends "Watch the highlights."

- The pitch page shows WATCH THE REEL. The embed gains nothing: it stays the replay.
  A blog can link the MP4 or embed it with a `<video>` tag.

## Lambda: canvas and ffmpeg, or Chromium

|                        | Zip: Node 24, `@napi-rs/canvas`, ffmpeg layer                       | Container image: Chromium, Playwright, ffmpeg                |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Package                | about 30 MB canvas, 2 MB engine and fonts, about 70 MB ffmpeg layer | about 600 MB to 1 GB image                                   |
| Memory                 | 3008 MB, for about 2 vCPUs for libx264; it uses well under 1 GB     | 4096 MB (Chromium wants 2 GB or more), plus the encoder      |
| Duration, both formats | 25 to 30 s here; guess 60 to 120 s on Lambda arm64                  | 100 to 230 s here by the bench; guess 300 to 700 s on Lambda |
| Against 15 minutes     | 8x margin or more                                                   | 1.3x to 3x margin                                            |
| Cold start             | about 1 s                                                           | 3 to 8 s, more on a first pull of the image                  |
| Cost per reel          | 3 GB x 90 s = 270 GB-s, about **$0.0036**                           | 4 GB x 500 s = 2000 GB-s, about **$0.027**                   |
| Per 1,000 reels        | about **$3.60** compute, plus 11 GB stored (about $0.25 a month)    | about **$27** compute, plus the same storage                 |

Compute is priced at the us-east-1 Lambda arm64 list price of about $0.0000133 a
GB-second. Requests and DynamoDB are fractions of a cent. Serving 11 MB a reel is about
$0.09 a reel past CloudFront's free monthly terabyte.

The Lambda durations are guesses from the measurements here. The prices are from
memory, not checked against the pricing API for this prototype.

**Recommendation: the zip function with `@napi-rs/canvas` and an ffmpeg layer**, arm64,
3008 MB, 5 minute timeout.

- It is the smallest understandable solution: the same Node, esbuild bundle and Lambda
  shape as the pages function.
- The layer is a static linux-arm64 ffmpeg build with libx264, pinned by its sha256 and
  uploaded to the code bucket the way the pages bundle is.
- It needs no ECR repository and no image builds. It costs about a seventh, starts in a
  second, and stays far inside the 15 minute limit.

Chromium would let the reel reuse the browser's whole client, but the reel needs only
`drawWorld`, which is already pure canvas. Chromium stays the fallback if the server
ever has to draw something only the browser can.

## Privacy

A reel shows the **team names only**, never players' names, member ids or anything
typed in the lobby. It is made from the kept replay, never from the private games
bucket or the records.

- **Home page**, under what is recorded: "Anyone with a finished pitch's link can make a
  highlight reel: a short video of the match's best throws, with the team names, kept
  for a year like the replay."
- **Privacy page**: "Highlight reels are videos made on our server from a match's kept
  replay when someone asks. They show the team names you chose, never your name. They
  are stored with the site and anyone with the link can watch or download them. They
  are deleted a year after the match. A video downloaded or posted elsewhere is out of
  our hands."

## Engine and replay-format needs

These are requests for kubb-engine. The prototype works around each.

1. **World-frame facts in the wide view.** `setWide` un-turns Team B's pieces and burst
   anchors, but not `result.landX`/`landY` or `timeline.firstHit`. The reel turns them
   itself, `(x, y) -> (-x, 8 - y)` in `scan.mjs`.
2. **Structured rulings.** The reel reads plain English ("base kubb down", "2 field
   kubbs down", "king down: South wins") to find base hits, field hits and an early
   king. A `ruling.code` (`base`, `field`, `kingWin`, `kingEarly`, `miss`, `in`, `out`)
   and a count would make it safe from wording changes.
3. **Per-throw standing counts.** The reel counts kubbs by where they lie (a base row
   within 25 cm of a baseline). `replayStep` could return `standing` before and after,
   as the score sheet already knows.
4. **Random access to a throw.** `showAt` reaches only the current recording, so the
   renderer steps the match from the start (0.7 to 3.6 s). That is fine for one render;
   `replaySeek(i)` would let it render a moment alone.
5. **Version in the key.** The kept replay has `v`, and the renderer adds the engine's
   major.minor to the reel tag. The replay itself needs no new fields.

## Open questions for the owner

1. **Make on request, or for every finished match?** On request, by anyone with the
   link. Rendering every kept match costs little but stores videos nobody watches.
   **Recommend: on request.**
2. **Keep a year, or 90 days and render again?** A year, the same as the replay: one
   rule, links that keep working, and about $0.25 a month per 1,000 reels.
   **Recommend: a year.**
3. **Sound on?** The knocks and the king's chord are in the reels now. Platforms mute
   by default, and players may add music there. **Recommend: keep the game's sound.**
4. **Watch-the-computer matches.** These are recorded but have no pitch code, so they
   have no reel. **Recommend: no reels for them.** A reel's link should lead to a pitch.
5. **X's player card.** It needs an iframe player page; `/e/<code>` could serve it.
   **Recommend: leave it out for now.** Facebook, LinkedIn, Slack and Discord preview
   the video from `og:video`.
6. **Daily cap of 200.** **Recommend: start there**, alarm on the counter, and raise it
   when it is reached.
