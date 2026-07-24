import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Disposable databases are created from a shared template; serialize.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
