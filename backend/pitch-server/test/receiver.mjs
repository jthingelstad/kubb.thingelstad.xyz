// A stand-in for the AWS receiver (build step 3), run by miniflare in Node as the
// Worker's outbound service: every fetch the Worker or the tests make lands here.
//
//   POST https://receiver.test/push      a push: checked like the real one must
//   POST https://receiver.test/control   { fail: n, failPitch } answers that pitch's next n pushes 503
//   GET  https://receiver.test/received?pitch=  what it took for one pitch
//   POST https://receiver.test/reset
import { createHmac, timingSafeEqual } from "node:crypto";

export const RECEIVER_SECRET = "made-up-test-secret-not-used-anywhere";

const state = {
  fail: 0,
  failPitch: null,
  taken: new Map(),
  attempts: [],
  bad: 0,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function receiver(request) {
  const url = new URL(request.url);
  if (url.hostname !== "receiver.test")
    return new Response("no network in tests", { status: 599 });
  if (url.pathname === "/control") {
    Object.assign(state, await request.json());
    return json({ ok: true });
  }
  if (url.pathname === "/reset") {
    Object.assign(state, {
      fail: 0,
      failPitch: null,
      taken: new Map(),
      attempts: [],
      bad: 0,
    });
    return json({ ok: true });
  }
  if (url.pathname === "/received") {
    // one pitch's pushes: the test files run side by side and share this receiver
    const pitch = url.searchParams.get("pitch");
    return json({
      taken: [...state.taken.values()].filter((m) => m.pitch === pitch),
      attempts: state.attempts.filter((a) => a.pitch === pitch),
      bad: state.bad,
    });
  }
  if (url.pathname !== "/push") return json({ error: "not found" }, 404);

  const raw = await request.text();
  const sig = request.headers.get("x-pitch-signature") ?? "";
  const want = `sha256=${createHmac("sha256", RECEIVER_SECRET).update(raw).digest("hex")}`;
  const ok =
    sig.length === want.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  if (!ok) {
    state.bad++;
    return json({ error: "bad signature" }, 401);
  }
  const msg = JSON.parse(raw);
  const key = request.headers.get("idempotency-key");
  state.attempts.push({ key, pitch: msg.pitch, k: msg.k, topic: msg.topic });
  if (key !== `${msg.pitch}:${msg.made}:${msg.k}`)
    return json({ error: "bad key" }, 400);
  if (state.fail > 0 && msg.pitch === state.failPitch) {
    state.fail--;
    return json({ error: "try later" }, 503);
  }
  if (!state.taken.has(key)) state.taken.set(key, msg);
  return json({ ok: true });
}
