# Rooms relay proof of concept (throwaway)

A proof of concept for live pitches on Cloudflare Durable Objects, built 2026-11-21 to
measure latency, ordering, hibernation and resume before the real build. It is not the
product and nothing in the game uses it. The real server is designed in
[`docs/PITCH-SERVER.md`](../../docs/PITCH-SERVER.md) and supersedes this folder. It keeps
the old word "room" on purpose.

- `src/logic.js`: pure logic (code check, act sequencing and duplicates, observer
  thinning, relay frames). Tested with `node --test`.
- `src/worker.js`: the Worker and the `RoomDO` Durable Object (Hibernation API, SQLite
  storage, ping answered by the runtime). Synthetic payloads only.
- `test/`: `logic.test.mjs` (node) and `room.spec.js` (the Workers vitest pool).
- `driver/driver.mjs`: simulated players and observers in one process with one clock,
  so each frame's sender to receiver time is read directly. Scenarios: `rtt`, `turns`,
  `simul`, `idle`, `resume`, `replay`, `order`. `driver/summary.py` prints a summary of
  the result files.
- `wrangler.jsonc`: for `wrangler dev` and the tests. `cloudflare.config.ts`: for
  `cf deploy`, which reads only that file.

## Run it locally

A gate key must be in `.dev.vars` (never committed): one line, `POC_KEY=<any random
string>`. The tests bring their own.

```sh
npm ci
npm test            # pure logic
npm run test:do     # the Durable Object in the Workers pool
npm run dev         # wrangler dev on 127.0.0.1:8799; stop it when done
./driver/run-local.sh   # every scenario at 32 sockets against npm run dev
```

The `replay` scenario replays the commit timing of a real match from
`.data/replay-timing.json` (`{ "offsetsMs": [0, 17238, ...] }`, ms offsets only, no
game data). It is kept out of git; on a new machine write any list of offsets there or
pass `--replay-file`. Results go to `results/` (never committed). `python3 driver/summary.py 'results/*.json'`
prints them.

## How it was deployed and measured

Deployed as `throwingwood-rooms-poc` on the account's workers.dev subdomain
(`throwingwood`), with `cf deploy --secrets-file .dev.vars` from this folder after
`cf auth login` (scopes in `docs/PITCH-SERVER.md` section 9). Then
`URL=wss://throwingwood-rooms-poc.throwingwood.workers.dev ./driver/run-deployed.sh`
ran every scenario at 32 and 112 sockets, and one deploy in the middle of a busy match.
The numbers are in `docs/PITCH-SERVER.md` section 8.

Delete the Worker once the real server exists.
