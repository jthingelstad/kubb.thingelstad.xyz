import { bindings, defineConfig, exports } from "cf/config";

// Throwaway proof of concept: Throwing Wood rooms relay on Durable Objects.
// workers.dev only: no routes, no custom domains, no other bindings.
// `cf deploy` reads this file; `wrangler dev` and the tests still read wrangler.jsonc.
// The POC_KEY secret comes from .dev.vars (`cf deploy --secrets-file .dev.vars`).
// This format has no code_update_strategy, so a deploy reaches a busy room on
// Cloudflare's default deferred schedule (up to 300 s), not the 60 s in wrangler.jsonc.
export default defineConfig({
  worker: {
    name: "throwingwood-rooms-poc",
    compatibilityDate: "2026-11-01",
    entrypoint: "src/worker.js",
    workersDev: true,
    previewUrls: false,
    observability: {
      enabled: false,
    },
    exports: {
      RoomDO: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      POC_VERSION: bindings.text("1"),
      ROOM: bindings.durableObject({
        worker: "throwingwood-rooms-poc",
        exportName: "RoomDO",
      }),
    },
  },
});
