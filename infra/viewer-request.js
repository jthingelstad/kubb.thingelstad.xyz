// The site's viewer request function (CloudFront Functions, JavaScript
// runtime 2.0). infra/site.json carries this file as its FunctionCode
// (tools/infra.mjs copies it in before every plan; tests/site fails when the
// two differ), and the preview server runs this same file.
//
//   /p/<code>        any code serves the one game page, /pitch/index.html
//   /e/<code>        the embed of that pitch, /embed/index.html
//   /og/<code>.png   that pitch's share image; the static one, /share/kubb.png,
//                    is what it falls back to
//   /p, /p/          302 to a pitch with a new code (for a browser without scripts)
//   /web, /web/      301 to /#play, keeping the query: the web game's page was
//                    folded into the landing page (the 1.0 design, 2026-11-21)
//   /x/         /x/index.html
//   /x          301 to /x/, keeping the query
//
// The site's address is https://throwingwood.com (since 2026-11-17). The
// old address and www answer every route here with a 301 to the same path
// and query there, so links and embeds already shared keep working. Any
// other host (the preview on 127.0.0.1) is served as it is.
var HOME = "https://throwingwood.com";
var MOVED_HOSTS = {
  "kubb.thingelstad.xyz": true,
  "www.throwingwood.com": true,
};

// A code is 8 to 24 characters from the alphabet below, the pitch code's
// own rule (PITCH_CODE in backend/api/checks.mjs); the home page makes 8. Any other
// /p/ address is not a pitch and ends at the 404.
//
// The three pitch routes also carry the code as the query string `pitch`.
// Their behaviours send them to the pages function (backend/pages, which
// reads the pitch's records and writes its share tags and image) with the
// static file as the failover origin, so the rewritten address is what the
// bucket serves when the function cannot answer. Only `pitch` and `v` reach
// the function or the cache key; the page's own query (?solo=1) stays in the
// browser's address.
var PITCH_ROUTES = [
  [/^\/p\/([2-9a-hjkmnp-z]{8,24})\/?$/, "/pitch/index.html"],
  [/^\/e\/([2-9a-hjkmnp-z]{8,24})\/?$/, "/embed/index.html"],
  [/^\/og\/([2-9a-hjkmnp-z]{8,24})\.png$/, "/share/kubb.png"],
];

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var query = Object.keys(request.querystring)
    .map(function (k) {
      var v = request.querystring[k];
      return v.multiValue
        ? v.multiValue
            .map(function (m) {
              return k + "=" + m.value;
            })
            .join("&")
        : k + "=" + v.value;
    })
    .join("&");
  var host =
    request.headers && request.headers.host && request.headers.host.value;
  if (MOVED_HOSTS[host])
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: HOME + uri + (query ? "?" + query : "") } },
    };
  if (uri === "/.well-known/apple-app-site-association") return request;
  if (uri === "/web" || uri === "/web/" || uri === "/web/index.html")
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: "/" + (query ? "?" + query : "") + "#play" },
      },
    };
  if (uri === "/p" || uri === "/p/") {
    var alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    var code = "";
    for (var i = 0; i < 8; i++)
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    return {
      statusCode: 302,
      statusDescription: "Found",
      headers: {
        location: { value: "/p/" + code + (query ? "?" + query : "") },
        "cache-control": { value: "no-store" },
      },
    };
  }
  for (var r = 0; r < PITCH_ROUTES.length; r++) {
    var m = uri.match(PITCH_ROUTES[r][0]);
    if (m) {
      request.uri = PITCH_ROUTES[r][1];
      request.querystring.pitch = { value: m[1] };
      return request;
    }
  }
  if (uri.endsWith("/")) request.uri = uri + "index.html";
  else if (uri.split("/").pop().indexOf(".") === -1)
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: uri + "/" + (query ? "?" + query : "") } },
    };
  return request;
}
