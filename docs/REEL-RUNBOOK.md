# Highlight reels: deploy, check, roll back

The reel function is in the site stack and the rooms function invokes it (`docs/REEL.md`,
`docs/ROOMS.md` section 12). Approved by Jamie on 2026-11-19: "Approved: build the
highlight reel feature as designed in docs/REEL.md, including its AWS resources in the
throwingwood.com web stack". Run everything here as `cloud-engineer` in `us-east-1`
(`AWS_PROFILE=cloud-engineer`), from a clean checkout of `main` with the branch merged.

## Before

- `npm ci`, then `npm run check`.
- `"reelRenderer": true` is in `infra/deployment.json`. With it false, or missing, the
  site stack has no reel function and the rooms stack no permission: every `reel`
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
   - Nothing else. A replacement of anything, or a change to the distribution, the
     pages function or the certificate, is a stop: find out why first.

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

5. `AWS_PROFILE=cloud-engineer npm run infra:apply -- rooms`

6. Commit the rewritten `infra/deployment.json` in a pull request.

## Check, read only

- `aws lambda get-function-configuration --function-name kubb-xyz-site-reels`:
  `arm64`, `nodejs24.x`, 3008 MB, 300 s, one layer, environment `TABLE`,
  `SITE_BUCKET`, `REEL_ENGINES` (the vendored major.minor, `0.7` today) and `FFMPEG`.
- `aws lambda get-function-event-invoke-config --function-name kubb-xyz-site-reels`:
  one retry, 900 s.
- `aws lambda get-function-concurrency --function-name kubb-xyz-site-reels`: 2.
- `aws lambda get-function-configuration --function-name kubb-xyz-rooms-rooms`:
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
  group; the lifecycle rule stays, harmlessly) and then `npm run infra:apply -- rooms`
  (removes the permission and the environment). Between the two, a `reel` request that
  would start a render answers `failed`; one that only asks still answers.
- Or revert the merge and run the same two applies.
- Reels already made stay in `reels/` until the lifecycle rule expires them, and a
  `done` reel item keeps its pitch's `og:video` until then. To take them down at once,
  delete `reels/` in the site bucket by hand (Jamie's call: it changes what shared links
  show).
- The rooms function without `REELS_FUNCTION` answers `why: "unavailable"`; nothing
  else in the rooms changes.

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
