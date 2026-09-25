import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import {
  STAGE9_DECIDER_EMAIL,
  STAGE9_IDENTITY_RECORD,
  STAGE9_REQUESTER_EMAIL,
} from "./identities";
import type { Stage9IdentityFile } from "./identities";
import { stage9LiveHumanDecide, stage9ProposeAndMintApply } from "./patch-flow";

test.describe("Stage 9.6 two-identity SoD", () => {
  test.setTimeout(180_000);

  test("requester cannot self-decide apply; distinct decider can", async ({
    page,
    browser,
  }) => {
    const identities = JSON.parse(
      await readFile(STAGE9_IDENTITY_RECORD, "utf8"),
    ) as Stage9IdentityFile;
    expect(identities.requester.id).not.toBe(identities.decider.id);
    expect(identities.requester.email.toLowerCase()).toBe(STAGE9_REQUESTER_EMAIL);
    expect(identities.decider.email.toLowerCase()).toBe(STAGE9_DECIDER_EMAIL);

    const minted = await stage9ProposeAndMintApply(page, "Stage9 SoD");
    const applied = await stage9LiveHumanDecide(browser, page, {
      ...minted,
      action: "apply",
    });
    expect(applied.patch?.status).toBe("APPLIED");
  });
});
