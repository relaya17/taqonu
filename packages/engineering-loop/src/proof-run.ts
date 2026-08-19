import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  atlasProofReportSchema,
  type AtlasProofReport,
  type ProofGateId,
  type ProofGateResult,
} from "@atlas/shared";
import { runBenchmarkSuite } from "./benchmark-runner.js";
import { summarizeProofMetrics } from "./regression.js";

/** BrokerOS golden tasks A–F (ADR-016 MVP). */
export const GOLDEN_PROOF_GATES: ReadonlyArray<{
  id: ProofGateId;
  taskId: string;
  title: string;
}> = [
  {
    id: "A",
    taskId: "brokeros-A-optimistic-locking",
    title: "Optimistic locking on deal updates",
  },
  {
    id: "B",
    taskId: "brokeros-B-commission-inconsistency",
    title: "Commission calculation inconsistency paths",
  },
  {
    id: "C",
    taskId: "brokeros-C-commission-regression-tests",
    title: "Commission Waterfall regression tests",
  },
  {
    id: "D",
    taskId: "brokeros-D-production-blockers",
    title: "Production-readiness blockers",
  },
  {
    id: "E",
    taskId: "brokeros-E-approved-bugfix",
    title: "Implement one approved bug fix",
  },
  {
    id: "F",
    taskId: "brokeros-F-duplicate-detection-impact",
    title: "Client duplicate-detection impact",
  },
];

export const GOLDEN_TASK_IDS = GOLDEN_PROOF_GATES.map((g) => g.taskId);

export type GoldenWorkspaceSource =
  | "env"
  | "brokeros"
  | "fixture"
  | "explicit";

export interface ResolvedGoldenWorkspace {
  workspaceRoot: string;
  source: GoldenWorkspaceSource;
  exists: boolean;
  slug: string;
}

function findRepoRoot(from = process.cwd()): string {
  const fromEnv = process.env.ATLAS_REPO_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);

  // On Vercel, never walk parents — NFT would include sibling apps (apps/web).
  if (process.env.VERCEL) {
    return from;
  } else {
    let dir = from;
    for (;;) {
      if (
        existsSync(resolve(dir, "pnpm-workspace.yaml")) ||
        existsSync(resolve(dir, "atlas-evals"))
      ) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return from;
  }
}

/** In-repo fixture when BrokerOS path is missing on the machine. */
export function inRepoGoldenFixtureRoot(fromCwd = process.cwd()): string {
  return resolve(findRepoRoot(fromCwd), "fixtures", "golden-brokeros");
}

export function findEvalsRoot(fromCwd = process.cwd()): string {
  const fromEnv = process.env.ATLAS_EVALS_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const repo = findRepoRoot(fromCwd);
  const candidate = resolve(repo, "atlas-evals");
  if (existsSync(candidate)) return candidate;
  return candidate;
}

/**
 * Resolve Golden Project root:
 * explicit → ATLAS_GOLDEN_PROJECT_ROOT → brokerOS-main candidates → in-repo fixture.
 */
export function resolveGoldenWorkspace(opts?: {
  explicitRoot?: string | null;
  envRoot?: string | null;
  slug?: string | null;
  cwd?: string;
}): ResolvedGoldenWorkspace {
  const slug = opts?.slug || process.env.ATLAS_GOLDEN_PROJECT_SLUG || "brokeros";
  const cwd = opts?.cwd ?? process.cwd();

  if (opts?.explicitRoot && opts.explicitRoot.length > 0) {
    const root = resolve(opts.explicitRoot);
    return {
      workspaceRoot: root,
      source: "explicit",
      exists: existsSync(root),
      slug,
    };
  }

  const envRoot = opts?.envRoot ?? process.env.ATLAS_GOLDEN_PROJECT_ROOT ?? null;
  if (envRoot && existsSync(envRoot)) {
    return {
      workspaceRoot: resolve(envRoot),
      source: "env",
      exists: true,
      slug,
    };
  }

  const brokerCandidates = [
    resolve(cwd, "..", "..", "brokerOS-main"),
    resolve(cwd, "..", "brokerOS-main"),
    resolve(findRepoRoot(cwd), "..", "brokerOS-main"),
    "C:\\Users\\User\\Desktop\\game\\brokerOS-main",
  ];
  for (const c of brokerCandidates) {
    if (existsSync(c)) {
      return {
        workspaceRoot: resolve(c),
        source: "brokeros",
        exists: true,
        slug,
      };
    }
  }

  const fixture = inRepoGoldenFixtureRoot(cwd);
  return {
    workspaceRoot: fixture,
    source: "fixture",
    exists: existsSync(fixture),
    slug,
  };
}

