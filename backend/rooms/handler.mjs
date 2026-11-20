// The room server on AWS: one Lambda behind an API Gateway WebSocket API ($connect,
// $disconnect and $default all come here). The logic is core.mjs; this file is the two
// adapters (DynamoDB, the API Gateway Management API) and the connect filter.
//
// Environment: TABLE (the DynamoDB table), ALLOWED_ORIGINS (comma separated; an origin
// without a port allows any port), GAMES_BUCKET (where recorder.mjs keeps every committed
// document version and every match played in one browser, and reports.mjs keeps players'
// reports under reports/; without it nothing is recorded and reports are refused),
// REELS_FUNCTION and REEL_ENGINES (the highlight reel function's ARN and the engine
// major.minors it renders, docs/ROOMS.md section 12; without both every `reel` is
// answered `unavailable`, and so is every `share`: the same function checks a shared match
// when invoked synchronously with { check: g }, docs/ROOMS.md section 13). Sends go back to the API the event came from
// (https://<domainName>/<stage>) unless SEND_ENDPOINT says otherwise.

import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import {
  LIMITS,
  ShareBusy,
  createRooms,
  originAllowed,
  parseOrigins,
} from "./core.mjs";
import { dynamoStore } from "./dynamo-store.mjs";
import { s3GameRecorder, s3Recorder } from "./recorder.mjs";
import { s3Reporter } from "./reports.mjs";
import { parseEngines } from "../reels/tag.mjs";

const gone = (error) =>
  error?.name === "GoneException" || error?.$metadata?.httpStatusCode === 410;

// send and close over the API Gateway Management API. A connection that answers 410 Gone
// has closed: send reports false and the core marks the member disconnected.
export function gatewayAdapters(api) {
  return {
    async send(conn, text) {
      try {
        await api.send(
          new PostToConnectionCommand({ ConnectionId: conn, Data: text }),
        );
        return true;
      } catch (error) {
        if (gone(error)) return false;
        console.error("send failed", error?.name);
        return true; // not known to be gone: leave the member as they are
      }
    },
    async close(conn) {
      try {
        await api.send(new DeleteConnectionCommand({ ConnectionId: conn }));
      } catch (error) {
        if (!gone(error)) console.error("close failed", error?.name);
      }
    },
  };
}

// Asks the reel function for one render, asynchronously ("Event"): Lambda queues it,
// answers at once and retries a failed render once (infra/site.json, ReelsInvokeConfig).
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

// Asks the reel function to check a shared match, synchronously ("RequestResponse"), and
// waits at most `waitMs`. Lambda does not queue a synchronous invoke: while the function's
// reserved concurrency is taken by renders it is refused at once (TooManyRequests), so
// this asks again every `retryMs` until the time is up. Throttled or out of time is a
// ShareBusy (the device keeps the match and may try again); a function error is thrown.
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

export function makeHandler({ rooms, origins }) {
  return async function handler(event) {
    const { routeKey, connectionId } = event.requestContext;
    if (routeKey === "$connect") {
      const headers = event.headers ?? {};
      const origin = headers.Origin ?? headers.origin;
      return {
        statusCode: origin && originAllowed(origin, origins) ? 200 : 403,
      };
    }
    try {
      if (routeKey === "$disconnect") await rooms.disconnect(connectionId);
      else await rooms.message(connectionId, event.body ?? "");
    } catch (error) {
      console.error(routeKey, "failed", error?.name, error?.message);
    }
    return { statusCode: 200 };
  };
}

let ready;
export function handler(event) {
  const { domainName, stage } = event.requestContext;
  const endpoint =
    process.env.SEND_ENDPOINT || `https://${domainName}/${stage}`;
  const s3 = process.env.GAMES_BUCKET ? new S3Client({ maxAttempts: 2 }) : null;
  const reelEngines = parseEngines(process.env.REEL_ENGINES);
  const startReel =
    process.env.REELS_FUNCTION && reelEngines.length
      ? lambdaReelStarter({
          client: new LambdaClient({ maxAttempts: 2 }),
          functionName: process.env.REELS_FUNCTION,
        })
      : null;
  const checkShare =
    process.env.REELS_FUNCTION && reelEngines.length
      ? lambdaShareChecker({
          client: new LambdaClient({ maxAttempts: 1 }),
          functionName: process.env.REELS_FUNCTION,
        })
      : null;
  ready ??= makeHandler({
    rooms: createRooms({
      store: dynamoStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        table: process.env.TABLE,
      }),
      ...gatewayAdapters(new ApiGatewayManagementApiClient({ endpoint })),
      record: s3
        ? s3Recorder({ client: s3, bucket: process.env.GAMES_BUCKET })
        : null,
      report: s3
        ? s3Reporter({ client: s3, bucket: process.env.GAMES_BUCKET })
        : null,
      recordGame: s3
        ? s3GameRecorder({ client: s3, bucket: process.env.GAMES_BUCKET })
        : null,
      startReel,
      checkShare,
      reelEngines,
    }),
    origins: parseOrigins(process.env.ALLOWED_ORIGINS),
  });
  return ready(event);
}
