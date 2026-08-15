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
    const findings = [
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
    ];
    const counselTopics = [
      "Confirm product type (SaaS / publisher / UGC / ads) with licensed counsel",
      "IL — Privacy Protection Authority, Justice, Communications, INCD portals",
      "EU — GDPR + AI Act + DSA official EUR-Lex texts",
      "US — FTC, DOJ, Copyright Office, California CPPA",
      "Who owns IP in AI-assisted code — after a workspace is linked",
    ];
    const summaryEn =
      "No workspaceRoot linked — cannot scan legal/media surfaces. Link a root, then re-run. This is not legal advice.";
    return legalMediaReviewSchema.parse({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      generatedAt: now,
      disclaimerEn: LEGAL_MEDIA_DISCLAIMER_EN,
      disclaimerHe: LEGAL_MEDIA_DISCLAIMER_HE,
      disclaimerAr: LEGAL_MEDIA_DISCLAIMER_AR,
      lawyerReadiness: "INSUFFICIENT_EVIDENCE",
      summaryEn,
      summaryHe:
        "אין workspaceRoot מקושר — לא ניתן לסרוק משטחי משפט/מדיה. קשרו נתיב והריצו שוב. אין זו ייעוץ משפטי.",
      findings,
      counselTopics,
      verifiedSources: sources,
      epistemicState: "INSUFFICIENT_EVIDENCE",
      notALawyer: true,
      briefMarkdown: buildBriefMarkdown({
        lawyerReadiness: "INSUFFICIENT_EVIDENCE",
        summaryEn,
        findings,
        counselTopics,
        sources,
      }),
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
    finding({
      id: "oss-license",
      area: "ip",
      status: has(/^(?:.*\/)?LICENSE(?:\.\w+)?$/m) || has(/spdx-license|mit license|apache license|gnu gpl/i)
        ? "PASS"
        : "WARN",
      severity: "HIGH",
      title: "Open-source license file",
      note: has(/license|spdx-license|mit license|apache license|gnu gpl/i)
        ? "License signals found — counsel should confirm inbound/outbound obligations."
        : "No clear LICENSE / SPDX signal — a high-tech lawyer will ask who may use this code.",
      fixHint: "Add a LICENSE (and NOTICE if needed) and list third-party licenses.",
      evidenceRefs: has(/license|spdx-license|mit license|apache license/i)
        ? ["license-signal"]
        : [],
    }),
    finding({
      id: "secret-leak",
      area: "security",
      status: has(
        /AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|api[_-]?secret\s*[:=]\s*['"][^'"]{8,}|sk_live_|ghp_[A-Za-z0-9]{20,}/i,
      )
        ? "FAIL"
        : "PASS",
      severity: "CRITICAL",
      title: "Credential / secret patterns",
      note: has(
        /AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|api[_-]?secret\s*[:=]\s*['"][^'"]{8,}|sk_live_|ghp_[A-Za-z0-9]{20,}/i,
      )
        ? "Possible live credentials in the tree — counsel and security must treat this as incident material."
        : "No obvious live-key patterns in the sampled tree. Not a guarantee the repo is clean.",
      fixHint: "Rotate anything that looks live; move secrets to a vault; never commit keys.",
      evidenceRefs: has(/AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|sk_live_|ghp_/i)
        ? ["secret-signal"]
        : [],
    }),
    finding({
      id: "auth-tenant",
      area: "security",
      status: has(/oauth|openid|session|jwt|rbac|tenant.?isolat|row.?level.?security|login|auth0|clerk/i)
        ? "PASS"
        : "WARN",
      severity: "HIGH",
      title: "Auth / tenant isolation signals",
      note: has(/oauth|openid|session|jwt|rbac|tenant|login/i)
        ? "Auth/session signals present — counsel still needs the data-flow story."
        : "Weak auth/tenant signals — a SaaS diligence review will stop here.",
      fixHint: "Document login, roles, and tenant isolation before counsel review.",
      evidenceRefs: has(/oauth|openid|session|jwt|login/i) ? ["auth-signal"] : [],
    }),
    finding({
      id: "ai-system-surfaces",
      area: "ai",
      status: has(
        /openai|anthropic|llm|gpt-|claude|gemini|foundry|copilot|model.?card|ai.?act/i,
      )
        ? has(
            /transparenc|model.?card|ai.?disclosure|human.?oversight|high.?risk|ai.?act/i,
          )
          ? "PASS"
          : "WARN"
        : "UNKNOWN",
      severity: "HIGH",
      title: "AI system surfaces (counsel pointer)",
      note: has(/openai|anthropic|llm|gpt-|claude|gemini|foundry|copilot/i)
        ? has(/transparenc|model.?card|ai.?disclosure|human.?oversight|ai.?act/i)
          ? "AI + transparency language found — counsel should still map EU AI Act / DSA duties."
          : "AI/LLM signals without transparency language — raise EU AI Act and product disclosure with counsel."
        : "No AI/LLM signals in the sampled tree — skip AI Act only if counsel confirms the product is not an AI system.",
      fixHint:
        "If the product is an AI system: document purpose, human oversight, and user-facing disclosure before the lawyer meeting. Not a legal classification.",
      evidenceRefs: has(/openai|anthropic|llm|gpt-|claude|gemini|foundry|copilot/i)
        ? ["ai-signal"]
        : [],
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
    "IL — Privacy Protection Authority guidance vs product data flows and databases",
    "IL — Communications / broadcast licensing only if the product is regulated media",
    "IL — Cyber incident notification (INCD) if credentials or personal data leak",
    "EU — GDPR controller/processor, consent, export, and erasure if EU users",
    "EU — AI Act transparency / high-risk duties if the product is an AI system",
    "EU — Digital Services Act notice-and-action if the product hosts UGC",
    "US — FTC privacy, advertising, and endorsement disclosure",
    "US — California CPPA / CCPA / CPRA if California residents are in scope",
    "US — Copyright Office + inbound/outbound OSS and AI-assisted code ownership",
    "US — DOJ portal as an enforcement pointer only — not a prediction",
    "Cross-border — which licensed attorney (IL / US / EU) owns the first meeting",
  ];

  const summaryEn =
    lawyerReadiness === "READY_FOR_COUNSEL"
      ? `Engineering package looks coherent enough to brief a high-tech lawyer (${passes} PASS · ${warns} WARN · ${fails} FAIL · ${unknowns} UNKNOWN). Still NOT legal advice.`
      : lawyerReadiness === "NEEDS_FIXES"
        ? `Fix engineering gaps before counsel deep-dive (${fails} FAIL · ${warns} WARN). Atlas is not a lawyer.`
        : `Insufficient repo evidence for a counsel-prep score (${unknowns} UNKNOWN). Link richer surfaces or documents.`;
  const summaryHe =
    lawyerReadiness === "READY_FOR_COUNSEL"
      ? `החבילה ההנדסית נראית מספיק עקבית לתדרוך עו״ד הייטק (${passes} עבר · ${warns} אזהרה · ${fails} נכשל). עדיין אין זו ייעוץ משפטי.`
      : lawyerReadiness === "NEEDS_FIXES"
        ? `יש לתקן פערים הנדסיים לפני עומק עם עו״ד (${fails} נכשל · ${warns} אזהרה). Atlas אינו עורך דין.`
        : `אין מספיק ראיות במאגר לציון מוכנות לעו״ד (${unknowns} לא ידוע).`;

  return legalMediaReviewSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    generatedAt: now,
    disclaimerEn: LEGAL_MEDIA_DISCLAIMER_EN,
    disclaimerHe: LEGAL_MEDIA_DISCLAIMER_HE,
    disclaimerAr: LEGAL_MEDIA_DISCLAIMER_AR,
    lawyerReadiness,
    summaryEn,
    summaryHe,
    findings,
    counselTopics,
    verifiedSources: sources,
    epistemicState,
    notALawyer: true,
    briefMarkdown: buildBriefMarkdown({
      lawyerReadiness,
      summaryEn,
      findings,
      counselTopics,
      sources,
    }),
  });
}

function buildBriefMarkdown(input: {
  lawyerReadiness: LawyerReadiness;
  summaryEn: string;
  findings: LegalMediaFinding[];
  counselTopics: string[];
  sources: Array<{ titleEn: string; url: string; kind: string; region: string }>;
}): string {
  const lines = [
    "# Counsel briefing pack",
    "",
    "> NOT legal advice. Atlas is not a lawyer. Give this pack to a licensed attorney.",
    "",
    `Readiness: **${input.lawyerReadiness}**`,
    "",
    input.summaryEn,
    "",
    "## Engineering findings",
    "",
  ];
  for (const f of input.findings) {
    lines.push(
      `### ${f.title}`,
      "",
      `- Status: ${f.status} · Severity: ${f.severity} · Area: ${f.area}`,
      `- ${f.note}`,
      `- Fix: ${f.fixHint}`,
      "",
    );
  }
  lines.push("## Topics for licensed counsel", "");
  for (const topic of input.counselTopics) {
    lines.push(`- ${topic}`);
  }
  lines.push("", "## Verified sources (government / university / official)", "");
  for (const s of input.sources) {
    lines.push(`- [${s.titleEn}](${s.url}) · ${s.kind} · ${s.region}`);
  }
  lines.push("");
  return lines.join("\n");
}
