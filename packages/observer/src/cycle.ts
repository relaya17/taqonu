import {
  observeCycleResultSchema,
  type GenomeFlow,
  type ObserveCycleResult,
  type ObserverFinding,
} from "@atlas/shared";
import { atlasObserverPaths } from "./paths.js";
import {
  buildProjectGenome,
  loadGenome,
  saveGenome,
  saveGenomeSnapshot,
} from "./genome/model.js";
import { compareGenomes } from "./temporal/compare.js";
import { ingestBugs, loadBugs, type BugIngestInput } from "./bugs/ingest.js";
import {
  buildSoftwareKnowledgeGraph,
  saveSoftwareKnowledgeGraph,
} from "./graph/build.js";
import {
  ensureExpectedBaseline,
  promoteObservedToExpected,
  verifyAgainstExpected,
} from "./behavior/expected.js";
import { impactBoostForFlow, scoreRiskWithGraph } from "./risk/graph-aware.js";
import { bumpTruthCounters, loadTruthCounters } from "./metrics/counters.js";
import { appendCycleHistory, listCycleHistory } from "./history/cycles.js";

function claimToEpistemic(
  claim: ObserverFinding["claim"],
): ObserverFinding["epistemicState"] {
  switch (claim) {
    case "VERIFIED":
      return "VERIFIED";
    case "OBSERVED":
      return "OBSERVED";
    case "INFERRED":
      return "INFERRED";
    case "SUSPECTED":
      return "ASSUMED";
    default:
      return "UNKNOWN";
  }
}

