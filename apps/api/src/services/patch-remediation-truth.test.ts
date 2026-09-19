import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySecretRemediationToProposal,
  parsePatchRemediationTarget,
} from "./patch-remediation-truth.js";

const AWS = "AKIA0000000000000001";

describe("parsePatchRemediationTarget", () => {
  it("links a Sentinel secret finding to path and line", () => {
    const target = parsePatchRemediationTarget({
      findingId: "sentinel:secret:leaked-credential.ts:aws_access_key:1",
      projectId: "1f05f9bd-7e10-4180-9538-cdef5a332a02",
      focusPath: "leaked-credential.ts",
    });
    expect(target?.findingType).toBe("sentinel-secret");
    expect(target?.path).toBe("leaked-credential.ts");
    expect(target?.line).toBe(1);
    expect(target?.findingId).toBe(
      "sentinel:secret:leaked-credential.ts:aws_access_key:1",
    );
  });
});

describe("applySecretRemediationToProposal", () => {
  it("refuses a comment-only secure patch when the secret remains", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-comment-only-"));
    const previous = `export const accessKeyId = '${AWS}';\n`;
    writeFileSync(join(root, "leaked-credential.ts"), previous, "utf8");
    const result = applySecretRemediationToProposal({
      workspaceRoot: root,
      mode: "secure",
      focusPath: "leaked-credential.ts",
      target: parsePatchRemediationTarget({
        findingId: "secret:leaked-credential.ts:aws_access_key:1",
        projectId: null,
        focusPath: "leaked-credential.ts",
      }),
      filesChanged: [
        {
          path: "leaked-credential.ts",
          action: "modify",
          summary: "comment",
          afterContent: `${previous}// ATLAS-PATCH (secure)\n`,
          previousContent: previous,
        },
      ],
    });
    expect(result.unsupported?.result).not.toBe("FIXED");
    if (result.filesChanged.length > 0) {
      const after = result.filesChanged[0]?.afterContent ?? "";
      expect(after).not.toContain(AWS);
      expect(after).not.toMatch(/ATLAS-PATCH \(secure\)/);
    }
    expect(readFileSync(join(root, "leaked-credential.ts"), "utf8")).toBe(previous);
  });
});
