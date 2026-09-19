import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  FindingPresence,
  FindingRemediationVerdict,
  PatchRemediationTarget,
} from "@atlas/shared";
import {
  findSecretsInText,
  replaceQuotedSecretLiterals,
  type SecretFinding,
} from "./secrets.js";

export type SecretRemediationProposal =
  | { readonly status: "NOT_NEEDED" }
  | { readonly status: "UNSUPPORTED"; readonly reason: string }
  | {
      readonly status: "PROPOSED";
      readonly path: string;
      readonly afterContent: string;
      readonly unifiedDiff: string;
    };

export function proposeSecretLiteralRemoval(
  path: string,
  previous: string,
): SecretRemediationProposal {
  const rel = path.replace(/\\/g, "/");
  const beforeHits = findSecretsInText(rel, previous);
  if (beforeHits.length === 0) return { status: "NOT_NEEDED" };

  const afterContent = replaceQuotedSecretLiterals(previous);
  if (afterContent === previous) {
    return {
      status: "UNSUPPORTED",
      reason:
        "Secret is not a quoted literal the conservative rewriter can remove without inventing a fix.",
    };
  }
  const afterHits = findSecretsInText(rel, afterContent);
  if (afterHits.length > 0) {
    return {
      status: "UNSUPPORTED",
      reason:
        "Rewritten file still matches the Sentinel secret detector. Comment-only or partial edits are not remediation.",
    };
  }

  return {
    status: "PROPOSED",
    path: rel,
    afterContent,
    unifiedDiff: [
      `--- a/${rel}`,
      `+++ b/${rel}`,
      "@@",
      ...afterContent.split("\n").map((line) => `+${line}`),
    ].join("\n"),
  };
}

export function commentOnlySecretChange(
  previous: string,
  afterContent: string,
): boolean {
  const prevHits = findSecretsInText("file.ts", previous);
  const afterHits = findSecretsInText("file.ts", afterContent);
  if (prevHits.length === 0) return false;
  if (afterHits.length === 0) return false;
  return /ATLAS-PATCH/i.test(afterContent);
}

export function secretFindingPresenceInText(
  rel: string,
  text: string,
  target: Pick<PatchRemediationTarget, "findingId" | "path">,
): FindingPresence {
  const hits = findSecretsInText(rel, text);
  if (hits.length === 0) return "ABSENT";
  const sameId = hits.some((hit) => hit.id === target.findingId);
  const samePath =
    target.path &&
    hits.some((hit) => hit.path === target.path || rel === target.path);
  if (sameId || samePath || hits.length > 0) return "STILL_PRESENT";
  return "ABSENT";
}

export function evaluateSecretRemediation(input: {
  readonly workspaceRoot: string;
  readonly target: PatchRemediationTarget;
  readonly executionOk: boolean;
}): FindingRemediationVerdict {
  const rel = (input.target.path ?? "").replace(/\\/g, "/");
  if (!rel || rel.includes("..")) {
    return {
      result: "NOT_FIXED",
      verifyStatus: "FAIL",
      findingPresence: "UNKNOWN",
      findingId: input.target.findingId,
      path: input.target.path,
      summary:
        "Remediation verify FAIL — secret finding has no safe file path to re-scan.",
    };
  }

  const full = join(input.workspaceRoot, rel);
  if (!existsSync(full)) {
    return {
      result: "FIXED",
      verifyStatus: "PASS",
      findingPresence: "ABSENT",
      findingId: input.target.findingId,
      path: rel,
      summary: `Remediation verify PASS — ${rel} is absent; secret finding ${input.target.findingId} is not detectable.`,
    };
  }

  let text: string;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    return {
      result: "NOT_FIXED",
      verifyStatus: "FAIL",
      findingPresence: "UNKNOWN",
      findingId: input.target.findingId,
      path: rel,
      summary: `Remediation verify FAIL — could not read ${rel} to re-run the detector.`,
    };
  }

  const hits: readonly SecretFinding[] = findSecretsInText(rel, text);
  const presence: FindingPresence =
    hits.length > 0 ? "STILL_PRESENT" : "ABSENT";

  if (presence === "STILL_PRESENT") {
    return {
      result: "NOT_FIXED",
      verifyStatus: "FAIL",
      findingPresence: "STILL_PRESENT",
      findingId: input.target.findingId,
      path: rel,
      summary: input.executionOk
        ? `Patch verify PASS · Remediation verify FAIL — finding ${input.target.findingId} STILL_PRESENT in ${rel}. File write is not remediation.`
        : `Remediation verify FAIL — finding ${input.target.findingId} STILL_PRESENT in ${rel}.`,
    };
  }

  return {
    result: "FIXED",
    verifyStatus: "PASS",
    findingPresence: "ABSENT",
    findingId: input.target.findingId,
    path: rel,
    summary: `Remediation verify PASS — Sentinel no longer detects ${input.target.findingId} in ${rel}.`,
  };
}
