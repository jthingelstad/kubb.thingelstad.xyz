# Kubb: Throwing Wood on the web

The site at **https://throwingwood.com/** (kubb.thingelstad.xyz until 2026-11-17, which
now redirects there): Kubb, the lawn game of wooden blocks and
batons, in the browser. It is Jamie Thingelstad's Playdate game
[Kubb: Throwing Wood](https://playdate.thingelstad.xyz/throwing-wood/) running on the web:
the game's own Lua core in a WebAssembly Lua VM, drawn on a canvas, with multiplayer on a
link (start a pitch, send the link), a computer opponent and a practice pitch. The design
is `docs/DESIGN.md`. The game is still being built; until it is, a pitch says so.

Playdate is a trademark of Panic Inc. This game is not made by Panic.

## Run it

Node 24 (`.nvmrc`). Lua 5.4 for the game logic's tests.

```sh
npm ci
npm run check          # vendor and shared checks, tests, build, site checks
npm run format:check   # prettier
npm run preview        # dist/ on http://127.0.0.1:4322, /p/<code> as live
npm run dev            # rebuild on change, plus the local rooms on ws://127.0.0.1:8788
```

| Path         | What                                                       |
| ------------ | ---------------------------------------------------------- |
| `/`          | Home: start a pitch, play the computer, practice           |
| `/p/<code>`  | A pitch: every code serves the one game page (not indexed) |
| `/p/?solo=1` | A pitch of your own against the computer                   |
| `/practice/` | The practice pitch                                         |
| `/rules/`    | How Kubb is played, and how to throw on the web            |

## Deploy

Merging to `main` deploys from GitHub Actions: `KUBB_PRODUCTION=true npm run build`, then
`npm run deploy` as the delivery role (uploads, invalidates, compares the live bytes, and
updates the rooms function's code when it changed). Infrastructure changes run by hand as
the `cloud-engineer` profile:

```sh
AWS_PROFILE=cloud-engineer npm run infra:plan
AWS_PROFILE=cloud-engineer npm run infra:apply             # site and delivery (and rooms once it exists)
AWS_PROFILE=cloud-engineer npm run infra:apply -- rooms    # create or update the rooms stack
```

For iPhone pitch links the deploy build reads the plain repository variable
`APPLE_TEAM_ID`. When set, it publishes `/.well-known/apple-app-site-association`
as JSON for `/p/*`. Leaving the variable empty and deploying removes the association.
Other files, including old hashed assets used by open tabs, are retained.

## Hosting

| Piece       | Where                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Site        | S3 + CloudFront, stack `kubb-xyz-site`, `us-east-1`                                              |
| Rooms       | API Gateway WebSocket + Lambda + DynamoDB, stack `kubb-xyz-rooms`                                |
| Deploy role | GitHub OIDC, stack `kubb-xyz-delivery`                                                           |
| DNS         | `throwingwood.com` zone (and the old name in `thingelstad.xyz`), records owned by the site stack |
| AWS account | `<account>`                                                                                      |
| Access logs | CloudWatch `/kubb-xyz/web-access`, 731 days, no client IPs                                       |

## Licence

The game engine in `vendor/engine/` is kubb-engine's, under its own licence
(`vendor/engine/LICENSE`).
The Londrina Solid font is under the SIL Open Font License
(`public/fonts/OFL-LondrinaSolid.txt`); Inter is in `public/shared/fonts/` with its own
licence.
