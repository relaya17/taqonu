import { z } from "zod";
import { EPISTEMIC_STATES, KNOWLEDGE_CATEGORIES } from "../constants/epistemic.js";

export const uuidSchema = z.string().uuid();

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const confidenceSchema = z.number().min(0).max(1);

export const epistemicStateSchema = z.enum(EPISTEMIC_STATES);

export const knowledgeCategorySchema = z.enum(KNOWLEDGE_CATEGORIES);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  });

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
