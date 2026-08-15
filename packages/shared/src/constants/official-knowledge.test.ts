import { describe, expect, it } from "vitest";
import {
  isAuthorizedLegalMediaUrl,
  isAuthorizedOfficialKnowledgeUrl,
  listOfficialRefreshTargets,
} from "./official-knowledge.js";

describe("official knowledge allow-list", () => {
  it("allows NIST and gov.il, rejects blogs", () => {
    expect(
      isAuthorizedOfficialKnowledgeUrl(
        "https://csrc.nist.gov/publications/sp800",
      ),
    ).toBe(true);
    expect(
      isAuthorizedLegalMediaUrl(
        "https://www.gov.il/he/departments/ministry_of_justice",
      ),
    ).toBe(true);
    expect(isAuthorizedOfficialKnowledgeUrl("https://medium.com/foo")).toBe(
      false,
    );
  });

  it("lists government and advisory targets first", () => {
    const targets = listOfficialRefreshTargets();
    expect(targets.length).toBeGreaterThan(20);
    expect(targets.some((t) => t.id.includes("nist"))).toBe(true);
    expect(targets.some((t) => t.family === "legal")).toBe(true);
    expect(targets[0]?.priority).toBe(0);
  });
});
