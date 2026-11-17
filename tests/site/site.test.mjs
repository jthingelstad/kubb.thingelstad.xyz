// The site's own pieces: the viewer request function, the pitch code, the
// templates, the delivery plan and the rooms bundle.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import zlib from "node:zlib";
import { loadViewerRequest, cloudfrontRequest } from "../../tools/preview.mjs";
import { cacheControl, prepareObject } from "../../tools/delivery-plan.mjs";
import { expectedTemplate } from "../../tools/site-template.mjs";
import { zipOne } from "../../tools/rooms-bundle.mjs";
import {
  contentSecurityPolicy,
  embedSecurityPolicy,
} from "../../src/site/csp.mjs";
import { zipFiles } from "../../tools/pages-bundle.mjs";
import { pitchCode } from "../../src/site/config.js";
import { CODE_ALPHABET, CODE_LENGTH, ref } from "../../src/site/site.mjs";
import { ROOM_CODE } from "../../backend/rooms/core.mjs";

const json = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const viewer = await loadViewerRequest();
const request = (address) =>
  viewer({ request: cloudfrontRequest(new URL(address, "https://x")) });

test("a pitch at any code is the one game page", () => {
  assert.equal(request("/p/abcd2345").uri, "/pitch/index.html");
  assert.equal(request("/p/abcd2345/").uri, "/pitch/index.html");
  assert.equal(request("/p/abcd2345?solo=1").uri, "/pitch/index.html");
  assert.equal(request("/p/abcd2345?watch=1").uri, "/pitch/index.html");
  // Not a pitch code: on to the 404 by the ordinary routes.
  assert.equal(request("/p/ABCDEFGH").statusCode, 301);
  assert.equal(request("/p/abc").statusCode, 301);
});

test("/p and /p/ go on to a new pitch, keeping the query", () => {
  for (const address of ["/p", "/p/", "/p/?solo=1", "/p/?watch=1"]) {
    const result = request(address);
    assert.equal(result.statusCode, 302);
    const location = result.headers.location.value;
    assert.match(location, /^\/p\/[2-9a-hjkmnp-z]{8}(\?(solo|watch)=1)?$/);
    assert.equal(location.includes("solo=1"), address.includes("solo"));
    assert.equal(location.includes("watch=1"), address.includes("watch"));
    assert.equal(request(location).uri, "/pitch/index.html");
  }
});

test("an embed and a share image at any code, each with the code as ?pitch=", () => {
  for (const [address, uri, code] of [
    ["/p/abcd2345", "/pitch/index.html", "abcd2345"],
    ["/p/abcd2345/?solo=1", "/pitch/index.html", "abcd2345"],
    ["/e/abcd2345", "/embed/index.html", "abcd2345"],
    ["/e/abcd2345/", "/embed/index.html", "abcd2345"],
    ["/og/abcd2345.png", "/share/kubb.png", "abcd2345"],
    ["/og/abcd2345.png?v=12", "/share/kubb.png", "abcd2345"],
  ]) {
    const result = request(address);
    assert.equal(result.uri, uri, address);
    assert.equal(result.querystring.pitch.value, code, address);
  }
  // a viewer's own ?pitch= never names another pitch
  assert.equal(
    request("/e/abcd2345?pitch=zzzzzzzz").querystring.pitch.value,
    "abcd2345",
  );
  // not a code: the ordinary routes, on to the 404
  assert.equal(request("/e/ABCDEFGH").statusCode, 301);
  assert.equal(request("/og/abcd2345.jpg").uri, "/og/abcd2345.jpg");
  assert.equal(request("/og/ABCDEFGH.png").uri, "/og/ABCDEFGH.png");
  assert.equal(request("/embed/").uri, "/embed/index.html");
});

test("directories serve index.html; other paths get the slash", () => {
  assert.equal(request("/").uri, "/index.html");
  assert.equal(request("/rules/").uri, "/rules/index.html");
  assert.equal(request("/style.css").uri, "/style.css");
  const moved = request("/rules?ref=x");
  assert.equal(moved.statusCode, 301);
  assert.equal(moved.headers.location.value, "/rules/?ref=x");
});

test("one pitch code alphabet everywhere, and the rooms accept its codes", async () => {
  assert.equal(CODE_ALPHABET.length, 31);
  assert.doesNotMatch(CODE_ALPHABET, /[ilo01]/);
  const start = await fs.readFile("public/js/start.js", "utf8");
  const fn = await fs.readFile("infra/viewer-request.js", "utf8");
  assert.ok(start.includes(`"${CODE_ALPHABET}"`), "start.js");
  assert.ok(fn.includes(`"${CODE_ALPHABET}"`), "viewer-request.js");
  assert.ok(start.includes(`LENGTH = ${CODE_LENGTH}`));
  for (const c of CODE_ALPHABET)
    assert.match(c.repeat(CODE_LENGTH), ROOM_CODE, `the rooms refuse ${c}`);
  assert.equal(pitchCode("/p/abcd2345"), "abcd2345");
  assert.equal(pitchCode("/practice/"), null);
});

