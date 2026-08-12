import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  LEGAL_MEDIA_DISCLAIMER_AR,
  LEGAL_MEDIA_DISCLAIMER_EN,
  LEGAL_MEDIA_DISCLAIMER_HE,
  VERIFIED_LEGAL_MEDIA_SOURCES,
  legalMediaReviewSchema,
  type LegalMediaFinding,
  type LegalMediaReview,
  type LawyerReadiness,
} from "@atlas/shared";

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  ".turbo",
  "build",
]);

function walkFiles(root: string, maxFiles = 400): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (
        st.isFile() &&
        st.size < 400_000 &&
        /\.(tsx?|jsx?|md|json|html?)$/i.test(name)
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

function readBlob(root: string): { text: string; fileNames: string } {
  const files = walkFiles(root);
  const chunks: string[] = [];
  const names: string[] = [];
  for (const file of files.slice(0, 250)) {
    names.push(relative(root, file).replaceAll("\\", "/"));
    try {
      chunks.push(readFileSync(file, "utf8").slice(0, 12_000));
    } catch {
      // skip
    }
  }
  return { text: chunks.join("\n"), fileNames: names.join("\n") };
}

function finding(
  partial: Omit<LegalMediaFinding, "id" | "epistemicState"> & {
    id: string;
  },
): LegalMediaFinding {
  return {
    ...partial,
    epistemicState:
      partial.status === "PASS"
        ? "FACT"
        : partial.status === "UNKNOWN"
          ? "UNKNOWN"
          : "INFERRED",
  };
}

/**
 * Heuristic counsel-prep review for media/comms apps.
 * NOT legal advice — READY_FOR_COUNSEL means “package is coherent enough to brief a lawyer”.
 */
export function runLegalMediaReview(input: {
  readonly projectId: string | null;
  readonly workspaceRoot: string | null;
}): LegalMediaReview {
  const now = new Date().toISOString();
  const sources = VERIFIED_LEGAL_MEDIA_SOURCES.map((s) => ({
    id: s.id,
    titleEn: s.titleEn,
    titleHe: s.titleHe,
    url: s.url,
    kind: s.kind,
    region: s.region,
    topics: [...s.topics],
  }));

  if (!input.workspaceRoot) {
    return legalMediaReviewSchema.parse({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      generatedAt: now,
      disclaimerEn: LEGAL_MEDIA_DISCLAIMER_EN,
      disclaimerHe: LEGAL_MEDIA_DISCLAIMER_HE,
      disclaimerAr: LEGAL_MEDIA_DISCLAIMER_AR,
      lawyerReadiness: "INSUFFICIENT_EVIDENCE",
      summaryEn:
        "No workspaceRoot linked — cannot scan legal/media surfaces. Link a root, then re-run. This is not legal advice.",
      summaryHe:
        "אין workspaceRoot מקושר — לא ניתן לסרוק משטחי משפט/מדיה. קשרו נתיב והריצו שוב. אין זו ייעוץ משפטי.",
      findings: [
        finding({
          id: "no-root",
          area: "evidence",
          status: "UNKNOWN",
          severity: "HIGH",
          title: "Missing workspace evidence",
          note: "Counsel-prep scan requires a linked project root.",
          fixHint: "PUT /projects/:id/workspace-root then re-run legal media review.",
          evidenceRefs: [],
        }),
      ],
      counselTopics: [
        "Confirm product type (publisher / UGC / ads / broadcast-adjacent)",
        "Map jurisdictions (IL / EU / US) with counsel",
      ],
      verifiedSources: sources,
      epistemicState: "INSUFFICIENT_EVIDENCE",
      notALawyer: true,
    });
  }

  const { text, fileNames } = readBlob(input.workspaceRoot);
  const blob = `${fileNames}\n${text}`;
  const has = (re: RegExp) => re.test(blob);

  const findings: LegalMediaFinding[] = [
    finding({
      id: "privacy-terms",
      area: "privacy",
      status: has(/privacy|terms.?of.?service|תנאי\s*שימוש|מדיניות\s*פרטיות|privacy-policy|\/privacy|\/terms/i)
        ? "PASS"
        : "FAIL",
      severity: "HIGH",
      title: "Privacy / Terms surfaces",
      note: has(/privacy|terms/i)
        ? "Privacy/Terms strings or routes found in repo."
        : "No clear Privacy/Terms route or policy copy — counsel will flag this first.",
      fixHint: "Add discoverable Privacy + Terms pages (and footer links) before counsel review.",
      evidenceRefs: has(/privacy|terms/i) ? ["privacy-or-terms-signal"] : [],
    }),
    finding({
      id: "cookies-consent",
      area: "consent",
      status: has(/cookie|consent.?banner|gdpr|consentMode|cookiebot|onetrust|הסכמה|קוקי/i)
        ? "PASS"
        : "WARN",
      severity: "MEDIUM",
      title: "Cookie / tracking consent",
      note: has(/cookie|consent|gdpr/i)
        ? "Consent/cookie signals present."
        : "No cookie/consent tooling signals — needed if analytics/ads run in IL/EU.",
      fixHint: "Document trackers; add consent UX if non-essential cookies/ads exist.",
      evidenceRefs: has(/cookie|consent|gdpr/i) ? ["consent-signal"] : [],
    }),
    finding({
      id: "dsr-export-delete",
      area: "data-subject-rights",
      status: has(/export.?data|delete.?account|erasure|data.?subject|מחיקת\s*חשבון|ייצוא\s*נתונים|right.?to.?be.?forgotten/i)
        ? "PASS"
        : "WARN",
      severity: "HIGH",
      title: "Export / deletion paths",
      note: has(/export.?data|delete.?account|erasure|מחיק/i)
        ? "Export/deletion language or routes found."
        : "No export/delete account signals — counsel often requires a plan.",
      fixHint: "Add account deletion + data export flows or document operator process.",
      evidenceRefs: has(/export.?data|delete.?account|erasure|מחיק/i)
        ? ["dsr-signal"]
        : [],
    }),
    finding({
      id: "ugc-moderation",
      area: "ugc",
      status: has(/moderat|report.?content|takedown|ugc|user.?generated|דיווח\s*על\s*תוכן|הסרת\s*תוכן/i)
        ? "PASS"
        : has(/comment|post|upload|publish|feed/i)
          ? "WARN"
          : "UNKNOWN",
      severity: "HIGH",
      title: "UGC / moderation hooks",
      note: has(/moderat|takedown|report.?content/i)
        ? "Moderation/takedown signals found."
        : has(/comment|post|upload|publish/i)
          ? "Publishing/UGC-like surfaces without clear moderation hooks."
          : "No clear UGC surface — mark N/A with counsel if not a publisher.",
      fixHint: "If users publish content: report, review, and takedown workflows.",
      evidenceRefs: has(/moderat|takedown|report.?content/i) ? ["ugc-signal"] : [],
    }),
    finding({
      id: "ads-disclosure",
      area: "advertising",
      status: has(/sponsored|advertis|ad.?disclosure|שיווק|ממומן|פרסומ/i)
        ? "PASS"
        : "UNKNOWN",
      severity: "MEDIUM",
      title: "Advertising / sponsorship disclosure",
      note: has(/sponsored|advertis|ממומן|פרסומ/i)
        ? "Ad/sponsorship language present — counsel should review disclosure UX."
        : "No ad signals — confirm with counsel if monetization plans exist.",
      fixHint: "Label paid/sponsored content clearly; review with counsel for IL/US/EU rules.",
      evidenceRefs: has(/sponsored|advertis|ממומן|פרסומ/i) ? ["ads-signal"] : [],
    }),
    finding({
      id: "copyright-media",
      area: "copyright",
      status: has(/license|copyright|attribution|creativecommons|זכויות\s*יוצרים|רישיון/i)
        ? "PASS"
        : "WARN",
      severity: "MEDIUM",
      title: "Copyright / media licensing",
      note: has(/license|copyright|attribution|creativecommons|זכויות/i)
        ? "License/copyright signals found."
        : "Few copyright/attribution signals for media assets.",
      fixHint: "Track asset licenses; show attribution where required; avoid unlicensed stock.",
      evidenceRefs: has(/license|copyright|attribution|creativecommons|זכויות/i)
        ? ["copyright-signal"]
        : [],
    }),
    finding({
      id: "minors",
      area: "minors",
      status: has(/coppa|age.?gate|under.?13|under.?18|גיל\s*מינימ|ילדים/i)
        ? "PASS"
        : "UNKNOWN",
      severity: "CRITICAL",
      title: "Minors / age gating",
      note: has(/coppa|age.?gate|under.?13|ילדים/i)
        ? "Age/minors signals found — counsel must review."
        : "No age-gate signals — confirm audience with counsel if any youth content.",
      fixHint: "If under-18 audience: age gate + parental rules with counsel.",
      evidenceRefs: has(/coppa|age.?gate|under.?13|ילדים/i) ? ["minors-signal"] : [],
    }),
    finding({
      id: "entity-contact",
      area: "entity",
      status: has(/company|בע״מ|בע"מ|legal@|contact@|registered.?office|ח\.פ|ע\.מ/i)
        ? "PASS"
        : "WARN",
      severity: "MEDIUM",
      title: "Legal entity / contact",
      note: has(/company|בע״מ|legal@|contact@|ח\.פ/i)
        ? "Entity/contact signals present."
        : "Weak legal entity / contact disclosure for a public media product.",
      fixHint: "Publish operator identity + contact for legal notices.",
      evidenceRefs: has(/company|בע״מ|legal@|contact@|ח\.פ/i) ? ["entity-signal"] : [],
    }),
  ];

  const fails = findings.filter((f) => f.status === "FAIL").length;
  const warns = findings.filter((f) => f.status === "WARN").length;
  const unknowns = findings.filter((f) => f.status === "UNKNOWN").length;
  const passes = findings.filter((f) => f.status === "PASS").length;

  let lawyerReadiness: LawyerReadiness;
  let epistemicState: LegalMediaReview["epistemicState"];
  if (passes === 0 && fails === 0) {
    lawyerReadiness = "INSUFFICIENT_EVIDENCE";
    epistemicState = "INSUFFICIENT_EVIDENCE";
  } else if (fails > 0 || warns >= 3) {
    lawyerReadiness = "NEEDS_FIXES";
    epistemicState = "INFERRED";
  } else {
    lawyerReadiness = "READY_FOR_COUNSEL";
    epistemicState = "INFERRED";
  }

  const counselTopics = [
    "Israel Privacy Protection Authority guidance vs product data flows",
    "Whether UGC / publishing triggers notice-and-takedown duties",
    "Advertising and sponsorship disclosure (IL + target markets)",
    "Cross-border processing (EU GDPR / US FTC) if users abroad",
    "Broadcast / communications licensing only if product is regulated media",
  ];

  return legalMediaReviewSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    generatedAt: now,
    disclaimerEn: LEGAL_MEDIA_DISCLAIMER_EN,
    disclaimerHe: LEGAL_MEDIA_DISCLAIMER_HE,
    disclaimerAr: LEGAL_MEDIA_DISCLAIMER_AR,
    lawyerReadiness,
    summaryEn:
      lawyerReadiness === "READY_FOR_COUNSEL"
        ? `Engineering package looks coherent enough to brief a media/comms lawyer (${passes} PASS · ${warns} WARN · ${fails} FAIL · ${unknowns} UNKNOWN). Still NOT legal advice.`
        : lawyerReadiness === "NEEDS_FIXES"
          ? `Fix engineering gaps before counsel deep-dive (${fails} FAIL · ${warns} WARN). Atlas is not a lawyer.`
          : `Insufficient repo evidence for a counsel-prep score (${unknowns} UNKNOWN). Link richer surfaces or documents.`,
    summaryHe:
      lawyerReadiness === "READY_FOR_COUNSEL"
        ? `החבילה ההנדסית נראית מספיק עקבית לתדרוך עו״ד מדיה/תקשורת (${passes} עבר · ${warns} אזהרה · ${fails} נכשל). עדיין אין זו ייעוץ משפטי.`
        : lawyerReadiness === "NEEDS_FIXES"
          ? `יש לתקן פערים הנדסיים לפני עומק עם עו״ד (${fails} נכשל · ${warns} אזהרה). Atlas אינו עורך דין.`
          : `אין מספיק ראיות במאגר לציון מוכנות לעו״ד (${unknowns} לא ידוע).`,
    findings,
    counselTopics,
    verifiedSources: sources,
    epistemicState,
    notALawyer: true,
  });
}
