import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  processAuditDocumentSchema,
  type CreateProcessAudit,
  type ExpertId,
  type ProcessAuditDocument,
  type ProcessAuditItem,
  type ProcessGateResult,
  type ProcessVerdict,
} from "@atlas/shared";
import { APP_PROFILE_SPECS, detectAppProfile } from "./profiles.js";
import {
  buildProcessMatrix,
  providerStatusesForProfile,
  specialistsForProcess,
} from "./matrix.js";

export interface RunProcessAuditInput {
  readonly request: CreateProcessAudit;
  readonly projectId: string | null;
  readonly workspaceRoot?: string | undefined;
  readonly projectName?: string | undefined;
}

function listShallowFiles(root: string, max = 120): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= max || depth > 3) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (
        name === "node_modules" ||
        name === ".git" ||
        name === "dist" ||
        name === ".next"
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
      if (st.isDirectory()) walk(full, depth + 1);
      else out.push(full.slice(root.length + 1).replace(/\\/g, "/"));
    }
  };
  walk(root, 0);
  return out;
}

function readSnippet(root: string, rel: string, max = 4000): string {
  try {
    return readFileSync(join(root, rel), "utf8").slice(0, max);
  } catch {
    return "";
  }
}

function scanSignals(root: string | undefined): {
  files: string[];
  blob: string;
  hasAuth: boolean;
  hasRbac: boolean;
  hasTenant: boolean;
  hasHitl: boolean;
  hasAi: boolean;
  hasTests: boolean;
  hasE2e: boolean;
  hasAudit: boolean;
  hasA11y: boolean;
} {
  if (!root || !existsSync(root)) {
    return {
      files: [],
      blob: "",
      hasAuth: false,
      hasRbac: false,
      hasTenant: false,
      hasHitl: false,
      hasAi: false,
      hasTests: false,
      hasE2e: false,
      hasAudit: false,
      hasA11y: false,
    };
  }
  const files = listShallowFiles(root);
  const interesting = files
    .filter((f) =>
      /(auth|rbac|role|tenant|middleware|policy|audit|agent|patch|approve|e2e|playwright|a11y|accessibility)/i.test(
        f,
      ),
    )
    .slice(0, 25);
  const blob = interesting
    .map((f) => `${f}\n${readSnippet(root, f)}`)
    .join("\n")
    .toLowerCase();
  const all = `${files.join("\n")}\n${blob}`;
  return {
    files,
    blob: all,
    hasAuth: /auth|login|jwt|session|oauth/.test(all),
    hasRbac: /rbac|role|permission|authorize|acl/.test(all),
    hasTenant: /tenant|orgId|workspaceId|multi.?tenant|rls/.test(all),
    hasHitl: /hitl|human.?approval|approve.*apply|approval.?gate|write.?gate/.test(
      all,
    ),
    hasAi: /openai|anthropic|llm|ai.?gateway|agent|companion/.test(all),
    hasTests: /\.(test|spec)\.(t|j)sx?|\/(tests?|__tests__|e2e)\//i.test(
      files.join("\n"),
    ),
    hasE2e: /playwright|cypress|e2e\//i.test(all),
    hasAudit: /audit.?log|appendDomainEvent|audit_trail|activity.?log/.test(all),
    hasA11y: /aria-|axe|accessibility|a11y/.test(all),
  };
}

function item(partial: Omit<ProcessAuditItem, "id"> & { id?: string }): ProcessAuditItem {
  return {
    id: partial.id ?? crypto.randomUUID(),
    ...partial,
  };
}

