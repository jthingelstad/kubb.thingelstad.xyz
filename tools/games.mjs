// The recorded games (backend/api/records.mjs): fetch them, and play them back
// through the engine.
//
//   node tools/games.mjs pull [--room <code>] [--since 2026-11-15]
//       copies new records from the pitches stack's games bucket
//       (throwing-wood-pitches) to build/games/ (never in git: they carry the names
//       players typed): the matches played in one browser (solo, watching the computer)
//       to build/games/browser/<day>/, and every push of a shared pitch,
//       games/pitch/<code>/<made>/<n>-<seq>.json.gz, to build/games/pitch/<code>/<made>/.
//       Run as the cloud-engineer identity. --room <code> pulls only that pitch.
//   node tools/games.mjs replay [--dir build/games] [--throws] [--engine <major.minor>]
//       restores every one-browser match at its start and applies each recorded action
//       to an engine of THIS checkout, comparing its hash with the one the player's
//       browser committed: the match's own engine when the checkout carries it, else
//       the newest (docs/ENGINES.md); --engine plays every match on that one (after a
//       new minor, `--engine <it>` lists the throws it plays differently). "same" means
//       the engine plays that action exactly as it was played; "differs" is expected
//       on another engine than the match's, and is the list of throws to look at.
//       --throws prints every throw's result. A one-browser match carries only its
//       start, so it is judged up to the first action that goes another way, and the
//       rest are "unjudged". A record that names another engine version than the one
//       it is played on says so. A shared pitch's pushes are pulled but not replayed yet.
//
// The old rooms server's records (games/<room>/<ms>-<v>.json.gz) went with it on
// 2026-11-21, and their replay with them.
//
// The pure parts (browserMatch, replayBrowser, replayRecords, pulledPath) are tested in
// tests/net/record.test.mjs, tests/net/engines-replay.test.mjs and
// tests/site/pitches.test.mjs.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const PREFIX = "games/";

// A one-browser match's record (backend/api/records.mjs: { t, game }, game as
// src/net/record.js sends it) as { mode, t, start, actions, hashes, end, name }, or null
// when it carries no history to replay (dropped to fit).
export function browserMatch(record) {
  const g = record?.game;
  if (!g || typeof g.start !== "string" || g.start === "-") return null;
  if (!Array.isArray(g.actions)) return null;
  return {
    mode: g.mode ?? null,
    t: record.t ?? g.at ?? 0,
    start: g.start,
    actions: g.actions,
    hashes:
      Array.isArray(g.hashes) && g.hashes.length === g.actions.length
        ? g.hashes
        : null,
    end: g.end ?? null,
    name: g.name ?? null,
    client: typeof g.client === "string" ? g.client : null,
    engine: typeof g.engine === "string" ? g.engine : null,
  };
}

// "; played on engine 0.1.0, this checkout runs 0.2.0" when a record names an engine
// other than `here`, else "". Records made before engines were named say nothing.
export function engineNote(recorded, here) {
  const other = recorded.filter((v) => v !== here);
  return other.length
    ? `; played on engine ${recorded.join(", ")}, this checkout runs ${here}`
    : "";
}

// The engine a one-browser match was played on, as its record says (`engine`). Null for
// records from before engines were named.
export const matchEngineOf = (match) =>
  typeof match.engine === "string" ? match.engine : null;

// " [web]", " [web, ios]", or "" when nothing says.
const tagged = (clients) => (clients.length ? ` [${clients.join(", ")}]` : "");

