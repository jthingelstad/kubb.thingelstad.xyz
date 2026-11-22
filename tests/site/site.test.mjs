// The site's own pieces: the viewer request function, the pitch code, the
// templates, the delivery plan and the api bundle's zip.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import zlib from "node:zlib";
import { loadViewerRequest, cloudfrontRequest } from "../../tools/preview.mjs";
import { cacheControl, prepareObject } from "../../tools/delivery-plan.mjs";
import { expectedTemplate } from "../../tools/site-template.mjs";
import { zipOne } from "../../tools/api-bundle.mjs";
import {
  PITCH_ORIGINS,
  PLAYDATE_SITE,
  contentSecurityPolicy,
  embedSecurityPolicy,
} from "../../src/site/csp.mjs";
import { contentHash, zipFiles } from "../../tools/pages-bundle.mjs";
import { pitchCode } from "../../src/site/config.js";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  NEWSLETTER_ACTION,
  NEWSLETTER_ORIGIN,
  NEWSLETTER_REFER,
  NEWSLETTER_URL,
  PITCH_URL,
  APP_STORE_URL,
  SUPPORT_TEXT,
  TESTFLIGHT_URL,
  ref,
} from "../../src/site/site.mjs";
import { NEWSLETTER_PAGES, signup } from "../../src/site/newsletter.mjs";
import {
  CRAWL_BLOCKED,
  PREVIEW_AGENTS,
  robotsTxt,
} from "../../src/site/robots.mjs";
import { PITCH_CODE } from "../../backend/pitch-server/core.mjs";
import { PITCH_CODE as API_CODE } from "../../backend/api/checks.mjs";
import { releaseOf } from "../../tools/build.mjs";
import { carriedEngines } from "../../tools/lua-bundle.mjs";
import { NAV, footNav, footer } from "../../src/site/layout.mjs";
import {
  LOVE,
  GOLDEN_COUNT,
  PLAYDATE_BUILD,
  PLAY_NOW,
  iosJoin,
  playNow,
  playdateBuildVersion,
  storeLink,
  storeSections,
} from "../../src/site/landing.mjs";
import { PAGES } from "../../src/site/pages.mjs";

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
  // the landing site's pages, with and without the slash
  for (const page of ["ios", "playdate", "engine", "love"]) {
    assert.equal(request(`/${page}/`).uri, `/${page}/index.html`);
    const bare = request(`/${page}`);
    assert.equal(bare.statusCode, 301);
    assert.equal(bare.headers.location.value, `/${page}/`);
  }
});

test("/web/ was folded into /: it answers 301 to /#play, keeping the query", () => {
  for (const [address, location] of [
    ["/web/", "/#play"],
    ["/web", "/#play"],
    ["/web/index.html", "/#play"],
    ["/web/?pitchserver=ws://x", "/?pitchserver=ws://x#play"],
  ]) {
    const result = request(address);
    assert.equal(result.statusCode, 301, address);
    assert.equal(result.headers.location.value, location, address);
    assert.equal(request(location).uri, "/index.html");
  }
  // the old address goes to throwingwood.com first, then here
  assert.equal(
    request("https://kubb.thingelstad.xyz/web/").headers.location.value,
    "https://throwingwood.com/web/",
  );
  // no page is built there any more, and nothing links it
  assert.ok(!PAGES.some((p) => p.path === "/web/"));
  for (const p of PAGES) {
    const html = p.render({ config: {}, assets: { main: "/m.js" } });
    assert.ok(!html.includes('href="/web/"'), `${p.path} links /web/`);
  }
});