export function runObserveCycle(input: {
  workspaceRoot: string;
  projectId?: string | null;
  projectSlug?: string | null;
  flows?: readonly GenomeFlow[];
  bugs?: readonly BugIngestInput[];
  persist?: boolean;
  trigger?: string;
  promoteExpected?: boolean;
}): ObserveCycleResult {
  const startedAt = new Date().toISOString();
  const persist = input.persist !== false;
  const trigger = input.trigger ?? "manual";
  const previous = loadGenome(input.workspaceRoot);

  const genome = buildProjectGenome({
    workspaceRoot: input.workspaceRoot,
    projectId: input.projectId ?? null,
    projectSlug: input.projectSlug ?? null,
    ...(input.flows ? { flows: input.flows } : {}),
    capturedAt: startedAt,
  });

  const graph = buildSoftwareKnowledgeGraph({
    workspaceRoot: input.workspaceRoot,
    projectId: input.projectId ?? null,
    projectSlug: input.projectSlug ?? null,
  });

  const expected = input.promoteExpected
    ? promoteObservedToExpected(input.workspaceRoot, genome.apis)
    : ensureExpectedBaseline(input.workspaceRoot, genome.apis);

  const temporal = compareGenomes(previous, genome);
  const behaviorDiffs = verifyAgainstExpected(expected, genome.apis);

  const findings: ObserverFinding[] = [];

  findings.push({
    id: "temporal-summary",
    title: "Temporal compare",
    detail: temporal.summary,
    claim: previous ? "OBSERVED" : "UNKNOWN",
    epistemicState: previous ? "OBSERVED" : "UNKNOWN",
    riskBand: temporal.behaviorDiffCount > 0 ? "MEDIUM" : "LOW",
    category: "TEMPORAL",
    evidenceRefs: previous
      ? [`genome@${previous.capturedAt}`, `genome@${genome.capturedAt}`]
      : [`genome@${genome.capturedAt}`],
  });

  findings.push({
    id: "expected-model",
    title: "Expected behavior model",
    detail: `EXPECTED baseline (${expected.source}) from ${expected.promotedAt} · ${expected.flows.length} flows. Compared OBSERVED → ${behaviorDiffs.length} drift(s).`,
    claim: "VERIFIED",
    epistemicState: "VERIFIED",
    riskBand: behaviorDiffs.length ? "MEDIUM" : "LOW",
    category: "BEHAVIOR",
    evidenceRefs: [`.atlas/genome/expected.json`, `source:${expected.source}`],
  });

  findings.push({
    id: "graph-summary",
    title: "Software Knowledge Graph",
    detail: `Graph v0: ${graph.nodes.length} nodes · ${graph.edges.length} edges.`,
    claim: "OBSERVED",
    epistemicState: "OBSERVED",
    riskBand: "LOW",
    category: "GENOME",
    evidenceRefs: [`.atlas/genome/graph.json`],
  });

  const authEdges = graph.edges.filter((e) => e.type === "AUTHENTICATED_BY").length;
  const sensitiveEdges = graph.edges.filter((e) => e.type === "EXPOSES_DATA").length;
  const decisions = graph.nodes.filter((n) => n.type === "DECISION").length;
  if (authEdges || sensitiveEdges) {
    findings.push({
      id: "security-graph",
      title: "Security graph signals",
      detail: `Auth boundaries: ${authEdges} · Sensitive data edges: ${sensitiveEdges}.`,
      claim: "INFERRED",
      epistemicState: "INFERRED",
      riskBand: sensitiveEdges > 3 ? "MEDIUM" : "LOW",
      category: "GENOME",
      evidenceRefs: [
        `AUTHENTICATED_BY×${authEdges}`,
        `EXPOSES_DATA×${sensitiveEdges}`,
      ],
    });
  }
  if (decisions > 0) {
    findings.push({
      id: "engineering-memory-graph",
      title: "Engineering memory on graph",
      detail: `${decisions} decision/ADR node(s) linked into the knowledge graph.`,
      claim: "OBSERVED",
      epistemicState: "OBSERVED",
      riskBand: "LOW",
      category: "GENOME",
      evidenceRefs: [`DECISION×${decisions}`],
    });
  }

  for (const diff of behaviorDiffs) {
    const boost = impactBoostForFlow(graph, diff.flowId);
    findings.push({
      id: `behavior-${diff.flowId}-${diff.kind}`,
      title: diff.title,
      detail: `${diff.detail} Impact: ${boost.nodeCount} related graph nodes.`,
      claim: diff.claim,
      epistemicState: claimToEpistemic(diff.claim),
      riskBand: diff.riskBand,
      category: "BEHAVIOR",
      flowId: diff.flowId,
      evidenceRefs: [
        `EXPECTED:[${diff.beforeSteps.join(" → ")}]`,
        `OBSERVED:[${diff.afterSteps.join(" → ")}]`,
        ...boost.evidenceNotes,
      ],
      impactNodeCount: boost.nodeCount,
    });
  }

  if (input.bugs?.length) {
    ingestBugs(input.workspaceRoot, input.bugs, input.projectId ?? null);
  }
  const bugs = loadBugs(input.workspaceRoot);
  for (const bug of bugs.filter(
    (b) => b.status === "OPEN" || b.status === "REPRODUCED",
  )) {
    findings.push({
      id: `bug-${bug.id}`,
      title: bug.title,
      detail: bug.detail || `Bug ${bug.status} · ${bug.severity}`,
      claim: bug.claim,
      epistemicState: claimToEpistemic(bug.claim),
      riskBand: bug.severity,
      category: "BUG",
      flowId: bug.linkedFlowId ?? null,
      evidenceRefs: [`bug:${bug.id}`, `source:${bug.source}`],
    });
  }

  const openHighBugs = bugs.filter(
    (b) =>
      (b.status === "OPEN" || b.status === "REPRODUCED") &&
      (b.severity === "CRITICAL" || b.severity === "HIGH"),
  ).length;

  const risk = scoreRiskWithGraph({
    behaviorDiffs,
    openHighBugs,
    graph,
    hasPrevious: Boolean(previous),
    apiCount: genome.apis.length,
  });

  findings.push({
    id: "risk-rollup",
    title: `Risk ${risk.band}`,
    detail: `Score ${risk.score} ${risk.bar} — graph-aware · blast radius nodes ${risk.impactNodeTotal}.`,
    claim: previous || behaviorDiffs.length ? "INFERRED" : "SUSPECTED",
    epistemicState: previous || behaviorDiffs.length ? "INFERRED" : "ASSUMED",
    riskBand: risk.band,
    category: "RISK",
    evidenceRefs: risk.evidenceNotes,
    impactNodeCount: risk.impactNodeTotal,
  });

  const meaningful = behaviorDiffs.filter(
    (d) => d.riskBand === "HIGH" || d.riskBand === "CRITICAL" || d.riskBand === "MEDIUM",
  ).length;
  const confirmed = behaviorDiffs.filter(
    (d) => d.riskBand === "HIGH" || d.riskBand === "CRITICAL",
  ).length;

  let counters = loadTruthCounters(input.workspaceRoot);
  if (persist) {
    saveGenome(genome);
    saveGenomeSnapshot(genome);
    saveSoftwareKnowledgeGraph(graph);
    counters = bumpTruthCounters(input.workspaceRoot, {
      analyzed: 1,
      meaningfulRisks: meaningful,
      confirmedRegressions: confirmed,
      // Pre-prod catch: continuous/manual observe before deploy
      caughtBeforeProd: confirmed > 0 && trigger !== "deploy" ? confirmed : 0,
    });
  }

  const cycleId = crypto.randomUUID();
  const top =
    findings
      .filter(
        (f) =>
          f.id.startsWith("behavior-") ||
          (f.category === "BUG" && f.riskBand !== "LOW"),
      )
      .sort((a, b) => {
        const r = (x: string) =>
          x === "CRITICAL" ? 4 : x === "HIGH" ? 3 : x === "MEDIUM" ? 2 : 1;
        return r(b.riskBand) - r(a.riskBand);
      })[0] ?? null;

  if (persist) {
    appendCycleHistory(input.workspaceRoot, {
      id: cycleId,
      at: startedAt,
      riskBand: risk.band,
      riskScore: risk.score,
      findingCount: findings.length,
      behaviorDiffCount: behaviorDiffs.length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      trigger,
      topFindingTitle: top?.title ?? null,
    });
  }

  const evidenceDrafts = findings
    .filter((f) => f.category === "BEHAVIOR" || f.category === "BUG")
    .slice(0, 20)
    .map((f) => ({
      source: "atlas-observer",
      sourceType: "SYSTEM" as const,
      excerpt: `${f.title}: ${f.detail}\nEvidence:\n${(f.evidenceRefs ?? []).join("\n")}`.slice(
        0,
        2000,
      ),
      epistemicState: f.epistemicState,
      category: f.category === "BUG" ? ("RISKS" as const) : ("CODE" as const),
      confidence:
        f.claim === "VERIFIED" ? 0.95 : f.claim === "OBSERVED" ? 0.8 : 0.55,
    }));

  const completedAt = new Date().toISOString();
  return observeCycleResultSchema.parse({
    id: cycleId,
    projectId: input.projectId ?? null,
    workspaceRoot: input.workspaceRoot,
    startedAt,
    completedAt,
    genome,
    previousGenomeAt: temporal.previousAt,
    behaviorDiffs,
    findings,
    bugs,
    risk: {
      score: risk.score,
      band: risk.band,
      summary: findings.find((f) => f.id === "risk-rollup")?.detail ?? "",
    },
    atlasDir: atlasObserverPaths(input.workspaceRoot).atlas,
    counters,
    history: listCycleHistory(input.workspaceRoot).slice(0, 20),
    expectedPromotedAt: expected.promotedAt,
    evidenceDrafts,
  });
}
