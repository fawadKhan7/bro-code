import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // forks: each file gets its own process, so timers and port binds stay isolated.
    pool: "forks",
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  // esbuild (vitest's default) drops `design:paramtypes`, which is exactly what
  // Nest's DI reads to resolve constructor parameters. swc emits it.
  plugins: [swc.vite({ module: { type: "es6" } })],
});
