// Create or update the site's CloudFormation stacks through change sets.
//
//   node tools/infra.mjs plan  [site] [rooms] [delivery]   print the change sets, execute nothing
//   node tools/infra.mjs apply [site] [rooms] [delivery]   execute them, in that order
//
// With no stack named: site and delivery, and rooms too once the rooms stack
// exists. Name `rooms` to create it.
//
// Run as the cloud-engineer identity in us-east-1. The site stack owns the
// certificate (validated through its own record in the thingelstad.xyz zone),
// the private bucket, the distribution (behind the shared edge web ACL), the
// A and AAAA alias records, the access log and the bucket for the rooms
// function's code; with "wsRoute": true in infra/deployment.json it also
// sends /ws on to the rooms WebSocket API. Once the rooms stack is deployed it
// also runs the pitch pages function (backend/pages, a Lambda Web Function behind
// /p/, /e/ and /og/; docs/HOSTING.md "Pitch pages"): its package is
// tools/pages-bundle.mjs, uploaded to the code bucket under its hash. The rooms stack (infra/rooms.json)
// is the WebSocket API, its function, its table and the private bucket the
// games are recorded in: its code is
// backend/rooms/handler.mjs bundled and zipped by tools/rooms-bundle.mjs,
// uploaded to the code bucket under its hash. The delivery stack owns the
// GitHub OIDC role that publishes main. With "reelRenderer": true in
// infra/deployment.json the site stack also runs the highlight reel function
// (backend/reels, docs/REEL.md, docs/REEL-RUNBOOK.md): its package and ffmpeg layer
// are tools/reels-bundle.mjs's, uploaded to the code bucket under their hashes, and
// the rooms stack is given its ARN to invoke. Each apply rewrites
// infra/deployment.json from the live stack outputs. Infrastructure never
// changes through the delivery role.
import {
  CloudFormationClient,
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  waitUntilChangeSetCreateComplete,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import fs from "node:fs/promises";
import { engineVersion } from "./lua-bundle.mjs";
import { bundlePages } from "./pages-bundle.mjs";
import { bundleReels, ffmpegLayer } from "./reels-bundle.mjs";
import { bundleRooms } from "./rooms-bundle.mjs";
import { syncSiteTemplate } from "./site-template.mjs";

const [mode, ...named] = process.argv.slice(2);
const STACKS = ["site", "rooms", "delivery"];
if (
  !["plan", "apply"].includes(mode) ||
  named.some((name) => !STACKS.includes(name))
)
  throw new Error(
    "Usage: node tools/infra.mjs plan|apply [site] [rooms] [delivery]",
  );
const config = JSON.parse(await fs.readFile("infra/deployment.json", "utf8"));
const settings = { region: config.region, maxAttempts: 5 };
const identity = await new STSClient(settings).send(
  new GetCallerIdentityCommand({}),
);
if (identity.Account !== config.account)
  throw new Error(`Unexpected AWS account ${identity.Account}`);
console.log(`Identity ${identity.Arn}`);
const cfn = new CloudFormationClient(settings);
const Tags = Object.entries(config.stackTags).map(([Key, Value]) => ({
  Key,
  Value,
}));

if (await syncSiteTemplate())
  console.log(
    "Wrote the viewer request function and the CSP into infra/site.json",
  );

async function stack(name) {
  try {
    const { Stacks } = await cfn.send(
      new DescribeStacksCommand({ StackName: name }),
    );
    // A CREATE change set left by `plan` parks a new stack in
    // REVIEW_IN_PROGRESS; it still takes a CREATE change set.
    if (Stacks[0].StackStatus === "REVIEW_IN_PROGRESS") return undefined;
    return Stacks[0];
  } catch (error) {
    if (/does not exist/.test(error.message)) return undefined;
    throw error;
  }
}
const outputs = (s) =>
  Object.fromEntries(
    (s?.Outputs || []).map((o) => [o.OutputKey, o.OutputValue]),
  );

async function converge(name, file, parameters = {}, capabilities = []) {
  const existing = await stack(name);
  const type = existing ? "UPDATE" : "CREATE";
  const ChangeSetName = `${mode}-${Date.now()}`;
  await cfn.send(
    new CreateChangeSetCommand({
      StackName: name,
      ChangeSetName,
      ChangeSetType: type,
      TemplateBody: await fs.readFile(`infra/${file}.json`, "utf8"),
      Parameters: Object.entries(parameters).map(
        ([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }),
      ),
      Capabilities: capabilities,
      Tags,
    }),
  );
  try {
    await waitUntilChangeSetCreateComplete(
      { client: cfn, maxWaitTime: 300 },
      { StackName: name, ChangeSetName },
    );
  } catch (error) {
    const { StatusReason } = await cfn.send(
      new DescribeChangeSetCommand({ StackName: name, ChangeSetName }),
    );
    if (
      /didn't contain changes|No updates are to be performed/.test(
        StatusReason || "",
      )
    ) {
      console.log(`${name}: no changes`);
      await cfn.send(
        new DeleteChangeSetCommand({ StackName: name, ChangeSetName }),
      );
      return existing;
    }
    throw new Error(`${name}: ${StatusReason || error.message}`, {
      cause: error,
    });
  }
  const { Changes } = await cfn.send(
    new DescribeChangeSetCommand({ StackName: name, ChangeSetName }),
  );
  console.log(`${name} (${type}):`);
  for (const c of Changes)
    console.log(
      `  ${c.ResourceChange.Action} ${c.ResourceChange.LogicalResourceId} ${c.ResourceChange.ResourceType}${c.ResourceChange.Replacement === "True" ? " (REPLACEMENT)" : ""}`,
    );
  if (mode === "plan") return existing;
  await cfn.send(
    new ExecuteChangeSetCommand({ StackName: name, ChangeSetName }),
  );
  const wait =
    type === "CREATE"
      ? waitUntilStackCreateComplete
      : waitUntilStackUpdateComplete;
  // A new certificate waits for DNS validation inside the stack, and a new
  // distribution takes several minutes to deploy.
  await wait({ client: cfn, maxWaitTime: 3600 }, { StackName: name });
  return stack(name);
}

