// A highlight reel from a kept replay (docs/REEL.md): the match played again through
// the engine (scan.mjs), the highlights picked (highlights.mjs), and each one filmed
// with the game's own renderer (src/render/world.js, pure canvas 2D) on @napi-rs/canvas,
// frame by frame at a fixed step: 30 frames a second of reel, each frame the recording
// shown at its own time (engine.showAt), so slow motion is more frames per second of
// flight, never a guess. Frames go to ffmpeg (libx264) as raw RGBA; the game's sounds
// are mixed offline (audio.mjs) and muxed after. No browser.
//
// The one renderer of the reel function (handler.mjs, on Lambda) and the command line
// (tools/reel/render.mjs).
//
//   const { files, edit } = await renderReel({ replay, code, out, sources })
//
// Writes <out>/tall.mp4 (1080x1920), <out>/wide.mp4 (1920x1080) (H.264 High, yuv420p,
// 30 fps, AAC, faststart) and <out>/edit.json (the edit list, with each moment's
// still time).
import { NAMES } from "../pitch-server/names.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Stage } from "../../src/render/scenes.js";
import { setSpriteMaker } from "../../src/render/glow.js";
import { drawBurst, burstLength } from "../../src/render/burst.js";
import { projectView } from "../../src/render/camera.js";
import { scanReplay, openReplay, piecesCount } from "./scan.mjs";
import { NoHighlights, pickHighlights, resultLine } from "./highlights.mjs";
import * as C from "./cameras.mjs";
import * as O from "./overlay.mjs";
import { mixReel } from "./audio.mjs";
import { encodeQr, isQr } from "./qr.mjs";

export const FPS = 30;

export const FORMATS = {
  tall: { W: 1080, H: 1920, cy: 0.5 },
  wide: { W: 1920, H: 1080, cy: 0.44 },
  // The App Store's App Preview sizes, portrait: the tall reel's cameras and layout
  // (`as`) in another shape. Only the command line asks for them
  // (tools/reel/render.mjs); the reel function makes tall and wide.
  iphone: { W: 886, H: 1920, cy: 0.5, as: "tall" },
  ipad: { W: 1200, H: 1600, cy: 0.42, as: "tall" },
};

// The files the reel needs beside the code: the display face, the label face and the
// game's knock takes. From the repository by default; the function passes the copies
// its package carries (tools/reels-bundle.mjs), so nothing is fetched at run time.
const repo = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
export const repoAssets = () => ({
  display: repo("backend/pages/LondrinaSolid-Black.ttf"),
  label: repo("public/shared/fonts/inter-latin-wght-normal.woff2"),
  sounds: repo("public/sounds"),
});

let fonts = false;
export function loadFonts(assets = repoAssets()) {
  if (fonts) return;
  GlobalFonts.registerFromPath(assets.display, "Londrina Solid");
  GlobalFonts.registerFromPath(assets.label, "Inter");
  fonts = true;
}

// ffmpeg: FFMPEG, else the one on the PATH (the function's layer puts it in /opt/bin).
export const ffmpegPath = () => process.env.FFMPEG || "ffmpeg";

// A pitch code for a sample reel (codes as the api accepts them).
export function sampleCode(name) {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  let s = "";
  for (let i = 0; i < 10; i++) {
    h = Math.imul(h ^ (h >>> 13), 2654435761);
    s += A[(h >>> 0) % A.length];
  }
  return s;
}

// The end card's QR code: the address as the https:// link a viewer would type, at
// level M (docs/REEL.md "The end card"). Null, and the card as it was, when it cannot
// be made: a code never costs a reel.
export function endCardCode(
  address,
  { log = console.log, encode = encodeQr } = {},
) {
  try {
    const qr = encode(`https://${address}`, { level: "M" });
    if (!isQr(qr)) throw new Error("not a QR symbol");
    return qr;
  } catch (error) {
    log(`end card without its QR code (${error?.message})`);
    return null;
  }
}

