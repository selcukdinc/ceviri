import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "cloudflare:workers": new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url).pathname } },
});
