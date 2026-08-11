import {
  EXPERT_CATALOG,
  expertReviewSchema,
  type CreateExpertReview,
  type ExpertFinding,
  type ExpertId,
  type ExpertReview,
} from "@atlas/shared";

function severityForStatus(
  status: ExpertFinding["status"],
): ExpertFinding["severity"] {
  switch (status) {
    case "FAIL":
      return "HIGH";
    case "WARN":
      return "MEDIUM";
    case "PASS":
      return "LOW";
    default:
      return "LOW";
  }
}

function scoreChecklistItem(
  expertId: ExpertId,
  item: string,
  request: string,
  hasProject: boolean,
): Pick<ExpertFinding, "status" | "note" | "epistemicState"> {
  const lower = request.toLowerCase();
  const itemLower = item.toLowerCase();

  const mentionsMobile =
    /mobile|מובייל|נייד|هاتف|responsive/i.test(request) &&
    /mobile|desktop|responsive/i.test(item);
  const mentionsEmpty =
    /empty|ריק|فارغ|error state/i.test(request) && /empty|error/i.test(item);
  const mentionsType =
    /font|type|טיפוגר|خط|inter|roboto/i.test(request) &&
    /type|טיפוגר|inter|roboto/i.test(item);
  const mentionsPhotoshop =
    /photoshop|figma|illustrator|export|ייצוא|تصدير/i.test(request) &&
    /export|photoshop|figma|handoff/i.test(item);
  const mentionsStyle =
    /style|brutal|editorial|glass|minimal|סגנון|أسلوب/i.test(request) &&
    /style|atmosphere|cliché|cliche/i.test(item);

  if (mentionsMobile || mentionsEmpty || mentionsType || mentionsPhotoshop || mentionsStyle) {
    return {
      status: "WARN",
      note: `Request explicitly touches “${item}” — needs a focused pass before ship.`,
      epistemicState: "INFERRED",
    };
  }

  if (!hasProject) {
    return {
      status: "UNKNOWN",
      note: "No project selected — cannot verify against Current State evidence.",
      epistemicState: "UNKNOWN",
    };
  }

  // Design/UI reviews of registered projects without UI evidence stay inferred.
  if (
    (expertId === "UI_UX" || expertId === "VISUAL_DESIGN" || expertId === "ACCESSIBILITY") &&
    /hero|dashboard|clutter|spacing|contrast|rtl/i.test(itemLower)
  ) {
    return {
      status: "WARN",
      note: "No UI screenshot/evidence attached yet — treat as review prompt, not FACT.",
      epistemicState: "INFERRED",
    };
  }

  if (/secret|rls|injection/i.test(itemLower) && /security|אבטח|أمن/i.test(lower)) {
    return {
      status: "WARN",
      note: "Security-sensitive checklist item flagged by the request wording.",
      epistemicState: "INFERRED",
    };
  }

  return {
    status: "UNKNOWN",
    note: "Not enough labeled evidence to PASS/FAIL — expert recommends a manual check.",
    epistemicState: "UNKNOWN",
  };
}

export function runExpertReview(
  input: CreateExpertReview,
  options?: { readonly projectName?: string | null },
): ExpertReview {
  const def = EXPERT_CATALOG[input.expertId];
  const hasProject = Boolean(input.projectId);
  const now = new Date().toISOString();

  const findings: ExpertFinding[] = def.checklist.map((checklistItem) => {
    const scored = scoreChecklistItem(
      input.expertId,
      checklistItem,
      input.userRequest,
      hasProject,
    );
    return {
      id: crypto.randomUUID(),
      checklistItem,
      status: scored.status,
      severity: severityForStatus(scored.status),
      note: scored.note,
      epistemicState: scored.epistemicState,
    };
  });

  const statusCounts = {
    PASS: findings.filter((f) => f.status === "PASS").length,
    WARN: findings.filter((f) => f.status === "WARN").length,
    FAIL: findings.filter((f) => f.status === "FAIL").length,
    UNKNOWN: findings.filter((f) => f.status === "UNKNOWN").length,
  };

  const recommendations: string[] = [];
  if (input.expertId === "UI_UX") {
    recommendations.push(
      "Walk the primary user job in ≤3 steps; remove competing CTAs.",
      "Add empty + error states for every list/form screen.",
    );
  }
  if (input.expertId === "VISUAL_DESIGN") {
    recommendations.push(
      "Name one style direction and stick to it across the first viewport.",
      "Produce Photoshop/Figma export sheet: artboard sizes, @2x PNG/SVG, layer names.",
      "Define type scale + color tokens before more screens.",
    );
  }
  if (input.expertId === "ACCESSIBILITY") {
    recommendations.push("Verify RTL he/ar layout and focus order on the checked screen.");
  }
  if (recommendations.length === 0) {
    recommendations.push(
      `Re-run with more concrete artifacts (URL, screenshot notes, or repo path) for ${def.titleEn}.`,
    );
  }

  const projectLabel = options?.projectName
    ? ` on “${options.projectName}”`
    : hasProject
      ? " on the selected project"
      : " (portfolio-level, no project)";

  const summary = [
    `${def.titleHe} / ${def.titleEn} review${projectLabel}.`,
    `Request: ${input.userRequest}`,
    `Checklist: ${statusCounts.WARN} warn · ${statusCounts.FAIL} fail · ${statusCounts.UNKNOWN} unknown · ${statusCounts.PASS} pass.`,
    "Results are INFERRED until UI/design evidence is attached — not FACT.",
  ].join(" ");

  return expertReviewSchema.parse({
    id: crypto.randomUUID(),
    expertId: input.expertId,
    projectId: input.projectId ?? null,
    userRequest: input.userRequest,
    summary,
    findings,
    recommendations,
    statusCounts,
    epistemicState: hasProject ? "INFERRED" : "UNKNOWN",
    createdAt: now,
  });
}
