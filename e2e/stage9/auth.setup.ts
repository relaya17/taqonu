import { mkdir } from "node:fs/promises";
import { test as setup, expect } from "@playwright/test";
import { ensureStage9Account, sessionFromPage, writeStage9IdentityFile } from "./accounts";
import {
  STAGE9_AUTH_DIR,
  STAGE9_DECIDER,
  STAGE9_DECIDER_STATE,
  STAGE9_REQUESTER,
  STAGE9_REQUESTER_STATE,
} from "./identities";
import { stage9ApiBase } from "./local-api";

setup("local two-identity Stage 9 sessions", async ({ browser }) => {
  setup.setTimeout(180_000);
  stage9ApiBase();
  await mkdir(STAGE9_AUTH_DIR, { recursive: true });

  const requesterContext = await browser.newContext();
  const deciderContext = await browser.newContext();
  try {
    const requesterAccount = await ensureStage9Account(
      requesterContext.request,
      STAGE9_REQUESTER,
    );
    const deciderAccount = await ensureStage9Account(
      deciderContext.request,
      STAGE9_DECIDER,
    );
    expect(requesterAccount.id).not.toBe(deciderAccount.id);

    const requesterPage = await requesterContext.newPage();
    await requesterPage.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(
      requesterPage.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 60_000 });
    const requesterSession = await sessionFromPage(requesterPage);
    expect(requesterSession.id).toBe(requesterAccount.id);
    await requesterContext.storageState({ path: STAGE9_REQUESTER_STATE });

    const deciderPage = await deciderContext.newPage();
    await deciderPage.goto("/en/studio", { waitUntil: "domcontentloaded" });
    await expect(
      deciderPage.getByRole("heading", { level: 1, name: "Project Studio" }),
    ).toBeVisible({ timeout: 60_000 });
    const deciderSession = await sessionFromPage(deciderPage);
    expect(deciderSession.id).toBe(deciderAccount.id);
    expect(deciderSession.id).not.toBe(requesterSession.id);
    await deciderContext.storageState({ path: STAGE9_DECIDER_STATE });
    await writeStage9IdentityFile({
      requester: requesterSession,
      decider: deciderSession,
    });
  } finally {
    await requesterContext.close();
    await deciderContext.close();
  }
});
