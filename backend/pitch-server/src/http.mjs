// The Worker's request checks, pure so the node tests can hold them.

// ALLOWED_ORIGINS: comma separated origins. An entry without a port matches any port
// ("http://localhost" allows http://localhost:5173), as the rooms server's filter does.
export function parseOrigins(text) {
  return String(text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function originAllowed(origin, allowed) {
  let o;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    let a;
    try {
      a = new URL(entry);
    } catch {
      return false;
    }
    return (
      a.protocol === o.protocol &&
      a.hostname === o.hostname &&
      (a.port === "" || a.port === o.port)
    );
  });
}

// The Origin filter for a WebSocket. A browser always sends Origin and cannot lie about
// it, so a listed one keeps other web sites' pages out. The native iPhone app sends none
// and is let in. This is a filter, not authentication: anything that is not a browser
// can send any header (docs/ROOMS.md, "By design").
export function socketOriginOk(origin, allowed) {
  if (origin === null || origin === undefined) return true;
  return originAllowed(origin, allowed);
}

// CORS headers for a GET from a site page: the origin echoed when it is listed.
export function corsHeaders(origin, allowed) {
  const h = { vary: "Origin" };
  if (origin && originAllowed(origin, allowed)) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-methods"] = "GET, OPTIONS";
    h["access-control-max-age"] = "86400";
  }
  return h;
}

// Constant-time-ish comparison for the dev key.
export function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
