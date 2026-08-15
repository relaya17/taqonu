import {
  atlasVerdictSchema,
  evidenceReportSchema,
  executiveReportSchema,
  groupEvidenceByCategory,
  type AtlasVerdict,
  type EvidenceReport,
  type ExecutiveReport,
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

  const blockerItems: AtlasVerdict["blockerItems"] = [
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
      evidenceRefs: [],
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
  const byCategory = groupEvidenceByCategory(evidence);
  const categoryInventory = byCategory
    .filter((bucket) => bucket.items.length > 0)
    .map((bucket) => `${bucket.category}: ${bucket.items.length}`)
    .join(" · ");

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
          evidenceBody: `${evidence.length} רשומות ראיה${categoryInventory ? ` (${categoryInventory})` : ""}. כיסוי ${Math.round(verdict.evidenceCoverage * 100)}%. קטגוריות לא ממוזגות.`,
          none: "אין.",
          govBody: `תיקונים מוצעים ${verdict.patchesProposed} · אושרו/הוחלו ${verdict.patchesAccepted}. כתיבה נשארת מותנית באישור.`,
          evidencePrefix: "ראיות:",
          footer:
            "_תוויות אפיסטמיות וקטגוריות ראיות נשמרות — ללא מיזוג שקט. אינו תחליף לאימות ייצור חי._",
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
            evidenceBody: `${evidence.length} سجل(ات) أدلة${categoryInventory ? ` (${categoryInventory})` : ""}. التغطية ${Math.round(verdict.evidenceCoverage * 100)}%. الفئات غير مدمجة.`,
            none: "لا شيء.",
            govBody: `رقع مقترحة ${verdict.patchesProposed} · مقبولة/مطبّقة ${verdict.patchesAccepted}. الكتابة تبقى مشروطة بالموافقة.`,
            evidencePrefix: "أدلة:",
            footer: "_تُحفظ التصنيفات المعرفية وفئات الأدلة — بلا دمج صامت. ليس بديلاً عن تحقق الإنتاج الحي._",
          }
        : {
            reportTitle: `Atlas Evidence Report — ${project.name}`,
            generated: `Generated: ${now}`,
            verdictHeading: `Verdict: **${verdict.status}** (${verdict.productionReadiness}/100)`,
            sectionVerdict: "Release verdict",
            sectionEvidence: "Evidence inventory",
            sectionBlockers: "Blockers",
            sectionGov: "Governance",
            evidenceBody: `${evidence.length} evidence record(s)${categoryInventory ? ` (${categoryInventory})` : ""}. Coverage ${Math.round(verdict.evidenceCoverage * 100)}%. Categories never silently merged.`,
            none: "None.",
            govBody: `Patches proposed ${verdict.patchesProposed} · accepted/applied ${verdict.patchesAccepted}. WRITE remains approval-gated.`,
            evidencePrefix: "Evidence:",
            footer:
              "_Epistemic labels and evidence categories preserved — no silent merge. Not a substitute for live production verification._",
          };

  const sections: EvidenceReport["sections"] = [
    {
      title: copy.sectionVerdict,
      body: verdict.plainLanguageSummary,
      evidenceRefs: verdict.blockerItems.flatMap((b) => b.evidenceRefs),
    },
    {
      title: copy.sectionEvidence,
      body: copy.evidenceBody,
      evidenceRefs: byCategory
        .filter((bucket) => bucket.items.length > 0)
        .flatMap((bucket) =>
          bucket.items
            .slice(0, 3)
            .map((e) => `${bucket.category}:${e.source}`),
        ),
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
      evidenceRefs: [],
    },
    {
      title: copy.sectionGov,
      body: copy.govBody,
      evidenceRefs: [],
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

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function nextActionForSeverity(
  locale: ReportLocale,
  severity: "CRITICAL" | "HIGH" | "MEDIUM",
): string {
  if (locale === "he") {
    if (severity === "CRITICAL") return "אל תבצעו ACT — פתחו שערים/בריאות וצרפו ראיה חסרה.";
    if (severity === "HIGH") return "רשמו ראיה ב-אמת ואז הריצו Verify מחדש.";
    return "עקבו בפאסט הזה במחזור התצפית הבא.";
  }
  if (locale === "ar") {
    if (severity === "CRITICAL") return "لا تنفّذ ACT — افتح البوابات/الصحة وأرفق الدليل الناقص.";
    if (severity === "HIGH") return "سجّل دليلاً في الحقيقة ثم أعد Verify.";
    return "راقب هذا الجانب في دورة الرصد التالية.";
  }
  if (severity === "CRITICAL") {
    return "Do not ACT — open Gates/Health and attach the missing evidence.";
  }
  if (severity === "HIGH") {
    return "Record evidence on Truth, then re-run Verify.";
  }
  return "Watch this facet on the next observe cycle.";
}

function recommendedActionsForVerdict(
  locale: ReportLocale,
  verdict: AtlasVerdict,
): string[] {
  const actions: string[] = [];
  if (locale === "he") {
    if (verdict.status === "BLOCKED") {
      actions.push("אל תשחררו. נקו חסמים קריטיים והריצו Verify מחדש.");
    } else if (verdict.status === "CONDITIONAL") {
      actions.push("שחרור רק אחרי אישור אדם מפורש — נשארת סיכון שיורית.");
    } else if (verdict.status === "UNKNOWN") {
      actions.push("חברו מקורות ראיה לפני שמתייחסים לזה כהחלטת שחרור.");
    } else {
      actions.push("השחרור מותר לפי הראיות הנוכחיות — המשיכו לצפות אחרי העלייה.");
    }
    if (verdict.unverifiedClaims > 0) {
      actions.push(
        `אמתו ${verdict.unverifiedClaims} טענות לא מאומתות ב-אמת עם ראיה מתוארכת.`,
      );
    }
    if (verdict.criticalBlockers > 0) {
      actions.push("פתחו שערים וצרפו ראיה לכל צומת FAIL/BLOCKED.");
    }
    if (verdict.highRisks > 0) {
      actions.push("פתרו תיקונים בסיכון גבוה או קונפליקטים פתוחים לפני ACT.");
    }
    actions.push("הריצו Audit שוב אחרי שינוי ראיות — זה צילום, לא תעודה חיה.");
    return actions.slice(0, 8);
  }
  if (locale === "ar") {
    if (verdict.status === "BLOCKED") {
      actions.push("لا تُطلق. أزل الحواجز الحرجة ثم أعد Verify.");
    } else if (verdict.status === "CONDITIONAL") {
      actions.push("الإطلاق فقط بعد موافقة بشرية صريحة — يبقى خطر متبقٍ.");
    } else if (verdict.status === "UNKNOWN") {
      actions.push("اربط مصادر أدلة قبل اعتبار هذا قرار إطلاق.");
    } else {
      actions.push("الإطلاق مسموح وفق الأدلة الحالية — واصل الرصد بعد الإطلاق.");
    }
    if (verdict.unverifiedClaims > 0) {
      actions.push(
        `تحقّق من ${verdict.unverifiedClaims} ادّعاء غير مثبت في الحقيقة بدليل مؤرّخ.`,
      );
    }
    if (verdict.criticalBlockers > 0) {
      actions.push("افتح البوابات وأرفق دليلاً لكل عقدة FAIL/BLOCKED.");
    }
    if (verdict.highRisks > 0) {
      actions.push("حلّ التصحيحات عالية المخاطر أو التعارضات المفتوحة قبل ACT.");
    }
    actions.push("أعد التدقيق بعد تغيّر الأدلة — هذا لقطة وليس شهادة حيّة.");
    return actions.slice(0, 8);
  }
  if (verdict.status === "BLOCKED") {
    actions.push("Do not ship. Clear critical blockers and re-run Verify.");
  } else if (verdict.status === "CONDITIONAL") {
    actions.push("Ship only behind an explicit human approval — residual risk remains.");
  } else if (verdict.status === "UNKNOWN") {
    actions.push("Connect evidence sources before treating this as a release decision.");
  } else {
    actions.push("Release is eligible on current evidence — keep observing after ship.");
  }
  if (verdict.unverifiedClaims > 0) {
    actions.push(
      `Verify ${verdict.unverifiedClaims} unverified claim(s) on Truth with dated evidence.`,
    );
  }
  if (verdict.criticalBlockers > 0) {
    actions.push("Open Gates and attach the missing evidence for each FAIL/BLOCKED node.");
  }
  if (verdict.highRisks > 0) {
    actions.push("Resolve high-risk patches or open conflicts before ACT.");
  }
  actions.push(
    "Re-run Audit after evidence changes — this report is a snapshot, not a live certificate.",
  );
  return actions.slice(0, 8);
}

/** CEO/CTO one-pager composed from the existing Verdict — not a second truth model. */
export function buildExecutiveReport(input: {
  projectId: string;
  workspaceRoot?: string | null;
  locale?: string | null;
  systemId?: string | null;
}): ExecutiveReport {
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
  const now = new Date().toISOString();
  const claimTotal =
    verdict.verifiedClaims + verdict.unverifiedClaims + verdict.staleClaims;
  const verifiedPct = claimTotal === 0 ? 0 : pct(verdict.verifiedClaims, claimTotal);
  const unverifiedPct =
    claimTotal === 0 ? 0 : pct(verdict.unverifiedClaims, claimTotal);
  const unknownPct =
    claimTotal === 0 ? 100 : Math.max(0, 100 - verifiedPct - unverifiedPct);

  const topRisks = verdict.blockerItems.slice(0, 5).map((item) => ({
    id: item.id,
    title: item.title,
    severity: item.severity,
    why:
      item.evidenceRefs[0] ??
      (locale === "he"
        ? "מתוך פסק הדין הקיים — פתחו את הראיה המקושרת."
        : locale === "ar"
          ? "من الحكم الحالي — افتح الدليل المرتبط."
          : "Named by the existing Verdict — open the linked evidence."),
    evidenceRefs: item.evidenceRefs,
    nextAction: nextActionForSeverity(locale, item.severity),
    epistemicState: item.epistemicState,
  }));

  if (topRisks.length === 0 && verdict.unverifiedClaims > 0) {
    topRisks.push({
      id: "unverified-claims",
      title:
        locale === "he"
          ? `${verdict.unverifiedClaims} טענות לא מאומתות`
          : locale === "ar"
            ? `${verdict.unverifiedClaims} ادّعاءات غير مثبتة`
            : `${verdict.unverifiedClaims} unverified claims`,
      severity: "HIGH",
      why:
        locale === "he"
          ? "יש טענות בלי ראיה במצב VERIFIED/FACT/CONFIRMED/OBSERVED."
          : locale === "ar"
            ? "توجد ادّعاءات بلا دليل في حالة VERIFIED/FACT/CONFIRMED/OBSERVED."
            : "Claims exist without VERIFIED/FACT/CONFIRMED/OBSERVED evidence.",
      evidenceRefs: [],
      nextAction: nextActionForSeverity(locale, "HIGH"),
      epistemicState: "UNVERIFIED",
    });
  }

  const recommendedActions = recommendedActionsForVerdict(locale, verdict);
  const heading =
    locale === "he"
      ? `דוח מנהלים Atlas — ${verdict.projectName}`
      : locale === "ar"
        ? `تقرير تنفيذي Atlas — ${verdict.projectName}`
        : `Atlas Executive Report — ${verdict.projectName}`;
  const line =
    locale === "he"
      ? "דעו אם התוכנה באמת מוכנה — לפני שהמשתמשים, המבקרים או תקלות הייצור יגידו לכם אחרת."
      : locale === "ar"
        ? "اعرف إن كان برنامجك جاهزاً فعلاً — قبل أن يخبرك المستخدمون أو المدققون أو حوادث الإنتاج بخلاف ذلك."
        : "Know if your software is actually ready — before your users, auditors, or production incidents tell you otherwise.";
  const riskLines = topRisks.map((risk, i) => {
    const refs = risk.evidenceRefs.length
      ? risk.evidenceRefs.join(", ")
      : locale === "he"
        ? "אין הפניית ראיה"
        : locale === "ar"
          ? "لا مرجع دليل"
          : "no evidence ref";
    return `${i + 1}. [${risk.severity}] ${risk.title}\n   ${risk.why}\n   ${refs}\n   ${risk.nextAction}`;
  });
  const actionLines = recommendedActions.map((a, i) => `${i + 1}. ${a}`);
  const footer =
    locale === "he"
      ? "_כל שורה נפתחת לראיה. אינו תחליף לאימות ייצור חי._"
      : locale === "ar"
        ? "_كل سطر يفتح إلى دليل. ليس بديلاً عن تحقق إنتاج حي._"
        : "_Every line opens to Evidence. Not a substitute for live production verification._";

  const markdown = [
    `# ${heading}`,
    "",
    `**${verdict.status}** · ${verdict.productionReadiness}/100`,
    locale === "he" ? `נוצר: ${now}` : locale === "ar" ? `أُنشئ: ${now}` : `Generated: ${now}`,
    "",
    line,
    "",
    locale === "he" ? "## דלי אמון" : locale === "ar" ? "## دلاء الثقة" : "## Trust buckets",
    `- ${locale === "he" ? "מאומת" : locale === "ar" ? "مثبت" : "Verified"}: ${verifiedPct}%`,
    `- ${locale === "he" ? "לא מאומת" : locale === "ar" ? "غير مثبت" : "Unverified"}: ${unverifiedPct}%`,
    `- ${locale === "he" ? "לא ידוע" : locale === "ar" ? "غير معروف" : "Unknown"}: ${unknownPct}%`,
    "",
    locale === "he" ? "## סיכונים מובילים" : locale === "ar" ? "## أبرز المخاطر" : "## Top risks",
    ...(riskLines.length ? riskLines : ["—"]),
    "",
    locale === "he"
      ? "## פעולות מומלצות"
      : locale === "ar"
        ? "## إجراءات موصى بها"
        : "## Recommended actions",
    ...actionLines,
    "",
    locale === "he" ? "## פסק דין (מקור האמת)" : locale === "ar" ? "## الحكم (مصدر الحقيقة)" : "## Verdict (source of truth)",
    verdict.plainLanguageSummary,
    "",
    footer,
  ].join("\n");

  return executiveReportSchema.parse({
    id: crypto.randomUUID(),
    projectId: verdict.projectId,
    systemId: input.systemId ?? null,
    projectName: verdict.projectName,
    generatedAt: now,
    overall: verdict.status,
    productionReadiness: verdict.productionReadiness,
    buckets: { verifiedPct, unverifiedPct, unknownPct },
    counts: {
      criticalBlockers: verdict.criticalBlockers,
      highRisks: verdict.highRisks,
      medium: Math.max(0, verdict.blockerItems.filter((b) => b.severity === "MEDIUM").length),
      verifiedClaims: verdict.verifiedClaims,
      unverifiedClaims: verdict.unverifiedClaims,
    },
    topRisks,
    recommendedActions,
    verdict,
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
