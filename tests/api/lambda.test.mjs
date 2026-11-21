// The api function's Lambda adapters (backend/api/handler.mjs) against fakes: the reel
// function asked for a render asynchronously, and asked to check a shared match
// synchronously within the wait. Moved from the old rooms function's tests when it was
// retired (2026-11-21): the api runs the same adapters.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ShareBusy } from "../../backend/api/core.mjs";
import {
  lambdaReelStarter,
  lambdaShareChecker,
} from "../../backend/api/handler.mjs";

const ROOM = "abcdefgh23";

test("the api function asks the reel function for a render asynchronously", async () => {
  const sent = [];
  const start = lambdaReelStarter({
    client: {
      async send(cmd) {
        sent.push(cmd.input);
        return { StatusCode: 202 };
      },
    },
    functionName: "arn:aws:lambda:us-east-1:000000000000:function:x-reels",
  });
  await start({ room: ROOM, v: 4, tag: "r1-0.7" });
  assert.equal(sent[0].InvocationType, "Event");
  assert.deepEqual(JSON.parse(Buffer.from(sent[0].Payload)), {
    room: ROOM,
    v: 4,
    tag: "r1-0.7",
  });
  const refused = lambdaReelStarter({
    client: { send: async () => ({ StatusCode: 500 }) },
    functionName: "x",
  });
  await assert.rejects(refused({ room: ROOM, v: 4, tag: "r1-0.7" }));
});

class TooManyRequestsException extends Error {
  name = "TooManyRequestsException";
}

function lambdaFake(answers) {
  const calls = [];
  return {
    calls,
    async send(command, opts) {
      calls.push({ input: command.input, opts });
      const next = answers.shift();
      if (typeof next === "function") return next(opts);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const answered = (out) => ({
  StatusCode: 200,
  Payload: Buffer.from(JSON.stringify(out)),
});

test("lambda check: a synchronous invoke with { check: g }, answered with its payload", async () => {
  const client = lambdaFake([answered({ ok: true, why: null })]);
  const check = lambdaShareChecker({ client, functionName: "reels" });
  assert.deepEqual(await check({ engine: "0.7.2" }), { ok: true, why: null });
  const [{ input, opts }] = client.calls;
  assert.equal(input.FunctionName, "reels");
  assert.equal(input.InvocationType, "RequestResponse");
  assert.deepEqual(JSON.parse(Buffer.from(input.Payload).toString()), {
    check: { engine: "0.7.2" },
  });
  assert.ok(opts.abortSignal);
});

test("lambda check: throttled, it tries again within the wait, then answers busy", async () => {
  let t = 0;
  const slept = [];
  const sleep = async (ms) => {
    slept.push(ms);
    t += ms;
  };
  const ok = lambdaFake([
    new TooManyRequestsException(),
    answered({ ok: true }),
  ]);
  const check = lambdaShareChecker({
    client: ok,
    functionName: "f",
    now: () => t,
    sleep,
  });
  assert.deepEqual(await check({}), { ok: true });
  assert.deepEqual(slept, [2000]);

  t = 0;
  const always = lambdaFake(
    Array.from({ length: 20 }, () => new TooManyRequestsException()),
  );
  const busy = lambdaShareChecker({
    client: always,
    functionName: "f",
    now: () => t,
    sleep,
  });
  await assert.rejects(busy({}), ShareBusy);
  assert.ok(always.calls.length <= 10, `${always.calls.length} tries in 20 s`);
});

test("lambda check: a check past the wait is busy; a function error is an error", async () => {
  const slow = lambdaFake([
    (opts) =>
      new Promise((_, reject) =>
        opts.abortSignal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        }),
      ),
  ]);
  const check = lambdaShareChecker({
    client: slow,
    functionName: "f",
    waitMs: 30,
  });
  await assert.rejects(check({}), ShareBusy);
  const failed = lambdaFake([
    { StatusCode: 200, FunctionError: "Unhandled", Payload: Buffer.from("{}") },
  ]);
  await assert.rejects(
    lambdaShareChecker({ client: failed, functionName: "f" })({}),
    (e) => !(e instanceof ShareBusy),
  );
});
