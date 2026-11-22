// The scanner's points are in the world frame for both teams: a Team B throw's
// landing, rest spot and first hit are where the piece they describe is at that
// moment, so the camera aims at the half the throw went to. The engine's wide view
// turns these for Team B (session/wide.lua since v0.7.2); the scan must not turn
// them again.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { openReplay, scanReplay } from "../../backend/reels/scan.mjs";
import { throwLine } from "../../backend/reels/cameras.mjs";
import { bundleLua } from "../../tools/lua-bundle.mjs";

const replay = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/replay-north-south.json", import.meta.url),
    "utf8",
  ),
);
const sources = bundleLua();
const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

test("scan: land, rest and first hit agree with the pieces' world positions, both teams", async () => {
  const { throws } = await scanReplay(replay, { sources });
  const facts = new Map(throws.map((f) => [f.i, f]));
  const { engine } = await openReplay(replay, { sources });
  const seen = {
    A: { land: 0, rest: 0, hit: 0, camera: 0 },
    B: { land: 0, rest: 0, hit: 0, camera: 0 },
  };
  for (let i = 0; i < replay.log.length; i++) {
    const r = engine.replayStep();
    const f = facts.get(i);
    if (!f || !r.recording) continue;
    const rec = r.recording;
    const pid = rec.projectile?.id;
    const label = `throw ${i} (${f.side} ${f.how})`;
    if (f.land?.x != null && f.landT != null) {
      const p = engine.showAt(f.landT).items.find((it) => it.id === pid);
      assert.ok(
        near(f.land, p) < 0.3,
        `${label}: land ${JSON.stringify(f.land)} vs ${JSON.stringify(p)}`,
      );
      seen[f.side].land++;
    }
    if (f.rest && f.kubb) {
      const k = engine
        .showAt(rec.duration)
        .items.find((it) => it.id === f.kubb);
      assert.ok(
        near(f.rest, k) < 0.1,
        `${label}: rest ${JSON.stringify(f.rest)} vs ${JSON.stringify(k)}`,
      );
      seen[f.side].rest++;
    }
    // the first hit is judged against the body it met (`with`): in the 1.0.0 fixture's
    // throw 19 the baton meets a lying baton and the kubb it leans on in one step, and
    // `touches` sorts a tie by id, so its first is the kubb, 0.32 m from the hit
    const hitBody = f.firstHit?.with ?? f.touches[0]?.id;
    if (f.firstHit?.x != null && hitBody) {
      const t = f.firstHit.t ?? f.touches[0]?.t;
      const k = engine.showAt(t).items.find((it) => it.id === hitBody);
      assert.ok(
        near(f.firstHit, k) < 0.3,
        `${label}: firstHit ${JSON.stringify(f.firstHit)} vs ${JSON.stringify(k)}`,
      );
      seen[f.side].hit++;
    }
    // the camera aims where the throw went: the first piece hit, else the landing
    if (f.how === "baton" && (f.firstHit?.x != null || f.land?.x != null)) {
      const hitId = f.firstHit?.x != null ? hitBody : null;
      const at = hitId ? (f.firstHit.t ?? f.touches[0].t) : f.landT;
      const w = engine.showAt(at).items.find((it) => it.id === (hitId ?? pid));
      const { to } = throwLine(f);
      assert.ok(
        near(to, w) < 0.3,
        `${label}: camera aims at ${JSON.stringify(to)}, the throw went to ${JSON.stringify(w)}`,
      );
      seen[f.side].camera++;
    }
    engine.showAt(rec.duration);
  }
  engine.replayEnd();
  for (const side of ["A", "B"])
    for (const k of ["land", "rest", "hit", "camera"])
      assert.ok(seen[side][k] > 0, `the fixture has a ${side} ${k} to check`);
});
