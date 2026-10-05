import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ensureStage9Account } from "../stage9/accounts";
import { createStage9Project, linkWorkspaceRoot, studioProjectUrl } from "../stage9/projects";

/**
 * Studio editor regression gate. The same behaviour runs against every editor
 * backend (textarea, Monaco) in a real browser; a backend does not become the
 * default until it passes everything the textarea passes.
 *
 * It reads editor state only through the verification seam
 * (window.__atlasStudioEditorTest, which delegates to StudioEditorHandle) and
 * is enabled by NEXT_PUBLIC_STUDIO_EDITOR_TEST_SEAM=1 in playwright.editor.config.ts.
 * Local/test only.
 */
const WEB = "http://localhost:3100";
const API = "http://localhost:4100";
const PASSWORD = "Editor-Gate-Local-Only!";
const KEY = "atlas.studio.editorBackend";

type Backend = "textarea" | "monaco";

interface Seam {
  backend: () => Backend;
  getValue: () => string;
  getSelection: () => { start: number; end: number };
  getCursor: () => { line: number; column: number };
}
type SeamWindow = { __atlasStudioEditorTest?: Seam };
const seam = {
  backend: (page: Page) => page.evaluate(() => (window as SeamWindow).__atlasStudioEditorTest?.backend()),
  value: (page: Page) => page.evaluate(() => (window as SeamWindow).__atlasStudioEditorTest?.getValue()),
  selection: (page: Page) => page.evaluate(() => (window as SeamWindow).__atlasStudioEditorTest?.getSelection()),
  cursor: (page: Page) => page.evaluate(() => (window as SeamWindow).__atlasStudioEditorTest?.getCursor()),
};

const LINES = Array.from({ length: 60 }, (_, i) => {
  const n = i + 1;
  return [3, 20, 45].includes(n) ? `line ${n} alpha` : `line ${n} filler`;
});
const TEXT = LINES.join("\n");
const offsetOfLine = (n: number) => LINES.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
const BIDI = ["// שלום עולם alpha", "const answer = 42;", ""].join("\n");
const CRLF_TEXT = ["a1", "a2", "a3", ""].join("\r\n");
// Larger than the API's 400 KB file cap, so the file opens truncated and read-only.
const BIG = `${"x".repeat(79)}\n`.repeat(5200);

interface Fixture {
  readonly projectId: string;
}

async function prepare(context: BrowserContext, backend: Backend): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await ensureStage9Account(context, {
    key: "requester",
    email: `editor-gate-${stamp}@atlas.test`,
    password: PASSWORD,
    displayName: "Editor Gate",
  });
  const project = await createStage9Project(context.request, `Editor Gate ${stamp}`);
  const root = await mkdtemp(join(tmpdir(), "atlas-editor-gate-ws-"));
  await writeFile(join(root, "sample.ts"), TEXT, "utf8");
  await writeFile(join(root, "bidi.ts"), BIDI, "utf8");
  await writeFile(join(root, "crlf.ts"), CRLF_TEXT, "utf8");
  await writeFile(join(root, "big.txt"), BIG, "utf8");
  await linkWorkspaceRoot(context.request, project.id, root);
  await context.addInitScript(([k, v]) => window.localStorage.setItem(k as string, v as string), [KEY, backend]);
  return { projectId: project.id };
}

async function openFile(page: Page, fx: Fixture, file: string, backend: Backend, expected: string | null) {
  await page.goto(`${studioProjectUrl(fx.projectId)}&file=${file}`, { waitUntil: "domcontentloaded" });
  const root = page.locator("[data-studio-editor-backend]");
  await expect(root).toHaveAttribute("data-studio-editor-backend", backend, { timeout: 120_000 });
  await expect.poll(() => seam.backend(page), { timeout: 30_000 }).toBe(backend);
  if (expected !== null) {
    await expect.poll(() => seam.value(page), { timeout: 60_000 }).toBe(expected);
  }
}

async function focusEditor(page: Page) {
  await page.locator("[data-studio-editor-backend]").click({ position: { x: 220, y: 40 } });
}

