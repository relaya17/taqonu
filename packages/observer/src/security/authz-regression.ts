/**
 * Atlas Sentinel — S1.3 AuthZ regression (Temporal + baseline inventory).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGenome } from "../genome/model.js";
import { analyzeRepository, readTextFile } from "@atlas/code-intelligence";
import {
  loadAuthzBaseline,
  saveAuthzBaseline,
  type AuthzFileSnapshot,
} from "./persist.js";

export interface AuthzRegressionFinding {
  readonly id: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly title: string;
  readonly detail: string;
  readonly path: string;
  readonly evidenceRefs: readonly string[];
  readonly claim: "INFERRED" | "OBSERVED";
  readonly epistemicState: "INFERRED" | "OBSERVED";
  readonly remediation: string;
  readonly beforeHint: string;
  readonly afterHint: string;
}

const AUTH_GUARD_RE =
  /\b(requireAuth|requireUser|requireSignedIn|authenticate|verifyJwt|authGuard|requireAdmin|checkPermission|authorize)\b/;

function inventoryRouteFiles(
  workspaceRoot: string,
): Record<string, AuthzFileSnapshot> {
  const analysis = analyzeRepository(workspaceRoot);
  const routeLike = analysis.sampleFiles.filter((f) =>
    /route|api|handler|controller|middleware|auth/i.test(f),
  );
  const files: Record<string, AuthzFileSnapshot> = {};
  for (const rel of routeLike.slice(0, 80)) {
    const text = readTextFile(workspaceRoot, rel);
    if (!text) continue;
    const hasGuard = AUTH_GUARD_RE.test(text);
    const sensitiveRoute =
      /\b(app|router|fastify)\.(get|post|put|patch|delete)\(/i.test(text) ||
      /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/.test(text);
    const highValue =
      /payment|billing|admin|deleteUser|transfer|refund|password/i.test(text);
    if (!sensitiveRoute && !highValue && !hasGuard) continue;
    files[rel] = { hasGuard, highValue, sensitiveRoute };
  }
  return files;
}

/**
 * Temporal AuthZ: baseline inventory vs current + EXPECTED flow auth-step loss
 * + high-value routes missing guards.
 */
export function detectAuthzRegressions(
  workspaceRoot: string,
  options?: { readonly persistBaseline?: boolean },
): AuthzRegressionFinding[] {
  const findings: AuthzRegressionFinding[] = [];
  const current = inventoryRouteFiles(workspaceRoot);
  const baseline = loadAuthzBaseline(workspaceRoot);
  const previous = loadGenome(workspaceRoot);

  // Temporal: file previously had guard and no longer does
  if (baseline) {
    for (const [rel, prev] of Object.entries(baseline.files)) {
      const now = current[rel];
      if (!prev.hasGuard) continue;
      if (now?.hasGuard) continue;
      if (!prev.highValue && !prev.sensitiveRoute) continue;
      findings.push({
        id: `authz-lost-guard:${rel}`,
        severity: prev.highValue ? "CRITICAL" : "HIGH",
        title: `Auth guard removed · ${rel}`,
        detail:
          "Temporal AuthZ: prior Sentinel baseline recorded an auth guard; current tree no longer matches requireAuth/authorize-style patterns.",
        path: rel,
        evidenceRefs: [
          `file:${rel}`,
          `baselineAt:${baseline.at}`,
          "before:hasGuard",
          "after:noGuard",
          prev.highValue ? "highValue:yes" : "highValue:no",
        ],
        claim: "OBSERVED",
        epistemicState: "OBSERVED",
        remediation:
          "Restore AuthN/AuthZ middleware · add regression test that unauthenticated calls fail · block merge until verified",
        beforeHint: `baseline ${baseline.at}: hasGuard`,
        afterHint: now
          ? "current file present without guard"
          : "current file missing from sample (deleted or renamed)",
      });
    }
  }

  // Static: high-value sensitive routes without guard
  for (const [rel, snap] of Object.entries(current)) {
    if (!snap.sensitiveRoute || !snap.highValue || snap.hasGuard) continue;
    if (findings.some((f) => f.path === rel)) continue;
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
        ...(previous ? [`genomePreviousAt:${previous.capturedAt}`] : []),
      ],
      claim: "INFERRED",
      epistemicState: "INFERRED",
      remediation:
        "Add AuthN/AuthZ middleware · verify tenant isolation · add regression test that unauthenticated calls fail",
      beforeHint: baseline
        ? `baseline ${baseline.at}`
        : "no prior AuthZ baseline",
      afterHint: "no auth guard matched in current file",
    });
  }

  // EXPECTED flow auth-step disappeared from OBSERVED genome
  const expectedPath = join(workspaceRoot, ".atlas", "genome", "expected.json");
  if (existsSync(expectedPath)) {
    try {
      const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as {
        flows?: Array<{ id: string; steps?: Array<{ label?: string }> }>;
      };
      const genome = loadGenome(workspaceRoot);
      for (const flow of expected.flows ?? []) {
        const hadAuth = (flow.steps ?? []).some((s) =>
          /auth|login|session|permission|rbac/i.test(s.label ?? ""),
        );
        if (!hadAuth) continue;
        const currFlow = genome?.apis.find((a) => a.id === flow.id);
        const currAuth = (currFlow?.steps ?? []).some((s) =>
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

  if (options?.persistBaseline !== false) {
    saveAuthzBaseline(workspaceRoot, {
      at: new Date().toISOString(),
      files: current,
    });
  }

  return findings.slice(0, 25);
}
