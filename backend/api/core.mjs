// The api function: what the pitch server pushes (each start, each action, the kept
// replay at the end) and the plain HTTPS calls that are not live play (report, game,
// replay, reel, share). The contract is backend/api/API.md; the design is
// docs/PITCH-SERVER.md. It knows no Kubb: the renderer checks shared matches, the
// clients check hashes.
//
// Everything runs over injected adapters, so the same code is the Lambda (handler.mjs:
// DynamoDB, S3, Lambda, Secrets Manager) and the tests (memory-store.mjs):
//
//   store       getState(code) -> state | null          the pitch's latest match
//               putState(code, state, prevRev) -> bool   false when the stored rev is not
//                                                        prevRev (0: none, or expired)
//               putFinal(code, { made, n, snap, exp }) -> bool    the final snapshot
//                           of match (made, n), one half of its replay; false when the
//                           replay holds this match or a later one, or this half is in
//               putKept(code, { made, n, v, data, hash, cpu, level, exp }) -> bool   the kept
//                           replay of match (made, n), `v` the time it ended, the other
//                           half; false the same way. Whichever half
//                           comes second makes the replay whole; until then the last
//                           match's replay is still the one served
//               getReplay(code) -> { v, made, n, data, sealed, exp } | null   only a
//                           replay with both halves (kept and its final snapshot)
//               getReel, putReel, dropReel, countReel        highlight reels, as before
//               getShare, keepShare, countShare              shared matches
//   recordPush({ key, raw }) -> "kept" | "had"   the signed push as it came, gzipped, to
//                           the games bucket under `key`, only when nothing is there
//   keepReport({ t, report }), recordGame({ t, game })   as the rooms function kept them
//   startReel({ room, v, tag })                 asks the renderer (asynchronous invoke)
//   checkShare(g) -> { ok, why?, document, replay }      the renderer's check (waited for);
//                           throws a ShareBusy when it could not be had in time
//   secret() -> string | null, secret({ fresh: true })   the push secret (cached)
//
// handle({ method, path, query, headers, body }) -> { status, headers, body }
// `body` is the raw request body as a Buffer; headers are lower case.

import {
  ApiError,
  LIMITS,
  PITCH_CODE,
  asciiJson,
  checkGame,
  checkReport,
  checkShare as checkShareMessage,
  isObject,
  newPitchCode,
  originAllowed,
  shareHash,
} from "./checks.mjs";
import {
  keptReplay,
  matchInfo,
  mergeState,
  pushKey,
  readPush,
  signatureValid,
  statePush,
} from "./push.mjs";
import { REEL_TRIES, majorMinor, reelJob, reelTag } from "../reels/tag.mjs";

// The renderer could not take a share's check in time: answered `why: "busy"`.
export class ShareBusy extends Error {
  name = "ShareBusy";
}

const ROUTES = {
  "/push": "POST",
  "/report": "POST",
  "/game": "POST",
  "/replay": "GET",
  "/reel": "POST",
  "/share": "POST",
};

