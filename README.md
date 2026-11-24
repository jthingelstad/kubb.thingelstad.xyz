# Kubb: Throwing Wood on the web

The site at **https://throwingwood.com/** (kubb.thingelstad.xyz until 2026-11-17, which
now redirects there): Kubb, the lawn game of wooden blocks and
batons, in the browser. It is Jamie Thingelstad's Playdate game
[Kubb: Throwing Wood](https://playdate.thingelstad.xyz/throwing-wood/) running on the web:
the game's own Lua core in a WebAssembly Lua VM, drawn on a canvas, with multiplayer on a
link (start a pitch, send the link), a computer opponent and a practice pitch. The design
is `docs/DESIGN.md`.

Playdate is a trademark of Panic Inc. This game is not made by Panic.

## Run it

Node 24 (`.nvmrc`). Lua 5.4 for the game logic's tests.

```sh
npm ci
npm run check          # vendor and shared checks, tests, build, site checks
npm run golden         # the engine's whole golden corpus (minutes; check plays it when the engine changed)
npm run format:check   # prettier
npm run preview        # dist/ on http://127.0.0.1:4322, /p/<code> as live
npm run dev            # rebuild on change, plus the local pitch server on ws://127.0.0.1:8797
```

| Path         | What                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------- |
| `/`          | The landing page and the web game: PLAY NOW, three ways to start, open games                |
| `/web/`      | 301 to `/#play` (the web game's page until the 1.0 design)                                  |
| `/ios/`      | The iPhone and iPad app: the App Store, and TestFlight for new versions (src/site/site.mjs) |
| `/playdate/` | The Playdate game, in development                                                           |
| `/engine/`   | The Kubb Engine                                                                             |
| `/love/`     | Kubb sites we love                                                                          |
| `/p/<code>`  | A pitch: every code serves the one game page (not indexed)                                  |
| `/p/?solo=1` | A pitch of your own against the computer                                                    |
| `/practice/` | The practice pitch                                                                          |
| `/rules/`    | How Kubb is played, and how to throw on the web                                             |
| `/support/`  | How to reach Jamie, and quick answers (the App Store listing's Support URL)                 |

Every page is in `src/site/`: the landing pages in `landing.mjs`, rules, privacy, support
and the game pages in `pages.mjs`. A path without its trailing slash
redirects to it (`infra/viewer-request.js`). The landing pages' pictures are real
captures in `public/landing/` (WebP; each `<img>` takes its size from the file).

## Deploy

Merging to `main` deploys from GitHub Actions: `KUBB_PRODUCTION=true npm run build`, then
`npm run deploy` as the delivery role (uploads, invalidates, compares the live bytes, and
updates the api function's code when it changed). Infrastructure changes run by hand as
the `cloud-engineer` profile, one named stack at a time:

```sh
AWS_PROFILE=cloud-engineer npm run infra:plan -- site
AWS_PROFILE=cloud-engineer npm run infra:apply -- site      # or pitches, or delivery
```

For iPhone pitch links the deploy build reads the plain repository variable
`APPLE_TEAM_ID`. When set, it publishes `/.well-known/apple-app-site-association`
as JSON for `/p/*`. Leaving the variable empty and deploying removes the association.
Other files, including old hashed assets used by open tabs, are retained.

## Hosting

| Piece       | Where                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Site        | S3 + CloudFront, stack `kubb-xyz-site`, `us-east-1`                                              |
| Live play   | Cloudflare pitch server (`backend/pitch-server`), and the api, stack `throwing-wood-pitches`     |
| Deploy role | GitHub OIDC, stack `kubb-xyz-delivery`                                                           |
| DNS         | `throwingwood.com` zone (and the old name in `thingelstad.xyz`), records owned by the site stack |
| AWS account | `<account>`                                                                                      |
| Access logs | CloudWatch `/kubb-xyz/web-access`, 731 days, no client IPs                                       |

## Licence

The browser game and its backend are under the [MIT licence](LICENSE). The
vendored [Kubb Engine](vendor/engine/LICENSE) also uses MIT. The fonts use the SIL
Open Font License 1.1. See the notices for [Londrina Solid](public/fonts/OFL-LondrinaSolid.txt),
[Inter](public/shared/fonts/OFL-Inter.txt) and [Inter Tight](public/shared/fonts/OFL-InterTight.txt).
