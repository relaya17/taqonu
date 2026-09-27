import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Run an axe-core scan for WCAG 2.0/2.1 A+AA and WCAG 2.2 AA, and assert
 * there are no violations. Attaches the full JSON report to the test result
 * (pass or fail) so violations are inspectable from the HTML report.
 */
export async function expectNoA11yViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  await testInfo.attach("axe-scan-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  expect(
    results.violations,
    `axe-core found ${results.violations.length} WCAG 2.2 AA violation(s) on ${page.url()}:\n` +
      results.violations
        .map(
          (v) =>
            `- [${v.id}] ${v.help} (impact: ${v.impact}) — ${v.nodes.length} node(s)\n  ${v.helpUrl}`,
        )
        .join("\n"),
  ).toEqual([]);
}
