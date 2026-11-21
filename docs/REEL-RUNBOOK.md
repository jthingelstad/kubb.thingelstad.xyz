# Highlight reels: deploy, check, roll back

The reel function is in the site stack and the api function (`throwing-wood-api`, in the
pitches stack) invokes it (`docs/REEL.md`, `docs/PITCH-SERVER.md`). Approved by Jamie on 2026-11-19: "Approved: build the
highlight reel feature as designed in docs/REEL.md, including its AWS resources in the
throwingwood.com web stack". Run everything here as `cloud-engineer` in `us-east-1`
(`AWS_PROFILE=cloud-engineer`), from a clean checkout of `main` with the branch merged.

Until 2026-11-21 the old WebSocket rooms function invoked it. That stack was deleted on
2026-11-21 (`docs/ROOMS.md`, `docs/PITCH-SERVER.md` section 12). The first deploy
("Deploy" steps 4 and 5), the sharing apply and the change that brought engines to the
renderer were run against it and are kept below as the record of what was done. Today
the second stack is the pitches stack: `npm run infra:plan -- pitches`, its `ApiFunction`
and `ApiRole`.

## Before

- `npm ci`, then `npm run check`.
- `"reelRenderer": true` is in `infra/deployment.json`. With it false, or missing, the
  site stack has no reel function and the pitches stack no permission: every `reel`
  request answers `why: "unavailable"`.
- The function takes 2 of the account's Lambda concurrency as reserved. Lambda refuses
  that when it would leave the account under 100 unreserved; check the account's limit
  first (`aws lambda get-account-settings`, `ConcurrentExecutions` and
  `UnreservedConcurrentExecutions`). If it is low, drop `ReservedConcurrentExecutions`
  from `infra/site.json` in a pull request: the daily cap of 200 still bounds the cost.

## Deploy, in order

1. `npm run reels:bundle`

   Downloads (once, cached in `build/reels-cache/`) and checks the pinned ffmpeg and
   canvas binary against `infra/reels-pins.json`, writes `build/reels.zip` and
   `build/reels-ffmpeg.zip` and prints their keys and sizes against Lambda's 250 MB. Two
   runs print the same keys. A checksum that does not match stops here.

2. `AWS_PROFILE=cloud-engineer npm run infra:plan -- site`

   Builds the same two zips (it uploads nothing) and prints the site change set:
   - **Add** `ReelsLogs` (`/aws/lambda/kubb-xyz-site-reels`, 30 days), `ReelsRole`,
     `ReelsLayer`, `ReelsFunction` (`kubb-xyz-site-reels`), `ReelsInvokeConfig`.
   - **Modify** `SiteBucket` (the `ExpireReels` lifecycle rule; no replacement).
   - When the pitch pages code changed since the last apply: `PagesRevision`
     (REPLACEMENT, a new revision from the new code key, which is how that function
     takes new code) and `PagesEndpoint` (its weight moves to the new revision).
   - The tool's list also names `Distribution`, `PagesAccess`, `SiteBucketPolicy` and
     the six DNS records as Modify. They refer to resources above and are evaluated
     again; nothing in them changes. To be sure, read the change set the plan leaves
     on the stack with property values
     (`aws cloudformation describe-change-set --include-property-values`): it lists
     only the resources that really change, with before and after. The first deploy
     (2026-11-19) showed exactly the five adds, `SiteBucket`, `PagesRevision` and
     `PagesEndpoint`.
   - A real change to the distribution, the certificate or a record, or a replacement
     of anything but `PagesRevision`, is a stop: find out why first.

3. `AWS_PROFILE=cloud-engineer npm run infra:apply -- site`

   Uploads `reels/<sha256>.zip` and `reels/ffmpeg-<sha256>.zip` to the code bucket, then
   runs the change set. `infra/deployment.json` gains a `reels` block (function ARN,
   engines, keys).

4. `AWS_PROFILE=cloud-engineer npm run infra:plan -- rooms`

   The rooms stack reads the reel function's ARN and engines from the site stack's
   outputs, so plan it only after step 3:
   - **Modify** `RoomsRole` (the `StartReels` statement: `lambda:InvokeFunction` on
     that one ARN) and `RoomsFunction` (environment `REELS_FUNCTION`, `REEL_ENGINES`,
     and new code when its bundle changed). No replacement.
     `RoomsIntegration` is listed as Modify beside them because it refers to the
     function; nothing in it changes.

