// The api function over plain HTTPS (backend/api/API.md): everything that is not live
// play. A report (src/net/report.js), a match played in this browser (src/net/record.js),
// a pitch's kept replay (src/replay/fetch.js), its highlight reel (src/net/reel.js) and a
// shared match (src/net/share.js). On the site the base is `/api` on its own origin, so
// the CSP's `connect-src 'self'` covers it (docs/CLIENT.md "Talking to the servers").
//
//   const answer = await apiCall({ base: config.apiUrl, call: "report", body: { r } });
//   const kept = await apiCall({ base, call: "replay", query: { pitch: code } });
//
// Resolves the answer's JSON. Rejects an ApiError whose code is the function's `error`
// (bad-message, bad-pitch, forbidden, not-found, method, too-big, failed, unavailable),
// too-many for a 429 without one (Lambda's throttle, when the function's 10 concurrent
// runs are all in use), or timeout, closed (no answer at all), unavailable (no base
// here).

const BACKSLASH = String.fromCharCode(92);

export class ApiError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// JSON with everything above "~" escaped: its length is its size in bytes, which is
// what the function's limits count.
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[^\x00-\x7e]/g,
    (c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

// The call's URL: `base` is "/api" on the site, or a full http(s) URL (a test server).
export function apiUrlFor(base, call, query = null) {
  const root = String(base).replace(/\/+$/, "");
  const q = query
    ? `?${new URLSearchParams(
        Object.entries(query).filter(([, v]) => v != null),
      )}`
    : "";
  return `${root}/${call}${q}`;
}

export async function apiCall({
  base,
  call,
  method = null,
  body = undefined,
  query = null,
  fetch = globalThis.fetch,
  timeoutMs = 15000,
}) {
  if (!base || !fetch)
    throw new ApiError("unavailable", "The server cannot be reached here.");
  const verb = method ?? (body === undefined ? "GET" : "POST");
  const ctl =
    typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl?.abort();
  }, timeoutMs);
  let res;
  try {
    res = await fetch(apiUrlFor(base, call, query), {
      method: verb,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : asciiJson(body),
      signal: ctl?.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    clearTimeout(timer);
    throw timedOut
      ? new ApiError("timeout", "No answer from the server.")
      : new ApiError("closed", "Could not reach the server.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  } finally {
    clearTimeout(timer);
  }
  if (res.ok && data && typeof data === "object") return data;
  const code =
    typeof data?.error === "string"
      ? data.error
      : res.status === 429
        ? "too-many"
        : res.status >= 500
          ? "unavailable"
          : "failed";
  throw new ApiError(
    code,
    typeof data?.message === "string" ? data.message : `HTTP ${res.status}`,
    res.status,
  );
}
