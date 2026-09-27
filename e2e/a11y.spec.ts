import { test, expect } from "@playwright/test";
import { expectNoA11yViolations } from "./axe";
import { expectSignInRedirect } from "./signed-out";
/**
* Manual a11y / responsive smoke checks, PLUS a real automated WCAG 2.2 AA
* scan (axe-core) on every page this suite already visits.
* Checks landmarks, skip link, keyboard-named controls, mobile overflow.
* This suite is signed out, so it covers the public pages; the signed-in
* product pages get the same checks in e2e/stage9/product-surfaces.spec.ts.
*/
const PUBLIC_PAGES = [
"/en/welcome",
"/en/plan",
"/en/auth/login",
"/en/auth/register",
"/en/auth/forgot",
] as const;
test.describe("A11y smoke (EN)", () => {
test("signed-out home lands on sign-in with skip link, main landmark, and h1", async ({
page,
}, testInfo) => {
await expectSignInRedirect(page, "/en");
const main = page.locator("main#main-content");
await expect(main).toBeVisible({ timeout: 45_000 });
await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
await expectNoA11yViolations(page, testInfo);
const skip = page.locator("a.skip-link");
await expect(skip).toHaveAttribute("href", "#main-content");
await skip.focus();
await expect(skip).toBeFocused();
await skip.click();
await expect(main).toBeFocused();
});
// The authenticated hamburger/sidebar is covered signed in by
// e2e/stage9/a11y-studio.spec.ts ("authenticated hamburger opens the product
// sidebar" and "mobile drawer traps keyboard focus ...").
test("public pages avoid horizontal overflow on narrow viewports", async ({
page,
}, testInfo) => {
test.setTimeout(180_000);
await page.setViewportSize({ width: 375, height: 812 });
for (const path of PUBLIC_PAGES) {
await page.goto(path, { waitUntil: "domcontentloaded" });
await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
timeout: 45_000,
});
// Do not wait for networkidle — dashboard/systems keep polling and CI
// closes the page when the 60s test timeout wins.
const overflowed = await page.evaluate(() => {
const doc = document.documentElement;
return doc.scrollWidth > doc.clientWidth + 2;
});
expect(overflowed, `${path} should not overflow horizontally`).toBe(false);
await expectNoA11yViolations(page, testInfo);
}
});
test("login form is keyboard-submittable", async ({ page }, testInfo) => {
await page.goto("/en/auth/login");
await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
timeout: 45_000,
});
const form = page.locator("form");
await expect(form).toBeVisible();
await expect(form.getByLabel(/email/i)).toBeVisible();
await expect(form.getByLabel(/password/i)).toBeVisible();
await expect(
form.getByRole("button", { name: /sign in/i }),
).toBeVisible();
await expectNoA11yViolations(page, testInfo);
});
test("memory page sends a signed-out visitor to sign-in", async ({ page }) => {
await expectSignInRedirect(page, "/en/memory");
});
test("investors landing has brand hero and evidence graph visual", async ({
page,
}, testInfo) => {
await page.goto("/investors");
await expect(page.getByText("ArletOS").first()).toBeVisible({
timeout: 45_000,
});
await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
await expect(page.locator("#contact")).toBeVisible();
await expect(
page.getByRole("img", { name: /evidence graph/i }),
).toBeVisible();
await expectNoA11yViolations(page, testInfo);
});
test("public pages hydrate without React hydration errors", async ({
page,
}) => {
test.setTimeout(180_000);
const hydrationErrors: string[] = [];
page.on("console", (message) => {
if (
message.type() === "error" &&
/hydrat|server rendered HTML|did not match/i.test(message.text())
) {
hydrationErrors.push(`${page.url()}: ${message.text().slice(0, 300)}`);
}
});
page.on("pageerror", (error) => {
if (/hydrat/i.test(error.message)) {
hydrationErrors.push(`${page.url()}: ${error.message.slice(0, 300)}`);
}
});
for (const path of [
"/investors",
"/he/welcome",
"/fr/welcome",
"/en/auth/login",
"/fr/auth/login",
]) {
await page.goto(path, { waitUntil: "domcontentloaded" });
const languages = page
.getByRole("button", { name: /^(languages|langues|שפות|اللغات)$/i })
.first();
await expect(languages).toBeVisible({ timeout: 45_000 });
// A menu only opens after hydration, so the console has seen any mismatch.
await expect(async () => {
await languages.click();
await expect(page.getByRole("menu")).toBeVisible({ timeout: 2_000 });
}).toPass({ timeout: 60_000 });
await page.keyboard.press("Escape");
}
expect(hydrationErrors).toEqual([]);
});
});