test("one pitch code alphabet everywhere, and the pitch server and api accept its codes", async () => {
  assert.equal(CODE_ALPHABET.length, 31);
  assert.doesNotMatch(CODE_ALPHABET, /[ilo01]/);
  const start = await fs.readFile("public/js/start.js", "utf8");
  const fn = await fs.readFile("infra/viewer-request.js", "utf8");
  assert.ok(start.includes(`"${CODE_ALPHABET}"`), "start.js");
  assert.ok(fn.includes(`"${CODE_ALPHABET}"`), "viewer-request.js");
  assert.ok(start.includes(`LENGTH = ${CODE_LENGTH}`));
  for (const c of CODE_ALPHABET) {
    assert.match(
      c.repeat(CODE_LENGTH),
      PITCH_CODE,
      `the pitch server refuses ${c}`,
    );
    assert.match(c.repeat(CODE_LENGTH), API_CODE, `the api refuses ${c}`);
  }
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
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.ok(csp.length < 1700, "CloudFront's CSP header limit");
  // connect-src: 'self' (the api at /api/*), the pitch server's WebSocket and its https
  // origin (the open games list), Tinylytics; no longer the old rooms WebSocket through
  // throwingwood.com/ws or its execute-api fallback
  assert.equal(
    PITCH_URL,
    "wss://throwingwood-pitches.throwingwood.workers.dev",
  );
  assert.deepEqual(PITCH_ORIGINS, [
    "wss://throwingwood-pitches.throwingwood.workers.dev",
    "https://throwingwood-pitches.throwingwood.workers.dev",
  ]);
  for (const policy of [csp, embedSecurityPolicy()]) {
    const connect = policy
      .split("; ")
      .find((d) => d.startsWith("connect-src "))
      .split(" ")
      .slice(1);
    assert.deepEqual(connect, [
      "'self'",
      ...PITCH_ORIGINS,
      "https://tinylytics.app",
    ]);
    assert.doesNotMatch(policy, /wss:\/\/throwingwood\.com/);
    assert.doesNotMatch(policy, /execute-api/);
  }
});

