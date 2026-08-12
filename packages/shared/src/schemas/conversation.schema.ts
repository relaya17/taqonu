import { z } from "zod";
import {
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

/** Conversation turn — Atlas answers with cited evidence or refuses thin claims. */
export const createConversationMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  projectId: uuidSchema.nullable().optional(),
  threadId: uuidSchema.nullable().optional(),
  /** Catalog id — defaults to free echo path (arletos-included). */
  aiProviderId: z
    .enum([
      "arletos-included",
      "claude-haiku",
      "deepseek-chat",
      "gpt-4o-mini",
      "gemini-flash",
      "llama-groq",
      "llama-local",
      "claude-sonnet",
      "gpt-4o",
      "gemini-pro",
      "claude-opus",
      "o3-mini",
    ])
    .optional(),
  locale: z.enum(["en", "he", "ar"]).optional(),
});

export const conversationEvidenceRefSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["memory", "evidence", "knowledge", "decision", "snapshot"]),
  reference: z.string().min(1).max(500),
  excerpt: z.string().max(4000).optional(),
  epistemicState: epistemicStateSchema.optional(),
});

export const conversationMessageResponseSchema = z.object({
  messageId: uuidSchema,
  threadId: uuidSchema,
  answer: z.string().min(1).max(50000),
  epistemicLabel: epistemicStateSchema,
  evidenceRefs: z.array(conversationEvidenceRefSchema),
  memoryContext: z.object({
    items: z.array(z.record(z.string(), z.unknown())),
    budget: z.number().int().nonnegative(),
    truncated: z.boolean(),
    epistemicState: z.enum(["OBSERVED", "INFERRED"]),
    note: z.string(),
  }),
  knowledgePlainLanguage: z.string().nullable(),
  runId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export type CreateConversationMessage = z.infer<
  typeof createConversationMessageSchema
>;
export type ConversationEvidenceRef = z.infer<
  typeof conversationEvidenceRefSchema
>;
export type ConversationMessageResponse = z.infer<
  typeof conversationMessageResponseSchema
>;
