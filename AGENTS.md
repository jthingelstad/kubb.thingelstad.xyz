# AGENTS.md: kubb.thingelstad.xyz

`CLAUDE.md` is a symlink to this file. Domain rules are in [`../AGENTS.md`](../AGENTS.md);
AWS and secret rules one level above that.

Kubb: Throwing Wood on the web: the Playdate game's own Lua core running in the browser,
with multiplayer on a link. The design is `docs/DESIGN.md`; read it first. The Playdate
game is the sibling checkout `../../playdate-kubb` (private; its `docs/DESIGN.md` and
`AGENTS.md` are the reference for how the game plays).

## Rules

- **`vendor/core/` is never edited.** It is `playdate-kubb/source/core` byte for byte
  (`npm run vendor:sync`, `npm run vendor:check`). Change the game's behaviour on the web
  by setting the core's `tune` tables from `lua/web/`, or fix it in playdate-kubb and
  sync. Never write in the playdate-kubb checkout from here.
- **Manage the repository as if it were public** (the Playdate game's rule): no email
  addresses, device serials, home-directory paths or secrets in files or commits. Write
  the AWS account as `<account>` in Markdown.
- **Game logic in Lua, tested on the desktop** (`/opt/homebrew/opt/lua@5.4/bin/lua5.4`);
  JavaScript draws, listens and talks to the network. JS and Lua exchange JSON strings in
  a few coarse calls a frame.
- **The thrower's view frame everywhere** (core/frame): JS never flips the pitch.
  The wide view (watching the computer) shows the world frame instead: Lua un-turns Team
  B's output before JS sees it (`lua/web/wide.lua`), so JS still flips nothing.
- Dev servers bind to 127.0.0.1 and are stopped when the work is done.
- No italics on sans-serif type. Type and tokens come from `../shared/`.

## Build and check

`npm ci`, then `npm run check` and `npm run format:check`. `check` runs, in order:
`vendor:check`, `shared:check`, the `infra/site.json` sync check, every `*.test.mjs` under
`tests/` with `node --test`, `tests/lua/run.lua` under Lua 5.4 (skipped with a notice when
there is none; `LUA=` picks the binary), the build, and `validate:site` (links and routes
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
  validation) in the `thingelstad.xyz` zone. Never edit those records in the console.
  Access logs go to `/kubb-xyz/web-access`, IP-free, kept 731 days. The viewer request
  function serves `/pitch/index.html` for every `/p/<code>` (codes as the rooms accept
  them: 8 to 24 of `abcdefghjkmnpqrstuvwxyz23456789`). It also owns the bucket for the
  rooms function's code, and, with `"wsRoute": true` in `infra/deployment.json`, the `/ws`
  route that sends the WebSocket on to the rooms API under the same web ACL.
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
- Merging to `main` deploys: CI builds with `KUBB_PRODUCTION=true` (production rooms
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
  physics change in `vendor/core/` those are the throws that now go differently.
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
view `lua/web/wide.lua` un-turns them into the world frame in Lua, so JS still never
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
(`lua/web/replay.lua`, `src/replay/player.js`), in the wide view at the match's own pace,
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
- Replays are never served from the private games bucket.

## Score sheet

MENU, SCORE SHEET (any match, not practice) and SCORE SHEET on the winner card show the
match's Planet Kubb Notation game file, positions hidden until SHOW POSITIONS, with COPY,
DOWNLOAD (`.txt`) and a link to the notation page (`src/ui/sheet.js`, docs/CLIENT.md).

## Analytics

Tinylytics, `script.js` form, only in the deploy build (`KUBB_PRODUCTION=true`) and only
on the production hostname (`public/js/analytics.js` checks it in the browser). The site id
is `TINYLYTICS_SITE` in `src/site/site.mjs`; while it is `null` no script is added.

## Pitch lines

Thin on purpose (Jamie, 2026-11-16: "in Kubb, the concept is that there really is no
line. The line is just a visual indicator. So it should be much thinner"):
`render/world.js` `tune.lineWidth` 1.2 cm on the ground, never under 0.6 frame px. The
Playdate's 2 px lines (DESIGN 6) are its 1-bit screen's, not the web's.
