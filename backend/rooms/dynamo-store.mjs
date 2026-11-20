// The room store on DynamoDB. One table (pk, sk), on demand, TTL on `exp` (epoch seconds):
//
//   room#<code>  room            { rev, json, exp }       host and members: small, read on every message
//   room#<code>  doc             { v, doc, by, sid, exp } the shared document, JSON text
//   room#<code>  replay          { v, t, z, exp }         the room's kept replay: its JSON text, gzipped
//   room#<code>  reel            { v, tag, job, state, at, tries, tall?, wide?, edit?,
//                                  seconds?, done?, why?, exp }
//                                                        the pitch's highlight reel: how it
//                                                        stands and, once done, its paths
//   reels#<day>  count           { n, exp }               highlight reels started that UTC day
//   share#<sha256>  share        { code, exp }            the code a shared match is kept under
//   shares#<day> count           { n, exp }               shares checked that UTC day
//   conn#<id>    conn            { room, member, exp }    which member a connection is
//   conn#<id>    part#<msg>#<i>  { d, exp }               one part of a message being uploaded
//   open         <made>#<code>   { room, made, players, seats, state, exp }
//                                                        an open game's listing (made: epoch ms, 13 digits)
//
// A room is ONE item, connections included, so a relay costs one read. The document is its
// own item under the same key so that relays do not pay to read it.
//
// Lambda invocations for one room run in parallel, so every write that depends on what was
// read is conditional: the room on its `rev`, the document on its `v`. TTL deletes lazily, so
// an item past `exp` is treated as absent here and may be overwritten.
//
// `client` is a DynamoDBDocumentClient (or anything with the same `send`).

import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import { gunzipSync, gzipSync } from "node:zlib";

import { listingKey } from "./core.mjs";
import { REEL_TRIES } from "../reels/tag.mjs";

const lost = (error) => error?.name === "ConditionalCheckFailedException";

