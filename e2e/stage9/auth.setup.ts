import { mkdir } from "node:fs/promises";
import { test as setup, expect } from "@playwright/test";
import {
  ensureStage9Account,
  loginViaUi,
  sessionFromPage,
  writeStage9IdentityFile,
} from "./accounts";
import {
  STAGE9_AUTH_DIR,
  STAGE9_DECIDER,
  STAGE9_DECIDER_STATE,
  STAGE9_REQUESTER,
  STAGE9_REQUESTER_STATE,
} from "./identities";
import { stage9ApiBase } from "./local-api";

setup("local two-identity Stage 9 sessions", async ({ page, request }) => {
  setup.setTimeout(240_000);
  stage9ApiBase();
  await mkdir(STAGE9_AUTH_DIR, { recursive: true });

  const requesterAccount = await ensureStage9Account(request, STAGE9_REQUESTER);
  const deciderAccount = await ensureStage9Account(request, STAGE9_DECIDER);

  expect(requesterAccount.id).not.toBe(deciderAccount.id);
  expect(requesterAccount.email.toLowerCase()).toBe(STAGE9_REQUESTER.email);
  expect(deciderAccount.email.toLowerCase()).toBe(STAGE9_DECIDER.email);

  await loginViaUi(page, STAGE9_REQUESTER);
  const requesterSession = await sessionFromPage(page);
  expect(requesterSession.email.toLowerCase()).toBe(STAGE9_REQUESTER.email);
  expect(requesterSession.id).toBe(requesterAccount.id);
  await page.context().storageState({ path: STAGE9_REQUESTER_STATE });

  const browser = page.context().browser();
  if (!browser) {
    throw new Error("Stage 9 fixture: browser handle missing");
  }
  const deciderContext = await browser.newContext();
  const deciderPage = await deciderContext.newPage();
  try {
    await loginViaUi(deciderPage, STAGE9_DECIDER);
    const deciderSession = await sessionFromPage(deciderPage);
    expect(deciderSession.email.toLowerCase()).toBe(STAGE9_DECIDER.email);
    expect(deciderSession.id).toBe(deciderAccount.id);
    expect(deciderSession.id).not.toBe(requesterSession.id);
    await deciderContext.storageState({ path: STAGE9_DECIDER_STATE });
    await writeStage9IdentityFile({
      requester: requesterSession,
      decider: deciderSession,
    });
  } finally {
    await deciderPage.close();
    await deciderContext.close();
  }
});
