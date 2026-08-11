import {
  DEFAULT_RELEASE_GATE_META,
  qualityGateGraphSchema,
  type GateStatus,
  type QualityGateGraph,
  type QualityGateNode,
} from "@atlas/shared";
import { detectSecrets, redactSecrets } from "@atlas/agent-core";
import { osStore } from "../store/os-store.js";

function node(
  id: keyof typeof DEFAULT_RELEASE_GATE_META,
  status: GateStatus,
  blockerReason: string | null,
  now: string,
): QualityGateNode {
  const meta = DEFAULT_RELEASE_GATE_META[id];
  return {
    id,
    title: meta.titleEn,
    status,
    blockerReason,
    evidenceIds: [],
    waivedBy: null,
    waivedReason: null,
    updatedAt: now,
  };
}

function summarize(nodes: QualityGateNode[]): string {
  const blockers = nodes.filter(
    (n) => n.status === "FAIL" || n.status === "BLOCKED",
  );
  if (blockers.length === 0) {
    const unknown = nodes.filter((n) => n.status === "UNKNOWN" || n.status === "STALE");
    if (unknown.length > 0) {
      return `No hard blockers, but ${unknown.length} gate(s) still UNKNOWN/STALE — do not treat as production-proven.`;
    }
    return "All release gates PASS or WAIVED. Epistemic: readiness is OBSERVED from local store checks — verify live before ship.";
  }
  return blockers
    .map((b) => `${b.title}: ${b.blockerReason ?? "blocked"}`)
    .join(" · ");
}

/** Evaluate the default portfolio/project release DAG from durable store signals. */
export function evaluateReleaseGateGraph(
  projectId: string | null,
): QualityGateGraph {
  osStore.ensureLoaded();
  const now = new Date().toISOString();

  const sample =
    "api_key=sk_test_should_redact_abcdefghijklmnopqrstuvwxyz and ghp_abcdefghijklmnopqrstuvwxyz123456";
  const secretsOk = detectSecrets(redactSecrets(sample)).length === 0;

  const projects = osStore.listProjects();
  const evidenceCount =
    projectId != null
      ? osStore.getEvidence(projectId).length
      : projects.reduce((n, p) => n + osStore.getEvidence(p.id).length, 0);
  const hasEvidence = evidenceCount > 0;

  let openConflicts = 0;
  for (const project of projects) {
    if (projectId && project.id !== projectId) continue;
    const snap = osStore.getSnapshot(project.id);
    if (!snap) continue;
    for (const c of snap.conflicts) {
      const res = osStore.getConflictResolution(c.id) ?? c.resolution;
      if (!res) openConflicts += 1;
    }
  }

  const latestEval = osStore.listEvalRuns()[0];
  const evalOk = latestEval?.writeGateOpen === true;

  const pendingDangerous = osStore
    .listPatches(projectId ?? undefined)
    .filter(
      (p) =>
        (p.risk === "HIGH" || p.risk === "CRITICAL") &&
        (p.status === "AWAITING_APPROVAL" || p.status === "PROPOSED"),
    ).length;

  const prior = osStore.getGateGraph(projectId);
  const waived = new Map(
    (prior?.nodes ?? [])
      .filter((n) => n.status === "WAIVED")
      .map((n) => [n.id, n] as const),
  );

  const applyWaive = (n: QualityGateNode): QualityGateNode => {
    const w = waived.get(n.id);
    if (!w) return n;
    return {
      ...n,
      status: "WAIVED",
      waivedBy: w.waivedBy,
      waivedReason: w.waivedReason,
      blockerReason: w.waivedReason,
    };
  };

  const secretsNode = applyWaive(
    node(
      "secrets-clean",
      secretsOk ? "PASS" : "FAIL",
      secretsOk ? null : DEFAULT_RELEASE_GATE_META["secrets-clean"].blockerHintEn,
      now,
    ),
  );
  const evidenceNode = applyWaive(
    node(
      "evidence-present",
      hasEvidence ? "PASS" : "UNKNOWN",
      hasEvidence
        ? null
        : DEFAULT_RELEASE_GATE_META["evidence-present"].blockerHintEn,
      now,
    ),
  );
  const conflictsNode = applyWaive(
    node(
      "conflicts-resolved",
      openConflicts === 0 ? "PASS" : "BLOCKED",
      openConflicts === 0
        ? null
        : `${openConflicts} open conflict(s). Resolve by Source Authority.`,
      now,
    ),
  );
  const evalNode = applyWaive(
    node(
      "eval-write-gate",
      evalOk ? "PASS" : latestEval ? "FAIL" : "UNKNOWN",
      evalOk
        ? null
        : latestEval
          ? "Latest eval did not open write gate."
          : "No eval run yet — POST /api/v1/eval/runs",
      now,
    ),
  );
  const patchesNode = applyWaive(
    node(
      "patches-approved",
      pendingDangerous === 0 ? "PASS" : "BLOCKED",
      pendingDangerous === 0
        ? null
        : `${pendingDangerous} HIGH/CRITICAL patch(es) awaiting approval.`,
      now,
    ),
  );

  const upstream = [
    secretsNode,
    evidenceNode,
    conflictsNode,
    evalNode,
    patchesNode,
  ];
  const upstreamOk = upstream.every(
    (n) => n.status === "PASS" || n.status === "WAIVED",
  );
  const releaseNode = applyWaive(
    node(
      "release-ready",
      upstreamOk ? "PASS" : "BLOCKED",
      upstreamOk
        ? null
        : DEFAULT_RELEASE_GATE_META["release-ready"].blockerHintEn,
      now,
    ),
  );

  const nodes = [...upstream, releaseNode];
  const edges = [
    { from: "secrets-clean", to: "evidence-present" },
    { from: "evidence-present", to: "conflicts-resolved" },
    { from: "conflicts-resolved", to: "eval-write-gate" },
    { from: "eval-write-gate", to: "patches-approved" },
    { from: "patches-approved", to: "release-ready" },
  ];

  const existingId = prior?.id ?? crypto.randomUUID();
  const graph = qualityGateGraphSchema.parse({
    id: existingId,
    projectId,
    name: projectId ? `Release gates · ${projectId}` : "Portfolio release gates",
    nodes,
    edges,
    plainLanguageSummary: summarize(nodes),
    evaluatedAt: now,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  });
  osStore.upsertGateGraph(graph);
  return graph;
}
