// The room server on AWS: one Lambda behind an API Gateway WebSocket API ($connect,
// $disconnect and $default all come here). The logic is core.mjs; this file is the two
// adapters (DynamoDB, the API Gateway Management API) and the connect filter.
//
// Environment: TABLE (the DynamoDB table), ALLOWED_ORIGINS (comma separated; an origin
// without a port allows any port), GAMES_BUCKET (where recorder.mjs keeps every committed
// document version; nothing is recorded without it). Sends go back to the API the event came from
// (https://<domainName>/<stage>) unless SEND_ENDPOINT says otherwise.

import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { createRooms, originAllowed, parseOrigins } from "./core.mjs";
import { dynamoStore } from "./dynamo-store.mjs";
import { s3Recorder } from "./recorder.mjs";

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
  ready ??= makeHandler({
    rooms: createRooms({
      store: dynamoStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        table: process.env.TABLE,
      }),
      ...gatewayAdapters(new ApiGatewayManagementApiClient({ endpoint })),
      record: process.env.GAMES_BUCKET
        ? s3Recorder({
            client: new S3Client({ maxAttempts: 2 }),
            bucket: process.env.GAMES_BUCKET,
          })
        : null,
    }),
    origins: parseOrigins(process.env.ALLOWED_ORIGINS),
  });
  return ready(event);
}
