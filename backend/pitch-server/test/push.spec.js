// Pushes to the AWS receiver: signed, kept in the outbox until a 2xx, retried by alarm
// with backoff, and quiet when no receiver is configured.
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  actMsg,
  join,
  newCode,
  receiverGet,
  receiverPost,
  settle,
  startMsg,
  waitUntil,
} from "./helpers.js";

const stub = (code) => env.PITCH.get(env.PITCH.idFromName(code));
const outbox = (code) =>
  runInDurableObject(stub(code), (_i, state) =>
    state.storage.sql
      .exec("SELECT k, tries, due FROM outbox ORDER BY rowid")
      .toArray(),
  );

describe("pushes", () => {
  it("are signed, retried by alarm with backoff, and confirmed only on a 2xx", async () => {
    const code = newCode();
    await receiverPost("/control", { fail: 3, failPitch: code });
    const a = await join(code, "anna");
    a.send(startMsg(1));
    await a.next((f) => f.t === "ok" && f.re === "start");
    a.send(actMsg(1, 1, { over: true }));
    await a.next((f) => f.t === "ok" && f.re === "act");

    // start:1, act:1:1 and keep:1 all answered 503
    await waitUntil(
      async () =>
        (await receiverGet(`/received?pitch=${code}`)).attempts.length >= 3,
    );
    await settle(100);
    let box = await outbox(code);
    expect(box.map((r) => r.k)).toEqual(["start:1", "act:1:1", "keep:1"]);
    expect(box.every((r) => r.tries === 1 && r.due > Date.now())).toBe(true);
    const alarm = await runInDurableObject(stub(code), (_i, s) =>
      s.storage.getAlarm(),
    );
    expect(alarm).toBe(Math.min(...box.map((r) => r.due)));

    // the alarm fires once the retries are due: all three go again and are taken
    await runInDurableObject(stub(code), (inst) => {
      inst.clock = () => Date.now() + 10_000;
    });
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    await waitUntil(async () => (await outbox(code)).length === 0);
    const got = await receiverGet(`/received?pitch=${code}`);
    expect(got.bad).toBe(0);
    expect(got.taken.map((m) => m.k).sort()).toEqual([
      "act:1:1",
      "keep:1",
      "start:1",
    ]);
    const byK = Object.fromEntries(got.taken.map((m) => [m.k, m]));
    expect(byK["start:1"]).toMatchObject({ v: 1, pitch: code, topic: "start" });
    expect(byK["start:1"].body).toMatchObject({
      n: 1,
      h0: "h0-1",
      snap: startMsg(1).snap,
    });
    expect(byK["act:1:1"].body).toMatchObject({
      n: 1,
      seq: 1,
      over: true,
      snap: actMsg(1).snap,
    });
    expect(byK["keep:1"].body.log).toEqual([
      { a: actMsg(1).a, h: "h-1-1", ts: expect.any(Number) },
    ]);
    expect(typeof byK["keep:1"].made).toBe("number");
    expect(JSON.stringify(byK["keep:1"].body)).not.toContain("anna");
    a.close();
  });

  it("send what is pending again when the object wakes", async () => {
    const code = newCode();
    await receiverPost("/control", { fail: 1, failPitch: code });
    const a = await join(code, "anna");
    a.send(startMsg(1));
    await a.next((f) => f.t === "ok" && f.re === "start");
    await waitUntil(async () =>
      (await outbox(code)).some((r) => r.tries === 1),
    );
    // a new instance rebuilt from storage sends the outbox again (rebuildPitch's resend),
    // once its retry is due
    const { evictDurableObject } = await import("cloudflare:test");
    await evictDurableObject(stub(code));
    await runInDurableObject(stub(code), (inst) => {
      inst.clock = () => Date.now() + 10_000;
    });
    await runDurableObjectAlarm(stub(code));
    await waitUntil(async () => (await outbox(code)).length === 0);
    expect(
      (await receiverGet(`/received?pitch=${code}`)).taken.map((m) => m.k),
    ).toEqual(["start:1"]);
    a.close();
  });

  it("leave a push on its way out of the alarm, so a slow receiver is not hammered", async () => {
    const code = newCode();
    await receiverPost("/control", { fail: 1, failPitch: code });
    const a = await join(code, "anna");
    a.send(startMsg(1));
    await a.next((f) => f.t === "ok" && f.re === "start");
    await waitUntil(async () =>
      (await outbox(code)).some((r) => r.tries === 1),
    );
    // the retry is due and the receiver now takes 1.5 s to answer
    await receiverPost("/control", { delayMs: 1500, delayPitch: code });
    await runInDurableObject(stub(code), (inst) => {
      inst.clock = () => Date.now() + 10_000;
    });
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    await settle(200);
    // while it is on its way no alarm is set for it (one in the past would fire at once)
    const during = await runInDurableObject(stub(code), async (inst, s) => ({
      inflight: inst.inflight.size,
      alarm: await s.storage.getAlarm(),
    }));
    expect(during).toEqual({ inflight: 1, alarm: null });
    await waitUntil(async () => (await outbox(code)).length === 0);
    expect(
      (await receiverGet(`/received?pitch=${code}`)).taken.map((m) => m.k),
    ).toEqual(["start:1"]);
    a.close();
  });

  it("wait quietly in the outbox when no receiver is configured", async () => {
    const code = newCode();
    const a = await join(code, "anna");
    await runInDurableObject(stub(code), (inst) => {
      inst.env = { ...inst.env, PUSH_URL: undefined };
    });
    a.send(startMsg(1));
    await a.next((f) => f.t === "ok" && f.re === "start");
    a.send(actMsg(1));
    await a.next((f) => f.t === "ok" && f.re === "act");
    await settle(100);
    expect((await outbox(code)).map((r) => [r.k, r.tries])).toEqual([
      ["start:1", 0],
      ["act:1:1", 0],
    ]);
    expect((await receiverGet(`/received?pitch=${code}`)).attempts).toEqual([]);
    // no retry alarm for them: only the core's own deadlines
    const alarm = await runInDurableObject(stub(code), (_i, s) =>
      s.storage.getAlarm(),
    );
    expect(alarm).toBeNull();
    a.close();
  });
});
