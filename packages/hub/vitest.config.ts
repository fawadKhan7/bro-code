import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // forks: each test file gets its own process, so per-file DUO_HOME/env isolation holds.
    pool: "forks",
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
