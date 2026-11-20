// Publish dist/ to the site bucket, refresh CloudFront, check the live bytes,
// and bring the rooms function's code up to date.
//
//   KUBB_PRODUCTION=true npm run build && npm run deploy
//
// It runs in the GitHub deploy job, as the delivery role, for the current
// head of main; or by hand on Otto as the cloud-engineer identity (the
// first publish, before the repository exists). Either way it refuses a build
// that is not the deploy build.
//
// An old hashed asset stays published, so a page a
// browser still holds keeps loading the client it was built with.
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
  waitUntilInvalidationCompleted,
} from "@aws-sdk/client-cloudfront";
import {
  LambdaClient,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
  waitUntilFunctionUpdatedV2,
} from "@aws-sdk/client-lambda";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  associationKey,
  MARKERS,
  prepareObject,
  publicationOrder,
} from "./delivery-plan.mjs";
import { bundlePages } from "./pages-bundle.mjs";
import { bundleRooms } from "./rooms-bundle.mjs";

const REPOSITORY = "jthingelstad/kubb.thingelstad.xyz";
const LOCAL_ROLE = ":assumed-role/ProjectsCloudEngineer/";
const ci = process.env.GITHUB_ACTIONS === "true";
const config = JSON.parse(await fs.readFile("infra/deployment.json", "utf8"));
if (
  ci &&
  (process.env.GITHUB_REPOSITORY !== REPOSITORY ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || ""))
)
  throw new Error("Only this repository's main branch publishes");
if (!config.distributionId || !config.siteBucket)
  throw new Error(
    "infra/deployment.json is incomplete; run npm run infra:apply first",
  );
const settings = { region: config.region, maxAttempts: 5 };
const identity = await new STSClient(settings).send(
  new GetCallerIdentityCommand({}),
);
if (identity.Account !== config.account)
  throw new Error("Unexpected AWS account");
if (ci) {
  const expectedRole = config.deploymentRoleArn?.split("/").at(-1);
  if (!expectedRole || !identity.Arn.includes(`:assumed-role/${expectedRole}/`))
    throw new Error("Unexpected deployment identity");
} else if (!identity.Arn.includes(LOCAL_ROLE))
  throw new Error(
    "A publish from this machine runs as the cloud-engineer identity",
  );

async function assertCurrentHead() {
  if (!ci) return;
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/git/ref/heads/main`,
    {
      headers: {
        authorization: `Bearer ${process.env.GH_TOKEN}`,
        accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (
    !response.ok ||
    (await response.json()).object.sha !== process.env.GITHUB_SHA
  )
    throw new Error("Refusing to publish a superseded main revision");
}
await assertCurrentHead();
const revision = JSON.parse(await fs.readFile("dist/revision.json", "utf8"));
if (!revision.production)
  throw new Error(
    "dist/ is not the deploy build: KUBB_PRODUCTION=true npm run build",
  );
if (ci && revision.commit !== process.env.GITHUB_SHA)
  throw new Error("Build does not match this commit");

async function files(folder) {
  const result = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const name = path.join(folder, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Symlink in publication output: ${name}`);
    if (entry.isDirectory()) result.push(...(await files(name)));
    else result.push(path.relative("dist", name).split(path.sep).join("/"));
  }
  return result;
}

const s3 = new S3Client(settings);
const cdn = new CloudFrontClient(settings);
let uploaded = 0;
let unchanged = 0;
async function upload(key) {
  const object = prepareObject(key, await fs.readFile(path.join("dist", key)));
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: config.siteBucket, Key: key }),
    );
    if (
      head.Metadata?.sha256 === object.Metadata.sha256 &&
      head.ContentType === object.ContentType &&
      head.CacheControl === object.CacheControl &&
      !head.ContentEncoding
    ) {
      unchanged++;
      return;
    }
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
  }
  await s3.send(
    new PutObjectCommand({ Bucket: config.siteBucket, Key: key, ...object }),
  );
  uploaded++;
}

// Assets and scripts first, then pages, then the revision and version
// markers, so a page never points at a file that is not there yet and no open
// tab is told of a release before its pages are up.
const ordered = publicationOrder(await files("dist"));
// A later deploy without the team variable also withdraws a published association.
if (!ordered.includes(associationKey)) {
  const object = { Bucket: config.siteBucket, Key: associationKey };
  let exists = true;
  try {
    await s3.send(new HeadObjectCommand(object));
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
    exists = false;
  }
  if (exists) await s3.send(new DeleteObjectCommand(object));
}
for (const group of [
  ordered.filter((k) => !k.endsWith(".html") && !MARKERS.includes(k)),
  ordered.filter((k) => k.endsWith(".html")),
  MARKERS,
]) {
  await assertCurrentHead();
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < group.length) await upload(group[next++]);
    }),
  );
}

