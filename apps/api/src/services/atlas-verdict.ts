import {
  atlasVerdictSchema,
  evidenceReportSchema,
  type AtlasVerdict,
  type EvidenceReport,
} from "@atlas/shared";
import { issueProductionReadinessCertificate } from "./readiness-certificate.js";
import { evaluateReleaseGateGraph } from "./gate-engine.js";
import { osStore } from "../store/os-store.js";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function countFiles(root: string, max = 5000): number {
  if (!existsSync(root)) return 0;
  let n = 0;
  const walk = (dir: string, depth: number) => {
    if (n >= max || depth > 6) return;
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
      else n += 1;
    }
  };
  walk(root, 0);
  return n;
}

/** Build release verdict — "Is this release actually safe?" */
export function buildAtlasVerdict(input: {
  projectId: string;
  workspaceRoot?: string | null;
  locale?: string | null;
}): AtlasVerdict {
  osStore.ensureLoaded();
  const project = osStore.getProject(input.projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const cert = issueProductionReadinessCertificate({
    projectId: project.id,
    projectName: project.name,
    workspaceRoot: input.workspaceRoot ?? null,
  });
  // Do NOT persist certificate on every verdict poll — that belongs to POST /readiness/certificate.
  // Reuse latest stored cert id when present for the same project.
  const latestStored = osStore
    .listReadinessCertificates()
    .find((c) => c.projectId === project.id);
  const certificateId = latestStored?.id ?? cert.id;

  const graph = evaluateReleaseGateGraph(project.id);
  const evidence = osStore.getEvidence(project.id);
  const claims = osStore.getClaims(project.id);
  const snap = osStore.getSnapshot(project.id);
  const patches = osStore.listPatches(project.id);

  const unverified = claims.filter(
    (c) =>
      c.epistemicState === "UNVERIFIED" ||
      c.epistemicState === "ASSUMED" ||
      c.epistemicState === "PROPOSED",
  ).length;
  const stale = claims.filter((c) => c.epistemicState === "STALE").length;
  const verified = claims.filter(
    (c) =>
      c.epistemicState === "VERIFIED" ||
      c.epistemicState === "FACT" ||
      c.epistemicState === "CONFIRMED" ||
      c.epistemicState === "OBSERVED",
  ).length;

  // When claims empty, derive from certificate unknowns / evidence
  const unverifiedClaims =
    unverified ||
    cert.unknownClaims ||
    Math.max(0, cert.dimensions.filter((d) => d.epistemicState === "UNKNOWN" || d.epistemicState === "UNVERIFIED").length);
  const staleClaims = stale;
  const verifiedClaims =
    verified ||
    Math.max(
      0,
      evidence.length +
        cert.dimensions.filter((d) => d.epistemicState === "OBSERVED").length,
    );

  const openConflicts =
    snap?.conflicts.filter(
      (c) => !(osStore.getConflictResolution(c.id) ?? c.resolution),
    ).length ?? 0;

  const patchesProposed = patches.filter(
    (p) =>
      p.status === "PROPOSED" ||
      p.status === "AWAITING_APPROVAL" ||
      p.status === "APPROVED" ||
      p.status === "APPLIED",
  ).length;
  const patchesAccepted = patches.filter(
    (p) => p.status === "APPLIED" || p.status === "APPROVED" || p.status === "VERIFIED",
  ).length;

  const criticalBlockers = graph.nodes.filter(
    (n) => n.status === "FAIL" || n.status === "BLOCKED",
  ).length;
  const highRisks =
    patches.filter(
      (p) =>
        (p.risk === "HIGH" || p.risk === "CRITICAL") &&
        (p.status === "AWAITING_APPROVAL" || p.status === "PROPOSED"),
    ).length + openConflicts;

  const evidenceCoverage =
    evidence.length === 0 && claims.length === 0
      ? Math.min(1, cert.overallScore / 100)
      : claims.length === 0
        ? Math.min(1, evidence.length / Math.max(1, evidence.length))
        : Math.min(1, evidence.length / Math.max(1, claims.length));

  let status: AtlasVerdict["status"] = "READY";
  if (criticalBlockers > 0) status = "BLOCKED";
  else if (highRisks > 0 || unverifiedClaims > 5 || cert.overallScore < 70)
    status = "CONDITIONAL";
  else if (cert.overallScore < 50 || evidence.length === 0) status = "UNKNOWN";

  const confidence = Math.min(
    0.98,
    0.55 + evidenceCoverage * 0.3 + (criticalBlockers === 0 ? 0.1 : 0),
  );

  const blockerItems = [
    ...graph.nodes
      .filter((n) => n.status === "FAIL" || n.status === "BLOCKED")
      .map((n) => ({
        id: n.id,
        title: n.title,
        severity: "CRITICAL" as const,
        epistemicState: "OBSERVED" as const,
        evidenceRefs: n.blockerReason ? [n.blockerReason] : [],
      })),
    ...cert.highRiskSummaries.slice(0, 5).map((s, i) => ({
      id: `high-${i}`,
      title: s,
      severity: "HIGH" as const,
      epistemicState: "INFERRED" as const,
      evidenceRefs: [] as string[],
    })),
  ];

  const summary = localizeVerdictSummary({
    locale: normalizeLocale(input.locale),
    status,
    criticalBlockers,
    highRisks,
    unverifiedClaims,
    verifiedClaims,
    overallScore: cert.overallScore,
    evidenceCoverage,
    certSummary: cert.plainLanguageSummary,
  });

  const verdict = atlasVerdictSchema.parse({
    projectId: project.id,
    projectName: project.name,
    status,
    confidence,
    productionReadiness: cert.overallScore,
    criticalBlockers,
    highRisks,
    unverifiedClaims,
    staleClaims,
    verifiedClaims,
    evidenceCoverage,
    evidenceCount: evidence.length,
    conflictCount: openConflicts,
    patchesProposed,
    patchesAccepted,
    lastVerifiedAt: cert.lastVerifiedAt,
    gateVersion: "1.1",
    plainLanguageSummary: summary,
    blockerItems,
    certificateId,
  });

  osStore.incrementUsage("verdictsRequested");
  return verdict;
}

type ReportLocale = "he" | "en" | "ar";

function normalizeLocale(locale?: string | null): ReportLocale {
  if (locale === "he" || locale === "ar") return locale;
  return "en";
}

function localizeVerdictSummary(input: {
  locale: ReportLocale;
  status: AtlasVerdict["status"];
  criticalBlockers: number;
  highRisks: number;
  unverifiedClaims: number;
  verifiedClaims: number;
  overallScore: number;
  evidenceCoverage: number;
  certSummary: string;
}): string {
  const cov = Math.round(input.evidenceCoverage * 100);
  if (input.locale === "he") {
    return [
      `שחרור: ${statusLabelHe(input.status)}`,
      `${input.criticalBlockers} חסמים · ${input.highRisks} סיכונים גבוהים · ${input.unverifiedClaims} לא מאומתים · ${input.verifiedClaims} מאומתים.`,
      `מוכנות לייצור ${input.overallScore}/100 · כיסוי ראיות ${cov}%.`,
      input.certSummary,
    ].join(" ");
  }
  if (input.locale === "ar") {
    return [
      `الإصدار: ${input.status}`,
      `${input.criticalBlockers} حواجز · ${input.highRisks} مخاطر عالية · ${input.unverifiedClaims} غير موثّقة · ${input.verifiedClaims} موثّقة.`,
      `جاهزية الإنتاج ${input.overallScore}/100 · تغطية الأدلة ${cov}%.`,
      input.certSummary,
    ].join(" ");
  }
  return [
    `RELEASE: ${input.status}`,
    `${input.criticalBlockers} blockers · ${input.highRisks} high-risk · ${input.unverifiedClaims} unverified · ${input.verifiedClaims} verified.`,
    `Production readiness ${input.overallScore}/100 · evidence coverage ${cov}%.`,
    input.certSummary,
  ].join(" ");
}

function statusLabelHe(status: AtlasVerdict["status"]): string {
  switch (status) {
    case "READY":
      return "מוכן";
    case "CONDITIONAL":
      return "מותנה";
    case "BLOCKED":
      return "חסום";
    default:
      return "לא ידוע";
  }
}

function severityLabel(locale: ReportLocale, severity: string): string {
  if (locale !== "he") return severity;
  if (severity === "CRITICAL") return "קריטי";
  if (severity === "HIGH") return "גבוה";
  if (severity === "MEDIUM") return "בינוני";
  if (severity === "LOW") return "נמוך";
  return severity;
}

export function buildEvidenceReport(input: {
  projectId: string;
  workspaceRoot?: string | null;
  locale?: string | null;
}): EvidenceReport {
  const locale = normalizeLocale(input.locale);
  const verdictInput: {
    projectId: string;
    workspaceRoot?: string | null;
    locale: ReportLocale;
  } = {
    projectId: input.projectId,
    locale,
  };
  if (input.workspaceRoot !== undefined) {
    verdictInput.workspaceRoot = input.workspaceRoot;
  }
  const verdict = buildAtlasVerdict(verdictInput);
  const project = osStore.getProject(input.projectId)!;
  const evidence = osStore.getEvidence(input.projectId);
  const now = new Date().toISOString();

  const copy =
    locale === "he"
      ? {
          reportTitle: `דוח ראיות Atlas — ${project.name}`,
          generated: `נוצר: ${now}`,
          verdictHeading: `פסק דין: **${statusLabelHe(verdict.status)}** (${verdict.productionReadiness}/100)`,
          sectionVerdict: "פסק דין לשחרור",
          sectionEvidence: "מלאי ראיות",
          sectionBlockers: "חסמים",
          sectionGov: "ממשל כתיבה",
          evidenceBody: `${evidence.length} רשומות ראיה. כיסוי ${Math.round(verdict.evidenceCoverage * 100)}%.`,
          none: "אין.",
          govBody: `תיקונים מוצעים ${verdict.patchesProposed} · אושרו/הוחלו ${verdict.patchesAccepted}. כתיבה נשארת מותנית באישור.`,
          evidencePrefix: "ראיות:",
          footer:
            "_תוויות אפיסטמיות נשמרות. אינו תחליף לאימות ייצור חי._",
        }
      : locale === "ar"
        ? {
            reportTitle: `تقرير أدلة Atlas — ${project.name}`,
            generated: `أُنشئ: ${now}`,
            verdictHeading: `الحكم: **${verdict.status}** (${verdict.productionReadiness}/100)`,
            sectionVerdict: "حكم الإصدار",
            sectionEvidence: "جرد الأدلة",
            sectionBlockers: "الحواجز",
            sectionGov: "حوكمة الكتابة",
            evidenceBody: `${evidence.length} سجل(ات) أدلة. التغطية ${Math.round(verdict.evidenceCoverage * 100)}%.`,
            none: "لا شيء.",
            govBody: `رقع مقترحة ${verdict.patchesProposed} · مقبولة/مطبّقة ${verdict.patchesAccepted}. الكتابة تبقى مشروطة بالموافقة.`,
            evidencePrefix: "أدلة:",
            footer: "_تُحفظ التصنيفات المعرفية. ليس بديلاً عن تحقق الإنتاج الحي._",
          }
        : {
            reportTitle: `Atlas Evidence Report — ${project.name}`,
            generated: `Generated: ${now}`,
            verdictHeading: `Verdict: **${verdict.status}** (${verdict.productionReadiness}/100)`,
            sectionVerdict: "Release verdict",
            sectionEvidence: "Evidence inventory",
            sectionBlockers: "Blockers",
            sectionGov: "Governance",
            evidenceBody: `${evidence.length} evidence record(s). Coverage ${Math.round(verdict.evidenceCoverage * 100)}%.`,
            none: "None.",
            govBody: `Patches proposed ${verdict.patchesProposed} · accepted/applied ${verdict.patchesAccepted}. WRITE remains approval-gated.`,
            evidencePrefix: "Evidence:",
            footer:
              "_Epistemic labels preserved. Not a substitute for live production verification._",
          };

  const sections = [
    {
      title: copy.sectionVerdict,
      body: verdict.plainLanguageSummary,
      evidenceRefs: verdict.blockerItems.flatMap((b) => b.evidenceRefs),
    },
    {
      title: copy.sectionEvidence,
      body: copy.evidenceBody,
      evidenceRefs: evidence.slice(0, 12).map((e) => e.source),
    },
    {
      title: copy.sectionBlockers,
      body:
        verdict.blockerItems
          .map(
            (b) =>
              `- [${severityLabel(locale, b.severity)}] ${b.title}`,
          )
          .join("\n") || copy.none,
      evidenceRefs: [] as string[],
    },
    {
      title: copy.sectionGov,
      body: copy.govBody,
      evidenceRefs: [] as string[],
    },
  ];

  const markdown = [
    `# ${copy.reportTitle}`,
    "",
    copy.generated,
    "",
    `## ${copy.verdictHeading}`,
    "",
    verdict.plainLanguageSummary,
    "",
    ...sections.flatMap((s) => [
      `## ${s.title}`,
      "",
      s.body,
      s.evidenceRefs.length
        ? `${copy.evidencePrefix} ${s.evidenceRefs.join(", ")}`
        : "",
      "",
    ]),
    "---",
    copy.footer,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return evidenceReportSchema.parse({
    id: crypto.randomUUID(),
    projectId: project.id,
    projectName: project.name,
    generatedAt: now,
    verdict,
    sections,
    markdown,
  });
}

export function collectCaseStudyMetrics(input: {
  projectId: string;
  workspaceRoot?: string | null;
}) {
  const verdict = buildAtlasVerdict(input);
  const root = input.workspaceRoot ? resolve(input.workspaceRoot) : null;
  const filesAnalyzed = root ? countFiles(root) : 0;
  const suites = osStore.listEvalSuites();
  const latest = suites[0];
  const falsePositiveRate =
    latest && latest.results.length
      ? latest.failed / Math.max(1, latest.results.length)
      : null;
  const humanApprovalRate =
    verdict.patchesProposed > 0
      ? verdict.patchesAccepted / verdict.patchesProposed
      : null;

  return {
    caseId: "001",
    title: "Atlas Proof Case #001 — BrokerOS",
    repository: input.workspaceRoot ?? "brokerOS-main",
    filesAnalyzed,
    claimsGenerated: verdict.verifiedClaims + verdict.unverifiedClaims + verdict.staleClaims,
    evidenceRecords: verdict.evidenceCount,
    risksDetected: verdict.highRisks + verdict.criticalBlockers,
    conflicts: verdict.conflictCount,
    patchesProposed: verdict.patchesProposed,
    patchesAccepted: verdict.patchesAccepted,
    regressionTests: latest?.results.length ?? 0,
    criticalIssues: verdict.criticalBlockers,
    productionBlockers: verdict.criticalBlockers,
    humanApprovalRate,
    falsePositiveRate,
    productionReadiness: verdict.productionReadiness,
    verdictStatus: verdict.status,
    evidenceCoverage: verdict.evidenceCoverage,
    benchmarkPassRate: latest?.passRate ?? null,
    unauthorizedWrites: latest?.unauthorizedWrites ?? 0,
    generatedAt: new Date().toISOString(),
    verdict,
  };
}
