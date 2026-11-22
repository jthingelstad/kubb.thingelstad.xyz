// LobbyDO: what pitches report, what /open lists, expiry and out-of-order reports.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { join, newCode, waitUntil } from "./helpers.js";

const lobby = () => env.LOBBY.get(env.LOBBY.idFromName("open"));
const entryFor = async (code) =>
  (await lobby().list()).find((g) => g.pitch === code);

describe("LobbyDO", () => {
  it("lists an open pitch with counts, state and age, and takes it off", async () => {
    const code = newCode();
    const a = await join(code, "anna", { me: { name: "Mighty Maple" } });
    a.send({ t: "open", open: { seats: 12, state: "waiting" } });
    const e = await waitUntil(() => entryFor(code));
    expect(e).toMatchObject({
      pitch: code,
      players: 1,
      watchers: 0,
      seats: 12,
      state: "waiting",
    });
    expect(Object.keys(e).sort()).toEqual([
      "age",
      "made",
      "pitch",
      "players",
      "seats",
      "state",
      "watchers",
    ]);
    expect(JSON.stringify(e)).not.toContain("Mighty Maple");
    const o = await join(code, "olga", { role: "observer" });
    await waitUntil(async () => (await entryFor(code))?.watchers === 1);
    a.send({ t: "open", open: null });
    await waitUntil(async () => !(await entryFor(code)));
    a.close();
    o.close();
  });

  it("drops a pitch when nobody is left on it", async () => {
    const code = newCode();
    const a = await join(code, "anna");
    a.send({ t: "open", open: { seats: 2, state: "playing" } });
    await waitUntil(() => entryFor(code));
    a.close();
    await waitUntil(async () => !(await entryFor(code)));
  });

  it("expires entries not said again and ignores reports that arrive late", async () => {
    const t = Date.now();
    const code = newCode();
    const entry = {
      made: t,
      players: 1,
      watchers: 0,
      seats: 12,
      state: "waiting",
    };
    expect(await lobby().report({ pitch: code, entry, at: t, seq: 0 }, t)).toBe(
      true,
    );
    expect((await lobby().list(t + 60_000)).some((g) => g.pitch === code)).toBe(
      true,
    );
    expect(
      (await lobby().list(t + 16 * 60_000)).some((g) => g.pitch === code),
    ).toBe(false);

    const c2 = newCode();
    await lobby().report({ pitch: c2, entry: null, at: t, seq: 2 }, t);
    expect(await lobby().report({ pitch: c2, entry, at: t, seq: 1 }, t)).toBe(
      false,
    );
    expect((await lobby().list(t)).some((g) => g.pitch === c2)).toBe(false);
    // junk is refused
    expect(await lobby().report({ pitch: "NOPE", entry, at: t }, t)).toBe(
      false,
    );
    expect(
      await lobby().report(
        { pitch: newCode(), entry: { ...entry, seats: 99 }, at: t },
        t,
      ),
    ).toBe(false);
  });

  it("returns the newest 20", async () => {
    const t = Date.now() + 1_000_000; // later than anything the other tests listed
    for (let i = 0; i < 25; i++)
      await lobby().report(
        {
          pitch: newCode("n"),
          entry: {
            made: t + i,
            players: 1,
            watchers: 0,
            seats: 12,
            state: "waiting",
          },
          at: t,
        },
        t,
      );
    const games = await lobby().list(t + 30);
    expect(games).toHaveLength(20);
    expect(games[0].made).toBe(t + 24);
    expect(games[19].made).toBe(t + 5);
  });
});
