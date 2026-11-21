// The Worker's checks: health, the upgrade, the code, the Origin filter, /open's CORS,
// the dev endpoint's key.
import { describe, expect, it } from "vitest";
import { connect, join, newCode, raw } from "./helpers.js";

const up = { Upgrade: "websocket" };

describe("the Worker", () => {
  it("answers /health with its version", async () => {
    const res = await raw("/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok test");
  });

  it("refuses what is not a pitch socket", async () => {
    expect((await raw(`/ws?pitch=${newCode()}`)).status).toBe(426);
    expect((await raw("/ws?pitch=BAD", { headers: up })).status).toBe(400);
    expect((await raw("/ws?pitch=abc", { headers: up })).status).toBe(400);
    expect((await raw("/ws", { headers: up })).status).toBe(400);
    expect((await raw("/nothing")).status).toBe(404);
  });

  it("filters browsers by Origin and lets the native app (no Origin) in", async () => {
    const code = newCode();
    const evil = await raw(`/ws?pitch=${code}`, {
      headers: { ...up, Origin: "https://example.com" },
    });
    expect(evil.status).toBe(403);
    const lookalike = await raw(`/ws?pitch=${code}`, {
      headers: { ...up, Origin: "https://throwingwood.com.example.com" },
    });
    expect(lookalike.status).toBe(403);
    const site = await join(
      code,
      "anna",
      {},
      { origin: "https://throwingwood.com" },
    );
    expect(site.joined.t).toBe("joined");
    const dev = await connect(code, { origin: "http://localhost:4322" });
    dev.close();
    const app = await join(code, "bert"); // no Origin header
    expect(app.joined.t).toBe("joined");
    site.close();
    app.close();
  });

  it("answers /open with CORS for the site origins only", async () => {
    const pre = await raw("/open", {
      method: "OPTIONS",
      headers: { Origin: "https://throwingwood.com" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(
      "https://throwingwood.com",
    );
    const res = await raw("/open", {
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const body = await res.json();
    expect(Array.isArray(body.games)).toBe(true);
    expect(typeof body.now).toBe("number");
    expect((await raw("/open", { method: "POST" })).status).toBe(405);
  });

  it("hides the dev endpoint without the key", async () => {
    const code = newCode();
    expect((await raw(`/dev/pitch?pitch=${code}`)).status).toBe(404);
    expect(
      (
        await raw(`/dev/pitch?pitch=${code}`, {
          headers: { authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(404);
    const ok = await raw(`/dev/pitch?pitch=${code}`, {
      headers: { authorization: "Bearer test-dev-key" },
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).pitch).toBe(code);
  });
});
