import {
  productionReadinessCertificateSchema,
  type ProductionReadinessCertificate,
  type ReadinessDimension,
} from "@atlas/shared";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateReleaseGateGraph } from "./gate-engine.js";
import { osStore } from "../store/os-store.js";

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function walkHit(root: string, re: RegExp, max = 8): string[] {
  if (!existsSync(root)) return [];
  const hits: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (hits.length >= max || depth > 4) return;
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
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(ts|tsx|md|yml|yaml|json)$/i.test(name) || st.size > 300_000) {
        continue;
      }
      try {
        if (re.test(readFileSync(full, "utf8"))) {
          hits.push(
            full.replace(root, "").replace(/^[\\/]/, "").replace(/\\/g, "/"),
          );
        }
      } catch {
        /* skip */
      }
    }
  };
  walk(root, 0);
  return hits;
}

function dim(
  key: ReadinessDimension["key"],
  score: number,
  notes: string,
  evidenceRefs: string[],
  epistemicState: ReadinessDimension["epistemicState"],
): ReadinessDimension {
  return { key, score: clamp(score), notes, evidenceRefs, epistemicState };
}

/** Production Readiness Autopilot — Certificate with Evidence drill-down. */
export function issueProductionReadinessCertificate(input: {
  projectId: string | null;
  projectName: string;
  workspaceRoot?: string | null;
}): ProductionReadinessCertificate {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const root = input.workspaceRoot ? resolve(input.workspaceRoot) : null;

  const graph = evaluateReleaseGateGraph(input.projectId);
  const gateFail = graph.nodes.filter(
    (n) => n.status === "FAIL" || n.status === "BLOCKED",
  );
  const gateUnknown = graph.nodes.filter(
    (n) => n.status === "UNKNOWN" || n.status === "STALE",
  );

  const evidenceCount =
    input.projectId != null
      ? osStore.getEvidence(input.projectId).length
      : osStore.countEvidenceRecords();
  const openConflicts = (() => {
    let n = 0;
    for (const p of osStore.listProjects()) {
      if (input.projectId && p.id !== input.projectId) continue;
      const snap = osStore.getSnapshot(p.id);
      if (!snap) continue;
      for (const c of snap.conflicts) {
        if (!(osStore.getConflictResolution(c.id) ?? c.resolution)) n += 1;
      }
    }
    return n;
  })();
  const latestEval = osStore.listEvalRuns()[0];
  const dangerousPatches = osStore
    .listPatches(input.projectId ?? undefined)
    .filter(
      (p) =>
        (p.risk === "HIGH" || p.risk === "CRITICAL") &&
        (p.status === "AWAITING_APPROVAL" || p.status === "PROPOSED"),
    );

  const secHits = root
    ? walkHit(root, /SECURITY\.md|rls|expectedUpdatedAt|secret/i)
    : [];
  const testHits = root
    ? walkHit(root, /\.test\.|describe\(|vitest|playwright/i)
    : [];
  const ciHits = root
    ? walkHit(root, /github\/workflows|turbo\.json|ci/i)
    : [];
  const obsHits = root
    ? walkHit(root, /sentry|otel|prometheus|observability|health/i)
    : [];
  const docHits = root
    ? walkHit(root, /README|ROADMAP|ARCHITECTURE|runbook/i)
    : [];
  const infraHits = root
    ? walkHit(root, /supabase|dockerfile|terraform|netlify|vercel/i)
    : [];

  const dimensions: ReadinessDimension[] = [
    dim(
      "security",
      55 +
        (secHits.length > 0 ? 25 : 0) +
        (gateFail.some((g) => g.id === "secrets-clean") ? -40 : 15) +
        (latestEval?.results.some((r) => r.dimension === "SECURITY" && r.passed)
          ? 10
          : 0),
      gateFail.some((g) => g.id === "secrets-clean")
        ? "Secrets gate FAIL."
        : secHits.length
          ? `Security signals in repo (${secHits.length} hits).`
          : "Thin security evidence — treat as UNVERIFIED.",
      secHits,
      secHits.length ? "OBSERVED" : "UNVERIFIED",
    ),
    dim(
      "reliability",
      50 +
        (dangerousPatches.length === 0 ? 20 : -15) +
        (openConflicts === 0 ? 15 : -20) +
        (gateFail.length === 0 ? 10 : -10),
      openConflicts
        ? `${openConflicts} open conflict(s).`
        : dangerousPatches.length
          ? `${dangerousPatches.length} HIGH/CRITICAL patch(es) awaiting approval.`
          : "No open conflicts; dangerous patches clear.",
      gateFail.map((g) => g.id),
      openConflicts || dangerousPatches.length ? "UNVERIFIED" : "OBSERVED",
    ),
    dim(
      "testing",
      40 + (testHits.length > 0 ? 35 : 0) + (testHits.length > 5 ? 15 : 0),
      testHits.length
        ? `Test signals: ${testHits.slice(0, 4).join(", ")}`
        : "No test signals found in scan — UNKNOWN coverage.",
      testHits,
      testHits.length ? "OBSERVED" : "UNKNOWN",
    ),
    dim(
      "infrastructure",
      45 + (infraHits.length > 0 ? 30 : 0) + (ciHits.length > 0 ? 15 : 0),
      infraHits.length || ciHits.length
        ? "Infra/CI artifacts observed."
        : "Infrastructure evidence thin.",
      [...infraHits, ...ciHits].slice(0, 8),
      infraHits.length || ciHits.length ? "OBSERVED" : "UNVERIFIED",
    ),
    dim(
      "observability",
      35 + (obsHits.length > 0 ? 40 : 0),
      obsHits.length
        ? `Observability signals: ${obsHits.slice(0, 4).join(", ")}`
        : "No monitoring/OTel/Sentry signals in scan.",
      obsHits,
      obsHits.length ? "OBSERVED" : "UNKNOWN",
    ),
    dim(
      "documentation",
      40 + (docHits.length > 0 ? 35 : 0) + (docHits.length > 3 ? 15 : 0),
      docHits.length
        ? `Docs: ${docHits.slice(0, 4).join(", ")}`
        : "Documentation evidence thin or stale risk.",
      docHits,
      docHits.length ? "OBSERVED" : "STALE",
    ),
  ];

  const overall = clamp(
    dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length,
  );

  const blockers = gateFail.length;
  const highRisks = dangerousPatches.length + openConflicts;
  const unknownClaims =
    gateUnknown.length +
    dimensions.filter((d) => d.epistemicState === "UNKNOWN").length;

  const summary = [
    `${input.projectName} — Production Readiness ${overall}/100.`,
    `BLOCKERS ${blockers} · HIGH RISKS ${highRisks} · UNKNOWN CLAIMS ${unknownClaims}.`,
    `Evidence records in store: ${evidenceCount}.`,
    graph.plainLanguageSummary,
    "Epistemic: scores are OBSERVED/UNVERIFIED from local scans + gates — not live production proof unless Evidence says so.",
  ].join(" ");

  return productionReadinessCertificateSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    projectName: input.projectName,
    overallScore: overall,
    dimensions,
    blockers,
    highRisks,
    unknownClaims,
    blockerSummaries: gateFail.map(
      (g) => `${g.title}: ${g.blockerReason ?? g.status}`,
    ),
    highRiskSummaries: [
      ...dangerousPatches.map((p) => `Patch ${p.title} (${p.risk})`),
      ...(openConflicts ? [`${openConflicts} unresolved conflict(s)`] : []),
    ],
    unknownSummaries: [
      ...gateUnknown.map((g) => `Gate ${g.id}: ${g.status}`),
      ...dimensions
        .filter((d) => d.epistemicState === "UNKNOWN")
        .map((d) => `Dimension ${d.key}: UNKNOWN`),
    ],
    lastVerifiedAt: now,
    plainLanguageSummary: summary,
    gateGraphId: graph.id,
    createdAt: now,
  });
}
