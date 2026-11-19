# AGENTS.md: kubb.thingelstad.xyz (served at throwingwood.com)

`CLAUDE.md` is a symlink to this file. The Throwing Wood workstream guide is
[`../AGENTS.md`](../AGENTS.md); AWS and secret rules one level above that. The cross-site
rules this site shares with Jamie's other sites (sites list, shared type) are in
`../../thingelstad.com/AGENTS.md`.

Kubb: Throwing Wood on the web: kubb-engine (the Playdate game's own Lua core and a
screenless session over it, vendored in `vendor/engine/`) running in the browser, with
multiplayer on a link. The design is `docs/DESIGN.md`; read it first. The Playdate
game is the sibling checkout `../playdate-kubb` and its `docs/DESIGN.md` and
`AGENTS.md` are the reference for how the game plays.

## Rules

- **`vendor/engine/` is never edited.** It is kubb-engine (`../kubb-engine`) at the tag
  in `vendor/engine.json`, byte for byte. Change how the game plays in kubb-engine,
  release a tag, then `npm run vendor:sync -- --tag vX.Y.Z` (`vendor:check` holds it to
  the engine's manifest). Never write in the kubb-engine or playdate-kubb checkouts from
  here. wasmoon stays pinned at exactly 1.16.0.
- **This repository is public.** Keep email addresses, device serials, home-directory
  paths and secrets out of files and commits. Write
  the AWS account as `<account>` in Markdown.
- **Game logic in Lua, in kubb-engine** (tested there); this repository has no Lua of its
  own. JavaScript draws, listens and talks to the network. JS and Lua exchange JSON strings in
  a few coarse calls a frame.
- **Room rules are the engine's too.** `src/net/lobby.js`, `seats.js` and `sync.js`
  are thin wrappers over `room.*` (the engine's docs/ROOM.md), reading `.value` through
  `src/net/room-engine.js`. Initialize with `useRoomEngine` before calling them, pass
  connected ids as an array, and keep seat/actor calls cached out of the render loop.
  Keep `aimKey` and socket pacing in JavaScript. `me.engine` announces major.minor;
  START passes members and writes `match.engine`; `mayPlay` gates team and CPU control.
  `LENIENT_ENGINES` is false. Playing requires a named, matching major.minor.
- **The thrower's view frame everywhere** (core/frame): JS never flips the pitch.
  The wide view (watching the computer) shows the world frame instead: Lua un-turns Team
  B's output before JS sees it (the engine's `session/wide.lua`), so JS still flips nothing.
- Dev servers bind to 127.0.0.1 and are stopped when the work is done.
- No italics on sans-serif type. Type and tokens come from `../../thingelstad.com/shared/`.

## Build and check

`npm ci`, then `npm run check` and `npm run format:check`. `check` runs, in order:
`vendor:check`, `shared:check`, the `infra/site.json` sync check, every `*.test.mjs` under
`tests/` with `node --test` (among them the engine's golden corpus under this wasmoon and
the kept replay fixture: `node tools/replay-fixture.mjs` writes it again), the build, and `validate:site` (links and routes
resolve through the real viewer request function, required tags, no inline script, no email
address or home path in `dist/`, no account id in Markdown).

- `npm run build` writes `dist/`: `public/`, the client bundled by esbuild from
  `src/main.js` into `dist/assets/` (hashed names, source maps), wasmoon's `glue.wasm` and
  the Lua sources (`tools/lua-bundle.mjs` writes `build/lua-sources.json`) as hashed assets,
  and the pages from `src/site/`. The game pages carry the client's settings as a JSON
  block, `<script type="application/json" id="kubb-config">`, read by
  `readConfig()` in `src/site/config.js` (its comment is the shape). No inline scripts: the
  CSP allows none.
- `npm run preview` serves `dist/` on 127.0.0.1:4322 through `infra/viewer-request.js`, so
  `/p/<code>` works as it does live. `npm run dev` rebuilds on every change and also runs
  `tools/rooms-dev.mjs` (ws://127.0.0.1:8788). Stop both when done.
- `infra/site.json` carries `infra/viewer-request.js` and the CSP from `src/site/csp.mjs`
  as copies; `node tools/site-template.mjs` writes them in (infra:plan does it too) and the
  check fails on drift. Edit the sources, never the copies.
- `npm run images` redraws the share image and icons from `src/site/art.mjs` (Playwright's
  Chromium); the PNGs are committed.
- Prettier formats everything but `vendor/`, `dist/`, `build/` and the vendored copies.

## Hosting

- `infra/site.json` (stack `kubb-xyz-site`): S3 bucket, CloudFront with the shared `edge`
  web ACL, ACM certificate, and the site's own DNS records (A/AAAA aliases and certificate
  validation). The site is https://throwingwood.com since 2026-11-17: its apex and www are in
  the `throwingwood.com` zone (imported from projects-sysadmin's
  `projects-dns-zone-throwingwood-com` export), and the old kubb.thingelstad.xyz stays in the
  `thingelstad.xyz` zone. The viewer request function answers www and the old address with
  a 301 to the same path on throwingwood.com, so shared links and embeds keep working; the
  repository, stacks and buckets keep their kubb-xyz names. Never edit those records in the
  console.
  Access logs go to `/kubb-xyz/web-access`, IP-free, kept 731 days. The viewer request
  function serves `/pitch/index.html` for every `/p/<code>` (codes as the rooms accept
  them: 8 to 24 of `abcdefghjkmnpqrstuvwxyz23456789`). It also owns the bucket for the
  rooms function's code, and, with `"wsRoute": true` in `infra/deployment.json`, the `/ws`
  route that sends the WebSocket on to the rooms API under the same web ACL.
- The site stack also holds the pitch pages function, `kubb-xyz-site-pages` (a Lambda
  Web Function, `backend/pages/`): CloudFront sends `/p/*`, `/e/*` and `/og/*` to it, after
  the viewer request function has turned them into `/pitch/index.html`,
  `/embed/index.html` and `/share/kubb.png` with `?pitch=<code>`. It reads one room's
  document (and its kept replay) from the rooms table with `GetItem`, nothing else, and
  writes that pitch's share tags into the page or draws its share image. The bucket is the
  origin group's second member: when the function fails, or the stack has no function,
  the static page and image are served as before. `npm run infra:apply -- site` bundles it
  (`tools/pages-bundle.mjs`, `pages/<sha256>.zip` in the code bucket) and passes the rooms
  table's name; `tools/deploy.mjs` only says when the live bundle is behind
  (`docs/ROOMS.md` section 11).
- `infra/rooms.json` (stack `kubb-xyz-rooms`): the WebSocket API, its function and table,
  and the private games bucket (below).
  `npm run infra:apply -- rooms` bundles `backend/rooms/handler.mjs` (esbuild, one ESM
  file, AWS SDK left out), zips it the same way every time and uploads it as
  `rooms/<sha256>.zip`.
- `infra/delivery.json` (stack `kubb-xyz-delivery`): the GitHub OIDC role `main` deploys
  with: the site bucket, invalidations, and this one function's code.
- Change infrastructure with `npm run infra:plan` then `npm run infra:apply` as the
  `cloud-engineer` profile (`AWS_PROFILE=cloud-engineer`); both run through change sets and
  rewrite `infra/deployment.json`. Name stacks to limit a run (`-- site`, `-- rooms`).
- Changes to `main` require a pull request with a passing `check` job on an up-to-date branch.
  Merging to `main` deploys: CI builds with `KUBB_PRODUCTION=true` (production rooms
  address, analytics), `tools/deploy.mjs` uploads, invalidates, compares the live bytes and
  the wasm content type, and updates the rooms function's code when its bundle changed.
  Roll back by reverting. The same script publishes by hand as `cloud-engineer`.

## Recorded games

Every match is recorded (Jamie, 2026-11-15: "all games should be recorded so that we can
use it to test and improve the game"). The rooms function writes every committed version
of a room's document, with the action that made it, to the private games bucket for good
(`backend/rooms/recorder.mjs`, `docs/ROOMS.md` section 7). Solo and watch matches have no
room: the browser sends each once when it ends (`src/net/record.js`, Jamie 2026-11-16:
"watch mode should record ... All games recorded"), kept under
`games/browser/<yyyy-mm-dd>/`. The names players typed are in them: records are pulled to
`build/games/` (never in git) and never published. The home page says what is recorded.
Practice is not recorded.

- `npm run games:pull` (as `cloud-engineer`) fetches new records; `--room <code>`,
  `--since <date>`.
- `npm run games:replay` plays every recorded match through this checkout's engine and
  says which actions end on another hash than the players' browsers committed. After a
  new engine those are the throws that now go differently.
  One-browser matches replay from their start against the hash after each action; after
  the first that differs the rest are unjudged.

## Reports

A player can say a throw looked wrong (Jamie, 2026-11-16: "Is it worth allowing,
particularly on the web, a specific 'report' action that the player can type what
happened and what should have happened so we can analyze? I think yes." and "Approved:
build the web report action in kubb.thingelstad.xyz with a private store on AWS for the
typed reports"). MENU, REPORT A THROW, in every mode (practice, solo, watch, a shared
pitch), opens a card with "What happened?" and "What should have happened?" (1000
characters each, at least one), SEND and CANCEL. The browser sends the answers with the
game as it stood when the card opened, enough to play the reported moment again here
(`src/net/report.js` says exactly what; no name field, no user agent, no member id). It
goes as one `report` message on a socket of its own to the rooms server
(`docs/ROOMS.md` section 8), which writes one gzipped object to the private games bucket
under `reports/<yyyy-mm-dd>/`, kept for good like the games.

- Limits: 64 KB a report as ASCII JSON (history, then pieces, then the snapshot after
  are dropped to fit; the answers, the snapshot before and the last action never), 3
  reports a connection (best effort, per Lambda instance), the stage throttle.
- `npm run reports:pull` (as `cloud-engineer`; `--since <date>`) copies new reports to
  `build/reports/` (never in git) and prints each: when, mode, the two answers, where the
  replayable state is. `npm run reports:show` prints those already pulled.
- `npm run reports:replay -- <file>` plays the report's last action from the snapshot
  before it through this checkout's engine (and the whole match from its start when the
  report carries it; practice from its options and steps), says whether it ends where the
  player's browser did, and prints the last throw's result and where the pieces lie.
- `npm run dev`'s local rooms server keeps reports as files in `build/reports-dev/`.

## Watch the computer

`/p/<code>?watch=1` (home page: "Watch the computer", added 2026-11-16 on Jamie's ask: "I
could oddly imagine watching that in a background window. Also a great way to get test
data."): the session's `cpu = "both"` with a seat that plays no side
(`startWatch` in `src/main.js`). The computer throws, raises and places punishment kubbs
for both teams at a calm pace (Jamie, 2026-11-16: "slow it down. Think more like Zen
screensaver ... more natural player like pauses"; `watchTune.zen`, `Game.zenPauseFor`:
the thrower stands 1.5 to 4 s before every throw, 4 to 7 s more when the other team
steps up, 2 to 4 s more between the kubbs and the batons, and the pitch rests 2.4 s
after a throw; shown only, the match itself is the same); the winner card stays up
`watchTune.nextMs` (20 s) with NEXT MATCH, STOP and HOME, then the next match starts with the other team
first. It uses the solo card's saved options; teams are North and South; `maxTurns` 60
is a safety net. In a hidden tab a timer steps it without drawing (`Game.background`,
docs/CLIENT.md "The loop"), at the match's own pace with no pauses. Every match is recorded like a solo one (above), the hidden
tab's too, and its score sheet is on the menu and the winner card.

It is watched in the **wide view** by default (Jamie, 2026-11-16: "It'd be fun to
actually do more with the camera on the web version because we could zoom out. We have a
lot more screen. We could see a lot more."): one fixed camera high on the sideline (high
behind Team A's baseline on a tall window) with the whole pitch filling the window, for
the whole match. The session keeps Team B's throws in its turned view frame; in the wide
view the engine's `session/wide.lua` un-turns them into the world frame in Lua, so JS still never
flips anything. THROWER'S VIEW / WIDE VIEW by MENU, MENU's View and the V key switch it
(the `watchView` pref); a phone held upright falls back to the thrower's view. Played
matches keep the thrower's view. docs/CLIENT.md "The wide view".

## Open games

A host can make a pitch open (Jamie, 2026-11-16: "allow a game to be created open so it
can be joined by anyone ... Open and invite only are both supported"): the lobby's "Who
can join" (Invite only, the default, or Open), or Open on the home page's start step
(`?open=1`). The home page lists open games under "Open games" (`public/js/open-games.js`):
counts, state and age only, never names, the 20 newest, refreshed every 30 s. The host's
browser tells the room server what to list (`docs/MULTIPLAYER.md`), and the server keeps
it in the rooms table's `open` partition with a 15 minute TTL: no new AWS resources, no
scans (`docs/ROOMS.md` section 9).

## Replays

A finished pitch can be watched again (Jamie, 2026-11-16: "When a game is finished playing
on a pitch I'd like the URL to allow people to come and watch a replay of the match.").
The match is played again through this engine from its start, action by action
(the engine's `session/replay.lua`, `src/replay/player.js`), in the wide view at the match's own pace,
with play/pause, NEXT THROW, BACK, 1X 2X 4X and the score sheet beside it. The winner card
and anyone who opens the link after the end get WATCH REPLAY; after a rematch the lobby
offers WATCH THE LAST MATCH. A replay belongs to nobody: the engine refuses every action
from outside while one is loaded. A hash that disagrees (after a physics change) is
noted and it plays on.

- The document carries the replay while the match is played (`setup`, `h0`, `log`;
  `docs/MULTIPLAYER.md`); at the end a player's browser sends `keep` and the rooms table
  keeps it gzipped beside the document, and the room a year from the end of the match
  (`docs/ROOMS.md` section 10). No new AWS resources. Old matches show the result without
  WATCH REPLAY.
- Anyone can fetch a kept replay by its code without joining (`{ t: "replay", room }`,
  `src/replay/fetch.js`); `startReplay({ code, game, root })` needs nothing of the pitch
  page, so an embed or a share image can build on the two.
- Replays are never served from the private games bucket. A match from before replays
  can be given one from its records, one room at a time and only with Jamie's go:
  `node tools/backfill-replay.mjs --room <code>` (dry run, the hash agreement) and
  `--write` (as `cloud-engineer`); `docs/ROOMS.md` section 10.

## Embed

A finished match can be put on another website (Jamie, 2026-11-16: "I would like an embed
option that allows me to put a Kubb game played as an embed on another website").
`/e/<code>` is the replay player alone (`src/embed/embed.js`): the wide view, its bar,
the score sheet closed, no sound, playing while at least half of it is in view and held
when scrolled away (a pause the viewer chose stays a pause), REPLAY AGAIN at the end, and
"Kubb: Throwing Wood ↗" to `/p/<code>` in a new tab. It never joins, acts or reports, and
has no analytics. A match in play, a pitch waiting for players, a match with no kept
replay and an unknown code are quiet cards with a link to the pitch; a match in play is
not shown because watching one means joining the room.

- EMBED, beside WATCH REPLAY on the winner card and on the replay bar, shows the snippet
  with COPY (`src/ui/embed.js`): an iframe 100% wide at 16:10, `loading="lazy"`, a
  `title` and `allow=""`.
- `/e/` is the one path that may be framed: the site's security headers with
  `frame-ancestors *` (`embedSecurityPolicy` in `src/site/csp.mjs`) and no
  `X-Frame-Options`; every other page keeps `DENY` and `frame-ancestors 'none'`. They
  are set by a viewer response CloudFront Function (`infra/embed-response.mjs`, written
  into `infra/site.json` by `node tools/site-template.mjs`), not a response headers
  policy: the account's 20 are all in use by its sites.
- An embed follows its pitch: while a rematch is set up it shows "Waiting for players"
  (not the last match), and once that match is kept it plays the newer one.
- No oEmbed endpoint: the snippet is enough for the sites it is pasted into.

## Share previews

A pitch's link shows that pitch (Jamie, 2026-11-16: "can we get the share preview image to
reflect the game that it is linked to?"). The pitch pages function writes the title
("North vs South · Kubb: Throwing Wood"), a description of its state ("Waiting for
players. Join the pitch.", "In play: turn 7", "Final: North won, 1 to 0, in 9 turns. Watch
the replay.") and `/og/<code>.png?v=<version>` into `/p/<code>` and `/e/<code>`. The image
(1200×630, `pitchCardImage` in `src/site/art.mjs`, drawn with resvg) has the team names,
the state and the pitch from above with its pieces where they stand. Team names come from
the match; a waiting pitch has none yet, so it is "A pitch waiting for players". No names
of players, member ids, open-game listing or games bucket. Anything that fails gives the
static title, description and share image, never an error page.

## Score sheet

MENU, SCORE SHEET (any match, not practice) and SCORE SHEET on the winner card show the
match's Planet Kubb Notation game file, positions hidden until SHOW POSITIONS, with COPY,
DOWNLOAD (`.txt`) and a link to the notation page (`src/ui/sheet.js`, docs/CLIENT.md).

## Analytics

Tinylytics, `script.js` form, only in the deploy build (`KUBB_PRODUCTION=true`) and only
on the production hostname (`public/js/analytics.js` checks it in the browser). The site id
is `TINYLYTICS_SITE` in `src/site/site.mjs`; while it is `null` no script is added.

## The meter

The throw's meter is the player's choice (Jamie, 2026-11-19: "I'm considering a player
preference for a circular meter (clock) versus a linear meter ... The logic is the same to
me. Just a choice if you want to spin your thumb or crank -- or use a different hand to
flick."): MENU, Meter, Clock or Linear, kept on the device (`meter` pref). The clock is
the default and is never retired: Tyler strongly prefers it. The linear meter
(`src/render/linear.js`) is the dial unrolled into a track at the screen's edge and feeds the
engine the same arm degrees, so both are judged alike and it needs no engine release. Its
room is the point (the straight trial of 2026-11-18 went because "it was too cramped and
visually looked janky"): where a screen cannot give the track `minTravel` the clock is
drawn instead. docs/CLIENT.md "The throw".

The finger and the meter apart (Jamie, 2026-11-19: "if you can have the control and the
touch be slightly distant from each other, that could make that better"): with the linear
meter on the screen a drag in the throw zone (the lower 40% of the canvas, where there is
nothing to aim at) strokes the knob as a grab of it does, and a tap there still aims; on
touch a press outside the clock's ring, out to 2.1 radii, turns the arm as the ring does
(where a tap there could aim, only a drag does, and a tap still aims),
and on a touchscreen held upright the clock is 13% smaller and raised so a finger can go
all the way round outside its rim. A press on the ring is exactly as before. MENU, Side
(Jamie, 2026-11-19: "Left and right handed folks may want it on one side or the other";
`meterSide` pref, right by default) puts the linear meter at either edge, mirrored, and a
wide screen's clock lower left or right; a tall screen's clock stays centred. All of it
changes only where the finger may be and where the meter sits: the engine is fed the
same arm degrees.

The nudge (Jamie, 2026-11-19: "A couple of users have had a lot of confusion on how to
throw. It would be awesome if we see the user not making progress on a throw to animate
a nudge in the screen on what to do. Have the UI show it not a separate how to page."):
when a player is stuck on their own throw (any device after two presses on the meter in
a row that made no throw; a device with fewer than 3 throws after 8 s without touching
the meter, one with more after 30 s with no input), a ghost knob makes one good throw on the real meter with a ghost fingertip where
the finger goes, until the next press. `src/game/nudge.js` (pure, its numbers in one
`tune`) and `src/render/nudge.js`; drawing only, never fed to the engine, sent or
recorded. docs/CLIENT.md "The throw".

## Raising

A player can hand the raising to the engine mid-match (Jamie, 2026-11-19: "When raising
kubbs we have three options today including an auto, we should also add an "auto all". In
fact I could see players wanting to shift to auto raise kubbs for the rest of the game.").
The raise panel has END 1, END 2, AUTO (this kubb) and AUTO ALL (the rest of this turn's);
MENU, Raising, or REST OF GAME on the panel, makes every raise automatic for the rest of
the match, and BY HAND takes it back. It is the player's own choice on a match that raises
by hand, kept only for that match: `src/game/auto-raise.js`, docs/CLIENT.md "Match flow".

## Pitch lines

Thin on purpose (Jamie, 2026-11-16: "in Kubb, the concept is that there really is no
line. The line is just a visual indicator. So it should be much thinner"):
`render/world.js` `tune.lineWidth` 1.2 cm on the ground, never under 0.6 frame px. The
Playdate's 2 px lines (DESIGN 6) are its 1-bit screen's, not the web's.
