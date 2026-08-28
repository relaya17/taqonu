import { describe, expect, it } from "vitest";
import { getDashboardHtml } from "./dashboard.js";
import {
  DASHBOARD_I18N_LANGS,
  DASHBOARD_TRANSLATIONS,
} from "./dashboard-i18n.js";

function extractTranslations(html: string): Record<string, Record<string, string>> {
  const start = html.indexOf("var TRANSLATIONS = ");
  const end = html.indexOf("// END_DASHBOARD_TRANSLATIONS");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const raw = html.slice(start + "var TRANSLATIONS = ".length, end).trim().replace(/;$/, "");
  return JSON.parse(raw) as Record<string, Record<string, string>>;
}

describe("dashboard Portfolio UI (Phase 11.2)", () => {
  const html = getDashboardHtml();
  const translations = extractTranslations(html);

  it("injects unique i18n keys for he, en, and ar", () => {
    expect(Object.keys(translations).sort()).toEqual(["ar", "en", "he"]);
    for (const lang of DASHBOARD_I18N_LANGS) {
      const keys = Object.keys(translations[lang] ?? {});
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.filter((k) => k === "tabOverview")).toEqual(["tabOverview"]);
      expect(keys.filter((k) => k === "tabAgents")).toEqual(["tabAgents"]);
      expect(keys.filter((k) => k === "approvalRequired")).toEqual(["approvalRequired"]);
      expect(translations[lang]?.tabPortfolio).toBe(DASHBOARD_TRANSLATIONS[lang].tabPortfolio);
      expect(translations[lang]?.portfolioTitle).toBe(DASHBOARD_TRANSLATIONS[lang].portfolioTitle);
      expect(translations[lang]?.portfolioNote).toBe(DASHBOARD_TRANSLATIONS[lang].portfolioNote);
    }
  });

  it("loads agents, portfolio, and audit on init and language reload", () => {
    expect(html).toContain("loadAgents();\n          loadPortfolio();\n          loadAudit();");
    expect(html).toContain("loadAgents();\n    loadPortfolio();\n    loadAudit();");
  });

  it("keeps Portfolio observational and distinct from Agent Registry", () => {
    const loadPortfolio = html.slice(
      html.indexOf("async function loadPortfolio()"),
      html.indexOf("async function loadAudit()"),
    );
    expect(loadPortfolio).toContain("fetch('/api/v1/portfolio-governance')");
    expect(loadPortfolio).not.toMatch(/t\("tabAgents"\)/);
    expect(loadPortfolio).toContain('t("sourceAgentsCount")');
    expect(loadPortfolio).not.toMatch(/method:\s*['"]POST['"]/);
    expect(html).not.toContain("/api/v1/portfolio-governance/decisions");
    expect(html).toContain('data-i18n="planeFabric"');
    expect(html).toContain('data-i18n="planeSourceApps"');
    expect(html).toContain('data-i18n="planeSourceAgents"');
    expect(html).toContain('data-i18n="planeNeq"');
  });

  it("projects required inventory columns from the governance snapshot", () => {
    for (const key of [
      "portfolioApps",
      "portfolioSourceAgents",
      "thImplementation",
      "thCapabilities",
      "thVerification",
      "thRuntime",
      "thProvenance",
      "thEvidence",
      "thDecision",
    ]) {
      expect(html).toContain(`data-i18n="${key}"`);
    }
    expect(html).toContain("snapshot.applications");
    expect(html).toContain("snapshot.sourceAgents");
    expect(html).toContain("snapshot.capabilities");
    expect(html).toContain("snapshot.evidence");
    expect(html).toContain("snapshot.governanceDecisions");
  });

  it("includes loading, empty, and error states", () => {
    expect(html).toContain('id="portfolio-apps-tbody"');
    expect(html).toContain('id="portfolio-source-agents-tbody"');
    expect(html).toContain('data-i18n="loading"');
    expect(html).toContain('t("noPortfolioApps")');
    expect(html).toContain('t("noSourceAgents")');
    expect(html).toContain('t("noFabricAgents")');
    expect(html).toContain('t("failedLoad")');
    expect(html).toContain('data-i18n="portfolioReadOnly"');
  });
});
