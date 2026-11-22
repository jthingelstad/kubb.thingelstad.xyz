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
  the engine's manifest). **An engine is carried only while we decide it is supported,
  not because it was once released** (the owner, 2026-11-21: "We should only support
  engines that we decide are worth supporting not just ones that have published so that
  we can push players to the new engines."). Today that is the newest alone, 0.13
  (0.13.4); 0.9, 0.8 and 0.7 were dropped on 2026-11-21, so a client on one of them (an
  iPhone build on 0.9) cannot share a pitch with the web and is told to update, and a
  kept match of one says it can no longer be replayed (`docs/ENGINES.md`). The supported
  set is written in one place, `vendor/engine.json` (the newest and `older`, empty
  today), read by the build, the registry and the reels' `REEL_ENGINES`; carrying an
  older minor again would be its own decision, vendored into `vendor/engines/<mm>/`. A
  new minor is vendored with `--keep` or `--drop`, never by accident. The bridge says
  `pitch.`, the engine's own spelling since 0.13. Never write in the kubb-engine or
  playdate-kubb checkouts from here. wasmoon stays pinned at exactly 1.16.0.
- **This repository is public.** Keep email addresses, device serials, home-directory
  paths and secrets out of files and commits. Write
  the AWS account as `<account>` in Markdown.
- **Game logic in Lua, in kubb-engine** (tested there); this repository has no Lua of its
  own. JavaScript draws, listens and talks to the network. JS and Lua exchange JSON strings in
  a few coarse calls a frame.
- **Room rules are the engine's too.** `src/net/lobby.js`, `seats.js` and `sync.js`
  are thin wrappers over `pitch.*` (the engine's docs/PITCH.md), reading `.value` through
  `src/net/room-engine.js`. Initialize with `useRoomEngine` (the newest engine) before
  calling them; a call that names a major.minor goes to that carried engine. Pass
  connected ids as an array, and keep seat/actor calls cached out of the render loop.
  Keep the aim's pacing (`src/net/aim.js`) and the socket (`src/net/pitch-client.js`) in
  JavaScript. `me.engine` announces the room's
  engine marked `+engines` and `me.engines` all the page carries (`room.announce`, re-sent
  on member, seat and host changes); START runs on the room's engine (`room.engineFor`,
  checked again inside the write) with `room.speakAs` members and writes `match.engine`;
  a match plays only on `match.engine`; `mayPlay` gates team and CPU control.
  `LENIENT_ENGINES` is false. Playing requires a named, matching major.minor.
  Read a pitch's options with `optionsOf(doc)` (the engine's `room.optionsOf` since 0.9,
  which adds the computer's level and the scene from the document's `settings`; else
  `lobbyOf(doc).options`), and draw the lobby's rows from the room engine's
  `MATCH_OPTIONS`, so a row an older engine lacks is not shown.
- **The thrower's view frame everywhere** (core/frame): JS never flips the pitch.
  The wide view (watching the computer) shows the world frame instead: Lua un-turns Team
  B's output before JS sees it (the engine's `session/wide.lua`), so JS still flips nothing.
- Dev servers bind to 127.0.0.1 and are stopped when the work is done.
- No italics on sans-serif type. Type and tokens come from `../../thingelstad.com/shared/`.

## The site