// One one-browser match through `engine`: from its start, each action in turn. Returns
// { steps: [{ seq, type, outcome, how, flag, why }], same, differs, refused, unjudged,
// unchecked }. With no hashes every applied action is "unchecked" and only the last hash
// is compared with the end's. After the first action that differs or is refused the rest
// are "unjudged": no snapshot was recorded to go on from.
export function replayBrowser(engine, match) {
  const out = {
    steps: [],
    same: 0,
    differs: 0,
    refused: 0,
    unjudged: 0,
    unchecked: 0,
    end: null,
  };
  engine.restore(match.start);
  let lost = false;
  match.actions.forEach((action, i) => {
    const step = { seq: i + 1, type: action?.type ?? null };
    if (lost) {
      step.outcome = "unjudged";
    } else {
      let res;
      try {
        res = engine.apply(action);
      } catch (error) {
        res = { ok: false, why: error.message };
      }
      if (!res || res.ok === false) {
        step.outcome = "refused";
        step.why = res?.why ?? null;
        lost = true;
      } else {
        step.how = res.recording?.projectile?.how ?? null;
        step.flag = res.recording?.result?.flag ?? null;
        if (!match.hashes) step.outcome = "unchecked";
        else {
          step.outcome =
            String(engine.hash().hash) === String(match.hashes[i])
              ? "same"
              : "differs";
          if (step.outcome === "differs") lost = true;
        }
      }
    }
    out[step.outcome]++;
    out.steps.push(step);
  });
  if (!lost && match.end?.hash != null)
    out.end =
      String(engine.hash().hash) === String(match.end.hash)
        ? "same"
        : "differs";
  return out;
}

export function parseRecord(buffer) {
  const text =
    buffer[0] === 0x1f && buffer[1] === 0x8b
      ? gunzipSync(buffer).toString("utf8")
      : buffer.toString("utf8");
  return JSON.parse(text);
}

// Where one-browser matches are kept, under games/ in the bucket and under the pull
// directory here, and the api function's pushes (games/pitch/...: pulled, not yet
// replayed). Neither can be a pitch code ("browser" has an "o", "pitch" is too short).
export const BROWSER_DIR = "browser";
export const PITCH_DIR = "pitch";

async function readBrowserRecords(dir) {
  const records = [];
  let days;
  try {
    days = (await fs.readdir(path.join(dir, BROWSER_DIR))).sort();
  } catch {
    return records;
  }
  for (const day of days) {
    let names;
    try {
      names = await fs.readdir(path.join(dir, BROWSER_DIR, day));
    } catch {
      continue;
    }
    for (const name of names.sort())
      if (/\.json(\.gz)?$/.test(name))
        records.push(
          parseRecord(
            await fs.readFile(path.join(dir, BROWSER_DIR, day, name)),
          ),
        );
  }
  return records;
}

// The games bucket the pull tools read: the pitches stack's (the api function records
// there), once it is on and there.
export function gamesBucketOf(config) {
  return (config.pitchesStack && config.pitches?.gamesBucket) || null;
}

// Where a games bucket key goes under the pull's directory, as path parts, or null for
// a key that is not a record: games/browser/<day>/<ms>-<random>.json.gz and
// games/pitch/<code>/<made>/<n>-<seq>.json.gz (the api function's pushes). `since` (ms)
// compares the record's own time: a one-browser match's stamp, a push's pitch made time.
export function pulledPath(key, { room, since = 0 } = {}) {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length).split("/");
  const name = rest.at(-1);
  let t;
  if (
    rest.length === 3 &&
    rest[0] === BROWSER_DIR &&
    /^\d{4}-\d{2}-\d{2}$/.test(rest[1]) &&
    /^\d{13}-[a-z0-9]{8}\.json\.gz$/.test(name)
  ) {
    if (room) return null;
    t = Number(name.slice(0, 13));
  } else if (
    rest.length === 4 &&
    rest[0] === PITCH_DIR &&
    /^[2-9a-hjkmnp-z]{8,24}$/.test(rest[1]) &&
    /^\d{13}$/.test(rest[2]) &&
    /^\d{4}-\d{6}\.json\.gz$/.test(name)
  ) {
    if (room && rest[1] !== room) return null;
    t = Number(rest[2]);
  } else return null;
  return t < since ? null : rest;
}

// The games bucket as the cloud-engineer identity, after checking the account
// (tools/reports.mjs uses it too).
export async function openGamesBucket() {
  const { S3Client, ListObjectsV2Command, GetObjectCommand } =
    await import("@aws-sdk/client-s3");
  const { STSClient, GetCallerIdentityCommand } =
    await import("@aws-sdk/client-sts");
  const config = JSON.parse(await fs.readFile("infra/deployment.json", "utf8"));
  const bucket = gamesBucketOf(config);
  if (!bucket)
    throw new Error("infra/deployment.json names no games bucket yet");
  const settings = { region: config.region, maxAttempts: 5 };
  const identity = await new STSClient(settings).send(
    new GetCallerIdentityCommand({}),
  );
  if (identity.Account !== config.account)
    throw new Error(`Unexpected AWS account ${identity.Account}`);
  const s3 = new S3Client(settings);
  return {
    s3,
    bucket,
    ListObjectsV2Command,
    GetObjectCommand,
  };
}

