import { bindings, defineConfig, exports } from "cf/config";

// The pitch server (docs/PITCH-SERVER.md). `cf deploy` reads this file only;
// `wrangler dev` and the tests read wrangler.jsonc: keep the two alike (but wrangler.jsonc
// has no PUSH_URL, so a local server never pushes to AWS).
//
// One file, two Workers, picked by `cf deploy --mode` (README.md "Deploy with nobody
// there" and "Deploy by hand, from 1Password"):
//
// - no mode: the DEV Worker, `throwingwood-pitches-dev`, with the dev-only settings
//   (localhost origins, the write-first prefix) and a `DEV_KEY` from `.dev.vars`;
// - `--mode production`: `throwingwood-pitches`, the site's origins only, no dev-only
//   settings, and a secrets file with `PUSH_SECRET` alone (never a `DEV_KEY`).
//
// Both are on workers.dev only: no routes, no custom domains, no other bindings. Any
// other mode is refused, so a typo never deploys a third Worker.
//
// Secrets come from a gitignored file: `cf deploy --secrets-file <file>` (README.md
// "Configuration"). Both push to the one AWS receiver, the pitches stack's function URL
// (its `ApiUrl` output) followed by `push` (docs/PITCH-SERVER.md section 12).
const PUSH_URL =
  "https://pdtv3isifdl64z7x52etbrqfci0qwlnv.lambda-url.us-east-1.on.aws/push";

const WORKERS = {
  dev: {
    name: "throwingwood-pitches-dev",
    version: "dev-8",
    origins:
      "https://throwingwood.com,https://app.throwingwood.com,http://localhost,http://127.0.0.1",
    dev: true,
  },
  production: {
    name: "throwingwood-pitches",
    version: "5",
    origins: "https://throwingwood.com,https://app.throwingwood.com",
    dev: false,
  },
} as const;

export default defineConfig(({ mode }) => {
  const key = mode ?? "dev";
  if (key !== "dev" && key !== "production")
    throw new Error(
      `unknown mode "${mode}": leave it out (dev) or "production"`,
    );
  const w = WORKERS[key];
  return {
    worker: {
      name: w.name,
      compatibilityDate: "2026-11-01",
      entrypoint: "src/worker.mjs",
      workersDev: true,
      previewUrls: false,
      // Workers Logs: the lines the code writes itself (src/log.mjs), and not the
      // automatic line for every request, which would be one per socket message and
      // would carry each pitch link's code in its URL (README.md "Operate").
      observability: {
        enabled: true,
        logs: {
          enabled: true,
          invocationLogs: false,
        },
      },
      exports: {
        PitchDO: exports.durableObject({ storage: "sqlite" }),
        LobbyDO: exports.durableObject({ storage: "sqlite" }),
      },
      env: {
        VERSION: bindings.text(w.version),
        ALLOWED_ORIGINS: bindings.text(w.origins),
        PUSH_URL: bindings.text(PUSH_URL),
        // the lines that are not failures are written too (src/log.mjs)
        LOG: bindings.text("1"),
        // Pitch codes starting with this play write-first, to measure both orders on
        // one deploy. Dev only. And every push the dev Worker makes is marked dev, so the
        // receiver keeps it under games/dev/ and never as real play (backend/api/API.md
        // "Dev pushes").
        ...(w.dev
          ? {
              DEV_WRITE_FIRST_PREFIX: bindings.text("wf"),
              PUSH_DEV: bindings.text("1"),
            }
          : {}),
        PITCH: bindings.durableObject({
          worker: w.name,
          exportName: "PitchDO",
        }),
        LOBBY: bindings.durableObject({
          worker: w.name,
          exportName: "LobbyDO",
        }),
      },
    },
  };
});
