import { z } from "zod";
import { TOOL_RISKS } from "../constants/tools.js";

export const toolRiskSchema = z.enum(TOOL_RISKS);

/**
 * Canonical governed-operation identity for a tool. These literals are the
 * existing `BusinessEntityType` / `EntityAction` taxonomy
 * (`packages/agent-core` entity-policies), restated here because `@atlas/shared`
 * cannot import `@atlas/agent-core`. They are operation identity only — not
 * approval, occupancy, or resource instance.
 */
export const TOOL_POLICY_ENTITY_TYPES = [
  "CUSTOMER",
  "RECORD",
  "DOCUMENT",
  "FINANCIAL_TRANSACTION",
  "CASE",
  "COMMUNICATION",
  "CONFIGURATION",
] as const;

export const TOOL_POLICY_ENTITY_ACTIONS = [
  "READ",
  "CREATE",
  "UPDATE",
  "DELETE",
  "EXECUTE",
] as const;

export const toolPolicyEntityTypeSchema = z.enum(TOOL_POLICY_ENTITY_TYPES);
export const toolPolicyEntityActionSchema = z.enum(TOOL_POLICY_ENTITY_ACTIONS);

export type ToolPolicyEntityType = (typeof TOOL_POLICY_ENTITY_TYPES)[number];
export type ToolPolicyEntityAction = (typeof TOOL_POLICY_ENTITY_ACTIONS)[number];

export const toolPolicySchema = z.object({
  toolName: z.string().min(1).max(120),
  risk: toolRiskSchema,
  requiresApproval: z.boolean(),
  allowedProjects: z.array(z.string().min(1)),
  allowedCommands: z.array(z.string().min(1)),
  timeoutMs: z.number().int().positive().max(600_000),
  secretsAccess: z.enum(["NONE", "METADATA_ONLY", "DENY_VALUES"]).default("NONE"),
  entityType: toolPolicyEntityTypeSchema,
  action: toolPolicyEntityActionSchema,
});

export type ToolPolicy = {
  readonly toolName: string;
  readonly risk: z.infer<typeof toolRiskSchema>;
  readonly requiresApproval: boolean;
  readonly allowedProjects: readonly string[];
  readonly allowedCommands: readonly string[];
  readonly timeoutMs: number;
  readonly secretsAccess: "NONE" | "METADATA_ONLY" | "DENY_VALUES";
  /** Canonical governed entity class this tool represents. Not occupancy. */
  readonly entityType: ToolPolicyEntityType;
  /** Canonical governed action this tool represents. Not occupancy. */
  readonly action: ToolPolicyEntityAction;
};