function renderMarkdown(doc: {
  projectName: string;
  appProfile: string;
  verdict: ProcessVerdict;
  verdictReason: string;
  gates: ProcessGateResult[];
  items: ProcessAuditItem[];
  specialists: ExpertId[];
  providers: ProcessAuditDocument["providers"];
}): string {
  const defects = doc.items.filter(
    (i) => i.kind === "DEFECT" || i.kind === "BLOCKER",
  );
  const future = doc.items.filter((i) => i.kind === "FUTURE_CHECK");
  const recs = doc.items.filter((i) => i.kind === "RECOMMENDATION");

  const lines: string[] = [
    `# Internal Process Audit — ${doc.projectName}`,
    "",
    `**App profile:** ${doc.appProfile}`,
    `**Verdict:** ${doc.verdict}`,
    `**Reason:** ${doc.verdictReason}`,
    "",
    `**Specialists engaged:** ${doc.specialists.join(", ")}`,
    "",
    "## Gates",
    "",
  ];

  for (const g of doc.gates) {
    lines.push(`### ${g.gateId} — ${g.title} [${g.status}]`);
    lines.push(g.summary);
    if (g.journeys.length) {
      lines.push("");
      lines.push("Journeys:");
      for (const j of g.journeys) lines.push(`- ${j}`);
    }
    lines.push("");
  }

  lines.push("## Defects & blockers", "");
  if (defects.length === 0) {
    lines.push("_No evidence-backed defects in this static/agent pass._");
  } else {
    for (const d of defects) {
      lines.push(
        `- **[${d.severity}] ${d.title}** (${d.dimension}) — ${d.detail}`,
      );
      if (d.recommendedNext) lines.push(`  - Next: ${d.recommendedNext}`);
    }
  }

  lines.push("", "## Future checks (runtime / staging)", "");
  for (const f of future) {
    lines.push(`- **${f.title}** — ${f.detail}`);
  }

  lines.push("", "## Recommendations", "");
  for (const r of recs) {
    lines.push(`- **${r.title}** — ${r.detail}`);
  }

  lines.push("", "## Provider integrations", "");
  for (const p of doc.providers.filter((x) => x.relevant)) {
    lines.push(
      `- **${p.provider}** [${p.adapterStatus}] — ${p.note}`,
    );
  }

  lines.push(
    "",
    "---",
    "_Epistemic note: static/heuristic agent pass ≠ live production proof. Staging E2E with real roles must follow before GO._",
    "",
  );
  return lines.join("\n");
}

/**
 * Process agent: plans per-app journeys, councils specialists, scans workspace
 * signals, and emits a structured GO / CONDITIONAL_GO / NO_GO document.
 */
