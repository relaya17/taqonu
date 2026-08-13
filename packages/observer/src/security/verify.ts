/**
 * S1.5 — separate verify engine (not AI self-approval).
 * Re-scan + advisory absence + optional auth security-test markers.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { runSentinelScan, type SentinelScanResult } from "./scan.js";
import { loadSoftwareKnowledgeGraph } from "../graph/build.js";

export interface SentinelVerifyResult {
  readonly findingId: string;
  readonly verified: boolean;
  readonly stillPresent: boolean;
  readonly posture: SentinelScanResult["posture"];
  readonly summary: string;
  readonly scannedAt: string;
  readonly strength: "strong" | "basic" | "failed";
  readonly evidenceRefs: readonly string[];
  readonly claim: "OBSERVED";
  readonly checks: readonly {
    readonly id: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
  readonly note: string;
}

function hasSecurityTestMarker(workspaceRoot: string): boolean {
  const roots = ["tests", "test", "e2e", "src"];
  const files: string[] = [];
  for (const r of roots) {
    const dir = join(workspaceRoot, r);
    if (!existsSync(dir)) continue;
    walk(dir, workspaceRoot, files, 40);
  }
  for (const rel of files) {
    if (!/auth|security|sentinel|permission/i.test(rel)) continue;
    try {
      const text = readFileSync(join(workspaceRoot, rel), "utf8");
      if (
        /unauthenticated|401|403|requireAuth|auth.?guard|sentinel.?verify/i.test(
          text,
        )
      ) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

function walk(dir: string, root: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, root, out, limit);
    else if (/\.(ts|tsx|js|jsx)$/i.test(name)) {
      out.push(relative(root, full).split(sep).join("/"));
      if (out.length >= limit) return;
    }
  }
}

export function verifySentinelFinding(
  workspaceRoot: string,
  findingId: string,
): SentinelVerifyResult {
  const scan = runSentinelScan(workspaceRoot, { persist: true });
  const still = scan.findings.find((f) => f.id === findingId);
  const stillPresent = Boolean(still);

  const checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }> = [
    {
      id: "re-scan-absent",
      passed: !stillPresent,
      detail: stillPresent
        ? "Finding still present on defensive re-scan"
        : "Finding absent on defensive re-scan",
    },
  ];

  const isDep =
    findingId.startsWith("dep:") ||
    findingId.includes("GHSA") ||
    findingId.includes("CVE");
  if (isDep) {
    const depStill = scan.dependencies.some(
      (d) => findingId.includes(d.advisoryId) || findingId.includes(d.id),
    );
    const graph = loadSoftwareKnowledgeGraph(workspaceRoot);
    const advisoryId =
      scan.dependencies.find((d) => findingId.includes(d.advisoryId))
        ?.advisoryId ?? findingId.replace(/^dep:/, "").split(":")[0];
    const incident = graph?.nodes.find(
      (n) => n.type === "INCIDENT" && n.key === advisoryId,
    );
    checks.push({
      id: "advisory-clear",
      passed: !depStill,
      detail: depStill
        ? "Dependency still matches allowlisted advisory"
        : incident
          ? "Scan clear — re-run observe to drop graph INCIDENT"
          : "No advisory match in Sentinel scan",
    });
  }

  if (findingId.startsWith("authz-")) {
    const hasTests = hasSecurityTestMarker(workspaceRoot);
    checks.push({
      id: "authz-security-test-marker",
      passed: hasTests,
      detail: hasTests
        ? "Found auth/security test markers in workspace"
        : "No auth/security regression test markers found (recommended)",
    });
  }

  const hardOk = checks
    .filter((c) => c.id !== "authz-security-test-marker")
    .every((c) => c.passed);
  const soft = checks.find((c) => c.id === "authz-security-test-marker");
  const strict =
    process.env.ATLAS_STRICT_SENTINEL_VERIFY === "1" &&
    findingId.startsWith("authz-");
  const verified = hardOk && (!strict || Boolean(soft?.passed));
  const strength: "strong" | "basic" | "failed" = !verified
    ? "failed"
    : soft?.passed || isDep
      ? "strong"
      : "basic";

  return {
    findingId,
    verified,
    stillPresent,
    posture: scan.posture,
    summary: scan.summary,
    scannedAt: scan.scannedAt,
    strength,
    evidenceRefs: still
      ? [...still.evidenceRefs]
      : [
          `verify:absent:${findingId}`,
          `scan:${scan.scannedAt}`,
          `strength:${strength}`,
          ...checks.map((c) => `${c.id}:${c.passed ? "pass" : "fail"}`),
        ],
    claim: "OBSERVED",
    checks,
    note: verified
      ? strength === "basic"
        ? "Verified by re-scan (basic) — add auth regression tests for strong verify"
        : "Verification passed (separate Sentinel engine — not AI self-check)"
      : "Verification failed — finding still present, advisory matched, or strict auth-test missing",
  };
}
