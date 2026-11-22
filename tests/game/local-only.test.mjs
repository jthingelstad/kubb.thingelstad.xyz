// Nothing built here, and no browser test, plays on a server in the cloud (2026-11-22: a
// QA run's pages opened four pitches on the cloud dev Worker, whose pushes went into
// the live games). A default build gives the page the pitch server on this machine;
// the dev Worker only when asked for by name; the browser tests refuse anything else.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pitchUrl } from "../../tools/build.mjs";
import {
  PITCH_URL,
  DEV_PITCH_URL,
  LOCAL_PITCH_URL,
} from "../../src/site/site.mjs";
import { assertLocal, assertLocalPath } from "./browser.mjs";

test("a default build talks to the pitch server on this machine", () => {
  assert.equal(pitchUrl(false, {}), LOCAL_PITCH_URL);
  assert.equal(pitchUrl(true, {}), PITCH_URL);
  assert.equal(pitchUrl(false, { KUBB_DEV_WORKER: "true" }), DEV_PITCH_URL);
  assert.equal(
    pitchUrl(false, { KUBB_PITCH_URL: "ws://127.0.0.1:9999" }),
    "ws://127.0.0.1:9999",
  );
});

test("the browser tests refuse a pitch server or api off this machine", () => {
  for (const ok of [
    LOCAL_PITCH_URL,
    "http://127.0.0.1:8798/api",
    "ws://localhost:1234",
    "/api",
  ])
    assert.doesNotThrow(() => assertLocal(ok), ok);
  for (const bad of [
    DEV_PITCH_URL,
    PITCH_URL,
    "https://throwingwood.com/api",
    "https://pdtv3isifdl64z7x52etbrqfci0qwlnv.lambda-url.us-east-1.on.aws/",
  ])
    assert.throws(
      () => assertLocal(bad),
      /only against servers on this machine/,
    );
  assert.throws(
    () =>
      assertLocalPath(
        `/p/abcdefgh?pitchserver=${encodeURIComponent(DEV_PITCH_URL)}`,
      ),
    /pitch server/,
  );
  assert.doesNotThrow(() =>
    assertLocalPath("/p/abcdefgh?pitchserver=ws%3A%2F%2F127.0.0.1%3A5555"),
  );
});

test("only the dev Worker marks its pushes", () => {
  const cfg = fs.readFileSync(
    "backend/pitch-server/cloudflare.config.ts",
    "utf8",
  );
  const devBlock = cfg.slice(cfg.indexOf("...(w.dev"), cfg.indexOf(": {})"));
  assert.match(devBlock, /PUSH_DEV: bindings\.text\("1"\)/);
  assert.equal((cfg.match(/PUSH_DEV/g) || []).length, 1, "set in one place");
  // the local server (wrangler dev) has no receiver at all
  const local = fs.readFileSync("backend/pitch-server/wrangler.jsonc", "utf8");
  assert.ok(!/"PUSH_URL"/.test(local));
});