5. `AWS_PROFILE=cloud-engineer npm run infra:apply -- rooms`

6. Commit the rewritten `infra/deployment.json` in a pull request.

## Check, read only

- `aws lambda get-function-configuration --function-name kubb-xyz-site-reels`:
  `arm64`, `nodejs24.x`, 3008 MB, 300 s, one layer, environment `TABLE`,
  `SITE_BUCKET`, `REEL_ENGINES` (every engine the site carries, newest first: `0.7`
  today) and `FFMPEG`.
- `aws lambda get-function-event-invoke-config --function-name kubb-xyz-site-reels`:
  one retry, 900 s.
- `aws lambda get-function-concurrency --function-name kubb-xyz-site-reels`: 2.
- `aws lambda get-function-configuration --function-name throwing-wood-api`:
  `REELS_FUNCTION` is the ARN above.
- `aws s3api get-bucket-lifecycle-configuration --bucket kubb-xyz-site-web-<account>`:
  `ExpireReels`, prefix `reels/`, 366 days, beside the existing rules.

Asking for a reel starts a render and writes to the table and bucket, so the first live
reel is a real one, on a real finished pitch, when Jamie wants it. Watch it with
`aws logs tail /aws/lambda/kubb-xyz-site-reels --since 15m`: one JSON line per step
(`render`, then `done`, or `error` and `failed`, with the room code, version, tag and
engine), never a name. Its `REPORT` line gives the
real duration and memory, which are guesses until then.

## Roll back

- Set `"reelRenderer": false` in `infra/deployment.json`, then
  `npm run infra:apply -- site` (deletes the function, layer version, role and log
  group; the lifecycle rule stays, harmlessly) and then `npm run infra:apply -- pitches`
  (removes the permission and the environment). Between the two, a `reel` request that
  would start a render answers `failed`; one that only asks still answers.
- Or revert the merge and run the same two applies.
- Reels already made stay in `reels/` until the lifecycle rule expires them, and a
  `done` reel item keeps its pitch's `og:video` until then. To take them down at once,
  delete `reels/` in the site bucket by hand (Jamie's call: it changes what shared links
  show).
- The api function without `REELS_FUNCTION` answers `why: "unavailable"`; nothing
  else in play changes.

## Sharing

Applied on 2026-11-19 against the old rooms stack; kept as the record. Sharing now runs
through the api function, which has the same check and the same 30 s timeout.

Sharing a match against the computer (`docs/ROOMS.md` section 13) needs no new resource
and no IAM change: the rooms role already has the whole table and
`lambda:InvokeFunction` on the reel function, which the check uses as a synchronous
invoke. Two things change:

- the site stack: new reel function code (it answers `{ check: g }`) and new pitch
  pages code (the computer's title form);
- the rooms stack: new rooms function code, and its timeout from 10 s to 30 s, because
  a share waits up to 20 s for its check and then writes the sealed room.

### Apply, in order

The renderer must understand a check before the rooms function asks for one, so the site
stack goes first. Between the two applies nothing sends a check.

1. Merge, then `npm ci` and `npm run check` on `main`.
2. `npm run reels:bundle`: a new code key; the ffmpeg layer's key is unchanged.
3. `AWS_PROFILE=cloud-engineer npm run infra:plan -- site`: **Modify** `ReelsFunction`
   (the code key only), and `PagesRevision` (REPLACEMENT, the new pages code) with
   `PagesEndpoint`. The same evaluated-again list as in "Deploy" step 2. Anything
   added, an IAM change, or a replacement other than `PagesRevision` is a stop.
4. `AWS_PROFILE=cloud-engineer npm run infra:apply -- site`
5. `AWS_PROFILE=cloud-engineer npm run infra:plan -- rooms`: **Modify** `RoomsFunction`
   (`Timeout` 30 and the new code), `RoomsIntegration` listed beside it as before. No
   change to `RoomsRole`.
6. `AWS_PROFILE=cloud-engineer npm run infra:apply -- rooms`
7. Commit the rewritten `infra/deployment.json` in a pull request.

### Check, read only

- `aws lambda get-function-configuration --function-name kubb-xyz-rooms-rooms`:
  `Timeout` 30; `REELS_FUNCTION` and `REEL_ENGINES` as before.
- `aws lambda get-function-configuration --function-name kubb-xyz-site-reels`:
  `CodeSha256` changed, everything else as in "Check, read only".
- `aws lambda get-function-concurrency --function-name kubb-xyz-site-reels`: still 2.

A share writes a sealed room, its document, its replay and a `share#` key that live a
year, so the first live share is a real match, shared from a device when Jamie wants
it. Then, still reading only:

- `aws logs tail /aws/lambda/kubb-xyz-site-reels --since 15m`: one JSON line per check,
  `{"check":"ok", "step":null, "engine", "played", "actions", "ms"}` (or the `why` and
  the `step` that failed), never a name. `ms` is the real check time on Lambda, which
  the tables in `docs/ROOMS.md` 13.4 only estimate.
- `aws logs tail /aws/lambda/kubb-xyz-rooms-rooms --since 15m`: no `share ... failed`
  lines; the `REPORT` line of the share's invocation gives its duration (the check's
  plus one write transaction).
- `aws dynamodb get-item --table-name <rooms table> --key
'{"pk":{"S":"shares#<yyyy-mm-dd>"},"sk":{"S":"count"}}'`: the day's checks.
- `https://throwingwood.com/p/<code>` shows the finished match and "Watch the replay".

### Roll back

- Revert the merge, then apply the **rooms** stack first (it stops asking for checks:
  every `share` answers `bad-message`, unknown `t`) and the site stack after.
- Shared matches already kept stay, a year. Before this change the rooms code knew no
  `sealed`, so after a rollback anyone with a shared match's link could `join` it and
  write its document. The kept replay is unaffected (a `keep` of version 1 or less loses
  to it), but the pitch page would show what was written. If that matters, the sealed
  rooms can be found by their `share#` items (a scan, read only) and deleted with their
  `room#<code>` items by hand: Jamie's call, since it takes down shared links.

## Adding or dropping an engine

The reel function carries one Lua bundle per engine the site carries, and
`REEL_ENGINES` names them, newest first (`docs/REEL.md` "Engines", `docs/ENGINES.md`).
Both come from `vendor/`: `tools/infra.mjs` packages the bundles and sets the site
stack's `ReelEngines`, and the pitches stack takes `ReelEngines` from the site stack's
output. Nothing is set by hand.

**The rule: the api function never names an engine the renderer lacks.** A render it
starts for such an engine fails with `why: "engine"`, and `failed` is final for that
version and look. So the site stack goes first when an engine is added.

### The change that brought engines to the renderer (one engine)

Run against the old rooms stack; kept as the record.

With one engine carried, two things change: the package's layout (`engines/0.7.json`
where `lua-sources.json` was), and the rooms function's code, which now answers a done
reel before it checks the engine:

1. `npm run reels:bundle`: a new code key, the same layer key, about 13 MB zipped and
   30 MB unzipped as before.
2. `AWS_PROFILE=cloud-engineer npm run infra:plan -- site`: **Modify** `ReelsFunction`,
   the code key only. `ReelEngines` stays `0.7`, and so does `REEL_ENGINES`. The
   pitch pages code is the same, so there is no `PagesRevision`. The same
   evaluated-again list as in "Deploy" step 2. Anything else is a stop.
3. `AWS_PROFILE=cloud-engineer npm run infra:apply -- site`
4. `AWS_PROFILE=cloud-engineer npm run infra:plan -- rooms`: **Modify**
   `RoomsFunction`, the code key only, with `RoomsIntegration` listed beside it as
   before. `ReelEngines` stays `0.7`. No change to `RoomsRole`; anything else is a
   stop. The merge's deploy (`tools/deploy.mjs`) already put the new code live; this
   brings the stack's code key up to it.
