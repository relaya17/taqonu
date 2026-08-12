import type { FabricAgentId } from "@atlas/shared";

export interface GeniusRoute {
  readonly agentIds: FabricAgentId[];
  readonly modelHint: "cheap" | "strong" | "vision" | "local" | "multi+human";
  readonly hints: string[];
}

/** Route by task fit — not “best LLM”. */
export function geniusRoute(request: string): GeniusRoute {
  const q = request.toLowerCase();
  const hints: string[] = [];
  const agents = new Set<FabricAgentId>(["ORCHESTRATOR"]);

  const add = (id: FabricAgentId, hint: string) => {
    agents.add(id);
    hints.push(hint);
  };

  if (/secur|auth|secret|inject|rls|cve|owasp/.test(q)) {
    add("SECURITY", "Security-critical → specialist + judge");
  }
  if (/a11y|accessib|wcag|screen reader|rtl|contrast/.test(q)) {
    add("ACCESSIBILITY", "Accessibility surface");
  }
  if (/ui|ux|flow|usability|responsive|design/.test(q)) {
    add("UI_UX", "UI/UX review");
  }
  if (/test|qa|regression|coverage|e2e/.test(q)) {
    add("QA", "QA strategy");
    add("TEST_ENGINEER", "Test authorship");
  }
  if (/bug|crash|stack|repro|debug|error|fail/.test(q)) {
    add("DEBUGGER", "Debugger path");
  }
  if (/architect|module|dependenc|refactor|debt|scalab/.test(q)) {
    add("ARCHITECT", "Architecture analysis");
  }
  if (/deploy|ci|cd|docker|vercel|migrat|backup|observ/.test(q)) {
    add("DEVOPS", "DevOps / infra");
  }
  if (
    /legal|lawyer|counsel|משפט|עו״ד|עורך\s*דין|media\s*law|תקשורת|מדיה|defamation|שידור|broadcast|gdpr|פרטיות\s*חוק|محام|قانون/.test(
      q,
    )
  ) {
    add("LEGAL_MEDIA_COMMS", "Legal media/comms counsel-prep (not a lawyer)");
    add("RESEARCHER", "Verified gov/university sources only");
    add("JUDGE", "Legal claims need belief gate");
  }
  if (/research|docs|standard|api spec|advisory|how does/.test(q)) {
    add("RESEARCHER", "External research package");
  }
  if (
    /omission|forgot|missing|constitution|checklist|what.?did.?we.?miss|שכחנו|חסר/.test(
      q,
    )
  ) {
    add("OMISSION_DETECTOR", "Omission Detector — what nobody asked for");
  }
  if (
    /build|תבנה|create app|new (site|app|system)|booking|הזמנות|payments?|saas/.test(
      q,
    )
  ) {
    add("OMISSION_DETECTOR", "Build intent → Constitution omissions");
    add("ARCHITECT", "Build intent → architecture baseline");
    add("SECURITY", "Build intent → security baseline");
  }
  if (/fix|patch|implement|code|generat|migrat/.test(q)) {
    add("CODE_ENGINEER", "Code change via Patch Artifact");
  }

  // Always finish with Judge for multi-specialist or high-risk intents
  if (agents.size > 2 || agents.has("SECURITY") || agents.has("CODE_ENGINEER")) {
    add("JUDGE", "Judge required for belief decision");
  }

  let modelHint: GeniusRoute["modelHint"] = "cheap";
  if (agents.has("SECURITY") || /production|critical|release/.test(q)) {
    modelHint = "multi+human";
    hints.push("Critical path → multi-agent + human escalation ready");
  } else if (agents.has("ARCHITECT") || agents.has("DEBUGGER")) {
    modelHint = "strong";
  } else if (/image|screenshot|visual|figma/.test(q)) {
    modelHint = "vision";
  } else if (/confidential|local only|air.?gap/.test(q)) {
    modelHint = "local";
  }

  if (agents.size === 1) {
    add("QA", "Default: at least one specialist beyond orchestrator");
  }

  return {
    agentIds: [...agents],
    modelHint,
    hints,
  };
}
