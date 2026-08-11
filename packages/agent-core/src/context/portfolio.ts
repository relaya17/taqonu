import type { ContextBlock } from "./builder.js";
import type {
  Decision,
  EvidenceRecord,
  Memory,
  Project,
  ProjectStateSnapshot,
} from "@atlas/shared";

export function buildPortfolioContextBlocks(input: {
  projects: readonly Project[];
  projectId: string | null;
  snapshot: ProjectStateSnapshot | null;
  decisions: readonly Decision[];
  memories: readonly Memory[];
  evidence: readonly EvidenceRecord[];
}): ContextBlock[] {
  const blocks: ContextBlock[] = [];

  blocks.push({
    category: "ROADMAP_TASK",
    epistemicState: input.projects.length > 0 ? "FACT" : "UNKNOWN",
    title: "Portfolio registry",
    content:
      input.projects.length === 0
        ? "No projects registered. Run GitHub discover."
        : input.projects
            .map((p) => `${p.name} (${p.slug}) [${p.status}]`)
            .join("; "),
  });

  if (input.snapshot) {
    for (const slice of input.snapshot.slices) {
      blocks.push({
        category: "REPOSITORY_EVIDENCE",
        epistemicState: slice.epistemicState,
        title: `Current State · ${slice.key}`,
        content: slice.summary,
      });
    }
  } else if (input.projectId) {
    blocks.push({
      category: "REPOSITORY_EVIDENCE",
      epistemicState: "UNKNOWN",
      title: "Current State",
      content: "No reconciled snapshot for selected project.",
    });
  }

  for (const decision of input.decisions.filter((d) => d.status === "ACTIVE").slice(-8)) {
    blocks.push({
      category: "DECISION_MEMORY",
      epistemicState: decision.epistemicState,
      title: "Decision",
      content: decision.decision,
    });
  }

  for (const memory of input.memories.slice(-8)) {
    blocks.push({
      category: "EVENT_MEMORY",
      epistemicState: memory.epistemicState,
      title: `Memory (${memory.type})`,
      content: memory.statement,
    });
  }

  if (input.evidence.length > 0) {
    blocks.push({
      category: "REPOSITORY_EVIDENCE",
      epistemicState: "FACT",
      title: "Evidence inventory",
      content: `${input.evidence.length} evidence records attached (excerpts omitted if sensitive).`,
    });
  }

  return blocks;
}
