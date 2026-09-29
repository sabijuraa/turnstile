import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["src/global-setup.ts"],
    // Every file talks to the same validator, database and services. Run them one at a time
    // in a fixed order so the output reads like the product loop.
    fileParallelism: false,
    sequence: { shuffle: false },
    testTimeout: 120_000,
    hookTimeout: 180_000,
    reporters: ["verbose"],
  },
});
