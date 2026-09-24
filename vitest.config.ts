import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts so the CRXJS plugin (a build-time
// extension bundler) never runs during unit tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