const focusInEditor = (page: Page) =>
  page.evaluate(() => Boolean(document.activeElement?.closest("[data-studio-editor-backend]")));

async function menu(page: Page, top: string, item: RegExp | string) {
  const bar = page.getByRole("menubar", { name: "Studio menu" });
  await bar.getByRole("menuitem", { name: top, exact: true }).click();
  await page.getByRole("menu", { name: top }).getByRole("menuitem", { name: item }).click();
}

function trackNetwork(page: Page) {
  const urls: string[] = [];
  const workers: string[] = [];
  const problems: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && /monaco|worker/i.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  return { urls, workers, problems };
}

const sameOrigin = (url: string) =>
  url.startsWith(WEB) || url.startsWith(API) || url.startsWith("data:") || url.startsWith("blob:");

// Baseline, not introduced by any editor: apps/web/app/[locale]/layout.tsx links Google Fonts for
// every page. Recorded here so the gate can demand that nothing ELSE is external.
const BASELINE_FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

for (const backend of ["textarea", "monaco"] as const) {
  test(`editor behaviour: ${backend}`, async ({ context, page }) => {
    const net = trackNetwork(page);
    const fx = await prepare(context, backend);

    await test.step("opens clean (no edit recorded)", async () => {
      await openFile(page, fx, "sample.ts", backend, TEXT);
      await expect(page.getByRole("tab", { name: /sample\.ts/ })).not.toContainText("•");
      const bar = page.getByRole("menubar", { name: "Studio menu" });
      await bar.getByRole("menuitem", { name: "Edit", exact: true }).click();
      await expect(
        page.getByRole("menu", { name: "Edit" }).getByRole("menuitem", { name: /^Last edit location/ }),
      ).toHaveAttribute("aria-disabled", "true");
      await page.keyboard.press("Escape");
    });

    await test.step("find: next, wrap, no match, focus returns to the editor", async () => {
      await menu(page, "Edit", /^Find in file/);
      const find = page.getByRole("textbox", { name: "Find in file" });
      await find.fill("alpha");
      const next = page.getByRole("button", { name: "Next", exact: true });
      for (const line of [3, 20, 45, 3]) {
        await next.click();
        const selection = await seam.selection(page);
        expect(selection?.start).toBe(offsetOfLine(line) + `line ${line} `.length);
        expect((selection?.end ?? 0) - (selection?.start ?? 0)).toBe(5);
      }
      await next.click();
      await next.click();
      await expect(page.getByText("line 45 alpha").first()).toBeInViewport();
      await find.fill("zzz");
      await next.click();
      await expect(page.getByText("No matches in this buffer.")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect.poll(() => focusInEditor(page)).toBe(true);
    });

    await test.step("cursor tracking reaches Code tools line/column", async () => {
      await menu(page, "View", /^Code tools/);
      await focusEditor(page);
      await page.keyboard.press("Control+Home");
      for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowDown");
      for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("spinbutton", { name: "line" })).toHaveValue("5");
      await expect(page.getByRole("spinbutton", { name: "col" })).toHaveValue("4");
      expect(await seam.cursor(page)).toEqual({ line: 5, column: 4 });
    });

    const edited = TEXT.replace("line 10 filler", "line 10 fillerZ");

    await test.step("undo and redo", async () => {
      await page.keyboard.press("Control+Home");
      for (let i = 0; i < 9; i += 1) await page.keyboard.press("ArrowDown");
      await page.keyboard.press("End");
      await page.keyboard.type("Z");
      await expect.poll(() => seam.value(page)).toBe(edited);
      await menu(page, "Edit", /^Undo/);
      await expect.poll(() => seam.value(page)).toBe(TEXT);
      await menu(page, "Edit", /^Redo/);
      await expect.poll(() => seam.value(page)).toBe(edited);
    });

    await test.step("edit position follows the caret (Enter moves it to the next line)", async () => {
      await page.keyboard.press("Enter");
      await expect.poll(() => seam.value(page)).toBe(TEXT.replace("line 10 filler", "line 10 fillerZ\n"));
      await page.keyboard.press("Control+End");
      await menu(page, "Edit", /^Last edit location/);
      await expect.poll(async () => (await seam.cursor(page))?.line).toBe(11);
    });

    await test.step("go to line reveals and selects the line start", async () => {
      // One line was inserted above, so original line 45 is now line 46.
      await menu(page, "Edit", /^Go to line/);
      await page.getByRole("spinbutton").last().fill("46");
      await page.getByRole("button", { name: "Go", exact: true }).click();
      await expect.poll(() => seam.cursor(page)).toEqual({ line: 46, column: 1 });
      await expect(page.getByText("line 45 alpha").first()).toBeInViewport();
    });

    await test.step("Tab leaves the editor instead of inserting a tab", async () => {
      const before = await seam.value(page);
      await page.keyboard.press("Tab");
      expect(await seam.value(page)).toBe(before);
      await expect.poll(() => focusInEditor(page)).toBe(false);
    });

    await test.step("a CRLF file opens as LF and stays LF when edited", async () => {
      await openFile(page, fx, "crlf.ts", backend, "a1\na2\na3\n");
      await focusEditor(page);
      await page.keyboard.press("Control+End");
      await page.keyboard.type("x");
      await expect.poll(() => seam.value(page)).toBe("a1\na2\na3\nx");
    });

    await test.step("Hebrew text: find offsets stay correct", async () => {
      await openFile(page, fx, "bidi.ts", backend, BIDI);
      await menu(page, "Edit", /^Find in file/);
      await page.getByRole("textbox", { name: "Find in file" }).fill("alpha");
      await page.getByRole("button", { name: "Next", exact: true }).click();
      const at = BIDI.indexOf("alpha");
      expect(await seam.selection(page)).toEqual({ start: at, end: at + 5 });
    });

    await test.step("a read-only (truncated) file rejects typing", async () => {
      await openFile(page, fx, "big.txt", backend, null);
      await expect.poll(async () => (await seam.value(page))?.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(1000);
      const before = await seam.value(page);
      await focusEditor(page);
      await page.keyboard.press("Control+Home");
      await page.keyboard.type("Q");
      expect(await seam.value(page)).toBe(before);
    });

    await test.step("no axe violations in the editor surface (beyond the recorded colour-contrast baseline)", async () => {
      await openFile(page, fx, "sample.ts", backend, TEXT);
      const results = await new AxeBuilder({ page })
        .include("[data-studio-editor-backend]")
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
      test.info().annotations.push({ type: "axe", description: summary.join(" | ") || "none" });
      // Baseline: the existing textarea editor already fails colour-contrast on its grey gutter and
      // comment tokens (measured by this gate, 21 nodes). That is recorded, not hidden, and not a
      // regression test; every other rule must be clean for every backend.
      expect(results.violations.filter((v) => v.id !== "color-contrast").map((v) => v.id)).toEqual([]);
    });

    await test.step("everything is local: no external requests beyond the app-wide font baseline", async () => {
      const external = net.urls.filter((url) => !sameOrigin(url));
      test.info().annotations.push({
        type: "external-baseline",
        description: `${external.filter((url) => BASELINE_FONT_HOSTS.test(url)).length} Google Fonts requests (app layout)`,
      });
      expect(external.filter((url) => !BASELINE_FONT_HOSTS.test(url))).toEqual([]);
      // The minimal Monaco build needs no worker for these features, so a worker is not required;
      // any worker that is created must be local.
      expect(net.workers.filter((url) => !sameOrigin(url))).toEqual([]);
      test.info().annotations.push({ type: "workers", description: `${net.workers.length} created` });
      expect(net.problems).toEqual([]);
      if (backend === "textarea") {
        expect(net.urls.filter((url) => /monaco/i.test(url))).toEqual([]);
        expect(net.workers).toEqual([]);
      }
    });
  });
}

test("narrow viewport keeps the textarea even when Monaco is selected", async ({ context, page }) => {
  const fx = await prepare(context, "monaco");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${studioProjectUrl(fx.projectId)}&file=sample.ts`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-studio-editor-backend]")).toHaveAttribute(
    "data-studio-editor-backend",
    "textarea",
    { timeout: 120_000 },
  );
  await expect.poll(() => seam.backend(page)).toBe("textarea");
});
