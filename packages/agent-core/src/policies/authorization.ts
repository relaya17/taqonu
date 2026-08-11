import { AtlasError, type AgentMode, type ToolPolicy } from "@atlas/shared";
import { getToolPolicy } from "./tool-policies.js";

export type AuthorizationDecision =
  | { readonly decision: "ALLOWED"; readonly policy: ToolPolicy }
  | { readonly decision: "DENIED"; readonly reason: string }
  | { readonly decision: "APPROVAL_REQUIRED"; readonly policy: ToolPolicy };

const READ_LIKE_MODES: ReadonlySet<AgentMode> = new Set([
  "READ",
  "ANALYZE",
  "VERIFY",
]);

/**
 * Architecture v1.0: WRITE is denied unless human APPROVE + eval writeGateOpen.
 * PLAN may only use READ_ONLY tools; proposals are not executions.
 */
export function authorizeToolCall(input: {
  toolName: string;
  mode: AgentMode;
  approved?: boolean;
  writeGateOpen?: boolean;
}): AuthorizationDecision {
  const policy = getToolPolicy(input.toolName);
  if (!policy) {
    return {
      decision: "DENIED",
      reason: `Unknown tool: ${input.toolName}`,
    };
  }

  if (READ_LIKE_MODES.has(input.mode) && policy.risk !== "READ_ONLY") {
    return {
      decision: "DENIED",
      reason: `Tool ${input.toolName} is not allowed in ${input.mode} mode`,
    };
  }

  if (input.mode === "PLAN" && policy.risk !== "READ_ONLY") {
    return { decision: "APPROVAL_REQUIRED", policy };
  }

  if (input.mode === "APPROVE") {
    return {
      decision: "DENIED",
      reason: "APPROVE is a human gate, not a tool-execution mode",
    };
  }

  if (policy.risk !== "READ_ONLY") {
    if (input.writeGateOpen !== true) {
      return {
        decision: "DENIED",
        reason: "WRITE tools blocked until evaluation write gate is open",
      };
    }
    if (input.approved !== true) {
      return { decision: "APPROVAL_REQUIRED", policy };
    }
  }

  if (policy.requiresApproval && input.approved !== true) {
    return { decision: "APPROVAL_REQUIRED", policy };
  }

  return { decision: "ALLOWED", policy };
}

export function assertAuthorized(input: {
  toolName: string;
  mode: AgentMode;
  approved?: boolean;
  writeGateOpen?: boolean;
}): ToolPolicy {
  const result = authorizeToolCall(input);
  if (result.decision === "DENIED") {
    throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
  }
  if (result.decision === "APPROVAL_REQUIRED") {
    throw new AtlasError(
      "APPROVAL_REQUIRED",
      `Tool ${input.toolName} requires explicit approval`,
      { statusCode: 403, details: { tool: input.toolName } },
    );
  }
  return result.policy;
}
