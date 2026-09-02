import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Control Plane tests import this workspace package by name. CI's
    // turbo filter builds @atlas/api and its deps, not civio dist.
    alias: {
      "@atlas/integrations-civio": path.resolve(
        root,
        "packages/integrations/civio/src/index.ts",
      ),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
