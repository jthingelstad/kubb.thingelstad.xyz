// The pages function's entry, on Lambda Web Functions and on this Mac alike: an
// ordinary Node HTTP server on AWS_LAMBDA_HTTP_ENDPOINT (127.0.0.1:8789 locally).
//
//   TABLE   the rooms table (stack kubb-xyz-rooms), read with GetItem only
//   SITE    the site it serves pages for (https://kubb.thingelstad.xyz)
//
// tools/pages-bundle.mjs packages this with resvg's WebAssembly and the display
// face beside it.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { renderer } from "./render.mjs";
import { createPages, siteBase } from "./server.mjs";

const site = (process.env.SITE || "https://kubb.thingelstad.xyz").replace(
  /\/$/,
  "",
);
const table = process.env.TABLE;
if (!table) throw new Error("TABLE is not set");
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// The room's document and, when it is gone, its kept replay: the fields the
// preview needs, nothing else (never a connection, never the room's members).
async function item(pk, sk, fields) {
  const { Item } = await client.send(
    new GetCommand({
      TableName: table,
      Key: { pk, sk },
      ProjectionExpression: fields.map((_, i) => `#f${i}`).join(", "),
      ExpressionAttributeNames: Object.fromEntries(
        fields.map((f, i) => [`#f${i}`, f]),
      ),
    }),
  );
  return Item && Item.exp > Date.now() / 1000 ? Item : null;
}
async function load(code) {
  const pk = `room#${code}`;
  const doc = await item(pk, "doc", ["v", "doc", "exp"]);
  if (doc) {
    // a finished match: whether its replay was kept, to say "Watch the replay"
    const over = /"over":true/.test(doc.doc);
    const stamp = over ? await item(pk, "replay", ["v", "exp"]) : null;
    return {
      doc: { v: doc.v, doc: doc.doc },
      replay: null,
      kept: over ? !!stamp : null,
    };
  }
  const kept = await item(pk, "replay", ["z", "exp"]);
  return {
    doc: null,
    replay: kept ? gunzipSync(Buffer.from(kept.z)).toString() : null,
  };
}

// Beside this file in the package; from node_modules when run from the repository.
async function asset(name, fallback) {
  try {
    return await fs.readFile(new URL(`./${name}`, import.meta.url));
  } catch {
    return fs.readFile(createRequire(import.meta.url).resolve(fallback));
  }
}
const render = renderer({
  wasm: await asset("resvg.wasm", "@resvg/resvg-wasm/index_bg.wasm"),
  font: await fs.readFile(
    new URL("./LondrinaSolid-Black.ttf", import.meta.url),
  ),
});

const handle = createPages({
  load,
  base: siteBase({ site }),
  render,
  site,
  log: (entry) => console.log(JSON.stringify(entry)),
});

const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT || "127.0.0.1:8789";
const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(endpoint);
if (!match) throw new Error(`Invalid AWS_LAMBDA_HTTP_ENDPOINT: ${endpoint}`);
const server = createServer({ requestTimeout: 15_000 }, (req, res) => {
  handle(req, res).catch((error) => {
    console.log(JSON.stringify({ event: "failed", error: String(error) }));
    if (!res.headersSent) res.writeHead(502, { "cache-control": "no-store" });
    res.end();
  });
});
server.keepAliveTimeout = 65_000;
server.listen(Number(match[2]), match[1].replace(/^\[|\]$/g, ""), () =>
  console.log(JSON.stringify({ event: "listening", endpoint })),
);

const stop = () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