// The rooms API's address from its stack: wss://<domain>/<stage>.
function roomsFrom(out) {
  if (!out.WebSocketUrl) return null;
  const url = new URL(out.WebSocketUrl);
  return {
    functionName: out.FunctionName || null,
    gamesBucket: out.GamesBucket || null,
    webSocketUrl: out.WebSocketUrl,
    apiDomain: url.hostname,
    stage: url.pathname.replace(/^\/|\/$/g, ""),
  };
}

let rooms = roomsFrom(outputs(await stack(config.stacks.rooms)));
const selected = named.length
  ? named
  : ["site", ...(rooms ? ["rooms"] : []), "delivery"];
if (config.wsRoute && !rooms && selected.includes("site"))
  throw new Error(
    'infra/deployment.json has "wsRoute": true but the rooms stack is not deployed: apply rooms first',
  );

let site = outputs(await stack(config.stacks.site));
let pagesKey = config.pages?.codeKey || null;
let reelKeys = config.reels
  ? { codeKey: config.reels.codeKey, layerKey: config.reels.layerKey }
  : null;
// The engine the reel function carries: the vendored one, major.minor.
const reelEngines = engineVersion().split(".").slice(0, 2).join(".");
if (selected.includes("site")) {
  // The pages function reads the rooms table: none until the rooms stack is there.
  const table = outputs(await stack(config.stacks.rooms)).TableName || "";
  if (table && site.CodeBucket) {
    const bundle = await bundlePages();
    pagesKey = bundle.key;
    console.log(`Pages bundle ${bundle.key} (${bundle.zip.length} bytes)`);
    if (mode === "apply")
      await new S3Client(settings).send(
        new PutObjectCommand({
          Bucket: site.CodeBucket,
          Key: bundle.key,
          Body: bundle.zip,
          ContentType: "application/zip",
        }),
      );
  }
  // The highlight reel function, only when deployment.json asks for it.
  reelKeys = null;
  if (config.reelRenderer && table && site.CodeBucket) {
    const fn = await bundleReels();
    const layer = await ffmpegLayer();
    reelKeys = { codeKey: fn.key, layerKey: layer.key };
    console.log(`Reels bundle ${fn.key} (${fn.zip.length} bytes)`);
    console.log(`Reels ffmpeg layer ${layer.key} (${layer.zip.length} bytes)`);
    if (mode === "apply")
      for (const b of [fn, layer])
        await new S3Client(settings).send(
          new PutObjectCommand({
            Bucket: site.CodeBucket,
            Key: b.key,
            Body: b.zip,
            ContentType: "application/zip",
          }),
        );
  }
  site = outputs(
    await converge(
      config.stacks.site,
      "site",
      {
        RoomsApiDomain: config.wsRoute ? rooms.apiDomain : "",
        RoomsStage: config.wsRoute ? rooms.stage : "prod",
        PagesCodeKey: table && site.CodeBucket ? pagesKey : "",
        RoomsTable: table && site.CodeBucket ? table : "",
        ReelsCodeKey: reelKeys?.codeKey ?? "",
        ReelsLayerKey: reelKeys?.layerKey ?? "",
        ReelEngines: reelKeys ? reelEngines : "",
      },
      ["CAPABILITY_IAM"],
    ),
  );
}

