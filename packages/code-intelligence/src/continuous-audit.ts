import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  architectureContractSchema,
  architectureDriftFindingSchema,
  engineeringIssueSchema,
  systemHealthReportSchema,
  type ArchitectureContract,
  type EngineeringIssue,
  type SystemHealthReport,
} from "@atlas/shared";
import { analyzeRepository, readTextFile } from "./analyze.js";
import { runEngineeringConstitution } from "./constitution-runner.js";
import { looksLikeEmbeddedSecret } from "./secret-heuristics.js";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".atlas",
]);

function walk(root: string, limit = 500): string[] {
  const out: string[] = [];
  const rec = (dir: string) => {
    if (out.length >= limit) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) rec(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  if (existsSync(root)) rec(root);
  return out;
}

function remediationFor(
  severity: EngineeringIssue["severity"],
): EngineeringIssue["remediationPolicy"] {
  if (severity === "LOW") return "AUTO_FIX";
  if (severity === "MEDIUM") return "PR_REVIEW";
  if (severity === "HIGH") return "RECOMMENDATION_ONLY";
  return "HUMAN_APPROVAL";
}

function issue(
  partial: {
    category: EngineeringIssue["category"];
    severity: EngineeringIssue["severity"];
    title: string;
    affectedComponents?: string[];
    rootCause: string;
    evidence: EngineeringIssue["evidence"];
    confidence: number;
    recommendedFix: string;
    proposedPatchHint?: string | null;
    testsSuggested?: string[];
    architectureViolation?: boolean;
    constitutionDomain?: string | null;
    omission?: boolean;
    remediationPolicy?: EngineeringIssue["remediationPolicy"];
  },
): EngineeringIssue {
  const severity = partial.severity;
  return engineeringIssueSchema.parse({
    id: crypto.randomUUID(),
    category: partial.category,
    severity,
    title: partial.title,
    affectedComponents: partial.affectedComponents ?? [],
    rootCause: partial.rootCause,
    evidence: partial.evidence,
    confidence: partial.confidence,
    recommendedFix: partial.recommendedFix,
    proposedPatchHint: partial.proposedPatchHint ?? null,
    testsSuggested: partial.testsSuggested ?? [],
    regressionResult: "NOT_RUN",
    approvalStatus: "OPEN",
    remediationPolicy: partial.remediationPolicy ?? remediationFor(severity),
    architectureViolation: partial.architectureViolation ?? false,
    constitutionDomain: partial.constitutionDomain ?? null,
    omission: partial.omission ?? false,
  });
}

/** Default layered architecture contract for SaaS monorepos. */
export function defaultArchitectureContract(
  projectId: string | null,
): ArchitectureContract {
  return architectureContractSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    name: "Default layered SaaS",
    allowedEdges: [
      { from: "FRONTEND", to: "API" },
      { from: "API", to: "SERVICE" },
      { from: "SERVICE", to: "REPOSITORY" },
      { from: "REPOSITORY", to: "DATABASE" },
      { from: "API", to: "INFRA" },
      { from: "SERVICE", to: "INFRA" },
    ],
    forbiddenEdges: [
      { from: "FRONTEND", to: "DATABASE" },
      { from: "FRONTEND", to: "REPOSITORY" },
      { from: "FRONTEND", to: "SERVICE" },
    ],
    createdAt: new Date().toISOString(),
  });
}

