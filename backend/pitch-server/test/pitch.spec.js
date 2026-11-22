// PitchDO in the Workers pool: joining, the action relay, resume, a rebuild after the
// object is evicted, the literal ping, and the idle wipe.
import { env } from "cloudflare:workers";
import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  actMsg,
  connect,
  join,
  member,
  newCode,
  settle,
  startMsg,
  waitUntil,
} from "./helpers.js";

const stub = (code) => env.PITCH.get(env.PITCH.idFromName(code));
const count = (code, table) =>
  runInDurableObject(
    stub(code),
    (_i, state) =>
      state.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n,
  );

describe("PitchDO", () => {
  it("joins, relays an action without its snapshot, and keeps it", async () => {
    const code = newCode();
    const a = await join(code, "anna", { me: { name: "Mighty Maple" } });
    expect(a.joined).toMatchObject({
      t: "joined",
      pitch: code,
      role: "player",
    });
    expect(a.joined.host).toBe(member("anna"));
    const b = await join(code, "bert");
    expect((await a.next((f) => f.t === "member")).member.id).toBe(
      member("bert"),
    );
    const o = await join(code, "olga", { role: "observer" });
    expect(o.joined.role).toBe("observer");

    a.send(startMsg(1));
    const ok0 = await a.next((f) => f.t === "ok" && f.re === "start");
    const st = await b.next((f) => f.t === "start");
    expect(st.snap).toBe(startMsg(1).snap);
    expect(st.s).toBe(ok0.s);

    a.send(actMsg(1));
    const ok = await a.next((f) => f.t === "ok" && f.re === "act");
    expect(ok).toMatchObject({ n: 1, seq: 1 });
    for (const c of [b, o]) {
      const f = await c.next((x) => x.t === "act");
      expect(f).toMatchObject({ m: member("anna"), n: 1, seq: 1, s: ok.s });
      expect(f.snap).toBeUndefined();
      expect(f.a).toEqual(actMsg(1).a);
    }
    // an observer may not act
    o.send(actMsg(2));
    expect((await o.next((f) => f.t === "error")).code).toBe("observer");

    expect(await count(code, "acts")).toBe(1);
    const head = await runInDurableObject(stub(code), (_i, state) =>
      JSON.parse(
        state.storage.sql.exec("SELECT v FROM records WHERE k = 'head'").one()
          .v,
      ),
    );
    expect(head).toMatchObject({ n: 1, seq: 1, h: "h-1-1", over: false });
    for (const c of [a, b, o]) c.close();
  });

  it("settles two actions at once: one stored, one refused, the same log", async () => {
    const code = newCode();
    const a = await join(code, "anna");
    const b = await join(code, "bert");
    a.send(startMsg(1));
    await b.next((f) => f.t === "start");
    a.send(actMsg(1, 1, { id: "from-a" }));
    b.send(actMsg(1, 1, { id: "from-b" }));
    const ra = await a.next(
      (f) => (f.t === "ok" && f.re === "act") || f.t === "refused",
    );
    const rb = await b.next(
      (f) => (f.t === "ok" && f.re === "act") || f.t === "refused",
    );
    expect([ra.t, rb.t].sort()).toEqual(["ok", "refused"]);
    const loser = ra.t === "refused" ? a : b;
    const relayed = await loser.next((f) => f.t === "act");
    expect(relayed.id).toBe(ra.t === "ok" ? "from-a" : "from-b");
    // a resend of a stored action is acked again, not stored twice
    const winner = ra.t === "ok" ? a : b;
    winner.send(
      actMsg(1, 1, { id: relayed.id === "from-a" ? "from-a" : "from-b" }),
    );
    expect((await winner.next((f) => f.t === "ok" && f.dup)).seq).toBe(1);
    expect(await count(code, "acts")).toBe(1);
    a.close();
    b.close();
  });

  it("resumes a player who dropped with exactly the actions missed", async () => {
    const code = newCode();
    const a = await join(code, "anna");
    let b = await join(code, "bert");
    a.send(startMsg(1));
    for (let s = 1; s <= 3; s++) {
      a.send(actMsg(s));
      await a.next((f) => f.t === "ok" && f.re === "act" && f.seq === s);
    }
    b.close();
    await a.next(
      (f) =>
        f.t === "member" &&
        f.member.id === member("bert") &&
        !f.member.connected,
    );
    for (let s = 4; s <= 5; s++) {
      a.send(actMsg(s));
      await a.next((f) => f.t === "ok" && f.re === "act" && f.seq === s);
    }
    b = await join(code, "bert", { n: 1, seq: 3, v: 1 });
    expect(b.joined.match.full).toBe(false);
    expect(b.joined.match.acts.map((x) => x.seq)).toEqual([4, 5]);
    expect(b.joined.doc).toBeUndefined(); // it holds version 1 already
    // too far behind or another match: the whole state
    const c = await join(code, "cora", { n: 9, seq: 0 });
    expect(c.joined.match).toMatchObject({ full: true, seq: 5, h0: "h0-1" });
    for (const x of [a, b, c]) x.close();
  });

  it("refuses a computer seat whose name the game did not make (bad-name)", async () => {
    const code = newCode();
    const a = await join(code, "anna", { me: { name: "Mighty Maple" } });
    const doc = (name) => ({
      teams: { A: [member("anna"), "cpu:1"], B: [] },
      computers: { "cpu:1": { level: "pro", name } },
    });
    a.send({ t: "set", id: "w1", base: 0, doc: doc("Robo Rick") });
    expect((await a.next((f) => f.t === "error")).code).toBe("bad-name");
    a.send({ t: "set", id: "w2", base: 0, doc: doc("Lucky Larch") });
    expect(await a.next((f) => f.t === "ok" && f.re === "set")).toMatchObject({
      v: 1,
    });
    a.close();
  });

  it("answers the literal ping from the runtime", async () => {
    const a = await connect(newCode());
    a.send("ping");
    await a.next((f) => f.t === "PONG");
    a.send({ t: "ping" });
    expect(typeof (await a.next((f) => f.t === "pong")).ts).toBe("number");
    a.close();
  });

  it("behaves the same after the object is evicted and rebuilt from storage", async () => {
    // The same script on two pitches; one is evicted half way. What every socket gets
    // after that point must be the same, but for the times.
    const script = async (code, evict) => {
      const a = await join(code, "anna");
      const b = await join(code, "bert");
      const o = await join(code, "olga", { role: "observer" });
      a.send({
        t: "set",
        id: "w1",
        base: 0,
        doc: { teams: { A: [1], B: [2] } },
      });
      await a.next((f) => f.t === "ok" && f.re === "set");
      a.send(startMsg(1, 1));
      await a.next((f) => f.t === "ok" && f.re === "start");
      for (let s = 1; s <= 3; s++) {
        (s % 2 ? a : b).send(actMsg(s));
        await (s % 2 ? a : b).next((f) => f.t === "ok" && f.re === "act");
      }
      await settle();
      for (const c of [a, b, o]) c.take();
      if (evict) {
        await evictDurableObject(stub(code));
        await settle();
      }
      const alive = [a, b, o].map((c) => c.closed === null);
      // after: a resend, the next action, a stale one, a cast, a resync, a newcomer
      b.send(actMsg(2, 1, { id: "act-1-2" }));
      await b.next((f) => f.t === "ok" && f.dup);
      a.send(actMsg(4));
      await a.next((f) => f.t === "ok" && f.re === "act");
      b.send(actMsg(4, 1, { id: "late" }));
      await b.next((f) => f.t === "refused");
      a.send({ t: "cast", d: { t: "aim", x: 1 }, all: true });
      await b.next((f) => f.t === "cast");
      o.send({ t: "resync" });
      await o.next((f) => f.t === "state");
      const c = await join(code, "cora", { n: 1, seq: 2, v: 2 });
      await settle();
      const strip = (f) =>
        JSON.parse(
          JSON.stringify(f, (k, v) =>
            ["ts", "joined", "since", "pitch"].includes(k) ? undefined : v,
          ),
        );
      const got = [a, b, o, c].map((x) => x.take().map(strip));
      got.push(strip(c.joined));
      for (const x of [a, b, o, c]) x.close();
      return { got, alive };
    };
    const plain = await script(newCode(), false);
    const evicted = await script(newCode(), true);
    expect(evicted.alive).toEqual([true, true, true]); // hibernatable sockets survive
    expect(evicted.got).toEqual(plain.got);
  });

  it("wipes a pitch nobody is on 48 hours after its last change", async () => {
    const code = newCode();
    const a = await join(code, "anna");
    a.send({ t: "leave" });
    await a.next((f) => f.t === "bye");
    a.close();
    await settle();
    expect(await count(code, "records")).toBeGreaterThan(0);
    const alarm = await runInDurableObject(stub(code), (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);
    await runInDurableObject(stub(code), (inst) => {
      inst.clock = () => Date.now() + 49 * 3600 * 1000;
    });
    expect(await runDurableObjectAlarm(stub(code))).toBe(true);
    await waitUntil(async () => (await count(code, "records")) === 0);
    expect(await count(code, "acts")).toBe(0);
    expect(await count(code, "outbox")).toBe(0);
    // the code works again, as a new pitch
    const b = await join(code, "bert");
    expect(b.joined.s).toBe(1);
    expect(b.joined.host).toBe(member("bert"));
    b.close();
  });
});
