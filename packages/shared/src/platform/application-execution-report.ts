/**
 * Application execution report-back — evidence after a hop, not permission to run.
 *
 * Separate from atlas.application-preflight.v1.
 * Preflight remains authorization-only (executed: false).
 * A report is not SUCCESS merely because it is accepted.
 */

import { z } from "zod";
import {
  APPLICATION_PREFLIGHT_COMPLETION_PATHS,
  applicationOwnedAgentId,
} from "./application-preflight.js";

export const APPLICATION_EXECUTION_REPORT_SCHEMA =
  "atlas.application-execution-report.v1" as const;

export const APPLICATION_EXECUTION_REPORT_PATH =
  "/api/v1/governance/application-execution-report" as const;

export const APPLICATION_EXECUTION_STATUSES = ["SUCCESS", "FAILURE"] as const;
export type ApplicationExecutionStatus =
  (typeof APPLICATION_EXECUTION_STATUSES)[number];

/**
 * Application-attested token counts. Atlas does not infer a total from
 * prompt/completion, and does not invent a count when omitted.
 */
export const applicationExecutionTokensSchema = z.union([
  z.number().int().nonnegative().max(2_000_000_000),
  z
    .object({
      prompt: z.number().int().nonnegative().max(2_000_000_000).optional(),
      completion: z.number().int().nonnegative().max(2_000_000_000).optional(),
      total: z.number().int().nonnegative().max(2_000_000_000).optional(),
    })
    .refine(
      (value) =>
        value.prompt !== undefined ||
        value.completion !== undefined ||
        value.total !== undefined,
      { message: "tokens must include a supplied count" },
    ),
]);

/**
 * Optional R14 attribution. All fields are omitted unless the application
 * actually supplies them. Not FinOps. Not estimated cost.
 */
export const applicationExecutionAttributionSchema = z.object({
  provider: z.string().trim().min(1).max(128).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  tokens: applicationExecutionTokensSchema.optional(),
  modelCallCount: z.number().int().nonnegative().max(10_000).optional(),
  retries: z.number().int().nonnegative().max(10_000).optional(),
  declaredCompletionPath: z
    .enum(APPLICATION_PREFLIGHT_COMPLETION_PATHS)
    .nullable()
    .optional(),
  actualCost: z.number().nonnegative().finite().max(1_000_000_000).optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3,8}$/)
    .optional(),
});
export type ApplicationExecutionAttribution = z.infer<
  typeof applicationExecutionAttributionSchema
>;

export const applicationExecutionReportRequestSchema = z.object({
  schemaVersion: z.literal(APPLICATION_EXECUTION_REPORT_SCHEMA),
  applicationId: z.string().trim().min(1).max(64),
  tenantId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  decisionId: z.string().trim().min(1).max(128),
  requestId: z.string().trim().min(1).max(128),
  operation: z.string().trim().min(1).max(200),
  executionId: z.string().trim().min(1).max(200),
  executionStatus: z.enum(APPLICATION_EXECUTION_STATUSES),
  agentId: z.string().trim().min(1).max(200).nullable().optional(),
  provider: applicationExecutionAttributionSchema.shape.provider,
  model: applicationExecutionAttributionSchema.shape.model,
  tokens: applicationExecutionAttributionSchema.shape.tokens,
  modelCallCount: applicationExecutionAttributionSchema.shape.modelCallCount,
  retries: applicationExecutionAttributionSchema.shape.retries,
  declaredCompletionPath:
    applicationExecutionAttributionSchema.shape.declaredCompletionPath,
  actualCost: applicationExecutionAttributionSchema.shape.actualCost,
  currency: applicationExecutionAttributionSchema.shape.currency,
});
export type ApplicationExecutionReportRequest = z.infer<
  typeof applicationExecutionReportRequestSchema
>;

export const applicationExecutionReportResponseSchema = z.object({
  schemaVersion: z.literal(APPLICATION_EXECUTION_REPORT_SCHEMA),
  accepted: z.boolean(),
  reason: z.string().min(1).max(2000),
  decisionId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
  executionId: z.string().min(1).max(200).nullable(),
  executionStatus: z.enum(APPLICATION_EXECUTION_STATUSES).nullable(),
  applicationId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(200).nullable(),
});
export type ApplicationExecutionReportResponse = z.infer<
  typeof applicationExecutionReportResponseSchema
>;

export function applicationReportAgentId(
  value: string | null | undefined,
): string | null {
  return applicationOwnedAgentId(value);
}

/** Copy only fields the application actually sent. Never invent 0 / USD / totals. */
export function applicationExecutionAttributionFromRequest(
  request: ApplicationExecutionReportRequest,
): ApplicationExecutionAttribution | undefined {
  const attribution: ApplicationExecutionAttribution = {
    ...(request.provider !== undefined ? { provider: request.provider } : {}),
    ...(request.model !== undefined ? { model: request.model } : {}),
    ...(request.tokens !== undefined ? { tokens: request.tokens } : {}),
    ...(request.modelCallCount !== undefined
      ? { modelCallCount: request.modelCallCount }
      : {}),
    ...(request.retries !== undefined ? { retries: request.retries } : {}),
    ...(request.declaredCompletionPath !== undefined
      ? { declaredCompletionPath: request.declaredCompletionPath }
      : {}),
    ...(request.actualCost !== undefined ? { actualCost: request.actualCost } : {}),
    ...(request.currency !== undefined ? { currency: request.currency } : {}),
  };
  return Object.keys(attribution).length > 0 ? attribution : undefined;
}
