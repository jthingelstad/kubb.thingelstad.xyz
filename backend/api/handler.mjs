// The api function on AWS: a Lambda function URL (payload format 2.0). CloudFront sends
// https://throwingwood.com/api/* here; the pitch server pushes to the URL itself
// (<url>/push). The logic is core.mjs; this file is the adapters.
//
// Environment:
//   TABLE            the rooms table (stack kubb-xyz-rooms)
//   GAMES_BUCKET     the private games bucket: recorded pushes, one-device matches, reports
//   ALLOWED_ORIGINS  comma separated; an origin without a port allows any port
//   PUSH_SECRET_ARN  the Secrets Manager secret the pushes are signed with: read at run
//                    time by the function's role, kept in memory, never logged
//   REELS_FUNCTION, REEL_ENGINES   the highlight reel function's ARN and the engine
//                    major.minors it renders; without both, reels and shares are unavailable

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { LIMITS, parseOrigins } from "./checks.mjs";
import { ShareBusy, createApi } from "./core.mjs";
import { dynamoStore } from "./dynamo-store.mjs";
import { s3Games, s3Pushes, s3Reports } from "./records.mjs";
import { parseEngines } from "../reels/tag.mjs";

// The push secret, read when first needed and again at most every `refreshMs` when
// asked for afresh (a signature that fails may mean it was changed). `read` fetches it.
export function cachedSecret({ read, now = Date.now, refreshMs = 5 * 60_000 }) {
  let value = null;
  let at = -Infinity;
  return async function secret({ fresh = false } = {}) {
    if (value !== null && (!fresh || now() - at < refreshMs)) return value;
    at = now();
    try {
      value = (await read()) || null;
    } catch (error) {
      console.error("push secret read failed", error?.name);
    }
    return value;
  };
}

export function secretsManagerReader(secretId) {
  if (!secretId) return async () => null;
  let client = null;
  return async () => {
    // the Node.js runtime carries the SDK; loaded only here, so the tests need none
    const sm = await import("@aws-sdk/client-secrets-manager");
    client ??= new sm.SecretsManagerClient({ maxAttempts: 2 });
    const out = await client.send(
      new sm.GetSecretValueCommand({ SecretId: secretId }),
    );
    return out.SecretString ?? null;
  };
}

// Asks the reel function for one render, asynchronously ("Event").
export function lambdaReelStarter({ client, functionName }) {
  return async function startReel({ room, v, tag }) {
    const out = await client.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ room, v, tag })),
      }),
    );
    if (out.StatusCode !== 202)
      throw new Error(`reel invoke answered ${out.StatusCode}`);
  };
}

// Asks the reel function to check a shared match, synchronously, waiting at most
// `waitMs` and asking again every `retryMs` while it is throttled. Throttled or out of
// time is a ShareBusy; a function error is thrown.
export function lambdaShareChecker({
  client,
  functionName,
  waitMs = LIMITS.shareWaitMs,
  retryMs = 2000,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  return async function checkShare(g) {
    const deadline = now() + waitMs;
    const payload = Buffer.from(JSON.stringify({ check: g }));
    for (;;) {
      const left = deadline - now();
      if (left <= 0) throw new ShareBusy("no time left");
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), left);
      try {
        const out = await client.send(
          new InvokeCommand({
            FunctionName: functionName,
            InvocationType: "RequestResponse",
            Payload: payload,
          }),
          { abortSignal: abort.signal },
        );
        if (out.FunctionError || out.StatusCode !== 200)
          throw new Error(
            `check answered ${out.FunctionError ?? out.StatusCode}`,
          );
        return JSON.parse(Buffer.from(out.Payload).toString());
      } catch (error) {
        if (abort.signal.aborted || error?.name === "AbortError")
          throw new ShareBusy("the check took too long");
        if (error?.name !== "TooManyRequestsException") throw error;
        if (deadline - now() <= retryMs) throw new ShareBusy("throttled");
        await sleep(retryMs);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

// A function URL event as core.mjs's request, and its answer as the URL's response.
export function fromEvent(event) {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers ?? {}))
    headers[k.toLowerCase()] = v;
  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
    : Buffer.alloc(0);
  return {
    method: event.requestContext?.http?.method ?? "GET",
    path: event.rawPath ?? "/",
    query: new URLSearchParams(event.rawQueryString ?? ""),
    headers,
    body,
  };
}

export const toResult = (res) => ({
  statusCode: res.status,
  headers: res.headers,
  body: res.body,
});

export function makeHandler(api) {
  return async (event) => toResult(await api.handle(fromEvent(event)));
}

let ready;
export function handler(event) {
  if (!ready) {
    const bucket = process.env.GAMES_BUCKET;
    const s3 = bucket ? new S3Client({ maxAttempts: 2 }) : null;
    const reelEngines = parseEngines(process.env.REEL_ENGINES);
    const reels = process.env.REELS_FUNCTION && reelEngines.length;
    ready = makeHandler(
      createApi({
        store: dynamoStore({
          client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
          table: process.env.TABLE,
        }),
        recordPush: s3 ? s3Pushes({ client: s3, bucket }) : null,
        keepReport: s3 ? s3Reports({ client: s3, bucket }) : null,
        recordGame: s3 ? s3Games({ client: s3, bucket }) : null,
        startReel: reels
          ? lambdaReelStarter({
              client: new LambdaClient({ maxAttempts: 2 }),
              functionName: process.env.REELS_FUNCTION,
            })
          : null,
        checkShare: reels
          ? lambdaShareChecker({
              client: new LambdaClient({ maxAttempts: 1 }),
              functionName: process.env.REELS_FUNCTION,
            })
          : null,
        reelEngines,
        secret: cachedSecret({
          read: secretsManagerReader(process.env.PUSH_SECRET_ARN),
        }),
        origins: parseOrigins(process.env.ALLOWED_ORIGINS),
      }),
    );
  }
  return ready(event);
}
