import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { POC_KEY: "test-key" } },
    }),
  ],
  test: { include: ["test/**/*.spec.js"] },
});