function inferLayer(path: string): ArchitectureContract["allowedEdges"][0]["from"] {
  const p = path.toLowerCase();
  if (/(^|\/)(app|apps\/web|frontend|ui|pages|components)\//.test(p) || p.includes("apps/web"))
    return "FRONTEND";
  if (p.includes("apps/api") || /\/routes\//.test(p) || /\/controllers\//.test(p))
    return "API";
  if (/\/services\//.test(p) || /\/domain\//.test(p)) return "SERVICE";
  if (/\/repositories\//.test(p) || /\/repo\//.test(p)) return "REPOSITORY";
  if (/schema\.prisma|migrations\/|supabase\//.test(p) || p.includes("database"))
    return "DATABASE";
  if (/dockerfile|vercel\.json|\.github\/|infra\//.test(p)) return "INFRA";
  return "UNKNOWN";
}

/**
 * Continuous System Audit — Understand → Detect → Remediate (policy).
 * Heuristic + Evidence; not confident hallucination.
 */
export function runContinuousSystemAudit(input: {
  workspaceRoot: string;
  projectId?: string | null;
  projectName?: string;
  contract?: ArchitectureContract;
  intent?: string;
  includeConstitution?: boolean;
}): SystemHealthReport {
  const root = input.workspaceRoot;
  const analysis = analyzeRepository(root);
  const files = walk(root, 600);
  const contract =
    input.contract ?? defaultArchitectureContract(input.projectId ?? null);
  const issues: EngineeringIssue[] = [];
  const driftFindings: SystemHealthReport["driftFindings"] = [];

  // --- Dependency intelligence ---
  const pkgPaths = files.filter((f) => f.endsWith("package.json"));
  let deprecatedHint = 0;
  let lockPresent = files.some(
    (f) => f.endsWith("pnpm-lock.yaml") || f.endsWith("package-lock.json"),
  );
  for (const rel of pkgPaths.slice(0, 40)) {
    const raw = readTextFile(root, rel);
    if (!raw) continue;
    if (/\"request\"\s*:|\"node-uuid\"\s*:|\"left-pad\"\s*:/.test(raw)) {
      deprecatedHint += 1;
      issues.push(
        issue({
          category: "DEPENDENCY",
          severity: "HIGH",
          title: `Possibly unmaintained/legacy dependency pattern in ${rel}`,
          affectedComponents: [rel],
          rootCause: "Manifest lists packages commonly considered legacy/unmaintained",
          evidence: [
            {
              ref: rel,
              note: "package.json pattern match (heuristic)",
              epistemicState: "OBSERVED",
            },
          ],
          confidence: 0.55,
          recommendedFix: "Replace with maintained alternatives; run SCA (pnpm audit) in CI",
          proposedPatchHint: `Update dependencies in ${rel}`,
          testsSuggested: ["CI dependency audit job"],
        }),
      );
    }
    if (/\"\*[\"']|\"latest\"/.test(raw)) {
      issues.push(
        issue({
          category: "VERSIONS",
          severity: "MEDIUM",
          title: `Floating version range in ${rel}`,
          affectedComponents: [rel],
          rootCause: "Non-pinned ranges increase breaking-change risk",
          evidence: [
            {
              ref: rel,
              note: "Found * or latest in package.json",
              epistemicState: "OBSERVED",
            },
          ],
          confidence: 0.7,
          recommendedFix: "Pin semver ranges; regenerate lockfile",
          proposedPatchHint: null,
          testsSuggested: ["Install + typecheck after pin"],
        }),
      );
    }
  }
  if (!lockPresent && pkgPaths.length > 0) {
    issues.push(
      issue({
        category: "DEPENDENCY",
        severity: "HIGH",
        title: "No lockfile detected",
        affectedComponents: ["repository"],
        rootCause: "Missing pnpm-lock.yaml / package-lock.json weakens reproducible builds",
        evidence: [
          {
            ref: "workspace",
            note: "Walked tree; no lockfile in first 600 files",
            epistemicState: "OBSERVED",
          },
        ],
        confidence: 0.8,
        recommendedFix: "Commit lockfile and enforce in CI",
        proposedPatchHint: null,
        testsSuggested: ["CI fail if lockfile missing"],
      }),
    );
  }

  // --- Code / security heuristics ---
  let secretHits = 0;
  let anyHits = 0;
  let todoHits = 0;
  let testFiles = 0;
  let frontendDbTouch = 0;

  for (const rel of files.slice(0, 400)) {
    if (/\.(test|spec)\.(ts|tsx|js)$/i.test(rel) || rel.includes("__tests__")) {
      testFiles += 1;
    }
    if (!/\.(ts|tsx|js|jsx|env|yml|yaml|json)$/i.test(rel)) continue;
    // Test fixtures intentionally contain secret-like samples — skip.
    if (/\.(test|spec)\.(ts|tsx|js)$/i.test(rel) || rel.includes("__tests__")) {
      continue;
    }
    const text = readTextFile(root, rel);
    if (!text || text.length > 200_000) continue;

    if (looksLikeEmbeddedSecret(text)) {
      secretHits += 1;
      issues.push(
        issue({
          category: "SECURITY",
          severity: "CRITICAL",
          title: `Possible secret material in ${rel}`,
          affectedComponents: [rel],
          rootCause: "Hardcoded credential-like pattern",
          evidence: [
            {
              ref: rel,
              note: "Regex secret detector (heuristic)",
              epistemicState: "OBSERVED",
            },
          ],
          confidence: 0.75,
          recommendedFix: "Remove secret; rotate; use env/secret manager",
          proposedPatchHint: `Redact secrets from ${rel}`,
          testsSuggested: ["secrets-clean gate", "gitleaks/trufflehog in CI"],
        }),
      );
    }

    if (/:\s*any\b|as any\b/.test(text) && /\.(ts|tsx)$/.test(rel)) {
      anyHits += 1;
    }
    if (/TODO|FIXME|HACK/.test(text)) todoHits += 1;

    // Architecture drift: frontend importing DB / prisma directly
    const layer = inferLayer(rel);
    if (
      layer === "FRONTEND" &&
      (/from ['\"]@?.*prisma|supabase\.from\(|\.from\(['\"][\w]+['\"]\)|sql`/i.test(
        text,
      ) ||
        /from ['\"].*\/(database|repositories)\//i.test(text))
    ) {
      frontendDbTouch += 1;
      const finding = architectureDriftFindingSchema.parse({
        id: crypto.randomUUID(),
        from: "FRONTEND",
        to: "DATABASE",
        pathHint: rel,
        severity: "CRITICAL",
        evidence: [`${rel}: frontend→database access pattern`],
        epistemicState: "OBSERVED",
      });
      driftFindings.push(finding);
      issues.push(
        issue({
          category: "ARCHITECTURE",
          severity: "CRITICAL",
          title: `Architecture violation: Frontend → Database (${rel})`,
          affectedComponents: [rel],
          rootCause:
            "Layered contract forbids Frontend calling Database directly",
          evidence: [
            {
              ref: rel,
              note: finding.evidence[0]!,
              epistemicState: "OBSERVED",
            },
            {
              ref: `contract:${contract.name}`,
              note: "Forbidden edge FRONTEND→DATABASE",
              epistemicState: "FACT",
            },
          ],
          confidence: 0.8,
          recommendedFix:
            "Route data access via API → Service → Repository → Database",
          proposedPatchHint: `Move DB access out of ${rel} into API/service layer`,
          testsSuggested: ["Architecture boundary lint / import restriction"],
          architectureViolation: true,
          remediationPolicy: "HUMAN_APPROVAL",
        }),
      );
    }
  }

  if (anyHits >= 8) {
    issues.push(
      issue({
        category: "CODE",
        severity: "MEDIUM",
        title: `Elevated TypeScript \`any\` usage (${anyHits} files sampled)`,
        affectedComponents: analysis.packages.slice(0, 5),
        rootCause: "Weak type-safety increases defect probability",
        evidence: [
          {
            ref: "typescript-scan",
            note: `${anyHits} files with any/as any`,
            epistemicState: "OBSERVED",
          },
        ],
        confidence: 0.65,
        recommendedFix: "Replace any with typed contracts (Zod/shared types)",
        proposedPatchHint: null,
        testsSuggested: ["tsc --noEmit", "eslint no-explicit-any"],
      }),
    );
  }

  if (testFiles === 0 && analysis.fileCount > 20) {
    issues.push(
      issue({
        category: "TESTING",
        severity: "HIGH",
        title: "No test files detected in sample walk",
        affectedComponents: ["repository"],
        rootCause: "Changed code may lack regression coverage",
        evidence: [
          {
            ref: "test-walk",
            note: "0 *.test/spec files in walk",
            epistemicState: "OBSERVED",
          },
        ],
        confidence: 0.7,
        recommendedFix: "Add unit/integration tests for critical paths",
        proposedPatchHint: null,
        testsSuggested: ["Generate tests via TEST_ENGINEER agent"],
      }),
    );
  }

  // Engineering Constitution overlay (ADR-020)
  let constitutionBlock: SystemHealthReport["constitution"] = null;
  if (input.includeConstitution !== false) {
    const constitution = runEngineeringConstitution({
      workspaceRoot: root,
      projectId: input.projectId ?? null,
      ...(input.projectName ? { projectName: input.projectName } : {}),
      ...(input.intent ? { intent: input.intent } : {}),
    });
    for (const ci of constitution.issues) {
      if (!issues.some((i) => i.title === ci.title)) {
        issues.push(ci);
      }
    }
    constitutionBlock = {
      overallScore: constitution.overallScore,
      detectedProfiles: constitution.detectedProfiles,
      domainScores: constitution.domainScores.map((d) => ({
        domain: d.domain,
        score: d.score,
        applicable: d.applicable,
        failed: d.failed,
      })),
      omissionCount: constitution.omissions.length,
      failedChecks: constitution.results.filter((r) => r.status === "FAIL")
        .length,
    };
  }

  // Dimension scores (evidence-backed heuristics)
  const crit = issues.filter((i) => i.severity === "CRITICAL").length;
  const high = issues.filter((i) => i.severity === "HIGH").length;
  const medium = issues.filter((i) => i.severity === "MEDIUM").length;
  const low = issues.filter((i) => i.severity === "LOW").length;

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  const architectureScore = clamp(
    100 - driftFindings.length * 25 - frontendDbTouch * 5,
  );
  const securityScore = clamp(100 - secretHits * 30 - (lockPresent ? 0 : 10));
  const dependenciesScore = clamp(
    100 - (lockPresent ? 0 : 25) - deprecatedHint * 15 - medium * 2,
  );
  const codeQualityScore = clamp(100 - Math.min(40, anyHits * 2) - Math.min(20, todoHits));
  const testingScore = clamp(
    testFiles === 0 ? 40 : Math.min(95, 55 + testFiles * 3),
  );
  const performanceScore = clamp(88 - (analysis.fileCount > 70 ? 5 : 0));
  const observabilityScore = files.some((f) =>
    /observability|logger|otel|sentry/i.test(f),
  )
    ? 86
    : 70;

  const dimensions = [
    {
      key: "architecture" as const,
      score: architectureScore,
      epistemicState: "OBSERVED" as const,
      evidenceRefs: driftFindings.map((d) => d.pathHint).slice(0, 5),
      notes:
        driftFindings.length === 0
          ? "No forbidden Frontend→Database edges observed in sample"
          : `${driftFindings.length} architecture drift finding(s)`,
    },
    {
      key: "security" as const,
      score: securityScore,
      epistemicState: "OBSERVED" as const,
      evidenceRefs: issues
        .filter((i) => i.category === "SECURITY")
        .flatMap((i) => i.evidence.map((e) => e.ref))
        .slice(0, 5),
      notes: `${secretHits} secret-pattern hit(s)`,
    },
    {
      key: "dependencies" as const,
      score: dependenciesScore,
      epistemicState: "OBSERVED" as const,
      evidenceRefs: pkgPaths.slice(0, 5),
      notes: lockPresent ? "Lockfile present" : "Lockfile missing",
    },
    {
      key: "codeQuality" as const,
      score: codeQualityScore,
      epistemicState: "INFERRED" as const,
      evidenceRefs: [`anyFiles=${anyHits}`, `todoFiles=${todoHits}`],
      notes: "Type-safety and TODO density heuristics",
    },
    {
      key: "testing" as const,
      score: testingScore,
      epistemicState: "OBSERVED" as const,
      evidenceRefs: [`testFiles=${testFiles}`],
      notes: `${testFiles} test files sampled`,
    },
    {
      key: "performance" as const,
      score: performanceScore,
      epistemicState: "INFERRED" as const,
      evidenceRefs: [`fileSample=${analysis.fileCount}`],
      notes: "Lightweight structural signal only",
    },
    {
      key: "observability" as const,
      score: observabilityScore,
      epistemicState: "INFERRED" as const,
      evidenceRefs: files.filter((f) => /logger|otel|sentry/i.test(f)).slice(0, 3),
      notes: "Presence of logging/observability paths",
    },
  ];

  const overallScore = clamp(
    dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length,
  );

  const architectureDriftScore = architectureScore;

  const summary = [
    `ATLAS SYSTEM HEALTH ${overallScore}/100.`,
    `Critical ${crit} · High ${high} · Medium ${medium} · Low ${low}.`,
    `Architecture drift score ${architectureDriftScore}/100 (${driftFindings.length} violations).`,
    constitutionBlock
      ? `Constitution ${constitutionBlock.overallScore}/100 · omissions ${constitutionBlock.omissionCount}.`
      : "",
    "Scores are evidence-backed heuristics — not AI vibes.",
  ]
    .filter(Boolean)
    .join(" ");

  return systemHealthReportSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? "Repository",
    workspaceRoot: root,
    overallScore,
    dimensions,
    criticalIssues: crit,
    highRisk: high,
    medium,
    low,
    architectureDriftScore,
    issues,
    driftFindings,
    pillars: {
      understand: analysis.graphHint,
      detect: `${issues.length} issues across audit + constitution`,
      remediate:
        "LOW→AUTO_FIX · MEDIUM→PR_REVIEW · HIGH→RECOMMENDATION_ONLY · CRITICAL→HUMAN_APPROVAL",
    },
    constitution: constitutionBlock,
    plainLanguageSummary: summary,
    createdAt: new Date().toISOString(),
    epistemicState: "OBSERVED",
  });
}

export function contentFingerprint(report: SystemHealthReport): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        overall: report.overallScore,
        dims: report.dimensions.map((d) => [d.key, d.score]),
        issues: report.issues.map((i) => i.title),
      }),
    )
    .digest("hex")
    .slice(0, 16);
}
