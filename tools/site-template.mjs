// infra/site.json carries three things whose one source is elsewhere: the
// viewer request function (infra/viewer-request.js, which the preview server
// also runs), the site's Content-Security-Policy (src/site/csp.mjs, which the
// preview server also sends; never framed), and the embed's viewer response
// function (infra/embed-response.mjs: the same headers, any site may frame it). tools/infra.mjs writes them in before every
// plan; tests/site fails when the template has drifted.
//
//   node tools/site-template.mjs         write them in
//   node tools/site-template.mjs check   fail if the template differs
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { contentSecurityPolicy } from "../src/site/csp.mjs";
import { embedResponseCode } from "../infra/embed-response.mjs";

const TEMPLATE = new URL("../infra/site.json", import.meta.url);
const FUNCTION = new URL("../infra/viewer-request.js", import.meta.url);

export async function expectedTemplate() {
  const template = JSON.parse(await fs.readFile(TEMPLATE, "utf8"));
  template.Resources.ViewerRequestFunction.Properties.FunctionCode =
    await fs.readFile(FUNCTION, "utf8");
  template.Resources.Headers.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy =
    contentSecurityPolicy();
  template.Resources.EmbedResponseFunction.Properties.FunctionCode =
    embedResponseCode();
  // Written as prettier writes it, so npm run format:check agrees.
  return format(JSON.stringify(template), { parser: "json" });
}

export async function syncSiteTemplate() {
  const next = await expectedTemplate();
  if (next !== (await fs.readFile(TEMPLATE, "utf8"))) {
    await fs.writeFile(TEMPLATE, next);
    return true;
  }
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "check") {
    if ((await expectedTemplate()) !== (await fs.readFile(TEMPLATE, "utf8"))) {
      console.error(
        "infra/site.json differs from its sources: node tools/site-template.mjs",
      );
      process.exit(1);
    }
    console.log("infra/site.json matches its sources");
  } else
    console.log(
      (await syncSiteTemplate())
        ? "Wrote infra/site.json"
        : "infra/site.json already current",
    );
}