test("infra/site.json carries the viewer request function and the CSP", async () => {
  assert.equal(
    await expectedTemplate(),
    await fs.readFile("infra/site.json", "utf8"),
    "run node tools/site-template.mjs",
  );
  const csp = contentSecurityPolicy();
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp, /connect-src [^;]*wss:\/\/kubb\.thingelstad\.xyz/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.ok(csp.length < 1700, "CloudFront's CSP header limit");
});

test("the site stack: edge web ACL, logs, and the optional /ws route", async () => {
  const site = await json("infra/site.json");
  const config = site.Resources.Distribution.Properties.DistributionConfig;
  assert.deepEqual(config.WebACLId, {
    "Fn::ImportValue": "edge-waf-WebAclArn",
  });
  assert.equal(site.Resources.AccessLogGroup.Properties.RetentionInDays, 731);
  const fields = site.Resources.AccessLogDelivery.Properties.RecordFields;
  assert.ok(!fields.some((f) => /c-ip|cs-uri-query/.test(f)), "IP-free log");
  const ws = config.CacheBehaviors[0]["Fn::If"];
  assert.equal(ws[0], "HasRooms");
  assert.equal(ws[1].PathPattern, "/ws");
  // CachingDisabled and AllViewerExceptHostHeader (AWS managed policies).
  assert.equal(ws[1].CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  assert.equal(
    ws[1].OriginRequestPolicyId,
    "b689b0a8-53d0-40ab-baf2-68738e2966ac",
  );
  assert.equal(site.Parameters.RoomsApiDomain.Default, "");
  // No em dash in any name or description.
  assert.doesNotMatch(JSON.stringify(site), /\u2014/);
  assert.doesNotMatch(
    JSON.stringify(await json("infra/delivery.json")),
    /\u2014/,
  );
});

test("only /e/ may be framed; every other route keeps DENY and 'none'", async () => {
  const site = await json("infra/site.json");
  const R = site.Resources;
  const policy = (name) =>
    R[name].Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
  assert.equal(policy("Headers").FrameOptions.FrameOption, "DENY");
  assert.match(
    policy("Headers").ContentSecurityPolicy.ContentSecurityPolicy,
    /frame-ancestors 'none'$/,
  );
  // the embed's headers: the site's security headers, frame-ancestors *, and no
  // frame options, set by its viewer response function on either origin
  const code = R.EmbedResponseFunction.Properties.FunctionCode;
  const handler = new Function(`${code}; return handler;`)();
  const out = handler({
    response: {
      statusCode: 200,
      headers: { "x-frame-options": { value: "DENY" } },
    },
  }).headers;
  assert.equal(out["x-frame-options"], undefined);
  assert.equal(out["content-security-policy"].value, embedSecurityPolicy());
  assert.equal(out["x-content-type-options"].value, "nosniff");
  assert.equal(
    out["referrer-policy"].value,
    policy("Headers").ReferrerPolicy.ReferrerPolicy,
  );
  assert.equal(
    out["strict-transport-security"].value,
    `max-age=${policy("Headers").StrictTransportSecurity.AccessControlMaxAgeSec}`,
  );
  assert.match(embedSecurityPolicy(), /frame-ancestors \*$/);
  // the embed's policy is the site's in every other directive
  assert.equal(
    embedSecurityPolicy().replace("frame-ancestors *", ""),
    contentSecurityPolicy().replace("frame-ancestors 'none'", ""),
  );
  const config = R.Distribution.Properties.DistributionConfig;
  assert.deepEqual(config.DefaultCacheBehavior.ResponseHeadersPolicyId, {
    Ref: "Headers",
  });
  const behaviors = Object.fromEntries(
    config.CacheBehaviors.filter((b) => b.PathPattern).map((b) => [
      b.PathPattern,
      b,
    ]),
  );
  assert.deepEqual(Object.keys(behaviors).sort(), ["/e/*", "/og/*", "/p/*"]);
  for (const [path, b] of Object.entries(behaviors)) {
    if (path === "/e/*") {
      assert.equal(b.ResponseHeadersPolicyId, undefined);
      assert.deepEqual(b.FunctionAssociations[1], {
        EventType: "viewer-response",
        FunctionARN: {
          "Fn::GetAtt": [
            "EmbedResponseFunction",
            "FunctionMetadata.FunctionARN",
          ],
        },
      });
    } else assert.deepEqual(b.ResponseHeadersPolicyId, { Ref: "Headers" });
    // the pages function when it is there, the static pages when it is not
    assert.deepEqual(b.TargetOriginId, {
      "Fn::If": ["HasPages", "pages-or-static", "website"],
    });
    assert.deepEqual(b.AllowedMethods, ["GET", "HEAD"]);
    assert.equal(
      b.FunctionAssociations[0].FunctionARN["Fn::GetAtt"][0],
      "ViewerRequestFunction",
    );
  }
  // a failing function falls over to the static page
  const group = config.OriginGroups["Fn::If"][1].Items[0];
  assert.deepEqual(
    group.Members.Items.map((m) => m.OriginId),
    ["pages", "website"],
  );
  assert.ok(group.FailoverCriteria.StatusCodes.Items.includes(502));
  // the cache key: the code and the image's version, nothing from the viewer
  const key =
    R.PagesCachePolicy.Properties.CachePolicyConfig
      .ParametersInCacheKeyAndForwardedToOrigin;
  assert.deepEqual(key.QueryStringsConfig.QueryStrings, ["pitch", "v"]);
  assert.equal(key.CookiesConfig.CookieBehavior, "none");
  assert.equal(key.HeadersConfig.HeaderBehavior, "none");
});

test("the pages function reads one table and nothing else; only the distribution invokes it", async () => {
  const site = await json("infra/site.json");
  const R = site.Resources;
  const statements =
    R.PagesRole.Properties.Policies[0].PolicyDocument.Statement;
  const actions = statements.flatMap((s) => [s.Action].flat());
  assert.deepEqual(actions.sort(), [
    "dynamodb:GetItem",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
  ]);
  assert.ok(!JSON.stringify(R.PagesRole).includes("s3:"), "no bucket");
  const grant = R.PagesAccess.Properties.PolicyDocument.Statement;
  assert.equal(grant.length, 1);
  assert.equal(grant[0].Principal.Service, "cloudfront.amazonaws.com");
  assert.equal(grant[0].Action, "lambda:InvokeWebFunctionEndpoint");
  assert.match(
    grant[0].Condition.StringEquals["aws:SourceArn"]["Fn::Sub"],
    /:distribution\/\$\{Distribution\}$/,
  );
  assert.equal(R.PagesEndpoint.Properties.AuthType, "IamAuth");
  const read = R.CodeBucketPolicy.Properties.PolicyDocument.Statement.find(
    (s) => s.Sid === "LambdaReadsPagesRevisions",
  );
  assert.match(read.Resource["Fn::Sub"], /\/pages\/\*$/);
  for (const name of [
    "PagesRole",
    "PagesFunction",
    "PagesRevision",
    "PagesEndpoint",
    "PagesAccess",
    "PagesOriginAccess",
  ])
    assert.equal(R[name].Condition, "HasPages", name);
});

test("the pages zip is the same bytes every time and lists its files", () => {
  const entries = [
    { name: "index.js", data: Buffer.from("export {};\n") },
    { name: "package.json", data: Buffer.from('{"type":"module"}\n') },
  ];
  const a = zipFiles(entries);
  assert.deepEqual(a, zipFiles([...entries].reverse()));
  assert.equal(a.readUInt32LE(a.length - 22), 0x06054b50);
  assert.equal(a.readUInt16LE(a.length - 22 + 10), 2);
});

test("the delivery role trusts only main of this repository", async () => {
  const delivery = await json("infra/delivery.json");
  const trust = JSON.stringify(
    delivery.Resources.DeploymentRole.Properties.AssumeRolePolicyDocument,
  );
  assert.ok(trust.includes("repo:jthingelstad@5351/kubb.thingelstad.xyz@"));
  assert.equal(trust.match(/ref:refs\/heads\/main/g).length, 2);
  assert.doesNotMatch(trust, /pull_request|environment:/);
  const deployment = await json("infra/deployment.json");
  assert.equal(deployment.stackTags.Project, "kubb-xyz");
  assert.equal(
    deployment.stackTags.Repository,
    "jthingelstad/kubb.thingelstad.xyz",
  );
});

test("published files are typed and cached right", () => {
  const wasm = prepareObject("assets/glue-abc.wasm", Buffer.from("x"));
  assert.equal(wasm.ContentType, "application/wasm");
  assert.equal(wasm.CacheControl, "public, max-age=31536000, immutable");
  assert.equal(
    cacheControl("index.html"),
    "public, max-age=0, s-maxage=60, must-revalidate",
  );
  assert.equal(
    cacheControl("pitch/index.html"),
    "public, max-age=0, s-maxage=60, must-revalidate",
  );
  assert.throws(() => prepareObject("../x.html", Buffer.from("")));
  // the deployed release: never kept by CloudFront or a browser
  assert.match(cacheControl("version.json"), /no-store/);
  assert.equal(
    prepareObject("version.json", Buffer.from("{}")).ContentType,
    "application/json; charset=utf-8",
  );
});

test("the rooms zip is the same bytes every time and unzips", () => {
  const data = Buffer.from("export const handler = async () => ({});\n");
  const a = zipOne("index.mjs", data);
  assert.ok(a.equals(zipOne("index.mjs", data)));
  // One deflated entry named index.mjs, right after the local header.
  assert.equal(a.readUInt32LE(0), 0x04034b50);
  const nameLength = a.readUInt16LE(26);
  assert.equal(a.subarray(30, 30 + nameLength).toString(), "index.mjs");
  const size = a.readUInt32LE(18);
  const body = a.subarray(30 + nameLength, 30 + nameLength + size);
  assert.ok(zlib.inflateRawSync(body).equals(data));
});

test("links to Jamie's other sites carry ?ref=kubb-<placement>", () => {
  assert.equal(ref("https://x.test/", "home"), "https://x.test/?ref=kubb-home");
  assert.equal(
    ref("https://x.test/?a=1", "footer"),
    "https://x.test/?a=1&ref=kubb-footer",
  );
});