const invalidation = await cdn.send(
  new CreateInvalidationCommand({
    DistributionId: config.distributionId,
    InvalidationBatch: {
      CallerReference: ci
        ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
        : `local-${Date.now()}`,
      Paths: { Quantity: 1, Items: ["/*"] },
    },
  }),
);
await waitUntilInvalidationCompleted(
  { client: cdn, maxWaitTime: 900, minDelay: 10 },
  { DistributionId: config.distributionId, Id: invalidation.Invalidation.Id },
);

// The rooms function's code, when the rooms stack exists and its bundle
// changed since the last deploy (or infra:apply rooms).
let rooms = "not deployed";
if (config.rooms?.functionName) {
  const lambda = new LambdaClient(settings);
  const bundle = await bundleRooms();
  const live = await lambda.send(
    new GetFunctionCommand({ FunctionName: config.rooms.functionName }),
  );
  if (live.Configuration.CodeSha256 === bundle.codeSha256) rooms = "unchanged";
  else {
    await assertCurrentHead();
    await s3.send(
      new PutObjectCommand({
        Bucket: config.codeBucket,
        Key: bundle.key,
        Body: bundle.zip,
        ContentType: "application/zip",
      }),
    );
    await lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: config.rooms.functionName,
        S3Bucket: config.codeBucket,
        S3Key: bundle.key,
      }),
    );
    await waitUntilFunctionUpdatedV2(
      { client: lambda, maxWaitTime: 300 },
      { FunctionName: config.rooms.functionName },
    );
    rooms = `updated to ${bundle.key}`;
  }
}

// The pitch pages function is the site stack's (a web function revision names its
// package), so a deploy only says when its code has moved on: the delivery role
// never changes infrastructure, and npm run infra:apply -- site brings it live.
let pages = "not deployed";
if (config.pages?.codeKey) {
  const { key } = await bundlePages();
  pages =
    key === config.pages.codeKey
      ? "unchanged"
      : `differs (${key}): npm run infra:apply -- site`;
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const live = async (route) => {
  const response = await fetch(new URL(route, config.productionUrl), {
    signal: AbortSignal.timeout(30000),
  });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
};
const page = await fs.readFile("dist/pitch/index.html", "utf8");
const wasm = JSON.parse(
  page.match(/id="kubb-config">(.*?)<\/script>/s)[1],
).wasmUrl;
for (const [route, file] of [
  ["/", "index.html"],
  ["/web/", "web/index.html"],
  ["/rules/", "rules/index.html"],
  ["/practice/", "practice/index.html"],
  ["/p/abcd2345", "pitch/index.html"],
  ["/style.css", "style.css"],
  [wasm, wasm.slice(1)],
  ["/revision.json", "revision.json"],
  ["/version.json", "version.json"],
  ...(ordered.includes(associationKey)
    ? [["/" + associationKey, associationKey]]
    : []),
]) {
  const { response, bytes } = await live(route);
  if (
    !response.ok ||
    sha(bytes) !== sha(await fs.readFile(path.join("dist", file)))
  )
    throw new Error(`Published bytes differ: ${route} (${response.status})`);
  if (
    file === associationKey &&
    (response.redirected ||
      response.headers.get("content-type") !== "application/json")
  )
    throw new Error("The pitch association must serve JSON directly");
  if (
    route === wasm &&
    response.headers.get("content-type") !== "application/wasm"
  )
    throw new Error(
      `The Lua VM is served as ${response.headers.get("content-type")}`,
    );
}
// The deployed release must never be cached, by CloudFront or a browser.
const version = await live("/version.json");
if (
  !/no-store/.test(version.response.headers.get("cache-control") || "") ||
  /^Hit/i.test(version.response.headers.get("x-cache") || "")
)
  throw new Error(
    `version.json is cacheable: ${version.response.headers.get("cache-control")}, ${version.response.headers.get("x-cache")}`,
  );
const missing = await live("/no-such-page/");
if (
  missing.response.status !== 404 ||
  !missing.bytes.toString().includes("There is no page at this address")
)
  throw new Error(`The 404 page is not served (${missing.response.status})`);

console.log(
  JSON.stringify({
    commit: revision.commit,
    uploaded,
    unchanged,
    url: config.productionUrl,
    invalidation: invalidation.Invalidation.Id,
    rooms,
    pages,
  }),
);
