// The pitches stack (infra/pitches.json, throwing-wood-pitches): what it creates, the
// api role's exact grants, the table and games bucket set as the rooms stack's are, the
// cutover wiring in the site and delivery stacks, and the naming rule (AGENTS.md
// "Hosting": everything new is throwing-wood-*, no new kubb-xyz name).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { gamesBucketOf, pulledPath } from "../../tools/games.mjs";

const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const pitches = await json("infra/pitches.json");
const rooms = await json("infra/rooms.json");
const R = pitches.Resources;

test("the pitches stack: exactly these resources, named throwing-wood", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(R).map(([id, r]) => [id, r.Type])),
    {
      PitchesTable: "AWS::DynamoDB::Table",
      GamesBucket: "AWS::S3::Bucket",
      GamesBucketPolicy: "AWS::S3::BucketPolicy",
      PushSecret: "AWS::SecretsManager::Secret",
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

test("the pitches table and games bucket are set as the rooms stack's", () => {
  assert.deepEqual(R.PitchesTable, rooms.Resources.RoomsTable);
  assert.equal(
    R.PitchesTable.Properties.PointInTimeRecoverySpecification,
    undefined,
  );
  const mine = R.GamesBucket;
  const old = rooms.Resources.GamesBucket;
  assert.equal(mine.DeletionPolicy, old.DeletionPolicy);
  assert.equal(mine.UpdateReplacePolicy, old.UpdateReplacePolicy);
  for (const key of [
    "BucketEncryption",
    "PublicAccessBlockConfiguration",
    "OwnershipControls",
    "VersioningConfiguration",
    "LifecycleConfiguration",
  ])
    assert.deepEqual(mine.Properties[key], old.Properties[key], key);
  assert.deepEqual(
    R.GamesBucketPolicy.Properties.PolicyDocument,
    rooms.Resources.GamesBucketPolicy.Properties.PolicyDocument,
  );
  assert.equal(
    pitches.Parameters.AllowedOrigins.Default,
    rooms.Parameters.AllowedOrigins.Default,
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

test("the rooms stack is back to what is deployed: no api in it", () => {
  const text = JSON.stringify(rooms);
  assert.doesNotMatch(text, /ApiCodeKey|ApiFunction|PushSecret|HasApi/);
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

// The naming rule: kubb-xyz lives on only in the three live stacks' templates and the
// deployment record of what is live. Anything else under infra/, the tools and the api
// function names nothing kubb-xyz.
test("no new kubb-xyz names outside the live stacks", async () => {
  const LIVE = new Set([
    "infra/site.json",
    "infra/rooms.json",
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
  const rooms = { gamesBucket: "old" };
  assert.equal(gamesBucketOf({ rooms }), "old");
  assert.equal(
    gamesBucketOf({
      rooms,
      pitchesStack: false,
      pitches: { gamesBucket: "new" },
    }),
    "old",
  );
  assert.equal(
    gamesBucketOf({
      rooms,
      pitchesStack: true,
      pitches: { gamesBucket: "new" },
    }),
    "new",
  );
  assert.equal(gamesBucketOf({ rooms, pitchesStack: true }), "old");
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
  const room = "games/abcdefgh/1763700000000-000002.json.gz";
  assert.deepEqual(pulledPath(room, { room: "abcdefgh" }), [
    "abcdefgh",
    "1763700000000-000002.json.gz",
  ]);
  for (const bad of [
    "games/pitch/abcdefgh/1763700000000/x.json.gz",
    "games/pitch/ABC/1763700000000/0001-000002.json.gz",
    "reports/2026-11-21/1763700000000-abcd2345.json.gz",
    "games/abcdefgh/notes.txt",
  ])
    assert.equal(pulledPath(bad), null, bad);
});
