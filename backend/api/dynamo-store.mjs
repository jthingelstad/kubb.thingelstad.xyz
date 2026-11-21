// The api store on DynamoDB: the rooms table (stack kubb-xyz-rooms; pk, sk, TTL on `exp`),
// under new keys. The old room# items are left alone and nothing here reads them.
//
//   pitch#<code>  state   { made, n, seq, over, z, hash, names?, cpu?, level?, rev,
//                           sealed?, exp }
//                         the pitch's latest match as far as its pushes go: z the latest
//                         snapshot, gzipped. 48 hours after the last push while in play,
//                         a year once over. What the pitch pages show.
//   pitch#<code>  half    { made, n, v?, z?, s?, hash?, cpu?, level?, exp }
//                         the latest finished match's replay as its two pushes come in,
//                         in either order: z its kept replay (JSON text, from `keep`) and s
//                         its final snapshot (from the action that ended it), gzipped; v
//                         the time it ended (epoch ms). A year.
//   pitch#<code>  replay  { made, n, v, z, s, hash, cpu?, level?, sealed?, exp }
//                         the last finished match whose two halves are both in, copied
//                         from `half` by whichever push brought the second: so a rematch's
//                         first half never hides the last match's replay. A year.
//   pitch#<code>  reel    { v, tag, job, state, at, tries, tall?, wide?, edit?, seconds?,
//                           done?, why?, exp }   the replay's highlight reel
//   reels#<day>   count   { n, exp }    highlight reels started that UTC day
//   share#<sha256> share  { code, exp } the code a shared match is kept under
//   shares#<day>  count   { n, exp }    shares checked that UTC day
//
// Pushes and calls for one pitch run in parallel, so every write that depends on what was
// read is conditional. TTL deletes lazily: an item past `exp` is treated as absent here.
//
// `client` is a DynamoDBDocumentClient (or anything with the same `send`).

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { gunzipSync, gzipSync } from "node:zlib";
import { REEL_TRIES } from "../reels/tag.mjs";
import { withSnap } from "./push.mjs";

const lost = (error) => error?.name === "ConditionalCheckFailedException";
const refused = (error) =>
  error?.name === "TransactionCanceledException" &&
  (error.CancellationReasons ?? []).some(
    (r) => r?.Code === "ConditionalCheckFailed",
  );
const zip = (text) => gzipSync(Buffer.from(text));
const unzip = (z) => gunzipSync(Buffer.from(z)).toString();

// The state item from what core.mjs keeps, and back.
function stateItem(code, s) {
  const item = {
    pk: `pitch#${code}`,
    sk: "state",
    made: s.made,
    n: s.n,
    seq: s.seq,
    over: s.over === true,
    z: zip(s.snap),
    hash: s.hash ?? null,
    rev: s.rev,
    exp: s.exp,
  };
  for (const k of ["names", "cpu", "level"]) if (s[k] != null) item[k] = s[k];
  if (s.sealed) item.sealed = true;
  return item;
}

