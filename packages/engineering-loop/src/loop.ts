import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  analyzeImpact,
  analyzeRepository,
  computeRiskScore,
  proposePatch,
} from "@atlas/code-intelligence";
import { runExpertReview } from "@atlas/experts";
import {
  ENGINEERING_MODE_META,
  engineeringLoopRunSchema,
  type EngineeringAgentMode,
  type EngineeringLoopRun,
  type LoopStageResult,
  type PatchRisk,
} from "@atlas/shared";
import { classifyAction } from "./action-engine.js";

function nowIso(): string {
  return new Date().toISOString();
}

function stage(
  name: LoopStageResult["stage"],
  status: LoopStageResult["status"],
  summary: string,
  epistemicState: LoopStageResult["epistemicState"],
  started: string,
  extra?: Partial<LoopStageResult>,
): LoopStageResult {
  const completed = nowIso();
  return {
    stage: name,
    status,
    summary,
    epistemicState,
    evidenceIds: [],
    artifactRefs: [],
    durationMs: Math.max(0, Date.parse(completed) - Date.parse(started)),
    startedAt: started,
    completedAt: completed,
    ...extra,
  };
}

function grepWorkspace(
  root: string,
  pattern: RegExp,
  maxHits = 12,
): string[] {
  const hits: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (hits.length >= maxHits || depth > 5) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (
        name === "node_modules" ||
        name === ".git" ||
        name === "dist" ||
        name === ".next" ||
        name === "coverage"
      ) {
        continue;
      }
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(ts|tsx|js|md|sql)$/.test(name)) continue;
      if (st.size > 400_000) continue;
      try {
        const text = readFileSync(full, "utf8");
        if (pattern.test(text)) {
          hits.push(full.replace(root, "").replace(/^[\\/]/, "").replace(/\\/g, "/"));
        }
      } catch {
        /* skip */
      }
    }
  };
  walk(root, 0);
  return hits;
}

function runShell(
  cwd: string,
  command: string,
  args: string[],
  timeoutMs: number,
): { ok: boolean; output: string } {
  try {
    const r = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      shell: process.platform === "win32",
    });
    const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.slice(0, 4000);
    return { ok: r.status === 0, output };
  } catch (err) {
    return { ok: false, output: String(err) };
  }
}

function inferMode(request: string, actionMayPatch: boolean): EngineeringAgentMode {
  const t = request.toLowerCase();
  if (/test|regression|בדיק/.test(t)) return "test";
  if (/secur|secret|auth/.test(t)) return "secure";
  if (/refactor/.test(t)) return "refactor";
  if (/fix|bug|defect|תיקון/.test(t)) return "fix";
  if (/implement|add|הוסף/.test(t) && actionMayPatch) return "implement";
  if (/impact|analy|identify|find|blocker|נתח|מצא/.test(t)) return "analyze";
  if (/plan|תכנון/.test(t)) return "plan";
  return actionMayPatch ? "generate" : "analyze";
}

function riskFromMode(mode: EngineeringAgentMode, fileCount: number): PatchRisk {
  if (mode === "secure" || mode === "implement") return "HIGH";
  if (mode === "fix" || mode === "refactor") return "MEDIUM";
  if (fileCount > 5) return "MEDIUM";
  return "LOW";
}

export interface RunLoopInput {
  workspaceRoot: string;
  userRequest: string;
  projectId?: string | null;
  projectSlug?: string | null;
  mode?: EngineeringAgentMode;
  runHeavyChecks?: boolean;
  taskId?: string;
}

