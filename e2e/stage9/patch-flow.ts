import { expect, type Browser, type Page } from "@playwright/test";
import {
  STAGE9_DECIDER_EMAIL,
  STAGE9_DECIDER_STATE,
} from "./identities";
import { stage9ApiBase, stage9MutationHeaders } from "./local-api";
import {
  createMarkerWorkspace,
  createStage9Project,
  linkWorkspaceRoot,
  studioProjectUrl,
} from "./projects";

export const STAGE9_MARKER_FILE = "hello.ts";
export const STAGE9_MARKER_ORIGINAL = "export const greeting = 'hello';\n";

export async function stage9ProposeAndMintApply(
  page: Page,
  titlePrefix: string,
): Promise<{
  root: string;
  patchId: string;
  approvalId: string;
}> {
  const stamp = Date.now();
  const project = await createStage9Project(
    page.context().request,
    `${titlePrefix} ${stamp}`,
  );
  const root = await createMarkerWorkspace({
    fileName: STAGE9_MARKER_FILE,
    contents: STAGE9_MARKER_ORIGINAL,
  });
  await linkWorkspaceRoot(page.context().request, project.id, root);

  await page.goto(studioProjectUrl(project.id), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { level: 1, name: "Project Studio" }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: STAGE9_MARKER_FILE })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: STAGE9_MARKER_FILE }).click();
  await page
    .getByRole("textbox", { name: /what should change/i })
    .fill("hello.ts: change the greeting export comment");

  const ask = page.waitForResponse(
    (res) =>
      res.url().includes("/api/v1/studio/ask-agent") && res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /^ask agent$/i }).click();
  const asked = await ask;
  expect(asked.ok()).toBeTruthy();
  const proposal = (await asked.json()) as { patch?: { id?: string } };
  const patchId = proposal.patch?.id;
  expect(patchId).toBeTruthy();

  await expect(page.getByRole("button", { name: /^approve$/i })).toBeEnabled({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: /^approve$/i }).click();
  await expect(page.getByText("APPROVED", { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });

  const applyResponse = page.waitForResponse(
    (res) =>
      res.url().includes(`/api/v1/code/patches/${patchId}/apply`) &&
      !res.url().includes("decide-and-execute") &&
      res.request().method() === "POST",
    { timeout: 60_000 },
  );
  await expect(page.getByRole("button", { name: /^apply$/i })).toBeEnabled();
  await page.getByRole("button", { name: /^apply$/i }).click();
  const minted = await applyResponse;
  expect(minted.status()).toBe(202);
  const mintedBody = (await minted.json()) as { approvalId?: string };
  expect(mintedBody.approvalId).toBeTruthy();

  return {
    root,
    patchId: patchId!,
    approvalId: mintedBody.approvalId!,
  };
}

export async function stage9LiveHumanDecide(
  browser: Browser,
  page: Page,
  input: {
    patchId: string;
    approvalId: string;
    root: string;
    action: "apply" | "rollback";
  },
): Promise<{ patch?: { status?: string } }> {
  const api = stage9ApiBase(page.url());
  const path = `${api}/api/v1/code/patches/${input.patchId}/${input.action}/decide-and-execute`;
  const headers = stage9MutationHeaders(page.url());
  const payload = {
    approvalId: input.approvalId,
    workspaceRoot: input.root,
  };

  const selfDecide = await page.context().request.post(path, {
    data: {
      ...payload,
      decisionReason: "Stage 9 requester self-decision must be denied",
    },
    headers,
  });
  expect(selfDecide.status()).toBe(403);

  const deciderContext = await browser.newContext({
    storageState: STAGE9_DECIDER_STATE,
  });
  try {
    const deciderMe = await deciderContext.request.get(`${api}/api/v1/auth/me`);
    expect(deciderMe.status()).toBe(200);
    const deciderBody = (await deciderMe.json()) as {
      user: { email: string };
    };
    expect(deciderBody.user.email.toLowerCase()).toBe(STAGE9_DECIDER_EMAIL);

    const decided = await deciderContext.request.post(path, {
      data: {
        ...payload,
        decisionReason: `Stage 9 distinct decider live-human ${input.action}`,
      },
      headers,
    });
    if (decided.status() === 403) {
      throw new Error(
        `Stage 9 decider was forbidden (${decided.status()} ${await decided.text()}). Start the API with ATLAS_OPERATOR_EMAILS=${STAGE9_DECIDER_EMAIL} so the existing operator write bypass applies. Do not change SoD.`,
      );
    }
    expect(decided.ok()).toBeTruthy();
    return (await decided.json()) as { patch?: { status?: string } };
  } finally {
    await deciderContext.close();
  }
}
