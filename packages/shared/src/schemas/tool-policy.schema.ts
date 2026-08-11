import { z } from "zod";
import { TOOL_RISKS } from "../constants/tools.js";

export const toolRiskSchema = z.enum(TOOL_RISKS);

export const toolPolicySchema = z.object({
  toolName: z.string().min(1).max(120),
  risk: toolRiskSchema,
  requiresApproval: z.boolean(),
  allowedProjects: z.array(z.string().min(1)),
  allowedCommands: z.array(z.string().min(1)),
  timeoutMs: z.number().int().positive().max(600_000),
  secretsAccess: z.enum(["NONE", "METADATA_ONLY", "DENY_VALUES"]).default("NONE"),
});

export type ToolPolicy = {
  readonly toolName: string;
  readonly risk: z.infer<typeof toolRiskSchema>;
  readonly requiresApproval: boolean;
  readonly allowedProjects: readonly string[];
  readonly allowedCommands: readonly string[];
  readonly timeoutMs: number;
  readonly secretsAccess: "NONE" | "METADATA_ONLY" | "DENY_VALUES";
};
