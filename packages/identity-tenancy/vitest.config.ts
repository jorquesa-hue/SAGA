import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests create scratch databases from template1; parallel
    // CREATE DATABASE calls race on the template. Serialize files.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
