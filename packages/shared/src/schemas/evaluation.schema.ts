import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

export const evalDimensionSchema = z.enum([
  "ACCURACY",
  "RETRIEVAL",
  "MEMORY",
  "EVIDENCE",
  "SECURITY",
  "AUTHORIZATION",
  "TOOL_SELECTION",
  "REGRESSION",
]);

export const evalSuiteSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  dimensions: z.array(evalDimensionSchema).min(1),
  writeUnlockRequired: z.boolean(),
  createdAt: isoDateTimeSchema,
});

export const evalRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "PASSED",
  "FAILED",
]);

export const evalResultSchema = z.object({
  dimension: evalDimensionSchema,
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  notes: z.string().max(2000).nullable(),
});

export const evalRunSchema = z.object({
  id: uuidSchema,
  suiteId: uuidSchema,
  status: evalRunStatusSchema,
  results: z.array(evalResultSchema).default([]),
  writeGateOpen: z.boolean(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});

export const createEvalRunSchema = z.object({
  suiteId: uuidSchema,
});

/**
 * WRITE remains closed until every required dimension passes.
 * This is an architecture gate, not a UI toggle.
 */
export function isWriteGateOpen(
  results: readonly z.infer<typeof evalResultSchema>[],
  required: readonly z.infer<typeof evalDimensionSchema>[],
): boolean {
  return required.every((dimension) =>
    results.some((result) => result.dimension === dimension && result.passed),
  );
}

export type EvalSuite = z.infer<typeof evalSuiteSchema>;
export type EvalRun = z.infer<typeof evalRunSchema>;
export type EvalResult = z.infer<typeof evalResultSchema>;
