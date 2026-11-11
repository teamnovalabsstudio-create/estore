import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Integration tests: real Postgres (TEST_DATABASE_URL), real services.
 * Next-only modules are stubbed so services run outside the framework.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      "server-only": r("./tests/int/stubs/empty.ts"),
      "next/cache": r("./tests/int/stubs/next-cache.ts"),
    },
  },
  test: {
    include: ["tests/int/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/int/global-setup.ts"],
    setupFiles: ["tests/int/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