/** End-to-end engineering loop — pauses at human approval before Apply. */
export function runEngineeringLoop(input: RunLoopInput): EngineeringLoopRun {
  const root = resolve(input.workspaceRoot);
  const createdAt = nowIso();
  const stages: LoopStageResult[] = [];
  const action = classifyAction(input.userRequest);
  const mode =
    input.mode ??
    inferMode(input.userRequest, action.mayProposePatch);
  let patchId: string | null = null;
  let risk: PatchRisk | null = null;
  let status: EngineeringLoopRun["status"] = "RUNNING";
  let proposedFiles: string[] = [];

  // 1 understand
  let t0 = nowIso();
  if (!existsSync(root)) {
    stages.push(
      stage(
        "understand_repository",
        "FAILED",
        `Workspace not found: ${root}`,
        "FACT",
        t0,
      ),
    );
    return engineeringLoopRunSchema.parse({
      id: crypto.randomUUID(),
      projectId: input.projectId ?? null,
      projectSlug: input.projectSlug ?? null,
      workspaceRoot: root,
      userRequest: input.userRequest,
      actionKind: action.kind,
      mode,
      status: "FAILED",
      stages,
      patchId: null,
      risk: null,
      decisionId: null,
      plainLanguageSummary: `BLOCKED: workspace missing at ${root}`,
      createdAt,
      updatedAt: nowIso(),
      completedAt: nowIso(),
    });
  }
  const analysis = analyzeRepository(root);
  stages.push(
    stage(
      "understand_repository",
      "PASSED",
      `Observed ${analysis.fileCount} files · apps=[${analysis.apps.join(",")}] · packages=[${analysis.packages.join(",")}]`,
      "OBSERVED",
      t0,
      { artifactRefs: ["repo-graph"] },
    ),
  );

  // 2 evidence
  t0 = nowIso();
  const evidenceHits = [
    ...grepWorkspace(root, /expectedUpdatedAt|optimistic/i),
    ...grepWorkspace(root, /commission|waterfall/i),
    ...grepWorkspace(root, /findDuplicateClient|duplicate/i),
    ...grepWorkspace(root, /DEF-0\d+|production.?ready|blocker/i),
  ];
  const uniqueEvidence = [...new Set(evidenceHits)].slice(0, 20);
  stages.push(
    stage(
      "evidence_collection",
      uniqueEvidence.length > 0 ? "PASSED" : "PASSED",
      uniqueEvidence.length > 0
        ? `Collected ${uniqueEvidence.length} path hit(s): ${uniqueEvidence.slice(0, 8).join(", ")}`
        : "No keyword hits — evidence thin (UNVERIFIED against request).",
      uniqueEvidence.length > 0 ? "OBSERVED" : "UNVERIFIED",
      t0,
      { artifactRefs: uniqueEvidence },
    ),
  );

  // 3 impact
  t0 = nowIso();
  const impact = analyzeImpact(root, input.userRequest);
  stages.push(
    stage(
      "impact_analysis",
      "PASSED",
      [
        `Related files: ${impact.matchedFiles.slice(0, 8).join(", ") || "none"}`,
        ...impact.riskNotes,
      ].join(" · "),
      "INFERRED",
      t0,
      { artifactRefs: impact.matchedFiles },
    ),
  );

  // 4 plan
  t0 = nowIso();
  const modeMeta = ENGINEERING_MODE_META[mode];
  const planLines = [
    `Action kind: ${action.kind} (${Math.round(action.confidence * 100)}%) — ${action.rationale}`,
    `Engineering mode: ${modeMeta.titleEn}`,
    action.mayProposePatch
      ? "Will propose Patch (approval-gated WRITE)."
      : "No Patch expected — investigation / human / infra action.",
    `Checks: unit/integration/typecheck/lint ${input.runHeavyChecks ? "ENABLED" : "SKIPPED (set runHeavyChecks)"}`,
  ];
  stages.push(
    stage(
      "implementation_plan",
      "PASSED",
      planLines.join(" "),
      "INFERRED",
      t0,
    ),
  );

  // 5–6 code gen + patch (only if mayProposePatch and mode proposes)
  t0 = nowIso();
  let proposalSummary = "Skipped — action kind does not propose code.";
  let proposalEval = "";
  if (action.mayProposePatch && modeMeta.proposesPatch) {
    const proposal = proposePatch({
      workspaceRoot: root,
      mode,
      userRequest: input.userRequest,
    });
    proposedFiles = proposal.filesChanged.map((f) => f.path);
    risk = proposal.risk;
    proposalSummary = `${proposal.title} · ${proposal.filesChanged.length} file(s) · risk ${proposal.risk}`;
    proposalEval = proposal.evaluationSummary;
    stages.push(
      stage("code_generation", "PASSED", proposalSummary, "PROPOSED", t0, {
        artifactRefs: proposedFiles,
      }),
    );
    t0 = nowIso();
    // patch id assigned by API store — placeholder uuid for loop package
    patchId = crypto.randomUUID();
    stages.push(
      stage(
        "patch_proposal",
        proposal.filesChanged.length > 0 ? "PASSED" : "SKIPPED",
        proposal.filesChanged.length > 0
          ? `Patch artifact ready (id pending store): ${proposedFiles.join(", ")}`
          : "No file changes proposed.",
        "PROPOSED",
        t0,
        { artifactRefs: proposedFiles },
      ),
    );
  } else {
    stages.push(
      stage("code_generation", "SKIPPED", proposalSummary, "INFERRED", t0),
    );
    t0 = nowIso();
    stages.push(
      stage(
        "patch_proposal",
        "SKIPPED",
        "No patch — correct action may be HUMAN / INFRA / investigate.",
        "INFERRED",
        t0,
      ),
    );
    risk = riskFromMode(mode, impact.matchedFiles.length);
  }

  // 7–10 checks
  const heavy = input.runHeavyChecks === true;
  const check = (
    stageName: LoopStageResult["stage"],
    label: string,
    cmd: string | null,
    args: string[],
  ) => {
    const started = nowIso();
    if (!heavy || !cmd) {
      stages.push(
        stage(
          stageName,
          "SKIPPED",
          `${label} skipped (runHeavyChecks=false or unavailable).`,
          "UNKNOWN",
          started,
        ),
      );
      return;
    }
    const result = runShell(root, cmd, args, 120_000);
    stages.push(
      stage(
        stageName,
        result.ok ? "PASSED" : "FAILED",
        result.ok
          ? `${label} passed.`
          : `${label} failed: ${result.output.slice(0, 500)}`,
        result.ok ? "OBSERVED" : "CONTRADICTED",
        started,
      ),
    );
  };

  check("unit_tests", "Unit tests", null, []);
  check("integration_tests", "Integration tests", null, []);
  check("typecheck", "Typecheck", heavy ? "pnpm" : null, ["typecheck"]);
  check("lint", "Lint", heavy ? "pnpm" : null, ["lint"]);

  // 11 security
  t0 = nowIso();
  const secretHits = grepWorkspace(root, /(sk_live|ghp_[A-Za-z0-9]|BEGIN PRIVATE KEY)/);
  stages.push(
    stage(
      "security_checks",
      secretHits.length === 0 ? "PASSED" : "FAILED",
      secretHits.length === 0
        ? "No obvious live secret patterns in sampled files."
        : `Possible secrets in: ${secretHits.join(", ")}`,
      secretHits.length === 0 ? "OBSERVED" : "CONTRADICTED",
      t0,
      { artifactRefs: secretHits },
    ),
  );

  // 12 experts
  t0 = nowIso();
  const expertIds = ["ENGINEERING", "QA", "SECURITY"] as const;
  const expertReviews = expertIds.map((expertId) =>
    runExpertReview({
      expertId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      userRequest: input.userRequest,
    }),
  );
  const allFindings = expertReviews.flatMap((r) => r.findings);
  const failCount = allFindings.filter((f) => f.status === "FAIL").length;
  stages.push(
    stage(
      "expert_council",
      failCount > 0 ? "FAILED" : "PASSED",
      `Experts ${expertIds.join(",")}: ${allFindings.length} findings · ${failCount} FAIL`,
      "INFERRED",
      t0,
    ),
  );

  // 13 risk
  t0 = nowIso();
  const riskScore = computeRiskScore({
    impact: risk === "CRITICAL" ? 5 : risk === "HIGH" ? 4 : risk === "MEDIUM" ? 3 : 2,
    probability: 3,
    changeSurface: Math.min(5, Math.max(1, proposedFiles.length || impact.matchedFiles.length || 1)),
    uncertainty: uniqueEvidence.length > 0 ? 2 : 4,
    missingEvidence: uniqueEvidence.length > 0 ? 1 : 4,
  });
  stages.push(
    stage(
      "risk_evaluation",
      "PASSED",
      `Risk band ${riskScore.band} (score ${riskScore.score}) ${riskScore.bar} · patchRisk=${risk ?? "n/a"}`,
      "INFERRED",
      t0,
    ),
  );

  // 14 await approval (always pause before apply)
  t0 = nowIso();
  const needsApply = Boolean(patchId && proposedFiles.length > 0);
  if (secretHits.length > 0 || stages.some((s) => s.stage === "expert_council" && s.status === "FAILED")) {
    status = "BLOCKED";
    stages.push(
      stage(
        "awaiting_human_approval",
        "BLOCKED",
        "Blocked before approval — security or expert FAIL.",
        "CONTRADICTED",
        t0,
      ),
    );
  } else if (needsApply) {
    status = "AWAITING_APPROVAL";
    stages.push(
      stage(
        "awaiting_human_approval",
        "AWAITING_APPROVAL",
        "Human APPROVE required before Apply (ADR-015). Remaining stages run after approval.",
        "PROPOSED",
        t0,
      ),
    );
  } else {
    status = "PASSED";
    stages.push(
      stage(
        "awaiting_human_approval",
        "SKIPPED",
        "No applyable Patch — loop complete after investigate/risk.",
        "OBSERVED",
        t0,
      ),
    );
    // finish remaining as skipped/pass for investigate path
    for (const s of ["apply", "regression", "evidence_update", "decision_log"] as const) {
      const started = nowIso();
      if (s === "evidence_update" || s === "decision_log") {
        stages.push(
          stage(
            s,
            "PASSED",
            s === "decision_log"
              ? "Decision: investigation recorded — no WRITE."
              : "Evidence trail attached to loop run (API persists).",
            "INFERRED",
            started,
          ),
        );
      } else {
        stages.push(stage(s, "SKIPPED", "N/A without Patch apply.", "INFERRED", started));
      }
    }
  }

  const failed = stages.some(
    (s) =>
      s.status === "FAILED" &&
      s.stage !== "expert_council" &&
      s.stage !== "security_checks",
  );
  if (failed && (status === "PASSED" || status === "AWAITING_APPROVAL")) {
    /* keep awaiting if patch pending unless hard fail */
  }
  if (failed && status !== "AWAITING_APPROVAL" && status !== "BLOCKED") {
    status = "FAILED";
  }
  if (
    stages.some((s) => s.stage === "security_checks" && s.status === "FAILED")
  ) {
    status = "BLOCKED";
  }

  const summary = [
    `Action=${action.kind}`,
    `Mode=${mode}`,
    `Status=${status}`,
    `Risk=${riskScore.band}`,
    `Evidence hits=${uniqueEvidence.length}`,
    `Patch files=${proposedFiles.length}`,
    proposalEval ? `Eval: ${proposalEval.slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return engineeringLoopRunSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId ?? null,
    projectSlug: input.projectSlug ?? null,
    workspaceRoot: root,
    userRequest: input.userRequest,
    actionKind: action.kind,
    mode,
    status,
    stages,
    patchId: needsApply ? patchId : null,
    risk,
    decisionId: null,
    plainLanguageSummary: summary,
    createdAt,
    updatedAt: nowIso(),
    completedAt: status === "AWAITING_APPROVAL" ? null : nowIso(),
    // stash proposal for API via artifact — API will re-propose when storing patch
  });
}

export interface LoopProposalHint {
  files: string[];
  mode: EngineeringAgentMode;
  request: string;
  root: string;
}

/** Re-run proposePatch for API persistence (same inputs as loop). */
export function proposeForLoop(input: {
  workspaceRoot: string;
  userRequest: string;
  mode: EngineeringAgentMode;
}) {
  return proposePatch({
    workspaceRoot: input.workspaceRoot,
    mode: input.mode,
    userRequest: input.userRequest,
  });
}
