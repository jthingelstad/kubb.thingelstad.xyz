// What a pitch's link shows before it is opened: its share preview (Jamie,
// 2026-11-16: "can we get the share preview image to reflect the game that it is
// linked to?") and the state an embed starts from. Pure: the room's document in,
// words, pieces and HTML out. backend/pages/server.mjs reads the room and serves it.
//
// Only what the pitch link itself shows: the team names as typed, the turn, the
// result and where the pieces lie. Never a member id (the lobby's teams are ids,
// so a pitch waiting for players has no names), never anything from the games
// bucket, and nothing that lists a pitch anywhere.
//
// Nothing here imports src/site/site.mjs (it reads a file at load, which the
// package does not carry); tests/pages checks these two against it.
import { gunzipSync } from "node:zlib";

export const ORIGIN = "https://throwingwood.com";
export const SITE_NAME = "Kubb: Throwing Wood";

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const CODE = /^[2-9a-hjkmnp-z]{8,24}$/;

const parse = (text) => {
  try {
    return typeof text === "string" ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const name = (s, fallback) =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, 40) : fallback;

// A finished match keeps its replay; the same test as src/net/lobby.js replayOf.
const hasReplay = (m) =>
  m.over === true &&
  typeof m.snap === "string" &&
  Array.isArray(m.log) &&
  m.log.length > 0 &&
  m.log.length === m.seq;

// The kept replay is this finished match's own: the same match number and final
// snapshot (src/net/pitch.js lookForKept). A rematch that could not be kept leaves
// the last match's replay in place, which is not this one.
export const sameMatch = (r, m) =>
  !!r &&
  !!m &&
  typeof r === "object" &&
  r.n === m.n &&
  r.hash === m.hash &&
  r.snap === m.snap;

// The pitch's state from its stored document ({ v, doc: JSON text } or null) and,
// when the document is gone, its kept replay's JSON text. kept: beside a finished
// document, the room's kept replay (JSON text, or null for none); without it the
// document's own match is judged (it may be one too long to keep).
//
//   { state: "none" }
//   { state: "waiting", v }
//   { state: "playing", v, teams: { A, B }, turn, pieces }
//   { state: "over", v, teams, turn, winner: "A" | "B" | null, how, replay, pieces,
//     match: { n, hash }, reel: { wide } | null, computer: { side, level } | null }
//
// computer: the side the computer played and its level, for a match of a person against
// it (a shared match against the computer, docs/ROOMS.md section 13, or a pitch where
// one side was the computer); null otherwise.
//
// reel: the kept replay's finished highlight reel ({ wide: site path }), or null;
// shown only beside a replay (docs/REEL.md, docs/ROOMS.md section 12).
export function pitchState({
  doc = null,
  replay = null,
  kept,
  reel = null,
} = {}) {
  const d = doc ? parse(doc.doc) : null;
  const v = finite(doc?.v) ? doc.v : 0;
  if (d && typeof d === "object") {
    const m = d.match && typeof d.match === "object" ? d.match : null;
    if (!d.started || !m) return { state: "waiting", v };
    const shown = fromSnap(m.snap, m.setup);
    if (!shown) return { state: "waiting", v };
    if (m.over === true || shown.over)
      return {
        ...shown,
        state: "over",
        v,
        ...withReel(
          kept === undefined
            ? hasReplay(m)
            : typeof kept === "string" && sameMatch(parse(kept), m),
          reel,
        ),
        match: { n: m.n ?? null, hash: m.hash ?? null },
        computer: computerOf(m),
      };
    return { ...shown, state: "playing", v };
  }
  const r = parse(replay);
  if (r && typeof r === "object") {
    const shown = fromSnap(r.snap, r.setup);
    if (shown)
      return {
        ...shown,
        state: "over",
        v: 0,
        ...withReel(true, reel),
        match: { n: r.n ?? null, hash: r.hash ?? null },
        computer: computerOf(r),
      };
  }
  return { state: "none" };
}

const LEVELS = ["beginner", "club", "pro"];

// The side the computer played, alone, and its level, from a match (or a kept replay):
// `cpu` "A" or "B", the level from the setup's players.
function computerOf(m) {
  const side = m?.cpu;
  if (side !== "A" && side !== "B") return null;
  const level = m.setup?.teams?.[side]?.players?.[0]?.level;
  return { side, level: LEVELS.includes(level) ? level : null };
}

const withReel = (replay, reel) => ({
  replay,
  reel:
    replay && reel && typeof reel.wide === "string"
      ? { wide: reel.wide }
      : null,
});

// A reel's wide file, as the reel function writes it (backend/reels/tag.mjs reelPaths).
const REEL_WIDE =
  /^\/reels\/([2-9a-hjkmnp-z]{8,24})\/[0-9]{1,9}-r[0-9]{1,4}-[0-9]{1,4}\.[0-9]{1,4}\/wide\.mp4$/;

// The kept replay's highlight reel, when it is done and is this replay's (the same
// document version): { wide } or null. Anything that fails is no reel.
async function readReel(item, code, keptV) {
  try {
    const r = await item(`room#${code}`, "reel", ["v", "state", "wide", "exp"]);
    if (!r || r.state !== "done" || r.v !== keptV) return null;
    const m = REEL_WIDE.exec(r.wide ?? "");
    return m && m[1] === code ? { wide: r.wide } : null;
  } catch {
    return null;
  }
}

// What pitchState needs of one room, through item(pk, sk, fields), a GetItem
// that answers null for an item missing or expired (backend/pages/main.mjs).
// The kept replay is read beside a finished match, however it is finished: a
// match from before replays has no "over" of its own, only its snapshot's phase.
export async function readRoom(item, code) {
  const pk = `room#${code}`;
  const unzip = (z) => gunzipSync(Buffer.from(z)).toString();
  const doc = await item(pk, "doc", ["v", "doc", "exp"]);
  if (doc) {
    const stored = { v: doc.v, doc: doc.doc };
    if (pitchState({ doc: stored }).state !== "over") return { doc: stored };
    const kept = await item(pk, "replay", ["v", "z", "exp"]);
    if (!kept) return { doc: stored, kept: null };
    const text = unzip(kept.z);
    // the reel only beside this match's own replay (one more GetItem)
    const own = pitchState({ doc: stored, kept: text }).replay;
    return {
      doc: stored,
      kept: text,
      reel: own ? await readReel(item, code, kept.v) : null,
    };
  }
  const kept = await item(pk, "replay", ["v", "z", "exp"]);
  if (!kept) return { doc: null, replay: null };
  return {
    doc: null,
    replay: unzip(kept.z),
    reel: await readReel(item, code, kept.v),
  };
}

function fromSnap(snapText, setup) {
  const s = parse(snapText);
  const g = s?.save?.game;
  if (!g || typeof g !== "object") return null;
  const teams = {
    A: name(g.teams?.A?.name ?? setup?.teams?.A?.name, "Team A"),
    B: name(g.teams?.B?.name ?? setup?.teams?.B?.name, "Team B"),
  };
  return {
    teams,
    turn: Number.isInteger(g.turn) ? g.turn : 1,
    over: g.phase === "over",
    winner: g.winner === "A" || g.winner === "B" ? g.winner : null,
    how: typeof g.how === "string" ? g.how : null,
    pieces: piecesOf(s),
  };
}

// The pieces on the ground, in world metres (y = 0 Team A's baseline, y = 8 Team
// B's; x across): { kind: "kubb" | "king" | "baton", x, y, standing, ax, ay },
// (ax, ay) a fallen piece's long axis. Kubbs knocked down this turn lie where they
// fell; a finished match shows its final position, the king down when the match
// ended on him.
export function piecesOf(snap) {
  const g = snap?.save?.game;
  if (!g) return [];
  const debris = snap.save.debris || {};
  const list = Array.isArray(debris.list) ? debris.list : [];
  const exact =
    debris.exact && !Array.isArray(debris.exact) ? debris.exact : {};
  const lying = new Map(list.map((p) => [p?.id, p]));
  const fallen = new Set(["batons", "over"]);
  const axis = (q) => ({
    ax: 2 * (q.qx * q.qz + q.qw * q.qy),
    ay: 2 * (q.qy * q.qz - q.qw * q.qx),
  });
  const quat = (q) => ["qw", "qx", "qy", "qz"].every((k) => finite(q?.[k]));
  const out = [];
  const at = (kind, id, pose, standing) => {
    const d = lying.get(id) || exact[id];
    if (!standing && d && finite(d.x) && finite(d.y))
      return out.push({
        kind,
        x: d.x,
        y: d.y,
        standing: false,
        ...(quat(d) ? axis(d) : { ax: 0, ay: 1 }),
      });
    const e = exact[id];
    const p = e && finite(e.x) && finite(e.y) ? e : pose;
    if (!p || !finite(p.x) || !finite(p.y)) return;
    const a = finite(pose?.angle) ? pose.angle : 0;
    out.push({
      kind,
      x: p.x,
      y: p.y,
      standing,
      ax: Math.sin(a),
      ay: Math.cos(a),
    });
  };
  for (const k of Object.values(g.kubbs || {})) {
    if (!k || typeof k !== "object") continue;
    if (k.where === "pitch")
      at("kubb", k.id, k.pose, k.pose?.standing !== false);
    else if (k.where === "hand" && fallen.has(g.phase))
      at("kubb", k.id, k.pose, false);
  }
  const kingDown =
    g.phase === "over" && typeof g.how === "string" && /^king/.test(g.how);
  if (g.king?.pose)
    at(
      "king",
      "king",
      g.king.pose,
      !kingDown && g.king.pose.standing !== false,
    );
  for (const p of list)
    if (p?.kind === "baton" && finite(p.x) && finite(p.y))
      out.push({
        kind: "baton",
        x: p.x,
        y: p.y,
        standing: false,
        ...(quat(p) ? axis(p) : { ax: 0, ay: 1 }),
      });
  return out;
}

// The pieces as a pitch waiting for players sets them out: five kubbs on each
// baseline, the king in the middle.
export function setOut() {
  const out = [{ kind: "king", x: 0, y: 4, standing: true, ax: 0, ay: 1 }];
  for (const y of [0, 8])
    for (const x of [-2, -1, 0, 1, 2])
      out.push({ kind: "kubb", x, y, standing: true, ax: 0, ay: 1 });
  return out;
}

const turns = (n) => `${n} ${n === 1 ? "turn" : "turns"}`;

// The preview's words. Null for a pitch with nothing to say (no room): the page
// keeps the site's own.
export function previewOf(s) {
  if (!s || s.state === "none") return null;
  if (s.state === "waiting")
    return {
      title: `A pitch waiting for players · ${SITE_NAME}`,
      description: "Waiting for players. Join the pitch.",
      line: "Waiting for players",
      teams: null,
      alt: "A Kubb pitch from above, set out and waiting for players",
    };
  const vs = `${s.teams.A} vs ${s.teams.B}`;
  if (s.state === "playing")
    return {
      title: `${vs} · ${SITE_NAME}`,
      description: `In play: turn ${s.turn}`,
      line: `In play · turn ${s.turn}`,
      teams: s.teams,
      alt: `${vs}, in play at turn ${s.turn}: the pitch from above as it stands`,
    };
  const won = s.winner ? s.teams[s.winner] : null;
  const result = won
    ? againstComputer(s, won) || `${won} won, 1 to 0, in ${turns(s.turn)}.`
    : `Over after ${turns(s.turn)}.`;
  return {
    title: `${vs} · ${SITE_NAME}`,
    description: `Final: ${result}${s.replay ? " Watch the replay." : ""}${s.reel ? " Watch the highlights." : ""}`,
    line: won ? `${won} won · ${turns(s.turn)}` : `Over · ${turns(s.turn)}`,
    teams: s.teams,
    alt: `${vs}, final: ${result} The pitch from above as the match ended`,
  };
}

// A match against the computer says so, and at what level (docs/REEL.md "Links and share
// tags"): "Riverside won, against the computer (club), in 9 turns." or "Computer (club)
// won, against Riverside, in 9 turns." Null for any other match.
function againstComputer(s, won) {
  const c = s.computer;
  if (!c || !s.winner) return null;
  const level = c.level ? ` (${c.level})` : "";
  if (s.winner === c.side)
    return `${won}${level} won, against ${s.teams[c.side === "A" ? "B" : "A"]}, in ${turns(s.turn)}.`;
  return `${won} won, against the computer${level}, in ${turns(s.turn)}.`;
}

// The image's inputs (src/site/art.mjs pitchCardImage) for a state.
export function cardOf(s) {
  const p = previewOf(s);
  if (!p) return null;
  return {
    teams: p.teams,
    line: p.line,
    pieces: s.state === "waiting" ? setOut() : s.pieces,
  };
}

// The quiet line an embed shows when there is no replay to play.
export function finalLine(s) {
  if (s?.state !== "over") return null;
  const won = s.winner ? s.teams[s.winner] : null;
  const lost = s.winner ? s.teams[s.winner === "A" ? "B" : "A"] : null;
  return won ? `Final: ${won} 1, ${lost} 0` : `Final, after ${turns(s.turn)}`;
}

// JSON safe inside a <script type="application/json"> element: "<" written as its
// JSON escape so no value can close the element.
const LT = `${String.fromCharCode(92)}u003c`;
export const jsonBlock = (value) => JSON.stringify(value).replace(/</g, LT);

// The state an embed's client starts from (src/embed/embed.js): nothing
// but what the preview says.
export function embedState(s, code) {
  return {
    code,
    state: s?.state ?? "none",
    teams: s?.teams ?? null,
    turn: s?.turn ?? null,
    final: finalLine(s),
    // a finished match: which one, so an older kept replay is not played for it
    match: s?.state === "over" ? (s.match ?? null) : null,
  };
}

const metaRe = (attr, key) =>
  new RegExp(`<meta ${attr}="${key}" content="[^"]*">`);

// Every replacement is a function, so a "$&" in a team name stays literal.
// The page's head with this pitch's preview: title, description, og:*, and the
// image at /og/<code>.png (v: the document's version, so a changed pitch is a new
// image to a service that caches by URL). With `embed`, the state block too.
export function injectPreview(html, { code, s, path, embed = false }) {
  const p = previewOf(s);
  let out = html;
  if (p) {
    const image = `${ORIGIN}/og/${code}.png${s.v ? `?v=${s.v}` : ""}`;
    const set = (attr, key, value) => {
      out = out.replace(
        metaRe(attr, key),
        () => `<meta ${attr}="${key}" content="${esc(value)}">`,
      );
    };
    out = out.replace(
      /<title>[^<]*<\/title>/,
      () => `<title>${esc(p.title)}</title>`,
    );
    set("name", "description", p.description);
    set("property", "og:title", p.title);
    set("property", "og:description", p.description);
    set("property", "og:image", image);
    set("property", "og:image:alt", p.alt);
    set("name", "twitter:image", image);
    out = out.replace(
      /<meta property="og:image" /,
      (tag) => `<meta property="og:url" content="${ORIGIN}${path}">\n${tag}`,
    );
    // A finished reel: the wide MP4 for services that play a video in the card. The
    // image stays for those that do not. The embed is a player already: no video.
    if (!embed && s.reel?.wide) {
      const video = `${ORIGIN}${s.reel.wide}`;
      const tags = [
        ["og:video", video],
        ["og:video:secure_url", video],
        ["og:video:type", "video/mp4"],
        ["og:video:width", "1920"],
        ["og:video:height", "1080"],
      ]
        .map(([k, v]) => `<meta property="${k}" content="${esc(v)}">`)
        .join("\n");
      out = out.replace(
        metaRe("property", "og:image:alt"),
        (tag) => `${tag}\n${tags}`,
      );
    }
  }
  if (embed)
    out = out.replace(
      "</head>",
      () =>
        `<script type="application/json" id="kubb-pitch">${jsonBlock(embedState(s, code))}</script>\n</head>`,
    );
  return out;
}