export function createApi({
  store,
  recordPush = null,
  keepReport = null,
  recordGame = null,
  startReel = null,
  checkShare = null,
  reelEngines = [],
  secret = async () => null,
  origins = [],
  limits = LIMITS,
  now = Date.now,
  random = Math.random,
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  const expiry = (s) => Math.floor(now() / 1000) + s;

  // ---------- pushes ----------

  async function push(req) {
    const raw = req.body;
    if (raw.length > limits.pushBytes)
      throw new ApiError("too-big", "That push is too big.");
    const header = req.headers["x-pitch-signature"];
    let key = await secret();
    if (!key) throw new ApiError("unavailable", "Pushes are not taken here.");
    if (!signatureValid(raw, header, key)) {
      // the secret may have been changed since it was read: once more, read afresh
      const again = await secret({ fresh: true });
      if (!again || again === key || !signatureValid(raw, header, again))
        throw new ApiError("bad-signature", "That push is not signed.");
      key = again;
    }
    const p = readPush(
      raw.toString("utf8"),
      req.headers["idempotency-key"],
      limits,
    );
    let recorded = null;
    if (p.topic !== "keep") {
      if (!recordPush)
        throw new ApiError("unavailable", "Pushes are not recorded here.");
      recorded = await recordPush({ key: pushKey(p), raw });
      await foldState(p);
      if (p.topic === "act" && p.body.over === true)
        await store.putFinal(p.pitch, {
          made: p.made,
          n: p.body.n,
          snap: p.body.snap,
          exp: expiry(limits.keepTtl),
        });
    } else {
      const kept = keptReplay(p.body, limits);
      if (kept.why) {
        // never keepable: taken, so the pitch stops sending it
        log({ push: p.k, pitch: p.pitch, kept: false, why: kept.why });
        return json(200, { ok: true, kept: false, why: kept.why });
      }
      recorded = (await store.putKept(p.pitch, {
        made: p.made,
        n: p.body.n,
        v: p.body.at,
        data: kept.text,
        hash: kept.hash,
        cpu: kept.info.cpu,
        level: kept.info.level,
        exp: expiry(limits.keepTtl),
      }))
        ? "kept"
        : "had";
    }
    log({ push: p.k, pitch: p.pitch, made: p.made, recorded });
    return json(200, {
      ok: true,
      ...(recorded === "had" ? { duplicate: true } : {}),
    });
  }

  // The pitch's state with this push folded in, written only when it changes; a
  // concurrent write is read again and folded again.
  async function foldState(p) {
    const change = statePush(p);
    for (let tries = 0; tries < 6; tries++) {
      const old = await store.getState(p.pitch);
      const next = mergeState(old, change);
      if (!next) return false;
      const rev = (old?.rev ?? 0) + 1;
      const exp = expiry(next.over ? limits.keepTtl : limits.pitchTtl);
      if (await store.putState(p.pitch, { ...next, rev, exp }, old?.rev ?? 0))
        return true;
    }
    throw new ApiError("failed", "The pitch's state could not be written.");
  }

  // ---------- reports and one-device matches ----------

  async function report(req, msg) {
    const r = checkReport(msg, req.body.length, limits);
    if (!keepReport)
      throw new ApiError("unavailable", "Reports are not kept here.");
    try {
      await keepReport({ t: now(), report: asciiJson(r) });
    } catch (error) {
      log({ error: "report", name: error?.name, message: error?.message });
      throw new ApiError("failed", "The report could not be kept.");
    }
    return json(200, { ok: true });
  }

  async function game(req, msg) {
    const g = checkGame(msg, req.body.length, limits);
    if (!recordGame)
      throw new ApiError("unavailable", "Matches are not kept here.");
    try {
      await recordGame({ t: now(), game: asciiJson(g) });
    } catch (error) {
      log({ error: "game", name: error?.name, message: error?.message });
      throw new ApiError("failed", "The match could not be kept.");
    }
    return json(200, { ok: true });
  }

  // ---------- kept replays ----------

  const codeOf = (x) => {
    if (typeof x !== "string" || !PITCH_CODE.test(x))
      throw new ApiError("bad-pitch", "That is not a pitch code.");
    return x;
  };

  async function replay(req) {
    const code = codeOf(req.query.get("pitch"));
    let item = null;
    try {
      item = await store.getReplay(code);
    } catch (error) {
      log({ error: "replay", name: error?.name, message: error?.message });
    }
    const head = asciiJson({
      pitch: code,
      v: item?.v ?? 0,
      at: item?.v ?? null,
      sealed: !!item?.sealed,
    });
    return raw(
      200,
      `${head.slice(0, -1)},"replay":${item ? item.data : "null"}}`,
    );
  }

  // ---------- highlight reels (docs/ROOMS.md section 12, on pitch# records) ----------

  const reelView = (item, staleBefore) =>
    item.state === "rendering" &&
    item.at < staleBefore &&
    (item.tries ?? 0) >= REEL_TRIES
      ? { state: "failed", tag: item.tag, at: item.at }
      : item.state === "done"
        ? {
            state: "done",
            tag: item.tag,
            at: item.at,
            tall: item.tall,
            wide: item.wide,
            edit: item.edit,
            seconds: item.seconds ?? null,
          }
        : item.state === "failed" && item.why
          ? { state: "failed", tag: item.tag, at: item.at, why: item.why }
          : { state: item.state, tag: item.tag, at: item.at };

  async function reel(req, msg) {
    const code = codeOf(msg?.pitch);
    const meant = msg.v;
    if (meant !== undefined && (!Number.isSafeInteger(meant) || meant < 1))
      throw new ApiError("bad-message", "`v` must be a kept replay version.");
    const answer = (fields) => json(200, { pitch: code, ...fields });
    if (!startReel) return answer({ v: 0, reel: null, why: "unavailable" });
    let kept, item;
    try {
      kept = await store.getReplay(code);
      item = kept ? await store.getReel(code) : null;
    } catch (error) {
      log({ error: "reel read", name: error?.name, message: error?.message });
      throw new ApiError("failed", "The reel could not be read.");
    }
    if (!kept) return answer({ v: 0, reel: null, why: "replay" });
    if (meant !== undefined && meant !== kept.v)
      return answer({ v: kept.v, reel: null, why: "moved" });
    let engine = null;
    try {
      const tagged = JSON.parse(kept.data)?.engine;
      engine = typeof tagged === "string" ? majorMinor(tagged) : null;
    } catch {
      engine = null;
    }
    if (!engine) return answer({ v: kept.v, reel: null, why: "engine" });
    const tag = reelTag(engine);
    const job = reelJob(kept.v, tag);
    const t = now();
    const staleBefore = t - limits.reelStaleMs;
    if (item && item.job === job && item.state === "done")
      return answer({ v: kept.v, reel: reelView(item, staleBefore) });
    if (!reelEngines.includes(engine))
      return answer({ v: kept.v, reel: null, why: "engine" });
    const stale = (x) =>
      x.state === "rendering" &&
      x.at < staleBefore &&
      (x.tries ?? 0) < REEL_TRIES;
    if (item && item.job === job && !stale(item))
      return answer({ v: kept.v, reel: reelView(item, staleBefore) });

    // This request would start a render: only the one that writes the reel item is
    // counted against the day. A stale takeover keeps its tries.
    const takeover = item && item.job === job ? item : null;
    const undo = takeover ? { at: takeover.at } : {};
    let won = false;
    let counted = false;
    try {
      won = await store.putReel(
        code,
        {
          v: kept.v,
          tag,
          job,
          at: t,
          exp: kept.exp,
          tries: takeover?.tries ?? 0,
        },
        { staleBefore },
      );
      if (!won) item = await store.getReel(code);
      else {
        const day = new Date(t).toISOString().slice(0, 10);
        counted = await store.countReel(
          day,
          limits.reelsPerDay,
          expiry(limits.reelCountTtl),
        );
        if (!counted) await store.dropReel(code, job, undo);
      }
    } catch (error) {
      log({ error: "reel write", name: error?.name, message: error?.message });
      if (won && !counted)
        await store.dropReel(code, job, undo).catch(() => {});
      throw new ApiError("failed", "The reel could not be asked for.");
    }
    if (won && !counted) return answer({ v: kept.v, reel: null, why: "busy" });
    if (!won)
      return answer({
        v: kept.v,
        reel: item && item.job === job ? reelView(item, staleBefore) : null,
        ...(item && item.job === job ? {} : { why: "busy" }),
      });
    try {
      await startReel({ room: code, v: kept.v, tag });
    } catch (error) {
      log({ error: "reel start", name: error?.name, message: error?.message });
      await store.dropReel(code, job, undo).catch(() => {});
      throw new ApiError("failed", "The reel could not be started.");
    }
    return answer({ v: kept.v, reel: { state: "rendering", tag, at: t } });
  }

  // ---------- sharing a match against the computer ----------

  // A shared match's pitch is all there: its sealed state and its replay.
  async function complete(code) {
    const [state, kept] = await Promise.all([
      store.getState(code),
      store.getReplay(code),
    ]);
    return !!state?.sealed && !!kept;
  }

  async function share(req, msg) {
    const answer = (code, why) =>
      json(200, { code, v: code ? 1 : 0, ...(why ? { why } : {}) });
    const checked = checkShareMessage(msg, req.body.length, limits);
    if (checked.why) return answer(null, checked.why);
    const { g } = checked;
    if (!checkShare || !reelEngines.length) return answer(null, "unavailable");
    const engine = majorMinor(g.engine);
    if (!engine || !reelEngines.includes(engine)) return answer(null, "engine");

    const hash = shareHash(g);
    let stale = null;
    try {
      const had = await store.getShare(hash);
      if (had && (await complete(had.code))) return answer(had.code);
      stale = had?.code ?? null;
    } catch (error) {
      log({ error: "share read", name: error?.name, message: error?.message });
      throw new ApiError("failed", "The share could not be read.");
    }
    const t = now();
    const day = new Date(t).toISOString().slice(0, 10);
    let counted;
    try {
      counted = await store.countShare(
        day,
        limits.sharesPerDay,
        expiry(limits.reelCountTtl),
      );
    } catch (error) {
      log({ error: "share count", name: error?.name, message: error?.message });
      throw new ApiError("failed", "The share could not be counted.");
    }
    if (!counted) return answer(null, "busy");

    let out;
    try {
      out = await checkShare(g);
    } catch (error) {
      if (error instanceof ShareBusy || error?.name === "ShareBusy")
        return answer(null, "busy");
      log({ error: "share check", name: error?.name, message: error?.message });
      throw new ApiError("failed", "The match could not be checked.");
    }
    if (!out?.ok) {
      const why = ["engine", "name", "does-not-replay", "too-long"].includes(
        out?.why,
      )
        ? out.why
        : "does-not-replay";
      return answer(null, why);
    }

    // Kept: the sealed state, its replay and the key, all three or none, a year on.
    let r;
    try {
      r = JSON.parse(out.replay);
    } catch {
      r = null;
    }
    if (!isObject(r) || typeof r.snap !== "string")
      throw new ApiError("failed", "The checked match has no replay.");
    const until = expiry(limits.keepTtl);
    const info = matchInfo(r);
    const n = Number.isSafeInteger(r.n) ? r.n : 1;
    const code = newPitchCode(random);
    let kept;
    try {
      kept = await store.keepShare(
        hash,
        code,
        {
          state: {
            made: t,
            n,
            seq: Array.isArray(r.log) ? r.log.length : 0,
            over: true,
            snap: r.snap,
            hash: r.hash ?? null,
            ...info,
            sealed: true,
            rev: 1,
            exp: until,
          },
          replay: {
            made: t,
            n,
            v: t,
            data: out.replay,
            snap: r.snap,
            hash: r.hash ?? null,
            cpu: info.cpu,
            level: info.level,
            exp: until,
          },
        },
        { stale },
      );
    } catch (error) {
      log({ error: "share write", name: error?.name, message: error?.message });
      throw new ApiError("failed", "The share could not be kept.");
    }
    if (!kept) {
      let won = null;
      try {
        won = await store.getShare(hash);
        if (won && !(await complete(won.code))) won = null;
      } catch {
        won = null;
      }
      if (!won) throw new ApiError("failed", "The share could not be kept.");
      return answer(won.code);
    }
    return answer(code);
  }

  // ---------- HTTP ----------

  function cors(req) {
    const origin = req.headers.origin;
    if (!origin) return {}; // the iPhone app and the pitch server send none
    if (!originAllowed(origin, origins))
      throw new ApiError("forbidden", "That origin may not call this.");
    return { "access-control-allow-origin": origin, vary: "origin" };
  }

  async function handle(req) {
    let extra = {};
    try {
      const path = String(req.path || "/")
        .replace(/^\/api(?=\/)/, "")
        .replace(/\/$/, "");
      const want = ROUTES[path];
      if (!want) throw new ApiError("not-found", "There is nothing here.");
      if (path !== "/push") extra = cors(req);
      if (req.method === "OPTIONS" && path !== "/push")
        return {
          status: 204,
          headers: {
            ...extra,
            "access-control-allow-methods": `${want}, OPTIONS`,
            "access-control-allow-headers": "content-type",
            "access-control-max-age": "86400",
          },
          body: "",
        };
      if (req.method !== want)
        throw new ApiError("method", `Use ${want} here.`);
      if (path === "/push") return await push(req);
      if (path === "/replay") return withHeaders(await replay(req), extra);
      if (req.body.length > limits.bodyBytes)
        throw new ApiError("too-big", "That request is too big.");
      let msg;
      try {
        msg = JSON.parse(req.body.toString("utf8"));
      } catch {
        throw new ApiError("bad-message", "Send JSON.");
      }
      if (!isObject(msg)) throw new ApiError("bad-message", "Send an object.");
      const route = {
        "/report": report,
        "/game": game,
        "/reel": reel,
        "/share": share,
      };
      return withHeaders(await route[path](req, msg), extra);
    } catch (error) {
      if (error instanceof ApiError)
        return withHeaders(
          json(error.status, { error: error.code, message: error.message }),
          error.code === "forbidden" ? {} : extra,
        );
      log({ error: "unhandled", name: error?.name, message: error?.message });
      return withHeaders(
        json(500, { error: "failed", message: "Something went wrong." }),
        extra,
      );
    }
  }

  return { handle };
}

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};
const raw = (status, body) => ({ status, headers: { ...HEADERS }, body });
const json = (status, value) => raw(status, asciiJson(value));
const withHeaders = (res, extra) => ({
  ...res,
  headers: { ...res.headers, ...extra },
});
