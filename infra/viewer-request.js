// The site's viewer request function (CloudFront Functions, JavaScript
// runtime 2.0). infra/site.json carries this file as its FunctionCode
// (tools/infra.mjs copies it in before every plan; tests/site fails when the
// two differ), and the preview server runs this same file.
//
//   /p/<code>   any code serves the one game page, /pitch/index.html
//   /p, /p/     302 to a pitch with a new code (for a browser without scripts)
//   /x/         /x/index.html
//   /x          301 to /x/, keeping the query
//
// A code is 8 to 24 characters from the alphabet below, the rooms' own rule
// (ROOM_CODE in backend/rooms/core.mjs); the home page makes 8. Any other
// /p/ address is not a pitch and ends at the 404.
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
  if (/^\/p\/[2-9a-hjkmnp-z]{8,24}\/?$/.test(uri)) {
    request.uri = "/pitch/index.html";
    return request;
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
