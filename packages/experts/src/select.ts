import {
  EXPERT_CATALOG,
  type ExpertId,
  type ExpertSelection,
} from "@atlas/shared";

/**
 * Note: JS `\b` is ASCII-oriented and breaks Hebrew/Arabic matching.
 * Use plain substring patterns for multilingual routing.
 */
const RULES: Array<{
  readonly expert: ExpertId;
  readonly pattern: RegExp;
}> = [
  {
    expert: "QA",
    pattern: /qa|test|regression|אבטחת\s*איכות|בדיק|اختبار|جودة/i,
  },
  {
    expert: "UI_UX",
    pattern: /ui|ux|flow|usability|ממשק|חווי|واجهة|تجربة|מסך/i,
  },
  {
    expert: "VISUAL_DESIGN",
    pattern: /design|visual|brand|figma|photoshop|טיפוגר|צבע|עיצוב|تصميم|شعار/i,
  },
  {
    expert: "ACCESSIBILITY",
    pattern: /a11y|accessibility|wcag|rtl|נגיש|إتاحة|contrast/i,
  },
  {
    expert: "SECURITY",
    pattern: /security|rls|secret|auth|אבטח|أمن|injection/i,
  },
  {
    expert: "DEVOPS",
    pattern: /deploy|ci\/cd|docker|vercel|devops|פריס|نشر/i,
  },
  {
    expert: "PRODUCT",
    pattern: /product|roadmap|mvp|scope|מוצר|نطاق|أولوية/i,
  },
  {
    expert: "CONTENT",
    pattern: /copy|microcopy|tone|wording|תוכן|קופי|نص|محتوى|cta/i,
  },
  {
    expert: "LEGAL_MEDIA",
    pattern:
      /legal|lawyer|counsel|משפט|עו״ד|עורך\s*דין|محام|قانون|media\s*law|תקשורת|מדיה|privacy\s*law|defamation|שיימינג|שידור|broadcast|ugc|gdpr|פרטיות/i,
  },
  {
    expert: "MOTION",
    pattern: /motion|animation|transition|תנועה|אנימצ|حركة|انيم/i,
  },
  {
    expert: "ENGINEERING",
    pattern: /architect|api|schema|refactor|הנדס|كود|architecture/i,
  },
];

export function selectExperts(
  request: string,
  forced?: readonly ExpertId[],
): ExpertSelection {
  if (forced && forced.length > 0) {
    const [primary, ...supporting] = forced;
    return {
      primary: primary!,
      supporting: supporting.slice(0, 4),
      rationale: "User-selected expert council",
    };
  }

  const hits: ExpertId[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(request) && !hits.includes(rule.expert)) {
      hits.push(rule.expert);
    }
  }

  if (hits.length === 0) {
    return {
      primary: "ENGINEERING",
      supporting: ["PRODUCT"],
      rationale: "Default engineering + product scope guard",
    };
  }

  return {
    primary: hits[0]!,
    supporting: hits.slice(1, 4),
    rationale: `Matched experts from request: ${hits.join(", ")}`,
  };
}

export function buildExpertSystemBlock(selection: ExpertSelection): string {
  const ordered = [selection.primary, ...selection.supporting];
  const unique = [...new Set(ordered)];
  const lines: string[] = [
    "### Expert Council",
    `Primary: ${selection.primary}`,
    `Supporting: ${selection.supporting.join(", ") || "none"}`,
    `Why: ${selection.rationale}`,
    "",
  ];
  for (const id of unique) {
    const def = EXPERT_CATALOG[id];
    lines.push(`#### ${def.titleEn} / ${def.titleHe}`);
    lines.push(def.systemDiscipline);
    lines.push(`Focus: ${def.focus}`);
    lines.push(`Checklist: ${def.checklist.join(" · ")}`);
    lines.push("");
  }
  lines.push(
    "Hard rule: ArletOS is not an IDE. For coding/terminal use Cursor / Claude Code; provide briefs, not an embedded Visual Studio.",
  );
  return lines.join("\n");
}

export function listExperts() {
  return Object.values(EXPERT_CATALOG);
}