test("the site stack: edge web ACL, logs, no /ws route, and /api/*", async () => {
  const site = await json("infra/site.json");
  const config = site.Resources.Distribution.Properties.DistributionConfig;
  assert.deepEqual(config.WebACLId, {
    "Fn::ImportValue": "edge-waf-WebAclArn",
  });
  assert.equal(site.Resources.AccessLogGroup.Properties.RetentionInDays, 731);
  const fields = site.Resources.AccessLogDelivery.Properties.RecordFields;
  assert.ok(!fields.some((f) => /c-ip|cs-uri-query/.test(f)), "IP-free log");
  const behaviour = (path) =>
    config.CacheBehaviors.map((b) => b["Fn::If"]).find(
      (b) => b?.[1]?.PathPattern === path,
    );
  // The old rooms WebSocket's /ws went with its stack on 2026-11-21.
  assert.equal(behaviour("/ws"), undefined);
  assert.ok(!JSON.stringify(config.Origins).includes('"rooms"'));
  // The api function's /api/* (docs/PITCH-SERVER.md section 12): off by default, never
  // cached (CachingDisabled), every viewer header but Host to the function URL
  // (AllViewerExceptHostHeader; AWS managed policies).
  const api = behaviour("/api/*");
  assert.equal(api[0], "HasApi");
  assert.equal(api[1].TargetOriginId, "api");
  assert.equal(api[1].CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  assert.equal(
    api[1].OriginRequestPolicyId,
    "b689b0a8-53d0-40ab-baf2-68738e2966ac",
  );
  assert.equal(site.Parameters.ApiDomain.Default, "");
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
  // the embed's policy is the site's in every other directive but form-action
  // (it carries no form, so it keeps 'self' alone) and the Playdate games
  // site's images and media, which it never shows
  assert.equal(
    embedSecurityPolicy()
      .replace("frame-ancestors *", "")
      .replace("form-action 'self'", ""),
    contentSecurityPolicy()
      .replace("frame-ancestors 'none'", "")
      .replace(`form-action 'self' ${NEWSLETTER_ORIGIN}`, "")
      .replaceAll(` ${PLAYDATE_SITE}`, ""),
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
    prepareObject("landing/web-hit.webp", Buffer.from("x")).ContentType,
    "image/webp",
  );
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

test("the api zip is the same bytes every time and unzips", () => {
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
  // this checkout: 0.13.0 on 0.13.4, the one engine it carries (docs/ENGINES.md)
  assert.equal(release.text, "0.13.0 (0.13.4)");
  assert.equal(release.detail, null);
  // more than one carried (when the owner decides one is supported): "Also plays"
  const two = [carried[0], { ...carried[0], mm: "0.9", version: "0.9.0" }];
  assert.equal(releaseOf("0.2.0", sha, two).detail, "Also plays 0.9.0");
  assert.equal(release.web, sha, "the commit stays the exact identity");
  // one engine carried: no detail
  assert.equal(releaseOf("0.2.0", sha, carried.slice(0, 1)).detail, null);
  const foot = footer(release.text);
  assert.match(foot, /data-release>Version 0\.13\.0 \(0\.13\.4\)<\/p>/);
  assert.ok(!foot.includes(sha.slice(0, 7)));
});

test("the landing site: / is the game and its web game, each nav entry a page", () => {
  const paths = PAGES.map((p) => p.path);
  for (const { href, page = href } of NAV)
    assert.ok(paths.includes(page), href);
  for (const p of ["/", "/rules/", "/privacy/"])
    assert.ok(paths.includes(p), p);
  // the header, as the 1.0 build list names it
  assert.deepEqual(
    NAV.map((n) => [n.label, n.href]),
    [
      ["Play", "/#play"],
      ["iPhone", "/ios/"],
      ["Playdate", "/playdate/"],
      ["How to play", "/rules/"],
    ],
  );
  // the footer: Rules, The engine, Kubb sites we love, Newsletter (Buttondown's
  // own page), Support once its words are set, Privacy, then the version; the
  // current page marked
  const labels = (support) => footNav(support).map((n) => n.label);
  assert.deepEqual(labels("Some words."), [
    "Rules",
    "The engine",
    "Kubb sites we love",
    "Newsletter",
    "Support",
    "Privacy",
  ]);
  assert.deepEqual(
    labels(""),
    labels("Some words.").filter((l) => l !== "Support"),
  );
  // today: no support words, so no Support link to a section that is not there
  assert.equal(SUPPORT_TEXT, "");
  const foot = footer("0.8.0 (0.9.0)", "/love/");
  assert.ok(!foot.includes("#support"));
  for (const { href } of footNav()) assert.ok(foot.includes(`href="${href}"`));
  assert.match(foot, /href="\/love\/" aria-current="page"/);
  assert.ok(
    foot.includes(`<a href="${NEWSLETTER_URL}" rel="noopener">Newsletter</a>`),
  );
  assert.ok(
    footer(null, "", "Some words.").includes(
      '<a href="/ios/#support">Support</a>',
    ),
  );
  assert.ok(
    foot.indexOf("Privacy</a>") < foot.indexOf("data-release>Version"),
    "the version ends the row",
  );
  // no page links #support while there is none
  for (const p of PAGES)
    assert.ok(
      !p.render({ config: {}, assets: { main: "/m.js" } }).includes("#support"),
      p.path,
    );
});

test("/: the one landing page, PLAY NOW its one go button, the web game under #play", () => {
  const html = PAGES.find((p) => p.path === "/").render({
    config: { pitchUrl: "wss://x.test" },
  });
  // the h1 reads "Kubb Throwing Wood", with a space between its two spans
  assert.match(
    html,
    /<span class="hero__kubb">Kubb<\/span> <span class="hero__band">Throwing Wood<\/span>/,
  );
  assert.equal(PLAY_NOW, "?solo=1&play=1");
  const hero = html.slice(0, html.indexOf("</section>"));
  assert.ok(hero.includes(playNow()), "PLAY NOW in the hero");
  assert.match(
    playNow(),
    /^<a class="button button--start" href="\/p\/\?solo=1&amp;play=1" data-pitch="\?solo=1&amp;play=1"/,
  );
  assert.equal(html.split("button--start").length - 1, 1, "one go button");
  // the store's place: the TestFlight wording until the app is live
  assert.ok(hero.includes(storeLink()));
  assert.match(storeLink(), /data-test="testflight">Join the TestFlight<\/a>/);
  // the sections, in the design's order
  const order = [
    'id="play"',
    "Three ways to start",
    "Against the computer",
    "With friends",
    "Just throw",
    'id="open-games"',
    "Throw by feel",
    "On iPhone and iPad",
    "On Playdate",
    'data-test="newsletter"',
  ].map((m) => html.indexOf(m));
  assert.ok(
    order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])),
    JSON.stringify(order),
  );
  const play = html.slice(html.indexOf('id="play"'));
  // START A PITCH goes to a pitch, not to another page; Who can join beside it
  assert.match(
    play,
    /<a class="button" href="\/p\/" data-pitch="" data-start>Start a pitch<\/a>/,
  );
  assert.match(play, /<fieldset class="access" data-access hidden>/);
  assert.ok(play.includes('data-pitch="?solo=1"'));
  assert.ok(play.includes('data-pitch="?watch=1"'));
  assert.ok(play.includes('href="/practice/"'));
  assert.ok(play.includes('<a href="/settings/">Settings</a>'));
  assert.ok(play.includes('data-pitchserver="wss://x.test"'));
  assert.match(html, /<script src="\/js\/start\.js" defer>/);
  assert.match(html, /<script src="\/js\/open-games\.js" defer>/);
  // the newsletter block stays (the owner, 2026-11-21: "Keep the block"), plain
  assert.match(html, /class="frame news news--big"/);
  // "meter", never "dial", on any reading page
  for (const p of PAGES.filter((q) => !q.game))
    assert.doesNotMatch(
      p.render({ config: {} }),
      /\bdial\b/i,
      `${p.path} says dial`,
    );
});