let codeKey = config.rooms?.codeKey || null;
if (selected.includes("rooms")) {
  if (!site.CodeBucket)
    throw new Error("The rooms stack waits for the site stack's code bucket");
  const bundle = await bundleRooms();
  codeKey = bundle.key;
  console.log(`Rooms bundle ${bundle.key} (${bundle.zip.length} bytes)`);
  if (mode === "apply")
    await new S3Client(settings).send(
      new PutObjectCommand({
        Bucket: site.CodeBucket,
        Key: bundle.key,
        Body: bundle.zip,
        ContentType: "application/zip",
      }),
    );
  rooms =
    roomsFrom(
      outputs(
        await converge(
          config.stacks.rooms,
          "rooms",
          {
            CodeBucket: site.CodeBucket,
            CodeKey: bundle.key,
            // the reel function the site stack runs, or none
            ReelsFunctionArn: site.ReelsFunctionArn || "",
            ReelEngines: site.ReelEngines || "",
          },
          ["CAPABILITY_IAM"],
        ),
      ),
    ) || rooms;
}

let delivery = outputs(await stack(config.stacks.delivery));
if (selected.includes("delivery")) {
  if (!site.DistributionId) {
    console.log("Plan only: the delivery stack waits for the site stack.");
    process.exit(0);
  }
  delivery = outputs(
    await converge(
      config.stacks.delivery,
      "delivery",
      {
        SiteBucket: site.SiteBucket,
        DistributionId: site.DistributionId,
        CodeBucket: site.CodeBucket,
        RoomsFunctionName:
          rooms?.functionName || `${config.stacks.rooms}-rooms`,
        RepositoryId: config.githubRepositoryId || "",
      },
      ["CAPABILITY_IAM"],
    ),
  );
}

if (mode === "apply") {
  const next = {
    ...config,
    siteBucket: site.SiteBucket || null,
    codeBucket: site.CodeBucket || null,
    distributionId: site.DistributionId || null,
    cloudfrontDomain: site.DistributionDomain || null,
    certificateArn: site.CertificateArn || null,
    deploymentRoleArn: delivery.DeploymentRoleArn || null,
    rooms: rooms ? { ...rooms, codeKey } : null,
    pages: site.PagesEndpoint
      ? {
          codeKey: pagesKey,
          endpointDomain: site.PagesEndpoint,
          revisionId: site.PagesRevision || null,
        }
      : null,
    reels: site.ReelsFunctionArn
      ? {
          functionArn: site.ReelsFunctionArn,
          engines: site.ReelEngines || null,
          ...reelKeys,
        }
      : null,
  };
  await fs.writeFile(
    "infra/deployment.json",
    JSON.stringify(next, null, 2) + "\n",
  );
  console.log("Wrote infra/deployment.json");
  if (delivery.DeploymentRoleArn)
    console.log(
      `GitHub repository variable AWS_DEPLOY_ROLE_ARN = ${delivery.DeploymentRoleArn}`,
    );
}
