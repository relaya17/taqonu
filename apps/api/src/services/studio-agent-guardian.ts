/**
 * Studio-side Guardian adapter: bound workspace scan + Atlas memories
 * → structured knowledge → deterministic evaluation. No LLM.
 */
import { analyzeRepository, readTextFile } from "@atlas/code-intelligence";
import {
  discoverProjectKnowledge,
  evaluateAgentSuggestion,
  type GuardianEvaluation,
  type MemoryKnowledgeSource,
} from "@atlas/shared";

const PACKAGE_NAME_LIMIT = 80;

function packageNamesFromWorkspace(root: string): string[] {
  const raw = readTextFile(root, "package.json");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ].slice(0, PACKAGE_NAME_LIMIT);
  } catch {
    return [];
  }
}

export function evaluateStudioProposalGuardian(input: {
  projectId: string | null;
  ownerId: string | null;
  userRequest: string;
  workspaceRoot: string;
  memories: readonly MemoryKnowledgeSource[];
  proposedFiles?: readonly string[];
  focusPath?: string | null;
}): GuardianEvaluation {
  const projectId = input.projectId ?? "";
  const ownerId = input.ownerId ?? "";
  let analysis = {
    apps: [] as string[],
    packages: [] as string[],
    sampleFiles: [] as string[],
    topLevel: [] as string[],
  };
  try {
    const scanned = analyzeRepository(input.workspaceRoot);
    analysis = {
      apps: scanned.apps,
      packages: scanned.packages,
      sampleFiles: scanned.sampleFiles,
      topLevel: scanned.topLevel,
    };
  } catch {
    /* bounded scan failed — Guardian still applies hard policy */
  }

  const snippets = [];
  if (input.focusPath) {
    const content = readTextFile(input.workspaceRoot, input.focusPath);
    if (content) {
      snippets.push({ path: input.focusPath, content });
    }
  }

  const knowledge = discoverProjectKnowledge({
    projectId,
    ownerId,
    analysis,
    packageNames: packageNamesFromWorkspace(input.workspaceRoot),
    snippets,
    memories: input.memories,
    observedAt: new Date().toISOString(),
  });

  return evaluateAgentSuggestion({
    suggestion: {
      projectId,
      ownerId,
      text: input.userRequest,
      files: input.proposedFiles ?? [],
      source: "heuristic",
    },
    knowledge,
  });
}
