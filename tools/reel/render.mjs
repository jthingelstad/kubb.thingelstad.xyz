// A highlight reel from a kept replay, rendered on this machine with the reel
// function's own renderer (backend/reels/render.mjs), plus a contact sheet per format
// to look at. docs/REEL.md.
//
//   node tools/reel/render.mjs --replay <file> [--code <pitch>] [--out <dir>]
//        [--formats tall,wide] [--name <reel>] [--peek <n>] [--scene <id>]
//
// --scene draws the reel in that scene (src/render/scenes.js) instead of the match's
// own, to look at one.
// Writes <out>/<name>-tall.mp4, <name>-wide.mp4, <name>.edit.json (the edit list) and
// <name>-<format>-sheet.png (one still per moment and the cards, cut from the MP4 by
// ffmpeg). FFMPEG names the ffmpeg to use (the one on the PATH otherwise). The replay
// plays on its own engine where this checkout carries it, else on the newest (said
// on the console), as the reel function never would (docs/ENGINES.md).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { bundleLua, carriedEngines } from "../lua-bundle.mjs";
import { majorMinor } from "../../backend/reels/tag.mjs";
import {
  renderReel as renderCore,
  sampleCode,
  ffmpegPath,
  FORMATS,
  FPS,
  planFrames,
} from "../../backend/reels/render.mjs";
import * as O from "../../backend/reels/overlay.mjs";
import { REEL_EMPTY } from "../../backend/reels/highlights.mjs";

export { FORMATS, FPS, planFrames, sampleCode };

// The checkout's engine a replay plays on: its own where carried, else the newest.
export function replayEngine(replay, vendorDir) {
  const carried = carriedEngines(vendorDir);
  const own = carried.find((e) => e.mm === majorMinor(replay?.engine));
  return { ...(own ?? carried[0]), own: !!own };
}

// The server's reel under <out>/<name>-*, with contact sheets beside it.
export async function renderReel({
  replay,
  code,
  out,
  name,
  formats = ["tall", "wide"],
  sources,
  log = console.log,
  peek = 0,
  capture = null,
  scene = null,
}) {
  if (!sources) {
    const e = replayEngine(replay);
    if (!e.own)
      log(
        `${name}: played on engine ${replay?.engine ?? "(none named)"}, rendered on ${e.version}`,
      );
    sources = bundleLua(e.dir);
  }
  const work = path.join(out, `.${name}`);
  const result = await renderCore({
    replay,
    code,
    out: peek ? out : work,
    formats,
    sources,
    log: (line) => log(line.replace(`reel ${code}`, name)),
    peek,
    capture,
    scene,
  });
  if (peek || capture) return result;
  const files = {};
  for (const f of formats) {
    files[f] = path.join(out, `${name}-${f}.mp4`);
    fs.renameSync(result.files[f], files[f]);
  }
  fs.renameSync(result.files.edit, path.join(out, `${name}.edit.json`));
  fs.rmSync(work, { recursive: true, force: true });
  const edit = result.edit;
  const stills = {
    title: edit.stills.title,
    end: edit.stills.end,
    moments: edit.moments.map((m) => m.still),
  };
  for (const o of result.formats)
    await contactSheet(
      files[o.f],
      path.join(out, `${name}-${o.f}-sheet.png`),
      stills,
      edit,
      o,
    );
  return { files, edit, timing: result.timing };
}

async function contactSheet(mp4, file, stills, edit, o) {
  const times = [
    { t: stills.title, label: "TITLE" },
    ...stills.moments.map((t, i) => ({ t, label: edit.moments[i].caption })),
    { t: stills.end, label: "END" },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
  const imgs = [];
  for (const [i, x] of times.entries()) {
    const png = path.join(dir, `${i}.png`);
    const r = spawnSync(ffmpegPath(), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(x.t),
      "-i",
      mp4,
      "-frames:v",
      "1",
      png,
    ]);
    if (r.status !== 0) throw new Error(`still at ${x.t}`);
    imgs.push(await loadImage(fs.readFileSync(png)));
  }
  fs.rmSync(dir, { recursive: true });
  const tall = o.H > o.W;
  const cols = tall ? 4 : 3;
  const tw = tall ? 360 : 560;
  const th = Math.round((tw * o.H) / o.W);
  const pad = 16;
  const lab = 54;
  const rows = Math.ceil(imgs.length / cols);
  const c = createCanvas(
    cols * (tw + pad) + pad,
    rows * (th + lab + pad) + pad + 60,
  );
  const x = c.getContext("2d");
  x.fillStyle = "#f7f0de";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#17140f";
  x.font = `900 34px ${O.DISPLAY}`;
  x.fillText(
    `${edit.teams.A} v ${edit.teams.B}: ${edit.result}  ·  ${edit.seconds.toFixed(1)} s  ·  ${edit.address}`,
    pad,
    44,
  );
  imgs.forEach((im, i) => {
    const cx = pad + (i % cols) * (tw + pad);
    const cy = 60 + pad + Math.floor(i / cols) * (th + lab + pad);
    x.drawImage(im, cx, cy, tw, th);
    x.font = `700 20px ${O.LABEL}`;
    x.fillText(`${times[i].t.toFixed(2)} s`, cx, cy + th + 22);
    x.font = `900 22px ${O.DISPLAY}`;
    const t = String(times[i].label).toUpperCase();
    x.fillText(t.length > 34 ? t.slice(0, 33) + "..." : t, cx, cy + th + 46);
  });
  fs.writeFileSync(file, await c.encode("png"));
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = arg("replay");
  if (!file) {
    console.error(
      "usage: node tools/reel/render.mjs --replay <file> [--code c] [--out dir] [--formats tall,wide]",
    );
    process.exit(2);
  }
  const replay = JSON.parse(fs.readFileSync(file, "utf8"));
  const name = arg("name", path.basename(file).replace(/\.json$/, ""));
  try {
    await renderReel({
      replay,
      name,
      code: arg("code", sampleCode(name)),
      out: arg("out", "build/reel/out"),
      formats: arg("formats", "tall,wide").split(","),
      peek: Number(arg("peek", 0)),
      scene: arg("scene"),
    });
  } catch (error) {
    if (error?.code !== REEL_EMPTY) throw error;
    console.error(`${file}: no reel: ${error.message}`);
    process.exit(1);
  }
}