test("the store badge is one switch: APP_STORE_URL in place of the TestFlight wording", () => {
  assert.equal(APP_STORE_URL, "", "the app is not live yet");
  const live = storeLink({ appStore: "https://apps.apple.com/app/id1" });
  assert.match(
    live,
    /^<a class="store-badge" href="https:\/\/apps\.apple\.com\/app\/id1" rel="noopener" data-test="app-store"><img src="\/landing\/app-store-badge\.svg" [^>]*alt="Download on the App Store"><\/a>$/,
  );
  assert.ok(!live.includes("TestFlight"));
  const ios = iosJoin(TESTFLIGHT_URL, "https://apps.apple.com/app/id1");
  assert.ok(ios.includes('data-test="app-store"'));
  assert.ok(!ios.includes("TestFlight"));
  // neither link: the iPhone page
  assert.match(
    storeLink({ appStore: "", testflight: "" }),
    /href="\/ios\/">iPhone and iPad/,
  );
});

test("/ios/: the privacy section the store listing points at, and support once its words are set", () => {
  const html = PAGES.find((p) => p.path === "/ios/").render({ config: {} });
  // today: #privacy, and no Support section, placeholder or dashed box
  assert.equal(html.split('id="privacy"').length - 1, 1, "#privacy");
  assert.ok(!html.includes('id="support"'), "no #support yet");
  assert.doesNotMatch(html, /placeholder|\[Support/);
  const privacy = html.slice(html.indexOf('id="privacy"'));
  assert.ok(privacy.includes('href="/privacy/"'));
  assert.equal(storeSections(), storeSections(""));
  // set: one #support with the words, escaped, before #privacy
  const set = storeSections("Write to us <here>.");
  assert.equal(set.split('id="support"').length - 1, 1);
  assert.ok(
    set.includes('<p data-test="support">Write to us &lt;here&gt;.</p>'),
  );
  assert.ok(set.indexOf('id="support"') < set.indexOf('id="privacy"'));
  // still TestFlight until the app is live
  assert.ok(html.includes("In beta on TestFlight"));
  assert.ok(html.includes('data-test="testflight"'));
});

test("/engine/ has PLAY NOW", () => {
  const html = PAGES.find((p) => p.path === "/engine/").render({ config: {} });
  assert.ok(html.includes(playNow()));
  assert.match(html, /<script src="\/js\/start\.js" defer>/);
});

test("the device's settings: /settings/ is a game page, linked from /, not indexed", () => {
  const page = PAGES.find((p) => p.path === "/settings/");
  assert.ok(page, "/settings/ is a page");
  assert.equal(page.noindex, true);
  const config = { mode: "x", release: { text: "0.7.1 (0.9.0)" } };
  const html = page.render({ config, assets: { main: "/assets/main.js" } });
  assert.match(html, /"mode":"settings"/);
  const home = PAGES.find((p) => p.path === "/").render({ config });
  assert.match(home, /<a href="\/settings\/">Settings<\/a>/);
});

test("the newsletter: a plain post to Buttondown's one list, on four pages", () => {
  assert.equal(NEWSLETTER_ORIGIN, "https://buttondown.com");
  assert.equal(NEWSLETTER_URL, "https://buttondown.com/throwing-wood");
  assert.equal(
    NEWSLETTER_ACTION,
    "https://buttondown.com/api/emails/embed-subscribe/throwing-wood",
  );
  assert.equal(NEWSLETTER_REFER, "https://buttondown.com/refer/throwing-wood");
  assert.deepEqual(NEWSLETTER_PAGES, ["/", "/ios/", "/playdate/", "/engine/"]);
  for (const size of ["big", "small"]) {
    const html = signup({ size });
    assert.match(
      html,
      /<form class="news__form" action="https:\/\/buttondown\.com\/api\/emails\/embed-subscribe\/throwing-wood" method="post">/,
    );
    assert.match(
      html,
      /<label class="label" for="news-email">Your email<\/label>/,
    );
    assert.match(
      html,
      /<input [^>]*id="news-email" type="email" name="email" autocomplete="email" required/,
    );
    assert.match(
      html,
      /<button class="button" type="submit">Sign me up<\/button>/,
    );
    assert.match(
      html,
      /<a href="https:\/\/buttondown\.com\/refer\/throwing-wood" rel="noopener">Powered by Buttondown\.<\/a>/,
    );
    assert.ok(html.includes('href="/privacy/#newsletter"'));
    // no script, no new tab, no other field
    assert.doesNotMatch(html, /<script|target=|onsubmit|data-tinylytics/);
    assert.equal(html.match(/<input\b/g).length, 1);
  }
  // the CSP lets a form post here and nowhere else off the site; the embed
  // keeps 'self' alone
  assert.match(
    contentSecurityPolicy(),
    /(?:^|; )form-action 'self' https:\/\/buttondown\.com(?:;|$)/,
  );
  assert.match(embedSecurityPolicy(), /(?:^|; )form-action 'self'(?:;|$)/);
  // each page carries it or not, as NEWSLETTER_PAGES says
  for (const p of PAGES) {
    const html = p.render({ config: {}, assets: { main: "/m.js" } });
    assert.equal(
      html.includes(`action="${NEWSLETTER_ACTION}"`),
      NEWSLETTER_PAGES.includes(p.path),
      p.path,
    );
  }
  const home = PAGES.find((p) => p.path === "/").render({ config: {} });
  assert.match(home, /class="frame news news--big"/);
});

test("/ios/: no TestFlight button until there is a link, then one", () => {
  const empty = iosJoin("");
  assert.ok(!empty.includes("TestFlight</a>"));
  assert.match(empty, /by invitation/);
  assert.match(empty, /href="\/#play"/);
  const set = iosJoin("https://testflight.apple.com/join/EXAMPLE1");
  assert.match(
    set,
    /<a class="button button--start" href="https:\/\/testflight\.apple\.com\/join\/EXAMPLE1" rel="noopener" data-test="testflight">Join the TestFlight<\/a>/,
  );
  assert.ok(!set.includes("by invitation"));
  // the site's value: Jamie's public link
  assert.equal(TESTFLIGHT_URL, "https://testflight.apple.com/join/rTx8uTn1");
  assert.match(
    iosJoin(),
    /href="https:\/\/testflight\.apple\.com\/join\/rTx8uTn1"/,
  );
});

test("/love/: the five sites Jamie named, in his order", () => {
  assert.deepEqual(
    LOVE.map((s) => s.name),
    [
      "USA Kubb",
      "Kubb World Championship",
      "Minnesota Kubb",
      "Planet Kubb",
      "JP's Backyard Games",
    ],
  );
});

test("/playdate/: the reel near the top, the download and the steps, all here", () => {
  const html = PAGES.find((p) => p.path === "/playdate/").render({});
  // the same file the Playdate games site offers, by its URL there
  assert.equal(
    PLAYDATE_BUILD.url,
    "https://files.thingelstad.com/playdate/throwing-wood/ThrowingWood-0.9.7.pdx.zip",
  );
  assert.match(
    html,
    /<a class="button button--start" href="https:\/\/files\.thingelstad\.com\/playdate\/throwing-wood\/ThrowingWood-0\.9\.7\.pdx\.zip" rel="noopener" data-test="playdate-download">Download the game<\/a>/,
  );
  // the version shown is the file's own
  assert.equal(playdateBuildVersion(), "0.9.7");
  assert.equal(
    playdateBuildVersion("https://x.test/ThrowingWood-1.2.3.pdx.zip"),
    "1.2.3",
  );
  assert.match(html, /test build 0\.9\.7\./);
  assert.match(html, /<h3>New in 0\.9\.7<\/h3>/);
  // the reel: a real video, with controls, poster and size, in the hero,
  // never autoplaying from the markup (public/js/reel.js plays it muted, and
  // only without reduced motion)
  const video = html.match(/<video\b[^>]*>/)[0];
  for (const attr of [
    'src="https://playdate.thingelstad.xyz/throwing-wood/reel/throwing-wood-0.9.5.mp4"',
    'poster="https://playdate.thingelstad.xyz/throwing-wood/reel/throwing-wood-0.9.5-poster.png"',
    'width="800"',
    'height="480"',
    "controls",
    "playsinline",
    'preload="metadata"',
    'aria-describedby="reel-about"',
  ])
    assert.ok(video.includes(attr), attr);
  assert.ok(!/\bautoplay\b/.test(video), "no autoplay in the markup");
  assert.match(html, /<figcaption id="reel-about">[^<]{40,}<\/figcaption>/);
  assert.ok(
    html.indexOf("<video") < html.indexOf('id="what"'),
    "the reel comes before anything to read",
  );
  assert.match(html, /<script src="\/js\/reel\.js" defer><\/script>/);
  // the install steps, in order, on this page
  const steps = html.match(/<ol class="steps pd-install">(.*?)<\/ol>/s)[1];
  const order = [
    "keep it zipped",
    'href="https://play.date/account/sideload/"',
    "Game Library",
  ].map((s) => steps.indexOf(s));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])));
});

