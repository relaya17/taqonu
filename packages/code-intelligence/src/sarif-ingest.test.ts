import { describe, expect, it } from "vitest";
import { parseSarifToFindings, severityFromSarifLevel } from "./sarif-ingest.js";

describe("parseSarifToFindings", () => {
  it("returns empty for empty runs", () => {
    expect(parseSarifToFindings({ runs: [] })).toEqual([]);
  });

  it("maps Semgrep-style results", () => {
    const findings = parseSarifToFindings({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "semgrep" } },
          results: [
            {
              ruleId: "javascript.lang.security.audit.xss",
              level: "error",
              message: { text: "Possible XSS" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/app.ts" },
                    region: { startLine: 42 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.tool).toBe("semgrep");
    expect(findings[0]?.file).toBe("src/app.ts");
    expect(severityFromSarifLevel(findings[0]!.level)).toBe("HIGH");
  });
});