// One end card frame. When its code cannot be drawn the frame is drawn again
// (`redraw`, the pitch under it) as the card was, with the URL only, and the code it
// returns (null) is the one the format's later frames use: a code never costs a reel.
export function drawEndCard(
  ctx,
  L,
  card,
  { log = console.log, redraw = () => {} } = {},
) {
  try {
    O.endCard(ctx, L, card);
    return card.qr ?? null;
  } catch (error) {
    if (!card.qr) throw error;
    log(`end card without its QR code (${error?.message})`);
    redraw();
    O.endCard(ctx, L, { ...card, qr: null });
    return null;
  }
}

// The reel as frames: every frame's recording time, camera and overlay, from the edit
// list. A plan is the same for every format; cameras are made per format.
export function planFrames(edit) {
  const frames = [];
  const push = (f) => frames.push(f);
  const n = (s) => Math.max(1, Math.round(s * FPS));
  // a card of no length (a cut without it, highlights.mjs `cut`) has no frame
  const card = (s) => (s > 0 ? n(s) : 0);
  for (let j = 0, N = card(edit.title); j < N; j++)
    push({ card: "title", u: j / N, local: j / FPS });
  edit.moments.forEach((m, mi) => {
    // the camera of each shot, and the run of shots one camera films without a cut
    let group = 0;
    let prev = null;
    const shots = m.shots.map((s) => {
      let cam = s.cam === "release" ? "arc" : s.cam;
      if (cam === "rest") cam = prev && prev !== "arc" ? prev : "land";
      if (cam !== prev || s.replay) group++;
      prev = cam;
      return { ...s, cam, group };
    });
    const count = {};
    for (const s of shots) {
      const k = s.hold ?? (s.t1 - s.t0) / s.rate;
      count[s.group] = (count[s.group] || 0) + n(k);
    }
    const seen = {};
    let local = 0;
    shots.forEach((s, si) => {
      const N = s.hold != null ? n(s.hold) : n((s.t1 - s.t0) / s.rate);
      for (let j = 0; j < N; j++) {
        const g = (seen[s.group] = (seen[s.group] || 0) + 1);
        const t = s.hold != null ? s.t0 : s.t0 + (j / FPS) * s.rate;
        push({
          moment: mi,
          shot: si,
          cam: s.cam,
          t,
          dt: s.hold != null ? 0 : s.rate / FPS,
          u: (g - 1) / Math.max(1, count[s.group] - 1),
          slow: s.hold == null && s.rate < 1,
          replay: !!s.replay,
          focus: s.focus ?? null,
          at: s.at ?? null,
          first: j === 0,
          local: local++ / FPS,
        });
      }
    });
  });
  for (let j = 0, N = card(edit.endCard); j < N; j++)
    push({ card: "end", u: j / N, local: j / FPS });
  return frames;
}

