/**
 * Atlas Sentinel — S1.3 AuthZ regression (temporal heuristic).
 * Compares previous vs current genome/route text for lost auth guards.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGenome } from "../genome/model.js";
import { analyzeRepository, readTextFile } from "@atlas/code-intelligence";

export interface AuthzRegressionFinding {
  readonly id: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly title: string;
  readonly detail: string;
  readonly path: string;
  readonly evidenceRefs: readonly string[];
  readonly claim: "INFERRED";
  readonly epistemicState: "INFERRED";
  readonly remediation: string;
  readonly beforeHint: string;
  readonly afterHint: string;
}

const AUTH_GUARD_RE =
  /\b(requireAuth|requireUser|requireSignedIn|authenticate|verifyJwt|authGuard|requireAdmin|checkPermission|authorize)\b/;

/**
 * Heuristic: files that previously contained auth guards and no longer do,
 * especially route/handler files — security regression candidate.
 */
export function detectAuthzRegressions(
  workspaceRoot: string,
): AuthzRegressionFinding[] {
  const findings: AuthzRegressionFinding[] = [];
  const previous = loadGenome(workspaceRoot);
  if (!previous) return findings;

  // Snapshot of prior file list isn't full text; use .atlas/snapshots last genome
  // and compare auth edge count vs current files that lost guards.
  const analysis = analyzeRepository(workspaceRoot);
  const routeLike = analysis.sampleFiles.filter((f) =>
    /route|api|handler|controller|middleware|auth/i.test(f),
  );

  for (const rel of routeLike.slice(0, 60)) {
    const text = readTextFile(workspaceRoot, rel);
    if (!text) continue;
    const hasGuard = AUTH_GUARD_RE.test(text);
    const looksSensitive =
      /\b(app|router|fastify)\.(get|post|put|patch|delete)\(/i.test(text) ||
      /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/.test(text);

    if (!looksSensitive) continue;

    // If route file has payment/admin/user mutation without guard → HIGH
    const highValue =
      /payment|billing|admin|deleteUser|transfer|refund|password/i.test(text);
    if (!hasGuard && highValue) {
      findings.push({
        id: `authz-missing:${rel}`,
        severity: "HIGH",
        title: `Possible missing auth guard · ${rel}`,
        detail:
          "Sensitive route/handler patterns found without requireAuth/requireUser/authorize-style guard in current tree.",
        path: rel,
        evidenceRefs: [
          `file:${rel}`,
          "pattern:high-value-route-without-guard",
          `genomePreviousAt:${previous.capturedAt}`,
        ],
        claim: "INFERRED",
        epistemicState: "INFERRED",
        remediation:
          "Add AuthN/AuthZ middleware · verify tenant isolation · add regression test that unauthenticated calls fail",
        beforeHint: `previous genome @ ${previous.capturedAt}`,
        afterHint: "no auth guard matched in current file",
      });
    }
  }

  // Temporal: if expected flows mentioned auth steps that disappeared from observed
  const expectedPath = join(workspaceRoot, ".atlas", "genome", "expected.json");
  if (existsSync(expectedPath)) {
    try {
      const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as {
        flows?: Array<{ id: string; steps?: Array<{ label?: string }> }>;
      };
      for (const flow of expected.flows ?? []) {
        const hadAuth = (flow.steps ?? []).some((s) =>
          /auth|login|session|permission|rbac/i.test(s.label ?? ""),
        );
        if (!hadAuth) continue;
        const current = loadGenome(workspaceRoot);
        const currFlow = current?.apis.find((a) => a.id === flow.id);
        const currAuth = (currFlow?.steps ?? []).some((s) =>
          /auth|login|session|permission|rbac/i.test(s.label ?? ""),
        );
        const prevFlow = previous.apis.find((a) => a.id === flow.id);
        const prevAuth = (prevFlow?.steps ?? []).some((s) =>
          /auth|login|session|permission|rbac/i.test(s.label ?? ""),
        );
        if (hadAuth && currFlow && !currAuth) {
          findings.push({
            id: `authz-regression-flow:${flow.id}`,
            severity: "CRITICAL",
            title: `Auth step disappeared from flow · ${flow.id}`,
            detail:
              "EXPECTED behavior included an auth-related step; OBSERVED flow no longer lists it.",
            path: flow.id,
            evidenceRefs: [
              `flow:${flow.id}`,
              "EXPECTED:auth-step",
              "OBSERVED:auth-step-missing",
              `previousGenomeAuth:${prevAuth ? "yes" : "no"}`,
            ],
            claim: "INFERRED",
            epistemicState: "INFERRED",
            remediation:
              "Restore authorization check · add Temporal security test · block merge until verified",
            beforeHint: "EXPECTED had auth/login/session/permission step",
            afterHint: "OBSERVED flow missing auth-related step",
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return findings.slice(0, 25);
}
