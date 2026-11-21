import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Durable Object tests in the Workers pool (workerd). PUSH_URL points at a made-up
// host that test/receiver.mjs answers through miniflare's outbound service, so no push
// leaves the machine.
import { receiver, RECEIVER_SECRET } from "./test/receiver.mjs";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          PUSH_URL: "https://receiver.test/push",
          PUSH_SECRET: RECEIVER_SECRET,
          DEV_KEY: "test-dev-key",
          VERSION: "test",
        },
        outboundService: receiver,
      },
    }),
  ],
  test: { include: ["test/**/*.spec.js"] },
});
