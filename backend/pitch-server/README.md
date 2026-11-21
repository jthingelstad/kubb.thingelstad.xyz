# The pitch server

Live pitches on Cloudflare Durable Objects (the plan: `docs/PITCH-SERVER.md`; the wire
protocol: [`PROTOCOL.md`](PROTOCOL.md)). Not live yet: the rooms server in
`docs/ROOMS.md` still serves throwingwood.com.

| File                   | What it is                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| `core.mjs`             | the pitch core: pure logic, no Cloudflare APIs (tested in `tests/pitch-server/`) |
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

Plain variables (`env` in `cloudflare.config.ts`, `vars` in `wrangler.jsonc`):

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
what `wrangler dev` reads):

| Name          | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `PUSH_SECRET` | the HMAC key shared with the AWS receiver; unset, no pushes |
| `DEV_KEY`     | the bearer key for `/dev/pitch`; dev only                   |

Make a dev key with `printf 'DEV_KEY=%s\n' "$(openssl rand -hex 24)" > .dev.vars`.

## Deploy

```sh
npm ci
npx cf deploy --secrets-file .dev.vars </dev/null
```

It deploys the Worker named in `cloudflare.config.ts` (`throwingwood-pitches-dev`, on
workers.dev only: no route, no zone) and prints the version id. `</dev/null` keeps it
from ever asking a question. The first deploy creates both Durable Object classes with
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

The real one is `backend/api/` (its contract `backend/api/API.md`), built and not yet
deployed. Its secret and `PUSH_URL` steps are `docs/PITCH-SERVER.md` section 12.

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

`--exec-at <s> --exec '<command>'` runs a command part way, a redeploy for instance.
The numbers measured on 2026-11-21 are in `docs/PITCH-SERVER.md` section 8.