export function dynamoStore({ client, table, now = Date.now }) {
  const seconds = () => Math.floor(now() / 1000);
  const known = new Map(); // conn -> who: a connection's member never changes

  async function get(pk, sk) {
    const { Item } = await client.send(
      new GetCommand({
        TableName: table,
        Key: { pk, sk },
        ConsistentRead: true,
      }),
    );
    return Item && Item.exp > seconds() ? Item : null;
  }

  // Put `item` only when the stored `attr` is `expected`; 0 means "not there, or expired".
  async function putIf(item, attr, expected) {
    const fresh = expected === 0;
    try {
      await client.send(
        new PutCommand({
          TableName: table,
          Item: item,
          ConditionExpression: fresh
            ? "attribute_not_exists(pk) OR #exp < :now"
            : "#attr = :expected",
          ExpressionAttributeNames: fresh
            ? { "#exp": "exp" }
            : { "#attr": attr },
          ExpressionAttributeValues: fresh
            ? { ":now": seconds() }
            : { ":expected": expected },
        }),
      );
      return true;
    } catch (error) {
      if (lost(error)) return false;
      throw error;
    }
  }

  // One more on a day's counter (`pk` "reels#<day>" or "shares#<day>"), unless `cap`
  // are counted already.
  async function countDay(pk, cap, exp) {
    try {
      await client.send(
        new UpdateCommand({
          TableName: table,
          Key: { pk, sk: "count" },
          UpdateExpression: "ADD #n :one SET #exp = :exp",
          ConditionExpression: "attribute_not_exists(#n) OR #n < :cap",
          ExpressionAttributeNames: { "#n": "n", "#exp": "exp" },
          ExpressionAttributeValues: { ":one": 1, ":cap": cap, ":exp": exp },
        }),
      );
      return true;
    } catch (error) {
      if (lost(error)) return false;
      throw error;
    }
  }

  return {
    async getRoom(code) {
      const item = await get(`room#${code}`, "room");
      return item
        ? { ...JSON.parse(item.json), rev: item.rev, exp: item.exp }
        : null;
    },
    async putRoom(code, room, prevRev) {
      const { rev, exp, ...state } = room;
      return putIf(
        {
          pk: `room#${code}`,
          sk: "room",
          rev,
          exp,
          json: JSON.stringify(state),
        },
        "rev",
        prevRev,
      );
    },

    async getDoc(code) {
      const item = await get(`room#${code}`, "doc");
      return item
        ? {
            v: item.v,
            doc: item.doc,
            by: item.by ?? null,
            sid: item.sid ?? null,
            exp: item.exp,
          }
        : null;
    },
    async putDoc(code, doc, base) {
      return putIf({ pk: `room#${code}`, sk: "doc", ...doc }, "v", base);
    },

    async touchDoc(code, exp) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: table,
            Key: { pk: `room#${code}`, sk: "doc" },
            UpdateExpression: "SET #exp = :exp",
            ConditionExpression: "attribute_exists(pk)",
            ExpressionAttributeNames: { "#exp": "exp" },
            ExpressionAttributeValues: { ":exp": exp },
          }),
        );
      } catch (error) {
        if (!lost(error)) throw error;
      }
    },

    // A finished match's replay (docs/ROOMS.md section 10), gzipped: kept only when no
    // unexpired replay of this room has this document version or a later one.
    async putReplay(code, { v, t, data, exp }) {
      try {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: {
              pk: `room#${code}`,
              sk: "replay",
              v,
              t,
              z: gzipSync(Buffer.from(data)),
              exp,
            },
            ConditionExpression:
              "attribute_not_exists(pk) OR #exp < :now OR #v < :v",
            ExpressionAttributeNames: { "#exp": "exp", "#v": "v" },
            ExpressionAttributeValues: { ":now": seconds(), ":v": v },
          }),
        );
        return true;
      } catch (error) {
        if (lost(error)) return false;
        throw error;
      }
    },
    async getReplay(code) {
      const item = await get(`room#${code}`, "replay");
      if (!item) return null;
      return {
        v: item.v,
        t: item.t,
        data: gunzipSync(Buffer.from(item.z)).toString(),
        exp: item.exp,
      };
    },

    // Highlight reels (docs/ROOMS.md section 12). The reel item's fields are its own
    // (none of them is on the room, doc or replay items), which is what lets the reel
    // function's role update only them (infra/site.json, ReelsRole).
    async getReel(code) {
      const item = await get(`room#${code}`, "reel");
      if (!item) return null;
      const { pk, sk, ...reel } = item;
      return reel;
    },
    async putReel(code, { v, tag, job, at, exp, tries = 0 }, { staleBefore }) {
      try {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: {
              pk: `room#${code}`,
              sk: "reel",
              v,
              tag,
              job,
              state: "rendering",
              at,
              tries,
              exp,
            },
            ConditionExpression:
              "attribute_not_exists(pk) OR #exp < :now OR #v < :v OR " +
              "(#v = :v AND #tag <> :tag) OR " +
              "(#job = :job AND #state = :rendering AND #at < :stale AND " +
              "#tries = :had AND #tries < :tries)",
            ExpressionAttributeNames: {
              "#exp": "exp",
              "#v": "v",
              "#tag": "tag",
              "#job": "job",
              "#state": "state",
              "#at": "at",
              "#tries": "tries",
            },
            ExpressionAttributeValues: {
              ":now": seconds(),
              ":v": v,
              ":tag": tag,
              ":job": job,
              ":rendering": "rendering",
              ":stale": staleBefore,
              ":tries": REEL_TRIES,
              ":had": tries,
            },
          }),
        );
        return true;
      } catch (error) {
        if (lost(error)) return false;
        throw error;
      }
    },
    async dropReel(code, job, { at = null } = {}) {
      try {
        // a takeover gives the item back as it was (stale, its tries kept); a new
        // render's item goes
        if (at != null) {
          await client.send(
            new UpdateCommand({
              TableName: table,
              Key: { pk: `room#${code}`, sk: "reel" },
              UpdateExpression: "SET #at = :at",
              ConditionExpression: "#job = :job",
              ExpressionAttributeNames: { "#job": "job", "#at": "at" },
              ExpressionAttributeValues: { ":job": job, ":at": at },
            }),
          );
          return;
        }
        await client.send(
          new DeleteCommand({
            TableName: table,
            Key: { pk: `room#${code}`, sk: "reel" },
            ConditionExpression: "#job = :job",
            ExpressionAttributeNames: { "#job": "job" },
            ExpressionAttributeValues: { ":job": job },
          }),
        );
      } catch (error) {
        if (!lost(error)) throw error;
      }
    },
    // One more render today, unless `cap` have started. Days do not repeat, so a day's
    // counter only needs to outlive it (`exp`, a few days).
    countReel: (day, cap, exp) => countDay(`reels#${day}`, cap, exp),

    // Sharing a match against the computer (docs/ROOMS.md section 13): the code a match
    // was shared under, by the hash of its start and log.
    async getShare(hash) {
      const item = await get(`share#${hash}`, "share");
      return item ? { code: item.code, exp: item.exp } : null;
    },
    async putShare(hash, { code, exp }, { stale = null } = {}) {
      try {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: { pk: `share#${hash}`, sk: "share", code, exp },
            ConditionExpression:
              "attribute_not_exists(pk) OR #exp < :now" +
              (stale ? " OR #code = :stale" : ""),
            ExpressionAttributeNames: {
              "#exp": "exp",
              ...(stale ? { "#code": "code" } : {}),
            },
            ExpressionAttributeValues: {
              ":now": seconds(),
              ...(stale ? { ":stale": stale } : {}),
            },
          }),
        );
        return true;
      } catch (error) {
        if (lost(error)) return false;
        throw error;
      }
    },
    async dropShare(hash, code) {
      try {
        await client.send(
          new DeleteCommand({
            TableName: table,
            Key: { pk: `share#${hash}`, sk: "share" },
            ConditionExpression: "#code = :code",
            ExpressionAttributeNames: { "#code": "code" },
            ExpressionAttributeValues: { ":code": code },
          }),
        );
      } catch (error) {
        if (!lost(error)) throw error;
      }
    },
    countShare: (day, cap, exp) => countDay(`shares#${day}`, cap, exp),

    async putConn(conn, who) {
      known.set(conn, who);
      await client.send(
        new PutCommand({
          TableName: table,
          Item: { pk: `conn#${conn}`, sk: "conn", ...who },
        }),
      );
    },
    async getConn(conn) {
      if (known.has(conn)) return known.get(conn);
      const item = await get(`conn#${conn}`, "conn");
      if (!item) return null;
      const who = { room: item.room, member: item.member, exp: item.exp };
      if (known.size > 2000) known.clear();
      known.set(conn, who);
      return who;
    },
    async delConn(conn) {
      known.delete(conn);
      await client.send(
        new DeleteCommand({
          TableName: table,
          Key: { pk: `conn#${conn}`, sk: "conn" },
        }),
      );
    },

    // The open games list: one partition, sorted by when each game was made, so the newest
    // are one Query away (no scan). Entries expire 15 minutes after their room last
    // changed; the read skips those TTL has not swept yet. Limit counts before that
    // filter, so a list may come back a little short, never long.
    // Kept only when newer than what is there (by the room's rev); false when stale.
    async putListing(code, entry) {
      try {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: {
              pk: "open",
              sk: listingKey(code, entry.made),
              room: code,
              ...entry,
            },
            ConditionExpression: "attribute_not_exists(pk) OR #rev < :rev",
            ExpressionAttributeNames: { "#rev": "rev" },
            ExpressionAttributeValues: { ":rev": entry.rev },
          }),
        );
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
    async listOpen({ since, limit, now: at = seconds() }) {
      const { Items = [] } = await client.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND sk >= :since",
          FilterExpression: "#exp > :now AND listed = :yes",
          ExpressionAttributeNames: { "#exp": "exp" },
          ExpressionAttributeValues: {
            ":yes": true,
            ":pk": "open",
            ":since": String(since).padStart(13, "0"),
            ":now": at,
          },
          ScanIndexForward: false,
          Limit: limit,
        }),
      );
      return Items.map((item) => ({
        room: item.room,
        made: item.made,
        players: item.players,
        seats: item.seats,
        state: item.state,
      }));
    },

    // The parts of one message arrive in parallel invocations, in any order. Each stores its
    // part and then reads them all; whoever sees the full set claims it by deleting part 0
    // (a conditional delete only one can win) and gets the whole text.
    async addChunk(conn, id, i, n, text, exp) {
      const pk = `conn#${conn}`;
      const sk = (k) => `part#${id}#${String(k).padStart(3, "0")}`;
      await client.send(
        new PutCommand({
          TableName: table,
          Item: { pk, sk: sk(i), d: text, exp },
        }),
      );
      const { Items = [] } = await client.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: { ":pk": pk, ":sk": `part#${id}#` },
          ConsistentRead: true,
        }),
      );
      if (Items.length < n) return null;
      try {
        await client.send(
          new DeleteCommand({
            TableName: table,
            Key: { pk, sk: sk(0) },
            ConditionExpression: "attribute_exists(pk)",
          }),
        );
      } catch (error) {
        if (lost(error)) return null;
        throw error;
      }
      const rest = Items.filter((item) => item.sk !== sk(0));
      await client
        .send(
          new BatchWriteCommand({
            RequestItems: {
              [table]: rest.map((item) => ({
                DeleteRequest: { Key: { pk, sk: item.sk } },
              })),
            },
          }),
        )
        .catch(() => {}); // TTL sweeps whatever is left
      return Items.sort((a, b) => (a.sk < b.sk ? -1 : 1))
        .map((item) => item.d)
        .join("");
    },
  };
}