function encoder(ffmpeg, file, W, H) {
  const p = spawn(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${W}x${H}`,
      "-r",
      String(FPS),
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "19",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(FPS),
      file,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise((res, rej) =>
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))),
  );
  return {
    write: (buf) =>
      new Promise((res, rej) =>
        p.stdin.write(buf, (e) => (e ? rej(e) : res())),
      ),
    end: () => {
      p.stdin.end();
      return done;
    },
  };
}

function mux(ffmpeg, video, wav, out) {
  const r = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      video,
      "-i",
      wav,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-shortest",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("ffmpeg mux failed");
}

// The kubbs standing in each team's own half.
const standingOf = (c) =>
  c ? { A: c.A.base + c.A.field, B: c.B.base + c.B.field } : null;

export async function renderReel({
  replay,
  code,
  out,
  formats = ["tall", "wide"],
  sources,
  assets = repoAssets(),
  ffmpeg = ffmpegPath(),
  log = console.log,
  peek = 0, // every nth frame as a PNG and no video (looking at cameras)
  capture = null, // (format, { camera, items, scene }) per frame, drawing nothing (bench.mjs)
  scene: sceneId = null, // draw in this scene instead of the match's own (tools)
  cut = {}, // the reel's lengths in place of the tune's (highlights.mjs; tools)
}) {
  if (!sources) throw new Error("renderReel needs the engine's Lua sources");
  loadFonts(assets);
  fs.mkdirSync(out, { recursive: true });
  const t0 = performance.now();
  const scan = await scanReplay(replay, { sources });
  const teams = shownTeams(scan.teams || scan.end?.teams);
  const edit = pickHighlights(scan, cut);
  // nothing to show: no encoder is started on nothing
  if (!edit.moments?.length) throw new NoHighlights();
  const address = `throwingwood.com/p/${code}`;
  const qr = endCardCode(address, { log });
  const frames = planFrames(edit);
  const facts = new Map(scan.throws.map((t) => [t.i, t]));
  const tScan = performance.now();

  // the outputs
  const F = formats.map((f) => {
    const { W, H, cy, as = f } = FORMATS[f];
    const k = W / 400;
    const frame = { w: 400, h: H / k, cy };
    const canvas = createCanvas(W, H);
    const tmp = path.join(out, `.${f}.video.mp4`);
    return {
      f,
      as, // the format whose cameras and layout this one takes
      W,
      H,
      k,
      frame,
      canvas,
      ctx: canvas.getContext("2d"),
      view: { width: W, height: H, dpr: 1, fit: { k, ox: 0, oy: 0 } },
      L: O.layoutFor(as, W, H),
      tmp,
      enc: peek || capture ? null : encoder(ffmpeg, tmp, W, H),
      stills: [],
    };
  });

  // the engine, played to each moment in turn
  const { engine, view } = await openReplay(replay, { sources });
  // the scenes' rings and puffs where pieces strike the ground (src/render/impacts.js)
  engine.setImpacts?.(true);
  const scene = { surface: view.surface, set: view.set };
  // the match in its own scene, as the game draws it (src/render/scenes.js);
  // glows are sprites on this canvas, the stars and halos of the night
  const stage = new Stage({ reduced: false });
  stage.use(sceneId ?? view.scene);
  if (stage.look) setSpriteMaker((w, h) => createCanvas(w, h));
  const ui = stage.look?.skin?.ui;
  if (ui) for (const o of F) o.L = { ...o.L, wash: ui.paper, washInk: ui.ink };
  let fxT = null;
  const startItems = view.items;
  let stepped = -1;
  let rec = null;
  let lastItems = startItems;
  const reachMoment = (i) => {
    while (stepped < i) {
      const r = engine.replayStep();
      stepped = r.replay.i - 1;
      if (stepped === i) rec = r.recording;
    }
  };

  // a drill's last shot: the half as it stood once the kubbs were raised (and a
  // punishment kubb placed), the state just before the next baton. The match is
  // stepped on to it; the next moment is never before it (highlights.mjs).
  let settledItems = null;
  const reachSettled = (at) => {
    while (stepped < at - 1) {
      const r = engine.replayStep();
      stepped = r.replay.i - 1;
    }
    settledItems = engine.view().items;
  };

  const events = []; // sounds, in reel seconds
  const bursts = []; // { kind, anchor, at } live in reel seconds
  let curMoment = -1;
  let hitShown = false;
  for (let fi = 0; fi < frames.length; fi++) {
    const fr = frames[fi];
    const now = fi / FPS;
    let items = lastItems;
    let fact = null;
    let m = null;
    if (fr.moment != null) {
      m = edit.moments[fr.moment];
      fact = facts.get(m.i);
      if (fr.moment !== curMoment) {
        curMoment = fr.moment;
        reachMoment(m.i);
        fxT = null;
        hitShown = false;
        bursts.length = 0;
      }
      if (fr.cam === "settled") {
        if (fr.first) reachSettled(fr.at);
        items = settledItems;
      } else items = engine.showAt(fr.t).items;
      lastItems = items;
      // what happens in this frame's slice of the throw: knocks and bursts
      if (fr.dt > 0) {
        const a = fr.t,
          b = fr.t + fr.dt;
        const inSlice = (x) => x >= a && x < b;
        for (const k of fact.touches)
          if (inSlice(k.t))
            events.push({
              t: now,
              kind: "knock",
              gain: k.kind === "king" ? 1 : 0.9,
            });
        for (const bu of fact.bursts)
          if (inSlice(bu.start)) {
            bursts.push({ ...bu, at: now });
            if (bu.kind === "king") events.push({ t: now, kind: "king" });
          }
        if (fact.firstHit && inSlice(fact.firstHit.t)) hitShown = true;
      }
      if (fr.first && fr.replay) bursts.length = 0;
      // the scene's effects follow the throw shown: from its start again on a
      // new moment or an action replay, still on a hold or the settled half
      if (stage.look) {
        if (fr.first && (fr.replay || fxT == null || fr.t < fxT)) {
          stage.clear();
          stage.watch(rec);
        }
        if (fr.dt > 0) stage.observe(items, (fxT = fr.t));
        else stage.tick(1 / FPS);
      }
    } else {
      if (fr.card === "title") items = startItems;
      stage.tick(1 / FPS);
    }
    const pid = rec?.projectile?.id;
    for (const o of F) {
      const { ctx, view: v, frame, L } = o;
      let camera;
      if (fr.card) camera = C.overview(o.as, frame);
      else {
        const baton = items.find((it) => it.id === pid) || null;
        if (fr.cam === "arc") camera = C.arc(fact, o.as, frame, baton);
        else if (fr.cam === "impact")
          camera = C.impact(fact, o.as, frame, fr.u);
        else if (fr.cam === "king") {
          const kp = startItems.find((it) => it.kind === "king");
          camera = C.king(
            fact,
            o.as,
            frame,
            fr.u,
            kp ? { x: kp.x, y: kp.y } : undefined,
          );
        } else if (fr.cam === "group" || fr.cam === "settled")
          camera = C.group(
            fact,
            o.as,
            frame,
            fr.u,
            fr.focus,
            fr.cam === "settled",
          );
        else camera = C.land(fact, o.as, frame, fr.u);
      }
      if (capture) {
        capture(o.f, { camera, items, scene });
        continue;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      stage.draw(ctx, v, camera, { ...scene, items }, now);
      if (fr.card === "title")
        O.titleCard(ctx, L, { teams, a: Math.min(1, fr.u * 6) });
      else if (fr.card === "end") {
        o.qr = drawEndCard(
          ctx,
          L,
          {
            winner: edit.end?.winner,
            teams,
            line: howLine(edit.end),
            address,
            qr: o.qr === undefined ? qr : o.qr,
            a: Math.min(1, fr.u * 6),
          },
          {
            log: (m) => log(`reel ${code}: ${o.f} ${m}`),
            redraw: () => {
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              stage.draw(ctx, v, camera, { ...scene, items }, now);
            },
          },
        );
      } else {
        const size = Math.min(o.W, o.H) * 0.22;
        for (const bu of bursts) {
          const ph = now - bu.at;
          if (ph < 0 || ph >= burstLength(bu.kind)) continue;
          const p = projectView(
            v,
            camera,
            bu.anchor.x,
            bu.anchor.y,
            bu.anchor.z,
          );
          if (p) drawBurst(ctx, p[0], p[1], bu.kind, ph, { size });
        }
        O.scoreLine(ctx, L, {
          teams,
          standing: standingOf(
            fr.cam === "settled"
              ? piecesCount(items)
              : hitShown || fr.t >= fact.duration
                ? m.after
                : m.before,
          ),
        });
        O.tag(ctx, L, fr.replay ? "REPLAY" : fr.slow ? "SLOW MOTION" : null);
        O.caption(ctx, L, {
          text: m.caption,
          side: m.side,
          turn: m.turn,
          a: Math.min(1, fr.local / 0.2),
        });
      }
      if (peek) {
        if (fi % peek === 0) {
          const d = path.join(out, `peek-${o.f}`);
          fs.mkdirSync(d, { recursive: true });
          const lab = fr.card || `m${fr.moment}-${fr.cam}-t${fr.t.toFixed(2)}`;
          fs.writeFileSync(
            path.join(d, `${String(fi).padStart(4, "0")}-${lab}.png`),
            await o.canvas.encode("png"),
          );
        }
      } else await o.enc.write(Buffer.from(o.canvas.data()));
    }
  }
  engine.replayEnd();
  if (peek || capture) return { edit, frames: frames.length, scene: stage.id };
  const tDraw = performance.now();
  await Promise.all(F.map((o) => o.enc.end()));
  const tEnc = performance.now();
  const seconds = frames.length / FPS;
  const wav = path.join(out, ".sound.wav");
  fs.writeFileSync(wav, mixReel(events, seconds, { dir: assets.sounds }));
  const files = {};
  for (const o of F) {
    const mp4 = path.join(out, `${o.f}.mp4`);
    mux(ffmpeg, o.tmp, wav, mp4);
    fs.rmSync(o.tmp);
    files[o.f] = mp4;
  }
  fs.rmSync(wav);
  const tMux = performance.now();
  // the edit list, with where each moment's impact is in the reel
  const stills = stillTimes(edit, frames, facts);
  const editOut = {
    code,
    address,
    teams,
    result: endLine(edit),
    end: edit.end,
    seconds,
    fps: FPS,
    formats: Object.fromEntries(
      F.map((o) => [o.f, { width: o.W, height: o.H }]),
    ),
    title: edit.title,
    endCard: edit.endCard,
    stills: { title: stills.title, end: stills.end },
    moments: edit.moments.map((m, i) => ({ ...m, still: stills.moments[i] })),
    sounds: events.length,
  };
  files.edit = path.join(out, "edit.json");
  fs.writeFileSync(files.edit, JSON.stringify(editOut, null, 2) + "\n");
  const tSheet = performance.now();
  const timing = {
    frames: frames.length,
    seconds,
    scan: (tScan - t0) / 1000,
    draw: (tDraw - tScan) / 1000,
    encodeTail: (tEnc - tDraw) / 1000,
    mux: (tMux - tEnc) / 1000,
    edit: (tSheet - tMux) / 1000,
    total: (tSheet - t0) / 1000,
    load: os.loadavg().map((x) => Math.round(x * 10) / 10),
  };
  log(
    `reel ${code}: ${frames.length} frames (${seconds.toFixed(1)} s), ${formats.join("+")} in ${timing.total.toFixed(1)} s ` +
      `(scan ${timing.scan.toFixed(1)}, draw+encode ${timing.draw.toFixed(1)}, tail ${timing.encodeTail.toFixed(1)}, mux ${timing.mux.toFixed(1)}), load ${timing.load.join(" ")}`,
  );
  return { files, edit: editOut, timing, formats: F, scene: stage.id };
}

// The end card's second line: how it was won.
function howLine(end) {
  if (!end?.winner) return null;
  if (/resign/i.test(end.how || "")) return end.how;
  if (/early/i.test(end.text || "")) return "The king fell early";
  return `The king falls in turn ${end.turns}`;
}

function endLine(edit) {
  return resultLine(edit.end, edit.teams);
}

// The reel times of the stills: the title, each moment's impact (or landing), the end.
export function stillTimes(edit, frames, facts) {
  const moments = edit.moments.map((m, mi) => {
    const own = frames
      .map((f, i) => ({ ...f, i }))
      .filter((f) => f.moment === mi);
    // a drill: the kubbs as they stand once raised, the point of it
    const settled = own.filter((f) => f.cam === "settled");
    if (settled.length)
      return (
        Math.round((settled[Math.floor(settled.length / 2)].i / FPS) * 1000) /
        1000
      );
    const hit = facts.get(m.i)?.firstHit?.t;
    // a quarter second of throw after the first hit, in the last pass that shows it
    const pass = own.some((f) => f.replay) ? own.filter((f) => f.replay) : own;
    const pick =
      (hit != null && pass.find((f) => f.dt > 0 && f.t >= hit + 0.25)) ||
      own[Math.floor(own.length * 0.6)];
    return Math.round((pick.i / FPS) * 1000) / 1000;
  });
  const title = Math.round(edit.title * 0.8 * 1000) / 1000;
  const end =
    Math.round(((frames.length - FPS * edit.endCard * 0.2) / FPS) * 1000) /
    1000;
  return { title, moments, end };
}

// The teams as a reel draws them (the engine's docs/NAMES.md section 6): a generated
// team name, or a side of one's player name, or a default; anything else is shown as
// "Team A" / "Team B". The kept replay's names were checked when the match started.
export function shownTeams(teams) {
  const side = (k) => {
    const t = teams?.[k];
    return NAMES.passes("team", t) || NAMES.passes("player", t)
      ? t
      : `Team ${k}`;
  };
  return { A: side("A"), B: side("B") };
}
