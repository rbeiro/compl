import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Tests share one database seeded per file; keep files sequential.
    fileParallelism: false,
  },
});
