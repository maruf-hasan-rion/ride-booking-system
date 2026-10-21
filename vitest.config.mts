import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/envSetup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
  },
});
