import { describe, expect, it } from "vitest";
import { renderPlatformHtml } from "./platform-html.js";
import { adminSelfSnapshot, configuredStudioSnapshot } from "./platform-overview.js";
import { platformHierarchyDocument } from "@atlas/shared";

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

describe("Atlas Admin platform HTML", () => {
  it("keeps unique localization keys per language", () => {
    const html = renderPlatformHtml({
      controlOrigin: "http://127.0.0.1:3100",
      studioOrigin: "http://localhost:3000",
      adminOrigin: "http://127.0.0.1:3200",
    });
    for (const lang of ["he", "en", "ar"]) {
      expect(duplicateKeys(languageBlock(html, lang))).toEqual([]);
    }
  });

  it("renders hierarchy supervision, not a Control portfolio mirror", () => {
    const html = renderPlatformHtml({
      controlOrigin: "http://127.0.0.1:3100",
      studioOrigin: "http://localhost:3000",
      adminOrigin: "http://127.0.0.1:3200",
      overview: {
        hierarchy: platformHierarchyDocument(),
        admin: adminSelfSnapshot("http://127.0.0.1:3200"),
        control: {
          surface: "CONTROL",
          parentSurface: "ADMIN",
          role: "operational_supervision",
          runtime: "apps/control-plane",
          origin: "http://127.0.0.1:3100",
          reachability: "REACHABLE",
          health: "healthy",
          generatedAt: "2026-09-02T00:00:00.000Z",
          metrics: { registeredApplications: 1 },
          notes: ["Operational supervision layer. Not Atlas Admin. Not Studio."],
        },
        studio: configuredStudioSnapshot("http://localhost:3000"),
      },
    });
    expect(html).toContain('data-hierarchy="admin-control-studio"');
    expect(html).toContain('data-surface="ADMIN"');
    expect(html).toContain('data-surface="CONTROL"');
    expect(html).toContain('data-surface="STUDIO"');
    expect(html).toContain("/he/studio");
    expect(html).not.toContain("VAN-AG-001");
    expect(html).not.toContain("KEEP_SOURCE_SPECIFIC");
    expect(html).not.toContain('data-agent-id="CODE_ENGINEER"');
    expect(html).not.toContain("Owner Control Plane");
    expect(html).not.toContain("Owner Control Panel");
    expect(html).not.toContain("Owner Admin");
  });

  it("renders the public promo without private supervision metrics", () => {
    const html = renderPlatformHtml({
      controlOrigin: "http://127.0.0.1:3100",
      studioOrigin: "http://localhost:3000",
      adminOrigin: "http://127.0.0.1:3200",
      promoOnly: true,
    });
    expect(html).toContain("<video autoplay muted loop");
    expect(html).toContain("Atlas Admin");
    expect(html).not.toContain('data-hierarchy="admin-control-studio"');
    expect(html).not.toContain("AtlasDev1!");
  });

  it("includes demo credentials only when explicitly supplied", () => {
    const html = renderPlatformHtml({
      controlOrigin: "http://127.0.0.1:3100",
      studioOrigin: "http://localhost:3000",
      adminOrigin: "http://127.0.0.1:3200",
      promoOnly: true,
      demoEmail: "dev@atlas.local",
      demoPassword: "AtlasDev1!",
    });
    expect(html).toContain("dev@atlas.local");
    expect(html).toContain("AtlasDev1!");
  });
});
