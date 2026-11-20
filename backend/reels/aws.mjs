// The reel function's adapters on AWS: the reel item and the kept replay in the rooms
// table, the finished files in the site bucket. Each call asks for exactly what the
// function's role allows (infra/site.json, ReelsRole): GetItem on the replay with the
// attributes named, UpdateItem on the reel item's own attributes, PutObject under
// reels/. `client` is a DynamoDBDocumentClient, `s3` an S3Client (or anything with the
// same `send`).
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { REEL_CACHE } from "./job.mjs";

const lost = (error) => error?.name === "ConditionalCheckFailedException";

// The reel item's own attributes: none of them is on the room, doc, replay or conn
// items, so a role allowed to update only these cannot touch anything else.
export const REEL_FIELDS = [
  "state",
  "tries",
  "tall",
  "wide",
  "edit",
  "seconds",
  "done",
  "why",
];

export function reelStore({ client, table, now = Date.now }) {
  const seconds = () => Math.floor(now() / 1000);
  return {
    async getReplay(code) {
      const { Item } = await client.send(
        new GetCommand({
          TableName: table,
          Key: { pk: `room#${code}`, sk: "replay" },
          ProjectionExpression: "#v, #z, #exp",
          ExpressionAttributeNames: { "#v": "v", "#z": "z", "#exp": "exp" },
          ConsistentRead: true,
        }),
      );
      if (!Item || !(Item.exp > seconds())) return null;
      return {
        v: Item.v,
        data: gunzipSync(Buffer.from(Item.z)).toString(),
        exp: Item.exp,
      };
    },

    async attemptReel(code, job) {
      try {
        const out = await client.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: `room#${code}`, sk: "reel" },
            UpdateExpression: "ADD #tries :one",
            ConditionExpression: "#job = :job AND #state = :rendering",
            ExpressionAttributeNames: {
              "#tries": "tries",
              "#job": "job",
              "#state": "state",
            },
            ExpressionAttributeValues: {
              ":one": 1,
              ":job": job,
              ":rendering": "rendering",
            },
            ReturnValues: "UPDATED_NEW",
          }),
        );
        return { tries: out.Attributes?.tries ?? 1 };
      } catch (error) {
        if (lost(error)) return null;
        throw error;
      }
    },

    async finishReel(code, job, fields) {
      const names = Object.keys(fields);
      for (const n of names)
        if (!REEL_FIELDS.includes(n)) throw new Error(`not a reel field: ${n}`);
      try {
        await client.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: `room#${code}`, sk: "reel" },
            UpdateExpression:
              "SET " + names.map((_, i) => `#f${i} = :f${i}`).join(", "),
            ConditionExpression: "#job = :job",
            ExpressionAttributeNames: {
              "#job": "job",
              ...Object.fromEntries(names.map((n, i) => [`#f${i}`, n])),
            },
            ExpressionAttributeValues: {
              ":job": job,
              ...Object.fromEntries(names.map((n, i) => [`:f${i}`, fields[n]])),
            },
          }),
        );
        return true;
      } catch (error) {
        if (lost(error)) return false;
        throw error;
      }
    },
  };
}

export function s3Uploader({ s3, bucket }) {
  return async function upload(key, file, contentType) {
    if (!key.startsWith("reels/")) throw new Error(`not a reel key: ${key}`);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.readFileSync(file),
        ContentType: contentType,
        CacheControl: REEL_CACHE,
      }),
    );
  };
}
