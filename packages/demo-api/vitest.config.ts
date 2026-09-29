import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Files that touch Postgres or the validator share state, so files run one at a time.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 180000,
  },
});
