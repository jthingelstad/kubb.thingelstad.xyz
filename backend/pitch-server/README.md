# The pitch server

Live pitches on Cloudflare Durable Objects (the plan: `docs/PITCH-SERVER.md`; the wire
protocol: [`PROTOCOL.md`](PROTOCOL.md)). Live for throwingwood.com since 2026-11-21; the
rooms server it replaced (`docs/ROOMS.md`) is deleted.

| File                   | What it is                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| `core.mjs`             | the pitch core: pure logic, no Cloudflare APIs (tested in `tests/pitch-server/`) |
| `names.mjs`            | the names check, from `names-words.json` (PROTOCOL.md section 6a)                |
| `names-words.json`     | the engine's word lists, written by `tools/names-words.mjs`; never edited        |
| `src/worker.mjs`       | the Worker: checks each request and hands it on                                  |
| `src/pitch-do.mjs`     | `PitchDO`, one per pitch code: the core over hibernating sockets and SQLite      |
| `src/lobby-do.mjs`     | `LobbyDO`, one for all: the open games list                                      |
| `src/lobby.mjs`        | the list's rules, pure                                                           |
| `src/push.mjs`         | pushes to AWS: envelope, signature, backoff, pure                                |
| `src/http.mjs`         | the Origin filter and CORS, pure                                                 |
| `cloudflare.config.ts` | what `cf deploy` deploys                                                         |
| `wrangler.jsonc`       | the same Worker for `wrangler dev` and the tests                                 |
| `test/`                | the Durable Object tests, in the Workers pool (vitest)                           |
| `driver/`              | the load and behaviour driver for a running server                               |

## Endpoints

- `GET /health`: `ok <VERSION>`.
- `GET /ws?pitch=<code>`: the pitch's WebSocket (PROTOCOL.md section 1). 426 without an
  upgrade, 400 on a bad code, 403 on an `Origin` not in `ALLOWED_ORIGINS`; no `Origin`
  (the iPhone app) is let through. `admit()` in `src/worker.mjs` is where a Turnstile
  check would go; it admits everyone.
- `GET /open`: the open games list, CORS for `ALLOWED_ORIGINS`, cached 5 s.
- `GET /dev/pitch?pitch=<code>` with `Authorization: Bearer <DEV_KEY>`: the object's
  numbers (version, commit order, when it woke and from what, sockets, `s`, head, stored
  actions, outbox, alarm, database size). `POST /dev/pitch?pitch=<code>&op=wipe` closes
  every socket (4000) and wipes the pitch. Both answer 404 without the key, or when no
  `DEV_KEY` is set. Leave `DEV_KEY` out of production.

## Configuration

Plain variables (`env` in `cloudflare.config.ts`, `vars` in `wrangler.jsonc`;
`wrangler.jsonc` has no `PUSH_URL`, so `npm run dev` never pushes to AWS):

