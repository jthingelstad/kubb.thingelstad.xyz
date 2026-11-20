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
import { contentHash, zipFiles } from "../../tools/pages-bundle.mjs";
import { pitchCode } from "../../src/site/config.js";
import { CODE_ALPHABET, CODE_LENGTH, ref } from "../../src/site/site.mjs";
import { ROOM_CODE } from "../../backend/rooms/core.mjs";
import { releaseOf } from "../../tools/build.mjs";
import { carriedEngines } from "../../tools/lua-bundle.mjs";
import { footer } from "../../src/site/layout.mjs";

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

test("the old address and www move to throwingwood.com, path and query kept", () => {
  for (const old of [
    "https://kubb.thingelstad.xyz",
    "https://www.throwingwood.com",
  ]) {
    for (const path of [
      "/",
      "/p/abcd2345?solo=1",
      "/e/abcd2345",
      "/og/abcd2345.png?v=3",
      "/practice/",
    ]) {
      const result = request(old + path);
      assert.equal(result.statusCode, 301, old + path);
      assert.equal(
        result.headers.location.value,
        "https://throwingwood.com" + path,
      );
    }
  }
  // the new address, and any other host (the preview), are served as before
  assert.equal(
    request("https://throwingwood.com/p/abcd2345").uri,
    "/pitch/index.html",
  );
  assert.equal(
    request("http://127.0.0.1:4322/p/abcd2345").uri,
    "/pitch/index.html",
  );
});

test("the certificate, aliases and records cover throwingwood.com, www and the old address", async () => {
  const R = (await json("infra/site.json")).Resources;
  const names = [
    "throwingwood.com",
    "www.throwingwood.com",
    "kubb.thingelstad.xyz",
  ];
  assert.deepEqual(R.Distribution.Properties.DistributionConfig.Aliases, names);
  const cert = R.Certificate.Properties;
  assert.deepEqual([cert.DomainName, ...cert.SubjectAlternativeNames], names);
  assert.deepEqual(
    cert.DomainValidationOptions.map((o) => o.DomainName),
    names,
  );
  const records = Object.values(R)
    .filter((r) => r.Type === "AWS::Route53::RecordSet")
    .map((r) => `${r.Properties.Name} ${r.Properties.Type}`)
    .sort();
  assert.deepEqual(
    records,
    names.flatMap((n) => [`${n}. A`, `${n}. AAAA`]).sort(),
  );
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
  assert.match(csp, /connect-src [^;]*wss:\/\/throwingwood\.com/);
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
  // named by its contents, in any order, and by nothing else
  assert.equal(contentHash(entries), contentHash([...entries].reverse()));
  assert.notEqual(
    contentHash(entries),
    contentHash([entries[0], { ...entries[1], name: "package.jso" }]),
  );
  assert.match(contentHash(entries), /^[0-9a-f]{64}$/);
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

test("the optional pitch association is served directly as JSON", async (t) => {
  const { writeAssociation } = await import("../../tools/build.mjs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { startPreview } = await import("../../tools/preview.mjs");
  const root = await fs.mkdtemp(join(tmpdir(), "pitch-association-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(join(root, "404.html"), "Missing");
  const key = ".well-known/apple-app-site-association";
  assert.equal(request("/" + key).uri, "/" + key);
  assert.equal(request("/.well-known/other").statusCode, 301);
  assert.throws(() => prepareObject(".well-known/other", Buffer.alloc(0)));
  await writeAssociation(root, "");
  const preview = await startPreview({ port: 0, root });
  t.after(() => preview.close());
  const url = `http://127.0.0.1:${preview.address().port}/${key}`;
  assert.equal((await fetch(url, { redirect: "manual" })).status, 404);
  await assert.rejects(writeAssociation(root, "invalid"));
  const team = "A".repeat(10);
  await writeAssociation(root, team);
  const bytes = await fs.readFile(join(root, key));
  assert.equal(prepareObject(key, bytes).ContentType, "application/json");
  const response = await fetch(url, { redirect: "manual" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), {
    applinks: {
      apps: [],
      details: [{ appID: team + ".com.throwingwood.app", paths: ["/p/*"] }],
    },
  });
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
  // One stored entry named index.mjs, right after the local header: the bytes
  // as they are, so the zip (and its key) is the same on every machine, where a
  // deflated one differed between CI's x86-64 and an arm64 Mac.
  assert.equal(a.readUInt32LE(0), 0x04034b50);
  assert.equal(a.readUInt16LE(8), 0, "stored, not deflated");
  const nameLength = a.readUInt16LE(26);
  assert.equal(a.subarray(30, 30 + nameLength).toString(), "index.mjs");
  const size = a.readUInt32LE(18);
  assert.equal(size, data.length);
  assert.ok(a.subarray(30 + nameLength, 30 + nameLength + size).equals(data));
  assert.equal(a.readUInt32LE(14), zlib.crc32(data));
});

test("links to Jamie's other sites carry ?ref=kubb-<placement>", () => {
  assert.equal(ref("https://x.test/", "home"), "https://x.test/?ref=kubb-home");
  assert.equal(
    ref("https://x.test/?a=1", "footer"),
    "https://x.test/?a=1&ref=kubb-footer",
  );
});

test("the version label: package.json's version and the newest engine's, never the commit", async () => {
  const pkg = await json("package.json");
  const carried = carriedEngines();
  const sha = "a2659b744210e4c5baa5b69c672e11ec87f9bfab";
  const release = releaseOf(pkg.version, sha, carried);
  assert.equal(release.text, `${pkg.version} (${carried[0].version})`);
  // this checkout: 0.2.0 on 0.8.1, also playing 0.7.4
  assert.equal(release.text, "0.2.0 (0.8.1)");
  assert.equal(release.detail, "Also plays 0.7.4");
  assert.equal(release.web, sha, "the commit stays the exact identity");
  // one engine carried: no detail
  assert.equal(releaseOf("0.2.0", sha, carried.slice(0, 1)).detail, null);
  const foot = footer(release.text);
  assert.match(foot, /data-release>Version 0\.2\.0 \(0\.8\.1\)<\/p>/);
  assert.ok(!foot.includes(sha.slice(0, 7)));
});