throwingwood.com is the landing site for the whole game (Jamie, 2026-11-20: "We need to
separately land the throwingwood.com website as a real landing page for the game, not just
the game."). Since the Throwing Wood 1.0 design (2026-11-21) `/` is the one landing page
and the web game's page with it: PLAY NOW in the hero, then under `#play` Play the
computer, Start a pitch (with Who can join), Practice, Watch the computer, Settings and
the open games, Throw by feel, iPhone and Playdate, and the newsletter block. It is still a
reading page, never the game or its lobby (a site check holds it to that). `/web/`, the
web game's page until then, answers 301 to `/#play` (`infra/viewer-request.js`), and every
in-game HOME names `/#play` itself. PLAY NOW (`playNow` in
`src/site/landing.mjs`, also on `/engine/`) opens `/p/<code>?solo=1&play=1`: a device with
no kept match options starts at once on Park, a Beginner computer, 2-4-6, raising by
hand and no wind (`FIRST_MATCH`, `soloKept` in `src/ui/cards.js`; `startSolo` in
`src/main.js`), one that has played gets the options card. The header is Play, iPhone,
Playdate, How to play; the footer Rules, The engine, Kubb sites we love, Newsletter,
Support (`/ios/#support`), Privacy and the version (`NAV`, `FOOT_NAV` in
`src/site/layout.mjs`). `public/style.css` holds the 1.0 system's tokens: round corners
(6 px controls, 8 px cards), a 3 px ink line, 3 px and 5 px shadows, marigold the one go
colour (`.button--start`, one per page), wood for bands only. `/ios/`, `/playdate/`,
`/engine/` and `/love/` are the other landing pages (`src/site/landing.mjs`; `/rules/`,
`/privacy/` and the game pages are in `src/site/pages.mjs`). A path without its trailing
slash answers with a 301 to the slashed one. `/love/` lists the five kubb sites Jamie named, in his order, under his heading; a
check pins the names, URLs and order. `TESTFLIGHT_URL` in `src/site/site.mjs` is the one
switch for `/ios/`: set, the page shows "Join the TestFlight"; empty, it says the beta is
by invitation and shows no button. `APP_STORE_URL` beside it is the store badge's switch:
empty (until the app is live), / and /ios/ keep the TestFlight wording; set, they show
Apple's badge (`storeLink`), whose artwork goes in at `APP_STORE_BADGE` with it. `/ios/`
has `#privacy` for the App Store listing's link, and `#support` only once
`SUPPORT_TEXT` in `src/site/site.mjs` is set (the support words are the owner's to
give; empty today, so there is no Support section and no footer Support link). Every claim on `/engine/` has a source in the engine's
docs or tests; keep it that way. The pages announce nothing that is not live: no dates,
no store, no features in progress.

`/playdate/` shows the Playdate game's reel and installs it on the page itself (Jamie,
2026-11-20: "do not require people to go to the playdate site to download and install…
reference the same file on that page"). The reel, its poster, the screens and the
download are not copies: they are the Playdate games site's own files, by their URLs
there (`PLAYDATE_REEL`, `PLAYDATE_BUILD` in `src/site/landing.mjs`), and the CSP allows
that one origin for `img-src` and `media-src` only (`PLAYDATE_SITE` in
`src/site/csp.mjs`). When that site moves to a new build, set `PLAYDATE_BUILD` to its URL,
size and notes; the version on the page is read from the file's name. The reel plays
muted on a loop only without reduced motion (`public/js/reel.js`); in the markup it has
no autoplay.

The newsletter sign-up (Jamie, 2026-11-20: "Here is mailing list subscribe information
for the website. Use the link or modify the embed however you wish.") is one block,
`signup()` in `src/site/newsletter.mjs`: big at the end of `/` (kept there with the 1.0
design: the owner, 2026-11-21, "Keep the block"), small at the foot of `/ios/`,
`/playdate/` and `/engine/` (`NEWSLETTER_PAGES`; a site check pins them), and
"Newsletter" in the footer. It is a plain form that posts the one `email`
field to Buttondown and lands on Buttondown's own page in the same tab: no script, no
analytics event, nothing kept by the site. `NEWSLETTER_LIST` in `src/site/site.mjs` is the
one switch (the list's page, the form's action and the "Powered by Buttondown." referral
link follow from it). The site's CSP has `form-action 'self' https://buttondown.com`
(`FORM_SITE` in `src/site/csp.mjs`); the embed keeps `form-action 'self'`. `/privacy/`
"The newsletter" says where the address goes. Never test it by signing up: that writes
to the live list.

## Build and check

`npm ci`, then `npm run check` and `npm run format:check`. `check` runs, in order:
`vendor:check`, `shared:check`, the `infra/site.json` sync check, every `*.test.mjs` under
`tests/` with `node --test` (among them the engine's golden corpus under this wasmoon and
the kept replay fixture: `node tools/replay-fixture.mjs` writes it again), the build, and `validate:site` (links and routes
resolve through the real viewer request function, required tags, no inline script, no email
address or home path in `dist/`, no account id in Markdown).

- `npm run build` writes `dist/`: `public/`, the client bundled by esbuild from
  `src/main.js` into `dist/assets/` (hashed names, source maps), wasmoon's `glue.wasm` and
  the Lua sources (`tools/lua-bundle.mjs` writes `build/lua-sources-<major.minor>.json`, one
  per carried engine) as hashed assets,
  and the pages from `src/site/`. The game pages carry the client's settings as a JSON
  block, `<script type="application/json" id="kubb-config">`, read by
  `readConfig()` in `src/site/config.js` (its comment is the shape). No inline scripts: the
  CSP allows none.
- `npm run preview` serves `dist/` on 127.0.0.1:4322 through `infra/viewer-request.js`, so
  `/p/<code>` works as it does live. `npm run dev` rebuilds on every change and also runs
  the pitch server, `wrangler dev` from `backend/pitch-server/` on ws://127.0.0.1:8797
  (after `npm ci --prefix backend/pitch-server`; without it, the pitch core in Node), and
  the api stand-in on 127.0.0.1:8798 (`tools/pitch-dev.mjs --api-only`), which takes the
  pitch server's pushes and answers the page's `/api/*`. Ctrl-C stops all of it.
- `infra/site.json` carries `infra/viewer-request.js` and the CSP from `src/site/csp.mjs`
  as copies; `node tools/site-template.mjs` writes them in (infra:plan does it too) and the
  check fails on drift. Edit the sources, never the copies.
- `npm run images` redraws the share image and icons from `src/site/art.mjs` (Playwright's
  Chromium); the PNGs are committed.
- Prettier formats everything but `vendor/`, `dist/`, `build/` and the vendored copies.

## The version

`package.json`'s `version` is the web app's version. Every app shows its own version with
the Kubb Engine's beside it (Jamie, 2026-11-20): on the web the label is that version and
the full version of the newest engine the site carries, `0.13.0 (0.13.4)`, at the foot of
every reading page and of MENU, with "Also plays ..." under it in MENU only while older
engines are carried (none today) (`src/site/release.js`, docs/CLIENT.md "Version and freshness"). The
deployed commit stays the exact identity (freshness, reports) and is never in the label.
The app's version never goes on the room wire, the rider or a kept match, replay, embed,
share or reel: those name only the engine a match was played on.

Bump it by hand in the pull request that changes what a player gets: the minor for a
feature or a new engine minor (`--keep` or `--drop`), the patch for a fix. A pull request
that changes nothing a player sees or plays leaves it alone. Nothing enforces it per pull
request.

## Hosting

Naming (Jamie, 2026-11-21: "abandon the xyz nomenclature. This is now Throwing Wood."):
every new AWS resource is `throwing-wood-*` (`tw` where a short prefix is needed); the
`kubb-xyz` names below go as the things that carry them are replaced, never by a rename
of a live resource. A site check holds new templates and tools to it.

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
  function serves `/pitch/index.html` for every `/p/<code>` (codes as the api accepts
  them: 8 to 24 of `abcdefghjkmnpqrstuvwxyz23456789`). It also owns the bucket for the
  functions' code, and the `/api/*` route to `throwing-wood-api` under the same web ACL.
- The site stack also holds the pitch pages function, `kubb-xyz-site-pages` (a Lambda
  Web Function, `backend/pages/`): CloudFront sends `/p/*`, `/e/*` and `/og/*` to it, after
  the viewer request function has turned them into `/pitch/index.html`,
  `/embed/index.html` and `/share/kubb.png` with `?pitch=<code>`. It reads one pitch's
  records (and its kept replay) from the pitches table with `GetItem`, nothing else, and
  writes that pitch's share tags into the page or draws its share image. The bucket is the
  origin group's second member: when the function fails, or the stack has no function,
  the static page and image are served as before. `npm run infra:apply -- site` bundles it
  (`tools/pages-bundle.mjs`, `pages/<sha256>.zip` in the code bucket) and passes the
  pitches table's name; `tools/deploy.mjs` only says when the live bundle is behind.
- Live play (since 2026-11-21) is the pitch server on Cloudflare Durable Objects, with
  everything else kept in AWS (`docs/PITCH-SERVER.md`): the pitch core, pure logic with
  no Cloudflare APIs (`backend/pitch-server/core.mjs`, its wire protocol
  `backend/pitch-server/PROTOCOL.md`, tests in `tests/pitch-server/`), and the Worker with
  `PitchDO` and `LobbyDO` over it (`backend/pitch-server/src/`, its Workers-pool tests in
  `backend/pitch-server/test/`, run by the `check` job; production Worker
  `throwingwood-pitches`, dev `throwingwood-pitches-dev`, not deployed by a merge:
  `backend/pitch-server/deploy.sh production` or `dev`, which needs no 1Password and no
  person: it reads `PUSH_SECRET` and the dev `DEV_KEY` from Secrets Manager as
  `cloud-engineer` into its own environment and hands `cf deploy` a file of references,
  so no secret is written to disk; `backend/pitch-server/README.md`). The older way
  renders `.dev.vars` and `.prod.vars` from the committed templates with 1Password
  (`op inject`); those files are gitignored and never committed. The AWS function the pitch server pushes to and
  the apps call over HTTPS is `throwing-wood-api` (`backend/api/`, contract
  `backend/api/API.md`, tests in `tests/api/`).
- `infra/pitches.json` (stack `throwing-wood-pitches`, created 2026-11-21): that function,
  its URL, role, logs and push secret, the dev Worker's key, and its own table and private
  games bucket, behind
  `"pitchesStack"` in `infra/deployment.json` (on). The old WebSocket rooms stack, its
  table and its games bucket were deleted on 2026-11-21 with every old stored game
  (`docs/PITCH-SERVER.md` section 12); `docs/ROOMS.md` is kept as the record.
- `infra/delivery.json` (stack `kubb-xyz-delivery`): the GitHub OIDC role `main` deploys
  with: the site bucket, invalidations, and `throwing-wood-api`'s code.
- Change infrastructure with `npm run infra:plan` then `npm run infra:apply` as the
  `cloud-engineer` profile (`AWS_PROFILE=cloud-engineer`); both run through change sets and
  rewrite `infra/deployment.json`. Name the stack on every run (`-- site`, `-- pitches`,
  `-- delivery`). A plan leaves nothing behind.
- Changes to `main` require a pull request with a passing `check` job on an up-to-date branch.
  Merging to `main` deploys: CI builds with `KUBB_PRODUCTION=true` (the production
  pitch server and api addresses, analytics), `tools/deploy.mjs` uploads, invalidates, compares the live bytes and
  the wasm content type, and updates `throwing-wood-api`'s code when its bundle changed.
  Roll back by reverting. The same script publishes by hand as `cloud-engineer`.

## Names

No name is typed anywhere (the owner, 2026-11-21, for the iPhone's App Store review: a
typed name is seen by others in a pitch and on public replays, which counts as
user-generated content). Every player and team name is a generated one, made from the
engine's word lists (the engine's docs/NAMES.md, its docs/SESSION.md "Names"); the word
lists are the content policy. docs/CLIENT.md "Names" and docs/MULTIPLAYER.md "Names" have
the details.

- **The device's name** (`name` pref, `src/game/player-name.js` over the engine's
  `names.*` door, `src/game/names.js`): the first run rolls one from the browser's own
  randomness; a kept name that is not a generated one (a typed name from before) is
  replaced on load and never shown.
