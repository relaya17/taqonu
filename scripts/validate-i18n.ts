/**
 * validate-i18n.ts
 * ─────────────────────────────────────────────────────────────
 * Validates that all locale message files are fully synchronized
 * with en.json (the source of truth).
 *
 * Run:  tsx scripts/validate-i18n.ts
 * Exit: 0 = all locales in sync  |  1 = parity errors found
 *
 * CI integration: add to the "lint" or "test" turbo pipeline,
 * or run directly in GitHub Actions before unit tests.
 * ─────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = path.resolve(__dirname, "../apps/web/messages");

// ── helpers ────────────────────────────────────────────────────

/** Recursively flatten a nested JSON object into dot-notation keys */
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  const result: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      result.push(...flattenKeys(v, full));
    } else {
      result.push(full);
    }
  }
  return result;
}

function loadJson(file: string): Record<string, unknown> {
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ── main ───────────────────────────────────────────────────────

const files = fs
  .readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

const enFile = path.join(MESSAGES_DIR, "en.json");
if (!fs.existsSync(enFile)) {
  console.error("❌  en.json not found — cannot validate.");
  process.exit(1);
}

const enKeys = new Set(flattenKeys(loadJson(enFile)));
const enKeyCount = enKeys.size;
console.log(`\n📋  Source of truth: en.json  (${enKeyCount} keys)\n`);

let hasErrors = false;

for (const file of files) {
  if (file === "en.json") continue;
  const locale = file.replace(".json", "");
  const data = loadJson(path.join(MESSAGES_DIR, file));
  const localeKeys = new Set(flattenKeys(data));

  const missing = [...enKeys].filter((k) => !localeKeys.has(k));
  const extra = [...localeKeys].filter((k) => !enKeys.has(k));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`  ✅  ${locale}  —  ${localeKeys.size}/${enKeyCount} keys  (in sync)`);
  } else {
    hasErrors = true;
    console.log(
      `  ❌  ${locale}  —  ${localeKeys.size}/${enKeyCount} keys  (${missing.length} missing, ${extra.length} extra)`
    );
    if (missing.length > 0) {
      console.log(`       Missing keys:`);
      missing.forEach((k) => console.log(`         – ${k}`));
    }
    if (extra.length > 0) {
      console.log(`       Extra keys (not in en.json):`);
      extra.forEach((k) => console.log(`         + ${k}`));
    }
  }
}

console.log();

if (hasErrors) {
  console.error(
    "❌  i18n parity check FAILED.\n" +
      "    Add the missing translations to each failing locale file.\n" +
      "    Keys must match en.json exactly.\n"
  );
  process.exit(1);
} else {
  console.log("✅  All locale files are in sync with en.json.\n");
  process.exit(0);
}