export function runProcessInternalAudit(
  input: RunProcessAuditInput,
): ProcessAuditDocument {
  const now = new Date().toISOString();
  const signals = scanSignals(input.workspaceRoot);
  const detected = detectAppProfile({
    userRequest: input.request.userRequest,
    fileHints: signals.files,
  });
  const appProfile =
    input.request.appProfile ?? detected.profile;
  const appProfileSource = input.request.appProfile
    ? ("USER" as const)
    : detected.source;
  const spec = APP_PROFILE_SPECS[appProfile];
  const matrix = buildProcessMatrix(appProfile);
  const specialists = specialistsForProcess(
    appProfile,
    input.request.includeUiUx !== false,
  );
  const providers =
    input.request.includeProviders === false
      ? []
      : providerStatusesForProfile(appProfile);

  const items: ProcessAuditItem[] = [];

  if (!input.workspaceRoot) {
    items.push(
      item({
        kind: "BLOCKER",
        gateId: "GATE_4_REAL_E2E_ACTION",
        dimension: "BUSINESS_E2E",
        severity: "CRITICAL",
        title: "No workspace linked for process agent",
        detail:
          "Agent cannot enter application internals without a local workspaceRoot (or staging URL observe).",
        expected: "Linked workspace or staging target",
        actual: "missing",
        specialist: "QA",
        epistemicState: "UNKNOWN",
        evidenceNotes: [],
        recommendedNext: "Link project folder under Projects, then re-run.",
      }),
    );
  }

  // Gate signal heuristics
  if (input.workspaceRoot && !signals.hasAuth) {
    items.push(
      item({
        kind: "DEFECT",
        gateId: "GATE_1_CORRECT_ENTRY",
        dimension: "AUTH_JOURNEY",
        severity: "HIGH",
        title: "Weak auth journey evidence",
        detail:
          "Shallow scan found little auth/login/JWT/session signal for role-correct entry tests.",
        expected: "Auth + role resolution paths",
        actual: "signals weak/absent",
        specialist: "SECURITY",
        epistemicState: "INFERRED",
        evidenceNotes: [`files:${signals.files.length}`],
        recommendedNext: "Add auth E2E for each surface/actor in the app profile.",
      }),
    );
  }

  if (input.workspaceRoot && !signals.hasRbac) {
    items.push(
      item({
        kind: "DEFECT",
        gateId: "GATE_2_AUTHORIZATION",
        dimension: "RBAC",
        severity: "CRITICAL",
        title: "RBAC positive/negative matrix not evidenced",
        detail:
          "Authorization gate requires authorized SUCCESS + unauthorized DENY per action — scan did not find clear RBAC/permission modules.",
        expected: "RBAC enforcement + negative tests",
        actual: "unclear",
        specialist: "SECURITY",
        epistemicState: "INFERRED",
        evidenceNotes: [],
        recommendedNext: "Implement and test deny paths for every privileged API.",
      }),
    );
  }

  if (spec.isolationRequired && input.workspaceRoot && !signals.hasTenant) {
    items.push(
      item({
        kind: "BLOCKER",
        gateId: "GATE_3_TENANT_ISOLATION",
        dimension: "TENANT_ISOLATION",
        severity: "CRITICAL",
        title: "Tenant isolation required but not evidenced",
        detail: `${spec.titleEn} profile requires Tenant A ↛ Tenant B on read/update/export/AI/retrieval.`,
        expected: "Hard isolation + failing cross-tenant tests",
        actual: "tenant signals weak/absent",
        specialist: "SECURITY",
        epistemicState: "INFERRED",
        evidenceNotes: [],
        recommendedNext:
          "Create Tenant A/B fixtures and assert 403/404 on every resource class.",
      }),
    );
  }

  if (spec.aiHitlLikely && input.workspaceRoot && signals.hasAi && !signals.hasHitl) {
    items.push(
      item({
        kind: "DEFECT",
        gateId: "GATE_4_REAL_E2E_ACTION",
        dimension: "AI_HITL",
        severity: "CRITICAL",
        title: "AI surface without clear HITL / write gate",
        detail:
          "AI signals present but approval-gated propose→approve→apply not clearly evidenced.",
        expected: "HITL for destructive/financial actions; single execution",
        actual: "HITL signals weak",
        specialist: "QA",
        epistemicState: "INFERRED",
        evidenceNotes: [],
        recommendedNext: "Wire propose → human approve → execute-once + audit.",
      }),
    );
  }

  if (input.request.includeUiUx !== false) {
    items.push(
      item({
        kind: "FUTURE_CHECK",
        gateId: null,
        dimension: "UI_UX",
        severity: "MEDIUM",
        title: "UI/UX comfort & journey clarity",
        detail:
          "Specialist UI/UX + Visual Design should review speed of task completion, empty states, mobile, brand hierarchy, Photoshop/Figma handoff.",
        expected: "Comfortable critical flows",
        actual: null,
        specialist: "UI_UX",
        epistemicState: "PROPOSED",
        evidenceNotes: [],
        recommendedNext: "Run Experts → UI/UX + Visual Design on key screens.",
      }),
    );
  }

  if (input.request.includePerformance !== false) {
    items.push(
      item({
        kind: "FUTURE_CHECK",
        gateId: null,
        dimension: "PERFORMANCE",
        severity: "MEDIUM",
        title: "Perceived speed on critical journeys",
        detail:
          "Measure TTFB/LCP or API p95 on login, primary mutation, and dashboard load in staging.",
        expected: "Within product SLO",
        actual: null,
        specialist: "DEVOPS",
        epistemicState: "PROPOSED",
        evidenceNotes: [],
        recommendedNext: "Attach Vercel/Netlify/Render observe + Sentry performance.",
      }),
    );
  }

  if (input.workspaceRoot && !signals.hasE2e) {
    items.push(
      item({
        kind: "RECOMMENDATION",
        gateId: "GATE_4_REAL_E2E_ACTION",
        dimension: "BUSINESS_E2E",
        severity: "HIGH",
        title: "Add real E2E process suite",
        detail:
          "Static QA ≠ process proof. Playwright (or equivalent) should encode UI+API+DB+Audit for each actor journey.",
        expected: "E2E suite green in staging",
        actual: "little/no e2e signal",
        specialist: "QA",
        epistemicState: "INFERRED",
        evidenceNotes: [],
        recommendedNext: "Author process matrix cases as automated E2E.",
      }),
    );
  }

  if (input.workspaceRoot && !signals.hasA11y) {
    items.push(
      item({
        kind: "RECOMMENDATION",
        gateId: null,
        dimension: "ACCESSIBILITY",
        severity: "MEDIUM",
        title: "Accessibility checks on critical flows",
        detail: "Little a11y tooling/ARIA evidence in shallow scan.",
        expected: "a11y pass on entry journeys",
        actual: "unclear",
        specialist: "ACCESSIBILITY",
        epistemicState: "INFERRED",
        evidenceNotes: [],
        recommendedNext: "Run Accessibility expert + axe on login and primary task.",
      }),
    );
  }

  // Matrix → future checks so the document lists every required process case
  for (const row of matrix) {
    items.push(
      item({
        kind: "FUTURE_CHECK",
        gateId: row.gateId,
        dimension: row.dimension,
        severity:
          row.expected === "DENY" || row.expected === "HITL_WAIT"
            ? "HIGH"
            : "MEDIUM",
        title: `${row.id}: ${row.actor}`,
        detail: `${row.action} → expected ${row.expected}`,
        expected: row.expected,
        actual: null,
        specialist: row.specialist,
        epistemicState: "PROPOSED",
        evidenceNotes: [`matrix:${row.id}`],
        recommendedNext: "Execute on staging with fixture users; attach evidence.",
      }),
    );
  }

  if (input.workspaceRoot && signals.hasAuth && signals.hasRbac) {
    items.push(
      item({
        kind: "PASS",
        gateId: "GATE_1_CORRECT_ENTRY",
        dimension: "AUTH_JOURNEY",
        severity: "LOW",
        title: "Auth + RBAC signals observed",
        detail: "Workspace shows auth and permission-related code paths.",
        expected: "signals present",
        actual: "observed",
        specialist: "ENGINEERING",
        epistemicState: "OBSERVED",
        evidenceNotes: [`files:${signals.files.length}`],
        recommendedNext: null,
      }),
    );
  }

  const blockers = items.filter((i) => i.kind === "BLOCKER");
  const criticalDefects = items.filter(
    (i) => i.kind === "DEFECT" && i.severity === "CRITICAL",
  );
  let verdict: ProcessVerdict = "GO";
  let verdictReason =
    "No blockers in agent static pass — still require staging E2E evidence before production.";
  if (blockers.length > 0 || criticalDefects.length > 0) {
    verdict = "NO_GO";
    verdictReason = `${blockers.length} blocker(s), ${criticalDefects.length} critical defect(s) — production deep audit not cleared.`;
  } else if (
    items.some((i) => i.kind === "DEFECT" && i.severity === "HIGH") ||
    !signals.hasE2e
  ) {
    verdict = "CONDITIONAL_GO";
    verdictReason =
      "High gaps or missing E2E process proof — fix and re-audit on staging before GO.";
  }

  const gateMeta: Array<{
    gateId: ProcessGateResult["gateId"];
    title: string;
  }> = [
    {
      gateId: "GATE_1_CORRECT_ENTRY",
      title: "Correct system entry per actor",
    },
    {
      gateId: "GATE_2_AUTHORIZATION",
      title: "Authorization positive + negative",
    },
    {
      gateId: "GATE_3_TENANT_ISOLATION",
      title: "Tenant / org isolation",
    },
    {
      gateId: "GATE_4_REAL_E2E_ACTION",
      title: "Real end-to-end action + audit",
    },
  ];

  const gates: ProcessGateResult[] = gateMeta.map((g) => {
    const related = items.filter((i) => i.gateId === g.gateId);
    const hasBlocker = related.some((i) => i.kind === "BLOCKER");
    const hasDefect = related.some((i) => i.kind === "DEFECT");
    const hasPass = related.some((i) => i.kind === "PASS");
    let status: ProcessGateResult["status"] = "NOT_RUN";
    if (hasBlocker) status = "FAIL";
    else if (hasDefect) status = "PARTIAL";
    else if (hasPass) status = "PARTIAL";
    else if (related.length) status = "UNKNOWN";

    const journeys =
      g.gateId === "GATE_1_CORRECT_ENTRY"
        ? spec.journeys.map((j) => `${j.actor}: ${j.steps.join(" → ")}`)
        : [];

    return {
      gateId: g.gateId,
      title: g.title,
      status,
      summary:
        related.length === 0
          ? "No items yet"
          : `${related.length} items · ${related.filter((i) => i.kind === "FUTURE_CHECK").length} future checks`,
      journeys,
      itemIds: related.map((i) => i.id),
    };
  });

  const projectName = input.projectName ?? input.projectId ?? "project";
  const markdownReport = renderMarkdown({
    projectName,
    appProfile,
    verdict,
    verdictReason,
    gates,
    items,
    specialists,
    providers,
  });

  const sections = {
    executiveSummary: `${verdict}: ${verdictReason}`,
    defects: items
      .filter((i) => i.kind === "DEFECT")
      .map((i) => `[${i.severity}] ${i.title}`),
    blockers: items
      .filter((i) => i.kind === "BLOCKER")
      .map((i) => `[${i.severity}] ${i.title}`),
    futureChecks: items
      .filter((i) => i.kind === "FUTURE_CHECK")
      .slice(0, 40)
      .map((i) => i.title),
    recommendations: items
      .filter((i) => i.kind === "RECOMMENDATION")
      .map((i) => i.title),
  };

  return processAuditDocumentSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    appProfile,
    appProfileSource,
    verdict,
    verdictReason,
    gates,
    items,
    specialistsEngaged: specialists,
    providers,
    markdownReport,
    sections,
    createdAt: now,
    completedAt: now,
  });
}