export function dynamoStore({ client, table, now = Date.now }) {
  const seconds = () => Math.floor(now() / 1000);

  async function get(pk, sk, fields = null) {
    const { Item } = await client.send(
      new GetCommand({
        TableName: table,
        Key: { pk, sk },
        ConsistentRead: true,
        ...(fields
          ? {
              ProjectionExpression: fields.map((_, i) => `#f${i}`).join(", "),
              ExpressionAttributeNames: Object.fromEntries(
                fields.map((f, i) => [`#f${i}`, f]),
              ),
            }
          : {}),
      }),
    );
    return Item && Item.exp > seconds() ? Item : null;
  }

  // One more on a day's counter, unless `cap` are counted already.
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

  // The half item of match (made, n): `fields` set on it when it is this match's and
  // `extra` holds (a condition on the item as it stands), else the whole item replaced
  // when it is gone or an earlier match's. Twice round, because the two pushes of a new
  // match can race to make its item: the loser finds the winner's item and sets its own
  // fields on it. True when this call wrote.
  async function patchHalf(code, { made, n }, fields, extra) {
    const Key = { pk: `pitch#${code}`, sk: "half" };
    const names = Object.keys(fields);
    for (let round = 0; round < 2; round++) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: table,
            Key,
            UpdateExpression:
              "SET " + names.map((_, i) => `#f${i} = :f${i}`).join(", "),
            ConditionExpression: `#made = :made AND #n = :n AND #exp > :now AND attribute_not_exists(#sealed) AND (${extra.condition})`,
            ExpressionAttributeNames: {
              "#made": "made",
              "#n": "n",
              "#exp": "exp",
              "#sealed": "sealed",
              ...extra.names,
              ...Object.fromEntries(names.map((f, i) => [`#f${i}`, f])),
            },
            ExpressionAttributeValues: {
              ":made": made,
              ":n": n,
              ":now": seconds(),
              ...extra.values,
              ...Object.fromEntries(names.map((f, i) => [`:f${i}`, fields[f]])),
            },
          }),
        );
        return true;
      } catch (error) {
        if (!lost(error)) throw error;
      }
      try {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: { ...Key, made, n, ...fields },
            ConditionExpression:
              "attribute_not_exists(pk) OR #exp < :now OR " +
              "(attribute_not_exists(#sealed) AND (#made < :made OR (#made = :made AND #n < :n)))",
            ExpressionAttributeNames: {
              "#exp": "exp",
              "#sealed": "sealed",
              "#made": "made",
              "#n": "n",
            },
            ExpressionAttributeValues: {
              ":now": seconds(),
              ":made": made,
              ":n": n,
            },
          }),
        );
        return true;
      } catch (error) {
        if (!lost(error)) throw error;
      }
    }
    return false; // this match's already, or a later one's
  }

  // The replay of match (made, n), once both its halves are in, copied from the half item
  // (read after this push's own write, so of two racing pushes the later sees both). Never
  // over a later match, a sealed (shared) pitch, or the same replay kept later.
  async function promote(code, { made, n }) {
    const h = await get(`pitch#${code}`, "half");
    if (!h || h.made !== made || h.n !== n || !h.v || !h.z || !h.s) return;
    const { sk, ...fields } = h;
    try {
      await client.send(
        new PutCommand({
          TableName: table,
          Item: { ...fields, sk: "replay" },
          ConditionExpression:
            "attribute_not_exists(pk) OR #exp < :now OR (attribute_not_exists(#sealed) AND " +
            "(#made < :made OR (#made = :made AND (#n < :n OR (#n = :n AND #v < :v)))))",
          ExpressionAttributeNames: {
            "#exp": "exp",
            "#sealed": "sealed",
            "#made": "made",
            "#n": "n",
            "#v": "v",
          },
          ExpressionAttributeValues: {
            ":now": seconds(),
            ":made": made,
            ":n": n,
            ":v": h.v,
          },
        }),
      );
    } catch (error) {
      if (!lost(error)) throw error;
    }
  }

  // A half written (or found written: a push sent again), then the replay made whole if
  // it can be. The promotion runs on a duplicate too, in case the first try stopped
  // between the two writes.
  async function half(code, match, fields, extra) {
    const wrote = await patchHalf(code, match, fields, extra);
    await promote(code, match);
    return wrote;
  }

  return {
    async getState(code) {
      const item = await get(`pitch#${code}`, "state");
      if (!item) return null;
      const { pk, sk, z, ...rest } = item;
      return {
        ...rest,
        names: rest.names ?? null,
        cpu: rest.cpu ?? null,
        level: rest.level ?? null,
        snap: unzip(z),
      };
    },
    async putState(code, state, prevRev) {
      const fresh = prevRev === 0;
      try {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: stateItem(code, state),
            ConditionExpression: fresh
              ? "attribute_not_exists(pk) OR #exp < :now"
              : "#rev = :rev",
            ExpressionAttributeNames: fresh
              ? { "#exp": "exp" }
              : { "#rev": "rev" },
            ExpressionAttributeValues: fresh
              ? { ":now": seconds() }
              : { ":rev": prevRev },
          }),
        );
        return true;
      } catch (error) {
        if (lost(error)) return false;
        throw error;
      }
    },

    putFinal: (code, { made, n, snap, exp }) =>
      half(
        code,
        { made, n },
        { s: zip(snap), exp },
        {
          condition: "attribute_not_exists(#s)",
          names: { "#s": "s" },
          values: {},
        },
      ),

    putKept: (code, { made, n, v, data, hash = null, cpu, level, exp }) =>
      half(
        code,
        { made, n },
        {
          v,
          z: zip(data),
          hash,
          exp,
          ...(cpu ? { cpu } : {}),
          ...(level ? { level } : {}),
        },
        {
          condition: "attribute_not_exists(#v) OR #v < :v",
          names: { "#v": "v" },
          values: { ":v": v },
        },
      ),

    async getReplay(code) {
      const item = await get(`pitch#${code}`, "replay");
      if (!item || !item.v || !item.z || !item.s) return null;
      return {
        v: item.v,
        made: item.made,
        n: item.n,
        sealed: !!item.sealed,
        data: withSnap(unzip(item.z), unzip(item.s)),
        exp: item.exp,
      };
    },

    // Highlight reels: the reel item's fields are its own, which is what lets the reel
    // function's role update only them (infra/site.json, ReelsRole).
    async getReel(code) {
      const item = await get(`pitch#${code}`, "reel");
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
              pk: `pitch#${code}`,
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
      const Key = { pk: `pitch#${code}`, sk: "reel" };
      try {
        if (at != null) {
          await client.send(
            new UpdateCommand({
              TableName: table,
              Key,
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
            Key,
            ConditionExpression: "#job = :job",
            ExpressionAttributeNames: { "#job": "job" },
            ExpressionAttributeValues: { ":job": job },
          }),
        );
      } catch (error) {
        if (!lost(error)) throw error;
      }
    },
    countReel: (day, cap, exp) => countDay(`reels#${day}`, cap, exp),

    async getShare(hash) {
      const item = await get(`share#${hash}`, "share");
      return item ? { code: item.code, exp: item.exp } : null;
    },
    // A shared match kept whole: its sealed state, its sealed replay and the key, in ONE
    // transaction of three Puts (so the role's dynamodb:PutItem covers it). The first two
    // only under a code not in use; the key only when there is none (or it still names
    // `stale`). False when a condition failed.
    async keepShare(hash, code, { state, replay }, { stale = null } = {}) {
      const fresh = {
        ConditionExpression: "attribute_not_exists(pk) OR #exp < :now",
        ExpressionAttributeNames: { "#exp": "exp" },
        ExpressionAttributeValues: { ":now": seconds() },
      };
      const put = (Item, condition = fresh) => ({
        Put: { TableName: table, Item, ...condition },
      });
      const kept = {
        pk: `pitch#${code}`,
        sk: "replay",
        made: replay.made,
        n: replay.n,
        v: replay.v,
        z: zip(replay.data),
        s: zip(replay.snap),
        hash: replay.hash ?? null,
        sealed: true,
        exp: replay.exp,
      };
      if (replay.cpu) kept.cpu = replay.cpu;
      if (replay.level) kept.level = replay.level;
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              put(stateItem(code, state)),
              put(kept),
              put(
                { pk: `share#${hash}`, sk: "share", code, exp: state.exp },
                stale
                  ? {
                      ConditionExpression:
                        "attribute_not_exists(pk) OR #exp < :now OR #code = :stale",
                      ExpressionAttributeNames: {
                        "#exp": "exp",
                        "#code": "code",
                      },
                      ExpressionAttributeValues: {
                        ":now": seconds(),
                        ":stale": stale,
                      },
                    }
                  : fresh,
              ),
            ],
          }),
        );
        return true;
      } catch (error) {
        if (refused(error)) return false;
        throw error;
      }
    },
    countShare: (day, cap, exp) => countDay(`shares#${day}`, cap, exp),
  };
}