async function pull({ room, since, dir }) {
  const { s3, bucket, ListObjectsV2Command, GetObjectCommand } =
    await openGamesBucket();
  const after = since ? Date.parse(since) : 0;
  if (Number.isNaN(after)) throw new Error(`--since ${since} is not a date`);
  let token;
  let got = 0;
  let had = 0;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: room ? `${PREFIX}${PITCH_DIR}/${room}/` : PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const { Key } of page.Contents ?? []) {
      const rest = pulledPath(Key, { room, since: after });
      if (!rest) continue;
      const file = path.join(dir, ...rest);
      try {
        await fs.access(file);
        had++;
        continue;
      } catch {
        // not here yet
      }
      const object = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key }),
      );
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, await object.Body.transformToByteArray());
      got++;
    }
    token = page.NextContinuationToken;
  } while (token);
  console.log(`${got} new records in ${dir} (${had} already here)`);
}

async function replay({ dir, throws, engine: only }) {
  const { checkoutEngines } = await import("./engines.mjs");
  const browser = (await readBrowserRecords(dir))
    .map(browserMatch)
    .filter(Boolean);
  if (!browser.length) {
    console.log(`No recorded matches in ${dir}. npm run games:pull first.`);
    return;
  }
  await replayRecords({ browser, throws, only, engines: checkoutEngines() });
}

// Every match through an engine of `engines` (tools/engines.mjs): its own when carried,
// else the newest, or `only`. Prints with `log`; returns the totals.
export async function replayRecords({
  browser,
  engines,
  throws = false,
  only = null,
  log = console.log,
}) {
  const { engineForMatch } = await import("./engines.mjs");
  log(
    only
      ? `Replaying through kubb-engine ${engines.version(only) ?? only}`
      : `Replaying each match through its own engine where this checkout carries it (${engines
          .carried()
          .map((mm) => engines.version(mm))
          .join(", ")}), else ${engines.version(engines.newest)}`,
  );
  const line = (s) =>
    log(
      `  ${String(s.seq).padStart(4)} ${s.how ?? s.type ?? "?"} ${s.outcome}${s.flag ? ` ${s.flag}` : ""}${s.why ? ` (${s.why})` : ""}`,
    );
  const one = { same: 0, differs: 0, refused: 0, unjudged: 0, unchecked: 0 };
  for (const match of browser) {
    const { engine } = await engineForMatch(engines, matchEngineOf(match), {
      only,
    });
    const r = replayBrowser(engine, match);
    for (const k of Object.keys(one)) one[k] += r[k];
    const when = new Date(match.t).toISOString().slice(0, 16).replace("T", " ");
    log(
      `${match.mode}${tagged(match.client ? [match.client] : [])} ${match.name ?? ""} (${when} UTC): ${r.steps.length} actions on ${engine.version}, ${r.same} same, ${r.differs} differ, ${r.refused} refused, ${r.unjudged} unjudged${r.unchecked ? `, ${r.unchecked} unchecked` : ""}${r.end ? `; the end ${r.end}` : ""}${engineNote(match.engine ? [match.engine] : [], engine.version)}`,
    );
    for (const s of r.steps)
      if (
        throws
          ? s.type === "throw" ||
            (s.outcome !== "same" && s.outcome !== "unjudged")
          : s.outcome === "differs" || s.outcome === "refused"
      )
        line(s);
  }
  if (browser.length)
    log(
      `${browser.length} one-browser matches: ${one.same} same, ${one.differs} differ, ${one.refused} refused, ${one.unjudged} unjudged`,
    );
  return { browser: one };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i < 0 ? undefined : rest[i + 1];
  };
  const opts = {
    room: flag("room"),
    since: flag("since"),
    dir: flag("dir") ?? "build/games",
    throws: rest.includes("--throws"),
    engine: flag("engine"),
  };
  if (mode === "pull") await pull(opts);
  else if (mode === "replay") await replay(opts);
  else
    throw new Error(
      "Usage: node tools/games.mjs pull [--room <code>] | replay",
    );
}
