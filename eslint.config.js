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
];
