// The pitches stack (infra/pitches.json, throwing-wood-pitches): what it creates, the
// api role's exact grants, the table and games bucket as the old rooms stack's were, the
// cutover wiring in the site and delivery stacks, and the naming rule (AGENTS.md
// "Hosting": everything new is throwing-wood-*, no new kubb-xyz name).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  gamesBucketOf,
  pulledPath,
  pullPrefixes,
  TEST_PITCHES,
} from "../../tools/games.mjs";

const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const pitches = await json("infra/pitches.json");
const R = pitches.Resources;

test("the pitches stack: exactly these resources, named throwing-wood", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(R).map(([id, r]) => [id, r.Type])),
    {
      PitchesTable: "AWS::DynamoDB::Table",
      GamesBucket: "AWS::S3::Bucket",
      GamesBucketPolicy: "AWS::S3::BucketPolicy",
      PushSecret: "AWS::SecretsManager::Secret",
      DevKey: "AWS::SecretsManager::Secret",
      ApiLogGroup: "AWS::Logs::LogGroup",
      ApiRole: "AWS::IAM::Role",
      ApiFunction: "AWS::Lambda::Function",
      ApiUrl: "AWS::Lambda::Url",
      ApiUrlPermission: "AWS::Lambda::Permission",
      ApiUrlInvokePermission: "AWS::Lambda::Permission",
    },
  );
  assert.equal(R.ApiFunction.Properties.FunctionName, "throwing-wood-api");
  assert.equal(R.PushSecret.Properties.Name, "throwing-wood/push-secret");
  // the dev Worker's key, generated here so a deploy needs no person
  // (backend/pitch-server/deploy.sh); no role is given it, least of all the api's
  assert.equal(R.DevKey.Properties.Name, "throwing-wood/pitch-dev-key");
  assert.ok(R.DevKey.Properties.GenerateSecretString);
  assert.ok(!JSON.stringify(R.ApiRole).includes("DevKey"));
  assert.equal(
    R.ApiLogGroup.Properties.LogGroupName,
    "/aws/lambda/throwing-wood-api",
  );
  // the stack is throwing-wood-pitches, so its bucket is throwing-wood-pitches-games-<account>
  assert.deepEqual(R.GamesBucket.Properties.BucketName, {
    "Fn::Sub": "${AWS::StackName}-games-${AWS::AccountId}",
  });
  for (const o of Object.values(pitches.Outputs))
    if (o.Export) assert.match(o.Export.Name, /^throwing-wood-/);
  // the secret is generated, never a parameter
  assert.ok(R.PushSecret.Properties.GenerateSecretString);
  assert.ok(!("SecretString" in R.PushSecret.Properties));
  assert.doesNotMatch(JSON.stringify(pitches), /—|kubb-xyz/);
});

