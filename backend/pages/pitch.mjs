// What a pitch's link shows before it is opened: its share preview (Jamie,
// 2026-11-16: "can we get the share preview image to reflect the game that it is
// linked to?") and the state an embed starts from. Pure: the pitch's records in,
// words, pieces and HTML out. backend/pages/server.mjs reads the pitch and serves it.
//
// The records are the api function's (backend/api/dynamo-store.mjs): the pitch's
// state (its latest match as far as the pitch server's pushes go) and its kept
// replay. Only what the pitch link itself shows: the team names (each checked: one the
// game did not make is left off, the side shown as "Team A" / "Team B"), the turn,
// the result and where the pieces lie. Never a member id, never anything from the
// games bucket, and nothing that lists a pitch anywhere.
//
// Nothing here imports src/site/site.mjs (it reads a file at load, which the
// package does not carry); tests/pages checks these two against it.
import { gunzipSync } from "node:zlib";
import { NAMES } from "../pitch-server/names.mjs";

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

// A side's name as the link shows it: a generated team name, or (a side of one) its
// player's, or one of the engine's defaults; anything else is left off for the side's
// default (the engine's docs/NAMES.md section 6: the pitch card image).
const teamName = (s, players, fallback) =>
  NAMES.teamPasses(s, players) ? s : fallback;

// The kept replay is this match's own: the same pitch object (`made`) and match number.
// A rematch that is still in play, or one that ended before its replay was kept,
// leaves the last match's replay in place, which is not this one.
export const sameMatch = (kept, state) =>
  !!kept && !!state && kept.made === state.made && kept.n === state.n;

// The pitch's state from its two records:
//
//   state  { v, made, n, seq, over, snap, hash, names?, cpu?, level? } | null
//          the latest match (v: the record's revision, which changes with every push)
//   kept   { v, made, n, snap, hash, cpu?, level? } | null
//          the kept replay of the last finished match (v: when it ended), only when
//          both its halves are in (the replay and its final snapshot)
//
//   { state: "none" }
//   { state: "playing", v, teams: { A, B }, turn, pieces }
//   { state: "over", v, teams, turn, winner: "A" | "B" | null, how, replay, pieces,
//     match: { n, hash }, reel: { wide } | null, computer: { side, level } | null }
//
//   { state: "waiting", v, host }   a pitch made and not played since (its `open`
//     record, which the pitch server pushes when the pitch is made: PROTOCOL.md
//     "Pushes"); host its maker's name, or null when that is not a generated name
//
// A pitch with no record at all (made before the pitch server pushed `open`, or wiped)
// is "none" and the page keeps the site's own preview.
//
// computer: the side the computer played and its level, for a match of a person against
// it (a shared match, docs/ROOMS.md section 13, or a pitch where one side was the
// computer); null otherwise.
//
// reel: the kept replay's finished highlight reel ({ wide: site path }), or null;
// shown only beside a replay (docs/REEL.md, docs/ROOMS.md section 12).
export function pitchState({
  state = null,
  kept = null,
  reel = null,
  open = null,
} = {}) {
  // a pitch made after its last match (or with none): waiting, and who made it
  const waiting = openOf(open, state, kept);
  if (waiting) return waiting;
  const shown = state ? fromSnap(state.snap, state.names) : null;
  if (shown) {
    const v = finite(state.v) ? state.v : 0;
    if (state.over === true || shown.over)
      return {
        ...shown,
        state: "over",
        v,
        ...withReel(sameMatch(kept, state), reel),
        match: { n: state.n ?? null, hash: state.hash ?? null },
        computer: computerOf(state),
      };
    return { ...shown, state: "playing", v };
  }
  const last = kept ? fromSnap(kept.snap, kept.names) : null;
  if (last)
    return {
      ...last,
      state: "over",
      v: finite(kept.v) ? kept.v : 0,
      ...withReel(true, reel),
      match: { n: kept.n ?? null, hash: kept.hash ?? null },
      computer: computerOf(kept),
    };
  return { state: "none" };
}

// A pitch made (its `open` record: { made, host }) and not yet played since: { state:
// "waiting", v, host }, the host's name only when it is a generated player name.
function openOf(open, state, kept) {
  if (!open || !finite(open.made)) return null;
  const later = (m) => !m || !finite(m.made) || open.made > m.made;
  if (!later(state) || !later(kept)) return null;
  const host =
    typeof open.host === "string" && NAMES.passes("player", open.host)
      ? open.host
      : null;
  return { state: "waiting", v: open.made, host };
}

const LEVELS = ["beginner", "club", "pro"];

// The side the computer played, alone, and its level: `cpu` "A" or "B", `level`.
function computerOf(m) {
  const side = m?.cpu;
  if (side !== "A" && side !== "B") return null;
  return { side, level: LEVELS.includes(m.level) ? m.level : null };
}

