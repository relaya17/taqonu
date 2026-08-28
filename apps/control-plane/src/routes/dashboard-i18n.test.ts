import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_I18N_LANGS,
  DASHBOARD_TRANSLATIONS,
  dashboardI18nKeyMismatches,
  dashboardI18nKeys,
  duplicateKeysInObjectLiteralSource,
} from "./dashboard-i18n.js";

const REQUIRED_ONCE = ["tabOverview", "tabAgents", "approvalRequired"] as const;
const REQUIRED_PORTFOLIO = ["tabPortfolio", "portfolioTitle", "portfolioNote"] as const;

function languageBlock(source: string, name: string): string {
  const match = source.match(
    new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\} as const;`),
  );
  expect(match?.[1], `missing ${name} language block`).toBeTruthy();
  return match![1]!;
}

describe("dashboard i18n uniqueness (Phase 11.2)", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "dashboard-i18n.ts"),
    "utf8",
  );

  it("keeps he, en, and ar key sets identical", () => {
    expect(dashboardI18nKeyMismatches()).toEqual([]);
  });

  it("contains each key exactly once per language object", () => {
    for (const lang of DASHBOARD_I18N_LANGS) {
      const keys = dashboardI18nKeys(lang);
      expect(new Set(keys).size).toBe(keys.length);
      for (const required of REQUIRED_ONCE) {
        expect(keys.filter((k) => k === required)).toEqual([required]);
      }
      for (const required of REQUIRED_PORTFOLIO) {
        expect(keys.filter((k) => k === required)).toEqual([required]);
      }
      expect(DASHBOARD_TRANSLATIONS[lang].tabAgents).not.toBe(
        DASHBOARD_TRANSLATIONS[lang].tabPortfolio,
      );
    }
  });

  it("has no duplicate property names in source object literals", () => {
    expect(duplicateKeysInObjectLiteralSource(languageBlock(source, "he"))).toEqual([]);
    expect(duplicateKeysInObjectLiteralSource(languageBlock(source, "en"))).toEqual([]);
    expect(duplicateKeysInObjectLiteralSource(languageBlock(source, "ar"))).toEqual([]);
  });
});
