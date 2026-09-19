import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commentOnlySecretChange,
  evaluateSecretRemediation,
  proposeSecretLiteralRemoval,
} from "./secret-remediation.js";
import { findSecretsInText } from "./secrets.js";

const AWS = "AKIA0000000000000001";

describe("secret remediation", () => {
  it("replaces a quoted AWS key so the detector is silent", () => {
    const previous = `export const accessKeyId = '${AWS}';\n`;
    const proposed = proposeSecretLiteralRemoval("leaked-credential.ts", previous);
    expect(proposed.status).toBe("PROPOSED");
    if (proposed.status !== "PROPOSED") return;
    expect(proposed.afterContent).not.toContain(AWS);
    expect(proposed.afterContent).not.toMatch(/ATLAS-PATCH/);
    expect(findSecretsInText("leaked-credential.ts", proposed.afterContent)).toEqual([]);
  });

  it("refuses comment-only changes as remediation", () => {
    const previous = `export const accessKeyId = '${AWS}';\n`;
    const after = `${previous}// ATLAS-PATCH (secure): pretend this is fixed\n`;
    expect(commentOnlySecretChange(previous, after)).toBe(true);
    const proposed = proposeSecretLiteralRemoval(
      "leaked-credential.ts",
      after,
    );
    expect(proposed.status === "PROPOSED" || proposed.status === "UNSUPPORTED").toBe(
      true,
    );
    if (proposed.status === "PROPOSED") {
      expect(findSecretsInText("leaked-credential.ts", proposed.afterContent)).toEqual(
        [],
      );
    }
  });

  it("reports NOT_FIXED when the secret remains after a successful write", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-secret-still-"));
    writeFileSync(
      join(root, "leaked-credential.ts"),
      `export const accessKeyId = '${AWS}';\n// ATLAS-PATCH (secure)\n`,
      "utf8",
    );
    const verdict = evaluateSecretRemediation({
      workspaceRoot: root,
      executionOk: true,
      target: {
        findingId: `sentinel:secret:leaked-credential.ts:aws_access_key:1`,
        projectId: null,
        findingType: "sentinel-secret",
        detector: "aws_access_key",
        path: "leaked-credential.ts",
        line: 1,
        originalRiskBand: "CRITICAL",
      },
    });
    expect(verdict.result).toBe("NOT_FIXED");
    expect(verdict.verifyStatus).toBe("FAIL");
    expect(verdict.findingPresence).toBe("STILL_PRESENT");
  });

  it("reports FIXED only when the detector no longer matches", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-secret-gone-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "leaked-credential.ts"),
      `export const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "";\n`,
      "utf8",
    );
    expect(readFileSync(join(root, "leaked-credential.ts"), "utf8")).not.toContain(AWS);
    const verdict = evaluateSecretRemediation({
      workspaceRoot: root,
      executionOk: true,
      target: {
        findingId: `sentinel:secret:leaked-credential.ts:aws_access_key:1`,
        projectId: null,
        findingType: "sentinel-secret",
        detector: "aws_access_key",
        path: "leaked-credential.ts",
        line: 1,
        originalRiskBand: "CRITICAL",
      },
    });
    expect(verdict.result).toBe("FIXED");
    expect(verdict.verifyStatus).toBe("PASS");
    expect(verdict.findingPresence).toBe("ABSENT");
  });
});
