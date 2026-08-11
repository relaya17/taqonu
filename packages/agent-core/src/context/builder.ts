import type { EpistemicState, KnowledgeCategory } from "@atlas/shared";

export interface ContextBlock {
  readonly category: KnowledgeCategory;
  readonly epistemicState: EpistemicState;
  readonly title: string;
  readonly content: string;
}

/**
 * Builds agent context while preserving category boundaries.
 * Categories must never be silently merged.
 */
export function buildAgentContext(blocks: readonly ContextBlock[]): string {
  const grouped = new Map<KnowledgeCategory, ContextBlock[]>();

  for (const block of blocks) {
    const existing = grouped.get(block.category) ?? [];
    existing.push(block);
    grouped.set(block.category, existing);
  }

  const sections: string[] = [
    "ATLAS CONTEXT — categories are separated; do not merge as equal facts.",
  ];

  for (const [category, items] of grouped) {
    sections.push(`\n## ${category}`);
    for (const item of items) {
      sections.push(
        `- [${item.epistemicState}] ${item.title}\n  ${item.content}`,
      );
    }
  }

  return sections.join("\n");
}
