import { describe, expect, it } from "vitest";
import { renderOwnerHtml, type OwnerPageData } from "./owner-html.js";

function ownerPage(overrides: Partial<OwnerPageData> = {}) {
  return renderOwnerHtml({
    controlApi: "http://127.0.0.1:3100",
    applications: [],
    agents: [{ agentId: "CODE_ENGINEER", displayName: "Code Engineer", status: "ACTIVE" }],
    portfolioApps: [
      {
        id: "a11c0000-0000-4000-a000-000000000002",
        slug: "vantera",
        name: "Vantera",
        role: "SOURCE",
        sourceCommit: "3313bb52852f04e4e96aa5279f2870e631956418",
        notes: "Sibling source",
      },
    ],
    portfolioSourceAgents: [
      {
        id: "a11c0000-0000-4000-a000-000000000101",
        applicationId: "a11c0000-0000-4000-a000-000000000002",
        sourceKey: "VAN-AG-001",
        displayName: "V-One",
        implementationClass: "IMPLEMENTED",
        verificationStatus: "PARTIALLY_VERIFIED",
        runtimeStatus: { state: "UNKNOWN", probeKind: "NONE", probedAt: null },
        provenance: {
          sourceRepository: "github/vantera",
          sourceCommit: "3313bb52852f04e4e96aa5279f2870e631956418",
        },
      },
    ],
    portfolioCapabilities: [
      {
        id: "a11c0000-0000-4000-a000-000000000201",
        name: "test-capability",
        domain: "test",
        purpose: "Test capability",
        canonicalCapabilityId: null,
      },
    ],
    portfolioEvidence: [],
    portfolioDedup: [],
    portfolioDecisions: [
      {
        id: "a11c0000-0000-4000-a000-000000000301",
        action: "KEEP_SOURCE_SPECIFIC",
        status: "PROPOSED",
        rationale: "Test decision",
      },
    ],
    portfolioConflicts: [],
    portfolioCanonicals: [],
    brief: null,
    selfAudit: null,
    error: null,
    ...overrides,
  });
}

function languageBlock(html: string, lang: string): string {
  const match = html.match(new RegExp(`${lang}: \\{([\\s\\S]*?)\\n      \\}`));
  expect(match?.[1], `missing ${lang} translations`).toBeTruthy();
  return match![1]!;
}

function duplicateKeys(source: string): string[] {
  const counts = new Map<string, number>();
  const re = /(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const key = match[1]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key);
}

describe("admin owner Portfolio projection (Phase 11.2)", () => {
  it("keeps unique localization keys per language", () => {
    const html = ownerPage();
    for (const lang of ["he", "en", "ar"]) {
      expect(duplicateKeys(languageBlock(html, lang))).toEqual([]);
    }
  });

  it("distinguishes Fabric, source applications, and source agents", () => {
    const html = ownerPage();
    expect(html).toContain('data-i18n="planeFabric"');
    expect(html).toContain('data-i18n="planeSourceApps"');
    expect(html).toContain('data-i18n="planeSourceAgents"');
    expect(html).toContain("VAN-AG-001");
    expect(html).toContain("V-One");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain('data-agent-id="CODE_ENGINEER"');
    expect(html).toContain('data-i18n="portfolioNote"');
  });

  it("renders empty portfolio states without inventing records", () => {
    const html = ownerPage({
      portfolioApps: [],
      portfolioSourceAgents: [],
      portfolioCapabilities: [],
      portfolioEvidence: [],
      portfolioDedup: [],
      portfolioDecisions: [],
      portfolioConflicts: [],
      portfolioCanonicals: [],
      error: "Control API unreachable",
    });
    expect(html).toContain("No portfolio snapshot.");
    expect(html).toContain("No source agents.");
    expect(html).toContain("No capabilities.");
    expect(html).toContain("Control API unreachable");
  });

  it("renders capabilities and decisions in Phase 11.9", () => {
    const html = ownerPage();
    expect(html).toContain("test-capability");
    expect(html).toContain("KEEP_SOURCE_SPECIFIC");
    expect(html).toContain("PROPOSED");
    expect(html).toContain("Capabilities (1)");
    expect(html).toContain("Governance Decisions (1)");
  });

  it("renders the public promo without private owner data", () => {
    const html = ownerPage({ promoOnly: true });
    expect(html).toContain("<video autoplay muted loop");
    expect(html).toContain("Atlas Admin");
    expect(html).not.toContain("VAN-AG-001");
    expect(html).not.toContain('data-agent-id="CODE_ENGINEER"');
    expect(html).not.toContain("AtlasDev1!");
  });

  it("includes demo credentials only when explicitly supplied", () => {
    const html = ownerPage({
      promoOnly: true,
      demoEmail: "dev@atlas.local",
      demoPassword: "AtlasDev1!",
    });
    expect(html).toContain("dev@atlas.local");
    expect(html).toContain("AtlasDev1!");
  });
});
