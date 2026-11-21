import { bindings, defineConfig, exports } from "cf/config";

// The pitch server (docs/PITCH-SERVER.md). `cf deploy` reads this file only;
// `wrangler dev` and the tests read wrangler.jsonc: keep the two alike.
//
// This is the DEV Worker, on workers.dev only: no routes, no custom domains, no other
// bindings. The production Worker (`throwingwood-pitches`) is a later step.
//
// Secrets come from a gitignored file: `cf deploy --secrets-file .dev.vars`
// (README.md "Configuration"). PUSH_URL and PUSH_SECRET are left out until the AWS
// receiver exists; without them pushes wait in each pitch's outbox.
const name = "throwingwood-pitches-dev";

export default defineConfig({
  worker: {
    name,
    compatibilityDate: "2026-11-01",
    entrypoint: "src/worker.mjs",
    workersDev: true,
    previewUrls: false,
    observability: {
      enabled: false,
    },
    exports: {
      PitchDO: exports.durableObject({ storage: "sqlite" }),
      LobbyDO: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      VERSION: bindings.text("dev-2"),
      ALLOWED_ORIGINS: bindings.text(
        "https://throwingwood.com,https://app.throwingwood.com,http://localhost,http://127.0.0.1",
      ),
      // Pitch codes starting with this play write-first, to measure both orders on
      // one deploy. Dev only: leave it out of production.
      DEV_WRITE_FIRST_PREFIX: bindings.text("wf"),
      PITCH: bindings.durableObject({ worker: name, exportName: "PitchDO" }),
      LOBBY: bindings.durableObject({ worker: name, exportName: "LobbyDO" }),
    },
  },
});