// As the old rooms stack's table and bucket were (that stack was deleted on 2026-11-21):
// on demand, TTL on `exp`, no point-in-time recovery, deleted with the stack; the bucket
// kept when the stack goes, private, SSE-S3, owner enforced, TLS only, no versioning or
// lifecycle.
test("the pitches table and games bucket", () => {
  const table = R.PitchesTable;
  assert.equal(table.DeletionPolicy, undefined);
  assert.equal(table.Properties.BillingMode, "PAY_PER_REQUEST");
  assert.deepEqual(table.Properties.KeySchema, [
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ]);
  assert.deepEqual(table.Properties.TimeToLiveSpecification, {
    AttributeName: "exp",
    Enabled: true,
  });
  assert.equal(table.Properties.PointInTimeRecoverySpecification, undefined);
  const bucket = R.GamesBucket;
  assert.equal(bucket.DeletionPolicy, "Retain");
  assert.equal(bucket.UpdateReplacePolicy, "Retain");
  assert.deepEqual(bucket.Properties.BucketEncryption, {
    ServerSideEncryptionConfiguration: [
      { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
    ],
  });
  assert.deepEqual(bucket.Properties.PublicAccessBlockConfiguration, {
    BlockPublicAcls: true,
    BlockPublicPolicy: true,
    IgnorePublicAcls: true,
    RestrictPublicBuckets: true,
  });
  assert.deepEqual(bucket.Properties.OwnershipControls, {
    Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
  });
  assert.equal(bucket.Properties.VersioningConfiguration, undefined);
  // kept for good, but for the dev Worker's pushes (games/dev/), test play, 14 days
  assert.deepEqual(bucket.Properties.LifecycleConfiguration, {
    Rules: [
      {
        Id: "DevPushesExpire",
        Status: "Enabled",
        Prefix: "games/dev/",
        ExpirationInDays: 14,
      },
    ],
  });
  const [tls] = R.GamesBucketPolicy.Properties.PolicyDocument.Statement;
  assert.equal(tls.Effect, "Deny");
  assert.deepEqual(tls.Condition, { Bool: { "aws:SecureTransport": "false" } });
  assert.equal(
    pitches.Parameters.AllowedOrigins.Default,
    "https://throwingwood.com,https://app.throwingwood.com,http://localhost,http://127.0.0.1",
  );
});

test("the api role: exactly its grants, no wildcard resource", () => {
  const st = R.ApiRole.Properties.Policies[0].PolicyDocument.Statement;
  const by = Object.fromEntries(st.filter((s) => s.Sid).map((s) => [s.Sid, s]));
  assert.deepEqual(Object.keys(by).sort(), [
    "Logs",
    "PitchItems",
    "PushSecret",
    "RecordGames",
  ]);
  assert.deepEqual(by.PitchItems.Action, [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
  ]);
  assert.deepEqual(by.PitchItems.Resource, {
    "Fn::GetAtt": ["PitchesTable", "Arn"],
  });
  assert.deepEqual(
    by.PitchItems.Condition["ForAllValues:StringLike"]["dynamodb:LeadingKeys"],
    ["pitch#*", "share#*", "reels#*", "shares#*"],
  );
  assert.equal(by.RecordGames.Action, "s3:PutObject");
  assert.deepEqual(
    by.RecordGames.Resource.map((r) => r["Fn::Sub"]),
    [
      "${GamesBucket.Arn}/games/pitch/*",
      "${GamesBucket.Arn}/games/dev/pitch/*",
      "${GamesBucket.Arn}/games/browser/*",
      "${GamesBucket.Arn}/reports/*",
    ],
  );
  assert.equal(by.PushSecret.Action, "secretsmanager:GetSecretValue");
  assert.deepEqual(by.PushSecret.Resource, { Ref: "PushSecret" });
  assert.deepEqual(by.Logs.Action, [
    "logs:CreateLogStream",
    "logs:PutLogEvents",
  ]);
  const reels = st.find((s) => s["Fn::If"])["Fn::If"];
  assert.equal(reels[0], "HasReels");
  assert.equal(reels[1].Action, "lambda:InvokeFunction");
  assert.deepEqual(reels[1].Resource, { Ref: "ReelsFunctionArn" });
  assert.ok(!JSON.stringify(st).includes('"*"'), "no wildcard resource");
  const env = R.ApiFunction.Properties.Environment.Variables;
  assert.deepEqual(env.TABLE, { Ref: "PitchesTable" });
  assert.deepEqual(env.GAMES_BUCKET, { Ref: "GamesBucket" });
  assert.deepEqual(env.PUSH_SECRET_ARN, { Ref: "PushSecret" });
});

test("the old rooms stack is gone from the repository and the deployment record", async () => {
  await assert.rejects(fs.access("infra/rooms.json"));
  const deployment = await json("infra/deployment.json");
  assert.ok(!("rooms" in deployment));
  assert.ok(!("rooms" in deployment.stacks));
  assert.ok(!("wsRoute" in deployment));
  const site = await json("infra/site.json");
  assert.doesNotMatch(JSON.stringify(site), /RoomsApiDomain|HasRooms|"\/ws"/);
  const delivery = await json("infra/delivery.json");
  assert.doesNotMatch(JSON.stringify(delivery), /RoomsFunctionName|rooms\/\*/);
});

test("on since 2026-11-21; the site and delivery stacks take the pitches stack's names", async () => {
  const deployment = await json("infra/deployment.json");
  assert.equal(deployment.pitchesStack, true);
  assert.equal(deployment.pitches.functionName, "throwing-wood-api");
  assert.match(deployment.pitches.codeKey, /^api\/[0-9a-f]{64}\.zip$/);
  assert.equal(deployment.stacks.pitches, "throwing-wood-pitches");
  assert.equal(deployment.stackTagOverrides.pitches.Project, "throwing-wood");
  assert.ok(!("pitchApi" in deployment));
  const site = await json("infra/site.json");
  assert.match(site.Parameters.ApiDomain.Description, /throwing-wood-pitches/);
  assert.match(site.Parameters.PitchTable.Description, /throwing-wood-pitches/);
  const pages =
    site.Resources.PagesRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.deepEqual(
    pages.find((s) => s.Sid === "ReadPitches").Condition[
      "ForAllValues:StringLike"
    ]["dynamodb:LeadingKeys"],
    ["pitch#*"],
  );
  // the pages and reel functions' TABLE, and their roles' table ARNs, are PitchTable
  assert.doesNotMatch(JSON.stringify(site), /RoomsTable/);
  assert.equal(
    JSON.stringify(site).match(/"TABLE":\{"Ref":"PitchTable"\}/g).length,
    2,
  );
  assert.equal(
    JSON.stringify(site).match(/table\/\$\{PitchTable\}/g).length,
    3,
  );
  const delivery = await json("infra/delivery.json");
  assert.equal(delivery.Parameters.ApiFunctionName.Default, "");
  assert.match(
    delivery.Parameters.ApiFunctionName.Description,
    /throwing-wood-api/,
  );
});

// The naming rule: kubb-xyz lives on only in the two live stacks' templates and the
// deployment record of what is live. Anything else under infra/, the tools and the api
// function names nothing kubb-xyz.
test("no new kubb-xyz names outside the live stacks", async () => {
  const LIVE = new Set([
    "infra/site.json",
    "infra/delivery.json",
    "infra/deployment.json",
  ]);
  const files = [];
  for (const dir of ["infra", "tools", "backend/api"])
    for (const entry of await fs.readdir(dir, {
      recursive: true,
      withFileTypes: true,
    }))
      if (entry.isFile())
        files.push(path.join(entry.parentPath ?? entry.path, entry.name));
  assert.ok(files.includes("infra/pitches.json"));
  for (const file of files) {
    if (LIVE.has(file)) continue;
    assert.doesNotMatch(
      await fs.readFile(file, "utf8"),
      /kubb-xyz/,
      `${file} names kubb-xyz`,
    );
  }
});

test("the pull tools: the pitches games bucket once it is on, its push layout", () => {
  assert.equal(gamesBucketOf({}), null);
  assert.equal(
    gamesBucketOf({ pitchesStack: false, pitches: { gamesBucket: "new" } }),
    null,
  );
  assert.equal(
    gamesBucketOf({ pitchesStack: true, pitches: { gamesBucket: "new" } }),
    "new",
  );
  assert.equal(gamesBucketOf({ pitchesStack: true }), null);
  const push = "games/pitch/abcdefgh/1763700000000/0001-000002.json.gz";
  assert.deepEqual(pulledPath(push), [
    "pitch",
    "abcdefgh",
    "1763700000000",
    "0001-000002.json.gz",
  ]);
  assert.equal(pulledPath(push, { room: "bcdefghj" }), null);
  assert.equal(pulledPath(push, { since: 1763700000001 }), null);
  const browser = "games/browser/2026-11-21/1763700000000-abcd2345.json.gz";
  assert.equal(pulledPath(browser).length, 3);
  assert.equal(pulledPath(browser, { room: "abcdefgh" }), null);
  // test play stays out unless --dev: the dev Worker's pushes and the known test
  // pitches that predate the dev prefix (2026-11-22)
  const devPush = "games/dev/pitch/abcdefgh/1763700000000/0001-000002.json.gz";
  assert.equal(pulledPath(devPush), null);
  assert.deepEqual(pulledPath(devPush, { dev: true }), [
    "dev",
    "pitch",
    "abcdefgh",
    "1763700000000",
    "0001-000002.json.gz",
  ]);
  // one pitch with --dev lists its folder under games/dev/ too: a dev pitch's records
  // are only there
  assert.deepEqual(pullPrefixes(), ["games/"]);
  assert.deepEqual(pullPrefixes({ dev: true }), ["games/"]);
  assert.deepEqual(pullPrefixes({ room: "abcdefgh" }), [
    "games/pitch/abcdefgh/",
  ]);
  assert.deepEqual(pullPrefixes({ room: "abcdefgh", dev: true }), [
    "games/pitch/abcdefgh/",
    "games/dev/pitch/abcdefgh/",
  ]);
  assert.deepEqual(TEST_PITCHES, [
    "qatrnmtgx",
    "qawn6mk9tp",
    "qawnbszxah",
    "qawnyk9xtg",
  ]);
  for (const code of TEST_PITCHES) {
    const key = `games/pitch/${code}/1763800000000/0001-000003.json.gz`;
    assert.equal(pulledPath(key), null, code);
    assert.equal(pulledPath(key, { dev: true }).length, 4, code);
  }
  for (const bad of [
    "games/abcdefgh/1763700000000-000002.json.gz", // the old rooms server's

    "games/pitch/abcdefgh/1763700000000/x.json.gz",
    "games/pitch/ABC/1763700000000/0001-000002.json.gz",
    "reports/2026-11-21/1763700000000-abcd2345.json.gz",
    "games/abcdefgh/notes.txt",
  ])
    assert.equal(pulledPath(bad), null, bad);
});