| Name                     | Meaning                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `VERSION`                | shown by `/health` and `/dev/pitch`; change it with each deploy                    |
| `ALLOWED_ORIGINS`        | comma separated; an origin without a port matches any port (`http://localhost`)    |
| `PUSH_URL`               | the AWS receiver; unset, nothing is pushed and the outbox waits                    |
| `COMMIT_ORDER`           | `relay-first` (the core's default) or `write-first`                                |
| `DEV_WRITE_FIRST_PREFIX` | dev only: codes starting with it run write first, to compare the two on one deploy |
| `UNKNOWN_PITCH`          | `open` (default) or `refuse`                                                       |
| `OBSERVERS_MAX`          | the cap on observers a pitch (the core's default is 20)                            |

Secrets (`cf deploy --secrets-file .dev.vars`; `.dev.vars` is gitignored and is also
what `wrangler dev` reads). They live in 1Password (vault `Otto`); the committed
templates `.dev.vars.tpl` (both) and `.prod.vars.tpl` (`PUSH_SECRET` only) name the
items, and `op inject` renders the gitignored files from them. AWS Secrets Manager's
`throwing-wood/push-secret` is the authority for `PUSH_SECRET`; the 1Password item
`Pitch Server Push Secret - throwing-wood` must hold the same value
(`docs/PITCH-SERVER.md` section 12, "The secret").

| Name          | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `PUSH_SECRET` | the HMAC key shared with the AWS receiver; unset, no pushes |
| `DEV_KEY`     | the bearer key for `/dev/pitch`; dev only                   |

A new dev key is `openssl rand -hex 24`, saved in the 1Password item
`Pitch Server Dev Key - throwing-wood`.

## Deploy with nobody there

```sh
npm ci
./deploy.sh production   # or: ./deploy.sh dev
```

`deploy.sh` needs no 1Password and asks nothing, so an agent or a scheduled run can use
it (the owner, 2026-11-22: "set it up so we can do the Cloudflare deployments without
1Password access and do it unattended"). Bump the Worker's `version` in
`cloudflare.config.ts` first, as for any deploy.

- **The secrets come from AWS Secrets Manager**, read as the `cloud-engineer` role:
  `PUSH_SECRET` from `throwing-wood/push-secret` (the authority) and, for dev,
  `DEV_KEY` from `throwing-wood/pitch-dev-key` (the pitches stack's `DevKey`, generated
  there). They go into the script's own environment and nowhere else: the secrets file
  `cf deploy` is given holds references (`PUSH_SECRET=${PUSH_SECRET}`), which `cf`
  expands from the environment, so no value is written to disk, printed or logged.
- **Cloudflare**: the script uses `CLOUDFLARE_API_TOKEN` from the environment if it is
  set, else the secret `throwing-wood/cloudflare-deploy-token` if it exists, else the
  `cf auth login` already on the machine. A machine with no login needs the token: one
  with Workers Scripts edit on the account and nothing more, stored by its owner with
  `aws secretsmanager create-secret --name throwing-wood/cloudflare-deploy-token
--secret-string "$(pbpaste)"` straight from the clipboard.
- The dev key for the driver, without a `.dev.vars`:
  `DEV_KEY="$(aws secretsmanager get-secret-value --secret-id throwing-wood/pitch-dev-key
--query SecretString --output text)" node driver/driver.mjs ...`.

## Deploy by hand, from 1Password

The older way, for a person at the machine. The 1Password items mirror the secrets
above; when they differ, Secrets Manager is right (a dev deploy with `deploy.sh` sets the
Secrets Manager dev key, so render `.dev.vars` again or use the line above).

```sh
npm ci
op inject -i .dev.vars.tpl -o .dev.vars && chmod 600 .dev.vars
npx cf deploy --secrets-file .dev.vars </dev/null
```

It deploys the dev Worker, `throwingwood-pitches-dev` (on workers.dev only: no route, no
zone), and prints the version id. `</dev/null` keeps it from ever asking a question.
Bump its `version` in `cloudflare.config.ts` with each deploy.

`cloudflare.config.ts` holds both Workers, picked by `--mode`. Production is
`throwingwood-pitches`: the same code and `PUSH_URL`, `ALLOWED_ORIGINS` without the
localhost entries, no `DEV_WRITE_FIRST_PREFIX`, and a secrets file with `PUSH_SECRET` only,
so `/dev/pitch` answers 404 there:

```sh
op inject -i .prod.vars.tpl -o .prod.vars && chmod 600 .prod.vars  # gitignored
npx cf deploy --mode production --secrets-file .prod.vars </dev/null
```

`cf` cannot read a process substitution (`<(op inject ...)`), so it gets a real file;
delete it after if you like. Any other mode is refused. Production is live since
2026-11-21, on workers.dev only: a route or custom domain for it is a later step. The first deploy creates both Durable Object classes with
SQLite storage; a class is never renamed or removed without a migration.

A deploy reaches new requests at once. A pitch busy at the time keeps its old code until
its object restarts: in one test that was never during a two minute match, in the proof
of concept it was about 300 s, with every socket dropped at once. The objects rebuild
from storage either way and clients resume (PROTOCOL.md section 7).

Roll back by deploying the previous commit.

## Operate

- Logs: observability is off in dev. `npx wrangler tail throwingwood-pitches-dev` shows
  live logs if needed.
- A stuck pitch: read `/dev/pitch`, then wipe it if it must go.
- The outbox: `outbox` and `retrying` in `/dev/pitch`. A pitch with pending pushes is
  never idle-wiped, so with no receiver every played pitch stays.
- Storage: each action stores its relayed record (about 600 B) and, until it is pushed,
  its snapshot in the outbox; the head keeps one snapshot. A finished pitch nobody is on
  is wiped 48 hours after its last change, once its pushes are taken.

## The AWS receiver (build step 3)

What `PitchDO` sends is in PROTOCOL.md, "On the wire to AWS": one signed `POST` per
push, keyed `<pitch>:<made>:<k>`, retried until a 2xx. `test/receiver.mjs` is a working
stand-in: it checks the signature and the key exactly as the real one must.

The real one is `backend/api/` (its contract `backend/api/API.md`), the Lambda function
`throwing-wood-api` in the `throwing-wood-pitches` stack. The dev Worker pushes to it
since 2026-11-21 (`dev-3`). Its secret (`throwing-wood/push-secret`) and `PUSH_URL`
steps are `docs/PITCH-SERVER.md` section 12. `--scenario match` proves the chain: it
plays one short match to its end, waits for the outbox to empty and, with
`--replay <the function URL>`, for the api to serve the kept replay.

Since `dev-6` the dev Worker marks every push `dev: true` (`PUSH_DEV`), and the api keeps
a marked push's start and actions under `games/dev/` for 14 days and nothing else
(backend/api/API.md "Dev pushes"): its pitches are never live pitches' pages, replays or
reels. So `--replay` against the dev Worker finds no kept replay by design; the chain's
records are under `games/dev/pitch/<code>/`. No browser test, default build or CI run
opens a pitch on the dev Worker (AGENTS.md "Build and check").

## Test

```sh
npm ci
npm run test:do
```

The tests run in workerd through `@cloudflare/vitest-plugin`, with miniflare's outbound
service as the AWS receiver: joining, the relay, simultaneous actions, resume, the
literal ping, a rebuild after eviction giving the same frames, the idle wipe, pushes
with failures and the alarm's retries, the open games list and its expiry, the Worker's
refusals and CORS. CI runs them in the `check` job. The pure parts are also tested from
the root (`npm run check`, `tests/pitch-server/`).

`npm run dev` serves the Worker on 127.0.0.1:8797 for the driver. Stop it when done.

## The driver

`node driver/driver.mjs --url ws://127.0.0.1:8797 --scenario <name>`, or the dev
Worker's `wss://` address. Synthetic members and payloads only. It writes
`results/<label>-<time>.json` (gitignored) and wipes its pitch at the end (`--keep yes`
does not). With `DEV_KEY` in the environment or `.dev.vars` it reads `/dev/pitch` too.

| Scenario | What it does                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------- |
| `turns`  | a match of turns: aim at 15 Hz, an action at the release (`--players`, `--observers`, `--duration`) |
| `order`  | `turns` twice: relay first, then write first (a `DEV_WRITE_FIRST_PREFIX` code)                      |
| `simul`  | two players act at once, `--rounds` times                                                           |
| `resume` | three players drop and come back                                                                    |
| `idle`   | idle gaps with and without pings: did the object sleep and rebuild?                                 |
| `rtt`    | round trips to `/health`                                                                            |
| `match`  | one match to its end (`--acts`, the last `over`): outbox empty, then the kept replay (`--replay`)   |

`--exec-at <s> --exec '<command>'` runs a command part way, a redeploy for instance.
The numbers measured on 2026-11-21 are in `docs/PITCH-SERVER.md` section 8.
