import { z } from "zod";

/**
 * External project Supabase/Postgres as observation feed — NOT Atlas primary store.
 * Secret values (service role, passwords) must never enter LLM context.
 */
export const supabaseFeedInputSchema = z.object({
  projectId: z.string().uuid(),
  /** Public project URL or host label only — not credentials. */
  hostLabel: z.string().min(1).max(200),
  tables: z.array(z.string().min(1).max(120)).min(1).max(500),
  rlsEnabled: z.boolean().nullable().optional(),
  schemaName: z.string().min(1).max(64).default("public"),
});

export type SupabaseFeedInput = z.infer<typeof supabaseFeedInputSchema>;

export function summarizeSupabaseFeed(input: SupabaseFeedInput): {
  summary: string;
  tableCount: number;
  names: readonly string[];
} {
  return {
    summary: `Supabase/${input.schemaName} @ ${input.hostLabel}: ${input.tables.length} tables`,
    tableCount: input.tables.length,
    names: input.tables,
  };
}
