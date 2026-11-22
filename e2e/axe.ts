import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Axe samples the colour actually rendered at scan time. A running CSS
 * transition (for example a label changing from its disabled to its enabled
 * colour when data arrives) is sampled mid-way and reports a contrast value
 * that exists in neither stable state. Scanning therefore waits for finite
 * transitions to finish. Infinite animations (skeleton pulse, spinners) are
 * not CSSTransition instances and are not waited for.
 */
async function waitForCssTransitions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Finishing one transition can start another, so re-check a bounded number of times.
    for (let round = 0; round < 5; round += 1) {
      const running = document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition && a.playState === "running");
      if (running.length === 0) return;
      // A transition cancelled by a newer one rejects `finished`; the next round re-checks.
      await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
    }
  });
}

/**
 * Run an axe-core scan for WCAG 2.0/2.1 A+AA and WCAG 2.2 AA, and assert
 * there are no violations. Attaches the full JSON report to the test result
 * (pass or fail) so violations are inspectable from the HTML report.
 */
export async function expectNoA11yViolations(page: Page, testInfo: TestInfo) {
  await waitForCssTransitions(page);
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
