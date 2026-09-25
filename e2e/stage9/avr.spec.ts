import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import {
  STAGE9_MARKER_FILE,
  STAGE9_MARKER_ORIGINAL,
  stage9LiveHumanDecide,
  stage9ProposeAndMintApply,
} from "./patch-flow";

test.describe("Stage 9.7 Apply → Verify → Rollback", () => {
  test.setTimeout(180_000);

  test("decider apply writes disk, requester verifies, rollback restores bytes", async ({
    page,
    browser,
  }) => {
    const minted = await stage9ProposeAndMintApply(page, "Stage9 AVR");
    const markerPath = join(minted.root, STAGE9_MARKER_FILE);
    expect(await readFile(markerPath, "utf8")).toBe(STAGE9_MARKER_ORIGINAL);

    const applied = await stage9LiveHumanDecide(browser, page, {
      ...minted,
      action: "apply",
    });
    expect(applied.patch?.status).toBe("APPLIED");
    const afterApply = await readFile(markerPath, "utf8");
    expect(afterApply).not.toBe(STAGE9_MARKER_ORIGINAL);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("APPLIED", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    const verify = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/code/patches/${minted.patchId}/verify`) &&
        res.request().method() === "POST",
      { timeout: 60_000 },
    );
    await expect(page.getByRole("button", { name: /^verify$/i })).toBeEnabled({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: /^verify$/i }).click();
    const verified = await verify;
    expect(verified.ok()).toBeTruthy();
    const verifyBody = (await verified.json()) as {
      patch?: { status?: string };
      verify?: { ok?: boolean };
    };
    expect(verifyBody.verify?.ok).toBe(true);
    expect(verifyBody.patch?.status).toBe("VERIFIED");
    expect(await readFile(markerPath, "utf8")).toBe(afterApply);

    const rollbackMint = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/code/patches/${minted.patchId}/rollback`) &&
        !res.url().includes("decide-and-execute") &&
        res.request().method() === "POST",
      { timeout: 60_000 },
    );
    await expect(page.getByRole("button", { name: /^rollback$/i })).toBeEnabled();
    await page.getByRole("button", { name: /^rollback$/i }).click();
    const rollbackQueued = await rollbackMint;
    expect(rollbackQueued.status()).toBe(202);
    const rollbackBody = (await rollbackQueued.json()) as { approvalId?: string };
    expect(rollbackBody.approvalId).toBeTruthy();

    const rolled = await stage9LiveHumanDecide(browser, page, {
      patchId: minted.patchId,
      approvalId: rollbackBody.approvalId!,
      root: minted.root,
      action: "rollback",
    });
    expect(rolled.patch?.status).toBe("ROLLED_BACK");
    expect(await readFile(markerPath, "utf8")).toBe(STAGE9_MARKER_ORIGINAL);
  });
});
