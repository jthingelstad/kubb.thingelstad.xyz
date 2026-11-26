// Players' reports (MENU, SEND FEEDBACK: a throw or anything else; backend/api/records.mjs): fetch them, read
// them, and play the reported moment again through this checkout's engine (the report's
// own when the checkout carries it, else the newest: docs/ENGINES.md).
//
//   node tools/reports.mjs pull [--since 2026-11-16] [--dir build/reports]
//       copies new reports from the pitches stack's games bucket (the api function keeps
//       them under reports/<yyyy-mm-dd>/) to build/reports/<yyyy-mm-dd>/ (never in git:
//       they carry what players typed) and prints each new one. Run as the
//       cloud-engineer identity.
//   node tools/reports.mjs show [--dir build/reports] [file ...]
//       prints reports already pulled (all of them, or the files named).
//   node tools/reports.mjs replay <file> [--engine <major.minor>]
//       feedback (`kind: "feedback"`) with no throw in it has nothing to replay; one that
//       carries a throw replays as a throw report does. A match: restores the snapshot before the last action and applies it, and says
//       whether this engine ends on the reported snapshot; with the whole history, also
//       replays the match from its start. Practice: sets the pitch out with the report's
//       options and runs its throws and changes again. Prints the last throw's result and
//       where the pieces lie, beside where the player's browser had them.
//
// The pure parts (describeReport, replayReport) are tested in tests/net/reports.test.mjs.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecord, openGamesBucket } from "./games.mjs";
import {
  paintMap,
  paintProblem,
  pieceName,
  piecesUnder,
} from "../src/net/paint.js";

const PREFIX = "reports/";
const KEY = /^(\d{4}-\d{2}-\d{2})\/(\d{13}-[2-9a-hjkmnp-z]{4,16}\.json\.gz)$/;

const when = (t) =>
  Number.isFinite(t)
    ? new Date(t).toISOString().slice(0, 19).replace("T", " ") + " UTC"
    : "?";

// What a report is about: "throw" (also one kept with no `kind`, from before feedback) or
// "feedback".
export const reportKind = (r) =>
  r?.kind === "feedback" ? "feedback" : "throw";

// A pulled report ({ t, report }) as lines to print. `file` is where it lies.
export function describeReport(obj, file = "") {
  const r = obj.report ?? {};
  const lines = [];
  const code = r.pitch ?? r.room; // `room` from older clients
  const where = code ? ` pitch ${code} v ${r.v ?? "?"}` : "";
  const client = typeof r.client === "string" ? ` [${r.client}]` : "";
  const kind = reportKind(r);
  lines.push(
    `${when(obj.t)}  ${kind}  ${r.mode ?? "?"}${client}${where}  ${file}`,
  );
  const text = (label, s) => {
    const body = String(s ?? "").trim();
    lines.push(`  ${label}: ${body ? body.replace(/\s*\n\s*/g, " / ") : "-"}`);
  };
  if (kind === "feedback") text("Feedback", r.text);
  else {
    text("What happened", r.happened);
    text("What should have happened", r.should);
  }
  if (Array.isArray(r.selectedPieces) && r.selectedPieces.length)
    text(
      "Marked pieces",
      r.selectedPieces
        .map((p) => `${p.kind} ${p.id} (${p.x}, ${p.y})`)
        .join(", "),
    );
  lines.push(...describePaint(r));
  const n = r.need ?? {};
  const turn =
    n.turn !== undefined ? `turn ${n.turn}, throw ${n.throws ?? "?"}` : "";
  lines.push(
    `  At: ${[r.phase, n.kind, n.side && `side ${n.side}`, turn].filter(Boolean).join(", ")}`,
  );
  const lt = r.lastThrow;
  if (lt)
    lines.push(
      `  Last throw: ${lt.action?.how ?? "?"}${lt.result?.flag ? `, ${lt.result.flag}` : ""}${lt.action?.scripted ? " (the computer)" : ""}`,
    );
  const state = [];
  if (r.snapshots?.before && r.last) state.push("before + last action");
  if (r.snapshots?.start && r.actions)
    state.push(`start + ${r.actions.length} actions`);
  if (r.practice?.before) state.push("practice checkpoint + reported throw");
  if (r.practice?.ops) state.push(`practice + ${r.practice.ops.length} steps`);
  if (code) state.push(`recorded pitch: ${code} (v ${r.v ?? "?"})`);
  lines.push(`  Replay: ${state.join("; ") || "nothing replayable"}`);
  if (r.dropped) lines.push(`  Dropped to fit: ${r.dropped.join(", ")}`);
  lines.push(
    `  Build: ${r.build?.label ?? r.build?.version ?? "?"} ${String(r.build?.commit ?? "?").slice(0, 10)}, ${r.build?.lua ?? "?"}, ${typeof r.engine === "string" ? `engine ${r.engine}` : `core ${String(r.build?.core ?? "?").slice(0, 10)}`}; ${r.viewport?.w ?? "?"}x${r.viewport?.h ?? "?"}`,
  );
  return lines;
}

