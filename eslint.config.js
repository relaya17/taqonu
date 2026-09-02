import eslint from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      // Generated Vercel Node entry (esbuild bundle)
      "apps/api/api/index.js",
      "apps/api/vercel-bundle.js",
      "apps/api/vercel-bundle.cjs",
      "apps/api/.vercel-bundle-ok",
      "apps/api/scripts/**",
    ],
  },
  eslint.configs.recommended,
  prettier,
  {
    // Hand-written Vercel Node entrypoints and esbuild bundling scripts run under Node, not TS type-checking.
    files: ["apps/*/api/index.js", "apps/*/scripts/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // TypeScript already checks undefined identifiers (NodeJS, DOM libs, etc.).
      "no-undef": "off",
      // Detector/secret regexes intentionally escape for readability.
      "no-useless-escape": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", disallowTypeAnnotations: false },
      ],
    },
  },
  {
    // Guardrail for ADR-023 (docs/adr/ADR-023-single-live-approval-authority.md):
    // ApprovalExecutionRepository ("Unit 2") is parked, non-live prepared
    // infrastructure. It must never become a second approval authority
    // alongside the live LiveApprovalRequestRepository path. This rule fails
    // the build if anything outside the repository's own file/tests/index
    // re-export imports it.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "packages/database/src/repositories/approval-execution.ts",
      "packages/database/src/repositories/approval-execution.test.ts",
      "packages/database/src/index.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@atlas/database",
              importNames: ["ApprovalExecutionRepository"],
              message:
                "ApprovalExecutionRepository (Unit 2) is parked per ADR-023 and must not become a second approval authority. See docs/adr/ADR-023-single-live-approval-authority.md.",
            },
          ],
          patterns: [
            {
              group: [
                "**/repositories/approval-execution",
                "**/repositories/approval-execution.js",
              ],
              message:
                "ApprovalExecutionRepository (Unit 2) is parked per ADR-023 and must not become a second approval authority. See docs/adr/ADR-023-single-live-approval-authority.md.",
            },
          ],
        },
      ],
    },
  },
];