function buildEvidenceMarkdown(input: {
  golden: ResolvedGoldenWorkspace;
  gates: ProofGateResult[];
  suiteId: string;
  passRate: number;
  unauthorizedWrites: number;
  metrics: ReturnType<typeof summarizeProofMetrics>;
}): string {
  const lines = [
    `# Atlas 1.1 Proof — Evidence Report`,
    ``,
    `- Golden: \`${input.golden.slug}\` (${input.golden.source})`,
    `- Workspace: \`${input.golden.workspaceRoot}\``,
    `- Suite: \`${input.suiteId}\``,
    `- Pass rate: ${Math.round(input.passRate * 100)}%`,
    `- Unauthorized writes: ${input.unauthorizedWrites}`,
    `- Metrics: truth ${pct(input.metrics.truth)} · eng ${pct(input.metrics.engineeringSuccess)} · qa ${pct(input.metrics.qaAccuracy)} · autonomy ${pct(input.metrics.autonomy)}`,
    ``,
    `## Gates A–F`,
    ``,
  ];
  for (const g of input.gates) {
    lines.push(
      `- **Gate ${g.id}** (${g.taskId}): ${g.status} · evidence=${g.evidenceCount} · ${g.title}`,
    );
    if (g.notes) lines.push(`  - ${g.notes.slice(0, 240)}`);
  }
  lines.push(``, `## Checklist`, ``);
  lines.push(
    `- [ ] Workspace exists`,
    `- [ ] All gates A–F PASS`,
    `- [ ] Unauthorized writes = 0`,
    `- [ ] Suite pass rate acceptable`,
  );
  return lines.join("\n");
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export interface RunAtlasProofInput {
  evalsRoot?: string;
  workspaceRoot?: string | null;
  envRoot?: string | null;
  projectId?: string | null;
  ownerId?: string | null;
  projectSlug?: string | null;
  taskIds?: string[];
  atlasVersion?: string;
  /** Optional Verdict summary attached by API layer. */
  verdictSummary?: AtlasProofReport["verdictSummary"];
  cwd?: string;
}

/** Run Engineering Loop against golden tasks A–F → Verdict-style proof report. */
export function runAtlasProof(input: RunAtlasProofInput = {}): AtlasProofReport {
  const version = input.atlasVersion ?? "1.1.0";
  const golden = resolveGoldenWorkspace({
    explicitRoot: input.workspaceRoot ?? null,
    envRoot: input.envRoot ?? null,
    slug: input.projectSlug ?? null,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  });
  const evalsRoot = input.evalsRoot ?? findEvalsRoot(input.cwd);
  const taskIds = input.taskIds?.length ? input.taskIds : [...GOLDEN_TASK_IDS];

  const suite = runBenchmarkSuite({
    evalsRoot,
    workspaceRoot: golden.workspaceRoot,
    projectId: input.projectId ?? null,
    ownerId: input.ownerId ?? null,
    projectSlug: golden.slug,
    taskIds,
    atlasVersion: version,
  });

  const metrics = summarizeProofMetrics(suite.results);
  const byTask = new Map(suite.results.map((r) => [r.taskId, r]));

  const gates: ProofGateResult[] = GOLDEN_PROOF_GATES.filter((g) =>
    taskIds.includes(g.taskId),
  ).map((g) => {
    const result = byTask.get(g.taskId);
    if (!result) {
      return {
        id: g.id,
        taskId: g.taskId,
        title: g.title,
        status: "ERROR" as const,
        notes: "Task missing from suite results / evals JSON.",
        evidenceCount: 0,
        unauthorizedWrite: false,
      };
    }
    return {
      id: g.id,
      taskId: g.taskId,
      title: g.title,
      status: result.status,
      notes: result.notes,
      evidenceCount: result.evidenceCount,
      unauthorizedWrite: result.unauthorizedWrite,
    };
  });

  const allGatesPass = gates.every((g) => g.status === "PASS");
  const unauthorizedWritesZero = suite.unauthorizedWrites === 0;
  const suitePassRateOk = suite.passRate >= 1 || allGatesPass;
  const checklist = {
    workspaceExists: golden.exists,
    allGatesPass,
    unauthorizedWritesZero,
    suitePassRateOk,
  };

  let status: AtlasProofReport["status"] = "PASS";
  if (!golden.exists || !unauthorizedWritesZero || gates.some((g) => g.status === "ERROR")) {
    status = "FAIL";
  } else if (!allGatesPass) {
    status = "PARTIAL";
  }

  const evidenceReportMarkdown = buildEvidenceMarkdown({
    golden,
    gates,
    suiteId: suite.id,
    passRate: suite.passRate,
    unauthorizedWrites: suite.unauthorizedWrites,
    metrics,
  });

  // Fill checklist marks in markdown based on actual results
  const checkedMd = evidenceReportMarkdown
    .replace(
      "- [ ] Workspace exists",
      checklist.workspaceExists ? "- [x] Workspace exists" : "- [ ] Workspace exists",
    )
    .replace(
      "- [ ] All gates A–F PASS",
      checklist.allGatesPass
        ? "- [x] All gates A–F PASS"
        : "- [ ] All gates A–F PASS",
    )
    .replace(
      "- [ ] Unauthorized writes = 0",
      checklist.unauthorizedWritesZero
        ? "- [x] Unauthorized writes = 0"
        : "- [ ] Unauthorized writes = 0",
    )
    .replace(
      "- [ ] Suite pass rate acceptable",
      checklist.suitePassRateOk
        ? "- [x] Suite pass rate acceptable"
        : "- [ ] Suite pass rate acceptable",
    );

  const plainLanguageSummary = [
    `Atlas Proof 1.1 ${status}`,
    `golden=${golden.slug} (${golden.source})`,
    `gates ${gates.filter((g) => g.status === "PASS").length}/${gates.length} PASS`,
    `passRate=${pct(suite.passRate)}`,
    `unauthorizedWrites=${suite.unauthorizedWrites}`,
    `workspace=${golden.exists ? "OK" : "MISSING"}`,
  ].join(" · ");

  return atlasProofReportSchema.parse({
    id: crypto.randomUUID(),
    atlasVersion: version,
    status,
    golden: {
      slug: golden.slug,
      workspaceRoot: golden.workspaceRoot,
      source: golden.source,
      exists: golden.exists,
    },
    evalsRoot,
    suite,
    gates,
    checklist,
    metrics,
    verdictSummary: input.verdictSummary ?? null,
    evidenceReportMarkdown: checkedMd,
    plainLanguageSummary,
    createdAt: new Date().toISOString(),
    projectId: input.projectId ?? null,
  });
}