5. `AWS_PROFILE=cloud-engineer npm run infra:apply -- rooms`
6. Commit the rewritten `infra/deployment.json` (`reels.codeKey`, `rooms.codeKey`) in a
   pull request.

### Adding an engine (`vendor:sync -- --tag vX.Y.0 --keep`)

1. Merge the pull request that vendors it. CI deploys the site, and play moves to the
   new engine. Until step 4, a new-engine pitch asking for its reel is answered
   `why: "engine"` and its share is refused the same way. Neither answer is stored, so
   asking again later works. Matches of the older engine, the iPhone's among them, are
   unaffected throughout.
2. On `main`: `npm ci`, `npm run check`, then `npm run reels:bundle`. It prints a new
   code key, the same layer key, and a function about 0.2 MB larger zipped and 0.7 MB
   larger unzipped per engine.
3. `AWS_PROFILE=cloud-engineer npm run infra:plan -- site`: **Modify** `ReelsFunction`
   (the code key, and its environment `REEL_ENGINES`, for example `0.7` to `0.8,0.7`).
   Also `PagesRevision` (REPLACEMENT) and `PagesEndpoint` if the pitch pages code
   changed. The same evaluated-again list as in "Deploy" step 2. Anything added, an IAM
   change, or another replacement is a stop.
4. `AWS_PROFILE=cloud-engineer npm run infra:apply -- site`
5. `AWS_PROFILE=cloud-engineer npm run infra:plan -- pitches`: **Modify** `ApiFunction`
   (environment `REEL_ENGINES` the same list, and new code only if its bundle changed).
   No change to `ApiRole`.
6. `AWS_PROFILE=cloud-engineer npm run infra:apply -- pitches`
7. Commit the rewritten `infra/deployment.json` (`reels.engines`, `reels.codeKey`) in a
   pull request.

Check it, read only:

- `aws lambda get-function-configuration` on `kubb-xyz-site-reels` and on
  `throwing-wood-api`: the same `REEL_ENGINES` on both, newest first.
- The reel function's log: each line names the `engine` a render or check ran on, so
  the first reel or share of each engine shows its version there
  (`aws logs tail /aws/lambda/kubb-xyz-site-reels --since 15m`).

### Dropping an engine (`node tools/vendor.mjs drop <mm>`, or `--drop`)

The same steps, site then pitches, because the pitches stack reads the site stack's
output. Run the two applies back to back. In the minutes between them, the api function still
names the dropped engine. A reel requested then for one of its pitches is started and
fails with `why: "engine"`, final. A share of it is refused, as it is after.

After both, a reel already made for a pitch of the dropped engine is still answered
`done`, in the app as on `/p/<code>` (its `og:video`), until the lifecycle rule expires
it. A pitch of that engine with no reel made is answered `why: "engine"`, and nothing is
started. A share of it is refused.

## Costs (estimates)

Prices checked in the AWS price list on 2026-11-19, us-east-1: Lambda arm64 $0.0000133334
a GB-second and $0.20 a million requests; S3 Standard $0.023 a GB-month and $0.005 per
1,000 PUTs; CloudFront data transfer out in the United States $0.085 a GB past the free
monthly terabyte.

- A render: about 213 GB-s (3 GB for about 71 s), about $0.003. The duration is a guess
  from a Docker run limited to Lambda's CPU at 3008 MB; the 300 s timeout bounds the
  worst at about 900 GB-s, about $0.012.
- Storing a reel's two videos and edit list (about 11 MB): about $0.00025 a month.
- Serving: one full download of both files about $0.0009; a viewer normally fetches one
  file, about 5 MB, about $0.0004.
- The daily cap of 200 renders bounds a bad day's compute at about $0.60 at the guessed
  duration (about $2.40 if every render ran to its timeout). A render is tried at most
  twice, so a day of failing renders could double that.
- The layer and code zips in the code bucket: about 37 MB a version, cents a year.
- A share's check: the reel function at 3008 MB for 2 to 20 s, 6 to 59 GB-s, at most
  about $0.0008; the api function waits at 256 MB, at most 5 GB-s, about $0.00007.
  The daily cap of 200 checks bounds a bad day at about $0.17. Each shared match keeps
  a gzipped replay and a document of up to 256 KB in the table, a year.
