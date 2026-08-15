import { describe, expect, it } from "vitest";
import { legalSourcesByRegion } from "./legal-media-sources.js";
import {
  isAuthorizedLegalMediaUrl,
  isAuthorizedOfficialKnowledgeUrl,
  listOfficialRefreshTargets,
  officialSourcesAsCorpusSeed,
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
    expect(isAuthorizedLegalMediaUrl("https://www.justice.gov/")).toBe(true);
    expect(
      isAuthorizedLegalMediaUrl(
        "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
      ),
    ).toBe(true);
    expect(isAuthorizedLegalMediaUrl("https://cppa.ca.gov/")).toBe(true);
    expect(isAuthorizedLegalMediaUrl("https://www.copyright.gov/")).toBe(true);
    expect(
      isAuthorizedOfficialKnowledgeUrl("https://react.dev/reference/react"),
    ).toBe(true);
    expect(
      isAuthorizedOfficialKnowledgeUrl(
        "https://www.gov.il/en/departments/israel_national_cyber_directorate",
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

  it("covers IL, US, and EU official legal portals", () => {
    const byRegion = legalSourcesByRegion();
    expect(byRegion.IL).toBeGreaterThanOrEqual(5);
    expect(byRegion.EU).toBeGreaterThanOrEqual(4);
    expect(byRegion.US).toBeGreaterThanOrEqual(4);
  });

  it("seeds official excerpts for agents without textbooks", () => {
    const seed = officialSourcesAsCorpusSeed();
    expect(seed.length).toBeGreaterThan(40);
    expect(seed.every((s) => s.excerpt.includes("Cite ") || s.url.length > 8)).toBe(
      true,
    );
    expect(seed.some((s) => s.id.startsWith("kf_legal_"))).toBe(true);
    expect(seed.some((s) => s.id.includes("eu-ai-act"))).toBe(true);
    expect(seed.some((s) => s.id.includes("us-doj"))).toBe(true);
    expect(seed.some((s) => s.id.includes("react"))).toBe(true);
  });
});
