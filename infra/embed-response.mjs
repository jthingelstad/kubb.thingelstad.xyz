// The embed's response headers, /e/* (Jamie, 2026-11-16: "I would like an embed
// option that allows me to put a Kubb game played as an embed on another
// website"): a CloudFront Function on the viewer response, written into
// infra/site.json (EmbedResponseFunction) by tools/site-template.mjs.
//
// The site's response headers policy (Headers) with its frame options left out
// and frame-ancestors * in the Content-Security-Policy (src/site/csp.mjs). A
// function and not a second policy: the account's response headers policies are
// all in use (a quota of 20), and a function sets the same headers whichever
// origin answers, the pages function or the bucket behind it.
import { embedSecurityPolicy } from "../src/site/csp.mjs";

export function embedHeaders() {
  return {
    "content-security-policy": embedSecurityPolicy(),
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
}

export function embedResponseCode() {
  return `// The embed's response headers (/e/*, viewer response). Written by
// tools/site-template.mjs from infra/embed-response.mjs and src/site/csp.mjs:
// edit those, never this copy.
var HEADERS = ${JSON.stringify(embedHeaders(), null, 2)};

function handler(event) {
  var headers = event.response.headers;
  delete headers["x-frame-options"];
  for (var name in HEADERS) headers[name] = { value: HEADERS[name] };
  return event.response;
}
`;
}
