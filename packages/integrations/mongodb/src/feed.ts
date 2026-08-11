import { z } from "zod";

/**
 * MongoDB observation feed — metadata only.
 * Document contents and connection secrets = DENY for LLM context.
 */
export const mongoFeedInputSchema = z.object({
  projectId: z.string().uuid(),
  hostLabel: z.string().min(1).max(200),
  databaseName: z.string().min(1).max(120),
  collections: z.array(z.string().min(1).max(120)).min(1).max(500),
  indexCount: z.number().int().min(0).optional(),
});

export type MongoFeedInput = z.infer<typeof mongoFeedInputSchema>;

export function summarizeMongoFeed(input: MongoFeedInput): {
  summary: string;
  collectionCount: number;
  names: readonly string[];
} {
  return {
    summary: `MongoDB/${input.databaseName} @ ${input.hostLabel}: ${input.collections.length} collections`,
    collectionCount: input.collections.length,
    names: input.collections,
  };
}