test("the CSP lets in the Playdate games site for images and media, nothing more", () => {
  assert.equal(PLAYDATE_SITE, "https://playdate.thingelstad.xyz");
  const directives = Object.fromEntries(
    contentSecurityPolicy()
      .split("; ")
      .map((d) => [d.split(" ")[0], d.split(" ").slice(1)]),
  );
  assert.deepEqual(directives["media-src"], [
    "'self'",
    "data:",
    "blob:",
    PLAYDATE_SITE,
  ]);
  assert.ok(directives["img-src"].includes(PLAYDATE_SITE));
  for (const [name, sources] of Object.entries(directives))
    if (!["img-src", "media-src"].includes(name))
      assert.ok(!sources.includes(PLAYDATE_SITE), name);
  assert.doesNotMatch(
    contentSecurityPolicy(),
    /thingelstad\.xyz\/|\*\.thingelstad/,
  );
  // the embed shows none of it
  assert.ok(!embedSecurityPolicy().includes(PLAYDATE_SITE));
});

test("robots.txt: crawlers stay off per-match addresses, link previews do not", () => {
  const txt = robotsTxt("https://throwingwood.com");
  const groups = txt
    .trim()
    .split(/\n\n/)
    .map((g) => g.split("\n"));
  // the general group: exactly these paths disallowed
  assert.deepEqual(groups[0], [
    "User-agent: *",
    "Disallow: /p/",
    "Disallow: /e/",
    "Disallow: /og/",
    "Disallow: /reels/",
    "Disallow: /pitch/",
    "Disallow: /embed/",
    "Allow: /",
  ]);
  // the preview fetchers: a complete group of their own, nothing disallowed
  assert.deepEqual(groups[1], [
    ...PREVIEW_AGENTS.map((a) => `User-agent: ${a}`),
    "Allow: /",
  ]);
  for (const agent of [
    "Twitterbot",
    "facebookexternalhit",
    "LinkedInBot",
    "Slackbot-LinkExpanding",
    "Discordbot",
  ])
    assert.ok(PREVIEW_AGENTS.includes(agent), agent);
  assert.ok(
    !PREVIEW_AGENTS.includes("Applebot"),
    "Applebot is a search crawler",
  );
  assert.deepEqual(groups[2], [
    "Sitemap: https://throwingwood.com/sitemap.xml",
  ]);
  assert.equal(groups.length, 3);
  // no reading page (nor anything indexed) is caught by a Disallow prefix
  const open = [
    ...PAGES.filter((p) => !p.noindex).map((p) => p.path),
    "/practice/",
  ];
  for (const path of [
    "/",
    "/ios/",
    "/playdate/",
    "/engine/",
    "/love/",
    "/rules/",
    "/privacy/",
    "/practice/",
  ])
    assert.ok(open.includes(path), path);
  for (const path of open)
    assert.ok(
      !CRAWL_BLOCKED.some((blocked) => path.startsWith(blocked)),
      `${path} is disallowed`,
    );
  // and every per-match address is
  for (const path of [
    "/p/abcd2345",
    "/p/abcd2345?watch=1",
    "/e/abcd2345",
    "/og/abcd2345.png",
    "/reels/abcd2345/wide.mp4",
  ])
    assert.ok(
      CRAWL_BLOCKED.some((b) => path.startsWith(b)),
      path,
    );
});

test("/engine/ counts the golden corpus the site vendors", () => {
  const html = PAGES.find((p) => p.path === "/engine/").render({});
  assert.deepEqual(GOLDEN_COUNT, { matches: 15, hashes: 579 });
  assert.match(html, /We keep 579 hashes from 15 test matches\./);
});
