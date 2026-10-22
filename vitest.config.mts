import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/envSetup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
    // Suites make real OpenRouteService calls; running them serially keeps the
    // shared free-tier rate limit happy.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
