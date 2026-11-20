# Engines the site carries

A match belongs to the engine it was started on: its `match.engine` major.minor, for its
whole life (the engine's `docs/VERSIONING.md`). A new minor can change how a throw goes,
so a match from an older minor only plays back as it was played on that minor's engine.
The web is the client that carries more than one (Jamie: "it feels like the web version
needs to support a wide variety ... the iPhone, if it were running an older version than
what web runs, could just request the match out of certain version."). The iPhone app
carries one engine; the site carries the newest and the older minors it still plays
back.

## The rule

- One engine per major.minor. A patch replaces its minor's engine; a new minor is a new
  engine beside the others.
- Play is always on the newest: a new pitch, a solo match, practice and watch start
  on it, and `me.engine` and START's `match.engine` are its major.minor.
- Carrying an older minor is a decision made when the newer one is vendored, never an
  accident: `vendor:sync` stops on a new minor until it is told `--keep` or `--drop`.

## Vendoring

`vendor/engine/` is the newest engine. Each older minor the site carries is
`vendor/engines/<major.minor>/`, laid out the same way. `vendor/engine.json` pins them
all: its top-level `tag`, `commit` and `files` are `vendor/engine/`'s, and `older` holds
the others by major.minor (`{ "0.7": { tag, commit, files } }`). None of them is ever
edited by hand.

| Command                                      | What it does                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run vendor:sync -- --tag v0.7.5`        | A patch: moves the engine of that minor to the tag, the newest or an older one.                                       |
| `npm run vendor:sync -- --tag v0.8.0 --keep` | A new minor: the newest moves to `vendor/engines/0.7/` and is carried on, and 0.8.0 is the newest.                    |
| `npm run vendor:sync -- --tag v0.8.0 --drop` | A new minor that replaces the newest: matches from 0.7 then play back on 0.8, with the note a disagreeing hash shows. |
| `npm run vendor:sync`                        | Writes every pinned engine again at its own tag.                                                                      |
| `node tools/vendor.mjs drop 0.7`             | Stops carrying an older engine.                                                                                       |
| `npm run vendor:check`                       | Every pinned engine against its own manifest and bundle hash, and nothing unpinned under `vendor/engines/`.           |

An older minor the site has dropped is not added back. `tests/engine/vendor.test.mjs`
runs all of these against a stand-in kubb-engine made at test time
(`tests/engine/engine-fixture.mjs`: the vendored engine with only its version changed).

## The build and the page

`tools/lua-bundle.mjs` writes one bundle per carried engine,
`build/lua-sources-<major.minor>.json`. The build publishes each as a hashed asset (the
newest as `lua-sources-<hash>.json`, as it always was; an older one as
`lua-sources-<major.minor>-<hash>.json`) and the game pages' config names them all:

```json
"luaUrl": "/assets/lua-sources-<hash>.json",
"engine": "0.8.1",
"engines": {
  "0.8": { "version": "0.8.1", "luaUrl": "/assets/lua-sources-<hash>.json" },
  "0.7": { "version": "0.7.4", "luaUrl": "/assets/lua-sources-0.7-<hash>.json" }
}
```

`luaUrl` and `engine` stay the newest's. `readConfig` gives a page without `engines` the
set of one.

## In the browser

`src/engine/registry.js` holds the set: `loadEngine(mm)` fetches that engine's bundle
and makes its wasmoon state the first time it is asked for, and keeps it, so a page
that never looks back at an older match never loads an older engine. `src/main.js` makes
the registry from the config and loads the newest at boot.

Each engine is registered with the room bridge as it loads (`src/net/room-engine.js`):
`roomCall(name, args)` goes to the newest, `roomCall(name, args, mm)` to the one named.
`lobby.js`'s constants (`ENGINE`, `REPLAY_VERSION`, ...) are the newest's;
`engineConstants(mm)` reads any carried engine's, once each.