// The paint on a report (src/net/paint.js) as lines: the strokes, the pieces under it
// and a text map of the pitch with the painted ground.
export function describePaint(r) {
  const paint = r?.paint;
  if (paint === undefined || paint === null) return [];
  if (paintProblem(paint)) return ["  Paint: not readable"];
  const points = paint.strokes.reduce((n, s) => n + s.length, 0);
  const out = [
    `  Paint: ${paint.strokes.length} stroke${paint.strokes.length === 1 ? "" : "s"}, ${points} points, brush ${paint.brush} m`,
  ];
  const pieces = Array.isArray(r.pieces) ? r.pieces : null;
  if (!pieces) {
    out.push("  Under the paint: the pieces were dropped to fit");
    return out;
  }
  const under = piecesUnder(pieces, paint);
  out.push(
    `  Under the paint: ${under.length ? under.map(pieceName).join(", ") : "no piece"}`,
  );
  out.push(
    "  Map (far baseline at the top; # paint, K king, A/B kubbs, lower case down, / baton):",
  );
  for (const l of paintMap(pieces, paint)) out.push(`    ${l}`);
  return out;
}

function piecesNow(engine) {
  return (engine.view().items || []).filter((it) => it.kind !== "stake");
}

// How far the pieces here are from the report's (metres, the largest), by id.
function drift(here, reported) {
  if (!reported) return null;
  const by = new Map(reported.map((p) => [p.id, p]));
  let max = 0;
  let missing = 0;
  for (const p of here) {
    const q = by.get(p.id);
    if (!q) {
      missing++;
      continue;
    }
    max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
  }
  return { max, missing };
}

// One report through `engine`. Returns { kind, steps: [...], last, pieces, drift } or
// { kind: null, why } when it carries nothing to replay.
export function replayReport(engine, obj) {
  const r = obj.report ?? obj;
  const out = { kind: null, notes: [] };
  // Feedback about anything carries the game as it stood; only a throw in it replays.
  if (reportKind(r) === "feedback" && !r.lastThrow)
    return { ...out, why: "it is feedback, and it carries no throw" };
  if (r.practice) {
    const checkpoint = r.practice.before;
    const ops =
      checkpoint && r.lastThrow?.action ? [r.lastThrow.action] : r.practice.ops;
    if (!ops) return { ...out, why: "the practice steps were dropped" };
    out.kind = "practice";
    if (checkpoint) {
      engine.call("restorePractice", { checkpoint });
      out.notes.push(
        "Replayed the reported throw from its practice checkpoint.",
      );
    } else {
      engine.newPractice({ ...r.practice.opts });
      if (r.practice.opts?.level) engine.setLevel(r.practice.opts.level);
    }
    for (const op of ops) {
      if (op.type === "throw") engine.apply(op);
      else if (op.type === "reset") engine.reset();
      else if (op.type === "drill") engine.setDrill(op.on);
      else if (op.type === "surface") engine.setSurface(op.surface);
      else out.notes.push(`skipped ${op.type}`);
    }
  } else if (r.snapshots?.before && r.last) {
    out.kind = "match";
    if (r.snapshots.start && r.actions) {
      engine.restore(r.snapshots.start);
      let refused = 0;
      for (const a of r.actions) {
        const res = engine.apply(a);
        if (res && res.ok === false) refused++;
      }
      const whole = engine.hash().hash;
      out.whole = { actions: r.actions.length, refused, hash: whole };
    }
    let expect = null;
    if (r.snapshots.now) {
      engine.restore(r.snapshots.now);
      expect = engine.hash().hash;
    }
    engine.restore(r.snapshots.before);
    const res = engine.apply(r.last);
    out.applied = res && res.ok !== false;
    const got = engine.hash().hash;
    out.same = expect === null ? null : got === expect;
    if (out.whole)
      out.whole.same = expect === null ? null : out.whole.hash === expect;
  } else {
    return { ...out, why: "no snapshot and action, and no practice steps" };
  }
  const rec = engine.recording();
  out.last = rec?.result
    ? {
        flag: rec.result.flag ?? null,
        rest: rec.result.restText ?? null,
        ruling: rec.result.ruling?.text ?? null,
        how: rec.projectile?.how ?? null,
      }
    : null;
  const pieces = piecesNow(engine);
  out.pieces = pieces.map((p) => ({
    id: p.id,
    kind: p.kind,
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
    toppled: !!p.toppled,
  }));
  out.drift = drift(
    pieces,
    r.practice?.before && r.last?.type !== "throw"
      ? null
      : r.pieces?.filter((p) => p.kind !== "stake"),
  );
  return out;
}

