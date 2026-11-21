# Highlight reels

A video of a finished match's best throws, made by the server from the kept replay with
the engine's own physics, for players to share on TikTok, Shorts, Reels, YouTube or a
blog (Jamie, 2026-11-19: "have the server generate a video that would be rendered per
game to show highlights of the match using our physics engine to show angles and hits.
Like a highlight reel for the game."). A match played against the computer gets one too,
on the iPhone in particular (Jamie, 2026-11-19: "So if you just play versus the computer,
I definitely want to make sure you can then submit that and create a highlight reel to
share with friends.").

The keys below are the old rooms function's `room#<code>` items. The pitch server
migration moves the renderer and the pitch pages to the api function's
`pitch#<code>` items (`backend/api/API.md` "Records"; the reel item keeps its fields).
That code is merged but goes live only with the site apply at the cutover
(`docs/PITCH-SERVER.md` section 12); until then the deployed renderer reads `room#`.

This is the design for the real feature. **Built (2026-11-19): the server side for
finished online pitches** ("The server" below says what was built and where it changed
from the design; deploying it is `docs/REEL-RUNBOOK.md`), and the browser's buttons, cards
and home and privacy wording for them (docs/CLIENT.md "Highlight reels"). **Built
(2026-11-19): the server side of sharing a match against the computer** (`share`, the
renderer's check, sealed rooms; the protocol is `docs/ROOMS.md` section 13), and **the
browser's share card and a sealed pitch's page** (docs/CLIENT.md "Sharing a match";
its words are "The share card" below). **Built (2026-11-20): the iPhone app's reel card
and share card**, in its own repository, on the same messages and words. The renderer's
code is `backend/reels/` (moved there from the prototype in `tools/reel/`); the
prototype's commands below still render reels on a laptop with that same code.

## The prototype (`tools/reel/`, renderer now in `backend/reels/`)

```
node tools/reel/matches.mjs 1 3 8      # computer-against-computer matches, by seed
node tools/reel/solo.mjs 2 11          # a person against the computer, by seed
node tools/reel/render.mjs --replay tests/fixtures/replay-north-south.json
node tools/reel/render.mjs --replay build/reel/matches/seed-1.json --formats tall
node tools/reel/render.mjs --replay build/reel/matches/solo-2.json
node tools/reel/bench.mjs              # napi-rs/canvas against Chromium, same frames
```

Output goes to `build/reel/out/`, which is never in git: `<name>-tall.mp4` (1080x1920),
`<name>-wide.mp4` (1920x1080), `<name>.edit.json` (the edit list) and a contact sheet
PNG per format. Both formats are H.264 High, yuv420p, 30 fps, AAC sound and faststart.

- `solo.mjs` makes a match a person played against the computer, with no network and no
  recorded games. Side A is driven as a phone drives it: a target and a stance (a second
  engine only picks where to aim), then the dial: wind back, flick, lift. So its throws
  are pointer throws with verdicts, not the computer's. Side B is the computer. The file
  is what a phone keeps of a solo match: the first snapshot and every action, with no
  hashes. Its `verifySolo` is the server's check below.
- `scan.mjs` (now `backend/reels/`, as are `highlights.mjs`, `cameras.mjs`,
  `overlay.mjs`, `audio.mjs` and the renderer itself, `render.mjs`) plays the replay through the engine (`replayLoad`, `replayStep`, wide view)
  and writes one fact per throw: who threw, what was hit and toppled, the ruling, the
  first hit, the touches and bursts, and the pieces standing before and after. A drill
  (a kubb thrown in, the engine's `how: "drill"`) also has its kubb, when it first
  touched the ground, where it came to rest, and the half as it stood at the next
  baton: the kubbs raised and any punishment kubb placed (below).
- `highlights.mjs` is pure and tested (`tests/reel/highlights.test.mjs`), with its
  numbers in one `tune`. It rates each throw:

  | Kind                         | Score                                |
  | ---------------------------- | ------------------------------------ |
  | the winning king shot        | 100 (always in, always last)         |
  | a king hit too early         | 90                                   |
  | a baton that takes 2+ kubbs  | 30, plus 14 for each kubb over 2     |
  | a base kubb from 7 m or more | 24, plus 4 a metre over 7            |
  | an inkasted kubb that knocks | 16, plus 12 if one fell              |
  | a tight group thrown in      | 24, plus 7 a kubb over 3             |
  |                              | plus 14 when a baton then takes 2+   |
  | a kubb out twice (punished)  | 24                                   |
  | the field cleared            | 14, plus 10 with one baton left      |
  | a near miss (touched, stood) | 6, plus 14 right before a big moment |

  Every kubb down adds 3 and every turn adds 0.25, so late hits rank higher. Picking is
  greedy. The end goes in first, then the best drill that clears the bar (below). Then
  the best throw left goes in each round, scored down by 0.55 for each moment of the
  same kind already in. A pick must be at least 4 throws from the others, come before
  the end, and fit 25 to 40 s. That gives 4 to 6 moments, in match order, with the end
  last.

  A dull match falls back to the opening throw and its best hits. A resigned match ends
  on its last hit. A reel short of 25 s holds each moment's last beat longer.

- **Drills** (Jamie, 2026-11-19, on the first samples: "you only showed baton throws,
  and drills of cubes are often some of the really important things as well ... they
  should definitely include important drills in addition to important baton
  throws."). The first prototype rated drills but never showed one: a kubb thrown in
  scored only its turn (0.25 a turn) unless it knocked another kubb, so it never
  reached the bar of 20. What a player cares about in a drill, and what the replay
  gives for it:
  - **A tight group: kept.** The drilling team throws batons at those kubbs next, so
    kubbs standing close together mean fewer batons. The reel takes the half as it
    stood at the next baton (raised, which is what the batons face) and finds groups:
    kubbs each within 40 cm of another, all within 90 cm, at least three, at least two
    of them thrown in that turn. The beat is the last kubb thrown in that is part of
    the group. "South lands five kubbs close together"; "South lands its kubbs in a
    group of four" when a kubb from before is in it; "North throws seven kubbs in,
    five close together" for a big turn.
  - **A group that pays off: kept, as one beat.** When the same team's next batons take
    two or more of the group with one throw, the group scores 14 more and the baton
    follows it straight away (the 4-throw gap is waived for the pair). The two
    captions read as one: the group, then "South: three kubbs with one baton".
  - **Out twice: kept.** A kubb thrown in that goes out a second time becomes a
    punishment kubb, stood by the other team where they choose. The beat is that kubb's
    second throw (the ruling arrives on the throw that ends the round, which can be
    another kubb's), held on where it was stood: "Riverside's kubb is out twice:
    Computer puts it at the back" (or "by the middle line", or "places it"). The
    engine's own placement puts it as deep as it can, on the far baseline.
  - **A big turn as one quick sequence: dropped.** Five to ten similar throws cut
    together cost 6 s or more for what the finished group shows in one hold; a big turn
    shows as its group beat, and the caption counts the kubbs.
  - **A deep or short drill that changed the turn: dropped.** The replay does not say
    which batons were spent on which kubb, so "a stray kubb cost two batons" would be a
    guess. A lone kubb far from the rest is common and dull on its own.
  - The existing **inkast that knocks** another kubb stays, and counts as a drill.

  The cap: at most one moment in three is a drill (one in a 4 or 5 moment reel, two in
  a 6), and one a turn. The best drill that clears the bar goes in second, after the
  end, so a drill is never crowded out by batons, and a match with no drill over the
  bar gets none. What it displaces is usually the weakest baton moment of the earlier
  reel. A drill beat runs about 4 to 5 s against a baton's 5 to 7 s, and the 40 s
  limit is unchanged. Of the 22 matches here (`solo-2-you` is `solo-2` renamed), 21
  reels now hold one or two drill beats.

- `cameras.mjs` are the reel's own angles, built with the game's `lookAt` and drawn
  by `drawWorld`. They are:
  - **arc**: from the side in wide; three-quarter from behind the thrower in tall.
  - **impact**: close and low on the first hit, pushing in.
  - **king**: low, looking up at the king.
  - **land**: for a miss.
  - **group**: a drill. Close on the group the kubb lands by (or where it went out),
    wide enough for the landing and every kubb of the group; then, after a cut, on
    the same kubbs standing once raised (or on the punishment kubb where it was
    stood).
  - **overview**: for the cards.
- `render.mjs` shoots each moment with `showAt(t)` at a fixed 30 fps. Slow motion
  (0.28x, from 0.22 s before the first hit to 0.75 s after) is simply more frames per
  second of flight. A moment scored 40 or more plays whole at 1x, then again close and
  slow under REPLAY. The game's bursts (TOK!, KING!) are drawn at their moment. A drill
  plays at 1x until just before the kubb touches the ground, then at half speed close
  on the group through the landing and the roll, then holds 1.4 s on the half as it
  stood at the next baton: the engine is stepped on past the raises to that state.
  `overlay.mjs` draws in the site's woodcut look:
  - a title card: KUBB: THROWING WOOD, HIGHLIGHTS and the team plates;
  - a caption per moment in plain words, with a TURN kicker;
  - STANDING, the kubbs left in each half;
  - an end card: the winner, how, and `throwingwood.com/p/<code>` with its QR code
    (below).

  In the tall frame all text stays inside 14% to 80% of the height and left of 84% of
  the width, clear of the platforms' buttons.

- `audio.mjs` mixes the sound offline in plain JavaScript: the game's nine recorded
  knock takes at each touch (seeded, with the same rate spread as the game) and its
  C-G-C triangle chord for the king. It is a 16-bit WAV, muxed to AAC.

### The end card

The last 3.6 s of every reel (`endSeconds`; it fades in over its first 0.6 s, so it
stands whole for 3 s), drawn by `endCard` in `overlay.mjs`: KUBB: THROWING WOOD, the
winner and WINS, how it was won, WATCH THE WHOLE MATCH and the address
`throwingwood.com/p/<code>`, and beside it a QR code of the same link as a viewer would
type it, `https://throwingwood.com/p/<code>` (the owner, 2026-11-20: "the final frame
shows a URL… we should add a QR code there… it may be easier for folks").

- **The encoder** is `backend/reels/qr.mjs`, written here (byte mode, versions 1 to
  10, all four levels, the standard's mask penalty): one short text needs no
  dependency. `tests/reel/qr.test.mjs` decodes what it makes with jsQR (a dev
  dependency only), for every level, mask and version, and the end card itself in both
  formats for a 10-character code and a 24-character one, the longest the rooms take.
- **Level M** (15% of the codewords can be lost). A link is version 3 (29 modules) for
  the browser's 10-character codes and version 4 (33) for 24 characters; Q would take
  one version more each, smaller modules in the same plate. Recompression and a phone
  aimed at a screen blur every module alike rather than tearing a corner off, which
  larger modules help more than more redundancy.
- **The plate**: ink modules (`INK`) on a paper plate (`PAPER`, contrast about 18 to
  1), never inverted, no logo, a quiet zone of four modules inside the plate's ink edge,
  every module a whole number of pixels: as many as fit about 410 px across in the tall
  frame (11 px a module for version 3, 10 for version 4) and 460 px in the wide frame
  (12 and 11). Tall: the card sits 50 px higher and the code stands between how it was
  won and WATCH THE WHOLE MATCH, centred. Wide: the words are centred in the room left
  of the code, which stands at the right edge of the safe area, its foot level with the
  address plate's. A name or an address too long for its room is set smaller (in the
  tall frame the address may use the frame's width less its margins).
- **Measured** on the kept replay fixture rendered both ways and its last frame cut from
  each MP4 by ffmpeg: it decodes at full size, and after a downscale to 540 and to 360
  px wide saved as JPEG at quality 50, for both code lengths.
- **A code never costs a reel.** `endCardCode` in `render.mjs` returns null when the
  symbol cannot be made, and `drawEndCard` draws the frame again without it when it
  cannot be drawn; either way the card is the one without a code, with the address.
- **Already-made reels keep the card they were made with.** The code did not raise
  `REEL_LOOK` (`tag.mjs`), so a reel's key is the same `r1-<major.minor>` and nothing
  renders again: a reel made before the code has none, one made after has it. Raising
  `REEL_LOOK` would make every older pitch's next `reel` request (MAKE A HIGHLIGHT REEL
  pressed again) render it anew under `r2-`, one at a time and counted against the caps.

### Measured (an Apple-silicon Mac, other work running)

The function's own package was also run in AWS's Lambda image for Node 24 on arm64
(Docker, 1.75 CPUs and 3008 MB, the share of a 3008 MB function), on the kept replay
fixture with DynamoDB and S3 stood in for: both formats of the 39.3 s reel in 71 s from
the invoke to `done` (scan 4.0 s, draw and encode 65.3 s), a peak of 1.8 GB of memory
(the container's, page cache included), 5.8 MB tall and 6.2 MB wide, both decoding
clean. Lambda's own CPUs may be slower or faster than this Mac's under emulation; the
durations on Lambda stay guesses until a real deploy.

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

### A match against the computer, rendered

`solo.mjs` made twelve club-level matches. In two of them the person won; in the rest
the computer did, as against a fair human hand. Each replayed from its start through the
engine to the end the device claimed, and every one of the computer's throws was made
again the same. Then `render.mjs`, unchanged, made reels of them:

| Match     | Actions | Result                     | As kept (JSON, gzipped) | Check | Reel                 |
| --------- | ------- | -------------------------- | ----------------------- | ----- | -------------------- |
| `solo-2`  | 65      | Riverside wins in 9 turns  | 29 KB, 7 KB             | 1.4 s | 37.1 s; 5.3 + 5.8 MB |
| `solo-11` | 89      | Computer wins in 10 turns  | 39 KB, 9 KB             | 1.9 s | 37.5 s; 4.8 + 5.7 MB |
| `solo-5`  | 445     | 41 turns, the script's cap | 177 KB, 38 KB           | 11 s  | (not rendered)       |

The check is the replay plus the computer's throws made again by a second engine.
`solo.mjs` stops a match at 40 turns, as `matches.mjs` does; the iPhone sets no such
cap. The machine's load average was 15 to 85 while these ran, so the times are high.

How long a match may be is the engine's own limit, not a second one: the engine drops
a document's log past its log budget (248 KB), and a match without its log has no
replay, so it cannot be shared. Measured with the built check (all three engine checks
on), first on v0.7.2 and then on v0.7.3, which is vendored. The Docker runs were limited
to the renderer's 1.75 CPUs and 3008 MB, on the same Mac; its load average was over 100
for the v0.7.2 runs and 50 to 90 for v0.7.3's, so every time is high:

| Actions | Turns | Message, as sent | Gzipped | Kept document                   | Kept replay | Replay gzipped |
| ------- | ----- | ---------------- | ------- | ------------------------------- | ----------- | -------------- |
| 65      | 9     | 30 KB            | 6.9 KB  | 37 KB                           | 37 KB       | 8 KB           |
| 123     | 14    | 52 KB            | 11.9 KB | 65 KB                           | 64 KB       | 14 KB          |
| 179     | 19    | 74 KB            | 16.3 KB | 90 KB                           | 90 KB       | 20 KB          |
| 402     | 34    | 162 KB           | 34 KB   | 198 KB                          | 197 KB      | 42 KB          |
| 603     | 53    | 243 KB           |         | past the log budget: `too-long` |             |                |

| Actions | Check, v0.7.2 (Mac) | Check, v0.7.2 (Docker) | Check, v0.7.3 (Mac) | Check, v0.7.3 (Docker) |
| ------- | ------------------- | ---------------------- | ------------------- | ---------------------- |
| 65      | 1.3 s               | 2.1 to 2.5 s           | 0.9 s               | 1.5 to 1.7 s           |
| 123     | 2.9 s               | 6.2 to 7.7 s           | 1.8 s               | 3.1 to 3.4 s           |
| 179     | 5.1 s               | 9.8 to 11.4 s          | 2.6 to 3.0 s        | 4.3 to 4.9 s           |
| 402     | 21 to 37 s          | 22 to 29 s             | 11 to 13 s          | 7.5 to 13 s            |
| 603     |                     |                        | 11 to 15 s          | 12 to 13 s             |

The documents are the same on both releases. The document grows about 490 bytes an
action, so the budget ends a shareable match at about 505 actions (about 40 turns), a
message of about 204 KB. On v0.7.2 the check grew faster than the match: with no checks
the 402-action replay took 2 to 5 s, the throw checks 7 to 8 s, and building the
document 22 to 31 s, because the engine measured the whole document after every action,
so a match much past 300 actions missed the 20 s wait and was answered "busy". v0.7.3
measures it cheaply on the replay path. The 603-action match (made with an 80-turn cap, club
seed 5) is about the longest message the rooms take (256 KB) and is answered
`too-long` after the whole replay, in 11 to 15 s. So the worst check fits the 20 s wait,
with less margin than that number suggests on a busy machine and an unknown one on
Lambda's CPU until the first live `ms` log lines; the wait stays 20 s. These replace the
256 KB guess this section had.

With drills (`build/reel/out-drills/`): `solo-11` shows Riverside's kubb out twice in
turn 9, in place of the computer's second long base kubb (36.5 s, was 37.5); `seed-1`
shows South's five-kubb group in turn 8 and the baton that took three of it, in place
of North's two-kubb baton in turn 9 (35.5 s, was 37.0); `solo-2` has no drill over
the bar (a kubb that landed on another, alone) and is unchanged at 37.1 s.

The edit needs three changes for these matches, not yet made in the prototype. Nothing
else in it assumes two people:

- **The person is the subject.** When the computer won, four of `solo-11`'s five moments
  were the computer's. The person sharing it wants their own throws. In a match against
  the computer the person's moments score half again as much, and at most two of the
  computer's go in besides the end. The end stays what happened: a computer's king shot
  ends the reel when the computer won.
- **"You".** Web and iPhone both name the side "You" when the player types nothing.
  Rendered as typed, the reel says "YOU WINS" and "You takes the king"
  (`solo-2-you-tall.mp4`), and a public page would say it to everyone. The name on the
  reel is asked for when the match is shared (below), and "You" is not taken as one.
- **The title card** says the computer's level under its plate (COMPUTER, CLUB): a win
  against the pro computer is not one against the beginner.

The end card's `throwingwood.com/p/<code>` stays: a shared match gets a code like any
pitch, and its link shows the replay as the end card's WATCH THE WHOLE MATCH promises.

## What a player sees

- **Where.** MAKE A HIGHLIGHT REEL sits beside WATCH REPLAY and EMBED on the winner
  card and on the replay bar of a pitch, and on the winner card of a match against the
  computer, on the web and on the iPhone. A pitch shows it only when the match has a
  kept replay. The embed does not show it.
- **A match against the computer is shared first.** It has no pitch, so the button
  opens a card before anything is sent (the words are in "Sharing a match against the
  computer" below). The player sees the name the reel will show, can change it, and
  sends it. Nothing goes until they press SHARE AND MAKE THE REEL. The match then has a
  link, `throwingwood.com/p/<code>`, and is from then on a finished pitch like any other:
  its page shows the result, WATCH REPLAY, EMBED and the reel. A match shared once keeps
  its code: asking again gives the same link.
- **Asking.** The button becomes MAKING YOUR REEL with a slow bar and "About a minute.
  You can keep watching." The card can be closed; the button shows the state when
  opened again.
- **Done.** A card with the video playing, muted, looping. It is tall on a phone held
  upright and wide otherwise.
  - DOWNLOAD TALL and DOWNLOAD WIDE save `throwing-wood-<code>-tall.mp4` and
    `-wide.mp4`.
  - SHARE, where the browser can share files, hands the tall file to the phone's share
    sheet. COPY LINK copies `throwingwood.com/p/<code>`. The iPhone's SHARE always
    has the file (below).
  - Anyone who opens the pitch later sees WATCH THE REEL in place of MAKE.
- **No kept replay** (a match from before replays, or one whose keep failed): no
  button. The replay bar already says nothing can be replayed there, and that covers the
  reel too.
- **Watching the computer** (`?watch=1`, nobody played): no button. See the open
  questions.
- **It failed.** "The reel could not be made." with TRY AGAIN when asking again can
  start it (one retry, then "Not this time"; the words below). A match against the
  computer that the server will not take says "This match could not be shared." and
  stays on the device. Nothing is shown to people who did not ask.

### The words (the contract for the web and the iPhone)

Both clients show exactly these words; a change here is a change to both
(`REEL_WORDS` in `src/net/reel.js`). No em dashes, nothing names a device.

| Where                                                     | Words                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Card title, every state                                   | Highlight reel                                                                                                                |
| State line while it renders                               | MAKING YOUR REEL, the slow bar, then "About a minute. You can keep watching."                                                 |
| Button                                                    | MAKE A HIGHLIGHT REEL, MAKING YOUR REEL, WATCH THE REEL                                                                       |
| Card buttons                                              | SHARE, COPY LINK, DOWNLOAD TALL, DOWNLOAD WIDE, TRY AGAIN, BACK                                                               |
| `engine`                                                  | This match was played on another version of the game, so it cannot have a reel.                                               |
| `empty`                                                   | There are no highlights to show in this match.                                                                                |
| `busy`                                                    | Reels are busy today.                                                                                                         |
| `unavailable`, and any why the build does not know        | Reels cannot be made right now.                                                                                               |
| `too-many`                                                | Too many reels asked for at once. Try again later.                                                                            |
| `replay`                                                  | This match has no replay, so it cannot have a reel.                                                                           |
| `moved` (a newer match kept, or the server's why)         | This pitch has moved on to a newer match.                                                                                     |
| The reel is `failed` on the server (final)                | The reel could not be made. Not this time. (no TRY AGAIN)                                                                     |
| The request could not start a render (the error `failed`) | The reel could not be made. (TRY AGAIN once, then the final words above)                                                      |
| No connection                                             | No connection. (TRY AGAIN as often as pressed; while it renders, added under the wait text and asking goes on)                |
| Copied                                                    | Copied the link.                                                                                                              |
| Copy, share or fetch failed                               | Could not copy. The link is ... / Could not share. DOWNLOAD TALL saves it. / Could not get the video. DOWNLOAD TALL saves it. |

#### The share card

A match against the computer, before it is sent (`SHARE_WORDS` in `src/net/share.js`).
Once shared, the reel card above takes over, with its link and COPY LINK shown from the
start.

| Where                       | Words                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Button on the winner card   | MAKE A HIGHLIGHT REEL (MAKING YOUR REEL while it is checked, then the reel's)                                                                  |
| Card title                  | Share this match                                                                                                                               |
| What sharing does           | To make a reel, this match goes to throwingwood.com and gets its own link. Anyone with the link can watch the replay and the reel, for a year. |
| The field                   | Name on the reel, empty with "Your team's name" greyed in it                                                                                   |
| Under the field             | Your side is shown by this name. The other side is Computer. Nothing else about you is sent.                                                   |
| When it was played          | The score sheet shows the day and time the match was played.                                                                                   |
| Card buttons                | SHARE AND MAKE THE REEL (faded until the name will do), NOT NOW; after sending TRY AGAIN, BACK                                                 |
| The name will not do        | Type a name for your side. / A reel needs a name, not "You". / Up to 16 characters. / No spaces at the start or end.                           |
| While it is checked         | CHECKING THE MATCH, the slow bar, then "This takes a few seconds."                                                                             |
| The link, once shared       | The link: https://throwingwood.com/p/<code>                                                                                                    |
| `engine`                    | This match was played on another version of the game, so it cannot be shared.                                                                  |
| `does-not-replay`           | This match did not pass the check, so it cannot be shared.                                                                                     |
| `too-long` (known here too) | This match is too long to share.                                                                                                               |
| `busy`                      | Sharing is busy right now. Try again later.                                                                                                    |
| `unavailable`, unknown whys | Matches cannot be shared right now.                                                                                                            |
| `too-many`                  | Too many matches shared at once. Try again later.                                                                                              |
| The error `failed`          | This match could not be shared. (TRY AGAIN once, then "This match could not be shared. Not this time.")                                        |
| No connection               | No connection. (TRY AGAIN as often as pressed)                                                                                                 |

## The server

Built for finished online pitches (2026-11-19). Where the build differs from the design
below, it says so in a **Built:** line. The protocol is `docs/ROOMS.md` section 12.

### Render once, cache for good

A reel is keyed by **pitch code, replay version and reel version**:
`reels/<code>/<v>-<reel>/tall.mp4`, `wide.mp4` and `edit.json`.

- `v` is the kept replay's document version. A rematch is a new key. A shared match
  against the computer has `v` 1.
- `reel` is a short tag of the renderer (its cameras, overlays and engine major.minor),
  so a new look renders again only when asked, never in bulk.

**Built:** the tag is `r<look>-<major.minor>`, today `r1-0.7` (`backend/reels/tag.mjs`,
`REEL_LOOK`). The files are `reels/<code>/<v>-r1-0.7/tall.mp4`, `wide.mp4` and
`edit.json` (`application/json`), all `public, max-age=31536000, immutable`. A
deploy never writes or deletes under `reels/` (`tools/delivery-plan.mjs` refuses the
prefix; `tools/deploy.mjs` deletes nothing there).

The site stack's bucket holds them under the `reels/` prefix. They are served through
the existing CloudFront default behaviour from the existing S3 origin, so there is no
new distribution, origin or response headers policy (all 20 in the account are in use).
The site's own security headers apply.

- The objects are written with `Content-Type: video/mp4` and
  `Cache-Control: public, max-age=31536000, immutable`, because the key changes when the
  reel would.
- The viewer request function lets `/reels/` through as the static path it is.
  CloudFront answers range requests from S3, so players seek.

### Sharing a match against the computer

A match against the computer, on the web or the iPhone, is played on one device and
has no room. The web sends it once, privately, when it ends (`src/net/record.js`); that
record is never published and stays so. To get a reel, the player **shares** the match:
the device sends its replay once, when the player asks, and the server keeps it under a
fresh code exactly as a room keeps a finished match. From then on everything above and
below is one path: `/p/<code>` shows the result, the replay, the embed, the share card
and the reel, and a reel request names that code.

This is the choice over the alternatives:

- **Render from the device's message alone, with no pitch.** The reel would have no
  link to lead to, nothing to cache it under, and the end card's address would go
  nowhere. Every downstream piece (cache key, share tags, embed, retention) would need a
  second form.
- **Render on the phone.** The iPhone has the engine and could draw the frames, but it
  would need its own encoder, cameras and overlays in Swift, kept in step with the
  server's, and the web would need the same again. The server already renders.
- **Send the private record and publish from it.** The record carries the typed names
  and the build, and was promised private. Sharing is a separate act with its own words.

**The message.** On a socket of its own, with no join, as a report is sent, cut into
parts like any long message (`docs/ROOMS.md` section 2.1), as `game` and `report`
already are:

```
{ "t": "share", "id": 1, "g": {
    "client": "ios", "engine": "0.7.3",
    "start": "<the match's first snapshot, with the shared name>",
    "log": [ { "a": <action> }, ... ],
    "end": { "winner": "A", "throws": 37 } } }
```

`start` and `log` are what the web's trail and the iPhone's report trail already hold
(the replay's `start` form, as `tools/backfill-replay.mjs` uses). Before sending, the
device writes the name from the share card into the start in place of the typed one
(an engine call, below), so the typed name never leaves it. Names change no throw: the
prototype's renamed match played the same to its end, on other hashes. So the device
claims only the winner and the number of throws, and sends no hashes: the server works
them out and keeps them in the replay.

**Built:** one message, as drafted. A plan made while building it split the match into
`share-part` messages, gzipped and in base64, on the belief that one message could not
pass API Gateway's 128 KB message and 32 KB frame quotas. That was wrong: the rooms'
own framing already cuts every message into parts of 30,000 bytes, up to 16 of them and
300 KB in all, and `set`, `game` and `report` travel that way today. The largest
shareable match is about 204 KB, 7 parts. Half a message is never handled: until every
part is there it is only parts in the table, which expire after 10 minutes, so it
counts against no cap and invokes nothing; each part costs one write and one query,
under the stage throttle.

**What the rooms function checks** (it knows no Kubb, as for every other message):

- the shape: `start` a string, `log` an array of objects with an object `a`, `end` an
  object;
- the size: the whole message at most 256 KB as ASCII JSON (`shareBytes`), at most
  1000 actions (`shareActions`, a cheap ceiling well past the engine's limit), `start`
  at most 16 KB; otherwise `{ code: null, why: "too-long" }` before anything is read;
- `engine`: its major.minor is one the renderer carries (an environment value on the
  rooms function, `REEL_ENGINES`: every engine the site carries, today `0.7`);
  otherwise `{ code: null, why: "engine" }`. The renderer checks the match on that
  engine, so an iPhone build still on an older minor shares on the engine it played
  for as long as the site carries it (below, "Engines");
- a match shared before: the key `share#<sha256 of start and log>` names its code, and
  the same code is answered, free. A device that loses the answer and asks again gets
  one link. (**Built:** SHA-256, not FNV: a 32-bit collision would hand out another
  match's link);
- the caps below.

**What the renderer checks.** The rooms function invokes the renderer with
`InvocationType: RequestResponse` and `{ check: g }`, and waits up to 20 s. The renderer
plays the match through the engine release of that major.minor, from `start`:

1. the start is a new match of a person (side A) against the computer (side B), and
   side A's name is 1 to 16 characters and not "You";
2. every action is taken, none refused, and the match ends `over` with the winner and
   the number of throws the device claims;
3. each of the computer's throws is made again by the engine from the snapshot before
   it, and must be the same action. The end alone does not prove them: in the
   prototype, halving the speed of one of the computer's throws that knocked nothing
   still reached the same end, while each such forgery was caught by this step;
4. each of the person's throws is one the dial could make (an engine request below).
   Until then a throw at 30 m/s is taken: the prototype's forged one was.

**Built** on kubb-engine v0.7.2's own checks (vendored now at v0.7.4) (`backend/reels/check.mjs`): `checkStart`
(the start is exactly what `newMatch` makes of its options), then `replayLoad` with
`checkCpu`, `checkThrows` and `document`, `replayFinish`, `replayDocument`, and
`replayOf` on the document's match. Side B must be named Computer, team and players.
After them comes the size: a document past the log budget has no replay, and either the
document or the replay over 256 KB is `too-long`. The engine's docs say what this
cannot prove: that a person made the throws (a program inside the bounds passes), that
a fast throw was likely (a legal overpowered baton reaches about 57 m/s), and anything
about the computer's moves other than its throws (raising and placing are legal moves,
not made again).

A match that fails any of these is answered `{ code: null, why: "does-not-replay" }`
(or `too-long`, or `engine`) and nothing is kept; the renderer logs the step that failed and the engine version, no
names. One that passes comes back with the replay to keep (the start, the log, and the
hash after each action) and the finished document for the page (teams, result, the last
snapshot), both built by the engine. The rooms function then writes the room as a
**sealed** pitch:

- the room record with `sealed: true` and `keep = { v: 1, until }`, its document, and
  `room#<code> | replay`, all a year on, conditional on the code being new;
- `share#<hash>` with the code and the same expiry.

**Built:** the four items are written in one DynamoDB transaction (`TransactWriteItems`,
four puts), so a share is kept whole or not at all: a write that fails leaves no key, no
room, no document and no replay, and the device may try again. Each item is conditional:
the room, document and replay on the code being new, the `share#` key on there being
none (or one naming an incomplete share, which this one replaces), so two devices
sharing the same match at once get one link. A repeat is answered from the key only when
its room is sealed and its document and replay are there; otherwise the match is checked
and kept again under a new code. The device's `client` is checked and passed on to
nothing: it is not in the check's input and not stored.

A sealed room refuses `join`, `set` and `keep` (`sealed`): nobody plays on, rematches or
replaces its match. Its page goes straight to the finished-match card. The pages
function and the replay fetch read it as any finished pitch.

**Trust.** The server cannot trust a device's log, and does not need to. What a shared
match proves is that every throw went through this engine's physics, that the
computer's play is the computer's own, and (with the dial check) that every throw of
the person's is one a person could make. A match made by a program that throws well
within those bounds is still a match that happened by the game's rules; sharing it
shows nothing false about the game, and nothing about anyone else. That is the bar.

**Sending it.** The device sends the match the player sees on the winner card. The web
holds it in memory until the page is left; the iPhone keeps it on disk (below). A match
that cannot be sent (offline, the server busy) stays on the device and the button can
be pressed again.

**The card.** The same words on the web and the iPhone. The button on the winner card is
MAKE A HIGHLIGHT REEL, as on a pitch. For a match against the computer it opens:

> **SHARE THIS MATCH**
>
> To make a reel, this match goes to throwingwood.com and gets its own link. Anyone
> with the link can watch the replay and the reel, for a year.
>
> Name on the reel: [ Riverside ]
>
> Your side is shown by this name. The other side is Computer. Nothing else about you is
> sent.
>
> SHARE AND MAKE THE REEL · NOT NOW

The field holds the name typed for the match, or is empty (with "Your team's name"
greyed in it) when that was "You" or nothing. SHARE AND MAKE THE REEL is faded until it
holds a name. After it: "Checking the match", then the reel card's MAKING YOUR REEL, with
the link shown and COPY LINK already working. A match already shared skips the card.
**Built (2026-11-19), in the browser** (docs/CLIENT.md "Sharing a match"; the words are
"The share card" above). It adds a line under the field saying why a name will not do,
and the note that the score sheet shows the day and time the match was played (the
start is kept to the minute, open question 14). The state line while checking is
CHECKING THE MATCH, in capitals like MAKING YOUR REEL. A match plainly past the log
budget says "This match is too long to share." without being sent. The reel card is
asked from its own socket, as every web request is (not the share's socket, as point 1
below has it for a device that has just shared): the server needs no join for either.

### Who may ask, and limits

- **Sharing** a match against the computer: whoever holds the finished match on their
  device, by pressing the button. It is never automatic.
- **A reel**: anyone with the link, as for a replay or an embed. A reel shows nothing
  the replay does not.

1. A reel request is one message on the rooms socket: `{ "t": "reel", "room": "<code>" }`.
   It needs no join and sits under the stage throttle the other messages have. The
   device that has just shared a match sends it next, on the same socket.
2. The rooms function `GetItem`s `room#<code> | replay`. No replay is answered
   `{ reel: null }`.
3. It does a conditional `PutItem` of `room#<code> | reel`
   (`{ v, tag, state: "rendering", at, exp }`), only if there is none for that `v` and
   tag.
4. Only the request that wins invokes the renderer, with `InvocationType: Event`. Every
   later request reads the item and answers its state (`rendering`, `done` with the
   paths, or `failed`). The device asks again every 5 s while it renders.

**Built**, with these details (`backend/rooms/core.mjs` `reel`):

- Step 2 also reads the replay's `engine` and answers `{ reel: null, why: "engine" }`
  when the renderer does not carry its major.minor (below), and a rooms function with no
  renderer configured answers `{ reel: null, why: "unavailable" }`.
- Step 3's item is `{ v, tag, job, state, at, tries, exp }` (`job` is `<v>-<tag>`, `exp`
  the replay's). The write wins when there is no item, it is for an earlier `v` or
  another tag, or it is this same render still `rendering` 25 minutes after it started
  and tried fewer than twice: a render whose invoke was lost, or whose Lambda stopped
  without a word, is started again by the next request. One that ran out of time on
  both tries is shown as `failed`.
- The daily counter is taken only by the request that won step 3, so viewers asking at
  once cost one render. Over the cap, that request takes its item back and answers
  `why: "busy"`.
- "3 reel requests a connection" counts only requests that start a render; asking how
  one stands is free, so a device can poll. The fourth start is the error `too-many`.
- When the invoke itself fails, the item is taken back and the request is answered the
  error `failed`.
- A request may name the kept version it means (`v`). When the room keeps another, it
  is answered `{ v: <kept>, reel: null, why: "moved" }` before step 3: nothing is
  started or counted. The browser sends `v` with every request (the first ask, each
  poll, a card opened again, TRY AGAIN), so a card left on an old match never starts a
  rematch's render; without `v` the server answers as before.

Limits, beside the existing ones (the stage throttle, `gamesPerConn` and
`reportsPerConn`):

- the renderer's reserved concurrency is 2, and async invokes that are throttled wait
  in Lambda's own queue for up to 6 hours. A check waits at most 20 s, then is answered
  "busy" and stays on the device. **Built, and worse than drafted:** a synchronous
  invoke is not queued. While two renders run, it is refused at once
  (`TooManyRequestsException`); the rooms function tries again every 2 s until its 20 s
  are up, so a check gets in only if a render ends in time. A render takes about a
  minute, so a share made while two run is usually "busy". A check that runs past the
  20 s keeps running in the renderer and holds one of its two places until it ends.
  A separate check function, with its own concurrency, would end both (an open
  question below);
- 3 reel requests and 2 shares a connection;
- a day's cap of 200 renders (`reels#<yyyy-mm-dd>`) and 200 shares
  (`shares#<yyyy-mm-dd>`), conditional counter items, after which the answers are
  "Reels are busy today" and "Sharing is busy today";
- a share at most 256 KB and 1000 actions, and in fact the engine's log budget (about
  505 actions);
- a render that fails is retried once, then marked `failed`.

**Built:** the retry is Lambda's own for an asynchronous invoke (the function's event
invoke config: one retry, events kept at most 15 minutes). The renderer counts its tries
on the reel item; a failure on the first try is thrown back for the retry, on the second
it marks the item `failed` with `why: "render"`. A stale takeover keeps the count, and a
try past the second is failed without rendering, so a job renders twice at most in all
(`docs/ROOMS.md` section 12). A match with nothing to show (no throw at all, as when a
player resigned before the first, or no moment picked) gets no reel: it is marked
`failed` with `why: "empty"` at once, before any encoder starts, and never retried; a
later UI can say there were no highlights to show. `failed` is final for that version
and look.

At the costs below, the two caps bound a bad day at under a dollar and a half.

### The renderer

`kubb-xyz-site-reels`, in the site stack beside the pages function. It carries one
engine release for each major.minor it serves (`REEL_ENGINES`), and plays each match on
the one it was played on: a pitch's `match.engine`, a shared match's `engine`.

#### Engines

The renderer carries the engines the site carries (`docs/ENGINES.md`): the newest and
every older minor kept with `vendor:sync --keep`. Today that is one, 0.7.4.

- **The package.** `tools/reels-bundle.mjs` writes one Lua bundle per carried engine,
  `engines/<major.minor>.json` (`{ engine, sources }`, from `carriedEngines()`), where
  there was one `lua-sources.json`. The zip is the same bytes for the same vendored
  engines, so its key, `reels/<sha256>.zip`, changes only when they do. Each engine adds
  about 0.7 MB unzipped and 0.2 MB zipped.
- **`REEL_ENGINES`** is the same set, by major.minor and newest first (`reelEngines()`
  in `tools/reels-bundle.mjs`): `0.7` today, `0.8,0.7` once 0.8 is vendored with
  `--keep`. `tools/infra.mjs` passes it to the site stack, and the rooms stack takes it
  from the site stack's `ReelEngines` output, so the two always name what the deployed
  package holds. Both templates already took a list.
- **A render** (`backend/reels/job.mjs`) reads the replay's `engine`, and renders only
  when its major.minor is the tag's, is in `REEL_ENGINES` and is one the package holds.
  The handler reads that engine's bundle the first time a match of it comes
  (`packageEngines` in `backend/reels/handler.mjs`). Anything else fails with
  `why: "engine"`, as before.
- **A share check** (`backend/reels/check.mjs`) plays the match on the engine its
  `engine` names, under the same three conditions; otherwise `why: "engine"`. The rooms
  function needs no change for this: it already refused a share or a reel by testing the
  match's major.minor against the `REEL_ENGINES` list, so a list of two lets both
  through.
- **The tag** names the match's engine, never the newest: `r<look>-<major.minor>`. A 0.7
  match has `r1-0.7` before and after the site moves to 0.8. Its reel item and files
  keep their key: asking again answers the done reel, and nothing renders again. A 0.8
  match gets `r1-0.8`. If 0.7 is later dropped, a reel already made for a 0.7 match
  is still answered `done`: the rooms function looks for the done item under the
  match's own tag before it checks the engine, so the app keeps showing it, and
  `/p/<code>` still links it (the pages function never looks at the engine). It stays
  until the lifecycle rule expires it. A 0.7 match with no reel made, or one whose
  render never finished, is answered `why: "engine"`, and nothing is started. A 0.7
  share is refused.
- A match from before `match.engine` was written has no engine and gets no reel.

`docs/REEL-RUNBOOK.md` "Adding or dropping an engine" has the deploy order.

Built as a zip function: Node 24 (`nodejs24.x`), arm64, 3008 MB, 5 minutes, reserved
concurrency 2, `@napi-rs/canvas` 1.1.1 with its Linux arm64 binary, and a layer with a
static ffmpeg 7.0.2 (libx264) at `/opt/bin/ffmpeg`, both pinned in
`infra/reels-pins.json` and packaged by `tools/reels-bundle.mjs` (13 MB zipped, 30 MB
unzipped; the layer 24 MB zipped, 49 MB unzipped; 79 MB of Lambda's 250 MB). The ffmpeg
build is GPL v3 (libx264 is GPL): the layer carries its `GPLv3.txt` and `readme.txt`,
the layer's licence is `GPL-3.0-or-later`, and the source is ffmpeg.org's and
videolan.org's. Its role may:

- `dynamodb:GetItem` the replay and `UpdateItem` the reel item, nothing else in the
  table (**built:** IAM can hold the partition key to `room#*` and the attributes to
  the replay's `v`, `z` and `exp` for reads and the reel item's own for updates, but not
  the sort key: the attributes are what keep it to those two items. See
  `docs/REEL-RUNBOOK.md`);
- `s3:PutObject` under `reels/` in the site bucket;
- write its own logs.

A check writes nothing: it answers the rooms function, which writes the sealed room
with the role it already has. The rooms function's role gains `lambda:InvokeFunction`
on this one function, for both checks and renders. **Built:** the role already had it
for renders, so sharing changed no IAM; the rooms function's timeout went from 10 s to
30 s for the 20 s wait (API Gateway's 29 s integration limit does not matter: the answer
is posted to the connection, not returned). The renderer never reads the private
games bucket. It renders both formats in one run, uploads them, then marks the item
`done`. A failure leaves `failed` and a log line.

### Retention

The same as the replay: **a year from the end of the match**, and for a shared match a
year from when it was shared. An S3 lifecycle rule expires `reels/` after 366 days. The
reel item's `exp` matches the replay's `keep.until`, so once the room is gone the pitch
no longer links a reel. A cheaper rule (expire after 90 days, render again on request)
is an open question below. A shared match's room, document, replay and `share#` key go
together, by their TTL.

### Links and share tags

- The pages function already reads the replay item. It also reads `room#<code> | reel`
  (**built**, one more `GetItem`, only beside the match's own kept replay; a reel for
  another version, not done, or unreadable is no reel), and when that is `done`,
  `/p/<code>` gains:
  - `og:video` and `og:video:secure_url` (the wide MP4);
  - `og:video:type` `video/mp4`, `og:video:width` 1920 and `og:video:height` 1080;
  - `og:image` stays the pitch card.

  Facebook, LinkedIn, Slack, Discord and iMessage then play or preview the video. X
  shows the image card: its player card needs an iframe page and is left out. The
  description ends "Watch the highlights."

- A shared match's title is "Riverside vs Computer · Kubb: Throwing Wood" and its
  description "Final: Riverside won, against the computer (club), in 9 turns. Watch the
  replay." It needs nothing new of the pages function but the level.
- The pitch page shows WATCH THE REEL. The embed gains nothing: it stays the replay.
  A blog can link the MP4 or embed it with a `<video>` tag.

## The iPhone

A plan; none of it is built. The app is on engine 0.7.1.

**What a finished solo match keeps today.** The save in Application Support is the
session's snapshot after each committed action (docs/MATCH.md): the match as it stands,
not how it got there. Home after a win deletes it. Beside it, in memory only, the report
trail (`ReportTrail` in `PitchReport.swift`) holds the first snapshot and every action
since, the person's and the computer's throws and every raise and punishment (all come
through `committed`). That is exactly a replay's `start` and `log`, and the prototype's
`solo.mjs` keeps the same thing. But:

- a cold launch restores the save and starts the trail again at that checkpoint
  ("Resuming a solo save starts its report history at that checkpoint"), so a match
  that was resumed has lost its start and cannot be replayed;
- the trail is gone when the app is closed after the win;
- no hash after each action is kept (none is needed: the server works them out);
- solo matches are not recorded at all (`recordGame` exists in `KubbRooms` but nothing
  calls it). That is a separate matter from sharing and is left as it is here.

No engine change is needed to replay them: `replayLoad({ start, log })` takes the
trail as it is, and the computer's raises and handovers come back through the engine.

**Where and what.** MAKE A HIGHLIGHT REEL on the winner card, for a solo match and for
an online one. An online match already has its code and kept replay, so it goes
straight to the reel request. A solo match first shows the share card, then sends
`share` and then `reel` on one unjoined socket, through two new correlated requests in
`RoomsClient` beside `report` and `recordGame`.

**Waiting.** The card shows MAKING YOUR REEL and asks again every 5 s while it is on
screen. In the background it stops; on return it asks once and goes on. The state is
the server's, so nothing is lost. No push notification.

**The video.** When the reel is `done` the app downloads the tall MP4 (about 5 MB) to
Caches and shows it playing, muted, looping. SHARE opens the share sheet with the file
itself, so it goes to Messages, Photos (Save Video), TikTok, YouTube or Files as a video
and not a link. COPY LINK copies `throwingwood.com/p/<code>`. Saving to Photos through
the sheet needs the add-only photo library usage string in the app.

**What stays on the phone.** The finished match (start and log, step 1 below) until the next
solo match ends, the code once shared, and the video in Caches, which iOS may purge; it
is downloaded again from its link while the link lasts.

**Offline.** The button is there. Pressing it says "No connection. The match is kept on
this phone. TRY AGAIN" and sends nothing.

**The work, in order:**

1. **Keep the trail on disk** (app, about a day, can start now): write the first
   snapshot and each action beside the save, atomically, so a resumed match keeps its
   start; keep the finished match after Home until the next solo match ends. Every
   match played before this ships can never be shared, so it goes first.
2. **Engine release** with the checks below (kubb-engine, 2 to 3 days): the person's
   throw bounds, the computer's throws made again in a replay, renaming a side in a
   start, and the finished document of a replay. No throw changes, so no match already
   played goes differently. The iPhone takes it as a patch of its 0.7; the web shares
   solo matches once it is on a release with it (it is on 0.5.1 until the held PR
   merges), and `REEL_ENGINES` lists only major.minors whose renderer release has it.
3. **Server** (2 to 3 days, after the reel server in this document): `share`, its caps
   and `share#` key, sealed rooms, the renderer's check and its engines.
4. **Web** (2 days): the solo winner card's button and share card, a sealed pitch's
   page, the reel card shared with pitches. **Built 2026-11-19.**
5. **iPhone** (3 to 4 days): the two requests, the winner card's button for solo and
   online, the share card with its name field, waiting, the download and share sheet,
   offline and failure, and review pictures for each card.

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

Compute is priced at the us-east-1 Lambda arm64 price of $0.0000133334 a GB-second
(first tier) and $0.20 a million requests. Storing is S3 Standard at $0.023 a GB-month
and $0.005 per 1,000 PUTs (three a reel). Serving is CloudFront's data transfer out in
the United States, $0.085 a GB past the free monthly terabyte: one full download of
both files (11 MB) is about $0.0009, and a viewer normally fetches one file, about 5 MB,
about $0.0004. A hundred full views of a reel cost about $0.09. DynamoDB is fractions of
a cent. These prices were checked in the AWS price list on 2026-11-19. With the 71 s
measured in the Lambda image (above), a reel is about 3 GB x 71 s = 213 GB-s, about
**$0.003**, and the daily cap of 200 bounds a bad day's compute at about $0.60.

**A shared match** adds a check before its reel: two passes of the match, 1.4 to 11 s
here for 65 to 445 actions (under load), so guess 3 to 25 s at 3 GB, 9 to 75 GB-s, about
**$0.0001 to $0.001**. Its replay is one gzipped item of 7 to 38 KB, written once (7 to
38 write units on demand, a few thousandths of a cent) and stored for a year (1,000
shared matches are about 20 MB, under a cent a month). So a shared match and its reel
cost about the same as a pitch's reel, **about $0.005** in all, and the 200 shares a day
cap adds at most about $0.20 to a bad day.

The Lambda durations are guesses from the measurements here until a real deploy. The
prices were checked on 2026-11-19 (above).

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

A reel shows the **team names only**, never member ids or anything else typed in the
lobby. A side's name is what its players typed: for a player alone on a side, the name
they typed. It is made from the kept replay, never from the private games
bucket or the records.

A match against the computer is different in one way: its side's name is what the
player typed for themself, so it may be their own name. So it is asked for again on the
share card, under words that say it will be public, and only that name is sent and kept:
the device writes it into the match before sending, so the typed one never leaves the
device in a share. The other side is always Computer. The share sends no player
name, member id, build, clock or user agent; the private record of the same match (the
web's `game` message) is a separate thing, kept privately as before, and is not linked
to the shared code. **Built, with one correction:** "build" holds (`client` is checked
and dropped), but "clock" does not: the match's start carries the date and time it
began, to the minute, as every setup does, and it is kept and served with the replay
(open question 14).

- **Home page**, under what is recorded: "Anyone with a finished pitch's link can make a
  highlight reel: a short video of the match's best throws, with the team names, kept
  for a year like the replay. A match against the computer is shared only if you choose
  to share it, under the name you give it then."
- **Privacy page**: "Highlight reels are videos made on our server from a match's kept
  replay when someone asks. They show the team names, which for a player alone on a side is
  the name they typed, and never a member id or anything else typed in the lobby. They are stored with the site and anyone with the link can watch or download them. They
  are deleted a year after the match. A match you played against the computer is sent
  to us only when you press SHARE AND MAKE THE REEL: then its replay, with the name you
  gave on that card, is kept for a year under its own link, like any pitch. A video
  downloaded or posted elsewhere is out of our hands."

## Engine and replay-format needs

These are requests for kubb-engine. The prototype works around each but the person's
throw bounds, which it cannot.

1. **World-frame facts in the wide view.** Done in kubb-engine v0.7.2: `setWide` now
   un-turns Team B's `result.landX`/`landY` and `restX`/`restY`, the landing, and
   `timeline.firstContact` and `firstHit`, as it did the pieces and burst anchors. The
   reel turned them itself before; `scan.mjs` now turns nothing (an engine before 0.7.2
   needs that flip back).
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
   major.minor to the reel tag. The replay itself needs no new fields. A pitch's
   major.minor is its `match.engine`; a shared match's is the `engine` it was sent with.
6. **The computer's throws, made again.** `replay.new { ..., checkCpu = true }`: before
   each of the computer's throws in the log, the engine chooses its own from the
   snapshot (the choice is seeded by the match and the throw's number) and marks the
   replay `forged` if they differ. `verifySolo` does it with a second engine.
7. **A person's throw bounds.** A `checkThrow(action)` that says whether a throw is one
   the dial can make at that thrower's level: speed, loft, swivel, tilt and tumble in
   the ranges the swing can give, the swing's `back` and `stop` agreeing with its
   verdicts, the stance on ground the rules allow and the target on the pitch. Today a
   throw at 30 m/s is applied without a word.
8. **A side renamed in a start.** `renameStart(start, { A = "..." })`, the snapshot
   with the side's team and player names (and the ids made from them) changed and
   nothing else. The prototype replaced the text, which happens to work.
9. **The finished document of a replay.** The room document a finished match would
   have (teams, options, result, the last snapshot), so a sealed pitch reads like any
   other to the pages function and the pitch page, built by the engine since the rooms
   function knows no Kubb.

10. **Drill facts.** `result.restX`/`restY` are in the world frame in the wide view since
    v0.7.2 (request 1). The round's ruling ("out twice:
    punishment kubb") arrives on the throw that ends the round, not on the punished
    kubb's: the reel finds that kubb from the engine's `punish` need when a person
    places it, and otherwise (the computer places it with no action in the log) as the
    kubb thrown twice that stands well away from where it came to rest. A `judgment`
    per round (each kubb in, out, rethrown or punished, by id) and the placed spot would
    make both exact. Whether a kubb near the middle line is in is the engine's call; the
    reel never judges it.

6 to 9 are in kubb-engine v0.7.2 (`checkCpu`, `checkThrows`, `renameStart`,
`replayDocument`), and the server's check uses them. 6 to 10 change no throw, so they
can go in a patch release of each minor a client is on. 6 can also be done outside the engine, with a second engine as `verifySolo` does,
for any release; 7 to 9 cannot. 10 is a convenience: the prototype works without it.

## Open questions for the owner

1. **Make on request, or for every finished match?** On request, by anyone with the
   link. Rendering every kept match costs little but stores videos nobody watches.
   **Recommend: on request.**
2. **Keep a year, or 90 days and render again?** A year, the same as the replay: one
   rule, links that keep working, and about $0.25 a month per 1,000 reels.
   **Recommend: a year.**
3. **Sound on?** The knocks and the king's chord are in the reels now. Platforms mute
   by default, and players may add music there. **Recommend: keep the game's sound.**
4. **A match against the computer: a reel only, or a shared pitch?** Today such a
   match is never published. Sharing it as above makes its replay public at its link
   too, not only the video. **Recommend: a shared pitch**, one path for every reel; the
   replay is the same match the reel is cut from, under the same name.
5. **The name on a shared match.** The typed name is often the player's own. Asking
   again on the share card, prefilled, and never taking "You". **Recommend: the card as
   drafted.**
6. **Watch-the-computer matches** (nobody played). No button. The path would take them
   (they are the easiest to check, the whole match follows from its seed), but nobody's
   match is being shared and every one is North against South. **Recommend: no reels
   for them for now**; it is one condition to lift later.
7. **X's player card.** It needs an iframe player page; `/e/<code>` could serve it.
   **Recommend: leave it out for now.** Facebook, LinkedIn, Slack and Discord preview
   the video from `og:video`.
8. **Daily caps of 200 renders and 200 shares.** **Recommend: start there**, alarm on
   the counters, and raise them when they are reached.
9. **iPhone solo matches are not recorded** privately as the web's are. Sharing does not
   need it. **Recommend: decide it apart from reels**; step 1 of the iPhone's work makes
   it possible either way.
10. **How many drills.** One moment in three at most, and one whenever a drill clears
    the bar (a tight group of three, a punishment, an inkast that topples a kubb).
    **Recommend: start there** and look at more reels; the numbers are in one `tune`.
11. **Marking the punishment kubb.** It stands on the far baseline among the base
    kubbs, told apart only by its team colour at its foot and by the caption. A ring or
    a burst on it would be a new look. **Recommend: leave it unmarked** until a reel
    shows it is missed.
12. **A big turn's drilling as a quick sequence.** Dropped for now (above). It could
    come back for a turn of eight or more kubbs if a single hold proves too little.
13. **A separate check function.** A share's check runs in the reel function today and
    is refused while two renders run (above). A small function of its own (the engine
    and Node, no ffmpeg or canvas, 1 to 2 GB, a reserved concurrency of 1 or 2) would
    check whatever renders, and a late check would hold no render's place. It is one
    more function and role in the site stack. **Recommend: watch the "busy" answers
    first**, and build it if shares are turned away.
14. **The time a match began is published.** A shared match's start, and so its replay
    and document, carry the date and time the match began, to the minute, as every
    setup does. The privacy section said no clock is sent; the start is the clock. Rounding or
    clearing it before sharing would need an engine call that renames the time as
    `renameStart` renames a side. **Recommend: leave it**; a pitch's own match carries
    the same.
15. **A read-only ask.** Today the first `reel` request starts a render, so a page can
    know a reel is done on load only from its `og:video` tag, which the edge may cache
    for 5 minutes. A `reel` request flagged read-only, answering the state and never
    starting a render, would let the web and the iPhone show WATCH THE REEL on load.
    Its other use, never rendering a match the asker did not mean, is built: a request
    naming `v` gets `why: "moved"` when the room keeps another (above).
