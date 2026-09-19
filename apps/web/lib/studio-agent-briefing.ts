export interface StudioMemoryCitation {
  readonly id: string;
  readonly type: string;
  readonly epistemicState: string;
  readonly category?: string;
  readonly source?: string;
  readonly statement: string;
}

export interface StudioAgentBriefingFile {
  readonly path: string;
  readonly action: string;
  readonly summary?: string;
}

export interface StudioAgentBriefingPatch {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly filesChanged?: readonly StudioAgentBriefingFile[];
  readonly evaluationSummary?: string | null;
  readonly epistemicState?: string;
  readonly confidence?: number;
  readonly authorityHint?: string;
}

export interface StudioAgentBriefingInput {
  readonly patch: StudioAgentBriefingPatch | null;
  readonly note: string;
  readonly memoryUsed?: number;
  readonly memoryCitations?: readonly StudioMemoryCitation[];
  readonly intelligenceKind?: string;
  readonly modelInvoked?: boolean;
  readonly findingRemediation?: {
    readonly result: string;
    readonly verifyStatus: string;
    readonly findingPresence: string;
    readonly summary: string;
  } | null;
}

export interface StudioAgentBriefingView {
  readonly hasPatch: boolean;
  readonly intelligenceKind: string;
  readonly modelInvoked: boolean;
  readonly memoryUsed: number;
  readonly citations: readonly StudioMemoryCitation[];
  readonly files: readonly StudioAgentBriefingFile[];
  readonly epistemicState: string | null;
  readonly evaluationSummary: string | null;
  readonly authorityHint: string | null;
  readonly note: string;
  readonly findingRemediation: StudioAgentBriefingInput["findingRemediation"];
}

/** Surface what the agent proposed — not hidden chain-of-thought. */
export function studioAgentBriefing(
  input: StudioAgentBriefingInput,
): StudioAgentBriefingView {
  const citations = input.memoryCitations ?? [];
  return {
    hasPatch: Boolean(input.patch),
    intelligenceKind: input.intelligenceKind?.trim() || "unknown",
    modelInvoked: input.modelInvoked === true,
    memoryUsed: typeof input.memoryUsed === "number" ? input.memoryUsed : citations.length,
    citations,
    files: input.patch?.filesChanged ?? [],
    epistemicState: input.patch?.epistemicState ?? null,
    evaluationSummary: input.patch?.evaluationSummary ?? null,
    authorityHint: input.patch?.authorityHint ?? null,
    note: input.note,
    findingRemediation: input.findingRemediation ?? null,
  };
}
