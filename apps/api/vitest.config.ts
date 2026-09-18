import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
    },
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
