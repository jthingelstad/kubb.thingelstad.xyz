// Pushes from a pitch to the AWS receiver (build step 3, not built yet): the request's
// shape, its signature and the retry schedule. Pure apart from WebCrypto, which both
// workerd and Node have, so the node tests and the receiver can share the contract.
//
// The contract (README.md "The AWS receiver" says it in full):
//
//   POST <PUSH_URL>
//   content-type: application/json
//   x-pitch-signature: sha256=<hex HMAC-SHA256 of the raw body, key PUSH_SECRET>
//   idempotency-key: <pitch>:<made>:<k>
//   body: { v: 1, pitch, made, k, topic, sent, body }
//
// Any 2xx means "taken" (a duplicate it already holds included). Anything else, or no
// answer, is retried with backoff until it is taken.

export const PUSH = Object.freeze({
  version: 1,
  firstRetryMs: 1000, // the first retry, doubled each time ...
  maxRetryMs: 5 * 60 * 1000, // ... up to this
  timeoutMs: 10_000, // one attempt gives up after this
});

// The text that is sent and signed. `sent` is when this attempt went (the receiver may
// refuse one far from its own clock: it is inside the signature, so it cannot be moved).
export function envelope({ pitch, made, k, topic, body, sent }) {
  return JSON.stringify({ v: PUSH.version, pitch, made, k, topic, sent, body });
}

export const idempotencyKey = (pitch, made, k) => `${pitch}:${made}:${k}`;

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// HMAC-SHA256 of the UTF-8 body, as lower-case hex.
export async function sign(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

// How long to wait after the `tries`-th failure (1, 2, ...): doubling, capped, with up
// to a fifth of jitter so many pitches retrying after one outage spread out.
export function retryDelay(tries, rand = Math.random) {
  const base = Math.min(
    PUSH.maxRetryMs,
    PUSH.firstRetryMs * 2 ** Math.max(0, tries - 1),
  );
  return Math.round(base * (1 - 0.2 * rand()));
}

// The request a push makes, ready for fetch().
export async function pushRequest({
  url,
  secret,
  pitch,
  made,
  k,
  topic,
  body,
  sent,
}) {
  const text = envelope({ pitch, made, k, topic, body, sent });
  return {
    url,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pitch-signature": `sha256=${await sign(secret, text)}`,
        "idempotency-key": idempotencyKey(pitch, made, k),
      },
      body: text,
    },
  };
}
