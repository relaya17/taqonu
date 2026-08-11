import {
  PROJECT_STATE_SLICES,
  type Decision,
  type EpistemicState,
  type EvidenceRecord,
  type Memory,
  type ProjectStateSliceKey,
} from "@atlas/shared";
import { assertNeverPromotesToFact } from "./epistemic.js";
import type { ConnectorObservation, ReconciliationInput, SliceDraft } from "./input.js";

function isoNow(asOf?: string): string {
  return asOf ?? new Date().toISOString();
}

function evidenceFor(
  evidence: readonly EvidenceRecord[],
  predicate: (item: EvidenceRecord) => boolean,
): EvidenceRecord[] {
  return evidence.filter(predicate);
}

function githubObservation(
  observations: readonly ConnectorObservation[],
): ConnectorObservation | undefined {
  return observations.find((item) => item.connector === "github");
}

function activeDecisions(decisions: readonly Decision[]): Decision[] {
  return decisions.filter((item) => item.status === "ACTIVE");
}

function activeMemories(memories: readonly Memory[]): Memory[] {
  return memories.filter((item) => item.status === "ACTIVE");
}

function unknownSlice(
  key: ProjectStateSliceKey,
  asOf: string,
  summary: string,
): SliceDraft {
  return {
    key,
    summary,
    epistemicState: "UNKNOWN",
    confidence: 0,
    evidenceIds: [],
    claimIds: [],
    asOf,
    validUntil: null,
    stale: true,
  };
}

function buildGitSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const obs = githubObservation(input.observations);
  const gitEvidence = evidenceFor(
    input.evidence,
    (item) =>
      item.sourceType === "GITHUB" ||
      item.sourceType === "COMMIT" ||
      item.sourceType === "PULL_REQUEST",
  );

  if (!obs?.repository) {
    return unknownSlice(
      "GIT",
      asOf,
      "No GitHub repository evidence — connect GitHub and sync.",
    );
  }

  const repo = obs.repository;
  const summary = [
    `Repository ${repo.fullName}`,
    repo.defaultBranch ? `default branch ${repo.defaultBranch}` : null,
    obs.headSha ? `HEAD ${obs.headSha.slice(0, 7)}` : null,
    typeof obs.openPrCount === "number" ? `${obs.openPrCount} open PRs` : null,
    typeof obs.openIssueCount === "number"
      ? `${obs.openIssueCount} open issues`
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const sources: EpistemicState[] = gitEvidence.map((item) => item.epistemicState);
  if (sources.length === 0) {
    sources.push("FACT");
  }

  return {
    key: "GIT",
    summary,
    epistemicState: assertNeverPromotesToFact("FACT", sources),
    confidence: 0.95,
    evidenceIds: gitEvidence.map((item) => item.id),
    claimIds: [],
    asOf: obs.observedAt,
    validUntil: null,
    stale: false,
  };
}

function buildCodeSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const obs = githubObservation(input.observations);
  if (!obs?.repository) {
    return unknownSlice("CODE", asOf, "Code state unknown until repository sync.");
  }

  const fileEvidence = evidenceFor(
    input.evidence,
    (item) => item.sourceType === "REPOSITORY_FILE" || item.sourceType === "COMMIT",
  );

  return {
    key: "CODE",
    summary: obs.headSha
      ? `Code truth anchored at commit ${obs.headSha.slice(0, 7)} on ${obs.repository.fullName}.`
      : `Repository ${obs.repository.fullName} synced; commit tip not yet observed.`,
    epistemicState: obs.headSha ? "FACT" : "INFERRED",
    confidence: obs.headSha ? 0.9 : 0.5,
    evidenceIds: fileEvidence.map((item) => item.id),
    claimIds: [],
    asOf: obs.observedAt,
    validUntil: null,
    stale: !obs.headSha,
  };
}

function buildArchitectureSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const obs = githubObservation(input.observations);
  const docs = obs?.architectureDocPaths ?? [];
  const archMemories = activeMemories(input.memories).filter(
    (item) => item.type === "ARCHITECTURE",
  );
  const archDecisions = activeDecisions(input.decisions);

  if (docs.length === 0 && archMemories.length === 0 && archDecisions.length === 0) {
    return unknownSlice(
      "ARCHITECTURE",
      asOf,
      "No architecture docs, memories, or decisions observed.",
    );
  }

  const parts: string[] = [];
  if (docs.length > 0) {
    parts.push(`Docs: ${docs.join(", ")}`);
  }
  if (archDecisions.length > 0) {
    parts.push(
      `Active decisions: ${archDecisions
        .slice(0, 3)
        .map((item) => item.decision)
        .join("; ")}`,
    );
  }
  if (archMemories.length > 0) {
    parts.push(`${archMemories.length} architecture memories`);
  }

  const hasRepoDocs = docs.length > 0;
  return {
    key: "ARCHITECTURE",
    summary: parts.join(" · "),
    epistemicState: hasRepoDocs ? "FACT" : "CONFIRMED",
    confidence: hasRepoDocs ? 0.85 : 0.7,
    evidenceIds: [],
    claimIds: [],
    asOf,
    validUntil: null,
    stale: false,
  };
}

function buildDependenciesSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const obs = githubObservation(input.observations);
  const manifests = obs?.dependencyManifests ?? [];
  if (manifests.length === 0) {
    return unknownSlice(
      "DEPENDENCIES",
      asOf,
      "No dependency manifests observed in repository sync.",
    );
  }
  return {
    key: "DEPENDENCIES",
    summary: `Manifests: ${manifests.join(", ")}`,
    epistemicState: "FACT",
    confidence: 0.9,
    evidenceIds: [],
    claimIds: [],
    asOf: obs?.observedAt ?? asOf,
    validUntil: null,
    stale: false,
  };
}

function buildTestsSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const obs = githubObservation(input.observations);
  const signals = obs?.testSignals;
  if (!signals) {
    return unknownSlice("TESTS", asOf, "No test signals from GitHub sync.");
  }

  const ci = signals.recentCiStatus ?? "unknown";
  const summary = [
    signals.hasTestDirectory ? "Test directory present" : "No test directory observed",
    `CI: ${ci}`,
    obs?.hasCiConfig ? "CI config present" : "CI config not observed",
  ].join(" · ");

  let epistemicState: EpistemicState = "INFERRED";
  if (ci === "success" || ci === "failure") {
    epistemicState = "FACT";
  } else if (signals.hasTestDirectory) {
    epistemicState = "FACT";
  }

  return {
    key: "TESTS",
    summary,
    epistemicState,
    confidence: ci === "unknown" ? 0.4 : 0.85,
    evidenceIds: [],
    claimIds: [],
    asOf: obs?.observedAt ?? asOf,
    validUntil: null,
    stale: ci === "unknown",
  };
}

function buildSecuritySlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const obs = githubObservation(input.observations);
  const signals = obs?.securitySignals;
  if (!signals) {
    return unknownSlice("SECURITY", asOf, "No security signals from repository.");
  }
  return {
    key: "SECURITY",
    summary: [
      signals.hasDependabot ? "Dependabot present" : "Dependabot not observed",
      signals.hasCodeowners ? "CODEOWNERS present" : "CODEOWNERS not observed",
    ].join(" · "),
    epistemicState: "FACT",
    confidence: 0.8,
    evidenceIds: [],
    claimIds: [],
    asOf: obs?.observedAt ?? asOf,
    validUntil: null,
    stale: false,
  };
}

function buildDecisionsSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const decisions = activeDecisions(input.decisions);
  if (decisions.length === 0) {
    return unknownSlice("DECISIONS", asOf, "No ACTIVE decisions in memory.");
  }

  const supersededConflicts = input.decisions.filter(
    (item) => item.status === "SUPERSEDED",
  );

  return {
    key: "DECISIONS",
    summary: decisions
      .slice(0, 5)
      .map((item) => `[${item.epistemicState}] ${item.decision}`)
      .join(" · "),
    epistemicState: decisions.every((item) => item.epistemicState === "CONFIRMED")
      ? "CONFIRMED"
      : "INFERRED",
    confidence: 0.85,
    evidenceIds: [],
    claimIds: [],
    asOf,
    validUntil: null,
    stale: supersededConflicts.length > 0 && decisions.length === 0,
  };
}

function buildTasksSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const tasks = input.openTasks ?? [];
  const taskMemories = activeMemories(input.memories).filter(
    (item) => item.type === "TASK" || item.type === "GOAL",
  );
  if (tasks.length === 0 && taskMemories.length === 0) {
    return unknownSlice("TASKS", asOf, "No open tasks recorded.");
  }
  const summaryParts = [
    ...tasks.slice(0, 5),
    ...taskMemories.slice(0, 3).map((item) => item.statement),
  ];
  return {
    key: "TASKS",
    summary: summaryParts.join(" · "),
    epistemicState: tasks.length > 0 ? "FACT" : "INFERRED",
    confidence: tasks.length > 0 ? 0.8 : 0.55,
    evidenceIds: [],
    claimIds: [],
    asOf,
    validUntil: null,
    stale: false,
  };
}

function buildRisksSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const risks = input.knownRisks ?? [];
  const bugMemories = activeMemories(input.memories).filter(
    (item) => item.type === "BUG",
  );
  if (risks.length === 0 && bugMemories.length === 0) {
    return {
      key: "RISKS",
      summary: "No explicit risks recorded.",
      epistemicState: "UNKNOWN",
      confidence: 0,
      evidenceIds: [],
      claimIds: [],
      asOf,
      validUntil: null,
      stale: false,
    };
  }
  return {
    key: "RISKS",
    summary: [...risks, ...bugMemories.map((item) => item.statement)]
      .slice(0, 5)
      .join(" · "),
    epistemicState: "INFERRED",
    confidence: 0.6,
    evidenceIds: [],
    claimIds: [],
    asOf,
    validUntil: null,
    stale: false,
  };
}

function buildDatabaseSlice(
  input: ReconciliationInput,
  asOf: string,
): SliceDraft {
  const dbObs = input.observations.filter(
    (item) => item.connector === "supabase" || item.connector === "mongodb",
  );
  if (dbObs.length === 0) {
    return unknownSlice(
      "DATABASE",
      asOf,
      "No database feed observed (Supabase/Mongo connectors). Remains UNKNOWN.",
    );
  }

  const parts = dbObs.map((item) => {
    const db = item.database;
    if (!db) {
      return `${item.connector}: observed`;
    }
    const rls =
      db.provider === "supabase"
        ? db.rlsEnabled === true
          ? "RLS on"
          : db.rlsEnabled === false
            ? "RLS off/unknown"
            : "RLS n/a"
        : "document store";
    return `${db.provider}: ${db.objectCount} objects (${db.objectNames.slice(0, 5).join(", ")}${db.objectNames.length > 5 ? "…" : ""}) · ${rls}`;
  });

  return {
    key: "DATABASE",
    summary: parts.join(" · "),
    epistemicState: "FACT",
    confidence: 0.9,
    evidenceIds: evidenceFor(
      input.evidence,
      (item) =>
        item.sourceType === "CONNECTOR" ||
        item.source.includes("supabase") ||
        item.source.includes("mongodb"),
    ).map((item) => item.id),
    claimIds: [],
    asOf: dbObs[0]?.observedAt ?? asOf,
    validUntil: null,
    stale: false,
  };
}

function buildEmptyConnectorSlice(
  key: ProjectStateSliceKey,
  asOf: string,
  label: string,
): SliceDraft {
  return unknownSlice(
    key,
    asOf,
    `${label} not in active connector set yet. Remains UNKNOWN until a feed exists.`,
  );
}

export function buildAllSlices(input: ReconciliationInput): SliceDraft[] {
  const asOf = isoNow(input.asOf);
  const byKey: Record<ProjectStateSliceKey, SliceDraft> = {
    GIT: buildGitSlice(input, asOf),
    CODE: buildCodeSlice(input, asOf),
    ARCHITECTURE: buildArchitectureSlice(input, asOf),
    DEPENDENCIES: buildDependenciesSlice(input, asOf),
    DATABASE: buildDatabaseSlice(input, asOf),
    ENVIRONMENT: buildEmptyConnectorSlice("ENVIRONMENT", asOf, "Environment metadata"),
    DEPLOYMENT: buildEmptyConnectorSlice("DEPLOYMENT", asOf, "Deployment state"),
    TESTS: buildTestsSlice(input, asOf),
    SECURITY: buildSecuritySlice(input, asOf),
    DECISIONS: buildDecisionsSlice(input, asOf),
    TASKS: buildTasksSlice(input, asOf),
    RISKS: buildRisksSlice(input, asOf),
  };

  return PROJECT_STATE_SLICES.map((key) => byKey[key]);
}