- **The name row** (`src/ui/name-row.js`), built once: the name and SHUFFLE on one line
  (SHUFFLE rolls a whole new name); in Settings only (MENU's SETTINGS and `/settings/`,
  which loads the engine for it) a stepper per word under it, previous, the word, next
  (`names.step`). No KEEP and no picker (the 1.0 design, the owner, 2026-11-21: "KEEP
  goes from the name row; the row is the name and SHUFFLE, word steppers only in
  Settings"). It is on the solo card, the lobby's "You are", the lobby's team names (the
  host's), the pitch link's welcome and the share card. Every name and word is measured
  in the game's fonts against `NAME_FIT` (`tests/game/names-fit-client.test.mjs`).
- **A team of several** plays under a team name the host rolls and picks in the lobby
  (the document's top-level `teamNames`, `setTeamName` in `src/net/lobby.js`); a side of
  one plays under its player's name. Two members with one name are told apart in the
  lobby only ("Mighty Maple II", `apartNames`).
- **The checks** (a client is not proof): a page never reads a snapshot's fields to
  judge names; the engine does (since 0.13.4). The lobby shows a name from the pitch's
  document and members only where `names.check({ document, members })` passes it, else
  the default for its place ("Player n", "Team A"/"Team B"); every snapshot from outside
  is adopted through the strict `restore` (`{ snap, names: "check" }`,
  `Engine.restoreChecked`, `Pitch.adoptSnap`) and every replay loaded with
  `names: "check"`, so a forged match or replay is not shown ("This match has a name the
  game did not make, so it cannot be shown."). The pitch server
  (`backend/pitch-server/names.mjs`, from `names-words.json`, which
  `tools/names-words.mjs` writes from the engine and `npm run check` holds to it) drops
  a failing `me.name` (never refusing the member) and refuses a lobby write or start
  that names one (`bad-name`); it cannot see into a snapshot, which is why the pages
  check. The share check runs `names.check` on the shared start and refuses
  `why: "name"`; a reel of a kept replay that fails is `failed`, `why: "names"`; the
  pitch pages leave a failing team name off.

## Recorded games

Every match is recorded (Jamie, 2026-11-15: "all games should be recorded so that we can
use it to test and improve the game"). The pitch server pushes every start and action of
a shared pitch to the api, which writes them to the private games bucket for good
(`backend/api/API.md`). Solo and watch matches have no
room: the browser sends each once when it ends (`src/net/record.js`, Jamie 2026-11-16:
"watch mode should record ... All games recorded"), kept under
`games/browser/<yyyy-mm-dd>/`. The players' names (generated names, "Names" above) are in them: records are pulled to
`build/games/` (never in git) and never published. The landing page's `#play` says that matches are recorded.
Practice is not recorded. The reading pages say only that matches are recorded to make the
game better, on purpose (Jamie, 2026-11-20: "privacy page can just say that matches are
recorded to improve the the game. we don't need to record iPhone against computer."): the
iPhone app records no match against the computer unless the player shares it.

- `npm run games:pull` (as `cloud-engineer`) fetches new records; `--room <code>`,
  `--since <date>`.
- `npm run games:replay` plays every recorded match through this checkout's engine (the
  match's own where the checkout carries it, else the newest; `docs/ENGINES.md`) and
  says which actions end on another hash than the players' browsers committed. After a
  new engine, `-- --engine <its major.minor>` lists the throws that now go differently.
  One-browser matches replay from their start against the hash after each action; after
  the first that differs the rest are unjudged.

## Reports

A player can say a throw looked wrong (Jamie, 2026-11-16: "Is it worth allowing,
particularly on the web, a specific 'report' action that the player can type what
happened and what should have happened so we can analyze? I think yes." and "Approved:
build the web report action in kubb.thingelstad.xyz with a private store on AWS for the
typed reports"), or tell us anything else (Jamie, 2026-11-19: "We have a way of reporting
physics issues via the app -- think we should allow reports of any feedback. Not just
physics."). MENU, SEND FEEDBACK, in every mode (practice, solo, watch, a shared pitch),
opens the "Send feedback" card with a choice: "A throw looked wrong" (the default when
the game has a last throw) asks "What happened?" and "What should have happened?" (1000
characters each, at least one) and lets the player mark pieces; "Something else" asks
"What would you like to tell us?" (one box, 2000 characters). SEND and CANCEL. Either
way the browser sends what was typed with the game as it stood when the card opened,
enough to play a reported throw again here (`src/net/report.js` says exactly what; no
name field, no contact field, no user agent, no member id). There is no reply channel:
the site promises none. It goes as one `report` message (`kind: "throw"` or
`"feedback"`; a message with no `kind` is a throw report, as older clients and the
iPhone app's current builds send) as `POST /api/report` (`backend/api/API.md`), which
writes one gzipped object to the private games bucket
under `reports/<yyyy-mm-dd>/`, kept for good like the games.

- Limits: 64 KB a report as ASCII JSON (history, then pieces, then the snapshot after
  are dropped to fit; what was typed, the snapshot before and the last action never),
  and the api function's 10 concurrent runs.
- `npm run reports:pull` (as `cloud-engineer`; `--since <date>`) copies new reports to
  `build/reports/` (never in git) and prints each: when, kind, mode, the two answers or
  the feedback's text, where the replayable state is. `npm run reports:show` prints those
  already pulled.
- `npm run reports:replay -- <file>` says a feedback report with no throw in it has
  nothing to replay; otherwise it plays the report's last action from the snapshot
  before it through this checkout's engine (the report's own where carried; `--engine`
  picks one) (and the whole match from its start when the
  report carries it; practice from its options and steps), says whether it ends where the
  player's browser did, and prints the last throw's result and where the pieces lie.

## Watch the computer

`/p/<code>?watch=1` (the landing page's `#play`: "watch the computer", added 2026-11-16 on Jamie's ask: "I
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
(the `watchView` pref). A watcher may fly round it with the free camera (Observer mode,
below), and a phone held upright keeps the wide view. Played matches keep the thrower's
view. docs/CLIENT.md "The wide view".

## Observer mode

Anyone can watch a shared pitch without taking a seat (Jamie, 2026-11-20: "I want to
allow an observer to view open games that people are playing ... In observer mode you
should be able to fly around and position your view wherever you want to be."):
`/p/<code>?observe=1`, WATCH beside JOIN on the open games list. It joins the pitch with
`role: "observer"` (so the lobby's Watching line names it), is in step at once from the
pitch's snapshot, and never acts, writes the document, shouts or hosts (the pitch server
hands the host only to players). Between matches it has its own card
(`src/ui/watching.js`). Every watcher, an observer, a member with no side, watching the
computer and a replay outside the embed, gets the free camera in the wide view (drag,
wheel, two fingers, keys, RESET VIEW; `src/render/freecam.js`,
`src/game/free-camera.js`, `src/ui/watch-view.js`). Players keep their view. No engine
change. Controls, limits, what it cannot do and the notes for the iPhone
port: `docs/OBSERVER.md`.

## Open games

A host can make a pitch open (Jamie, 2026-11-16: "allow a game to be created open so it
can be joined by anyone ... Open and invite only are both supported"): the lobby's "Who
can join" (Invite only, the default, or Open), or Open on the web game's page's start step
(`?open=1`). The landing page lists open games under "Open games" (`public/js/open-games.js`):
counts, state and age only, never names, the 20 newest, refreshed every 30 s, each with
JOIN and WATCH (Observer mode). The host's
browser tells the pitch server what to list (`docs/MULTIPLAYER.md`), and the page reads
the list from the pitch server's `GET /open` (`backend/pitch-server/PROTOCOL.md`).

## The welcome

A device that has never played opening someone else's pitch link sees one card before the
lobby (the 1.0 design): who invited them, the landing page's two sentences on kubb, their
generated name with SHUFFLE, JOIN THE GAME, and the quiet JUST WATCH (the link as an
observer) and HOW TO THROW. The host who made the pitch, and a device with a throw of its
own kept (`throwsMade`), go straight to the lobby. `src/ui/welcome.js` (its words in
`WELCOME_WORDS`), docs/MULTIPLAYER.md "The welcome".

## Replays

A finished pitch can be watched again (Jamie, 2026-11-16: "When a game is finished playing
on a pitch I'd like the URL to allow people to come and watch a replay of the match.").
The match is played again from its start, action by action, on its own engine
(the engine's `session/replay.lua`, `src/replay/player.js`), in the wide view at the match's own pace,
with play/pause, NEXT THROW, BACK, 1X 2X 4X and the score sheet beside it. The winner card
and anyone who opens the link after the end get WATCH REPLAY; after a rematch the lobby
offers WATCH THE LAST MATCH. A replay belongs to nobody: the engine refuses every action
from outside while one is loaded. A match made on an engine the site no longer carries
is not played: wherever it can be opened (WATCH REPLAY, WATCH THE LAST MATCH, a shared
match's page, the embed) one sentence says "This match was made on an older version of
the game and can no longer be replayed.", and a shared match's reel, a stored video, is
still offered (`docs/ENGINES.md` "Looking back at a match").

- The pitch server keeps the match's log while it is played; the host sends `meta` (what
  a replay needs besides the actions) with START, and the action that ends the match
  goes with `over`. The pitch server then pushes the log and the final snapshot to the
  api, which keeps the replay a year (`docs/MULTIPLAYER.md` "The document",
  `backend/api/API.md`). No browser uploads a replay. Old matches show the result without
  WATCH REPLAY.
- Anyone can fetch a kept replay by its code without joining (`GET /api/replay`,
  `src/replay/fetch.js`); `startReplay({ code, game, root })` needs nothing of the pitch
  page, so an embed or a share image can build on the two.
- Replays are never served from the private games bucket.

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
reflect the game that it is linked to?"), from the moment it is made (the 1.0 design): the
pitch server pushes `open` with the maker's checked name when the pitch is made
(`backend/pitch-server/PROTOCOL.md` "Pushes"), the api keeps it as the pitch's `open`
item (`backend/api/API.md`), and a pitch with no match yet is "Cheerful Cedar is waiting
for players" with that name on its card. The plates are round (8 px at 1200 wide) and the
state line says TAP TO WATCH where there is a match to watch ("IN PLAY · TURN 7 · TAP TO
WATCH"). The api must take `open` before a pitch server that sends it is deployed. The
pitch pages function writes the title
("Mighty Maple vs Lucky Larch · Kubb: Throwing Wood"), a description of its state
("Waiting for players. Join the pitch.", "In play: turn 7", "Final: Lucky Larch won, 1 to
0, in 9 turns. Watch the replay.") and `/og/<code>.png?v=<version>` into `/p/<code>` and `/e/<code>`. The image
(1200×630, `pitchCardImage` in `src/site/art.mjs`, drawn with resvg) has the team names,
the state and the pitch from above with its pieces where they stand. Team names come from
the match, each checked as the pitch server checks it (a team name the game did not make
is left off: the side is "Team A" or "Team B"); a waiting pitch has none yet, so it is its
maker's name, checked the same way, or "A pitch waiting for players" without one. No names of players, member ids, open-game listing or games
bucket. Anything that fails gives the
static title, description and share image, never an error page.

`robots.txt` (`src/site/robots.mjs`; Jamie, 2026-11-20: "we should block robots from
crawling the URL's for saved games and replays via robots.txt") disallows `/p/`, `/e/`,
`/og/`, `/reels/`, `/pitch/` and `/embed/` for every crawler, and gives the link-preview
fetchers (`PREVIEW_AGENTS`: Twitterbot, facebookexternalhit, LinkedInBot, Slackbot,
Discordbot and the rest) a group of their own that allows all, so a pasted pitch link
still shows its card. A crawler obeys only the most specific group naming it, so that
group stands alone. The pages keep their `noindex` for the fetchers let in.

## Highlight reels

A finished online pitch can have a highlight reel: a short video of its best throws,
tall (1080x1920) and wide (1920x1080), made on the server from the kept replay with this
engine. Jamie, 2026-11-19: "Approved: build the highlight reel feature as designed in
docs/REEL.md, including its AWS resources in the throwingwood.com web stack". The design
is `docs/REEL.md`, the calls `backend/api/API.md`, deploying, checking and
rolling back `docs/REEL-RUNBOOK.md`. The browser's button and card for online pitches
are `src/ui/reel.js` over `src/net/reel.js` (docs/CLIENT.md "Highlight reels"), and the
web game's and privacy pages say what a reel shows. A match against the computer gets one once
shared: the server side (`share`, the renderer's `{ check: g }` in
`backend/reels/check.mjs`; `backend/api/API.md`), and the browser's
share card on the solo winner card and a sealed pitch's page (`src/ui/share.js` over
`src/net/share.js`, `Pitch.showSealed`; docs/CLIENT.md "Sharing a match"). The share
card's words are a contract with the iPhone (docs/REEL.md "The share card"). The iPhone
app has both cards too (2026-11-20, in `../throwingwood-ios`: its `docs/ONLINE.md`), and
sends the same `reel` and `share` messages.

- `backend/reels/`: the renderer (`render.mjs` over `scan`, `highlights`, `cameras`,
  `overlay`, `audio`), the job (`job.mjs`: try, read the replay, refuse another engine,
  render, upload, mark done), its AWS adapters (`aws.mjs`) and the Lambda entry
  (`handler.mjs`). `tools/reel/render.mjs` is the same renderer from the command line,
  with contact sheets.
- The api function answers `POST /api/reel` `{ pitch }` from anyone and starts at most
  one render a kept replay (`pitch#<code> | reel`, a conditional put), invoking
  `kubb-xyz-site-reels` asynchronously. It renders a match, and checks a shared one,
  only on the match's own engine: its major.minor must be one the function carries
  (`REEL_ENGINES`: every engine the site carries, newest first, one Lua bundle each in
  the package; `docs/REEL.md` "Engines"). Adding an engine is site stack, then pitches
  (`docs/REEL-RUNBOOK.md` "Adding or dropping an engine").
- Caps: 200 renders a UTC day for the whole site (a counter
  item), a render left `rendering` 25 minutes may be started again, keeping its tries:
  a job renders twice at most in all, Lambda's retry included; `failed` is final for
  that version. A match with no throw, or no moment to show, is `failed` with
  `why: "empty"` at once. The function runs two at a time.
- The site stack holds the function (`infra/site.json`, Node 24, arm64, 3008 MB, 5
  minutes, one retry) and its ffmpeg layer, both packaged by `tools/reels-bundle.mjs`
  (`npm run reels:bundle`) from `infra/reels-pins.json`: a static ffmpeg 7.0.2 (GPL v3,
  its licence in the layer) and `@napi-rs/canvas`'s Linux arm64 binary, each checked
  against its pinned digest. `"reelRenderer": true` in `infra/deployment.json` turns it
  on; `infra:apply -- site`, then `-- pitches`. Its role reads only the replay's
  attributes and updates only the reel item's, and puts only under `reels/` in the
  site bucket. `tools/deploy.mjs` never writes there; a lifecycle rule expires it after
  366 days.
- `/p/<code>` gains `og:video` (the wide MP4) and "Watch the highlights." when its
  reel is done (`backend/pages/pitch.mjs`).
- `npm run dev` renders no reels: the api stand-in answers `reel` as unavailable (a test
  can pass its own `startReel` to `startPitchServer`). Shares are checked locally.

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
visually looked janky"): where a screen cannot give the track `minTravel` (320 upright,
`wideMinTravel` 210 on a wide screen) the clock is drawn instead. The wide floor is
lower than the iPhone app's 260 pt by Jamie's word (2026-11-20, of a 6.1-inch iPhone in
Safari with its bars showing, whose 230 px track got the clock: "Yes lower the linear track
for that one. It doesn't have to be same size for all. Diff phone size can change it."):
210 keeps 20 px under that phone, and the mini (215) keeps it too. The app is unchanged:
every iPhone on its side gives it at least 265 pt. The choice holds when
the phone turns (Jamie, 2026-11-19, of the iPhone app: "Bug: On iPhone if I turn on linear
and then rotate it goes back to the circular swing."): on a wide screen the box has the
whole safe height at its edge (10 px under the safe top to 7 px over the safe bottom, at
most 450), MENU or the rail moves in beside it, 10 px off its body (`meterRoom`), the coach
line hangs under its tab, the plan block never goes over the tab (`planAt`: the far edge,
the minimap over the block or not drawn; where nothing fits, or the header row's
plates would meet, `headerPlates`, the clock: windows under about 580 px), and a finger grabs only the knob's channel, the
rest of the body and the meter's half being throw zone. Keep these numbers the iPhone
app's (`WideLayout`), all but that floor; a desktop window tall enough for the 450 px box is as before. It
is a quarter shorter than it was first built (a tester, 2026-11-19: "Make it 1/4
shorter", and Jamie agreed): 47% of a tall screen, 390 to 450 px, its foot where the
thumb is. docs/CLIENT.md "The throw".

The finger and the meter apart (Jamie, 2026-11-19: "if you can have the control and the
touch be slightly distant from each other, that could make that better"): with the linear
meter on the screen a drag in the throw zone (the lower 40% of the canvas, where there is
nothing to aim at; with a finger on a wide screen, the meter's half) strokes the knob as
a grab of it does, and a tap there still aims; on touch a press outside the clock's
ring, out to 2.1 radii, turns the arm as the ring does
(where a tap there could aim, only a drag does, and a tap still aims),
and on a touchscreen held upright the clock is 13% smaller and raised so a finger can go
all the way round outside its rim. A press on the ring is exactly as before. MENU, Meter side
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

The coach line (a tester, 2026-11-19: "Does it matter how quickly or slowly I track my
finger"; Jamie: "Have the UI show it not a separate how to page"): over the meter's prompt,
for a device with fewer than 3 throws and for the throw after a SLOW verdict, a line that
follows the stroke: PULL BACK TO THE ORANGE MARK, NO RUSH GOING BACK, NOW FLICK FAST AND
STOP ON THE BLUE MARK, led by SLOW FLICK. FLICK FASTER. after a slow one. The pull back's
speed does not matter; the flick's does. `src/game/coach.js` (pure); drawing only.
The red overpowered zone starts past the power band when the band reaches past 11
o'clock (`dial.js` `overFrom`), as the engine's overpower cost does.

## Raising

A player can hand the raising to the engine mid-match (Jamie, 2026-11-19: "When raising
kubbs we have three options today including an auto, we should also add an "auto all". In
fact I could see players wanting to shift to auto raise kubbs for the rest of the game.").
The raise panel has END 1, END 2, AUTO (this kubb) and AUTO ALL (the rest of this turn's);
REST OF GAME on the panel makes every raise automatic for the rest of the match, and BY
HAND takes it back; MENU's Raising row (By hand, Automatic; the 1.0 design put it in the
menu) is the same choice. It is the player's own choice on a match that raises
by hand, kept only for that match: `src/game/auto-raise.js`, docs/CLIENT.md "Match flow".
The panel keeps two slots in every state (the 1.0 design): the automatic choices plain at
the left, the one confirming action (PLACE IT) go at the right.

By hand, the player touches the kubb itself (Jamie, 2026-11-19: "similar to on the
Playdate where you can use the crank to raise the kubbs, on touch, you should be able to
just touch the kubb and raise it. That would be more intuitive."). A tap or click anywhere
on the drawn kubb, or within 24 px of it, stands it on the nearer end; a tap on an end's
number still takes that end. A drag that starts on the kubb tips it up toward the end the
finger moves to, drawn as the engine's own crank tip; let go past half way and it stands,
short of that nothing is sent. An end the rules refuse is never chosen: the allowed end
lights for a second instead. END 1 and END 2 stay on the panel for the keyboard and screen
readers only (hidden until focused), and the canvas names the ends. The engine gets the
same `raise` action either way: `src/game/raise-touch.js`, docs/CLIENT.md "Match flow".

## Controls are the web's own

Jamie, 2026-11-19: "Can you audit the control surface from a broader level that would
catch these type of odd engagements. It is all a hangover from us starting on play
date". Each control is designed for the finger or the mouse first: a value has one
control that shows it, what a control does is shown on it while it is used (never on a
separate how-to page), no mode switch exists because the Playdate had a held button, and
labels are plain words.

- **STAND** replaced WALK (the Playdate's held A, which made the next drag on the pitch a
  joystick). The thrower's spot is below the screen in the thrower's view, so there is
  nothing on the pitch to drag: STAND is a plate in the plan, the line from above with
  the allowed ground and a ring where the thrower stands. Press and drag puts the thrower
  under the finger; the engine's `setStance` clamps it. A/D/W/S and STAND's arrow keys
  still walk. `src/game/stand-pad.js`, docs/CLIENT.md "Standing".
- **Two hands on a phone on its side** (Jamie, 2026-11-19: "in landscape the tilt, arc,
  stand controls should be pushed to the left hand side of the screen so the user can
  control those with the left hand and the throw with the right hand"). On a wide
  touchscreen the plan block is at the edge away from the meter (the right edge with
  Meter side, Left), the minimap on its inner side; a mouse keeps it beside the meter.
  `planAt` in `src/game/layout.js`, docs/CLIENT.md "The plan block on a wide screen".
- Practice's tray is BATONS | KUBBS, the one in use pressed (it was one button naming the
  other mode). The rail counts in words ("5 BASE KUBBS", "TARGET 2.3 M"), not the
  engine's Playdate "BASE 5" (`railCount` in `src/game/hud.js`).
- MENU (a word in the header's plate since the 1.0 design) is a two by two grid,
  SETTINGS, SCORE SHEET, HOW TO THROW and FEEDBACK, then Raising (a match by hand), View
  (watching), Surface and Scene (practice), BACK TO THE MATCH, RESIGN and HOME. Its rows
  and Settings' say what they set and show their value as a segmented bar: Your name (the
  name row), Sound (On/Off, once a SOUND: ON button), Meter, Meter side. docs/CLIENT.md
  "Match flow" and "The 1.0 system".
- **Settings by scope** (the owner's settings sheet, 2026-11-20). Device settings (your
  name, meter, meter side, sound) are one set of rows (`src/ui/settings.js`), the Settings
  card, from MENU's SETTINGS in every mode and on `/settings/`, linked from the web game's
  page, closing with DONE at the bottom right;
  never asked per match. Game settings (Computer level, surface, opening, raising, wind,
  kubb set, scene, who can join) are on the solo card, the practice MENU (surface,
  scene) and the lobby only. Turn and throw settings (stand, spin; arc, tilt) are on the
  throw controls. Your name is the device's generated name, picked in the name row
  wherever it is shown (Settings, the solo card's and the lobby's You row): "Names"
  below. docs/CLIENT.md "Settings".
- **One level: the computer's** (the owner, 2026-11-21, with engine 0.13: "player level
  really should only mean for the computer opponent. It doesn't mean anything for the
  human player."). From engine 0.13 every person throws on one meter, the bars going by
  the throw's distance, so the web asks nobody for their own level: MENU's Your level
  row and the solo card's and lobby's "Throwing at ..." line are gone, and the You row
  is the name alone. A device's stored level (`level` pref) is still read, passed and
  kept, never reset (`src/game/throw-level.js`): it changes nothing on 0.13, and the
  site no longer carries the 0.9 engine where it counted. The computer's level is a match option, Computer level, on
  the solo card and, set by the host, in the lobby of a pitch on 0.9 or newer.
- **Sliders, not step buttons** (Jamie: "the finger must not cover the control; teach on
  the control"). From engine 0.9 ARC, TILT and SPIN take any value in `aim.controls`'
  range (`setArc`, `setTilt`, `setSpin`), ticks drawn from `tick`; a kubb's spin is kept
  for the turn and nothing on the page resets it. (The step buttons were for 0.8 and
  0.7, no longer carried.)
- **Scenes** (Jamie, 2026-11-20: "i absolutely adore the two new scenes! lets make it
  real"). A scene is a look only: Day, Night and Neon, a match option, Scene, from engine
  0.9 (the engine keeps the id in `settings.scene` and `view.scene` and never reads it).
  The names a player sees are one table, `SCENE_NAMES` in `src/render/scenes.js`: the 1.0
  design shows them as Park, Camping and Techno, and whether that is 1.0 or later is the
  owner's to decide, so they stay Day, Night and Neon until then. The solo card has them
  as three picture tiles drawn by the game (`Game.sceneThumb`) and decides the kubb set
  by them (no Kubbs row since the 1.0 design: the night and the neon play their own
  sets, the day Classic; the lobby leaves the row out too); watching the computer takes
  the card's; MENU has it on the
  practice pitch, and the host sets it in the lobby of a pitch whose next match runs on
  0.9 or newer (every engine the site carries). The pitch behind the card
  or lobby shows the pick. Every surface draws a match through one `Stage`
  (`src/render/scenes.js`): play, replay, embed and the reel. An id the web does not
  draw is the day. `?scene=` picks one off a pitch, never on one. Batons stay plain.
  docs/SCENES.md.
- The web game's page and the rules page describe the web's controls in their own words, with one line
  that it is the same game as on Playdate and iPhone.

## Pitch lines

Thin on purpose (Jamie, 2026-11-16: "in Kubb, the concept is that there really is no
line. The line is just a visual indicator. So it should be much thinner"):
`render/world.js` `tune.lineWidth` 1.2 cm on the ground, never under 0.6 frame px. The
Playdate's 2 px lines (DESIGN 6) are its 1-bit screen's, not the web's.