async function readReport(file) {
  return parseRecord(await fs.readFile(file));
}

async function listFiles(dir) {
  const out = [];
  let days;
  try {
    days = (await fs.readdir(dir)).sort();
  } catch {
    return out;
  }
  for (const day of days) {
    let names;
    try {
      names = (await fs.readdir(path.join(dir, day))).sort();
    } catch {
      continue;
    }
    for (const n of names)
      if (/\.json(\.gz)?$/.test(n)) out.push(path.join(dir, day, n));
  }
  return out;
}

async function show(files) {
  for (const file of files) {
    console.log(describeReport(await readReport(file), file).join("\n"));
    console.log("");
  }
}

async function pull({ since, dir }) {
  const { s3, bucket, ListObjectsV2Command, GetObjectCommand } =
    await openGamesBucket();
  const after = since ? Date.parse(since) : 0;
  if (Number.isNaN(after)) throw new Error(`--since ${since} is not a date`);
  let token;
  const got = [];
  let had = 0;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const { Key } of page.Contents ?? []) {
      const m = KEY.exec(Key.slice(PREFIX.length));
      if (!m) continue;
      if (Number(m[2].slice(0, 13)) < after) continue;
      const file = path.join(dir, m[1], m[2]);
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
      got.push(file);
    }
    token = page.NextContinuationToken;
  } while (token);
  console.log(`${got.length} new reports in ${dir} (${had} already here)\n`);
  await show(got);
}

async function replay(file, only) {
  if (!file) throw new Error("Usage: npm run reports:replay -- <file>");
  const { checkoutEngines, engineForMatch } = await import("./engines.mjs");
  const obj = await readReport(file);
  console.log(describeReport(obj, file).join("\n"));
  const r = obj.report ?? {};
  const { engine } = await engineForMatch(checkoutEngines(), r.engine, {
    only,
  });
  console.log(`\nReplaying through kubb-engine ${engine.version}.`);
  if (typeof r.engine === "string" && r.engine !== engine.version)
    console.log(
      `Note: the report was made on engine ${r.engine}; this replay runs ${engine.version}.`,
    );
  const out = replayReport(engine, obj);
  if (!out.kind) {
    console.log(`\nNothing to replay: ${out.why}.`);
    return;
  }
  console.log("");
  if (out.whole)
    console.log(
      `Whole match: ${out.whole.actions} actions from the start, ${out.whole.refused} refused, ${out.whole.same === null ? "no snapshot to compare" : out.whole.same ? "same" : "differs"}`,
    );
  if (out.kind === "match")
    console.log(
      `Last action from the snapshot before it: ${out.applied ? "applied" : "refused"}, ${out.same === null ? "no snapshot after to compare" : out.same ? "same as the player's browser" : "differs from the player's browser"}`,
    );
  if (out.last)
    console.log(
      `Last throw: ${out.last.how ?? "?"}${out.last.flag ? `, ${out.last.flag}` : ""}${out.last.rest ? `, ${out.last.rest}` : ""}${out.last.ruling ? ` (${out.last.ruling})` : ""}`,
    );
  if (out.drift)
    console.log(
      `Pieces against the report: ${out.drift.max.toFixed(4)} m at most${out.drift.missing ? `, ${out.drift.missing} not in the report` : ""}`,
    );
  for (const n of out.notes) console.log(`Note: ${n}`);
  console.log("Pieces (thrower's view frame, metres):");
  for (const p of out.pieces)
    console.log(
      `  ${String(p.id).padEnd(6)} ${p.kind.padEnd(5)} x ${p.x.toFixed(3).padStart(7)} y ${p.y.toFixed(3).padStart(6)}${p.toppled ? "  down" : ""}`,
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i < 0 ? undefined : rest[i + 1];
  };
  const dir = flag("dir") ?? "build/reports";
  const files = rest.filter(
    (x, i) => !x.startsWith("--") && !rest[i - 1]?.startsWith("--"),
  );
  if (mode === "pull") await pull({ since: flag("since"), dir });
  else if (mode === "show")
    await show(files.length ? files : await listFiles(dir));
  else if (mode === "replay") await replay(files[0], flag("engine"));
  else
    throw new Error(
      "Usage: node tools/reports.mjs pull [--since <date>] | show [file ...] | replay <file>",
    );
}
