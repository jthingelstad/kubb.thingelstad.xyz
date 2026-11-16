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
(`backend/rooms/recorder.mjs`, `docs/ROOMS.md` section 7). The names players typed are in
them: records are pulled to `build/games/` (never in git) and never published. The home
page says that matches are recorded. The practice pitch has no room and is not recorded.

- `npm run games:pull` (as `cloud-engineer`) fetches new records; `--room <code>`,
  `--since <date>`.
- `npm run games:replay` plays every recorded match through this checkout's engine and
  says which actions end on another hash than the players' browsers committed. After a
  physics change in `vendor/core/` those are the throws that now go differently.

## Analytics

Tinylytics, `script.js` form, only in the deploy build (`KUBB_PRODUCTION=true`) and only
on the production hostname (`public/js/analytics.js` checks it in the browser). The site id
is `TINYLYTICS_SITE` in `src/site/site.mjs`; while it is `null` no script is added.
