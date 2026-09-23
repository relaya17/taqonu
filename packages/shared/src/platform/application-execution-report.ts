/**
 * Application execution report-back — evidence after a hop, not permission to run.
 *
 * Separate from atlas.application-preflight.v1.
 * Preflight remains authorization-only (executed: false).
 * A report is not SUCCESS merely because it is accepted.
 */

import { z } from "zod";
import { applicationOwnedAgentId } from "./application-preflight.js";

export const APPLICATION_EXECUTION_REPORT_SCHEMA =
  "atlas.application-execution-report.v1" as const;

export const APPLICATION_EXECUTION_REPORT_PATH =
  "/api/v1/governance/application-execution-report" as const;

export const APPLICATION_EXECUTION_STATUSES = ["SUCCESS", "FAILURE"] as const;
export type ApplicationExecutionStatus =
  (typeof APPLICATION_EXECUTION_STATUSES)[number];

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
