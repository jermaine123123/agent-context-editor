import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/**/*.test.ts"],
    environment: "node",
  },
});