const withReel = (replay, reel) => ({
  replay,
  reel:
    replay && reel && typeof reel.wide === "string"
      ? { wide: reel.wide }
      : null,
});

// A reel's wide file, as the reel function writes it (backend/reels/tag.mjs reelPaths):
// `v` is the kept replay's, the epoch ms its match ended.
const REEL_WIDE =
  /^\/reels\/([2-9a-hjkmnp-z]{8,24})\/[0-9]{1,13}-r[0-9]{1,4}-[0-9]{1,4}\.[0-9]{1,4}\/wide\.mp4$/;

// The kept replay's highlight reel, when it is done and is this replay's (the same
// version): { wide } or null. Anything that fails is no reel.
async function readReel(item, code, keptV) {
  try {
    const r = await item(`pitch#${code}`, "reel", [
      "v",
      "state",
      "wide",
      "exp",
    ]);
    if (!r || r.state !== "done" || r.v !== keptV) return null;
    const m = REEL_WIDE.exec(r.wide ?? "");
    return m && m[1] === code ? { wide: r.wide } : null;
  } catch {
    return null;
  }
}

const unzip = (z) => gunzipSync(Buffer.from(z)).toString();

// What pitchState needs of one pitch, through item(pk, sk, fields), a GetItem that
// answers null for an item missing or expired (backend/pages/main.mjs): the state,
// and beside a finished match (or with no state) the kept replay's small fields, and
// beside this match's own replay its reel. A match in play costs one read.
export async function readPitch(item, code) {
  const pk = `pitch#${code}`;
  const st = await item(pk, "state", [
    "rev",
    "made",
    "n",
    "seq",
    "over",
    "z",
    "hash",
    "names",
    "cpu",
    "level",
    "exp",
  ]);
  const state = st
    ? {
        v: st.rev,
        made: st.made,
        n: st.n,
        seq: st.seq,
        over: st.over === true,
        snap: unzip(st.z),
        hash: st.hash ?? null,
        names: st.names ?? null,
        cpu: st.cpu ?? null,
        level: st.level ?? null,
      }
    : null;
  if (state && pitchState({ state }).state === "playing") return { state };
  // a pitch with no match yet: its `open` record says who made it (one read more,
  // only then: a match in play or finished costs what it did)
  let open = null;
  if (!state) {
    const op = await item(pk, "open", ["made", "host", "exp"]);
    open = op ? { made: op.made, host: op.host ?? null } : null;
    if (pitchState({ open }).state === "waiting") return { state, open };
  }
  const kp = await item(pk, "replay", [
    "v",
    "made",
    "n",
    "s",
    "hash",
    "cpu",
    "level",
    "exp",
  ]);
  const kept =
    kp && kp.v && kp.s
      ? {
          v: kp.v,
          made: kp.made,
          n: kp.n,
          snap: unzip(kp.s),
          hash: kp.hash ?? null,
          cpu: kp.cpu ?? null,
          level: kp.level ?? null,
        }
      : null;
  const own = pitchState({ state, kept }).replay;
  return {
    state,
    kept,
    open,
    reel: own ? await readReel(item, code, kept.v) : null,
  };
}

// What a snapshot shows; `names` ({ A, B } from the match's start info) only where
// the snapshot has none.
function fromSnap(snapText, names) {
  const s = parse(snapText);
  const g = s?.save?.game;
  if (!g || typeof g !== "object") return null;
  const side = (k) => {
    const t = g.teams?.[k];
    const n = Array.isArray(t?.players) ? t.players.length : 1;
    return teamName(name(t?.name ?? names?.[k], ""), n, `Team ${k}`);
  };
  const teams = { A: side("A"), B: side("B") };
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
    return s.host
      ? {
          title: `${s.host} is waiting for players · ${SITE_NAME}`,
          description: "Waiting for players. Join the pitch.",
          line: "Is waiting for players",
          host: s.host,
          teams: null,
          alt: `${s.host} is waiting for players: a Kubb pitch from above, set out`,
        }
      : {
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
      line: `In play · turn ${s.turn} · tap to watch`,
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
    line: `${won ? `${won} won` : "Over"} · ${turns(s.turn)}${s.replay ? " · tap to watch" : ""}`,
    teams: s.teams,
    alt: `${vs}, final: ${result} The pitch from above as the match ended`,
  };
}

// A match against the computer says so, and at what level (docs/REEL.md "Links and share
// tags"): "Mighty Maple won, against the computer (club), in 9 turns." or "Computer (club)
// won, against Mighty Maple, in 9 turns." Null for any other match.
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
    host: p.host ?? null,
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
// image at /og/<code>.png (v: the state's revision, so a changed pitch is a new
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
